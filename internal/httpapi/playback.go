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
		tracks := map[string]domain.Track{}
		if saved.TrackID != "" {
			t, err := s.Repo.Track(r.Context(), user, saved.TrackID)
			if err != nil && !errors.Is(err, domain.ErrNotFound) {
				failure(w, err)
				return
			}
			if err == nil {
				track = &t
				tracks[t.ID] = t
			} else {
				saved.TrackID = ""
				saved.Position = 0
			}
		}
		if saved.Queue != nil {
			q := *saved.Queue
			checked := map[string]bool{}
			if saved.TrackID != "" {
				checked[saved.TrackID] = true
			}
			var hydrateErr error
			retain := func(entries []domain.PlaybackEntry) []domain.PlaybackEntry {
				result := make([]domain.PlaybackEntry, 0, len(entries))
				for _, entry := range entries {
					if !checked[entry.TrackID] {
						checked[entry.TrackID] = true
						t, err := s.Repo.Track(r.Context(), user, entry.TrackID)
						if err == nil {
							tracks[entry.TrackID] = t
						} else if !errors.Is(err, domain.ErrNotFound) {
							hydrateErr = err
							break
						}
					}
					if _, ok := tracks[entry.TrackID]; ok {
						result = append(result, entry)
					}
				}
				return result
			}
			if q.Current != nil {
				entries := retain([]domain.PlaybackEntry{*q.Current})
				q.Current = nil
				if len(entries) > 0 && entries[0].TrackID == saved.TrackID {
					q.Current = &entries[0]
				}
			}
			q.History, q.Forward, q.Manual = retain(q.History), retain(q.Forward), retain(q.Manual)
			q.Remaining, q.Cycle = retain(q.Remaining), retain(q.Cycle)
			if hydrateErr != nil {
				failure(w, hydrateErr)
				return
			}
			saved.Queue = &q
		}
		write(w, 200, struct {
			domain.Playback
			Track  *domain.Track           `json:"track"`
			Tracks map[string]domain.Track `json:"tracks"`
		}{saved, track, tracks})
		return
	}
	var v domain.Playback
	if !decode(w, r, &v) {
		return
	}
	if (len(v.TrackID) == 0 && v.Queue == nil) || len(v.TrackID) > 120 || !validPlaybackQueue(v.Queue, v.TrackID) || len(v.Writer) < 16 || len(v.Writer) > 64 || strings.Trim(v.Writer, "0123456789abcdef-") != "" || v.Sequence < 1 || v.Sequence > 9007199254740991 || v.Revision < 0 || v.Revision > 9007199254740991 || math.IsNaN(v.Position) || math.IsInf(v.Position, 0) || v.Position < 0 || v.Position > 172800 {
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

func validPlaybackQueue(q *domain.PlaybackQueue, current string) bool {
	if q == nil {
		return true
	}
	if q.Version != 1 || (q.Repeat != "off" && q.Repeat != "all" && q.Repeat != "one") {
		return false
	}
	if (q.Current == nil && current != "") || (q.Current != nil && q.Current.TrackID != current) {
		return false
	}
	validSource := func(source *domain.PlaybackSource) bool {
		if source == nil {
			return true
		}
		if len(source.Name) > 1000 || source.Route["view"] == "" || len(source.Route) > 7 {
			return false
		}
		for key, value := range source.Route {
			if len(value) > 1000 {
				return false
			}
			switch key {
			case "view", "libraryId", "albumId", "artist", "adminTab", "query":
			default:
				return false
			}
		}
		return true
	}
	if !validSource(q.Source) {
		return false
	}
	entries := append([]domain.PlaybackEntry{}, q.History...)
	entries = append(entries, q.Forward...)
	entries = append(entries, q.Manual...)
	entries = append(entries, q.Remaining...)
	entries = append(entries, q.Cycle...)
	if q.Current != nil {
		entries = append(entries, *q.Current)
	}
	if len(entries) > 10000 {
		return false
	}
	identities := map[string]string{}
	for _, e := range entries {
		if len(e.ID) == 0 || len(e.ID) > 120 || len(e.TrackID) == 0 || len(e.TrackID) > 120 || e.Order < 0 || e.Order > 10000000 || !validSource(e.Source) {
			return false
		}
		if id, ok := identities[e.ID]; ok && id != e.TrackID {
			return false
		}
		identities[e.ID] = e.TrackID
	}
	return true
}
