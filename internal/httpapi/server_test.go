// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

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
