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

type metadataBulkRepo struct {
	brandingRepo
	field, match, value string
	count               int
	conflict            bool
}

func (r *metadataBulkRepo) MetadataMatches(_ context.Context, user, field, value string, limit, offset int) (domain.Page, error) {
	return domain.Page{Items: []domain.Track{}, Total: 2, Limit: limit, Offset: offset}, nil
}
func (r *metadataBulkRepo) BulkMetadataSuggestions(_ context.Context, user, field, match, value string, count int) (int64, error) {
	r.field = field
	r.match = match
	r.value = value
	r.count = count
	if r.conflict {
		return 0, domain.ErrConflict
	}
	return 2, nil
}
func TestBulkMetadataPermissionsAndValidation(t *testing.T) {
	repo := &metadataBulkRepo{brandingRepo: brandingRepo{admin: true}}
	handler := (&Server{Repo: repo}).Handler()
	call := func(method, path, body string, auth, csrf bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "session"})
		}
		if csrf {
			req.Header.Set("X-CSRF-Token", "test-csrf")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	const endpoint = "/api/v1/admin/metadata/bulk"
	const album = `{"field":"album","match":"music","value":"","expectedCount":2}`
	if w := call("POST", endpoint, album, false, true); w.Code != 401 {
		t.Fatal("anonymous bulk edit allowed")
	}
	repo.admin = false
	if w := call("POST", endpoint, album, true, true); w.Code != 403 {
		t.Fatal("listener bulk edit allowed")
	}
	repo.admin = true
	if w := call("POST", endpoint, album, true, false); w.Code != 403 {
		t.Fatal("bulk edit without CSRF allowed")
	}
	if w := call("POST", endpoint, album, true, true); w.Code != 200 || repo.value != "" || repo.field != "album" || repo.count != 2 {
		t.Fatalf("album clearing failed: %d %s", w.Code, w.Body.String())
	}
	for _, body := range []string{
		`{"field":"title","match":"music","value":"","expectedCount":2}`,
		`{"field":"artist","match":"music","value":" ","expectedCount":2}`,
		`{"field":"number","match":"1","value":"-1","expectedCount":2}`,
		`{"field":"artwork","match":"x","value":"y","expectedCount":2}`,
		`{"field":"album","match":"music","value":"","expectedCount":0}`,
	} {
		if w := call("POST", endpoint, body, true, true); w.Code != 400 {
			t.Fatal("invalid replacement accepted")
		}
	}
	repo.conflict = true
	if w := call("POST", endpoint, album, true, true); w.Code != 409 {
		t.Fatal("stale preview not reported")
	}
	if w := call("GET", "/api/v1/admin/metadata/tracks?field=album&value=music", "", true, false); w.Code != 200 {
		t.Fatal("filter failed")
	}
	if w := call("GET", "/api/v1/admin/metadata/tracks?field=invalid", "", true, false); w.Code != 400 {
		t.Fatal("invalid filter accepted")
	}
}
