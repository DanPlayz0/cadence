// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"testing"
)

func TestArtistAlbums(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	user, err := repo.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	tracks := []domain.Track{
		{Path: "/music/a.mp3", AlbumID: "a", Album: "First", Artist: "Example, Guest", AlbumArtist: "Example", ArtPath: "/art/a.jpg"},
		{Path: "/music/b.mp3", AlbumID: "a", Album: "First", Artist: "Other", AlbumArtist: "Example"},
		{Path: "/music/c.mp3", AlbumID: "b", Album: "Second", Artist: "Example", AlbumArtist: "Example"},
		{Path: "/music/d.mp3", AlbumID: "c", Album: "Third", Artist: "Example tribute", AlbumArtist: "Example tribute"},
		{Path: "/music/e.mp3", AlbumID: "d", Album: "Fourth", Artist: "Original", AlbumArtist: "Original"},
	}
	ids := []string{}
	for _, track := range tracks {
		track.Root = "/music"
		track.Title = "Song"
		id, e := repo.UpsertTrack(ctx, track, "scan")
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	if _, err = conn.Exec(ctx, `UPDATE tracks SET overrides='{"artist":"Example"}' WHERE id=$1`, ids[4]); err != nil {
		t.Fatal(err)
	}
	albums, err := repo.Albums(ctx, user.ID, "", "Example", 100, 0)
	if err != nil || len(albums) != 3 {
		t.Fatalf("albums %+v: %v", albums, err)
	}
	if albums[0].ID != "a" || albums[0].Tracks != 1 || albums[0].CoverID != ids[0] {
		t.Fatalf("matching tracks/cover %+v", albums[0])
	}
	guest, err := repo.Albums(ctx, user.ID, "", "Guest", 100, 0)
	if err != nil || len(guest) != 1 || guest[0].ID != "a" {
		t.Fatalf("collaboration %+v %v", guest, err)
	}
	page, err := repo.Albums(ctx, user.ID, "", "Example", 1, 1)
	if err != nil || len(page) != 1 || page[0].ID != albums[1].ID {
		t.Fatalf("pagination %+v %v", page, err)
	}
	group, err := repo.CreateGroup(ctx, "restricted")
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.SetGroups(ctx, user.ID, []string{group.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CreateExclusion(ctx, domain.Exclusion{GroupID: group.ID, Kind: "track", Target: ids[0]}); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, `UPDATE tracks SET available=false WHERE id=$1`, ids[2]); err != nil {
		t.Fatal(err)
	}
	albums, err = repo.Albums(ctx, user.ID, "", "Example", 100, 0)
	if err != nil || len(albums) != 1 || albums[0].ID != "d" {
		t.Fatalf("permissions/availability %+v %v", albums, err)
	}
}
