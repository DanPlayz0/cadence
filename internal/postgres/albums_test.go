// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAlbumGroupingAndMoves(t *testing.T) {
	repo, _ := fixture(t)
	ctx := context.Background()
	user, err := repo.CreateUser(ctx, domain.User{Username: "album-admin", Password: "hash", Admin: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	tracks := []domain.Track{
		{Path: "/music/one/a.mp3", Title: "A", Album: "Festival", AlbumArtist: "Artist", Artist: "Artist", AlbumID: "folder-one"},
		{Path: "/music/two/b.mp3", Title: "B", Album: " festival ", AlbumArtist: " artist ", Artist: "Artist", AlbumID: "folder-two"},
		{Path: "/music/three/c.mp3", Title: "C", Album: "Festival", AlbumArtist: "Other", Artist: "Other", AlbumID: "folder-three"},
		{Path: "/music/single.mp3", Title: "Single", Artist: "Artist"},
	}
	ids := []string{}
	for _, track := range tracks {
		id, e := repo.UpsertTrack(ctx, track, "scan")
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	a, e := repo.Track(ctx, user.ID, ids[0])
	if e != nil {
		t.Fatal(e)
	}
	b, e := repo.Track(ctx, user.ID, ids[1])
	if e != nil {
		t.Fatal(e)
	}
	c, e := repo.Track(ctx, user.ID, ids[2])
	if e != nil {
		t.Fatal(e)
	}
	if a.AlbumID != b.AlbumID || a.AlbumID == c.AlbumID {
		t.Fatal("album grouping must ignore folder, case and surrounding whitespace, but keep artists separate")
	}
	albums, e := repo.Albums(ctx, user.ID, "", "", 100, 0)
	if e != nil || len(albums) != 2 {
		t.Fatalf("albums: %+v %v", albums, e)
	}
	page, e := repo.Tracks(ctx, user.ID, domain.Query{Album: a.AlbumID, Limit: 100})
	if e != nil || page.Total != 2 {
		t.Fatalf("album songs: %+v %v", page, e)
	}
	if e = repo.MoveTrackAlbum(ctx, user.ID, ids[0], c.AlbumID); e != nil {
		t.Fatal(e)
	}
	moved, e := repo.Track(ctx, user.ID, ids[0])
	if e != nil || moved.AlbumID != c.AlbumID || moved.Artist != "Artist" || moved.AlbumArtist != "Other" {
		t.Fatalf("move: %+v %v", moved, e)
	}
	// A scanner update must preserve the user's assignment.
	if _, e = repo.UpsertTrack(ctx, tracks[0], "rescan"); e != nil {
		t.Fatal(e)
	}
	moved, e = repo.Track(ctx, user.ID, ids[0])
	if e != nil || moved.AlbumID != c.AlbumID {
		t.Fatalf("rescan: %+v %v", moved, e)
	}
	if e = repo.MoveTrackAlbum(ctx, user.ID, ids[3], c.AlbumID); e != nil {
		t.Fatal(e)
	}
	single, e := repo.Track(ctx, user.ID, ids[3])
	if e != nil || single.Single || single.AlbumID != c.AlbumID {
		t.Fatalf("single move: %+v %v", single, e)
	}
	if e = repo.MoveTrackAlbum(ctx, user.ID, ids[1], "00000000000000000000000000000000"); !errors.Is(e, domain.ErrNotFound) {
		t.Fatalf("missing destination: %v", e)
	}
	group, e := repo.CreateGroup(ctx, "restricted-albums")
	if e != nil {
		t.Fatal(e)
	}
	if e = repo.SetGroups(ctx, user.ID, []string{group.ID}); e != nil {
		t.Fatal(e)
	}
	if _, e = repo.CreateExclusion(ctx, domain.Exclusion{GroupID: group.ID, Kind: "album", Target: c.AlbumID}); e != nil {
		t.Fatal(e)
	}
	if e = repo.MoveTrackAlbum(ctx, user.ID, ids[1], c.AlbumID); !errors.Is(e, domain.ErrNotFound) {
		t.Fatalf("hidden destination: %v", e)
	}
	page, e = repo.Tracks(ctx, user.ID, domain.Query{Album: c.AlbumID, Limit: 100})
	if e != nil || page.Total != 0 {
		t.Fatalf("album exclusion: %+v %v", page, e)
	}
}

func TestMoveAlbumHTTP(t *testing.T) {
	repo, _ := fixture(t)
	ctx := context.Background()
	admin, err := repo.CreateUser(ctx, domain.User{Username: "admin", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := repo.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	for token, id := range map[string]string{"admin": admin.ID, "listener": listener.ID} {
		hash := sha256.Sum256([]byte(token))
		if err = repo.SaveSession(ctx, hex.EncodeToString(hash[:]), id, "csrf", time.Now().Add(time.Hour), "hash"); err != nil {
			t.Fatal(err)
		}
	}
	id, err := repo.UpsertTrack(ctx, domain.Track{Path: "/music/a.mp3", Title: "Song", Artist: "Artist", Album: "Album"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	track, err := repo.Track(ctx, admin.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	handler := (&httpapi.Server{Repo: repo, Config: httpapi.Config{PublicURL: "http://example.test"}}).Handler()
	for _, test := range []struct {
		token, csrf, body string
		status            int
	}{
		{"", "", `{}`, 401},
		{"listener", "csrf", `{}`, 403},
		{"admin", "", `{}`, 403},
		{"admin", "csrf", `{}`, 400},
		{"admin", "csrf", `{"albumId":"00000000000000000000000000000000"}`, 404},
		{"admin", "csrf", `{"albumId":"` + track.AlbumID + `"}`, 200},
	} {
		r := httptest.NewRequest("PUT", "/api/v1/admin/tracks/"+id+"/album", strings.NewReader(test.body))
		if test.token != "" {
			r.AddCookie(&http.Cookie{Name: "cadence_session", Value: test.token})
		}
		r.Header.Set("X-CSRF-Token", test.csrf)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("HTTP %d want %d: %s", w.Code, test.status, w.Body.String())
		}
	}
}
