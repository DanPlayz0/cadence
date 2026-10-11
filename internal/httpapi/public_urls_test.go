// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"cadence/internal/domain"
)

func TestParsePublicURLs(t *testing.T) {
	got, err := ParsePublicURLs(" http://cadence.media.local/ , https://cadence.example.com ")
	want := []string{"http://cadence.media.local", "https://cadence.example.com"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, %v; want %v", got, err, want)
	}
	if got, err := ParsePublicURLs("  "); err != nil || len(got) != 0 {
		t.Fatalf("empty list: %v, %v", got, err)
	}
	for _, value := range []string{"https://host,", ",http://host", "https://host/path", "https://user:pass@host", "https://host?q=x", "https://host#fragment", "ftp://host", "host"} {
		if _, err := ParsePublicURLs(value); err == nil {
			t.Errorf("accepted invalid list %q", value)
		}
	}
}

func TestMultiplePublicOrigins(t *testing.T) {
	for _, canonical := range []string{"https://cadence.example.com", ""} {
		s := Server{Repo: &originRepo{}, Config: Config{PublicURL: canonical, PublicURLs: []string{"http://cadence.media.local", "https://cadence.example.com"}}}
		h := s.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
		for _, tc := range []struct {
			origin, path, csrf string
			cookie             bool
			status             int
		}{
			{"http://cadence.media.local", "/api/v1/login", "", false, 204},
			{"https://cadence.example.com", "/api/v1/setup", "", false, 204},
			{"http://cadence.example.com", "/api/v1/login", "", false, 403},
			{"http://cadence.media.local:8080", "/api/v1/login", "", false, 403},
			{"https://evil.test", "/api/v1/login", "", false, 403},
			{"http://cadence.media.local", "/api/v1/playlists", "", false, 401},
			{"http://cadence.media.local", "/api/v1/playlists", "", true, 403},
			{"http://cadence.media.local", "/api/v1/playlists", "valid-csrf", true, 204},
			{"http://cadence.media.local", "/api/v1/admin/users", "valid-csrf", true, 403},
		} {
			r := httptest.NewRequest("POST", "http://unlisted.test"+tc.path, nil)
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("X-CSRF-Token", tc.csrf)
			if tc.cookie {
				r.AddCookie(&http.Cookie{Name: "cadence_session", Value: "token"})
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Errorf("canonical %q, origin %q, path %s: got %d; want %d", canonical, tc.origin, tc.path, w.Code, tc.status)
			}
		}
	}
}

type publicURLsRepo struct{ originRepo }

func (*publicURLsRepo) SaveSession(context.Context, string, string, string, time.Time, string) error {
	return nil
}
func (*publicURLsRepo) DeleteSession(context.Context, string) error { return nil }

func TestPublicURLSessionCookies(t *testing.T) {
	s := Server{Repo: &publicURLsRepo{}, Config: Config{PublicURL: "https://cadence.example.com", SecureCookie: true, PublicURLs: []string{"http://cadence.media.local", "http://dual.test", "https://dual.test"}}}
	for _, tc := range []struct {
		target string
		secure bool
	}{
		{"http://cadence.media.local/api/v1/login", false},
		{"http://cadence.example.com/api/v1/login", true}, // HTTPS proxy upstream.
		{"https://cadence.media.local/api/v1/login", true},
		{"http://dual.test/api/v1/login", true},
		{"http://unlisted.test/api/v1/login", true},
	} {
		for _, logout := range []bool{false, true} {
			r := httptest.NewRequest("POST", tc.target, nil)
			r.Header.Set("X-Forwarded-Proto", "http")
			r.AddCookie(&http.Cookie{Name: "cadence_session", Value: "token"})
			w := httptest.NewRecorder()
			if logout {
				s.logout(w, r)
			} else {
				s.newSession(w, r, domain.User{ID: "user"})
			}
			cookies := w.Result().Cookies()
			if w.Code != 200 || len(cookies) != 1 {
				t.Fatalf("%s logout=%v: %d %s", tc.target, logout, w.Code, w.Body.String())
			}
			c := cookies[0]
			if c.Secure != tc.secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Domain != "" || c.Path != "/" {
				t.Errorf("%s logout=%v: unexpected cookie %+v", tc.target, logout, c)
			}
			if logout && c.MaxAge != -1 {
				t.Error("logout cookie not expired")
			}
		}
	}
}
