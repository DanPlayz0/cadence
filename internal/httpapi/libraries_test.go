// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDiskFolderPickerAccessBoundariesAndPagination(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"A", "B", "C"} {
		if e := os.Mkdir(filepath.Join(root, name), 0700); e != nil {
			t.Fatal(e)
		}
	}
	if e := os.WriteFile(filepath.Join(root, "audio.mp3"), []byte("x"), 0600); e != nil {
		t.Fatal(e)
	}
	repo := &brandingRepo{admin: true}
	handler := (&Server{Repo: repo, Config: Config{Roots: []string{root}}}).Handler()
	call := func(path string, auth bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", path, nil)
		if auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "secret"})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	if w := call("/api/v1/admin/folders", false); w.Code != 401 {
		t.Fatal("anonymous folder access", w.Code)
	}
	repo.admin = false
	if w := call("/api/v1/admin/folders", true); w.Code != 403 {
		t.Fatal("listener folder access", w.Code)
	}
	repo.admin = true
	w := call("/api/v1/admin/folders?"+url.Values{"path": {root}, "limit": {"1"}, "offset": {"1"}}.Encode(), true)
	var page struct {
		Total int          `json:"total"`
		Items []diskFolder `json:"items"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &page); e != nil || w.Code != 200 || page.Total != 3 || len(page.Items) != 1 || page.Items[0].Name != "B" {
		t.Fatalf("unindexed folder page: %d %s %v", w.Code, w.Body.String(), e)
	}
	for _, p := range []string{t.TempDir(), root + "/../escape", filepath.Join(root, "audio.mp3"), filepath.Join(root, "missing")} {
		if w = call("/api/v1/admin/folders?"+url.Values{"path": {p}}.Encode(), true); w.Code != 400 {
			t.Fatalf("unsafe folder: %s %d", p, w.Code)
		}
	}
	link := filepath.Join(root, "outside")
	target := t.TempDir()
	linkErr := os.Symlink(target, link)
	if linkErr != nil && runtime.GOOS == "windows" {
		linkErr = exec.Command("cmd", "/c", "mklink", "/J", link, target).Run()
	}
	if e := linkErr; e != nil {
		t.Log("symlinks unavailable:", e)
	} else {
		if w = call("/api/v1/admin/folders?"+url.Values{"path": {link}}.Encode(), true); w.Code != 400 {
			t.Fatal("escaping symlink exposed")
		}
	}
}
