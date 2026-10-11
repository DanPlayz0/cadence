// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

const catalogTestID = "12345678-1234-1234-1234-123456789012"

func TestCatalogNormalizationPaginationAndCache(t *testing.T) {
	calls := 0
	e := &Enricher{UserAgent: "Cadence tests/contact", Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("User-Agent") == "" || r.URL.Query().Get("offset") != "25" {
			t.Fatal("identification or pagination missing", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"count":26,"release-groups":[{"id":"` + catalogTestID + `","title":"Album","primary-type":"Album","artist-credit":[{"name":"First","joinphrase":" & "},{"artist":{"name":"Second"}}]}]}`))}, nil
	})}}
	page, err := e.CatalogSearch(context.Background(), "album", `artist:"test"`, 25, 25)
	if err != nil || page.Total != 26 || page.Offset != 25 || len(page.Items) != 1 || page.Items[0].Artist != "First & Second" || page.Items[0].Date != "" || page.Items[0].Kind != "album" {
		t.Fatalf("%+v %v", page, err)
	}
	page.Items[0].Name = "mutated"
	page, err = e.CatalogSearch(context.Background(), "album", `artist:"test"`, 25, 25)
	if err != nil || calls != 1 || page.Items[0].Name != "Album" {
		t.Fatal("cache reuse/isolation", calls, page, err)
	}
	e.mu.Lock()
	for k, v := range e.catalogCache {
		v.expires = time.Now().Add(-time.Second)
		e.catalogCache[k] = v
	}
	e.last = time.Time{}
	e.mu.Unlock()
	_, err = e.CatalogSearch(context.Background(), "album", `artist:"test"`, 25, 25)
	if err != nil || calls != 2 {
		t.Fatal("expired cache used", calls, err)
	}
}
func TestCatalogKindsAndOverview(t *testing.T) {
	e := &Enricher{UserAgent: "test/contact", Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		body := `{"count":2,"artists":[{"id":"` + catalogTestID + `","name":"Same name","disambiguation":"UK band"},{"id":"other","name":"Same name","disambiguation":"US singer"}]}`
		if strings.Contains(r.URL.Path, "recording") {
			body = `{"count":1,"recordings":[{"id":"` + catalogTestID + `","title":"Song","artist-credit":[{"name":"Artist"}]}]}`
		}
		if strings.Contains(r.URL.Path, "release-group/") {
			body = `{"id":"` + catalogTestID + `","title":"Record","first-release-date":"1999","primary-type":"EP","artist-credit":[{"name":"Artist"}]}`
		}
		if r.URL.Query().Get("artist") != "" {
			body = `{"release-group-count":1,"release-groups":[{"id":"` + catalogTestID + `","title":"Record"}]}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}}
	a, err := e.CatalogSearch(context.Background(), "artist", "Same name", 25, 0)
	if err != nil || len(a.Items) != 2 || a.Items[0].Disambiguation == a.Items[1].Disambiguation {
		t.Fatal(a, err)
	}
	e.last = time.Time{}
	s, err := e.CatalogSearch(context.Background(), "song", "Song", 25, 0)
	if err != nil || s.Items[0].Artist != "Artist" || s.Items[0].Kind != "song" {
		t.Fatal(s, err)
	}
	e.last = time.Time{}
	albums, err := e.CatalogArtistAlbums(context.Background(), catalogTestID, 25, 0)
	if err != nil || albums.Total != 1 || albums.Items[0].Name != "Record" {
		t.Fatal(albums, err)
	}
	e.last = time.Time{}
	album, err := e.CatalogAlbum(context.Background(), catalogTestID)
	if err != nil || album.Date != "1999" || album.ReleaseType != "EP" {
		t.Fatal(album, err)
	}
}
func TestCatalogFailuresAndBounds(t *testing.T) {
	if _, err := (&Enricher{}).CatalogSearch(context.Background(), "album", "test", 25, 0); !errors.Is(err, ErrCatalogUnavailable) {
		t.Fatal(err)
	}
	for _, body := range []string{"invalid json", strings.Repeat("x", (2<<20)+1)} {
		e := &Enricher{UserAgent: "test", Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}}
		if _, err := e.CatalogSearch(context.Background(), "album", "test", 25, 0); err == nil {
			t.Fatal("invalid response accepted")
		}
		if len(e.catalogCache) != 0 {
			t.Fatal("cached failed response")
		}
	}
	e := &Enricher{UserAgent: "test", Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}}
	if _, err := e.CatalogSearch(context.Background(), "album", "test", 25, 0); err == nil {
		t.Fatal("provider failure accepted")
	}
	if _, err := e.CatalogAlbum(context.Background(), "../bad"); err == nil {
		t.Fatal("invalid ID")
	}
	if _, err := e.CatalogSearch(context.Background(), "unknown", "test", 25, 0); err == nil {
		t.Fatal("invalid type")
	}
}
func TestCatalogSharesLimiterAndHonorsQueuedCancellation(t *testing.T) {
	var starts []time.Time
	e := &Enricher{UserAgent: "test", Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		starts = append(starts, time.Now())
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"count":0,"release-groups":[]}`))}, nil
	})}}
	res, err := e.get(context.Background(), "https://musicbrainz.org/ws/2/artist/test")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if _, err = e.CatalogSearch(context.Background(), "album", "test", 25, 0); err != nil {
		t.Fatal(err)
	}
	if starts[1].Sub(starts[0]) < 950*time.Millisecond {
		t.Fatal("discovery bypassed metadata limiter")
	}
	e.requestGate <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err = e.CatalogSearch(ctx, "album", "uncached", 25, 0); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("queued cancellation", err)
	}
	<-e.requestGate
}
func TestCatalogCacheBound(t *testing.T) {
	e := &Enricher{UserAgent: "test", catalogCache: map[string]catalogCacheEntry{}, Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"count":0}`))}, nil
	})}}
	for i := 0; i < 256; i++ {
		e.catalogCache[string(rune(i))] = catalogCacheEntry{data: []byte(`{}`), expires: time.Now().Add(time.Minute)}
	}
	if _, err := e.CatalogSearch(context.Background(), "album", "test", 25, 0); err != nil || len(e.catalogCache) != 256 {
		t.Fatal("cache bound", err, len(e.catalogCache))
	}
}

func TestCatalogProviderHonorsRequestDeadline(t *testing.T) {
	started := false
	e := &Enricher{UserAgent: "test/contact", Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		started = true
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := e.CatalogSearch(ctx, "album", "test", 25, 0)
	if !started || !errors.Is(err, context.DeadlineExceeded) || len(e.catalogCache) != 0 {
		t.Fatal("provider timeout must cancel transport without caching", started, err)
	}
}
