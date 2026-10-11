// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"cadence/internal/library"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

type losslessRepo struct {
	originRepo
	track  domain.Track
	denied bool
}

func (r *losslessRepo) Track(context.Context, string, string) (domain.Track, error) {
	if r.denied {
		return domain.Track{}, domain.ErrNotFound
	}
	return r.track, nil
}
func TestLosslessStreaming(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "song.flac")
	if err := os.WriteFile(path, []byte("original audio bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	var err error
	path, err = library.Canonical(path)
	if err != nil {
		t.Fatal(err)
	}
	repo := &losslessRepo{track: domain.Track{ID: "song", Path: path, Codec: "flac", MIME: "audio/flac"}}
	handler := (&Server{Repo: repo, Config: Config{Roots: []string{root}}}).Handler()
	request := func(method, quality, byteRange string, auth bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/v1/tracks/song/stream?quality="+quality, nil)
		if auth {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: "test"})
		}
		if byteRange != "" {
			req.Header.Set("Range", byteRange)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	for _, codec := range []string{"flac", "alac", "pcm_s16le"} {
		repo.track.Codec = codec
		w := request("GET", "lossless", "", true)
		if w.Code != 200 || w.Body.String() != "original audio bytes" || w.Header().Get("Content-Type") != "audio/flac" {
			t.Fatalf("original %s: %d %s", codec, w.Code, w.Body.String())
		}
		w = request("GET", "lossless", "bytes=0-7", true)
		if w.Code != 206 || w.Body.String() != "original" {
			t.Fatalf("range: %d %s", w.Code, w.Body.String())
		}
		w = request("HEAD", "lossless", "", true)
		if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") != "20" {
			t.Fatalf("HEAD: %d %v", w.Code, w.Header())
		}
	}
	for _, codec := range []string{"mp3", "aac", "adpcm_ms", "pcm_alaw", ""} {
		repo.track.Codec = codec
		for _, method := range []string{"GET", "HEAD"} {
			if w := request(method, "lossless", "", true); w.Code != 409 {
				t.Fatalf("%s %s allowed: %d", method, codec, w.Code)
			}
		}
	}
	if w := request("GET", "original", "", true); w.Code != 200 {
		t.Fatal("original override rejected", w.Code)
	}
	if w := request("GET", "invalid", "", true); w.Code != 400 {
		t.Fatal("invalid quality accepted", w.Code)
	}
	if w := request("GET", "lossless", "", false); w.Code != 401 {
		t.Fatal("anonymous access", w.Code)
	}
	repo.denied = true
	if w := request("GET", "lossless", "", true); w.Code != 404 {
		t.Fatal("inaccessible track allowed", w.Code)
	}
	repo.denied = false
	repo.track.Path = filepath.Join(t.TempDir(), "outside.flac")
	if w := request("GET", "lossless", "", true); w.Code != 404 {
		t.Fatal("outside root allowed", w.Code)
	}
}
