// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"testing"
)

func TestArtistRoleCredits(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	user, err := repo.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	track := domain.Track{Path: "/music/song.mp3", Root: "/music", Title: "That's Not How This Works", Artist: "Charlie Puth"}
	id, err := repo.UpsertTrack(ctx, track, "scan")
	if err != nil {
		t.Fatal(err)
	}
	for field, value := range map[string]string{"featuredArtists": "Dan + Shay, Charlie Puth", "videoGuests": "Sabrina Carpenter"} {
		if err = repo.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: field, Value: value, Source: "administrator"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = repo.AcceptSuggestions(ctx, []string{"featuredArtists", "videoGuests"}); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.UpsertTrack(ctx, track, "rescan"); err != nil {
		t.Fatal(err)
	}
	saved, err := repo.Track(ctx, user.ID, id)
	if err != nil || saved.FeaturedArtists != "Dan + Shay, Charlie Puth" || saved.VideoGuests != "Sabrina Carpenter" {
		t.Fatal(saved, err)
	}
	for _, name := range []string{"Charlie Puth", "Dan + Shay", "Sabrina Carpenter"} {
		page, e := repo.Tracks(ctx, user.ID, domain.Query{Artist: name, Limit: 10})
		if e != nil || page.Total != 1 {
			t.Fatal(name, page, e)
		}
		page, e = repo.Tracks(ctx, user.ID, domain.Query{Search: name, Limit: 10})
		if e != nil || page.Total != 1 {
			t.Fatal("search", name, page, e)
		}
	}
	if err = repo.SaveArtistProfile(ctx, "Sabrina Carpenter", domain.ArtistProfile{Image: "https://example.com/sabrina.jpg"}); err != nil {
		t.Fatal(err)
	}
	artists, err := repo.Artists(ctx, user.ID, "", 10, 0)
	if err != nil || len(artists) != 3 {
		t.Fatal(artists, err)
	}
	for _, artist := range artists {
		if artist.Tracks != 1 {
			t.Fatal("duplicate credit counted twice", artist)
		}
		if artist.Name == "Sabrina Carpenter" && artist.Image == "" {
			t.Fatal("missing avatar")
		}
	}
	if _, err = conn.Exec(ctx, "UPDATE tracks SET available=false WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	artists, err = repo.Artists(ctx, user.ID, "", 10, 0)
	if err != nil || len(artists) != 0 {
		t.Fatal("hidden role credits leaked", artists, err)
	}
}
