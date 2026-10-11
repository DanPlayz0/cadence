// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"cadence/internal/domain"
	"cadence/internal/library"
)

func TestArtistSplitEnrichmentPersistence(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	if err := repo.SetEnrichment(ctx, true); err != nil {
		t.Fatal(err)
	}
	user, err := repo.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	track := domain.Track{Path: "/music/thrift-shop.mp3", Root: "/music", Title: "Thrift Shop", Artist: "MACKLEMORE & RYAN LEWIS", Album: "The Heist", AlbumArtist: "MACKLEMORE & RYAN LEWIS"}
	track.ID, err = repo.UpsertTrack(ctx, track, "scan")
	if err != nil {
		t.Fatal(err)
	}
	enricher := &library.Enricher{Repo: repo, UserAgent: "Cadence test/contact", Client: &http.Client{Transport: artistTransport(func(req *http.Request) (*http.Response, error) {
		body := `{"releases":[]}`
		if req.URL.Path == "/ws/2/artist/" {
			body = `{"artists":[{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","name":"Macklemore & Ryan Lewis","type":"Group","score":100}]}`
		} else if req.URL.Query().Get("inc") == "artist-rels" {
			body = `{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","type":"Group","relations":[{"type":"member of band","direction":"backward","artist":{"id":"b6d7ec94-830c-44dd-b699-ce66556b7e55","name":"Macklemore","type":"Person"}},{"type":"member of band","direction":"backward","artist":{"id":"12345678-1234-1234-1234-123456789012","name":"Ryan Lewis","type":"Person"}}]}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}}
	if err = enricher.Suggest(ctx, track, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.UpsertTrack(ctx, track, "rescan"); err != nil {
		t.Fatal(err)
	}
	saved, err := repo.Track(ctx, user.ID, track.ID)
	if err != nil || saved.Artist != "Macklemore, Ryan Lewis" || saved.AlbumArtist != track.AlbumArtist {
		t.Fatal("split/album preservation", saved, err)
	}
	for _, name := range []string{"Macklemore", "Ryan Lewis"} {
		page, e := repo.Tracks(ctx, user.ID, domain.Query{Artist: name, Limit: 10})
		if e != nil || page.Total != 1 {
			t.Fatal("track membership", name, page, e)
		}
		albums, e := repo.Albums(ctx, user.ID, "", name, 10, 0)
		if e != nil || len(albums) != 1 || albums[0].Title != "The Heist" {
			t.Fatal("album membership", name, albums, e)
		}
	}
	artists, err := repo.Artists(ctx, user.ID, "", 10, 0)
	if err != nil || len(artists) != 2 {
		t.Fatal("artist listing", artists, err)
	}
	var original, status, source string
	if err = conn.QueryRow(ctx, "SELECT artist FROM tracks WHERE id=$1", track.ID).Scan(&original); err != nil || original != track.Artist {
		t.Fatal("source tags changed", original, err)
	}
	if err = conn.QueryRow(ctx, "SELECT status,source FROM suggestions WHERE track_id=$1 AND field='artist'", track.ID).Scan(&status, &source); err != nil || status != "accepted" || !strings.Contains(source, "97b226c8-7140-4da3-91ac-15e62e131a81") {
		t.Fatal("missing accepted provenance", status, source, err)
	}
	if err = enricher.Suggest(ctx, track, nil); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = conn.QueryRow(ctx, "SELECT count(*) FROM suggestions WHERE track_id=$1 AND field='artist'", track.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("repeat scan duplicated metadata", count, err)
	}
}

func TestAutomaticArtistSplitGuards(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	for _, scenario := range []string{"disabled", "manual override", "changed source", "unavailable"} {
		t.Run(scenario, func(t *testing.T) {
			if err := repo.SetEnrichment(ctx, scenario != "disabled"); err != nil {
				t.Fatal(err)
			}
			id, err := repo.UpsertTrack(ctx, domain.Track{Path: "/music/" + scenario + ".mp3", Root: "/music", Title: "Song", Artist: "A & B"}, "scan")
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "manual override":
				_, err = conn.Exec(ctx, `UPDATE tracks SET overrides='{"artist":"My custom credit"}' WHERE id=$1`, id)
			case "changed source":
				_, err = conn.Exec(ctx, "UPDATE tracks SET artist='Different artist' WHERE id=$1", id)
			case "unavailable":
				_, err = conn.Exec(ctx, "UPDATE tracks SET available=false WHERE id=$1", id)
			}
			if err != nil {
				t.Fatal(err)
			}
			if applied, err := repo.ApplyConfirmedArtistSplit(ctx, id, "A & B", "A, B", "MusicBrainz confirmed artist split test"); err != nil || applied {
				t.Fatal("unsafe split applied", applied, err)
			}
			var accepted int
			if err := conn.QueryRow(ctx, "SELECT count(*) FROM suggestions WHERE track_id=$1", id).Scan(&accepted); err != nil || accepted != 0 {
				t.Fatal("skipped split recorded", accepted, err)
			}
		})
	}
}
