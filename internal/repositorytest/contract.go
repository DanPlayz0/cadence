// SPDX-License-Identifier: GPL-2.0-or-later
// Package repositorytest defines behavioral contracts for current and future adapters.
package repositorytest

import (
	"context"
	"errors"
	"testing"
	"time"

	"cadence/internal/domain"
)

func Run(t *testing.T, newRepo func(*testing.T) domain.Repository) {
	t.Helper()
	t.Run("user_names", func(t *testing.T) {
		r := newRepo(t)
		ctx := context.Background()
		u, e := r.CreateUser(ctx, domain.User{Username: "  DaNnY  ", DisplayName: "Danny's Music", Password: "hash"}, true)
		must(t, e)
		if u.Username != "danny" || u.DisplayName != "Danny's Music" {
			t.Fatalf("incorrect user names: %+v", u)
		}
		loaded, e := r.UserByUsername(ctx, " DANNY ")
		must(t, e)
		if loaded.ID != u.ID || loaded.DisplayName != u.DisplayName || loaded.Username != u.Username {
			t.Fatal("case-insensitive lookup lost identity or display name")
		}
		_, e = r.CreateUser(ctx, domain.User{Username: "DANNY", DisplayName: "Another Danny", Password: "hash"}, false)
		if !errors.Is(e, domain.ErrConflict) {
			t.Fatalf("case-insensitive duplicate accepted: %v", e)
		}
		must(t, r.SaveSession(ctx, "session-token", u.ID, "csrf", time.Now().Add(time.Hour), u.Password))
		session, e := r.Session(ctx, "session-token")
		must(t, e)
		users, e := r.Users(ctx)
		must(t, e)
		if session.User.DisplayName != u.DisplayName || session.User.Username != u.Username || len(users) != 1 || users[0].DisplayName != u.DisplayName || users[0].Username != u.Username {
			t.Fatal("session or administrator listing lost user names")
		}
	})
	t.Run("catalog_permissions_and_personal_data", func(t *testing.T) {
		r := newRepo(t)
		ctx := context.Background()
		admin, e := r.CreateUser(ctx, domain.User{Username: "admin", Password: "hash"}, true)
		must(t, e)
		listener, e := r.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
		must(t, e)
		if !admin.Admin {
			t.Fatal("first user must be admin")
		}
		_, e = r.CreateUser(ctx, domain.User{Username: "another-first"}, true)
		if !errors.Is(e, domain.ErrConflict) {
			t.Fatalf("setup must be one-time: %v", e)
		}
		a := domain.Track{Path: "/music/Blocked/a.flac", Root: "/music", Title: "Original title", Artist: "Artist", AlbumArtist: "Artist", Album: "Album", AlbumID: "album-one", MIME: "audio/flac", Codec: "flac", Duration: 42, Size: 123, Modified: 1}
		id, e := r.UpsertTrack(ctx, a, "scan1")
		must(t, e)
		b := a
		b.Path = "/music/BlockedOther/b.flac"
		b.Title = "Other song"
		b.AlbumID = "album-two"
		id2, e := r.UpsertTrack(ctx, b, "scan1")
		must(t, e)
		p, e := r.Tracks(ctx, listener.ID, domain.Query{Limit: 100})
		must(t, e)
		if p.Total != 2 {
			t.Fatalf("default access: %d", p.Total)
		}
		must(t, r.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: "title", Value: "Accepted title", Source: "test"}))
		v, e := r.Suggestions(ctx, 100, 0)
		must(t, e)
		must(t, r.ResolveSuggestion(ctx, v[0].ID, true))
		a.Title = "Changed source"
		_, e = r.UpsertTrack(ctx, a, "scan2")
		must(t, e)
		track, e := r.Track(ctx, listener.ID, id)
		must(t, e)
		if track.Title != "Accepted title" {
			t.Fatal("rescan erased accepted override")
		}
		p, e = r.Tracks(ctx, listener.ID, domain.Query{Search: "Accepted", Limit: 100})
		must(t, e)
		if p.Total != 1 {
			t.Fatal("effective metadata must be searchable")
		}
		must(t, r.ClearOverride(ctx, id, "title"))
		track, e = r.Track(ctx, listener.ID, id)
		must(t, e)
		if track.Title != "Changed source" {
			t.Fatal("reset did not expose extracted metadata")
		}
		pl, e := r.CreatePlaylist(ctx, listener.ID, "Private mix", "moon")
		must(t, e)
		owned, e := r.Playlists(ctx, listener.ID)
		must(t, e)
		if len(owned) != 1 || owned[0].Icon != "moon" {
			t.Fatal("playlist icon was not persisted")
		}
		must(t, r.AddPlaylistTrack(ctx, listener.ID, pl.ID, id))
		must(t, r.AddPlaylistTrack(ctx, listener.ID, pl.ID, id)) // Duplicate additions are idempotent.
		must(t, r.AddPlaylistTrack(ctx, listener.ID, pl.ID, id2))
		must(t, r.Like(ctx, listener.ID, id, true))
		must(t, r.RecordPlay(ctx, listener.ID, id, "an-idempotent-play-event"))
		must(t, r.RecordPlay(ctx, listener.ID, id, "an-idempotent-play-event"))
		other, e := r.Playlists(ctx, admin.ID)
		must(t, e)
		if len(other) != 0 {
			t.Fatal("playlists leaked")
		}
		if e = r.DeletePlaylist(ctx, admin.ID, pl.ID); !errors.Is(e, domain.ErrNotFound) {
			t.Fatal("foreign playlist deletion permitted")
		}
		g, e := r.CreateGroup(ctx, "restricted")
		must(t, e)
		g2, e := r.CreateGroup(ctx, "also-restricted")
		must(t, e)
		must(t, r.SetGroups(ctx, listener.ID, []string{g.ID, g2.ID}))
		ex, e := r.CreateExclusion(ctx, domain.Exclusion{GroupID: g.ID, Kind: "folder", Target: "/music/Blocked"})
		must(t, e)
		p, e = r.Tracks(ctx, listener.ID, domain.Query{Playlist: pl.ID, Limit: 100})
		must(t, e)
		if p.Total != 1 || p.Items[0].ID != id2 {
			t.Fatal("folder boundary or playlist permission failure")
		}
		if _, e = r.Track(ctx, listener.ID, id); !errors.Is(e, domain.ErrNotFound) {
			t.Fatal("excluded direct ID accessible")
		}
		if e = r.Like(ctx, listener.ID, id, true); !errors.Is(e, domain.ErrNotFound) {
			t.Fatal("excluded like allowed")
		}
		if e = r.RecordPlay(ctx, listener.ID, id, "another-play-event"); !errors.Is(e, domain.ErrNotFound) {
			t.Fatal("excluded history write allowed")
		}
		albums, e := r.Albums(ctx, listener.ID, "", 100, 0)
		must(t, e)
		if len(albums) != 1 || albums[0].ID != "album-two" {
			t.Fatal("hidden albums/counts leaked")
		}
		artists, e := r.Artists(ctx, listener.ID, "", 100, 0)
		must(t, e)
		if len(artists) != 1 || artists[0].Tracks != 1 {
			t.Fatal("hidden artist counts leaked")
		}
		_, e = r.CreateExclusion(ctx, domain.Exclusion{GroupID: g2.ID, Kind: "album", Target: "album-two"})
		must(t, e)
		p, e = r.Tracks(ctx, listener.ID, domain.Query{Limit: 100})
		must(t, e)
		if p.Total != 0 {
			t.Fatal("any group exclusion must win")
		}
		must(t, r.DeleteExclusion(ctx, ex.ID))
		p, e = r.Tracks(ctx, listener.ID, domain.Query{Collection: "likes", Limit: 100})
		must(t, e)
		if p.Total != 1 {
			t.Fatal("personal likes missing")
		}
		p, e = r.Tracks(ctx, listener.ID, domain.Query{Collection: "history", Limit: 100})
		must(t, e)
		if p.Total != 1 {
			t.Fatal("history or idempotency failed")
		}
		_, e = r.CreateExclusion(ctx, domain.Exclusion{GroupID: g.ID, Kind: "track", Target: id})
		must(t, e)
		p, e = r.Tracks(ctx, listener.ID, domain.Query{Limit: 100})
		must(t, e)
		if p.Total != 0 {
			t.Fatal("track exclusions failed")
		}
		p, e = r.Tracks(ctx, admin.ID, domain.Query{Limit: 1, Offset: 1})
		must(t, e)
		if p.Total != 2 || len(p.Items) != 1 {
			t.Fatal("pagination failed")
		}
		must(t, r.SaveSession(ctx, "hashed-token", listener.ID, "csrf", time.Now().Add(time.Hour), listener.Password))
		s, e := r.Session(ctx, "hashed-token")
		must(t, e)
		if s.User.ID != listener.ID {
			t.Fatal("session mismatch")
		}
		must(t, r.RevokeSessions(ctx, listener.ID))
		_, e = r.Session(ctx, "hashed-token")
		if !errors.Is(e, domain.ErrNotFound) {
			t.Fatal("session revocation failed")
		}
		must(t, r.MarkSeen(ctx, a.Path, "scan3"))
		must(t, r.FinishRoot(ctx, "/music", "scan3"))
		p, e = r.Tracks(ctx, admin.ID, domain.Query{Limit: 100})
		must(t, e)
		if p.Total != 1 {
			t.Fatal("removed file not marked unavailable")
		}
	})
}
func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
