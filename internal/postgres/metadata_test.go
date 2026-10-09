// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/postgres"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestNumericMetadataSuggestions(t *testing.T) {
	r, _ := fixture(t)
	ctx := context.Background()
	user, err := r.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	id, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/song.mp3", Root: "/music", Title: "Song", Artist: "Artist", Album: "Album", AlbumArtist: "Artist", AlbumID: "album", Number: 1, Disc: 1, Genre: "Rock"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte("metadata-token"))
	if err = r.SaveSession(ctx, hex.EncodeToString(hash[:]), user.ID, "csrf", time.Now().Add(time.Hour), user.Password); err != nil {
		t.Fatal(err)
	}
	handler := (&httpapi.Server{Repo: r}).Handler()
	for _, v := range []struct {
		field, value string
		status       int
	}{{"number", "5", 200}, {"disc", "2", 200}, {"genre", "", 200}, {"number", "1.5", 400}, {"disc", "-1", 400}} {
		req := httptest.NewRequest("POST", "/api/v1/admin/suggestions", strings.NewReader(fmt.Sprintf(`{"trackId":%q,"field":%q,"value":%q}`, id, v.field, v.value)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", "csrf")
		req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "metadata-token"})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != v.status {
			t.Fatalf("%s=%q: %d %s", v.field, v.value, w.Code, w.Body.String())
		}
	}
	suggestions, err := r.Suggestions(ctx, 100, 0)
	if err != nil || len(suggestions) != 3 {
		t.Fatal("suggestions", err, suggestions)
	}
	for _, s := range suggestions {
		if s.Field == "number" && s.Current != "1" {
			t.Fatal("wrong original number", s)
		}
		if err = r.ResolveSuggestion(ctx, s.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	track, err := r.Track(ctx, user.ID, id)
	if err != nil || track.Number != 5 || track.Disc != 2 || track.Genre != "" {
		t.Fatal("overrides", err, track)
	}
	// Rescanning preserves accepted overrides while updating extracted values.
	other, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/other.mp3", Root: "/music", Title: "Other", Artist: "Artist", Album: "Album", AlbumArtist: "Artist", AlbumID: "album", Number: 4, Disc: 1}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	page, err := r.Tracks(ctx, user.ID, domain.Query{Limit: 100, Album: "album"})
	if err != nil || len(page.Items) != 2 || page.Items[0].ID != other {
		t.Fatal("effective disc/number sorting", err, page)
	}
	if _, err = r.UpsertTrack(ctx, domain.Track{Path: "/music/song.mp3", Root: "/music", Title: "Song", Artist: "Artist", Album: "Album", AlbumArtist: "Artist", AlbumID: "album", Number: 3, Disc: 1, Genre: "Pop"}, "next"); err != nil {
		t.Fatal(err)
	}
	track, err = r.Track(ctx, user.ID, id)
	if err != nil || track.Number != 5 || track.Disc != 2 {
		t.Fatal("overrides lost on scan", err)
	}
	if err = r.ClearOverride(ctx, id, "number"); err != nil {
		t.Fatal(err)
	}
	track, err = r.Track(ctx, user.ID, id)
	if err != nil || track.Number != 3 {
		t.Fatal("restore", err, track.Number)
	}
}

func TestMetadataNumbersUpgrade(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	id, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/existing.mp3", Root: "/music", Title: "Existing", Artist: "Artist", AlbumID: "album", Number: 7}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: "title", Value: "Pending title", Source: "administrator"}); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Exec(ctx, `ALTER TABLE suggestions DROP CONSTRAINT suggestions_field_check; ALTER TABLE suggestions ADD CONSTRAINT suggestions_field_check CHECK(field IN ('title','artist','album','albumArtist','year','genre','artwork')); DELETE FROM schema_migrations WHERE version=5`); err != nil {
		t.Fatal(err)
	}
	var schema string
	if err = c.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	uri, _ := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	query := uri.Query()
	query.Set("search_path", schema)
	uri.RawQuery = query.Encode()
	upgraded, err := postgres.Open(ctx, uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	suggestions, err := upgraded.Suggestions(ctx, 100, 0)
	if err != nil || len(suggestions) != 1 || suggestions[0].Value != "Pending title" {
		t.Fatal("existing suggestion lost", err, suggestions)
	}
	if err = upgraded.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: "number", Value: "8", Source: "administrator"}); err != nil {
		t.Fatal("numeric suggestion after upgrade", err)
	}
}
