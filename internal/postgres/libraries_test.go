// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/postgres"
)

func emptyLibraries(t *testing.T, r *postgres.Store) {
	t.Helper()
	ctx := context.Background()
	libs, e := r.MusicLibraries(ctx)
	if e != nil {
		t.Fatal(e)
	}
	for _, l := range libs {
		if e = r.DeleteMusicLibrary(ctx, l.ID); e != nil {
			t.Fatal(e)
		}
	}
}
func TestNamedLibraryPermissions(t *testing.T) {
	r, _ := fixture(t)
	emptyLibraries(t, r)
	ctx := context.Background()
	admin, e := r.CreateUser(ctx, domain.User{Username: "admin", Password: "hash"}, true)
	if e != nil {
		t.Fatal(e)
	}
	alice, e := r.CreateUser(ctx, domain.User{Username: "alice", Password: "hash"}, false)
	if e != nil {
		t.Fatal(e)
	}
	bob, e := r.CreateUser(ctx, domain.User{Username: "bob", Password: "hash"}, false)
	if e != nil {
		t.Fatal(e)
	}
	ids := []string{}
	for _, p := range []string{"/music/Family/a.mp3", "/music/FamilyOther/b.mp3", "/music/Private/c.mp3"} {
		id, e := r.UpsertTrack(ctx, domain.Track{Path: p, Root: "/music", Title: "Song", Artist: "Artist", Album: "Album", AlbumArtist: "Artist"}, "scan")
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	check := func(user string, n int, libraryID string) {
		t.Helper()
		p, e := r.Tracks(ctx, user, domain.Query{Limit: 100, LibraryID: libraryID})
		if e != nil || p.Total != int64(n) || len(p.Items) != n {
			t.Fatalf("user %s library %s: %+v %v", user, libraryID, p, e)
		}
	}
	check(admin.ID, 0, "")
	check(alice.ID, 0, "")
	family, e := r.SaveMusicLibrary(ctx, domain.MusicLibrary{Name: "Family", Folders: []string{"/music/Family"}, Users: []string{alice.ID}})
	if e != nil {
		t.Fatal(e)
	}
	private, e := r.SaveMusicLibrary(ctx, domain.MusicLibrary{Name: "Private", Folders: []string{"/music/Private"}})
	if e != nil {
		t.Fatal(e)
	}
	check(admin.ID, 2, "")
	check(alice.ID, 1, "")
	check(bob.ID, 0, "")
	check(alice.ID, 0, private.ID)
	for _, user := range []string{alice.ID, bob.ID} {
		if _, e = r.Track(ctx, user, ids[2]); !errors.Is(e, domain.ErrNotFound) {
			t.Fatal("direct track leaked", e)
		}
	}
	group, e := r.CreateGroup(ctx, "Family")
	if e != nil {
		t.Fatal(e)
	}
	if e = r.SetGroups(ctx, bob.ID, []string{group.ID}); e != nil {
		t.Fatal(e)
	}
	family.Groups = []string{group.ID}
	if _, e = r.SaveMusicLibrary(ctx, family); e != nil {
		t.Fatal(e)
	}
	check(bob.ID, 1, "")
	broader, e := r.SaveMusicLibrary(ctx, domain.MusicLibrary{Name: "All", Folders: []string{"/music"}, Everyone: true})
	if e != nil {
		t.Fatal(e)
	}
	check(alice.ID, 3, "")
	check(bob.ID, 1, family.ID)
	albums, e := r.AlbumsInLibrary(ctx, bob.ID, "", "", family.ID, 100, 0)
	if e != nil || len(albums) != 1 || albums[0].Tracks != 1 {
		t.Fatal("filtered album counts", albums, e)
	}
	artists, e := r.ArtistsInLibrary(ctx, bob.ID, "", family.ID, 100, 0)
	if e != nil || len(artists) != 1 || artists[0].Tracks != 1 {
		t.Fatal("filtered artist counts", artists, e)
	}
	exclusion, e := r.CreateExclusion(ctx, domain.Exclusion{GroupID: group.ID, Kind: "folder", Target: "/music/Family"})
	if e != nil {
		t.Fatal(e)
	}
	check(bob.ID, 2, "")
	if e = r.SetGroups(ctx, admin.ID, []string{group.ID}); e != nil {
		t.Fatal(e)
	}
	check(admin.ID, 2, "")
	if e = r.DeleteExclusion(ctx, exclusion.ID); e != nil {
		t.Fatal(e)
	}
	if e = r.DeleteMusicLibrary(ctx, broader.ID); e != nil {
		t.Fatal(e)
	}
	check(alice.ID, 1, "")
	if e = r.Like(ctx, alice.ID, ids[0], true); e != nil {
		t.Fatal(e)
	}
	if e = r.RecordPlay(ctx, alice.ID, ids[0], "library-test"); e != nil {
		t.Fatal(e)
	}
	playlist, e := r.CreatePlaylist(ctx, alice.ID, "Family mix", "music")
	if e != nil {
		t.Fatal(e)
	}
	if e = r.AddPlaylistTrack(ctx, alice.ID, playlist.ID, ids[0]); e != nil {
		t.Fatal(e)
	}
	family.Users = nil
	family.Groups = nil
	if _, e = r.SaveMusicLibrary(ctx, family); e != nil {
		t.Fatal(e)
	}
	check(alice.ID, 0, "")
	check(bob.ID, 0, "")
	for _, q := range []domain.Query{{Collection: "likes", Limit: 100}, {Collection: "history", Limit: 100}, {Playlist: playlist.ID, Limit: 100}} {
		page, e := r.Tracks(ctx, alice.ID, q)
		if e != nil || page.Total != 0 {
			t.Fatal("revoked personal collection leaked", page, e)
		}
	}
	allowed, e := r.AllowedIDs(ctx, alice.ID, ids)
	if e != nil || len(allowed) != 0 {
		t.Fatal("revocation check", allowed, e)
	}
	family.Users = []string{alice.ID}
	if _, e = r.SaveMusicLibrary(ctx, family); e != nil {
		t.Fatal(e)
	}
	check(alice.ID, 1, "")
	for _, q := range []domain.Query{{Collection: "likes", Limit: 100}, {Collection: "history", Limit: 100}, {Playlist: playlist.ID, Limit: 100}} {
		page, e := r.Tracks(ctx, alice.ID, q)
		if e != nil || page.Total != 1 {
			t.Fatal("personal data erased by revocation", page, e)
		}
	}
	if e = r.DeleteMusicLibrary(ctx, family.ID); e != nil {
		t.Fatal(e)
	}
	check(alice.ID, 0, "")
	if _, e = r.TrackByPath(ctx, "/music/Family/a.mp3"); e != nil {
		t.Fatal("library deletion erased catalog", e)
	}
	private.Users = []string{"missing-user"}
	if _, e = r.SaveMusicLibrary(ctx, private); !errors.Is(e, domain.ErrConflict) {
		t.Fatal("invalid user accepted", e)
	}
	libs, e := r.MusicLibraries(ctx)
	if e != nil || len(libs) != 1 || len(libs[0].Users) != 0 || len(libs[0].Folders) != 1 {
		t.Fatal("failed save was not atomic", libs, e)
	}
}

func TestMusicLibraryHTTPAndHiddenMedia(t *testing.T) {
	r, _ := fixture(t)
	emptyLibraries(t, r)
	ctx := context.Background()
	root := t.TempDir()
	folder := filepath.Join(root, "Family")
	if e := os.Mkdir(folder, 0700); e != nil {
		t.Fatal(e)
	}
	admin, e := r.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, true)
	if e != nil {
		t.Fatal(e)
	}
	listener, e := r.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, false)
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range []struct {
		u     domain.User
		token string
	}{{admin, "admin"}, {listener, "listener"}} {
		h := sha256.Sum256([]byte(v.token))
		if e = r.SaveSession(ctx, hex.EncodeToString(h[:]), v.u.ID, "csrf", time.Now().Add(time.Hour), v.u.Password); e != nil {
			t.Fatal(e)
		}
	}
	handler := (&httpapi.Server{Repo: r, Config: httpapi.Config{Roots: []string{root}}}).Handler()
	call := func(method, path, token string, body any) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(string(data)))
		req.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", "csrf")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	body := map[string]any{"name": "Family", "folders": []string{folder}, "users": []string{listener.ID}, "groups": []string{}, "everyone": false}
	if w := call("POST", "/admin/libraries", "listener", body); w.Code != 403 {
		t.Fatal("listener created library", w.Code)
	}
	w := call("POST", "/admin/libraries", "admin", body)
	var l domain.MusicLibrary
	if e = json.Unmarshal(w.Body.Bytes(), &l); e != nil || w.Code != 201 || l.ID == "" {
		t.Fatal("create library", w.Code, w.Body.String(), e)
	}
	path := filepath.ToSlash(filepath.Join(folder, "song.mp3"))
	id, e := r.UpsertTrack(ctx, domain.Track{Path: path, Root: filepath.ToSlash(root), Title: "Song", Artist: "Artist"}, "scan")
	if e != nil {
		t.Fatal(e)
	}
	w = call("GET", "/libraries", "listener", nil)
	if w.Code != 200 || strings.Contains(w.Body.String(), "folders") || strings.Contains(w.Body.String(), "everyone") || !strings.Contains(w.Body.String(), l.ID) {
		t.Fatal("listener library response", w.Body.String())
	}
	body["users"] = []string{}
	if w = call("PUT", "/admin/libraries/"+l.ID, "admin", body); w.Code != 200 {
		t.Fatal("unshare", w.Code, w.Body.String())
	}
	for _, suffix := range []string{"", "/stream", "/art", "/lyrics"} {
		if w = call("GET", "/tracks/"+id+suffix, "listener", nil); w.Code != 404 {
			t.Fatal("hidden media", suffix, w.Code, w.Body.String())
		}
	}
	for _, invalid := range []string{t.TempDir(), folder + "/../escape"} {
		body["folders"] = []string{invalid}
		if w = call("PUT", "/admin/libraries/"+l.ID, "admin", body); w.Code != 400 {
			t.Fatal("unsafe folder accepted", w.Code)
		}
	}
	body["folders"] = []string{folder}
	body["users"] = []string{"nonexistent"}
	if w = call("PUT", "/admin/libraries/"+l.ID, "admin", body); w.Code != 409 {
		t.Fatal("invalid recipient accepted", w.Code)
	}
	if e = os.Rename(folder, folder+"-unavailable"); e != nil {
		t.Fatal(e)
	}
	body["users"] = []string{}
	if w = call("PUT", "/admin/libraries/"+l.ID, "admin", body); w.Code != 200 {
		t.Fatal("missing mount prevented unsharing", w.Code, w.Body.String())
	}
	if w = call("DELETE", "/admin/libraries/"+l.ID, "admin", nil); w.Code != 200 {
		t.Fatal("delete", w.Code)
	}
	if _, e = r.TrackByPath(ctx, path); e != nil {
		t.Fatal("delete erased track", e)
	}
}

