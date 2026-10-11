// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"cadence/internal/scrobble"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) syncReady(w http.ResponseWriter) bool {
	if s.Sync == nil {
		write(w, 503, map[string]string{"error": "Sync is unavailable on this instance"})
		return false
	}
	return true
}
func syncProvider(w http.ResponseWriter, r *http.Request) bool {
	p := r.PathValue("provider")
	if p != "lastfm" && p != "listenbrainz" {
		write(w, 400, map[string]string{"error": "Unknown sync provider"})
		return false
	}
	return true
}
func (s *Server) syncStatus(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) {
		return
	}
	c, err := s.Sync.Repo.SyncConnections(r.Context(), current(r).User.ID)
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, map[string]any{"connections": c, "lastfmConfigured": s.Sync.Providers.Configured(), "lastfmAuthorizationAvailable": s.Sync.Providers.Configured() && s.Config.PublicURL != ""})
}
func (s *Server) syncAuthorize(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) {
		return
	}
	unlock := s.Sync.Lock()
	defer unlock()
	if !s.Sync.Providers.Configured() || s.Config.PublicURL == "" {
		write(w, 400, map[string]string{"error": "Configure Last.fm in Instance settings → Sync and set PUBLIC_URL first"})
		return
	}
	state := random()
	if err := s.Sync.Repo.SaveSyncAuth(r.Context(), current(r).User.ID, tokenHash(state), time.Now().Add(10*time.Minute)); err != nil {
		failure(w, err)
		return
	}
	callback := s.Config.PublicURL + "/api/v1/sync/lastfm/callback?state=" + url.QueryEscape(state)
	u := s.Sync.Providers.AuthorizationURL(callback)
	write(w, 200, map[string]string{"url": u})
}
func (s *Server) syncCallback(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) {
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	state, token := r.URL.Query().Get("state"), r.URL.Query().Get("token")
	if len(state) != 64 || token == "" || len(token) > 256 {
		write(w, 400, map[string]string{"error": "Invalid authorization callback; connect Last.fm again"})
		return
	}
	ok, err := s.Sync.Repo.ConsumeSyncAuth(r.Context(), current(r).User.ID, tokenHash(state))
	if err != nil {
		failure(w, err)
		return
	}
	if !ok {
		write(w, 400, map[string]string{"error": "Authorization expired or already used; connect Last.fm again"})
		return
	}
	if err = s.Sync.Connect(r.Context(), current(r).User.ID, "lastfm", token); err != nil {
		write(w, 400, map[string]string{"error": "Last.fm authorization failed; connect again"})
		return
	}
	http.Redirect(w, r, s.Config.PublicURL+"/songs?sync=lastfm", http.StatusSeeOther)
}
func (s *Server) syncConnect(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) {
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Token = strings.TrimSpace(body.Token)
	if len(body.Token) < 16 || len(body.Token) > 256 || strings.ContainsAny(body.Token, "\r\n") {
		write(w, 400, map[string]string{"error": "Enter a valid ListenBrainz personal token"})
		return
	}
	if err := s.Sync.Connect(r.Context(), current(r).User.ID, "listenbrainz", body.Token); err != nil {
		write(w, 400, map[string]string{"error": "Unable to validate ListenBrainz token; check your token and try again"})
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (s *Server) syncPreferences(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) || !syncProvider(w, r) {
		return
	}
	var body struct {
		Plays      *bool `json:"plays"`
		NowPlaying *bool `json:"nowPlaying"`
		Likes      *bool `json:"likes"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Plays == nil || body.NowPlaying == nil || body.Likes == nil {
		write(w, 400, map[string]string{"error": "Specify plays, nowPlaying, and likes preferences"})
		return
	}
	p := domain.SyncPreferences{Plays: *body.Plays, NowPlaying: *body.NowPlaying, Likes: *body.Likes}
	unlock := s.Sync.Lock()
	defer unlock()
	s.ok(w, s.Sync.Repo.SetSyncPreferences(r.Context(), current(r).User.ID, r.PathValue("provider"), p))
}
func (s *Server) syncDisconnect(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) || !syncProvider(w, r) {
		return
	}
	unlock := s.Sync.Lock()
	defer unlock()
	s.ok(w, s.Sync.Repo.DeleteSyncConnection(r.Context(), current(r).User.ID, r.PathValue("provider")))
}
func (s *Server) syncEvent(w http.ResponseWriter, r *http.Request, nowPlaying bool) {
	if !s.syncReady(w) {
		return
	}
	var e domain.SyncEvent
	if !decode(w, r, &e) {
		return
	}
	if err := scrobble.ValidateEvent(e, time.Now()); err != nil {
		write(w, 400, map[string]string{"error": err.Error()})
		return
	}
	var err error
	if nowPlaying {
		err = s.Sync.NowPlaying(r.Context(), current(r).User.ID, e)
	} else {
		err = s.Sync.Listen(r.Context(), current(r).User.ID, e)
	}
	s.ok(w, err)
}
func (s *Server) syncListen(w http.ResponseWriter, r *http.Request)     { s.syncEvent(w, r, false) }
func (s *Server) syncNowPlaying(w http.ResponseWriter, r *http.Request) { s.syncEvent(w, r, true) }
func exportRange(fromText, toText string) (time.Time, time.Time, error) {
	from, e1 := time.Parse(time.RFC3339, fromText)
	to, e2 := time.Parse(time.RFC3339, toText)
	if e1 != nil || e2 != nil || !to.After(from) || to.After(time.Now().Add(24*time.Hour)) {
		return from, to, errors.New("Choose a valid date range")
	}
	return from, to, nil
}
func (s *Server) syncExportPreview(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) || !syncProvider(w, r) {
		return
	}
	from, to, err := exportRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		write(w, 400, map[string]string{"error": err.Error()})
		return
	}
	v, err := s.Sync.Repo.PreviewSyncExport(r.Context(), current(r).User.ID, r.PathValue("provider"), from, to)
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, v)
}
func (s *Server) syncExportStart(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) || !syncProvider(w, r) {
		return
	}
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if !decode(w, r, &body) {
		return
	}
	from, to, err := exportRange(body.From, body.To)
	if err != nil {
		write(w, 400, map[string]string{"error": err.Error()})
		return
	}
	unlock := s.Sync.Lock()
	defer unlock()
	v, err := s.Sync.Repo.StartSyncExport(r.Context(), current(r).User.ID, r.PathValue("provider"), from, to)
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 202, v)
}
func (s *Server) syncExportStatus(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) {
		return
	}
	v, err := s.Sync.Repo.SyncExportStatus(r.Context(), current(r).User.ID, r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, v)
}
