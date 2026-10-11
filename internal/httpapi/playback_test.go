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
	missing  map[string]bool
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
func (r *playbackRepo) Track(_ context.Context, _ string, id string) (domain.Track, error) {
	if r.denied || r.missing[id] {
		return domain.Track{}, domain.ErrNotFound
	}
	return domain.Track{ID: id, Title: "Song", Duration: 100}, nil
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

func TestPlaybackQueueValidationHydrationAndMissingCurrent(t *testing.T) {
	q := &domain.PlaybackQueue{Version: 1, Repeat: "all", Shuffle: true,
		Current:   &domain.PlaybackEntry{ID: "current", TrackID: "song"},
		Manual:    []domain.PlaybackEntry{{ID: "manual", TrackID: "next"}, {ID: "gone", TrackID: "gone"}},
		Remaining: []domain.PlaybackEntry{{ID: "playlist", TrackID: "next"}},
		Cycle:     []domain.PlaybackEntry{{ID: "current", TrackID: "song"}, {ID: "playlist", TrackID: "next"}},
	}
	if !validPlaybackQueue(q, "song") {
		t.Fatal("valid queue rejected")
	}
	if validPlaybackQueue(q, "other") {
		t.Fatal("mismatched current accepted")
	}
	bad := *q
	bad.Version = 2
	if validPlaybackQueue(&bad, "song") {
		t.Fatal("unknown version accepted")
	}
	bad = *q
	bad.Manual = []domain.PlaybackEntry{{ID: "current", TrackID: "other"}}
	if validPlaybackQueue(&bad, "song") {
		t.Fatal("colliding identity accepted")
	}
	repo := &playbackRepo{saved: domain.Playback{TrackID: "song", Position: 42, Queue: q}, missing: map[string]bool{"song": true, "gone": true}}
	r := httptest.NewRequest("GET", "/api/v1/me/playback", nil)
	r.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session"})
	w := httptest.NewRecorder()
	(&Server{Repo: repo}).Handler().ServeHTTP(w, r)
	var result struct {
		domain.Playback
		Tracks map[string]domain.Track
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if result.Queue == nil || result.Queue.Current != nil || result.TrackID != "" || result.Position != 0 {
		t.Fatal("missing current not filtered", w.Body.String())
	}
	if len(result.Queue.Manual) != 1 || len(result.Queue.Remaining) != 1 || len(result.Queue.Cycle) != 1 || result.Tracks["next"].ID != "next" {
		t.Fatal("upcoming songs lost", w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"gone"`) || strings.Contains(w.Body.String(), `"song"`) {
		t.Fatal("inaccessible references leaked", w.Body.String())
	}
	if len(repo.saved.Queue.Manual) != 2 {
		t.Fatal("GET mutated saved snapshot")
	}
}
