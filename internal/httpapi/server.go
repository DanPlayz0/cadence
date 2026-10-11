// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"cadence/internal/domain"
	"cadence/internal/library"
	"cadence/internal/lyrics"
	"cadence/internal/media"
	"cadence/internal/scrobble"
	"cadence/internal/soulseek"
	"golang.org/x/crypto/bcrypt"
)

type Config struct {
	PublicURL, WebDir, ArtDir string
	SecureCookie              bool
	AllowAnyOrigin            bool
	Roots                     []string
	PublicURLs                []string
}
type Server struct {
	Repo            domain.Repository
	Scanner         *library.Scanner
	Cache           *media.Cache
	Config          Config
	limiter         loginLimiter
	passwordLimiter loginLimiter
	Lyrics          *lyrics.Client
	Soulseek        *soulseek.Service
	Sync            *scrobble.Service
	soulseekLimiter loginLimiter
}
type sessionKey struct{}

func random() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func tokenHash(v string) string              { b := sha256.Sum256([]byte(v)); return hex.EncodeToString(b[:]) }
func same(a, b string) bool                  { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func current(r *http.Request) domain.Session { return r.Context().Value(sessionKey{}).(domain.Session) }
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		write(w, 404, map[string]string{"error": "Not found"})
	case errors.Is(err, domain.ErrConflict):
		write(w, 409, map[string]string{"error": "Already exists or invalid reference"})
	default:
		slog.Error("request failed", "error", err)
		write(w, 500, map[string]string{"error": "Unable to complete request"})
	}
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		write(w, 415, map[string]string{"error": "Use application/json"})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		write(w, 400, map[string]string{"error": "Invalid JSON request"})
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		write(w, 400, map[string]string{"error": "Expected one JSON value"})
		return false
	}
	return true
}
func validName(v string) bool {
	return strings.TrimSpace(v) != "" && len(v) <= 120 && !strings.ContainsAny(v, "\r\n\x00")
}
func pagination(r *http.Request) (int, int) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	if offset > 10000000 {
		offset = 10000000
	}
	return limit, offset
}
func (s *Server) Handler() http.Handler {
	if s.Lyrics == nil {
		s.Lyrics = lyrics.New()
		if s.Config.PublicURL != "" {
			s.Lyrics.UserAgent = "Cadence/0.1.0 (" + s.Config.PublicURL + ")"
		}
	}
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := s.Repo.Ping(ctx); err != nil {
			write(w, 503, map[string]string{"status": "unavailable"})
			return
		}
		write(w, 200, map[string]string{"status": "ok"})
	})
	m.HandleFunc("GET /api/v1/status", s.status)
	m.HandleFunc("POST /api/v1/setup", s.setup)
	m.HandleFunc("POST /api/v1/login", s.login)
	m.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		v := current(r)
		write(w, 200, map[string]any{"user": v.User, "csrf": v.CSRF})
	})
	m.HandleFunc("PUT /api/v1/me", s.updateProfile)
	m.HandleFunc("GET /api/v1/me/playback", s.playback)
	m.HandleFunc("PUT /api/v1/me/playback", s.playback)
	m.HandleFunc("GET /api/v1/sync", s.syncStatus)
	m.HandleFunc("GET /api/v1/admin/sync/lastfm", s.adminLastFMSettings)
	m.HandleFunc("PUT /api/v1/admin/sync/lastfm", s.adminLastFMSettings)
	m.HandleFunc("DELETE /api/v1/admin/sync/lastfm", s.adminLastFMSettings)
	m.HandleFunc("POST /api/v1/sync/lastfm/authorize", s.syncAuthorize)
	m.HandleFunc("GET /api/v1/sync/lastfm/callback", s.syncCallback)
	m.HandleFunc("POST /api/v1/sync/listenbrainz/connect", s.syncConnect)
	m.HandleFunc("PUT /api/v1/sync/{provider}/preferences", s.syncPreferences)
	m.HandleFunc("DELETE /api/v1/sync/{provider}", s.syncDisconnect)
	m.HandleFunc("POST /api/v1/sync/listens", s.syncListen)
	m.HandleFunc("POST /api/v1/sync/now-playing", s.syncNowPlaying)
	m.HandleFunc("GET /api/v1/sync/{provider}/exports/preview", s.syncExportPreview)
	m.HandleFunc("POST /api/v1/sync/{provider}/exports", s.syncExportStart)
	m.HandleFunc("GET /api/v1/sync/exports/{id}", s.syncExportStatus)
	m.HandleFunc("POST /api/v1/me/password", s.changePassword)
	m.HandleFunc("PUT /api/v1/me/avatar", s.updateAvatar)
	m.HandleFunc("DELETE /api/v1/me/avatar", s.updateAvatar)
	m.HandleFunc("GET /api/v1/users/{id}/avatar", s.userAvatar)
	m.HandleFunc("POST /api/v1/logout", s.logout)
	m.HandleFunc("GET /api/v1/libraries", s.accessibleLibraries)
	m.HandleFunc("GET /api/v1/soulseek/capabilities", s.soulseekCapabilities)
	m.HandleFunc("POST /api/v1/soulseek/searches", s.soulseekSearch)
	m.HandleFunc("GET /api/v1/soulseek/searches/{id}", s.soulseekSearch)
	m.HandleFunc("POST /api/v1/soulseek/folder", s.soulseekFolder)
	m.HandleFunc("GET /api/v1/soulseek/requests", s.soulseekRequests)
	m.HandleFunc("POST /api/v1/soulseek/requests", s.soulseekRequests)
	m.HandleFunc("POST /api/v1/soulseek/requests/{id}/actions", s.soulseekAction)
	m.HandleFunc("GET /api/v1/admin/soulseek", s.soulseekSettings)
	m.HandleFunc("PUT /api/v1/admin/soulseek", s.soulseekSettings)
	m.HandleFunc("GET /api/v1/admin/libraries", s.musicLibraries)
	m.HandleFunc("POST /api/v1/admin/libraries", s.saveMusicLibrary)
	m.HandleFunc("PUT /api/v1/admin/libraries/{id}", s.saveMusicLibrary)
	m.HandleFunc("DELETE /api/v1/admin/libraries/{id}", s.deleteMusicLibrary)
	m.HandleFunc("GET /api/v1/admin/folders", s.musicFolders)
	m.HandleFunc("GET /api/v1/tracks", s.tracks)
	m.HandleFunc("GET /api/v1/albums", func(w http.ResponseWriter, r *http.Request) {
		l, o := pagination(r)
		var v []domain.Album
		var e error
		if id := r.URL.Query().Get("libraryId"); id != "" {
			repo, ok := s.namedLibraries(w)
			if !ok {
				return
			}
			v, e = repo.AlbumsInLibrary(r.Context(), current(r).User.ID, r.URL.Query().Get("q"), r.URL.Query().Get("artist"), id, l, o)
		} else {
			v, e = s.Repo.Albums(r.Context(), current(r).User.ID, r.URL.Query().Get("q"), r.URL.Query().Get("artist"), l, o)
		}
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("GET /api/v1/artists/profile", s.artistProfile)
	m.HandleFunc("POST /api/v1/admin/artists/profile", s.fetchArtistProfile)
	m.HandleFunc("PUT /api/v1/admin/artists/avatar", s.saveArtistAvatar)
	m.HandleFunc("GET /api/v1/artists", func(w http.ResponseWriter, r *http.Request) {
		l, o := pagination(r)
		var v []domain.Artist
		var e error
		if id := r.URL.Query().Get("libraryId"); id != "" {
			repo, ok := s.namedLibraries(w)
			if !ok {
				return
			}
			v, e = repo.ArtistsInLibrary(r.Context(), current(r).User.ID, r.URL.Query().Get("q"), id, l, o)
		} else {
			v, e = s.Repo.Artists(r.Context(), current(r).User.ID, r.URL.Query().Get("q"), l, o)
		}
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("GET /api/v1/tracks/{id}", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Repo.Track(r.Context(), current(r).User.ID, r.PathValue("id"))
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("GET /api/v1/tracks/{id}/stream", s.stream)
	m.HandleFunc("HEAD /api/v1/tracks/{id}/stream", s.stream)
	m.HandleFunc("GET /api/v1/tracks/{id}/art", s.art)
	m.HandleFunc("GET /api/v1/tracks/{id}/lyrics", func(w http.ResponseWriter, r *http.Request) {
		track, err := s.Repo.Track(r.Context(), current(r).User.ID, r.PathValue("id"))
		if err != nil {
			failure(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		result := lyrics.Local(s.Config.Roots, track)
		if !result.Found {
			result, err = s.Lyrics.Lookup(ctx, track)
		}
		if err != nil {
			write(w, 503, map[string]string{"error": "Lyrics are temporarily unavailable. Try again later."})
			return
		}
		if _, err = s.Repo.Track(r.Context(), current(r).User.ID, track.ID); err != nil {
			failure(w, err)
			return
		}
		write(w, 200, result)
	})
	m.HandleFunc("GET /api/v1/playlists", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Repo.Playlists(r.Context(), current(r).User.ID)
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("GET /api/v1/tracks/{id}/playlists", func(w http.ResponseWriter, r *http.Request) {
		ids, err := s.Repo.TrackPlaylistIDs(r.Context(), current(r).User.ID, r.PathValue("id"))
		if err != nil {
			failure(w, err)
			return
		}
		if ids == nil {
			ids = []string{}
		}
		write(w, 200, struct {
			PlaylistIDs []string `json:"playlistIds"`
		}{ids})
	})
	m.HandleFunc("POST /api/v1/playlists", s.createPlaylist)
	m.HandleFunc("PATCH /api/v1/playlists/{id}", s.updatePlaylistIcon)
	m.HandleFunc("DELETE /api/v1/playlists/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.ok(w, s.Repo.DeletePlaylist(r.Context(), current(r).User.ID, r.PathValue("id")))
	})
	m.HandleFunc("POST /api/v1/playlists/{id}/tracks", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			TrackID string `json:"trackId"`
		}
		if !decode(w, r, &v) {
			return
		}
		s.ok(w, s.Repo.AddPlaylistTrack(r.Context(), current(r).User.ID, r.PathValue("id"), v.TrackID))
	})
	m.HandleFunc("DELETE /api/v1/playlists/{id}/tracks/{track}", func(w http.ResponseWriter, r *http.Request) {
		s.ok(w, s.Repo.RemovePlaylistTrack(r.Context(), current(r).User.ID, r.PathValue("id"), r.PathValue("track")))
	})
	m.HandleFunc("PUT /api/v1/tracks/{id}/like", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Liked bool `json:"liked"`
		}
		if !decode(w, r, &v) {
			return
		}
		s.ok(w, s.Repo.Like(r.Context(), current(r).User.ID, r.PathValue("id"), v.Liked))
	})
	m.HandleFunc("POST /api/v1/tracks/{id}/plays", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			EventID string `json:"eventId"`
		}
		if !decode(w, r, &v) {
			return
		}
		if len(v.EventID) < 16 || len(v.EventID) > 100 {
			write(w, 400, map[string]string{"error": "eventId must contain 16–100 characters"})
			return
		}
		s.ok(w, s.Repo.RecordPlay(r.Context(), current(r).User.ID, r.PathValue("id"), v.EventID))
	})
	m.HandleFunc("POST /api/v1/permissions/check", s.checkPermissions)
	m.HandleFunc("GET /api/v1/admin/branding", func(w http.ResponseWriter, r *http.Request) {
		name, err := s.Repo.InstanceName(r.Context())
		if err != nil {
			failure(w, err)
			return
		}
		write(w, 200, map[string]string{"name": name})
	})
	m.HandleFunc("PUT /api/v1/admin/branding", s.updateBranding)
	m.HandleFunc("GET /api/v1/admin/activity", s.activity)
	m.HandleFunc("GET /api/v1/admin/devices", func(w http.ResponseWriter, r *http.Request) {
		devices, err := s.Repo.Devices(r.Context())
		if err != nil {
			failure(w, err)
			return
		}
		write(w, 200, devices)
	})
	m.HandleFunc("GET /api/v1/admin/config", func(w http.ResponseWriter, r *http.Request) {
		settings, e := s.Repo.Settings(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, map[string]any{"settings": settings, "roots": s.Config.Roots})
	})
	m.HandleFunc("PUT /api/v1/admin/settings", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Enrichment bool `json:"enrichment"`
		}
		if !decode(w, r, &v) {
			return
		}
		s.ok(w, s.Repo.SetEnrichment(r.Context(), v.Enrichment))
	})
	m.HandleFunc("GET /api/v1/admin/scans", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Repo.Scans(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("POST /api/v1/admin/scans", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Full        bool   `json:"full"`
			MissingOnly bool   `json:"missingOnly"`
			Artist      string `json:"artist"`
		}
		if !decode(w, r, &v) {
			return
		}
		v.Artist = strings.TrimSpace(v.Artist)
		if utf8.RuneCountInString(v.Artist) > 300 {
			write(w, 400, map[string]string{"error": "Artist name is too long"})
			return
		}
		if v.Artist != "" && !s.artistAccessible(w, r, v.Artist) {
			return
		}
		id, ok := s.Scanner.StartWithOptions(library.ScanOptions{Full: v.Full, MissingOnly: v.MissingOnly, Artist: v.Artist})
		if !ok {
			write(w, 409, map[string]string{"error": "A scan is already running or could not start"})
			return
		}
		write(w, 202, map[string]string{"id": id})
	})
	m.HandleFunc("GET /api/v1/admin/users", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Repo.Users(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("POST /api/v1/admin/users", s.createUser)
	m.HandleFunc("PUT /api/v1/admin/users/{id}", s.updateAdminUser)
	m.HandleFunc("POST /api/v1/admin/users/{id}/password", s.changePassword)
	m.HandleFunc("PUT /api/v1/admin/users/{id}/avatar", s.updateAvatar)
	m.HandleFunc("DELETE /api/v1/admin/users/{id}/avatar", s.updateAvatar)
	m.HandleFunc("PUT /api/v1/admin/users/{id}/groups", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Groups []string `json:"groups"`
		}
		if !decode(w, r, &v) {
			return
		}
		if len(v.Groups) > 100 {
			write(w, 400, map[string]string{"error": "Too many groups"})
			return
		}
		s.ok(w, s.Repo.SetGroups(r.Context(), r.PathValue("id"), v.Groups))
	})
	m.HandleFunc("DELETE /api/v1/admin/users/{id}/sessions", func(w http.ResponseWriter, r *http.Request) {
		s.ok(w, s.Repo.RevokeSessions(r.Context(), r.PathValue("id")))
	})
	m.HandleFunc("GET /api/v1/admin/groups", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Repo.Groups(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("POST /api/v1/admin/groups", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Name string `json:"name"`
		}
		if !decode(w, r, &v) {
			return
		}
		if !validName(v.Name) {
			write(w, 400, map[string]string{"error": "Invalid name"})
			return
		}
		g, e := s.Repo.CreateGroup(r.Context(), strings.TrimSpace(v.Name))
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 201, g)
	})
	m.HandleFunc("GET /api/v1/admin/exclusions", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Repo.Exclusions(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("POST /api/v1/admin/exclusions", s.createExclusion)
	m.HandleFunc("DELETE /api/v1/admin/exclusions/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.ok(w, s.Repo.DeleteExclusion(r.Context(), r.PathValue("id")))
	})
	m.HandleFunc("GET /api/v1/admin/suggestions", func(w http.ResponseWriter, r *http.Request) {
		l, o := pagination(r)
		v, e := s.Repo.Suggestions(r.Context(), l, o)
		if e != nil {
			failure(w, e)
			return
		}
		write(w, 200, v)
	})
	m.HandleFunc("GET /api/v1/admin/metadata/tracks", s.metadataMatches)
	m.HandleFunc("POST /api/v1/admin/metadata/bulk", s.bulkMetadataSuggestions)
	m.HandleFunc("GET /api/v1/admin/library", s.libraryDirectory)
	m.HandleFunc("GET /api/v1/admin/tracks/{id}/suggestions", s.trackSuggestions)
	m.HandleFunc("POST /api/v1/admin/tracks/{id}/metadata", s.applyMetadataChoices)
	m.HandleFunc("PUT /api/v1/admin/tracks/{id}/album", s.moveTrackAlbum)
	m.HandleFunc("POST /api/v1/admin/suggestions", s.suggest)
	m.HandleFunc("POST /api/v1/admin/suggestions/accept-all", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Fields []string `json:"fields"`
		}
		if !decode(w, r, &body) {
			return
		}
		if len(body.Fields) == 0 || len(body.Fields) > 9 {
			write(w, 400, map[string]string{"error": "Choose at least one metadata field."})
			return
		}
		for _, field := range body.Fields {
			if !validField(field) {
				write(w, 400, map[string]string{"error": "Invalid metadata field."})
				return
			}
		}
		count, err := s.Repo.AcceptSuggestions(r.Context(), body.Fields)
		if err != nil {
			failure(w, err)
			return
		}
		write(w, 200, map[string]int64{"accepted": count})
	})
	m.HandleFunc("GET /api/v1/admin/suggestions/{id}/art", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.Repo.Suggestion(r.Context(), r.PathValue("id"))
		if e != nil {
			failure(w, e)
			return
		}
		if v.Field != "artwork" {
			http.NotFound(w, r)
			return
		}
		s.serveArtwork(w, r, v.Value)
	})
	m.HandleFunc("POST /api/v1/admin/suggestions/{id}/resolve", func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Accept bool `json:"accept"`
		}
		if !decode(w, r, &v) {
			return
		}
		s.ok(w, s.Repo.ResolveSuggestion(r.Context(), r.PathValue("id"), v.Accept))
	})
	m.HandleFunc("DELETE /api/v1/admin/tracks/{id}/overrides/{field}", func(w http.ResponseWriter, r *http.Request) {
		if !validField(r.PathValue("field")) {
			write(w, 400, map[string]string{"error": "Invalid metadata field"})
			return
		}
		s.ok(w, s.Repo.ClearOverride(r.Context(), r.PathValue("id"), r.PathValue("field")))
	})
	m.HandleFunc("GET /api/v1/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		http.ServeFile(w, r, "docs/openapi.yaml")
	})
	m.HandleFunc("GET /", s.static)
	return s.middleware(m)
}
func (s *Server) ok(w http.ResponseWriter, e error) {
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		mutating := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
		if mutating && !s.Config.AllowAnyOrigin {
			origin := r.Header.Get("Origin")
			expected := strings.TrimRight(s.Config.PublicURL, "/")
			if expected == "" && len(s.Config.PublicURLs) == 0 {
				scheme := "http"
				if r.TLS != nil {
					scheme = "https"
				}
				expected = scheme + "://" + r.Host
			}
			allowed := origin == expected
			for _, public := range s.Config.PublicURLs {
				allowed = allowed || origin == public
			}
			if origin != "" && !allowed {
				write(w, 403, map[string]string{"error": "Origin rejected"})
				return
			}
		}
		public := r.URL.Path == "/api/v1/status" || r.URL.Path == "/api/v1/login" || r.URL.Path == "/api/v1/setup" || r.URL.Path == "/api/v1/openapi.yaml"
		if strings.HasPrefix(r.URL.Path, "/api/") && !public {
			cookie, err := r.Cookie("cadence_session")
			if err != nil {
				write(w, 401, map[string]string{"error": "Sign in required"})
				return
			}
			v, err := s.Repo.Session(r.Context(), tokenHash(cookie.Value))
			if err != nil {
				if !errors.Is(err, domain.ErrNotFound) {
					failure(w, err)
				} else {
					write(w, 401, map[string]string{"error": "Session expired"})
				}
				return
			}
			if mutating && !same(r.Header.Get("X-CSRF-Token"), v.CSRF) {
				write(w, 403, map[string]string{"error": "CSRF token required"})
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/admin/") && !v.User.Admin {
				write(w, 403, map[string]string{"error": "Administrator required"})
				return
			}
			if err := s.recordDevice(r, tokenHash(cookie.Value)); err != nil {
				failure(w, err)
				return
			}
			r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, v))
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	b, e := s.Repo.HasUsers(r.Context())
	if e != nil {
		failure(w, e)
		return
	}
	name, err := s.Repo.InstanceName(r.Context())
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, map[string]any{"setupRequired": !b, "name": name})
}

