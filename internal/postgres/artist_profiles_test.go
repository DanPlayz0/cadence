// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/library"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type artistTransport func(*http.Request) (*http.Response, error)

func (f artistTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestArtistProfilePersistenceAndHTTP(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	calls := 0
	artist := "Example"
	id, err := repo.UpsertTrack(ctx, domain.Track{Path: "/music/example.mp3", Root: "/music", Title: "Song", Artist: "Example, Guest", Album: "Album", AlbumArtist: "Example"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	var migrated bool
	if err = conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=8)").Scan(&migrated); err != nil || !migrated {
		t.Fatal("migration", err)
	}
	enricher := &library.Enricher{UserAgent: "Cadence test/contact", Client: &http.Client{Transport: artistTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"name":"Example","type":"Group","country":"GB","genres":[{"name":"rock"}]}`)), Header: make(http.Header)}, nil
	})}}
	server := httpapi.Server{Repo: repo, Scanner: &library.Scanner{Repo: repo, Enricher: enricher}, Config: httpapi.Config{PublicURL: "http://example.test"}}
	handler := server.Handler()
	for _, role := range []string{"admin", "listener"} {
		user, e := repo.CreateUser(ctx, domain.User{Username: role, Password: "hash"}, role == "admin")
		if e != nil {
			t.Fatal(e)
		}
		hash := sha256.Sum256([]byte(role))
		if e = repo.SaveSession(ctx, hex.EncodeToString(hash[:]), user.ID, "csrf", time.Now().Add(time.Hour), user.Password); e != nil {
			t.Fatal(e)
		}
	}
	request := func(method, path, token, csrf, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		}
		req.Header.Set("X-CSRF-Token", csrf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	assert := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("status %d want %d: %s", w.Code, status, w.Body.String())
		}
	}
	body := `{"artist":"Example","mbid":"12345678-1234-1234-1234-123456789012"}`
	assert(request("GET", "/api/v1/artists/profile?artist=Example", "", "", ""), 401)
	assert(request("POST", "/api/v1/admin/artists/profile", "listener", "csrf", body), 403)
	assert(request("POST", "/api/v1/admin/artists/profile", "admin", "", body), 403)
	assert(request("POST", "/api/v1/admin/artists/profile", "admin", "csrf", `{"artist":"Hidden"}`), 404)
	if calls != 0 {
		t.Fatal("unauthorized lookups called external service")
	}
	assert(request("GET", "/api/v1/artists/profile?artist=Example", "listener", "", ""), 200)
	assert(request("POST", "/api/v1/admin/artists/profile", "admin", "csrf", body), 200)
	saved, err := repo.ArtistProfile(ctx, artist)
	if err != nil || saved.Name != artist || saved.Country != "GB" {
		t.Fatalf("persisted profile %+v %v", saved, err)
	}
	w := request("GET", "/api/v1/artists/profile?artist=Example", "listener", "", "")
	assert(w, 200)
	var response struct{ Profile domain.ArtistProfile }
	if err = json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Profile.Name != artist {
		t.Fatal("read profile", err)
	}
	avatar := `{"artist":"Example","image":"https://example.com/avatar.jpg"}`
	assert(request("PUT", "/api/v1/admin/artists/avatar", "listener", "csrf", avatar), 403)
	assert(request("PUT", "/api/v1/admin/artists/avatar", "admin", "", avatar), 403)
	assert(request("PUT", "/api/v1/admin/artists/avatar", "admin", "csrf", `{"artist":"Example","image":"javascript:alert(1)"}`), 400)
	assert(request("PUT", "/api/v1/admin/artists/avatar", "admin", "csrf", avatar), 200)
	saved, err = repo.ArtistProfile(ctx, artist)
	if err != nil || saved.Image != "https://example.com/avatar.jpg" || saved.Country != "GB" {
		t.Fatal("avatar must preserve profile", saved, err)
	}
	assert(request("PUT", "/api/v1/admin/artists/avatar", "admin", "csrf", `{"artist":"Example","image":""}`), 200)
	if _, err = conn.Exec(ctx, "UPDATE tracks SET available=false WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	assert(request("GET", "/api/v1/artists/profile?artist=Example", "listener", "", ""), 404)
	if calls != 1 {
		t.Fatal("saved profile performed an external fetch")
	}
}
