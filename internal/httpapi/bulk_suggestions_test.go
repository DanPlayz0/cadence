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

type bulkRepo struct {
	domain.Repository
	admin  bool
	calls  int
	fields []string
}

func (r *bulkRepo) Session(context.Context, string) (domain.Session, error) {
	return domain.Session{User: domain.User{ID: "owner", Admin: r.admin}, CSRF: "csrf"}, nil
}
func (r *bulkRepo) AcceptSuggestions(_ context.Context, fields []string) (int64, error) {
	r.calls++
	r.fields = fields
	return 105, nil
}
func TestBulkSuggestionsAuthorizationAndValidation(t *testing.T) {
	repo := &bulkRepo{admin: true}
	handler := (&Server{Repo: repo}).Handler()
	for _, v := range []struct {
		body              string
		auth, csrf, admin bool
		status            int
	}{
		{`{"fields":["title"]}`, false, true, true, 401},
		{`{"fields":["title"]}`, true, false, true, 403},
		{`{"fields":["title"]}`, true, true, false, 403},
		{`{"fields":[]}`, true, true, true, 400},
		{`{"fields":["unknown"]}`, true, true, true, 400},
		{`{"fields":["title"],"extra":true}`, true, true, true, 400},
		{`{"fields":["title","album"]}`, true, true, true, 200},
	} {
		repo.admin = v.admin
		req := httptest.NewRequest("POST", "/api/v1/admin/suggestions/accept-all", strings.NewReader(v.body))
		req.Header.Set("Content-Type", "application/json")
		if v.auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session"})
		}
		if v.csrf {
			req.Header.Set("X-CSRF-Token", "csrf")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != v.status {
			t.Fatal(v.body, v.status, w.Code, w.Body.String())
		}
		if w.Code == 200 && !strings.Contains(w.Body.String(), `"accepted":105`) {
			t.Fatal("missing count", w.Body.String())
		}
	}
	if repo.calls != 1 || strings.Join(repo.fields, ",") != "title,album" {
		t.Fatal("invalid requests mutated suggestions", repo.calls, repo.fields)
	}
}
