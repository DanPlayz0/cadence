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

	"cadence/internal/domain"
)

const duoSearch = `{"artists":[{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","name":"Macklemore & Ryan Lewis","type":"Group","score":100}]}`
const duoMembers = `{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","type":"Group","relations":[{"type":"member of band","direction":"backward","artist":{"id":"b6d7ec94-830c-44dd-b699-ce66556b7e55","name":"Macklemore","type":"Person"}},{"type":"member of band","direction":"backward","artist":{"id":"12345678-1234-1234-1234-123456789012","name":"Ryan Lewis","type":"Person"}}]}`

type splitRepo struct {
	suggestionRepo
	credits []string
	sources []string
	err     error
}

func (r *splitRepo) ApplyConfirmedArtistSplit(_ context.Context, id, expected, value, source string) (bool, error) {
	if id == "" || expected == "" {
		panic("missing track identity/source credit")
	}
	r.credits = append(r.credits, value)
	r.sources = append(r.sources, source)
	return r.err == nil, r.err
}

func creditTestEnricher(t *testing.T, response func(*http.Request) (string, int)) (*Enricher, *splitRepo, *int) {
	t.Helper()
	repo := &splitRepo{}
	calls := new(int)
	e := &Enricher{Repo: repo, UserAgent: "Cadence test/contact"}
	e.Client = &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		*calls++
		if req.Header.Get("User-Agent") != e.UserAgent || req.URL.Host != "musicbrainz.org" {
			t.Fatalf("unexpected metadata request: %s", req.URL)
		}
		body, status := response(req)
		// No actual network traffic in this fixture; avoid real rate-limit waits.
		e.last = time.Now().Add(-time.Second)
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	return e, repo, calls
}

func TestConfirmedDuoArtistSplit(t *testing.T) {
	e, repo, calls := creditTestEnricher(t, func(req *http.Request) (string, int) {
		if req.URL.Path == "/ws/2/artist/" {
			return duoSearch, 200
		}
		if req.URL.Query().Get("inc") != "artist-rels" {
			t.Fatal("missing membership lookup")
		}
		return duoMembers, 200
	})
	track := domain.Track{ID: "track", Artist: "MACKLEMORE & RYAN LEWIS feat. Guest, Macklemore"}
	for range 2 {
		if err := e.Suggest(context.Background(), track, nil); err != nil {
			t.Fatal(err)
		}
	}
	if len(repo.credits) != 2 || repo.credits[0] != "Macklemore, Ryan Lewis, Guest" || *calls != 2 {
		t.Fatal("split/caching", repo.credits, *calls)
	}
	if !strings.Contains(repo.sources[0], "97b226c8-7140-4da3-91ac-15e62e131a81") || track.Artist != "MACKLEMORE & RYAN LEWIS feat. Guest, Macklemore" || len(repo.values) != 0 {
		t.Fatal("source credit/provenance or singles album behavior changed")
	}
}

func TestUnconfirmedArtistCreditsStayIntact(t *testing.T) {
	for name, members := range map[string]string{
		"missing member":     strings.Replace(duoMembers, `"name":"Ryan Lewis"`, `"name":"Other"`, 1),
		"non-person":         strings.Replace(duoMembers, `"name":"Ryan Lewis","type":"Person"`, `"name":"Ryan Lewis","type":"Group"`, 1),
		"wrong relationship": strings.ReplaceAll(duoMembers, `"member of band"`, `"collaboration"`),
		"wrong direction":    strings.ReplaceAll(duoMembers, `"backward"`, `"forward"`),
		"wrong group":        strings.Replace(duoMembers, `"97b226c8-7140-4da3-91ac-15e62e131a81"`, `"12345678-1234-1234-1234-123456789012"`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			e, repo, _ := creditTestEnricher(t, func(req *http.Request) (string, int) {
				if req.URL.Path == "/ws/2/artist/" {
					return duoSearch, 200
				}
				return members, 200
			})
			if err := e.Suggest(context.Background(), domain.Track{ID: "track", Artist: "Macklemore & Ryan Lewis"}, nil); err != nil || len(repo.credits) != 0 {
				t.Fatal("unconfirmed split applied", repo.credits, err)
			}
		})
	}
	for _, body := range []string{
		`{"artists":[{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","name":"Florence & the Machine","type":"Group","score":100}]}`,
		strings.Replace(duoSearch, `"score":100`, `"score":80`, 1),
		`{"artists":[]}`,
		`{"artists":[{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","name":"Macklemore & Ryan Lewis","type":"Person","score":100}]}`,
		`{"artists":[{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","name":"Macklemore & Ryan Lewis","type":"Group","score":100},{"id":"12345678-1234-1234-1234-123456789012","name":"Macklemore & Ryan Lewis","type":"Group","score":100}]}`,
	} {
		e, repo, _ := creditTestEnricher(t, func(*http.Request) (string, int) { return body, 200 })
		if err := e.Suggest(context.Background(), domain.Track{ID: "track", Artist: "Macklemore & Ryan Lewis"}, nil); err != nil || len(repo.credits) != 0 {
			t.Fatal("unreliable search split", repo.credits, err)
		}
	}
}

