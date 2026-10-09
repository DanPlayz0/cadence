// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestArtistProfileSources(t *testing.T) {
	calls := 0
	e := Enricher{UserAgent: "Cadence test/contact", Client: &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		body := ""
		switch req.URL.Hostname() {
		case "musicbrainz.org":
			body = `{"name":"Example","type":"Group","country":"GB","genres":[{"name":"rock"},{"name":"rock"}],"relations":[{"type":"official homepage","url":{"resource":"https://example.com"}},{"type":"bad","url":{"resource":"javascript:alert(1)"}},{"type":"wikidata","url":{"resource":"https://www.wikidata.org/wiki/Q123"}}]}`
		case "www.wikidata.org":
			body = `{"entities":{"Q123":{"sitelinks":{"enwiki":{"title":"Example band"}}}}}`
		case "en.wikipedia.org":
			body = `{"query":{"pages":{"1":{"extract":"Example biography","pageimage":"Example.jpg","thumbnail":{"source":"https://upload.wikimedia.org/wikipedia/commons/example.jpg"}}}}}`
		default:
			t.Fatalf("unexpected host %s", req.URL.Hostname())
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}}
	profile, err := e.FetchArtistProfile(context.Background(), "Example", "12345678-1234-1234-1234-123456789012")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 3 || profile.Biography != "Example biography" || profile.Image == "" || profile.ImageSource == "" || len(profile.Genres) != 1 || len(profile.Links) != 3 {
		t.Fatalf("profile %+v calls %d", profile, calls)
	}
}
func TestArtistProfileAmbiguity(t *testing.T) {
	for _, body := range []string{`{"artists":[]}`, `{"artists":[{"id":"1","name":"Example","score":100},{"id":"2","name":"Example","score":100}]}`} {
		e := Enricher{UserAgent: "Cadence test/contact", Client: &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		})}}
		if _, err := e.FetchArtistProfile(context.Background(), "Example", ""); err == nil {
			t.Fatal("unreliable match selected")
		}
	}
	e := Enricher{}
	if _, err := e.FetchArtistProfile(context.Background(), "Example", ""); err == nil {
		t.Fatal("unidentified external request allowed")
	}
	for _, raw := range []string{"javascript:alert(1)", "http://example.com", "https://user:pass@example.com"} {
		if safeArtistURL(raw) != "" {
			t.Fatal("unsafe link allowed")
		}
	}
}

func TestArtistProfileSearchAndPartialFailure(t *testing.T) {
	calls := 0
	e := Enricher{UserAgent: "Cadence test/contact", Client: &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		body := ""
		status := 200
		if req.URL.Path == "/ws/2/artist/" {
			body = `{"artists":[{"id":"12345678-1234-1234-1234-123456789012","name":"Example","score":100}]}`
		} else if req.URL.Hostname() == "musicbrainz.org" {
			body = `{"name":"Example","relations":[{"type":"wikipedia","url":{"resource":"https://en.wikipedia.org/wiki/Example"}}]}`
		} else {
			status = 503
			body = `{}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}}
	profile, err := e.FetchArtistProfile(context.Background(), "Example", "")
	if err != nil || profile.Name != "Example" || profile.Warning == "" || calls != 3 {
		t.Fatalf("partial profile %+v %v calls %d", profile, err, calls)
	}
	e.Client = &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", (2<<20)+1))), Header: make(http.Header)}, nil
	})}
	if _, err = e.FetchArtistProfile(context.Background(), "Example", "12345678-1234-1234-1234-123456789012"); err == nil {
		t.Fatal("oversized provider payload allowed")
	}
}
