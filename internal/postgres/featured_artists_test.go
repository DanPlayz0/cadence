// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"context"
	"net/url"
	"os"
	"reflect"
	"testing"

	"cadence/internal/domain"
	"cadence/internal/postgres"
)

func TestFeaturedArtistNames(t *testing.T) {
	_, conn := fixture(t)
	ctx := context.Background()
	cases := []struct {
		credit string
		want   []string
	}{
		{" Alec Benjamin\tfeat.\tAlessia Cara, Alec Benjamin featuring Guest ft. Alessia Cara, , ", []string{"Alec Benjamin", "Alessia Cara", "Guest"}},
		{"AC/DC, Florence & the Machine, Dan + Shay, Earth Wind and Fire, Little Feat", []string{"AC/DC", "Florence & the Machine", "Dan + Shay", "Earth Wind and Fire", "Little Feat"}},
		{"feat. Guest, A feat., Afeat. B, A feat.B", []string{"feat. Guest", "A feat.", "Afeat. B", "A feat.B"}},
		{" , , ", []string{"Unknown artist"}},
	}
	for _, marker := range []string{"feat.", "feat", "ft.", "ft", "featuring", "FEAT.", "Ft", "FeAtUrInG"} {
		cases = append(cases, struct {
			credit string
			want   []string
		}{"Alec Benjamin " + marker + " Alessia Cara", []string{"Alec Benjamin", "Alessia Cara"}})
	}
	for _, tc := range cases {
		t.Run(tc.credit, func(t *testing.T) {
			var got []string
			if err := conn.QueryRow(ctx, "SELECT artist_names($1)", tc.credit).Scan(&got); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFeaturedArtistMigration(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	// Restore the actual pre-upgrade function and index before inserting the credit.
	oldMigration, err := os.ReadFile("007_artist_credits.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, "DROP INDEX tracks_artist_names; DROP FUNCTION artist_names(text); DELETE FROM schema_migrations WHERE version=18"); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, string(oldMigration)); err != nil {
		t.Fatal(err)
	}
	user, err := repo.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	const credit = "Alec Benjamin feat. Alessia Cara"
	id, err := repo.UpsertTrack(ctx, domain.Track{Path: "/music/let-me-down-slowly.mp3", Root: "/music", Title: "Let Me Down Slowly", Artist: credit, Album: "Narrated for You", AlbumArtist: "Alec Benjamin"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.Artists(ctx, user.ID, "", 100, 0)
	if err != nil || len(before) != 1 || before[0].Name != credit {
		t.Fatal("pre-upgrade credit", before, err)
	}
	var schema string
	if err = conn.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	uri, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	q := uri.Query()
	q.Set("search_path", schema)
	uri.RawQuery = q.Encode()
	upgraded, err := postgres.Open(ctx, uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	artists, err := upgraded.Artists(ctx, user.ID, "", 100, 0)
	if err != nil || len(artists) != 2 {
		t.Fatal("upgraded artists", artists, err)
	}
	for _, artist := range artists {
		if (artist.Name != "Alec Benjamin" && artist.Name != "Alessia Cara") || artist.Tracks != 1 {
			t.Fatal("unexpected artist", artist)
		}
		tracks, e := upgraded.Tracks(ctx, user.ID, domain.Query{Artist: artist.Name, Limit: 100})
		if e != nil || tracks.Total != 1 || len(tracks.Items) != 1 || tracks.Items[0].ID != id || tracks.Items[0].Artist != credit {
			t.Fatal("track membership/source credit", tracks, e)
		}
		albums, e := upgraded.Albums(ctx, user.ID, "", artist.Name, 100, 0)
		if e != nil || len(albums) != 1 || albums[0].Title != "Narrated for You" {
			t.Fatal("album membership", albums, e)
		}
	}
	// Force the expression index to verify its stored values were rebuilt.
	if _, err = conn.Exec(ctx, "SET enable_seqscan=off"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = conn.QueryRow(ctx, "SELECT count(*) FROM tracks WHERE available AND artist_names(coalesce(overrides->>'artist',artist)) @> ARRAY['Alessia Cara']::text[]").Scan(&count); err != nil || count != 1 {
		t.Fatal("rebuilt index membership", count, err)
	}
	if err = conn.QueryRow(ctx, "SELECT count(*) FROM tracks WHERE available AND artist_names(coalesce(overrides->>'artist',artist)) @> ARRAY[$1]::text[]", credit).Scan(&count); err != nil || count != 0 {
		t.Fatal("stale combined index membership", count, err)
	}
}
