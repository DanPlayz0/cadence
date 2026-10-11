// SPDX-License-Identifier: GPL-2.0-or-later
package scrobble

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestQualification(t *testing.T) {
	for _, tc := range []struct {
		duration, heard float64
		want            bool
	}{{30, 30, false}, {31, 15, false}, {31, 15.5, true}, {300, 149, false}, {300, 150, true}, {900, 239, false}, {900, 240, true}, {math.NaN(), 500, false}, {300, math.Inf(1), false}, {0, 1000, false}} {
		if Qualified(tc.duration, tc.heard) != tc.want {
			t.Fatal(tc)
		}
	}
}
func TestEventValidation(t *testing.T) {
	now := time.Now()
	valid := domain.SyncEvent{EventID: "0123456789abcdef", TrackID: "track", StartedAt: now.Add(-3 * time.Minute).Unix(), Heard: 150, Duration: 300}
	if err := ValidateEvent(valid, now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*domain.SyncEvent){func(e *domain.SyncEvent) { e.Heard = math.NaN() }, func(e *domain.SyncEvent) { e.Heard = 1000 }, func(e *domain.SyncEvent) { e.StartedAt = now.Unix() + 30 }, func(e *domain.SyncEvent) { e.StartedAt = now.AddDate(0, 0, -31).Unix() }, func(e *domain.SyncEvent) { e.EventID = "invalid.event.id" }} {
		e := valid
		mutate(&e)
		if ValidateEvent(e, now) == nil {
			t.Fatal("accepted invalid event", e)
		}
	}
}
func TestCredentialEncryptionAndRestart(t *testing.T) {
	dir := t.TempDir()
	s, err := New(nil, nil, NewProviders("", ""), dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.seal("user", "lastfm", "session-secret")
	if err != nil {
		t.Fatal(err)
	}
	c := domain.SyncConnection{Provider: "lastfm", Credential: b}
	if strings.Contains(string(b), "session-secret") {
		t.Fatal("plaintext credential")
	}
	v, err := json.Marshal(c)
	if err != nil || strings.Contains(string(v), "Credential") || strings.Contains(string(v), "session-secret") {
		t.Fatal("exposed credential")
	}
	s2, err := New(nil, nil, NewProviders("", ""), dir)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s2.open("user", c); err != nil || got != "session-secret" {
		t.Fatal(got, err)
	}
	if _, err = s2.open("other", c); err == nil {
		t.Fatal("cross-account decryption")
	}
	c.Provider = "listenbrainz"
	if _, err = s2.open("user", c); err == nil {
		t.Fatal("cross-provider decryption")
	}
	if err = os.WriteFile(filepath.Join(dir, "sync.key"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = New(nil, nil, NewProviders("", ""), dir); err == nil {
		t.Fatal("accepted broken key")
	}
}

type deliveryRepo struct {
	domain.SyncRepository
	delivery        *domain.SyncDelivery
	status, message string
	next            time.Time
}

func (r *deliveryRepo) NextSyncDelivery(context.Context) (*domain.SyncDelivery, error) {
	return r.delivery, nil
}
func (r *deliveryRepo) FinishSyncDelivery(_ context.Context, _ domain.SyncDelivery, status, message string, next time.Time) error {
	r.status, r.message, r.next = status, message, next
	return nil
}
func TestWorkerFailureClassification(t *testing.T) {
	for _, tc := range []struct{ response, want string }{{`{"scrobbles":{"@attr":{"accepted":"1"}}}`, "sent"}, {`{"error":9}`, "auth"}, {`{"error":11}`, "pending"}, {`{"error":6}`, "rejected"}} {
		t.Run(tc.want, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(tc.response)) }))
			defer srv.Close()
			repo := &deliveryRepo{}
			p := NewProviders("key", "secret")
			p.lastFMURL = srv.URL
			s, err := New(repo, nil, p, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			credential, err := s.seal("user", "lastfm", "session")
			if err != nil {
				t.Fatal(err)
			}
			repo.delivery = &domain.SyncDelivery{UserID: "user", Connection: domain.SyncConnection{Provider: "lastfm", Credential: credential}, Kind: "play", Attempts: 2, Payload: domain.SyncPayload{Title: "Song", Artist: "Artist"}}
			if err = s.DeliverOne(context.Background()); err != nil {
				t.Fatal(err)
			}
			if repo.status != tc.want {
				t.Fatal(repo.status)
			}
			if tc.want == "pending" && repo.next.Before(time.Now().Add(119*time.Second)) {
				t.Fatal("missing backoff")
			}
		})
	}
}
