// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/library"
	"cadence/internal/media"
	"cadence/internal/postgres"
	"cadence/internal/repositorytest"
	"github.com/jackc/pgx/v5"
)

func fixture(t testing.TB) (*postgres.Store, *pgx.Conn) {
	t.Helper()
	uri := os.Getenv("TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("set TEST_DATABASE_URL for disposable PostgreSQL integration tests")
	}
	ctx := context.Background()
	c, e := pgx.Connect(ctx, uri)
	if e != nil {
		t.Fatal(e)
	}
	name := "cadence_test_" + postgres.ID()
	safe := pgx.Identifier{name}.Sanitize()
	if _, e = c.Exec(ctx, "CREATE SCHEMA "+safe); e != nil {
		c.Close(ctx)
		t.Fatal(e)
	}
	u, e := url.Parse(uri)
	if e != nil {
		t.Fatal(e)
	}
	q := u.Query()
	q.Set("search_path", name)
	u.RawQuery = q.Encode()
	r, e := postgres.Open(ctx, u.String())
	if e != nil {
		c.Exec(ctx, "DROP SCHEMA "+safe+" CASCADE")
		c.Close(ctx)
		t.Fatal(e)
	}
	t.Cleanup(func() { r.Close(); c.Exec(ctx, "DROP SCHEMA "+safe+" CASCADE"); c.Close(ctx) })
	if _, e = c.Exec(ctx, "SET search_path TO "+safe); e != nil {
		t.Fatal(e)
	}
	return r, c
}
func TestRepositoryContract(t *testing.T) {
	repositorytest.Run(t, func(t *testing.T) domain.Repository { r, _ := fixture(t); return r })
}
func requireTools(t *testing.T) {
	for _, name := range []string{"ffmpeg", "ffprobe"} {
		if _, e := exec.LookPath(name); e != nil {
			t.Skip(name + " unavailable")
		}
	}
}
func generate(t *testing.T, path string) {
	t.Helper()
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-metadata", "title=  A song  ", "-metadata", "artist=Artist", "-metadata", "album=Album", "-y", path)
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("fixture audio: %v %s", e, b)
	}
}
func waitScan(t *testing.T, r domain.Repository, id string) {
	t.Helper()
	until := time.Now().Add(20 * time.Second)
	for time.Now().Before(until) {
		scans, e := r.Scans(context.Background())
		if e != nil {
			t.Fatal(e)
		}
		for _, s := range scans {
			if s.ID == id && s.Finished != nil {
				return
			}
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatal("scan timed out")
}
func TestScannerAndHTTP(t *testing.T) {
	requireTools(t)
	r, _ := fixture(t)
	ctx := context.Background()
	root := t.TempDir()
	data := t.TempDir()
	song := filepath.Join(root, "01-Unicode-音.flac")
	generate(t, song)
	original, e := os.ReadFile(song)
	if e != nil {
		t.Fatal(e)
	}
	f, e := os.Create(filepath.Join(root, "cover.png"))
	if e != nil {
		t.Fatal(e)
	}
	if e = png.Encode(f, image.NewRGBA(image.Rect(0, 0, 20, 30))); e != nil {
		t.Fatal(e)
	}
	f.Close()
	os.WriteFile(filepath.Join(root, "bad.mp3"), []byte("corrupt"), 0644)
	scanner := &library.Scanner{Repo: r, Roots: []string{root}, ArtDir: filepath.Join(data, "artwork"), Context: ctx}
	id, ok := scanner.Start(false)
	if !ok {
		t.Fatal("scan failed to start")
	}
	waitScan(t, r, id)
	admin, e := r.CreateUser(ctx, domain.User{Name: "admin", Password: "hash"}, true)
	if e != nil {
		t.Fatal(e)
	}
	user, e := r.CreateUser(ctx, domain.User{Name: "user", Password: "hash"}, false)
	if e != nil {
		t.Fatal(e)
	}
	p, e := r.Tracks(ctx, user.ID, domain.Query{Limit: 100})
	if e != nil || p.Total != 1 {
		t.Fatalf("scan catalog: %v %+v", e, p)
	}
	track := p.Items[0]
	if !track.Artwork {
		t.Fatal("folder artwork not extracted")
	}
	suggestions, e := r.Suggestions(ctx, 100, 0)
	if e != nil || len(suggestions) == 0 {
		t.Fatalf("scan suggestions: %v", e)
	}
	for _, s := range suggestions {
		if s.Field == "title" {
			if e = r.ResolveSuggestion(ctx, s.ID, true); e != nil {
				t.Fatal(e)
			}
		}
	}
	id, ok = scanner.Start(true)
	if !ok {
		t.Fatal("full scan not started")
	}
	waitScan(t, r, id)
	p, e = r.Tracks(ctx, user.ID, domain.Query{Limit: 100})
	if e != nil || p.Items[0].Title != "A song" {
		t.Fatal("override lost during rescan")
	}
	after, _ := os.ReadFile(song)
	if !bytes.Equal(original, after) {
		t.Fatal("scan modified source audio")
	}
	cache, e := media.New(filepath.Join(data, "transcodes"), 32<<20, 2, ctx)
	if e != nil {
		t.Fatal(e)
	}
	app := &httpapi.Server{Repo: r, Scanner: scanner, Cache: cache, Config: httpapi.Config{Roots: []string{root}, ArtDir: scanner.ArtDir, SetupToken: "integration-test-token", PublicURL: "http://example.test", WebDir: "../../web/dist"}}
	handler := app.Handler()
	makeSession := func(u domain.User, token string) {
		hash := sha256.Sum256([]byte(token))
		if e = r.SaveSession(ctx, hex.EncodeToString(hash[:]), u.ID, "csrf-test-token", time.Now().Add(time.Hour)); e != nil {
			t.Fatal(e)
		}
	}
	makeSession(user, "user-token")
	makeSession(admin, "admin-token")
	request := func(method, path, token, body, csrf, origin, rangeValue string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", csrf)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if rangeValue != "" {
			req.Header.Set("Range", rangeValue)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	assert := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("want %d got %d: %s", status, w.Code, w.Body.String())
		}
	}
	assert(request("GET", "/api/v1/tracks", "", "", "", "", ""), 401)
	assert(request("GET", "/api/v1/admin/users", "user-token", "", "", "", ""), 403)
	assert(request("POST", "/api/v1/playlists", "user-token", `{"name":"Mix"}`, "", "", ""), 403)
	assert(request("POST", "/api/v1/playlists", "user-token", `{"name":"Mix"}`, "csrf-test-token", "http://evil.test", ""), 403)
	w := request("GET", "/api/v1/tracks/"+track.ID+"/stream?quality=original", "user-token", "", "", "", "bytes=0-9")
	assert(w, 206)
	if w.Body.Len() != 10 {
		t.Fatal("original range invalid")
	}
	w = request("GET", "/api/v1/tracks/"+track.ID+"/stream?quality=saver", "user-token", "", "", "", "bytes=0-99")
	assert(w, 206)
	if w.Body.Len() != 100 {
		t.Fatal("transcoded range invalid")
	}
	assert(request("GET", "/api/v1/tracks/"+track.ID+"/art", "user-token", "", "", "", ""), 200)
	if e = r.AddSuggestion(ctx, domain.Suggestion{TrackID: track.ID, Field: "artwork", Value: track.ArtPath, Source: "preview-test"}); e != nil {
		t.Fatal(e)
	}
	artSuggestions, e := r.Suggestions(ctx, 100, 0)
	if e != nil {
		t.Fatal(e)
	}
	for _, s := range artSuggestions {
		if s.Field == "artwork" {
			assert(request("GET", "/api/v1/admin/suggestions/"+s.ID+"/art", "admin-token", "", "", "", ""), 200)
			assert(request("GET", "/api/v1/admin/suggestions/"+s.ID+"/art", "user-token", "", "", "", ""), 403)
		}
	}
	assert(request("GET", "/api/v1/tracks/"+track.ID+"/stream?quality=original", "user-token", "", "", "", "bytes=999999999-"), 416)
	// Twenty concurrent media requests share a conversion and must all seek correctly.
	results := make(chan *httptest.ResponseRecorder, 20)
	for i := 0; i < 20; i++ {
		go func() {
			results <- request("GET", "/api/v1/tracks/"+track.ID+"/stream?quality=high", "user-token", "", "", "", "bytes=0-99")
		}()
	}
	for i := 0; i < 20; i++ {
		w := <-results
		assert(w, 206)
		if w.Body.Len() != 100 {
			t.Fatal("concurrent media range invalid")
		}
	}
	assert(request("GET", "/api/v1/tracks/"+track.ID+"/stream?quality=invalid", "user-token", "", "", "", ""), 400)
	g, e := r.CreateGroup(ctx, "blocked")
	if e != nil {
		t.Fatal(e)
	}
	if e = r.SetGroups(ctx, user.ID, []string{g.ID}); e != nil {
		t.Fatal(e)
	}
	if _, e = r.CreateExclusion(ctx, domain.Exclusion{GroupID: g.ID, Kind: "track", Target: track.ID}); e != nil {
		t.Fatal(e)
	}
	for _, suffix := range []string{"", "/art", "/stream?quality=original", "/stream?quality=saver"} {
		assert(request("GET", "/api/v1/tracks/"+track.ID+suffix, "user-token", "", "", "", ""), 404)
	}
	w = request("GET", "/api/v1/albums", "user-token", "", "", "", "")
	assert(w, 200)
	if strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal("excluded album leaked")
	}
	w = request("POST", "/api/v1/permissions/check", "user-token", `{"ids":["`+track.ID+`"]}`, "csrf-test-token", "", "")
	assert(w, 200)
	if !strings.Contains(w.Body.String(), `"allowed":[]`) {
		t.Fatal("cached permission refresh failed")
	}
	assert(request("POST", "/api/v1/logout", "user-token", `{}`, "csrf-test-token", "", ""), 200)
	assert(request("GET", "/api/v1/me", "user-token", "", "", "", ""), 401)
	// Mount loss must preserve entries; actual removals must become unavailable.
	scanner.Roots = []string{filepath.Join(root, "unavailable")}
	id, ok = scanner.Start(false)
	if !ok {
		t.Fatal("missing-root scan failed")
	}
	waitScan(t, r, id)
	p, e = r.Tracks(ctx, admin.ID, domain.Query{Limit: 100})
	if e != nil || p.Total != 1 {
		t.Fatal("unavailable mount erased entries")
	}
	scanner.Roots = []string{root}
	os.Remove(song)
	id, ok = scanner.Start(false)
	if !ok {
		t.Fatal("removal scan failed")
	}
	waitScan(t, r, id)
	p, e = r.Tracks(ctx, admin.ID, domain.Query{Limit: 100})
	if e != nil || p.Total != 0 {
		t.Fatal("removed file remains available")
	}
}

