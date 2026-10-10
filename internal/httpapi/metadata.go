// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"errors"
	"net/http"
	"strings"
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

func metadataFilter(field, value string) bool {
	switch field {
	case "title", "artist", "album", "albumArtist", "year", "genre", "number", "disc":
	default:
		return false
	}
	return len(value) <= 500 && !strings.ContainsRune(value, 0)
}
func (s *Server) metadataMatches(w http.ResponseWriter, r *http.Request) {
	field, value := r.URL.Query().Get("field"), r.URL.Query().Get("value")
	if !metadataFilter(field, value) {
		write(w, 400, map[string]string{"error": "Choose a valid metadata attribute and a value up to 500 bytes"})
		return
	}
	limit, offset := pagination(r)
	result, err := s.Repo.MetadataMatches(r.Context(), current(r).User.ID, field, value, limit, offset)
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, result)
}
func (s *Server) bulkMetadataSuggestions(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Field         string `json:"field"`
		Match         string `json:"match"`
		Value         string `json:"value"`
		ExpectedCount int    `json:"expectedCount"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !metadataFilter(input.Field, input.Match) || !validSuggestion(input.Field, input.Value) || strings.ContainsRune(input.Value, 0) || input.ExpectedCount < 1 {
		write(w, 400, map[string]string{"error": "Choose a valid attribute and replacement. Title and artist cannot be empty; track and disc numbers must be 0–9999."})
		return
	}
	count, err := s.Repo.BulkMetadataSuggestions(r.Context(), current(r).User.ID, input.Field, input.Match, input.Value, input.ExpectedCount)
	if errors.Is(err, domain.ErrConflict) {
		write(w, 409, map[string]string{"error": "Matching songs changed. Refresh the preview before saving again."})
		return
	}
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, map[string]int64{"saved": count})
}
