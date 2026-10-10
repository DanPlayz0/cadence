// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"net/http"
)

func (s *Server) moveTrackAlbum(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AlbumID string `json:"albumId"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.AlbumID) != 32 {
		write(w, 400, map[string]string{"error": "Choose an existing destination album."})
		return
	}
	repo, ok := s.Repo.(domain.AlbumMover)
	if !ok {
		write(w, 501, map[string]string{"error": "Album moves are unavailable."})
		return
	}
	s.ok(w, repo.MoveTrackAlbum(r.Context(), current(r).User.ID, r.PathValue("id"), input.AlbumID))
}