func TestSeparatePeopleArtistSplit(t *testing.T) {
	e, repo, _ := creditTestEnricher(t, func(req *http.Request) (string, int) {
		switch req.URL.Query().Get("query") {
		case `artist:"Macklemore"`:
			return `{"artists":[{"id":"b6d7ec94-830c-44dd-b699-ce66556b7e55","name":"Macklemore","type":"Person","score":100}]}`, 200
		case `artist:"Ryan Lewis"`:
			return `{"artists":[{"id":"12345678-1234-1234-1234-123456789012","name":"Ryan Lewis","type":"Person","score":100}]}`, 200
		default:
			return `{"artists":[]}`, 200
		}
	})
	if err := e.Suggest(context.Background(), domain.Track{ID: "track", Artist: "Macklemore & Ryan Lewis"}, nil); err != nil || len(repo.credits) != 1 || repo.credits[0] != "Macklemore, Ryan Lewis" {
		t.Fatal(repo.credits, err)
	}
}

func TestBandNameIsNotExpandedIntoMembers(t *testing.T) {
	e, repo, _ := creditTestEnricher(t, func(req *http.Request) (string, int) {
		if req.URL.Path == "/ws/2/artist/" {
			return strings.Replace(duoSearch, "Macklemore & Ryan Lewis", "Florence & the Machine", 1), 200
		}
		return strings.Replace(duoMembers, `"name":"Macklemore"`, `"name":"Florence Welch"`, 1), 200
	})
	if err := e.Suggest(context.Background(), domain.Track{ID: "track", Artist: "Florence & the Machine"}, nil); err != nil || len(repo.credits) != 0 {
		t.Fatal("band name split into members", repo.credits, err)
	}
}

func TestSeparatePeopleMustBeUniqueAndUnambiguous(t *testing.T) {
	for _, body := range []string{
		`{"artists":[{"id":"12345678-1234-1234-1234-123456789012","name":"Ryan Lewis","type":"Person","score":100},{"id":"97b226c8-7140-4da3-91ac-15e62e131a81","name":"Ryan Lewis","type":"Person","score":100}]}`,
		`{"artists":[{"id":"b6d7ec94-830c-44dd-b699-ce66556b7e55","name":"Ryan Lewis","type":"Person","score":100}]}`,
		`{"artists":[{"id":"12345678-1234-1234-1234-123456789012","name":"Ryan Lewis","type":"Group","score":100}]}`,
	} {
		e, repo, _ := creditTestEnricher(t, func(req *http.Request) (string, int) {
			switch req.URL.Query().Get("query") {
			case `artist:"Macklemore"`:
				return `{"artists":[{"id":"b6d7ec94-830c-44dd-b699-ce66556b7e55","name":"Macklemore","type":"Person","score":100}]}`, 200
			case `artist:"Ryan Lewis"`:
				return body, 200
			default:
				return `{"artists":[]}`, 200
			}
		})
		if err := e.Suggest(context.Background(), domain.Track{ID: "track", Artist: "Macklemore & Ryan Lewis"}, nil); err != nil || len(repo.credits) != 0 {
			t.Fatal("unconfirmed people split", repo.credits, err)
		}
	}
}

func TestArtistSplitFailuresAreRetryable(t *testing.T) {
	failed := true
	e, repo, calls := creditTestEnricher(t, func(req *http.Request) (string, int) {
		if failed {
			return `{}`, 503
		}
		if req.URL.Path == "/ws/2/artist/" {
			return duoSearch, 200
		}
		return duoMembers, 200
	})
	track := domain.Track{ID: "track", Artist: "Macklemore & Ryan Lewis"}
	if err := e.Suggest(context.Background(), track, nil); err == nil || len(repo.credits) != 0 {
		t.Fatal("failed lookup applied a split")
	}
	failed = false
	if err := e.Suggest(context.Background(), track, nil); err != nil || len(repo.credits) != 1 || *calls != 3 {
		t.Fatal("failed request was cached", err, *calls)
	}
	repo.err = errors.New("database unavailable")
	if err := e.Suggest(context.Background(), track, nil); !errors.Is(err, repo.err) {
		t.Fatal("database failure hidden", err)
	}
}
