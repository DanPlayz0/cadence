// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/domain"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"
)

func (s *Server) artistAccessible(w http.ResponseWriter, r *http.Request, artist string) bool {
	if artist == "" || utf8.RuneCountInString(artist) > 300 {
		write(w, 400, map[string]string{"error": "Choose an artist name (up to 300 characters)"})
		return false
	}
	page, err := s.Repo.Tracks(r.Context(), current(r).User.ID, domain.Query{Artist: artist, Limit: 1})
	if err != nil {
		failure(w, err)
		return false
	}
	if page.Total == 0 {
		failure(w, domain.ErrNotFound)
		return false
	}
	return true
}
func (s *Server) artistProfile(w http.ResponseWriter, r *http.Request) {
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	if !s.artistAccessible(w, r, artist) {
		return
	}
	profile, err := s.Repo.ArtistProfile(r.Context(), artist)
	if errors.Is(err, domain.ErrNotFound) {
		write(w, 200, map[string]any{"profile": nil})
		return
	}
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, map[string]any{"profile": profile})
}
func (s *Server) fetchArtistProfile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Artist string `json:"artist"`
		MBID   string `json:"mbid"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Artist = strings.TrimSpace(input.Artist)
	input.MBID = strings.TrimSpace(input.MBID)
	if !s.artistAccessible(w, r, input.Artist) {
		return
	}
	if s.Scanner == nil || s.Scanner.Enricher == nil {
		write(w, 503, map[string]string{"error": "Artist lookups are not configured"})
		return
	}
	profile, err := s.Scanner.Enricher.FetchArtistProfile(r.Context(), input.Artist, input.MBID)
	if err != nil {
		write(w, 502, map[string]string{"error": err.Error()})
		return
	}
	// Access can change while the external request is in progress.
	if !s.artistAccessible(w, r, input.Artist) {
		return
	}
	if profile.Warning != "" {
		previous, readErr := s.Repo.ArtistProfile(r.Context(), input.Artist)
		if readErr != nil && !errors.Is(readErr, domain.ErrNotFound) {
			failure(w, readErr)
			return
		}
		if readErr == nil && previous.MBID == profile.MBID {
			profile.Biography = previous.Biography
			profile.Wikipedia = previous.Wikipedia
			profile.Image = previous.Image
			profile.ImageSource = previous.ImageSource
		}
	}
	if err = s.Repo.SaveArtistProfile(r.Context(), input.Artist, profile); err != nil {
		failure(w, err)
		return
	}
	write(w, 200, map[string]any{"profile": profile})
}
