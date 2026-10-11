// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cadence/internal/domain"
	"cadence/internal/lyrics"
)

type lyricsRepo struct {
	domain.Repository
	denied bool
	path   string
}

func (r *lyricsRepo) Session(context.Context, string) (domain.Session, error) {
	return domain.Session{User: domain.User{ID: "listener"}}, nil
}
func (r *lyricsRepo) Track(context.Context, string, string) (domain.Track, error) {
	if r.denied {
		return domain.Track{}, domain.ErrNotFound
	}
	return domain.Track{ID: "song", Title: "Song", Artist: "Artist", Duration: 100, Path: r.path}, nil
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

func (r *lyricsRepo) RecordDevice(context.Context, string, string, string) error { return nil }

func TestLyricsLocalPriorityAndFallback(t *testing.T) {
	root := t.TempDir()
	audio := filepath.Join(root, "Song.mp3")
	sidecar := filepath.Join(root, "Song.lrc")
	for path, body := range map[string]string{audio: "audio", sidecar: "[00:01]Local line"} {
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	repo := &lyricsRepo{path: audio}
	provider := lyrics.New()
	calls := 0
	provider.HTTP = &http.Client{Transport: lyricsTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"plainLyrics":"Online line"}`))}, nil
	})}
	handler := (&Server{Repo: repo, Lyrics: provider, Config: Config{Roots: []string{root}}}).Handler()
	request := func() (int, lyrics.Result) {
		t.Helper()
		req := httptest.NewRequest("GET", "/api/v1/tracks/song/lyrics", nil)
		req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session"})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		var result lyrics.Result
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return w.Code, result
	}
	if status, result := request(); status != 200 || result.Source != "Local LRC" || result.Synced != "[00:01]Local line" || calls != 0 {
		t.Fatal("local priority", status, result, calls)
	}
	repo.denied = true
	if status, _ := request(); status != 404 || calls != 0 {
		t.Fatal("local access bypass", status, calls)
	}
	repo.denied = false
	if err := os.Remove(sidecar); err != nil {
		t.Fatal(err)
	}
	if status, result := request(); status != 200 || result.Source != "LRCLIB" || calls != 1 {
		t.Fatal("online fallback", status, result, calls)
	}
	if err := os.WriteFile(sidecar, []byte("[00:02]New local line"), 0600); err != nil {
		t.Fatal(err)
	}
	if status, result := request(); status != 200 || result.Source != "Local LRC" || calls != 1 {
		t.Fatal("local file should override cached online lyrics", status, result, calls)
	}
}