type credentials struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

func validPassword(password string) bool {
	return utf8.ValidString(password) && utf8.RuneCountInString(password) >= 3 && len(password) <= 72
}

func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(r) {
		write(w, 429, map[string]string{"error": "Too many attempts; try again later"})
		return
	}
	var v credentials
	if !decode(w, r, &v) {
		return
	}
	if !validName(v.Username) || !validName(v.DisplayName) || !validPassword(v.Password) {
		write(w, 400, map[string]string{"error": "Use a username, display name, and a password of at least 3 characters, up to 72 bytes"})
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(v.Password), bcrypt.DefaultCost)
	if e != nil {
		failure(w, e)
		return
	}
	u, e := s.Repo.CreateUser(r.Context(), domain.User{Username: v.Username, DisplayName: v.DisplayName, Password: string(hash)}, true)
	if e != nil {
		failure(w, e)
		return
	}
	s.newSession(w, r, u)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(r) {
		write(w, 429, map[string]string{"error": "Too many attempts; try again later"})
		return
	}
	var v credentials
	if !decode(w, r, &v) {
		return
	}
	if len(v.Username) > 120 || len(v.Password) > 72 {
		write(w, 401, map[string]string{"error": "Invalid credentials"})
		return
	}
	u, e := s.Repo.UserByUsername(r.Context(), v.Username)
	hash := u.Password
	if e != nil {
		hash = "$2a$10$7EqJtq98hPqEX7fNZaFWoO5IWuZOeGzRKeMwZOVpIU2qaOYIYqcIO"
	}
	valid := bcrypt.CompareHashAndPassword([]byte(hash), []byte(v.Password)) == nil
	if e != nil || !valid {
		entry := domain.ActivityEntry{Level: "Warning", Name: "Sign-in failed", Type: "AuthenticationFailed", Overview: "Invalid username or password"}
		if e == nil {
			entry.UserID = u.ID
			entry.UserName = u.DisplayName
		}
		if err := s.Repo.RecordActivity(r.Context(), entry); err != nil {
			slog.Error("record failed login activity", "error", err)
		}
		write(w, 401, map[string]string{"error": "Invalid credentials"})
		return
	}
	s.newSession(w, r, u)
}
func (s *Server) newSession(w http.ResponseWriter, r *http.Request, u domain.User) {
	token, csrf := random(), random()
	expires := time.Now().Add(30 * 24 * time.Hour)
	if e := s.Repo.SaveSession(r.Context(), tokenHash(token), u.ID, csrf, expires, u.Password); e != nil {
		failure(w, e)
		return
	}
	if err := s.recordDevice(r, tokenHash(token)); err != nil {
		_ = s.Repo.DeleteSession(r.Context(), tokenHash(token))
		failure(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "cadence_session", Value: token, Path: "/", HttpOnly: true, Secure: s.secureCookie(r), SameSite: http.SameSiteStrictMode, Expires: expires})
	write(w, 200, map[string]any{"user": u, "csrf": csrf})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	cookie, _ := r.Cookie("cadence_session")
	if e := s.Repo.DeleteSession(r.Context(), tokenHash(cookie.Value)); e != nil {
		failure(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "cadence_session", Value: "", Path: "/", HttpOnly: true, Secure: s.secureCookie(r), SameSite: http.SameSiteStrictMode, MaxAge: -1})
	write(w, 200, map[string]bool{"ok": true})
}
func (s *Server) tracks(w http.ResponseWriter, r *http.Request) {
	l, o := pagination(r)
	v := r.URL.Query()
	q := domain.Query{LibraryID: v.Get("libraryId"), Search: v.Get("q"), Album: v.Get("album"), Artist: v.Get("artist"), Collection: v.Get("collection"), Playlist: v.Get("playlist"), Limit: l, Offset: o}
	p, e := s.Repo.Tracks(r.Context(), current(r).User.ID, q)
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, p)
}
func (s *Server) createPlaylist(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Icon string `json:"icon"`
		Name string `json:"name"`
	}
	if !decode(w, r, &v) {
		return
	}
	if !validName(v.Name) {
		write(w, 400, map[string]string{"error": "Invalid name"})
		return
	}
	if !domain.ValidPlaylistIcon(v.Icon) {
		write(w, 400, map[string]string{"error": "Invalid playlist icon"})
		return
	}
	p, e := s.Repo.CreatePlaylist(r.Context(), current(r).User.ID, strings.TrimSpace(v.Name), v.Icon)
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 201, p)
}
func (s *Server) updatePlaylistIcon(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Icon string `json:"icon"`
	}
	if !decode(w, r, &v) {
		return
	}
	if v.Icon == "" || !domain.ValidPlaylistIcon(v.Icon) {
		write(w, 400, map[string]string{"error": "Invalid playlist icon"})
		return
	}
	p, err := s.Repo.UpdatePlaylistIcon(r.Context(), current(r).User.ID, r.PathValue("id"), v.Icon)
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, p)
}
func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Password    string `json:"password"`
		Admin       bool   `json:"admin"`
	}
	if !decode(w, r, &v) {
		return
	}
	if !validName(v.Username) || !validName(v.DisplayName) || !validPassword(v.Password) {
		write(w, 400, map[string]string{"error": "Use a username, display name, and a password of at least 3 characters, up to 72 bytes"})
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(v.Password), bcrypt.DefaultCost)
	if e != nil {
		failure(w, e)
		return
	}
	u, e := s.Repo.CreateUser(r.Context(), domain.User{Username: v.Username, DisplayName: v.DisplayName, Password: string(hash), Admin: v.Admin}, false)
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 201, u)
}
func (s *Server) createExclusion(w http.ResponseWriter, r *http.Request) {
	var v struct {
		GroupID string `json:"groupId"`
		Kind    string `json:"kind"`
		Target  string `json:"target"`
	}
	if !decode(w, r, &v) {
		return
	}
	if v.Kind != "track" && v.Kind != "album" && v.Kind != "folder" {
		write(w, 400, map[string]string{"error": "kind must be track, album, or folder"})
		return
	}
	if v.Target == "" || len(v.Target) > 4096 {
		write(w, 400, map[string]string{"error": "Target required"})
		return
	}
	if v.Kind == "folder" {
		path, e := library.Canonical(v.Target)
		if e != nil {
			write(w, 400, map[string]string{"error": "Folder must exist inside a configured music root"})
			return
		}
		inside := false
		for _, root := range s.Config.Roots {
			p, e := library.Canonical(root)
			if e == nil && library.Within(p, path) {
				inside = true
			}
		}
		if !inside {
			write(w, 400, map[string]string{"error": "Folder must be inside a music root"})
			return
		}
		v.Target = path
	}
	eValue, e := s.Repo.CreateExclusion(r.Context(), domain.Exclusion{GroupID: v.GroupID, Kind: v.Kind, Target: v.Target})
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 201, eValue)
}
func validField(f string) bool {
	switch f {
	case "title", "artist", "featuredArtists", "videoGuests", "album", "albumArtist", "year", "genre", "number", "disc", "artwork":
		return true
	}
	return false
}
func (s *Server) suggest(w http.ResponseWriter, r *http.Request) {
	var v struct {
		TrackID string `json:"trackId"`
		Field   string `json:"field"`
		Value   string `json:"value"`
	}
	if !decode(w, r, &v) {
		return
	}
	if !validSuggestion(v.Field, v.Value) {
		write(w, 400, map[string]string{"error": "Invalid metadata suggestion"})
		return
	}
	if _, e := s.Repo.Track(r.Context(), current(r).User.ID, v.TrackID); e != nil {
		failure(w, e)
		return
	}
	s.ok(w, s.Repo.AddSuggestion(r.Context(), domain.Suggestion{TrackID: v.TrackID, Field: v.Field, Value: v.Value, Source: "administrator"}))
}
func validSuggestion(field, value string) bool {
	if !validField(field) || field == "artwork" || len(value) > 500 {
		return false
	}
	if field == "title" || field == "artist" {
		return strings.TrimSpace(value) != ""
	}
	if field == "number" || field == "disc" {
		number, err := strconv.Atoi(value)
		return err == nil && number >= 0 && number <= 9999
	}
	return true
}
func (s *Server) checkPermissions(w http.ResponseWriter, r *http.Request) {
	var v struct {
		IDs []string `json:"ids"`
	}
	if !decode(w, r, &v) {
		return
	}
	if len(v.IDs) > 500 {
		write(w, 400, map[string]string{"error": "Maximum 500 IDs"})
		return
	}
	allowed, e := s.Repo.AllowedIDs(r.Context(), current(r).User.ID, v.IDs)
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, map[string]any{"allowed": allowed})
}
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	t, e := s.Repo.Track(r.Context(), current(r).User.ID, r.PathValue("id"))
	if e != nil {
		failure(w, e)
		return
	}
	path, e := library.ResolveFile(s.Config.Roots, t.Path)
	if e == nil && path != t.Path {
		e = fmt.Errorf("music file path changed")
	}
	if e != nil {
		write(w, 404, map[string]string{"error": "Music file unavailable"})
		return
	}
	t.Path = path
	quality := r.URL.Query().Get("quality")
	if quality == "" {
		quality = "original"
	}
	mime := t.MIME
	if quality == "high" || quality == "saver" {
		rate := 320
		if quality == "saver" {
			rate = 128
		}
		path, release, err := s.Cache.Acquire(r.Context(), t, rate)
		if err != nil {
			if r.Context().Err() == nil {
				write(w, 503, map[string]string{"error": "Unable to convert audio; retry or use original quality"})
			}
			return
		}
		defer release()
		// Conversion may have queued while an administrator changed permissions.
		if _, err = s.Repo.Track(r.Context(), current(r).User.ID, t.ID); err != nil {
			failure(w, err)
			return
		}
		s.serveAudio(w, r, path, "audio/mpeg")
		return
	}
	if quality == "lossless" && !domain.LosslessCodec(t.Codec) {
		write(w, 409, map[string]string{"error": "Lossless requires a FLAC, ALAC, or uncompressed PCM source"})
		return
	}
	if quality != "original" && quality != "lossless" {
		write(w, 400, map[string]string{"error": "quality must be original, lossless, high, or saver"})
		return
	}
	s.serveAudio(w, r, path, mime)
}
func (s *Server) serveAudio(w http.ResponseWriter, r *http.Request, path, mime string) {
	file, e := os.Open(path)
	if e != nil {
		write(w, 404, map[string]string{"error": "Audio unavailable"})
		return
	}
	defer file.Close()
	info, e := file.Stat()
	if e != nil {
		failure(w, e)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "audio", info.ModTime(), file)
}
func (s *Server) art(w http.ResponseWriter, r *http.Request) {
	t, e := s.Repo.Track(r.Context(), current(r).User.ID, r.PathValue("id"))
	if e != nil {
		failure(w, e)
		return
	}
	s.serveArtwork(w, r, t.ArtPath)
}
func (s *Server) serveArtwork(w http.ResponseWriter, r *http.Request, artPath string) {
	root, e := library.Canonical(s.Config.ArtDir)
	if e != nil || artPath == "" {
		http.NotFound(w, r)
		return
	}
	path, e := library.Canonical(artPath)
	if e != nil || !library.Within(root, path) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	file, e := os.Open(path)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	var header [512]byte
	n, _ := file.Read(header[:])
	file.Close()
	mime := http.DetectContentType(header[:n])
	if mime != "image/jpeg" && mime != "image/png" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	http.ServeFile(w, r, path)
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Clean(filepath.FromSlash("/" + r.URL.Path))
	rel := strings.TrimLeft(clean, "/\\")
	root, e := filepath.Abs(s.Config.WebDir)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	path := filepath.Join(root, rel)
	if !library.Within(root, path) {
		http.NotFound(w, r)
		return
	}
	info, e := os.Stat(path)
	if e != nil || info.IsDir() {
		path = filepath.Join(root, "index.html")
	}
	if _, e = os.Stat(path); e != nil {
		write(w, 503, map[string]string{"error": "Build the frontend with npm run build in web/"})
		return
	}
	if strings.Contains(r.URL.Path, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, path)
}

