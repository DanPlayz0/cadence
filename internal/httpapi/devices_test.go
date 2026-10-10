// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type devicesRepo struct {
	brandingRepo
	token, agent, version string
}

func (r *devicesRepo) RecordDevice(_ context.Context, token, agent, version string) error {
	r.token = token
	r.agent = agent
	r.version = version
	return nil
}
func (r *devicesRepo) Devices(context.Context) ([]domain.Device, error) {
	return []domain.Device{{ID: "public-device-id", User: domain.User{ID: "listener", DisplayName: "Listener"}, UserAgent: r.agent, ClientVersion: r.version, LastActive: time.Now()}}, nil
}
func TestDevicesAccessAndTracking(t *testing.T) {
	repo := &devicesRepo{brandingRepo: brandingRepo{admin: true}}
	s := &Server{Repo: repo}
	handler := s.Handler()
	call := func(auth bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/v1/admin/devices", nil)
		req.Header.Set("User-Agent", "Chrome/140.0")
		req.Header.Set("X-Cadence-Client-Version", "0.1.0")
		if auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "secret-session"})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	if w := call(false); w.Code != 401 {
		t.Fatal("anonymous device listing allowed")
	}
	repo.admin = false
	if w := call(true); w.Code != 403 {
		t.Fatal("listener device listing allowed")
	}
	repo.admin = true
	w := call(true)
	if w.Code != 200 || repo.agent != "Chrome/140.0" || repo.version != "0.1.0" || repo.token != tokenHash("secret-session") {
		t.Fatalf("device tracking failed: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), repo.token) || strings.Contains(w.Body.String(), "secret-session") || strings.Contains(w.Body.String(), "test-csrf") {
		t.Fatal("device list exposed credentials")
	}
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", strings.Repeat("a", 3000))
	req.Header.Set("X-Cadence-Client-Version", strings.Repeat("v", 300))
	if err := s.recordDevice(req, "token"); err != nil || len(repo.agent) != 2048 || len(repo.version) != 120 {
		t.Fatal("device fields were not bounded")
	}
}
