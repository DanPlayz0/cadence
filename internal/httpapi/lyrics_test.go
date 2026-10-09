// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cadence/internal/domain"
	"cadence/internal/lyrics"
)

type lyricsRepo struct {
	domain.Repository
	denied bool
}

func (r *lyricsRepo) Session(context.Context, string) (domain.Session, error) {
	return domain.Session{User: domain.User{ID: "listener"}}, nil
}
func (r *lyricsRepo) Track(context.Context, string, string) (domain.Track, error) {
	if r.denied {
		return domain.Track{}, domain.ErrNotFound
	}
	return domain.Track{ID: "song", Title: "Song", Artist: "Artist", Duration: 100}, nil
}

type lyricsTransport func(*http.Request) (*http.Response, error)

func (f lyricsTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestLyricsRequireTrackAccessEvenWhenCached(t *testing.T) {
	repo := &lyricsRepo{}
	provider := lyrics.New()
	calls := 0
	provider.HTTP = &http.Client{Transport: lyricsTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"plainLyrics":"Sample"}`))}, nil
	})}
	handler := (&Server{Repo: repo, Lyrics: provider}).Handler()
	request := func(auth bool) int {
		req := httptest.NewRequest("GET", "/api/v1/tracks/song/lyrics", nil)
		if auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session"})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w.Code
	}
	if code := request(false); code != 401 || calls != 0 {
		t.Fatal("anonymous lookup", code, calls)
	}
	repo.denied = true
	if code := request(true); code != 404 || calls != 0 {
		t.Fatal("excluded lookup", code, calls)
	}
	repo.denied = false
	if code := request(true); code != 200 || calls != 1 {
		t.Fatal("allowed lookup", code, calls)
	}
	if code := request(true); code != 200 || calls != 1 {
		t.Fatal("cache", code, calls)
	}
	repo.denied = true
	if code := request(true); code != 404 || calls != 1 {
		t.Fatal("cached exclusion bypass", code, calls)
	}
}
func TestLyricsRecheckAccessAfterProviderRequest(t *testing.T) {
	repo := &lyricsRepo{}
	provider := lyrics.New()
	provider.HTTP = &http.Client{Transport: lyricsTransport(func(*http.Request) (*http.Response, error) {
		repo.denied = true
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"plainLyrics":"Sample"}`))}, nil
	})}
	handler := (&Server{Repo: repo, Lyrics: provider}).Handler()
	req := httptest.NewRequest("GET", "/api/v1/tracks/song/lyrics", nil)
	req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session"})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 404 {
		t.Fatal("permission change during lookup", w.Code, w.Body.String())
	}
}
