// SPDX-License-Identifier: GPL-2.0-or-later
package lyrics

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"cadence/internal/domain"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
func TestLookupFallbackCacheAndMetadata(t *testing.T) {
	c := New()
	calls := 0
	c.HTTP = &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		q := r.URL.Query()
		if r.URL.Host != "lrclib.net" || q.Get("track_name") != "Song & 音" || q.Get("artist_name") != "Artist" || q.Get("duration") != "180.00" || r.Header.Get("User-Agent") == "" {
			t.Fatal("request", r.URL)
		}
		if q.Has("album_name") {
			return response(404, `{}`), nil
		}
		return response(200, `{"syncedLyrics":"[00:01]Sample","plainLyrics":"Sample"}`), nil
	})}
	track := domain.Track{Title: "Song & 音", Artist: "Artist", Album: "folder", Duration: 180}
	result, err := c.Lookup(context.Background(), track)
	if err != nil || !result.Found || result.Synced == "" || calls != 2 {
		t.Fatal(result, err, calls)
	}
	if _, err = c.Lookup(context.Background(), track); err != nil || calls != 2 {
		t.Fatal("cache missed", err, calls)
	}
	track.Title = "Changed"
	c.HTTP = &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) { calls++; return response(404, `{}`), nil })}
	c.next = time.Time{}
	result, err = c.Lookup(context.Background(), track)
	if err != nil || result.Found {
		t.Fatal("missing", result, err)
	}
	before := calls
	if _, err = c.Lookup(context.Background(), track); err != nil || calls != before {
		t.Fatal("missing cache", err, calls)
	}
}
func TestProviderBoundsAndBackoff(t *testing.T) {
	for _, body := range []string{`not-json`, strings.Repeat("x", (1<<20)+1), `{"plainLyrics":"` + strings.Repeat("x", (256<<10)+1) + `"}`} {
		c := New()
		c.HTTP = &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) { return response(200, body), nil })}
		if _, err := c.Lookup(context.Background(), domain.Track{Title: "Song", Artist: "Artist", Duration: 100}); err == nil {
			t.Fatal("invalid response accepted")
		}
	}
	c := New()
	calls := 0
	c.HTTP = &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		r := response(429, "limited")
		r.Header.Set("Retry-After", "60")
		return r, nil
	})}
	track := domain.Track{Title: "Song", Artist: "Artist", Duration: 100}
	if _, err := c.Lookup(context.Background(), track); err == nil {
		t.Fatal("rate limit accepted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := c.Lookup(ctx, track); err == nil || calls != 1 {
		t.Fatal("backoff not honored", err, calls)
	}
}
func TestInstrumentalAndUnusableMetadata(t *testing.T) {
	c := New()
	calls := 0
	c.HTTP = &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return response(200, `{"instrumental":true}`), nil
	})}
	for _, track := range []domain.Track{{Title: "Song", Artist: "Unknown artist", Duration: 100}, {Title: "Song", Artist: "Artist", Duration: 0}, {Title: "Song", Artist: "Artist", Duration: 4000}} {
		if _, err := c.Lookup(context.Background(), track); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 0 {
		t.Fatal("unusable metadata requested")
	}
	result, err := c.Lookup(context.Background(), domain.Track{Title: "Song", Artist: "Artist", Duration: 100})
	if err != nil || !result.Found || !result.Instrumental {
		t.Fatal(result, err)
	}
}

func TestConcurrentLookupsShareCachedResponse(t *testing.T) {
	c := New()
	calls := 0
	c.HTTP = &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return response(200, `{"plainLyrics":"Sample"}`), nil
	})}
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			result, err := c.Lookup(context.Background(), domain.Track{Title: "Song", Artist: "Artist", Duration: 100})
			if err != nil || !result.Found {
				t.Error(result, err)
			}
		}()
	}
	group.Wait()
	if calls != 1 {
		t.Fatal("duplicate provider requests", calls)
	}
}