type attempts struct {
	count int
	until time.Time
}
type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]attempts
}

func (l *loginLimiter) allow(r *http.Request) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.entries == nil {
		l.entries = map[string]attempts{}
	}
	now := time.Now()
	for key, v := range l.entries {
		if now.After(v.until) {
			delete(l.entries, key)
		}
	}
	v := l.entries[host]
	if v.count >= 20 {
		return false
	}
	if v.count == 0 {
		v.until = now.Add(5 * time.Minute)
	}
	v.count++
	l.entries[host] = v
	return true
}
func ValidatePublicURL(v string) error {
	if v == "" {
		return nil
	}
	u, e := url.Parse(v)
	if e != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return fmt.Errorf("PUBLIC_URL must be an http(s) origin without a path")
	}
	return nil
}

// ParsePublicURLs validates additional allowed origins without changing the
// canonical PUBLIC_URL used by provider callbacks.
func ParsePublicURLs(value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	var origins []string
	for _, entry := range strings.Split(value, ",") {
		origin := strings.TrimRight(strings.TrimSpace(entry), "/")
		if origin == "" {
			return nil, fmt.Errorf("PUBLIC_URLS must contain non-empty, comma-separated http(s) origins")
		}
		if err := ValidatePublicURL(origin); err != nil {
			return nil, fmt.Errorf("PUBLIC_URLS: %w", err)
		}
		origins = append(origins, origin)
	}
	return origins, nil
}

