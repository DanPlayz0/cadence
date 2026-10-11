// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/postgres"
	"context"
	"net/url"
	"os"
	"testing"
)

func TestIndividualArtistCredits(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	u, err := r.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for i, credit := range []string{" A, B, A, ,C\t", "B", "AC/DC, 音楽 & Friends", "Anna", " , ", "Earth & Wind feat. Guest"} {
		id, e := r.UpsertTrack(ctx, domain.Track{Path: "/music/" + string(rune('a'+i)) + ".mp3", Root: "/music", Title: "Song", Artist: credit}, "scan")
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	check := func() {
		t.Helper()
		artists, e := r.Artists(ctx, u.ID, "", 100, 0)
		if e != nil {
			t.Fatal(e)
		}
		counts := map[string]int{}
		for _, artist := range artists {
			counts[artist.Name] = artist.Tracks
		}
		for name, want := range map[string]int{"A": 1, "B": 2, "C": 1, "AC/DC": 1, "音楽 & Friends": 1, "Anna": 1, "Unknown artist": 1, "Earth & Wind": 1, "Guest": 1} {
			if counts[name] != want {
				t.Fatal(name, want, counts)
			}
		}
		if len(counts) != 9 {
			t.Fatal(counts)
		}
	}
	check()
	for _, name := range []string{"A", "C", "AC/DC", "音楽 & Friends"} {
		page, e := r.Tracks(ctx, u.ID, domain.Query{Artist: name, Limit: 100})
		if e != nil || page.Total != 1 {
			t.Fatal("individual filter", name, page.Total, e)
		}
	}
	if page, e := r.Tracks(ctx, u.ID, domain.Query{Artist: "Ann", Limit: 100}); e != nil || page.Total != 0 {
		t.Fatal("substring filter", page, e)
	}
	page, e := r.Tracks(ctx, u.ID, domain.Query{Artist: "B", Limit: 1, Offset: 1})
	if e != nil || page.Total != 2 || len(page.Items) != 1 {
		t.Fatal("artist pagination", page, e)
	}
	// Existing catalogs gain individual membership through the migration, without a scan.
	if _, err = c.Exec(ctx, "DROP INDEX tracks_artist_names; DROP FUNCTION artist_names(text); DELETE FROM schema_migrations WHERE version IN (7,18)"); err != nil {
		t.Fatal(err)
	}
	var schema string
	if err = c.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	uri, _ := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	q := uri.Query()
	q.Set("search_path", schema)
	uri.RawQuery = q.Encode()
	upgraded, err := postgres.Open(ctx, uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	r = upgraded
	check()
	if err = r.AddSuggestion(ctx, domain.Suggestion{TrackID: ids[0], Field: "artist", Value: " B, New Artist, B ", Source: "test"}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.AcceptSuggestions(ctx, []string{"artist"}); err != nil {
		t.Fatal(err)
	}
	if page, e := r.Tracks(ctx, u.ID, domain.Query{Artist: "A", Limit: 100}); e != nil || page.Total != 0 {
		t.Fatal("old override membership", page, e)
	}
	if page, e := r.Tracks(ctx, u.ID, domain.Query{Artist: "New Artist", Limit: 100}); e != nil || page.Total != 1 {
		t.Fatal("new override membership", page, e)
	}
	if err = r.ClearOverride(ctx, ids[0], "artist"); err != nil {
		t.Fatal(err)
	}
	check()
	group, err := r.CreateGroup(ctx, "Restricted")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.SetGroups(ctx, u.ID, []string{group.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.CreateExclusion(ctx, domain.Exclusion{GroupID: group.ID, Kind: "track", Target: ids[0]}); err != nil {
		t.Fatal(err)
	}
	artists, err := r.Artists(ctx, u.ID, "", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range artists {
		if a.Name == "A" || a.Name == "C" || a.Name == "B" && a.Tracks != 1 {
			t.Fatal("excluded membership/count", artists)
		}
	}
	if page, e := r.Tracks(ctx, u.ID, domain.Query{Artist: "C", Limit: 100}); e != nil || page.Total != 0 {
		t.Fatal("excluded artist page", page, e)
	}
}
