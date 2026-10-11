// SPDX-License-Identifier: GPL-2.0-or-later
package scrobble

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type LastFMSettingsStatus struct {
	Configured bool   `json:"configured"`
	Source     string `json:"source"`
	Error      string `json:"error"`
}
type LastFMCredentials struct {
	APIKey    string `json:"apiKey"`
	APISecret string `json:"apiSecret"`
}

func (c LastFMCredentials) Valid() bool {
	return len(c.APIKey) > 0 && len(c.APIKey) <= 256 && len(c.APISecret) > 0 && len(c.APISecret) <= 256 && !strings.ContainsAny(c.APIKey+c.APISecret, " \r\n\t\x00")
}

// Saved settings override environment defaults, including an explicitly disabled pair.
func (s *Service) LoadLastFMSettings(ctx context.Context) error {
	unlock := s.Lock()
	defer unlock()
	b, found, err := s.Repo.LastFMSettings(ctx)
	if err != nil {
		return err
	}
	if !found {
		return nil
	}
	s.lastFMSaved = true
	value, err := s.open("instance", domain.SyncConnection{Provider: "lastfm", Credential: b})
	var c LastFMCredentials
	if err != nil || json.Unmarshal([]byte(value), &c) != nil || (!(c.APIKey == "" && c.APISecret == "") && !c.Valid()) {
		s.Providers.SetLastFM("", "")
		s.lastFMError = "Saved Last.fm credentials cannot be read. Re-enter them or restore the sync.key backup."
		return nil
	}
	s.Providers.SetLastFM(c.APIKey, c.APISecret)
	s.lastFMError = ""
	return nil
}
func (s *Service) LastFMSettingsStatus() LastFMSettingsStatus {
	unlock := s.Lock()
	defer unlock()
	source := "none"
	if s.lastFMSaved {
		source = "web"
	} else if s.Providers.Configured() {
		source = "environment"
	}
	return LastFMSettingsStatus{Configured: s.Providers.Configured(), Source: source, Error: s.lastFMError}
}
func (s *Service) SetLastFMSettings(ctx context.Context, c LastFMCredentials) error {
	if !(c.APIKey == "" && c.APISecret == "") && !c.Valid() {
		return errors.New("Enter both Last.fm API credentials")
	}
	unlock := s.Lock()
	defer unlock()
	key, secret := s.Providers.credentials()
	changed := key != c.APIKey || secret != c.APISecret
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	encrypted, err := s.seal("instance", "lastfm", string(b))
	if err != nil {
		return err
	}
	if err = s.Repo.SaveLastFMSettings(ctx, encrypted, changed); err != nil {
		return err
	}
	s.Providers.SetLastFM(c.APIKey, c.APISecret)
	s.lastFMSaved = true
	s.lastFMError = ""
	return nil
}
