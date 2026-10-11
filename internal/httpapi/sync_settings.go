// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/scrobble"
	"net/http"
	"strings"
)

func (s *Server) adminLastFMSettings(w http.ResponseWriter, r *http.Request) {
	if !s.syncReady(w) {
		return
	}
	if r.Method != "GET" {
		var credentials scrobble.LastFMCredentials
		if r.Method == "PUT" {
			if !decode(w, r, &credentials) {
				return
			}
			credentials.APIKey = strings.TrimSpace(credentials.APIKey)
			credentials.APISecret = strings.TrimSpace(credentials.APISecret)
			if !credentials.Valid() {
				write(w, 400, map[string]string{"error": "Enter both Last.fm API key and API secret (up to 256 characters each, without spaces)"})
				return
			}
		}
		if err := s.Sync.SetLastFMSettings(r.Context(), credentials); err != nil {
			failure(w, err)
			return
		}
	}
	status := s.Sync.LastFMSettingsStatus()
	write(w, 200, struct {
		scrobble.LastFMSettingsStatus
		PublicURLConfigured bool `json:"publicUrlConfigured"`
	}{status, s.Config.PublicURL != ""})
}
