// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestBulkMetadataFilterAndClearingAlbums(t *testing.T) {
	repo, _ := fixture(t)
	ctx := context.Background()
	user, err := repo.CreateUser(ctx, domain.User{Username: "bulk", DisplayName: "Bulk", Password: "hash", Admin: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for i := 0; i < 30; i++ {
		album := "music"
		if i%2 == 0 {
			album = "Music"
		}
		id, err := repo.UpsertTrack(ctx, domain.Track{Path: fmt.Sprintf("/music/%02d.mp3", i), Root: "/music", Title: fmt.Sprintf("Song %02d", i), Artist: "Artist", Album: album, AlbumArtist: "Artist"}, "scan")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err = repo.AddSuggestion(ctx, domain.Suggestion{TrackID: ids[0], Field: "album", Value: "Other", Source: "test"}); err != nil {
		t.Fatal(err)
	}
	suggestions, _ := repo.TrackSuggestions(ctx, ids[0])
	if err = repo.ResolveSuggestion(ctx, suggestions[0].ID, true); err != nil {
		t.Fatal(err)
	}
	group, err := repo.CreateGroup(ctx, "Restricted")
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.SetGroups(ctx, user.ID, []string{group.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CreateExclusion(ctx, domain.Exclusion{GroupID: group.ID, Kind: "track", Target: ids[1]}); err != nil {
		t.Fatal(err)
	}
	matches, err := repo.MetadataMatches(ctx, user.ID, "album", "MUSIC", 25, 0)
	if err != nil || matches.Total != 28 || len(matches.Items) != 25 {
		t.Fatalf("preview: %v %v", matches, err)
	}
	if _, err = repo.BulkMetadataSuggestions(ctx, user.ID, "album", "music", "", 29); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale preview not rejected")
	}
	pending, _ := repo.Suggestions(ctx, 100, 0)
	if len(pending) != 0 {
		t.Fatal("stale preview created partial suggestions")
	}
	saved, err := repo.BulkMetadataSuggestions(ctx, user.ID, "album", "music", "", 28)
	if err != nil || saved != 28 {
		t.Fatalf("bulk save: %d %v", saved, err)
	}
	unchanged, _ := repo.Track(ctx, user.ID, ids[2])
	if unchanged.Album == "" {
		t.Fatal("suggestions applied before review")
	}
	saved, err = repo.BulkMetadataSuggestions(ctx, user.ID, "album", "music", "", 28)
	if err != nil || saved != 0 {
		t.Fatal("duplicate suggestions were created")
	}
	accepted, err := repo.AcceptSuggestions(ctx, []string{"album"})
	if err != nil || accepted != 28 {
		t.Fatalf("accept: %d %v", accepted, err)
	}
	empty, err := repo.MetadataMatches(ctx, user.ID, "album", "", 25, 0)
	if err != nil || empty.Total != 28 {
		t.Fatal("empty album filter mismatch")
	}
	for _, track := range empty.Items {
		if !track.Single || track.Album != "" || track.AlbumArtist != "" {
			t.Fatal("cleared albums must appear as singles")
		}
	}
	other, _ := repo.Track(ctx, user.ID, ids[0])
	if other.Album != "Other" {
		t.Fatal("effective override was ignored")
	}
	if err = repo.ClearOverride(ctx, ids[2], "album"); err != nil {
		t.Fatal(err)
	}
	saved, err = repo.BulkMetadataSuggestions(ctx, user.ID, "album", "Music", "", 1)
	if err != nil || saved != 1 {
		t.Fatal("resolved bulk suggestion could not be reopened")
	}
	if _, err = repo.MetadataMatches(ctx, user.ID, "album; DROP TABLE tracks", "", 25, 0); err == nil {
		t.Fatal("unrecognized field accepted")
	}
}
