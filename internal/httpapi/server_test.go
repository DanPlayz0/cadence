// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cadence/internal/domain"
)

func TestMutationOrigins(t *testing.T) {
	for _, tc := range []struct {
		name, public, target, origin string
		allowAny                     bool
		status                       int
	}{
		{"configured origin", "http://192.168.0.29", "http://localhost/api/v1/login", "http://192.168.0.29", false, 204},
		{"localhost rejected by default", "http://192.168.0.29", "http://localhost/api/v1/login", "http://localhost", false, 403},
		{"other origin rejected by default", "http://192.168.0.29", "http://192.168.0.29/api/v1/setup", "https://other.example", false, 403},
		{"localhost allowed by opt in", "http://192.168.0.29", "http://localhost/api/v1/login", "http://localhost", true, 204},
		{"any origin allowed by opt in", "http://192.168.0.29", "http://192.168.0.29/api/v1/setup", "https://other.example", true, 204},
		{"port mismatch rejected", "http://localhost:8080", "http://localhost:8080/api/v1/login", "http://localhost", false, 403},
		{"no public URL same origin", "", "http://localhost/api/v1/login", "http://localhost", false, 204},
		{"no public URL different origin", "", "http://localhost/api/v1/login", "http://192.168.0.29", false, 403},
		{"no public URL HTTPS", "", "https://localhost/api/v1/login", "https://localhost", false, 204},
		{"no public URL opt in", "", "http://localhost/api/v1/login", "http://192.168.0.29", true, 204},
		{"missing origin unchanged", "http://192.168.0.29", "http://localhost/api/v1/login", "", false, 204},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Server{Config: Config{PublicURL: tc.public, AllowAnyOrigin: tc.allowAny}}
			h := s.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			}))
			r := httptest.NewRequest(http.MethodPost, tc.target, nil)
			r.Header.Set("Origin", tc.origin)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s; want %d", w.Code, w.Body.String(), tc.status)
			}
		})
	}
}

type originRepo struct {
	domain.Repository
}

func (*originRepo) Session(context.Context, string) (domain.Session, error) {
	return domain.Session{CSRF: "valid-csrf"}, nil
}

func (*originRepo) RecordDevice(context.Context, string, string, string) error { return nil }

func TestAllowAnyOriginPreservesAccessChecks(t *testing.T) {
	s := Server{Repo: &originRepo{}, Config: Config{PublicURL: "http://192.168.0.29", AllowAnyOrigin: true}}
	h := s.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, tc := range []struct {
		name, path, csrf string
		cookie           bool
		status           int
	}{
		{"authentication required", "/api/v1/playlists", "", false, 401},
		{"CSRF required", "/api/v1/playlists", "", true, 403},
		{"wrong CSRF rejected", "/api/v1/playlists", "wrong-csrf", true, 403},
		{"valid CSRF accepted", "/api/v1/playlists", "valid-csrf", true, 204},
		{"administrator required", "/api/v1/admin/users", "valid-csrf", true, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "http://localhost"+tc.path, nil)
			r.Header.Set("Origin", "http://localhost")
			r.Header.Set("X-CSRF-Token", tc.csrf)
			if tc.cookie {
				r.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session-token"})
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s; want %d", w.Code, w.Body.String(), tc.status)
			}
		})
	}
}

func TestFrontendDeepLinks(t *testing.T) {
	root := t.TempDir()
	const page = "<!doctype html><title>Cadence</title>"
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte(page), 0600); err != nil {
		t.Fatal(err)
	}
	s := Server{Config: Config{WebDir: root}}
	for _, path := range []string{"/songs?q=rock", "/albums/example", "/artists/AC%2FDC", "/playlists/example", "/admin/people"} {
		w := httptest.NewRecorder()
		s.static(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK || w.Body.String() != page {
			t.Fatalf("deep link %s: status=%d body=%s", path, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	s.static(w, httptest.NewRequest(http.MethodGet, "/api/unknown", nil))
	if w.Code != http.StatusNotFound {
		t.Fatal("missing API route must not serve the frontend")
	}
}

func TestMetadataSuggestionValues(t *testing.T) {
	for _, v := range []struct {
		field, value string
		valid        bool
	}{
		{"title", "Song", true}, {"artist", "", false}, {"title", "  ", false},
		{"genre", "", true}, {"album", "", true}, {"number", "0", true}, {"disc", "9999", true},
		{"number", "-1", false}, {"number", "1.5", false}, {"disc", "10000", false},
		{"disc", "", false}, {"artwork", "path", false}, {"author", "someone", false},
		{"genre", strings.Repeat("x", 501), false},
	} {
		if validSuggestion(v.field, v.value) != v.valid {
			t.Errorf("%s=%q", v.field, v.value)
		}
	}
}

func TestJSONProtection(t *testing.T) {
	for _, body := range []string{`{"name":"x"} {}`, `{"unknown":"x"}`, `not-json`} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		var v struct {
			Name string `json:"name"`
		}
		if decode(w, r, &v) {
			t.Fatal("invalid JSON accepted")
		}
	}
}
func TestPublicURL(t *testing.T) {
	for _, v := range []string{"https://music.example.com", "http://localhost:8080", ""} {
		if e := ValidatePublicURL(v); e != nil {
			t.Fatal(e)
		}
	}
	for _, v := range []string{"javascript:alert(1)", "https://host/path", "https://user:pass@host", "https://host?q=x"} {
		if ValidatePublicURL(v) == nil {
			t.Fatal("invalid public origin allowed")
		}
	}
}

func TestPasswordRequirements(t *testing.T) {
	for _, password := range []string{"abc", "音楽家", strings.Repeat("a", 72), strings.Repeat("音", 24)} {
		if !validPassword(password) {
			t.Fatalf("valid password rejected: %q", password)
		}
	}
	for _, password := range []string{"", "ab", "音楽", strings.Repeat("a", 73), strings.Repeat("音", 25), "ab\xff"} {
		if validPassword(password) {
			t.Fatalf("invalid password accepted: %q", password)
		}
	}
}

func TestRejectInvalidPlaylistIcon(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/v1/playlists", strings.NewReader(`{"name":"Mix","icon":"unknown"}`))
	r.Header.Set("Content-Type", "application/json")
	(&Server{}).createPlaylist(w, r)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "Invalid playlist icon") {
		t.Fatalf("unexpected icon validation response: %d %s", w.Code, w.Body.String())
	}
}