func TestSetupAndLogin(t *testing.T) {
	r, _ := fixture(t)
	app := &httpapi.Server{Repo: r, Config: httpapi.Config{SetupToken: "a-valid-setup-token", PublicURL: "http://example.test"}}
	h := app.Handler()
	post := func(path, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(w, req)
		return w
	}
	w := post("/api/v1/setup", `{"name":"owner","password":"a-strong-password","setupToken":"wrong"}`)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	w = post("/api/v1/setup", `{"name":"owner","password":"a-strong-password","setupToken":"a-valid-setup-token"}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var session struct {
		CSRF string `json:"csrf"`
	}
	json.Unmarshal(w.Body.Bytes(), &session)
	if session.CSRF == "" || !w.Result().Cookies()[0].HttpOnly {
		t.Fatal("invalid authentication response")
	}
	w = post("/api/v1/setup", `{"name":"other","password":"a-strong-password","setupToken":"a-valid-setup-token"}`)
	if w.Code != 409 {
		t.Fatal("second setup allowed")
	}
	w = post("/api/v1/login", `{"name":"owner","password":"incorrect"}`)
	if w.Code != 401 {
		t.Fatal("wrong password allowed")
	}
	w = post("/api/v1/login", `{"name":"owner","password":"a-strong-password"}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestReopenPreservesCatalogAndOverrides(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	u, e := r.CreateUser(ctx, domain.User{Name: "persisted-owner", Password: "hash"}, true)
	if e != nil {
		t.Fatal(e)
	}
	id, e := r.UpsertTrack(ctx, domain.Track{Path: "/music/persist.flac", Root: "/music", Title: "Original", Artist: "Artist", AlbumArtist: "Artist", Album: "Album", AlbumID: "album", MIME: "audio/flac", Codec: "flac"}, "scan")
	if e != nil {
		t.Fatal(e)
	}
	if e = r.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: "title", Value: "Persistent override", Source: "test"}); e != nil {
		t.Fatal(e)
	}
	suggestions, e := r.Suggestions(ctx, 100, 0)
	if e != nil {
		t.Fatal(e)
	}
	if e = r.ResolveSuggestion(ctx, suggestions[0].ID, true); e != nil {
		t.Fatal(e)
	}
	var schema string
	if e = c.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); e != nil {
		t.Fatal(e)
	}
	r.Close()
	uri, _ := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	q := uri.Query()
	q.Set("search_path", schema)
	uri.RawQuery = q.Encode()
	reopened, e := postgres.Open(ctx, uri.String())
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	track, e := reopened.Track(ctx, u.ID, id)
	if e != nil || track.Title != "Persistent override" {
		t.Fatal("catalog/override persistence failed", e)
	}
	var versions int
	if e = c.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&versions); e != nil || versions != 1 {
		t.Fatal("migration reapplied", e)
	}
}

