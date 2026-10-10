// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"cadence/internal/soulseek"
	"errors"
	"net/http"
	"slices"
	"strings"
)

func (s *Server) soulseekAccess(w http.ResponseWriter, r *http.Request) (domain.SoulseekSettings, bool) {
	if s.Soulseek == nil {
		write(w, 503, map[string]string{"error": "Soulseek is not configured"})
		return domain.SoulseekSettings{}, false
	}
	cfg, e := s.Soulseek.Repo.SoulseekSettings(r.Context())
	if e != nil {
		failure(w, e)
		return cfg, false
	}
	if !cfg.Allows(current(r).User) {
		write(w, 403, map[string]string{"error": "Soulseek access is disabled"})
		return cfg, false
	}
	if !s.Soulseek.Configured {
		write(w, 503, map[string]string{"error": "Soulseek container is not configured"})
		return cfg, false
	}
	return cfg, true
}
func soulseekError(w http.ResponseWriter, e error) {
	if errors.Is(e, soulseek.ErrUnavailable) {
		write(w, 503, map[string]string{"error": e.Error()})
		return
	}
	var remote *soulseek.APIError
	if errors.As(e, &remote) {
		write(w, 502, map[string]string{"error": "Soulseek request failed; check the peer or container and retry"})
		return
	}
	if errors.Is(e, domain.ErrNotFound) || errors.Is(e, domain.ErrConflict) {
		failure(w, e)
		return
	}
	write(w, 400, map[string]string{"error": e.Error()})
}
func (s *Server) soulseekCapabilities(w http.ResponseWriter, r *http.Request) {
	if s.Soulseek == nil {
		write(w, 200, map[string]any{"configured": false, "enabled": false, "allowed": false, "presentation": "separate"})
		return
	}
	cfg, e := s.Soulseek.Repo.SoulseekSettings(r.Context())
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, map[string]any{"configured": s.Soulseek.Configured, "enabled": cfg.Enabled, "allowed": cfg.Allows(current(r).User), "presentation": cfg.Presentation})
}
func (s *Server) soulseekSettings(w http.ResponseWriter, r *http.Request) {
	if s.Soulseek == nil {
		write(w, 503, map[string]string{"error": "Soulseek settings unavailable"})
		return
	}
	if r.Method == "PUT" {
		var cfg domain.SoulseekSettings
		if !decode(w, r, &cfg) {
			return
		}
		users, e := s.Repo.Users(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		groups, e := s.Repo.Groups(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		userIDs := []string{}
		groupIDs := []string{}
		for _, u := range users {
			userIDs = append(userIDs, u.ID)
		}
		for _, g := range groups {
			groupIDs = append(groupIDs, g.ID)
		}
		for _, id := range cfg.Users {
			if !slices.Contains(userIDs, id) {
				write(w, 400, map[string]string{"error": "Unknown access user"})
				return
			}
		}
		for _, id := range cfg.Groups {
			if !slices.Contains(groupIDs, id) {
				write(w, 400, map[string]string{"error": "Unknown access group"})
				return
			}
		}
		for _, rule := range cfg.UserRules {
			if !slices.Contains(userIDs, rule.Subject) {
				write(w, 400, map[string]string{"error": "Unknown routing user"})
				return
			}
		}
		for _, rule := range cfg.GroupRules {
			if !slices.Contains(groupIDs, rule.Subject) {
				write(w, 400, map[string]string{"error": "Unknown routing group"})
				return
			}
		}
		if e = s.Soulseek.SaveSettings(r.Context(), cfg); e != nil {
			soulseekError(w, e)
			return
		}
		s.Soulseek.Event(r.Context(), current(r).User.ID, "Soulseek settings updated")
	}
	cfg, e := s.Soulseek.Repo.SoulseekSettings(r.Context())
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, map[string]any{"settings": cfg, "configured": s.Soulseek.Configured, "writableRoots": s.Soulseek.WritableRoots, "staging": s.Soulseek.Stage})
}
func (s *Server) soulseekSearch(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.soulseekAccess(w, r); !ok {
		return
	}
	if r.Method == "POST" {
		var input struct {
			Query string `json:"query"`
		}
		if !decode(w, r, &input) {
			return
		}
		input.Query = strings.TrimSpace(input.Query)
		if len(input.Query) < 3 || len(input.Query) > 200 {
			write(w, 400, map[string]string{"error": "Use a search between 3 and 200 bytes"})
			return
		}
		if !s.soulseekLimiter.allow(r) {
			write(w, 429, map[string]string{"error": "Too many Soulseek searches; try again shortly"})
			return
		}
		id := soulseek.ID()
		if e := s.Soulseek.Repo.CreateSoulseekSearch(r.Context(), id, current(r).User.ID); e != nil {
			failure(w, e)
			return
		}
		if e := s.Soulseek.Remote.StartSearch(r.Context(), id, input.Query); e != nil {
			soulseekError(w, e)
			return
		}
		write(w, 201, domain.SoulseekSearch{ID: id, State: "InProgress", Results: []domain.SoulseekResult{}})
		return
	}
	id := r.PathValue("id")
	if !s.ownsSoulseekSearch(w, r, id) {
		return
	}
	out, e := s.Soulseek.Remote.Search(r.Context(), id)
	if e != nil {
		soulseekError(w, e)
		return
	}
	write(w, 200, out)
}
func (s *Server) ownsSoulseekSearch(w http.ResponseWriter, r *http.Request, id string) bool {
	if !soulseek.ValidID(id) {
		write(w, 404, map[string]string{"error": "Search not found"})
		return false
	}
	ok, e := s.Soulseek.Repo.OwnsSoulseekSearch(r.Context(), id, current(r).User.ID)
	if e != nil {
		failure(w, e)
		return false
	}
	if !ok {
		write(w, 404, map[string]string{"error": "Search not found"})
	}
	return ok
}
func (s *Server) soulseekFolder(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.soulseekAccess(w, r); !ok {
		return
	}
	var input struct {
		SearchID string `json:"searchId"`
		Username string `json:"username"`
		Folder   string `json:"folder"`
	}
	if !decode(w, r, &input) || !s.ownsSoulseekSearch(w, r, input.SearchID) {
		return
	}
	if !s.soulseekPeer(w, r, input.SearchID, input.Username, input.Folder) {
		return
	}
	out, e := s.Soulseek.Remote.Folder(r.Context(), input.Username, input.Folder)
	if e != nil {
		soulseekError(w, e)
		return
	}
	write(w, 200, out)
}
func (s *Server) soulseekPeer(w http.ResponseWriter, r *http.Request, id, user, folder string) bool {
	search, e := s.Soulseek.Remote.Search(r.Context(), id)
	if e != nil {
		soulseekError(w, e)
		return false
	}
	for _, result := range search.Results {
		if result.Username == user && result.Folder == folder {
			return true
		}
	}
	write(w, 400, map[string]string{"error": "Choose a peer and folder from your search results"})
	return false
}
func publicSoulseekRequest(v domain.SoulseekRequest, u domain.User) domain.SoulseekRequest {
	if !u.Admin {
		v.Rule.Folder = ""
		v.Rule.Subject = ""
	}
	return v
}
func (s *Server) soulseekRequests(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.soulseekAccess(w, r); !ok {
		return
	}
	u := current(r).User
	if r.Method == "POST" {
		var input struct {
			ID        string   `json:"id"`
			SearchID  string   `json:"searchId"`
			Username  string   `json:"username"`
			Folder    string   `json:"folder"`
			Filenames []string `json:"filenames"`
			Album     bool     `json:"album"`
		}
		if !decode(w, r, &input) {
			return
		}
		if !soulseek.ValidID(input.ID) {
			write(w, 400, map[string]string{"error": "Invalid request ID"})
			return
		}
		if old, e := s.Soulseek.Repo.SoulseekRequest(r.Context(), input.ID); e == nil {
			if old.UserID != u.ID {
				failure(w, domain.ErrConflict)
				return
			}
			write(w, 200, publicSoulseekRequest(old, u))
			return
		} else if !errors.Is(e, domain.ErrNotFound) {
			failure(w, e)
			return
		}
		if !s.ownsSoulseekSearch(w, r, input.SearchID) || !s.soulseekPeer(w, r, input.SearchID, input.Username, input.Folder) {
			return
		}
		authoritative, e := s.Soulseek.Remote.Folder(r.Context(), input.Username, input.Folder)
		if e != nil {
			soulseekError(w, e)
			return
		}
		files := []domain.SoulseekFile{}
		for _, f := range authoritative {
			if input.Album || slices.Contains(input.Filenames, f.Filename) {
				files = append(files, f)
			}
		}
		if !input.Album && len(files) != len(input.Filenames) {
			write(w, 400, map[string]string{"error": "Selected files are no longer available"})
			return
		}
		out, e := s.Soulseek.Create(r.Context(), u, input.ID, input.Username, input.Folder, files)
		if e != nil {
			soulseekError(w, e)
			return
		}
		write(w, 201, publicSoulseekRequest(out, u))
		return
	}
	limit, offset := pagination(r)
	owner := u.ID
	if u.Admin {
		owner = ""
	}
	items, e := s.Soulseek.Repo.SoulseekRequests(r.Context(), owner, false, limit, offset)
	if e != nil {
		failure(w, e)
		return
	}
	for i := range items {
		items[i] = publicSoulseekRequest(items[i], u)
	}
	write(w, 200, items)
}
func (s *Server) soulseekAction(w http.ResponseWriter, r *http.Request) {
	// Administrators can review/cancel existing jobs even when integration is disabled.
	if !current(r).User.Admin {
		if _, ok := s.soulseekAccess(w, r); !ok {
			return
		}
	} else if s.Soulseek == nil {
		write(w, 503, map[string]string{"error": "Soulseek unavailable"})
		return
	}
	var input struct {
		Action    string `json:"action"`
		LibraryID string `json:"libraryId"`
		Folder    string `json:"folder"`
	}
	if !decode(w, r, &input) {
		return
	}
	out, e := s.Soulseek.Action(r.Context(), current(r).User, r.PathValue("id"), input.Action, domain.SoulseekRule{Mode: "auto", LibraryID: input.LibraryID, Folder: input.Folder})
	if e != nil {
		soulseekError(w, e)
		return
	}
	write(w, 200, publicSoulseekRequest(out, current(r).User))
}
