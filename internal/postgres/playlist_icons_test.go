// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/postgres"
)

func TestFullPlaylistIconUpgrade(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	u, err := r.CreateUser(ctx, domain.User{Username: "icons", Password: "unused"}, true)
	if err != nil {
		t.Fatal(err)
	}
	old, err := r.CreatePlaylist(ctx, u.ID, "Existing", "disc")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Exec(ctx, `ALTER TABLE playlists DROP CONSTRAINT playlists_icon_check;
    ALTER TABLE playlists ADD CONSTRAINT playlists_icon_check CHECK (icon IN ('music','heart','headphones','disc','sparkles','moon'));
    DELETE FROM schema_migrations WHERE version=17`); err != nil {
		t.Fatal(err)
	}
	var schema string
	if err = c.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	uri, _ := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	q := uri.Query()
	q.Set("search_path", schema)
	uri.RawQuery = q.Encode()
	upgraded, err := postgres.Open(ctx, uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	lists, err := upgraded.Playlists(ctx, u.ID)
	if err != nil || len(lists) != 1 || lists[0] != old {
		t.Fatal("existing icon changed", err)
	}
	for _, icon := range []string{"coffee", "tree-pine", "arrow-down-0-1"} {
		if _, err = upgraded.CreatePlaylist(ctx, u.ID, icon, icon); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = c.Exec(ctx, "UPDATE playlists SET icon='' WHERE id=$1", old.ID); err == nil {
		t.Fatal("database accepted empty icon")
	}
	if _, err = c.Exec(ctx, "UPDATE playlists SET icon='<svg>' WHERE id=$1", old.ID); err == nil {
		t.Fatal("database accepted malformed icon")
	}
	reopened, err := postgres.Open(ctx, uri.String())
	if err != nil {
		t.Fatal("migration not repeatable", err)
	}
	reopened.Close()
}

func TestUpdatePlaylistIconPersistence(t *testing.T) {
	r, _ := fixture(t)
	ctx := context.Background()
	owner, err := r.CreateUser(ctx, domain.User{Username: "owner", Password: "unused"}, true)
	if err != nil {
		t.Fatal(err)
	}
	other, err := r.CreateUser(ctx, domain.User{Username: "other", Password: "unused"}, false)
	if err != nil {
		t.Fatal(err)
	}
	own, err := r.CreatePlaylist(ctx, owner.ID, "Own", "moon")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := r.CreatePlaylist(ctx, other.ID, "Foreign", "heart")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte("icon-token"))
	if err = r.SaveSession(ctx, hex.EncodeToString(hash[:]), owner.ID, "icon-csrf", time.Now().Add(time.Hour), owner.Password); err != nil {
		t.Fatal(err)
	}
	handler := (&httpapi.Server{Repo: r, Config: httpapi.Config{PublicURL: "http://example.test"}}).Handler()
	for _, tc := range []struct {
		id, body string
		status   int
	}{
		{own.ID, `{"icon":"guitar"}`, 200},
		{foreign.ID, `{"icon":"coffee"}`, 404},
		{"missing", `{"icon":"coffee"}`, 404},
		{own.ID, `{"icon":"unknown"}`, 400},
		{own.ID, `{}`, 400},
	} {
		req := httptest.NewRequest("PATCH", "/api/v1/playlists/"+tc.id, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", "icon-csrf")
		req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "icon-token"})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("want %d got %d: %s", tc.status, w.Code, w.Body.String())
		}
	}
	lists, err := r.Playlists(ctx, owner.ID)
	if err != nil || len(lists) != 1 || lists[0].Icon != "guitar" || lists[0].Name != own.Name {
		t.Fatal("update not persisted", err)
	}
	lists, err = r.Playlists(ctx, other.ID)
	if err != nil || len(lists) != 1 || lists[0].Icon != "heart" {
		t.Fatal("foreign playlist changed", err)
	}
}