func BenchmarkLargeLibrary(b *testing.B) {
	r, c := fixture(b)
	ctx := context.Background()
	u, e := r.CreateUser(ctx, domain.User{Name: "bench", Password: "hash"}, true)
	if e != nil {
		b.Fatal(e)
	}
	_, e = c.Exec(ctx, `INSERT INTO tracks(id,path,root,size,modified,seen,title,artist,album_artist,album,album_id,number,disc,year,genre,duration,codec,mime) SELECT 'bench-'||n,'/music/'||n||'.flac','/music',100,1,'bench','Song '||n,'Artist '||(n%1000),'Artist '||(n%1000),'Album '||(n/12),'album-'||(n/12),n%12,1,'2025','Rock',180,'flac','audio/flac' FROM generate_series(1,250000) n`)
	if e != nil {
		b.Fatal(e)
	}
	_, e = c.Exec(ctx, "ANALYZE tracks")
	if e != nil {
		b.Fatal(e)
	}
	b.Run("tracks_250k", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, e := r.Tracks(ctx, u.ID, domain.Query{Limit: 100}); e != nil {
				b.Fatal(e)
			}
		}
	})
	b.Run("search_250k", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, e := r.Tracks(ctx, u.ID, domain.Query{Search: "Song 12345", Limit: 100}); e != nil {
				b.Fatal(e)
			}
		}
	})
	b.Run("20_concurrent_catalog_readers", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			results := make(chan error, 20)
			for j := 0; j < 20; j++ {
				go func() { _, e := r.Tracks(ctx, u.ID, domain.Query{Search: "Song 12345", Limit: 100}); results <- e }()
			}
			for j := 0; j < 20; j++ {
				if e := <-results; e != nil {
					b.Fatal(e)
				}
			}
		}
	})
}