func (s *Server) secureCookie(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	// Match configured hosts even when HTTPS terminates at a reverse proxy.
	// Never trust forwarded headers to downgrade a configured HTTPS cookie.
	matched := false
	for _, origin := range append([]string{s.Config.PublicURL}, s.Config.PublicURLs...) {
		u, err := url.Parse(origin)
		if err == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host) {
			if u.Scheme == "https" {
				return true
			}
			matched = true
		}
	}
	if matched {
		return false
	}
	return s.Config.SecureCookie
}

func (s *Server) updateBranding(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &v) {
		return
	}
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" || utf8.RuneCountInString(v.Name) > 120 {
		write(w, 400, map[string]string{"error": "Instance name must contain 1–120 characters"})
		return
	}
	if err := s.Repo.SetInstanceName(r.Context(), v.Name); err != nil {
		failure(w, err)
		return
	}
	write(w, 200, map[string]string{"name": v.Name})
}

func (s *Server) recordDevice(r *http.Request, token string) error {
	agent := r.UserAgent()
	version := r.Header.Get("X-Cadence-Client-Version")
	if len(agent) > 2048 {
		agent = agent[:2048]
	}
	if len(version) > 120 {
		version = version[:120]
	}
	return s.Repo.RecordDevice(r.Context(), token, strings.ToValidUTF8(agent, ""), strings.ToValidUTF8(version, ""))
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	filter := r.URL.Query().Get("filter")
	if filter == "" {
		filter = "all"
	}
	if filter != "all" && filter != "user" && filter != "system" {
		write(w, 400, map[string]string{"error": "Unknown activity filter"})
		return
	}
	query := r.URL.Query().Get("q")
	if len(query) > 500 {
		write(w, 400, map[string]string{"error": "Search is too long"})
		return
	}
	limit, offset := pagination(r)
	if limit > 100 {
		limit = 100
	}
	result, err := s.Repo.Activity(r.Context(), filter, query, limit, offset)
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, result)
}
