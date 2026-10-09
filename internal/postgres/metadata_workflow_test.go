// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLibraryMetadataDirectory(t *testing.T) {
	repo, _ := fixture(t)
	ctx := context.Background()
	user, err := repo.CreateUser(ctx, domain.User{Username: "admin", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	paths := []string{"/music/Artist/Album/track.mp3", "/music/Artist/single.mp3", "/music/ArtistsExtra/other.mp3", "/music/hidden/secret.mp3", "/music/100%_real/音楽.mp3", `C:\Music\Artist\song.flac`}
	ids := []string{}
	for i, path := range paths {
		root := "/music"
		if i == 5 {
			root = `C:\Music`
		}
		id, e := repo.UpsertTrack(ctx, domain.Track{Path: path, Root: root, Title: "Song", Artist: "Artist"}, "scan")
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	group, e := repo.CreateGroup(ctx, "restricted")
	if e != nil {
		t.Fatal(e)
	}
	if e = repo.SetGroups(ctx, user.ID, []string{group.ID}); e != nil {
		t.Fatal(e)
	}
	if _, e = repo.CreateExclusion(ctx, domain.Exclusion{GroupID: group.ID, Kind: "folder", Target: "/music/hidden"}); e != nil {
		t.Fatal(e)
	}
	page, e := repo.LibraryDirectory(ctx, user.ID, "", 100, 0)
	if e != nil || len(page.Items) != 2 || page.Total != 2 {
		t.Fatalf("roots %+v %v", page, e)
	}
	page, e = repo.LibraryDirectory(ctx, user.ID, "/music", 100, 0)
	if e != nil || len(page.Items) != 3 {
		t.Fatalf("folders %+v %v", page, e)
	}
	for _, entry := range page.Items {
		if entry.Name == "hidden" {
			t.Fatal("hidden directory leaked")
		}
	}
	page, e = repo.LibraryDirectory(ctx, user.ID, "/music/Artist", 100, 0)
	if e != nil || len(page.Items) != 2 || page.Items[0].Kind != "folder" || page.Items[1].TrackID != ids[1] {
		t.Fatalf("immediate children %+v %v", page, e)
	}
	page, e = repo.LibraryDirectory(ctx, user.ID, "/music/100%_real", 1, 0)
	if e != nil || len(page.Items) != 1 || page.Items[0].Name != "音楽.mp3" {
		t.Fatalf("literal path %+v %v", page, e)
	}
	page, e = repo.LibraryDirectory(ctx, user.ID, `C:\Music\Artist`, 100, 0)
	if e != nil || len(page.Items) != 1 || page.Items[0].Path != "C:/Music/Artist/song.flac" {
		t.Fatalf("windows catalog %+v %v", page, e)
	}
	page, e = repo.LibraryDirectory(ctx, user.ID, "/music/Artist", 1, 1)
	if e != nil || len(page.Items) != 1 || page.Total != 2 || page.Items[0].TrackID != ids[1] {
		t.Fatalf("paging %+v %v", page, e)
	}
	for _, path := range []string{"/etc", "/music/../etc", "/music/hidden", "/music/Arti"} {
		page, e = repo.LibraryDirectory(ctx, user.ID, path, 100, 0)
		if e != nil || len(page.Items) != 0 {
			t.Fatalf("unsafe/hidden path %s %+v %v", path, page, e)
		}
	}
}

func TestMetadataChoicesAndHTTP(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	track, err := repo.UpsertTrack(ctx, domain.Track{Path: "/music/song.mp3", Root: "/music", Title: "Original", Artist: "Artist", Album: "Album", AlbumID: "album", Year: "2020"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []domain.Suggestion{{TrackID: track, Field: "title", Value: "Candidate A", Source: "source A"}, {TrackID: track, Field: "title", Value: "Candidate B", Source: "source B"}, {TrackID: track, Field: "album", Value: "New album", Source: "source A"}, {TrackID: track, Field: "year", Value: "2021", Source: "source A"}} {
		if err = repo.AddSuggestion(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	items, err := repo.TrackSuggestions(ctx, track)
	if err != nil || len(items) != 4 {
		t.Fatalf("all candidates %+v %v", items, err)
	}
	var titleA, titleB, album, year domain.Suggestion
	for _, s := range items {
		switch {
		case s.Field == "title" && s.Source == "source A":
			titleA = s
		case s.Field == "title":
			titleB = s
		case s.Field == "album":
			album = s
		case s.Field == "year":
			year = s
		}
	}
	user, err := repo.CreateUser(ctx, domain.User{Username: "admin", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := repo.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	for token, id := range map[string]string{"admin": user.ID, "listener": listener.ID} {
		hash := sha256.Sum256([]byte(token))
		if err = repo.SaveSession(ctx, hex.EncodeToString(hash[:]), id, "csrf", time.Now().Add(time.Hour), "hash"); err != nil {
			t.Fatal(err)
		}
	}
	handler := (&httpapi.Server{Repo: repo, Config: httpapi.Config{PublicURL: "http://example.test"}}).Handler()
	request := func(method, path, token, csrf, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		}
		r.Header.Set("X-CSRF-Token", csrf)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	assertStatus := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("HTTP %d want %d: %s", w.Code, status, w.Body.String())
		}
	}
	endpoint := "/api/v1/admin/tracks/" + track + "/metadata"
	assertStatus(request("GET", "/api/v1/admin/library", "", "", ""), 401)
	assertStatus(request("GET", "/api/v1/admin/library", "listener", "", ""), 403)
	assertStatus(request("GET", "/api/v1/admin/library", "admin", "", ""), 200)
	assertStatus(request("GET", "/api/v1/admin/tracks/"+track+"/suggestions", "admin", "", ""), 200)
	assertStatus(request("POST", endpoint, "admin", "", `{"choices":[]}`), 403)
	assertStatus(request("POST", endpoint, "listener", "csrf", `{"choices":[]}`), 403)
	assertStatus(request("POST", endpoint, "admin", "csrf", `{"choices":[]}`), 400)
	body := func(choices []domain.MetadataChoice) string {
		b, _ := json.Marshal(map[string]any{"choices": choices})
		return string(b)
	}
	foreign, err := repo.UpsertTrack(ctx, domain.Track{Path: "/music/foreign.mp3", Root: "/music", Title: "Foreign", Artist: "Artist"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.AddSuggestion(ctx, domain.Suggestion{TrackID: foreign, Field: "title", Value: "Foreign proposal", Source: "administrator"}); err != nil {
		t.Fatal(err)
	}
	foreignItems, err := repo.TrackSuggestions(ctx, foreign)
	if err != nil || len(foreignItems) != 1 {
		t.Fatal("foreign candidates", foreignItems, err)
	}
	assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: foreignItems[0].ID, Current: "Foreign"}})), 400)
	for _, candidate := range []domain.Suggestion{{TrackID: track, Field: "artwork", Value: "/cache/art.jpg", Source: "art test"}, {TrackID: track, Field: "number", Value: "3", Source: "number test"}} {
		if err = repo.AddSuggestion(ctx, candidate); err != nil {
			t.Fatal(err)
		}
		all, e := repo.TrackSuggestions(ctx, track)
		if e != nil {
			t.Fatal(e)
		}
		for _, s := range all {
			if s.Source == candidate.Source {
				bad := "/arbitrary/path"
				if s.Field == "number" {
					bad = "1.5"
				}
				assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: s.ID, Current: s.Current, Value: &bad}})), 400)
				if err = repo.ResolveSuggestion(ctx, s.ID, false); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	invalid := ""
	assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: titleA.ID, Current: "Original", Value: &invalid}})), 400)
	assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: titleA.ID, Current: "Original"}, {ID: titleB.ID, Current: "Original"}})), 409)
	assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: titleA.ID, Current: "Original"}, {ID: album.ID, Current: "Stale album"}})), 409)
	original, _ := repo.Track(ctx, user.ID, track)
	if original.Title != "Original" {
		t.Fatal("partial update escaped failed batch")
	}
	replacement := "Edited title"
	empty := ""
	assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: titleB.ID, Current: "Original", Value: &replacement}, {ID: album.ID, Current: "Album", Value: &empty}})), 200)
	updated, err := repo.Track(ctx, user.ID, track)
	if err != nil || updated.Title != replacement || !updated.Single || updated.Year != "2020" {
		t.Fatalf("selected fields %+v %v", updated, err)
	}
	accepted, err := repo.Suggestion(ctx, titleB.ID)
	if err != nil || accepted.Value != replacement || !strings.Contains(accepted.Source, "edited by administrator") {
		t.Fatalf("reviewed value audit %+v %v", accepted, err)
	}
	var status string
	if err = conn.QueryRow(ctx, "SELECT status FROM suggestions WHERE id=$1", titleA.ID).Scan(&status); err != nil || status != "dismissed" {
		t.Fatalf("alternative status %s %v", status, err)
	}
	pending, err := repo.TrackSuggestions(ctx, track)
	if err != nil || len(pending) != 1 || pending[0].ID != year.ID {
		t.Fatalf("kept field pending %+v %v", pending, err)
	}
	if err = repo.ApplyMetadataChoices(ctx, track, []domain.MetadataChoice{{ID: titleB.ID, Current: replacement}}); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("resolved candidate accepted twice", err)
	}
	if _, err = conn.Exec(ctx, `UPDATE tracks SET overrides=overrides||'{"year":"2022"}' WHERE id=$1`, track); err != nil {
		t.Fatal(err)
	}
	assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: year.ID, Current: "2020"}})), 409)
	group, err := repo.CreateGroup(ctx, "hidden")
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.SetGroups(ctx, user.ID, []string{group.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CreateExclusion(ctx, domain.Exclusion{GroupID: group.ID, Kind: "track", Target: track}); err != nil {
		t.Fatal(err)
	}
	assertStatus(request("GET", "/api/v1/admin/tracks/"+track+"/suggestions", "admin", "", ""), 404)
	assertStatus(request("POST", endpoint, "admin", "csrf", body([]domain.MetadataChoice{{ID: year.ID, Current: "2022"}})), 404)
}
