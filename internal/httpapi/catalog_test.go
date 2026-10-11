// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"cadence/internal/library"
	"cadence/internal/soulseek"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type catalogTransport func(*http.Request) (*http.Response, error)

func (f catalogTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestCatalogHTTPAccessAndValidation(t *testing.T) {
	for _, tc := range []struct {
		path               string
		signed, configured bool
		want               int
	}{
		{"/api/v1/catalog/search?type=album&q=Record", false, true, 401},
		{"/api/v1/catalog/search?type=album&q=Record", true, true, 200},
		{"/api/v1/catalog/search?type=album&q=Record", true, false, 503},
		{"/api/v1/catalog/search?type=invalid&q=Record", true, true, 400},
		{"/api/v1/catalog/search?type=album&q=x", true, true, 400},
		{"/api/v1/catalog/albums/bad-id", true, true, 400},
		{"/api/v1/catalog/artists/12345678-1234-1234-1234-123456789012/albums?limit=500&offset=25", true, true, 200},
	} {
		t.Run(tc.path+string(rune(tc.want)), func(t *testing.T) {
			e := &library.Enricher{Client: &http.Client{Transport: catalogTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Query().Get("artist") != "" && (r.URL.Query().Get("limit") != "100" || r.URL.Query().Get("offset") != "25") {
					t.Fatal("pagination", r.URL)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"count":0,"release-groups":[]}`))}, nil
			})}}
			if tc.configured {
				e.UserAgent = "tests/contact"
			}
			s := &Server{Repo: &originRepo{}, Scanner: &library.Scanner{Enricher: e}}
			r := httptest.NewRequest("GET", tc.path, nil)
			if tc.signed {
				r.AddCookie(&http.Cookie{Name: "cadence_session", Value: "test"})
			}
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}
func TestFolderDetailsPreservesPolicyAndPeerAccess(t *testing.T) {
	cfg := domain.DefaultSoulseekSettings()
	cfg.Enabled = true
	cfg.Users = []string{"listener"}
	s := &Server{Soulseek: &soulseek.Service{Configured: true, Repo: &qualityRepo{settings: cfg}, Remote: &qualityRemote{files: []domain.SoulseekFile{
		{Filename: `Music\Album\good.flac`, Size: 100, SampleRate: 44100, BitDepth: 16},
		{Filename: `Music\Album\bad.mp3`, Size: 100},
	}}}}
	for _, tc := range []struct {
		user, peer string
		want       int
	}{{"listener", "peer", 200}, {"listener", "unmatched", 400}, {"other", "peer", 403}} {
		r := httptest.NewRequest("POST", "/api/v1/soulseek/folder-details", strings.NewReader(`{"searchId":"`+soulseek.ID()+`","username":"`+tc.peer+`","folder":"Music/Album"}`))
		r.Header.Set("Content-Type", "application/json")
		r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, domain.Session{User: domain.User{ID: tc.user}}))
		w := httptest.NewRecorder()
		s.soulseekFolder(w, r)
		if w.Code != tc.want {
			t.Fatal(w.Code, w.Body.String())
		}
		if tc.want == 200 && (!strings.Contains(w.Body.String(), `"excludedAudioCount":1`) || strings.Contains(w.Body.String(), "bad.mp3")) {
			t.Fatal(w.Body.String())
		}
	}
}
