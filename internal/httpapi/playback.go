// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"errors"
	"math"
	"net/http"
	"strings"
)

func (s *Server) playback(w http.ResponseWriter, r *http.Request) {
	user := current(r).User.ID
	if r.Method == "GET" {
		saved, err := s.Repo.Playback(r.Context(), user)
		if err != nil {
			failure(w, err)
			return
		}
		var track *domain.Track
		if saved.TrackID != "" {
			t, err := s.Repo.Track(r.Context(), user, saved.TrackID)
			if err != nil && !errors.Is(err, domain.ErrNotFound) {
				failure(w, err)
				return
			}
			if err == nil {
				track = &t
			} else {
				saved.TrackID = ""
				saved.Position = 0
			}
		}
		write(w, 200, struct {
			domain.Playback
			Track *domain.Track `json:"track"`
		}{saved, track})
		return
	}
	var v domain.Playback
	if !decode(w, r, &v) {
		return
	}
	if len(v.TrackID) == 0 || len(v.TrackID) > 120 || len(v.Writer) < 16 || len(v.Writer) > 64 || strings.Trim(v.Writer, "0123456789abcdef-") != "" || v.Sequence < 1 || v.Sequence > 9007199254740991 || v.Revision < 0 || v.Revision > 9007199254740991 || math.IsNaN(v.Position) || math.IsInf(v.Position, 0) || v.Position < 0 || v.Position > 172800 {
		write(w, 400, map[string]string{"error": "Invalid playback checkpoint"})
		return
	}
	saved, err := s.Repo.SavePlayback(r.Context(), user, v)
	if errors.Is(err, domain.ErrConflict) {
		write(w, 409, map[string]string{"error": "A newer playback checkpoint exists"})
		return
	}
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, saved)
}
