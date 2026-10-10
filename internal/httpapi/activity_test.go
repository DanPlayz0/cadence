// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type activityRepo struct {
	brandingRepo
	filter, query string
	limit, offset int
}

func (r *activityRepo) Activity(_ context.Context, filter, query string, limit, offset int) (domain.ActivityPage, error) {
	r.filter = filter
	r.query = query
	r.limit = limit
	r.offset = offset
	return domain.ActivityPage{Items: []domain.ActivityEntry{{ID: 1, Level: "Information", Name: "Library scan started", Type: "ScanStarted"}}, Total: 1}, nil
}
func TestActivityAccessAndFilters(t *testing.T) {
	repo := &activityRepo{brandingRepo: brandingRepo{admin: true}}
	handler := (&Server{Repo: repo}).Handler()
	call := func(path string, auth bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", path, nil)
		if auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "secret"})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	if w := call("/api/v1/admin/activity", false); w.Code != 401 {
		t.Fatal("anonymous activity allowed")
	}
	repo.admin = false
	if w := call("/api/v1/admin/activity", true); w.Code != 403 {
		t.Fatal("listener activity allowed")
	}
	repo.admin = true
	if w := call("/api/v1/admin/activity?filter=user&q=login&limit=25&offset=50", true); w.Code != 200 || repo.filter != "user" || repo.query != "login" || repo.limit != 25 || repo.offset != 50 {
		t.Fatalf("filter failed: %d", w.Code)
	}
	for _, path := range []string{"/api/v1/admin/activity?filter=unknown", "/api/v1/admin/activity?q=" + strings.Repeat("x", 501)} {
		if w := call(path, true); w.Code != 400 {
			t.Fatal("invalid query accepted")
		}
	}
	if w := call("/api/v1/admin/activity?limit=500", true); w.Code != 200 || repo.limit != 100 || repo.filter != "all" {
		t.Fatal("default filter or limit bound failed")
	}
}
