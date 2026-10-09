// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"testing"
)

func TestTrackByPathUsesAcceptedMetadata(t *testing.T) {
	store, _ := fixture(t)
	ctx := context.Background()
	track := domain.Track{Path: "/music/missing.mp3", Root: "/music", Title: "Song", Artist: "Unknown artist", Album: "Album", AlbumArtist: "Artist", MIME: "audio/mpeg"}
	id, err := store.UpsertTrack(ctx, track, "scan")
	if err != nil {
		t.Fatal(err)
	}
	for field, value := range map[string]string{"artist": "Correct artist", "artwork": "/art/accepted.jpg"} {
		if err = store.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: field, Value: value, Source: "test"}); err != nil {
			t.Fatal(err)
		}
	}
	suggestions, err := store.Suggestions(ctx, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, suggestion := range suggestions {
		if err = store.ResolveSuggestion(ctx, suggestion.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	saved, err := store.TrackByPath(ctx, track.Path)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Artist != "Correct artist" || saved.ArtPath != "/art/accepted.jpg" {
		t.Fatalf("accepted fields ignored: %+v", saved)
	}
	if _, err = store.TrackByPath(ctx, "/music/new.mp3"); err != domain.ErrNotFound {
		t.Fatalf("missing path: %v", err)
	}
}
