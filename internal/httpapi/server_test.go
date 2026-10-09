// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
