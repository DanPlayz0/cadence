// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"errors"
	"testing"
)

func TestTrackPlaylistMembership(t *testing.T) {
	r, _ := fixture(t)
	ctx := context.Background()
	owner, err := r.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	other, err := r.CreateUser(ctx, domain.User{Username: "other", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	track, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/song.mp3", Root: "/music", Title: "Song"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	own, err := r.CreatePlaylist(ctx, owner.ID, "Own", "music")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := r.CreatePlaylist(ctx, other.ID, "Foreign", "music")
	if err != nil {
		t.Fatal(err)
	}
	ids, err := r.TrackPlaylistIDs(ctx, owner.ID, track)
	if err != nil || ids == nil || len(ids) != 0 {
		t.Fatal("empty membership", ids, err)
	}
	if err = r.AddPlaylistTrack(ctx, owner.ID, own.ID, track); err != nil {
		t.Fatal(err)
	}
	if err = r.AddPlaylistTrack(ctx, other.ID, foreign.ID, track); err != nil {
		t.Fatal(err)
	}
	ids, err = r.TrackPlaylistIDs(ctx, owner.ID, track)
	if err != nil || len(ids) != 1 || ids[0] != own.ID {
		t.Fatal("user isolation", ids, err)
	}
	if err = r.RemovePlaylistTrack(ctx, owner.ID, own.ID, track); err != nil {
		t.Fatal(err)
	}
	ids, err = r.TrackPlaylistIDs(ctx, owner.ID, track)
	if err != nil || len(ids) != 0 {
		t.Fatal("removed membership", ids, err)
	}
	if _, err = r.TrackPlaylistIDs(ctx, owner.ID, "missing"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("missing track", err)
	}
	emptyLibraries(t, r)
	if _, err = r.TrackPlaylistIDs(ctx, owner.ID, track); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("inaccessible track", err)
	}
}
