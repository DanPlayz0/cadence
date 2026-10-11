// SPDX-License-Identifier: GPL-2.0-or-later
package scrobble

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
)

type settingsRepo struct {
	domain.SyncRepository
	value          []byte
	found, changed bool
	err            error
}

func (r *settingsRepo) LastFMSettings(context.Context) ([]byte, bool, error) {
	return r.value, r.found, nil
}
func (r *settingsRepo) SaveLastFMSettings(_ context.Context, b []byte, changed bool) error {
	if r.err != nil {
		return r.err
	}
	r.value = append([]byte(nil), b...)
	r.found = true
	r.changed = changed
	return nil
}

func TestLastFMWebSettingsEncryptionPrecedenceRestartAndDisable(t *testing.T) {
	ctx := context.Background()
	repo := &settingsRepo{}
	dir := t.TempDir()
	s, err := New(repo, nil, NewProviders("env-key", "env-secret"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.LoadLastFMSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if got := s.LastFMSettingsStatus(); !got.Configured || got.Source != "environment" {
		t.Fatal(got)
	}
	credentials := LastFMCredentials{APIKey: "web-key", APISecret: "web-secret"}
	if err = s.SetLastFMSettings(ctx, credentials); err != nil {
		t.Fatal(err)
	}
	if !repo.changed || strings.Contains(string(repo.value), "web-secret") {
		t.Fatal("not encrypted/rotation not recorded")
	}
	b, _ := json.Marshal(s.LastFMSettingsStatus())
	if strings.Contains(string(b), "web-key") || strings.Contains(string(b), "web-secret") {
		t.Fatal("credentials leaked")
	}
	if key, secret := s.Providers.credentials(); key != "web-key" || secret != "web-secret" {
		t.Fatal("not applied immediately")
	}
	if err = s.SetLastFMSettings(ctx, credentials); err != nil {
		t.Fatal(err)
	}
	if repo.changed {
		t.Fatal("unchanged credentials should not require reconnecting")
	}
	restarted, err := New(repo, nil, NewProviders("other-env-key", "other-env-secret"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = restarted.LoadLastFMSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if key, secret := restarted.Providers.credentials(); key != "web-key" || secret != "web-secret" {
		t.Fatal("environment overrode saved settings")
	}
	if err = restarted.SetLastFMSettings(ctx, LastFMCredentials{}); err != nil {
		t.Fatal(err)
	}
	restarted, err = New(repo, nil, NewProviders("env-key", "env-secret"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = restarted.LoadLastFMSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if got := restarted.LastFMSettingsStatus(); got.Configured || got.Source != "web" {
		t.Fatal("disabled settings did not survive restart", got)
	}
}

func TestLastFMSettingsFailureAndLostEncryptionKey(t *testing.T) {
	ctx := context.Background()
	repo := &settingsRepo{}
	s, err := New(repo, nil, NewProviders("env-key", "env-secret"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SetLastFMSettings(ctx, LastFMCredentials{APIKey: "only-key"}); err == nil {
		t.Fatal("accepted incomplete pair")
	}
	repo.err = errors.New("database unavailable")
	if err = s.SetLastFMSettings(ctx, LastFMCredentials{APIKey: "new-key", APISecret: "new-secret"}); err == nil {
		t.Fatal("ignored database failure")
	}
	if key, _ := s.Providers.credentials(); key != "env-key" {
		t.Fatal("changed runtime settings before persistence succeeded")
	}
	repo.err = nil
	if err = s.SetLastFMSettings(ctx, LastFMCredentials{APIKey: "saved-key", APISecret: "saved-secret"}); err != nil {
		t.Fatal(err)
	}
	// A different key cannot decrypt the settings, but must leave the UI available for repair.
	lost, err := New(repo, nil, NewProviders("env-key", "env-secret"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = lost.LoadLastFMSettings(ctx); err != nil {
		t.Fatal(err)
	}
	status := lost.LastFMSettingsStatus()
	if status.Configured || status.Error == "" {
		t.Fatal("missing repair guidance", status)
	}
	if err = lost.SetLastFMSettings(ctx, LastFMCredentials{APIKey: "replacement-key", APISecret: "replacement-secret"}); err != nil {
		t.Fatal(err)
	}
	if status = lost.LastFMSettingsStatus(); !status.Configured || status.Error != "" {
		t.Fatal("web repair failed", status)
	}
}

func TestLastFMCredentialPairsStayConsistentDuringUpdates(t *testing.T) {
	p := NewProviders("first-key", "first-secret")
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 2000; i++ {
			p.SetLastFM("second-key", "second-secret")
			p.SetLastFM("first-key", "first-secret")
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 2000; i++ {
			key, secret := p.credentials()
			if (key == "first-key" && secret != "first-secret") || (key == "second-key" && secret != "second-secret") {
				t.Error("mixed application credentials")
			}
			_ = p.Configured()
		}
	}()
	wg.Wait()
}
