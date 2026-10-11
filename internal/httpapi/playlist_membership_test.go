// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type membershipRepo struct {
	originRepo
	called bool
}

func (r *membershipRepo) TrackPlaylistIDs(_ context.Context, user, track string) ([]string, error) {
	r.called = true
	if user != "owner" {
		return nil, domain.ErrNotFound
	}
	if track == "empty" {
		return nil, nil
	}
	if track != "song" {
		return nil, domain.ErrNotFound
	}
	return []string{"owned-playlist"}, nil
}
func (*membershipRepo) Session(context.Context, string) (domain.Session, error) {
	return domain.Session{User: domain.User{ID: "owner"}, CSRF: "valid-csrf"}, nil
}
func TestTrackPlaylistMembershipAPI(t *testing.T) {
	for _, tc := range []struct {
		track         string
		authenticated bool
		status        int
		count         int
	}{
		{"song", true, 200, 1}, {"empty", true, 200, 0}, {"missing", true, 404, 0}, {"song", false, 401, 0},
	} {
		t.Run(tc.track, func(t *testing.T) {
			repo := &membershipRepo{}
			req := httptest.NewRequest("GET", "/api/v1/tracks/"+tc.track+"/playlists", nil)
			if tc.authenticated {
				req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "test"})
			}
			w := httptest.NewRecorder()
			(&Server{Repo: repo}).Handler().ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("want %d got %d: %s", tc.status, w.Code, w.Body.String())
			}
			if !tc.authenticated && repo.called {
				t.Fatal("unauthenticated query reached repository")
			}
			if tc.status == 200 {
				var result struct {
					PlaylistIDs []string `json:"playlistIds"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.PlaylistIDs == nil || len(result.PlaylistIDs) != tc.count {
					t.Fatalf("unexpected membership: %s (%v)", w.Body.String(), err)
				}
			}
		})
	}
}
