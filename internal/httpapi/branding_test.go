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

type brandingRepo struct {
	domain.Repository
	name  string
	admin bool
}

func (r *brandingRepo) HasUsers(context.Context) (bool, error)       { return true, nil }
func (r *brandingRepo) InstanceName(context.Context) (string, error) { return r.name, nil }
func (r *brandingRepo) SetInstanceName(_ context.Context, name string) error {
	r.name = name
	return nil
}
func (r *brandingRepo) Session(context.Context, string) (domain.Session, error) {
	return domain.Session{User: domain.User{Admin: r.admin}, CSRF: "test-csrf"}, nil
}
func TestBranding(t *testing.T) {
	repo := &brandingRepo{name: "Cadence", admin: true}
	s := &Server{Repo: repo}
	handler := s.Handler()
	request := func(method, path, body string, authenticated, csrf bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if authenticated {
			r.AddCookie(&http.Cookie{Name: "cadence_session", Value: "test"})
		}
		if csrf {
			r.Header.Set("X-CSRF-Token", "test-csrf")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, name := range []string{"", "   ", strings.Repeat("x", 121)} {
		body, _ := json.Marshal(map[string]string{"name": name})
		if w := request("PUT", "/api/v1/admin/branding", string(body), true, true); w.Code != 400 {
			t.Fatalf("invalid name accepted: %d %s", w.Code, w.Body.String())
		}
	}
	if w := request("PUT", "/api/v1/admin/branding", `{"name":"test"}`, false, true); w.Code != 401 {
		t.Fatal("anonymous rename allowed")
	}
	if w := request("PUT", "/api/v1/admin/branding", `{"name":"test"}`, true, false); w.Code != 403 {
		t.Fatal("rename without CSRF allowed")
	}
	repo.admin = false
	if w := request("PUT", "/api/v1/admin/branding", `{"name":"test"}`, true, true); w.Code != 403 {
		t.Fatal("listener rename allowed")
	}
	repo.admin = true
	if w := request("PUT", "/api/v1/admin/branding", `{"name":"  音楽 & Friends  "}`, true, true); w.Code != 200 || repo.name != "音楽 & Friends" {
		t.Fatalf("rename failed: %d %s", w.Code, w.Body.String())
	}
	for _, path := range []string{"/api/v1/status", "/api/v1/admin/branding"} {
		w := request("GET", path, "", path != "/api/v1/status", false)
		var v struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(w.Body.Bytes(), &v) != nil || w.Code != 200 || v.Name != repo.name {
			t.Fatalf("name missing: %s %s", path, w.Body.String())
		}
	}
}
