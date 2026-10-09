// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"cadence/internal/domain"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type suggestionRepo struct {
	domain.LibraryRepository
	values []domain.Suggestion
}

func (r *suggestionRepo) AddSuggestion(_ context.Context, v domain.Suggestion) error {
	r.values = append(r.values, v)
	return nil
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestEnrichmentOnlySuggests(t *testing.T) {
	r := &suggestionRepo{}
	calls := 0
	e := &Enricher{Repo: r, ArtDir: t.TempDir(), UserAgent: "Cadence test/contact", Client: &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.Header.Get("User-Agent") == "" {
			t.Fatal("missing identification")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"12345678-1234-1234-1234-123456789012","title":"Corrected album","date":"2020","artist-credit":[{"name":"Corrected artist"}]}`)), Header: make(http.Header)}, nil
	})}}
	track := domain.Track{ID: "track", AlbumID: "album", Album: "Original", AlbumArtist: "Original", ArtPath: "already-has-art"}
	tags := map[string]string{"musicbrainz_albumid": "12345678-1234-1234-1234-123456789012"}
	if err := e.Suggest(context.Background(), track, tags); err != nil {
		t.Fatal(err)
	}
	if len(r.values) != 3 || track.Album != "Original" {
		t.Fatal("enrichment must generate proposals without mutating extracted values")
	}
	if err := e.Suggest(context.Background(), track, tags); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("same album should reuse lookup")
	}
}
func TestEnrichmentNeedsIdentification(t *testing.T) {
	e := &Enricher{}
	if err := e.Suggest(context.Background(), domain.Track{Album: "Album"}, nil); err == nil {
		t.Fatal("anonymous lookup allowed")
	}
}

func TestSingleSkipsAlbumEnrichment(t *testing.T) {
	e := &Enricher{}
	if err := e.Suggest(context.Background(), domain.Track{Title: "Single", Artist: "Artist"}, nil); err != nil {
		t.Fatal("single should not attempt a release lookup", err)
	}
}
