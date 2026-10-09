// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"fmt"
	"testing"
)

func TestBulkSuggestionsBeyondPageAndAtomicity(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	user, err := r.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	var first string
	for i := 0; i < 105; i++ {
		id, err := r.UpsertTrack(ctx, domain.Track{Path: fmt.Sprintf("/music/%d.mp3", i), Root: "/music", Title: "Original", Artist: "Original artist", AlbumID: "album", Number: 1}, "scan")
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = id
		}
		if err = r.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: "title", Value: fmt.Sprintf("New %d", i), Source: "administrator"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, v := range []domain.Suggestion{
		{TrackID: first, Field: "title", Value: "Latest title", Source: "administrator"},
		{TrackID: first, Field: "number", Value: "9", Source: "administrator"},
		{TrackID: first, Field: "artist", Value: "New artist", Source: "administrator"},
	} {
		if err = r.AddSuggestion(ctx, v); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = c.Exec(ctx, `UPDATE suggestions SET created='2000-01-01' WHERE track_id=$1 AND field='title' AND value!='Latest title'`, first); err != nil {
		t.Fatal(err)
	}
	page, err := r.Suggestions(ctx, 100, 0)
	if err != nil || len(page) != 100 {
		t.Fatal("page", err, len(page))
	}
	count, err := r.AcceptSuggestions(ctx, []string{"title", "number"})
	if err != nil || count != 107 {
		t.Fatal("accept all", err, count)
	}
	track, err := r.Track(ctx, user.ID, first)
	if err != nil || track.Title != "Latest title" || track.Number != 9 || track.Artist != "Original artist" {
		t.Fatal("field selection/conflict", err, track)
	}
	pending, err := r.Suggestions(ctx, 100, 0)
	if err != nil || len(pending) != 1 || pending[0].Field != "artist" {
		t.Fatal("unselected changes", err, pending)
	}
	count, err = r.AcceptSuggestions(ctx, []string{"title"})
	if err != nil || count != 0 {
		t.Fatal("idempotency", err, count)
	}
	if _, err = r.AcceptSuggestions(ctx, []string{"artist"}); err != nil {
		t.Fatal(err)
	}
	// An invalid imported numeric value forces the entire batch to roll back.
	for _, v := range []domain.Suggestion{{TrackID: first, Field: "title", Value: "Should roll back", Source: "test"}, {TrackID: first, Field: "number", Value: "invalid", Source: "test"}} {
		if err = r.AddSuggestion(ctx, v); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = r.AcceptSuggestions(ctx, []string{"title", "number"}); err == nil {
		t.Fatal("invalid batch accepted")
	}
	track, err = r.Track(ctx, user.ID, first)
	if err != nil || track.Title != "Latest title" || track.Number != 9 {
		t.Fatal("partial batch applied", err, track)
	}
	pending, err = r.Suggestions(ctx, 100, 0)
	if err != nil || len(pending) != 2 {
		t.Fatal("failed batch status changed", err, pending)
	}
}
