// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"errors"
	"net/http"
)

func (s *Server) libraryDirectory(w http.ResponseWriter, r *http.Request) {
	l, o := pagination(r)
	v, e := s.Repo.LibraryDirectory(r.Context(), current(r).User.ID, r.URL.Query().Get("path"), l, o)
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, v)
}
func (s *Server) trackSuggestions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, e := s.Repo.Track(r.Context(), current(r).User.ID, id); e != nil {
		failure(w, e)
		return
	}
	v, e := s.Repo.TrackSuggestions(r.Context(), id)
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, v)
}
func (s *Server) applyMetadataChoices(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Choices []domain.MetadataChoice `json:"choices"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.Choices) == 0 || len(input.Choices) > 9 {
		write(w, 400, map[string]string{"error": "Choose between one and nine metadata fields."})
		return
	}
	id := r.PathValue("id")
	if _, e := s.Repo.Track(r.Context(), current(r).User.ID, id); e != nil {
		failure(w, e)
		return
	}
	for _, choice := range input.Choices {
		candidate, e := s.Repo.Suggestion(r.Context(), choice.ID)
		if e != nil {
			failure(w, e)
			return
		}
		if candidate.TrackID != id {
			write(w, 400, map[string]string{"error": "Choose suggestions for this song only."})
			return
		}
		if choice.Value != nil && !validSuggestion(candidate.Field, *choice.Value) {
			write(w, 400, map[string]string{"error": "Invalid replacement value."})
			return
		}
	}
	if e := s.Repo.ApplyMetadataChoices(r.Context(), id, input.Choices); e != nil {
		if errors.Is(e, domain.ErrConflict) {
			write(w, 409, map[string]string{"error": "Metadata or suggestions changed, or more than one candidate was chosen for a field. Reload suggestions and choose again."})
			return
		}
		failure(w, e)
		return
	}
	write(w, 200, map[string]int{"accepted": len(input.Choices)})
}
