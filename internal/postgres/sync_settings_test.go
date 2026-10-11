// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/scrobble"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLastFMAdminSettingsAccessPersistenceRotationAndRedaction(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	admin, err := r.CreateUser(ctx, domain.User{Username: "admin", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := r.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []struct{ user, token string }{{admin.ID, "admin-token"}, {listener.ID, "listener-token"}} {
		sum := sha256.Sum256([]byte(v.token))
		if err = r.SaveSession(ctx, hex.EncodeToString(sum[:]), v.user, "csrf-value", time.Now().Add(time.Hour), "hash"); err != nil {
			t.Fatal(err)
		}
	}
	dir := t.TempDir()
	svc, err := scrobble.New(r, r, scrobble.NewProviders("env-key", "env-secret"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.LoadLastFMSettings(ctx); err != nil {
		t.Fatal(err)
	}
	h := (&httpapi.Server{Repo: r, Sync: svc, Config: httpapi.Config{PublicURL: "http://cadence.test"}}).Handler()
	request := func(method, path, token, csrf, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		}
		req.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	path := "/api/v1/admin/sync/lastfm"
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		if w := request(method, path, "listener-token", "csrf-value", `{"apiKey":"new-key","apiSecret":"new-secret"}`); w.Code != 403 {
			t.Fatal("listener could configure instance", method, w.Code, w.Body.String())
		}
	}
	if w := request("GET", path, "", "", ""); w.Code != 401 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("PUT", path, "admin-token", "", `{"apiKey":"new-key","apiSecret":"new-secret"}`); w.Code != 403 {
		t.Fatal("missing csrf", w.Code)
	}
	if w := request("PUT", path, "admin-token", "csrf-value", `{"apiKey":"only-key"}`); w.Code != 400 {
		t.Fatal("partial credentials accepted", w.Code)
	}
	if err = r.SaveSyncConnection(ctx, listener.ID, domain.SyncConnection{Provider: "lastfm", Username: "external", Credential: []byte("encrypted")}); err != nil {
		t.Fatal(err)
	}
	if err = r.SaveSyncAuth(ctx, listener.ID, "outstanding-state", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	w := request("PUT", path, "admin-token", "csrf-value", `{"apiKey":" web-key ","apiSecret":" web-secret "}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"configured":true`) || strings.Contains(w.Body.String(), "web-key") || strings.Contains(w.Body.String(), "web-secret") {
		t.Fatal("save/redaction", w.Code, w.Body.String())
	}
	var stored string
	if err = c.QueryRow(ctx, `SELECT value FROM instance_settings WHERE key='lastfm_credentials'`).Scan(&stored); err != nil || strings.Contains(stored, "web-secret") {
		t.Fatal("plaintext stored", err)
	}
	connections, err := r.SyncConnections(ctx, listener.ID)
	if err != nil || !connections[0].Paused {
		t.Fatal("rotation did not pause old sessions", connections, err)
	}
	if ok, err := r.ConsumeSyncAuth(ctx, listener.ID, "outstanding-state"); err != nil || ok {
		t.Fatal("old authorization not invalidated", ok, err)
	}
	w = request("POST", "/api/v1/sync/lastfm/authorize", "listener-token", "csrf-value", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "web-key") || strings.Contains(w.Body.String(), "web-secret") {
		t.Fatal("live configuration not used", w.Code, w.Body.String())
	}
	restarted, err := scrobble.New(r, r, scrobble.NewProviders("env-key", "env-secret"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = restarted.LoadLastFMSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if status := restarted.LastFMSettingsStatus(); !status.Configured || status.Source != "web" {
		t.Fatal("not restored", status)
	}
	w = request("DELETE", path, "admin-token", "csrf-value", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"configured":false`) {
		t.Fatal("disable", w.Code, w.Body.String())
	}
	if err = restarted.LoadLastFMSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if restarted.Providers.Configured() {
		t.Fatal("environment reenabled disabled provider")
	}
	w = request("POST", "/api/v1/sync/lastfm/authorize", "listener-token", "csrf-value", "")
	if w.Code != 400 {
		t.Fatal("disabled authorization allowed", w.Code)
	}
}
