// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type playbackRepo struct {
	domain.Repository
	saved    domain.Playback
	denied   bool
	conflict bool
	calls    int
}

func (r *playbackRepo) Session(context.Context, string) (domain.Session, error) {
	return domain.Session{User: domain.User{ID: "listener"}, CSRF: "proof"}, nil
}
func (r *playbackRepo) Playback(_ context.Context, user string) (domain.Playback, error) {
	if user != "listener" {
		panic("wrong owner")
	}
	return r.saved, nil
}
func (r *playbackRepo) Track(context.Context, string, string) (domain.Track, error) {
	if r.denied {
		return domain.Track{}, domain.ErrNotFound
	}
	return domain.Track{ID: "song", Title: "Song", Duration: 100}, nil
}
func (r *playbackRepo) SavePlayback(_ context.Context, user string, v domain.Playback) (domain.Playback, error) {
	if user != "listener" {
		panic("wrong owner")
	}
	r.calls++
	if r.denied {
		return v, domain.ErrNotFound
	}
	if r.conflict {
		return v, domain.ErrConflict
	}
	v.Revision++
	r.saved = v
	return v, nil
}
func TestPlaybackAuthenticationValidationAndHiddenTracks(t *testing.T) {
	repo := &playbackRepo{}
	handler := (&Server{Repo: repo}).Handler()
	request := func(method, body string, auth, csrf bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/v1/me/playback", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session"})
		}
		if csrf {
			req.Header.Set("X-CSRF-Token", "proof")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	good := `{"trackId":"song","position":42.5,"revision":0,"writer":"0123456789abcdef","sequence":1}`
	for _, method := range []string{"GET", "PUT"} {
		if w := request(method, good, false, true); w.Code != 401 {
			t.Fatal(method, w.Code)
		}
	}
	if w := request("PUT", good, true, false); w.Code != 403 {
		t.Fatal(w.Code)
	}
	for _, body := range []string{`{}`, `null`, strings.Replace(good, `42.5`, `-1`, 1), strings.Replace(good, `42.5`, `172801`, 1), strings.Replace(good, `"sequence":1`, `"sequence":0`, 1), strings.Replace(good, `"revision":0`, `"revision":-1`, 1), strings.Replace(good, `0123456789abcdef`, `not-a-writer`, 1), strings.Replace(good, `42.5`, `1e999`, 1), strings.Replace(good, `"trackId"`, `"userId"`, 1)} {
		if w := request("PUT", body, true, true); w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
	if repo.calls != 0 {
		t.Fatal("invalid checkpoints reached repository")
	}
	if w := request("GET", "", true, false); w.Code != 200 || !strings.Contains(w.Body.String(), `"track":null`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("PUT", good, true, true); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w := request("GET", "", true, false)
	var saved struct {
		domain.Playback
		Track *domain.Track
	}
	if json.Unmarshal(w.Body.Bytes(), &saved) != nil || saved.Track == nil || saved.Position != 42.5 {
		t.Fatal(w.Body.String())
	}
	repo.denied = true
	if w := request("PUT", good, true, true); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if w := request("GET", "", true, false); w.Code != 200 || strings.Contains(w.Body.String(), `"song"`) {
		t.Fatal("excluded track leaked", w.Code, w.Body.String())
	}
	repo.denied = false
	repo.conflict = true
	if w := request("PUT", good, true, true); w.Code != 409 {
		t.Fatal(w.Code)
	}
}

func (r *playbackRepo) RecordDevice(context.Context, string, string, string) error { return nil }
