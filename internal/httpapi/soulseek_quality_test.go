// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"cadence/internal/soulseek"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type qualityRepo struct {
	domain.SoulseekRepository
	settings domain.SoulseekSettings
	saved    domain.SoulseekRequest
}

func TestSoulseekPlacementAlwaysSeparate(t *testing.T) {
	cfg := domain.DefaultSoulseekSettings()
	cfg.Presentation = "combined"
	s := &Server{Soulseek: &soulseek.Service{Repo: &qualityRepo{settings: cfg}}}
	for _, path := range []string{"/soulseek/capabilities", "/admin/soulseek"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if path == "/admin/soulseek" {
			s.soulseekSettings(w, r)
		} else {
			s.soulseekCapabilities(w, r)
		}
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"presentation":"separate"`) || strings.Contains(w.Body.String(), "combined") {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
	}
}

func (r *qualityRepo) SoulseekSettings(context.Context) (domain.SoulseekSettings, error) {
	return r.settings, nil
}
func (r *qualityRepo) OwnsSoulseekSearch(context.Context, string, string) (bool, error) {
	return true, nil
}
func (r *qualityRepo) SoulseekRequest(context.Context, string) (domain.SoulseekRequest, error) {
	return domain.SoulseekRequest{}, domain.ErrNotFound
}
func (r *qualityRepo) SaveSoulseekRequest(_ context.Context, v *domain.SoulseekRequest) error {
	r.saved = *v
	return nil
}

type qualityRemote struct {
	soulseek.Remote
	files []domain.SoulseekFile
}

func (r *qualityRemote) Folder(context.Context, string, string) ([]domain.SoulseekFile, error) {
	return r.files, nil
}
func (r *qualityRemote) Search(_ context.Context, id string) (domain.SoulseekSearch, error) {
	v := domain.SoulseekSearch{ID: id, State: "Completed", Results: []domain.SoulseekResult{}}
	for _, f := range r.files {
		v.Results = append(v.Results, domain.SoulseekResult{Username: "peer", Folder: "Music/Album", SoulseekFile: f})
	}
	return v, nil
}
func TestSoulseekQualityHTTP(t *testing.T) {
	cfg := domain.DefaultSoulseekSettings()
	cfg.Enabled = true
	cfg.Users = []string{"listener"}
	cfg.AllowedFormats = []string{"flac"}
	repo := &qualityRepo{settings: cfg}
	remote := &qualityRemote{files: []domain.SoulseekFile{
		{Filename: `Music\Album\good.flac`, Size: 100, SampleRate: 44100, BitDepth: 16},
		{Filename: `Music\Album\missing.flac`, Size: 100},
		{Filename: `Music\Album\lossy.mp3`, Size: 100},
		{Filename: `Music\Album\other.wav`, Size: 100, SampleRate: 44100, BitDepth: 16},
	}}
	s := &Server{Soulseek: &soulseek.Service{Repo: repo, Remote: remote, Configured: true}}
	searchID := soulseek.ID()
	call := func(method, body string, handler http.HandlerFunc) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.SetPathValue("id", searchID)
		req = req.WithContext(context.WithValue(req.Context(), sessionKey{}, domain.Session{User: domain.User{ID: "listener"}}))
		w := httptest.NewRecorder()
		handler(w, req)
		return w
	}
	w := call("GET", "", s.soulseekSearch)
	var search domain.SoulseekSearch
	if e := json.Unmarshal(w.Body.Bytes(), &search); e != nil || w.Code != 200 || len(search.Results) != 1 {
		t.Fatal("search filtering", w.Code, w.Body.String())
	}
	body := func(id string, album bool, filenames []string) string {
		b, _ := json.Marshal(map[string]any{"id": id, "searchId": searchID, "username": "peer", "folder": "Music/Album", "album": album, "filenames": filenames})
		return string(b)
	}
	folderBody, _ := json.Marshal(map[string]string{"searchId": searchID, "username": "peer", "folder": "Music/Album"})
	w = call("POST", string(folderBody), s.soulseekFolder)
	var folder []domain.SoulseekFile
	if e := json.Unmarshal(w.Body.Bytes(), &folder); e != nil || w.Code != 200 || len(folder) != 1 {
		t.Fatal("folder filtering", w.Code, w.Body.String())
	}
	// Client filenames cannot bypass authoritative peer metadata.
	w = call("POST", body(soulseek.ID(), false, []string{remote.files[1].Filename}), s.soulseekRequests)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "quality policy") {
		t.Fatal("direct API bypass", w.Code, w.Body.String())
	}
	w = call("POST", body(soulseek.ID(), true, nil), s.soulseekRequests)
	if w.Code != 201 || len(repo.saved.Files) != 1 || repo.saved.DownloadPolicy == nil || !repo.saved.DownloadPolicy.LosslessOnly {
		t.Fatal("album selection", w.Code, w.Body.String())
	}
	remote.files = remote.files[1:]
	w = call("POST", body(soulseek.ID(), true, nil), s.soulseekRequests)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "No audio files") {
		t.Fatal("empty album", w.Code, w.Body.String())
	}
	w = call("GET", "", s.soulseekCapabilities)
	var capabilities struct {
		LosslessOnly   bool
		AllowedFormats []string
	}
	if e := json.Unmarshal(w.Body.Bytes(), &capabilities); e != nil || !capabilities.LosslessOnly || len(capabilities.AllowedFormats) != 1 {
		t.Fatal("capabilities", w.Body.String())
	}
}
