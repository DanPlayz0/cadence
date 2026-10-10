// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/soulseek"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSoulseekPersistence(t *testing.T) {
	r, _ := fixture(t)
	ctx := context.Background()
	u, e := r.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, true)
	if e != nil {
		t.Fatal(e)
	}
	cfg, e := r.SoulseekSettings(ctx)
	if e != nil || cfg.Enabled || cfg.ReviewTiming != "before" {
		t.Fatal(cfg, e)
	}
	cfg.Enabled = true
	cfg.ManagedShares = []string{"/music/approved"}
	if e = r.SaveSoulseekSettings(ctx, cfg); e != nil {
		t.Fatal(e)
	}
	cfg, e = r.SoulseekSettings(ctx)
	if e != nil || len(cfg.ManagedShares) != 1 {
		t.Fatal(cfg, e)
	}
	b, _ := json.Marshal(cfg)
	if strings.Contains(string(b), "managedShares") {
		t.Fatal("internal shares exposed")
	}
	searchID := soulseek.ID()
	if e = r.CreateSoulseekSearch(ctx, searchID, u.ID); e != nil {
		t.Fatal(e)
	}
	if ok, e := r.OwnsSoulseekSearch(ctx, searchID, u.ID); e != nil || !ok {
		t.Fatal(ok, e)
	}
	if ok, _ := r.OwnsSoulseekSearch(ctx, searchID, "other"); ok {
		t.Fatal("search leaked")
	}
	job := domain.SoulseekRequest{ID: soulseek.ID(), UserID: u.ID, Created: time.Now().UTC(), State: "importing", Files: []domain.SoulseekRequestFile{{SoulseekFile: domain.SoulseekFile{Filename: "song.mp3", Size: 3}, ImportedPath: "/music/import/song.mp3", Digest: "digest"}}}
	if e = r.SaveSoulseekRequest(ctx, &job); e != nil {
		t.Fatal(e)
	}
	stale := job
	if e = r.SaveSoulseekRequest(ctx, &job); e != nil {
		t.Fatal(e)
	}
	if e = r.SaveSoulseekRequest(ctx, &stale); !errors.Is(e, domain.ErrConflict) {
		t.Fatal("stale write allowed", e)
	}
	saved, e := r.SoulseekRequest(ctx, job.ID)
	if e != nil || saved.Files[0].ImportedPath == "" || saved.Files[0].Digest != "digest" {
		t.Fatal(saved, e)
	}
	b, _ = json.Marshal(saved)
	if strings.Contains(string(b), "/music/import") || strings.Contains(string(b), "digest") {
		t.Fatal("private import paths leaked")
	}
	list, e := r.SoulseekRequests(ctx, u.ID, true, 10, 0)
	if e != nil || len(list) != 1 {
		t.Fatal(list, e)
	}
	list, e = r.SoulseekRequests(ctx, "other", false, 10, 0)
	if e != nil || len(list) != 0 {
		t.Fatal("owner filter", list, e)
	}
}

type httpRemote struct {
	soulseek.Remote
	searches int
}

func (f *httpRemote) StartSearch(context.Context, string, string) error { f.searches++; return nil }
func TestSoulseekHTTPAccess(t *testing.T) {
	repo, _ := fixture(t)
	ctx := context.Background()
	admin, _ := repo.CreateUser(ctx, domain.User{Username: "admin", Password: "hash"}, true)
	listener, _ := repo.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	for _, u := range []domain.User{admin, listener} {
		h := sha256.Sum256([]byte(u.ID))
		if e := repo.SaveSession(ctx, hex.EncodeToString(h[:]), u.ID, "csrf", time.Now().Add(time.Hour), u.Password); e != nil {
			t.Fatal(e)
		}
	}
	remote := &httpRemote{}
	s := &soulseek.Service{Repo: repo, Libraries: repo, Remote: remote, Configured: true}
	handler := (&httpapi.Server{Repo: repo, Soulseek: s}).Handler()
	call := func(method, path, token, csrf string, body any) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(string(b)))
		if token != "" {
			r.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call("GET", "/soulseek/capabilities", "", "", nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	cfg := domain.DefaultSoulseekSettings()
	cfg.Enabled = true
	cfg.Users = []string{listener.ID}
	if e := repo.SaveSoulseekSettings(ctx, cfg); e != nil {
		t.Fatal(e)
	}
	if w := call("POST", "/soulseek/searches", listener.ID, "", map[string]string{"query": "artist song"}); w.Code != 403 {
		t.Fatal("CSRF allowed", w.Code)
	}
	if w := call("PUT", "/admin/soulseek", listener.ID, "csrf", cfg); w.Code != 403 {
		t.Fatal("admin access allowed", w.Code)
	}
	w := call("POST", "/soulseek/searches", listener.ID, "csrf", map[string]string{"query": "artist song"})
	if w.Code != 201 || remote.searches != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
	var search domain.SoulseekSearch
	json.Unmarshal(w.Body.Bytes(), &search)
	if w = call("GET", "/soulseek/searches/"+search.ID, admin.ID, "", nil); w.Code != 404 {
		t.Fatal("other user's search leaked", w.Code)
	}
	cfg.Users = nil
	repo.SaveSoulseekSettings(ctx, cfg)
	if w = call("POST", "/soulseek/searches", listener.ID, "csrf", map[string]string{"query": "artist song"}); w.Code != 403 || remote.searches != 1 {
		t.Fatal("revocation ignored", w.Code)
	}
}