func TestLibrariesFreshAndLegacyInitialization(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "fresh", true: "upgrade"}[legacy], func(t *testing.T) {
			r, c := fixture(t)
			emptyLibraries(t, r)
			ctx := context.Background()
			u, e := r.CreateUser(ctx, domain.User{Username: "owner", Password: "hash"}, true)
			if e != nil {
				t.Fatal(e)
			}
			trackID, e := r.UpsertTrack(ctx, domain.Track{Path: "/music/a.mp3", Root: "/music", Title: "Song"}, "scan")
			if e != nil {
				t.Fatal(e)
			}
			if legacy {
				if _, e = c.Exec(ctx, `DROP TABLE library_folders,library_users,library_groups,music_libraries;DELETE FROM settings WHERE key IN ('libraries_initialized','libraries_legacy_pending');DELETE FROM schema_migrations WHERE version=13`); e != nil {
					t.Fatal(e)
				}
				var schema string
				if e = c.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); e != nil {
					t.Fatal(e)
				}
				uri, _ := url.Parse(os.Getenv("TEST_DATABASE_URL"))
				q := uri.Query()
				q.Set("search_path", schema)
				uri.RawQuery = q.Encode()
				upgraded, e := postgres.Open(ctx, uri.String())
				if e != nil {
					t.Fatal(e)
				}
				defer upgraded.Close()
				r = upgraded
			}
			if e = r.InitializeLibraries(ctx, []string{"/music"}); e != nil {
				t.Fatal(e)
			}
			libs, e := r.MusicLibraries(ctx)
			if e != nil {
				t.Fatal(e)
			}
			if legacy {
				if len(libs) != 1 || libs[0].Name != "Existing music" || !libs[0].Everyone {
					t.Fatal("legacy access missing", libs)
				}
				if track, e := r.Track(ctx, u.ID, trackID); e != nil || track.ID != trackID {
					t.Fatal("legacy identity/access lost", e)
				}
			} else if len(libs) != 0 {
				t.Fatal("fresh installation auto-shared mount", libs)
			}
			emptyLibraries(t, r)
			if e = r.InitializeLibraries(ctx, []string{"/music"}); e != nil {
				t.Fatal(e)
			}
			libs, e = r.MusicLibraries(ctx)
			if e != nil || len(libs) != 0 {
				t.Fatal("deleted compatibility library recreated", libs, e)
			}
		})
	}
}

func TestFinishFolderPreservesUnrelatedAndRetainedCatalog(t *testing.T) {
	r, _ := fixture(t)
	ctx := context.Background()
	for _, p := range []string{"/music/Family/missing.mp3", "/music/FamilyOther/other.mp3"} {
		if _, e := r.UpsertTrack(ctx, domain.Track{Path: p, Root: "/music", Title: "Song"}, "old"); e != nil {
			t.Fatal(e)
		}
	}
	if e := r.FinishFolder(ctx, "/music/Family", "new"); e != nil {
		t.Fatal(e)
	}
	if _, e := r.TrackByPath(ctx, "/music/FamilyOther/other.mp3"); e != nil {
		t.Fatal("sibling marked missing", e)
	}
	// Missing tracks stay in the catalog and recover their ID on the next scan.
	before, e := r.TrackByPath(ctx, "/music/Family/missing.mp3")
	if e != nil {
		t.Fatal(e)
	}
	id, e := r.UpsertTrack(ctx, before, "new")
	if e != nil || id != before.ID {
		t.Fatal("missing track identity lost", e)
	}
}
