// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/scrobble"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSyncHTTPAccessCSRFValidationAndIsolation(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	u, err := r.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	other, err := r.CreateUser(ctx, domain.User{Username: "other", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	track, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/http-sync.mp3", Root: "/music", Title: "Catalog title", Artist: "Catalog artist", Duration: 300}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []struct{ user, token string }{{u.ID, "listener-token"}, {other.ID, "other-token"}} {
		sum := sha256.Sum256([]byte(v.token))
		if err = r.SaveSession(ctx, hex.EncodeToString(sum[:]), v.user, "csrf-value", time.Now().Add(time.Hour), "hash"); err != nil {
			t.Fatal(err)
		}
	}
	svc, err := scrobble.New(r, r, scrobble.NewProviders("key", "secret"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &httpapi.Server{Repo: r, Sync: svc, Config: httpapi.Config{PublicURL: "http://cadence.test"}}
	h := server.Handler()
	request := func(method, path, token, csrf, origin, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	if w := request("GET", "/api/v1/sync", "", "", "", ""); w.Code != 401 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("POST", "/api/v1/sync/listens", "listener-token", "", "", `{}`); w.Code != 403 {
		t.Fatal("missing csrf", w.Code, w.Body.String())
	}
	if w := request("POST", "/api/v1/sync/listens", "listener-token", "csrf-value", "http://evil.test", `{}`); w.Code != 403 {
		t.Fatal("bad origin", w.Code, w.Body.String())
	}
	if w := request("POST", "/api/v1/sync/listens", "listener-token", "csrf-value", "", `{}`); w.Code != 400 {
		t.Fatal("invalid event", w.Code, w.Body.String())
	}
	if w := request("PUT", "/api/v1/sync/unknown/preferences", "listener-token", "csrf-value", "", `{"plays":true}`); w.Code != 400 {
		t.Fatal("unknown provider", w.Code, w.Body.String())
	}
	if err = r.SaveSyncConnection(ctx, u.ID, domain.SyncConnection{Provider: "lastfm", Username: "external", Credential: []byte("private-encrypted-value")}); err != nil {
		t.Fatal(err)
	}
	w := request("GET", "/api/v1/sync", "listener-token", "", "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "credential") || strings.Contains(w.Body.String(), "private-encrypted-value") {
		t.Fatal("credential exposed", w.Body.String())
	}
	w = request("GET", "/api/v1/sync", "other-token", "", "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "external") {
		t.Fatal("other user's connection exposed", w.Body.String())
	}
	e := domain.SyncEvent{EventID: "0123456789abcdef", TrackID: track, StartedAt: time.Now().Add(-3 * time.Minute).Unix(), Duration: 60, Heard: 30}
	b, _ := json.Marshal(e)
	w = request("POST", "/api/v1/sync/listens", "listener-token", "csrf-value", "", string(b))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var count int
	if err = c.QueryRow(ctx, `SELECT count(*) FROM sync_listens`).Scan(&count); err != nil || count != 0 {
		t.Fatal("client duration bypassed catalog", count, err)
	}
	e.Heard = 150
	b, _ = json.Marshal(e)
	for i := 0; i < 2; i++ {
		w = request("POST", "/api/v1/sync/listens", "listener-token", "csrf-value", "", string(b))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if err = c.QueryRow(ctx, `SELECT count(*) FROM sync_listens WHERE payload->>'title'='Catalog title' AND (payload->>'duration')::numeric=300`).Scan(&count); err != nil || count != 1 {
		t.Fatal("snapshot/dedup failed", count, err)
	}
	// Last.fm state is returned only in the authorization URL and bound to this listener.
	w = request("POST", "/api/v1/sync/lastfm/authorize", "listener-token", "csrf-value", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "https://www.last.fm/api/auth") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = request("GET", "/api/v1/sync/lastfm/callback?state="+strings.Repeat("a", 64)+"&token=unused", "other-token", "", "", "")
	if w.Code != 400 {
		t.Fatal("accepted unbound authorization", w.Code, w.Body.String())
	}
	job, err := r.StartSyncExport(ctx, u.ID, "lastfm", time.Now().Add(-24*time.Hour), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	w = request("GET", "/api/v1/sync/exports/"+job.ID, "other-token", "", "", "")
	if w.Code != 404 {
		t.Fatal("export crossed account boundary", w.Code, w.Body.String())
	}
	g, err := r.CreateGroup(ctx, "Sync restricted")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.SetGroups(ctx, u.ID, []string{g.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.CreateExclusion(ctx, domain.Exclusion{GroupID: g.ID, Kind: "track", Target: track}); err != nil {
		t.Fatal(err)
	}
	e.EventID = "abcdef0123456789"
	b, _ = json.Marshal(e)
	w = request("POST", "/api/v1/sync/listens", "listener-token", "csrf-value", "", string(b))
	if w.Code != 404 {
		t.Fatal("excluded track sync", w.Code, w.Body.String())
	}
}
