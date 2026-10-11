// SPDX-License-Identifier: GPL-2.0-or-later
package scrobble

import (
	"cadence/internal/domain"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Service struct {
	Repo      domain.SyncRepository
	Catalog   domain.LibraryRepository
	Providers *Providers
	aead      cipher.AEAD
	// One process owns an instance. Serialize delivery with preferences/account changes.
	mu sync.Mutex
}

func New(repo domain.SyncRepository, catalog domain.LibraryRepository, p *Providers, dataDir string) (*Service, error) {
	path := filepath.Join(dataDir, "sync.key")
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		b = make([]byte, 32)
		if _, err = rand.Read(b); err != nil {
			return nil, err
		}
		f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return nil, e
		}
		_, err = f.Write(b)
		if e = f.Close(); err == nil {
			err = e
		}
	}
	if err != nil {
		return nil, err
	}
	if len(b) != 32 {
		return nil, fmt.Errorf("sync.key must contain exactly 32 bytes; restore its backup")
	}
	block, err := aes.NewCipher(b)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Service{Repo: repo, Catalog: catalog, Providers: p, aead: aead}, nil
}
func (s *Service) Lock() func() { s.mu.Lock(); return s.mu.Unlock }
func (s *Service) seal(user, provider, credential string) ([]byte, error) {
	n := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(n); err != nil {
		return nil, err
	}
	return s.aead.Seal(n, n, []byte(credential), []byte(user+":"+provider)), nil
}
func (s *Service) open(user string, c domain.SyncConnection) (string, error) {
	n := s.aead.NonceSize()
	if len(c.Credential) < n {
		return "", errors.New("invalid encrypted credential")
	}
	b, err := s.aead.Open(nil, c.Credential[:n], c.Credential[n:], []byte(user+":"+c.Provider))
	return string(b), err
}
func (s *Service) Connect(ctx context.Context, user, provider, token string) error {
	if provider != "lastfm" && provider != "listenbrainz" {
		return errors.New("Unknown sync provider")
	}
	if provider == "lastfm" && !s.Providers.Configured() {
		return errors.New("Last.fm is not configured")
	}
	unlock := s.Lock()
	defer unlock()
	var name, credential string
	var err error
	if provider == "lastfm" {
		name, credential, err = s.Providers.LastFMSession(ctx, token)
	} else {
		name, err = s.Providers.ListenBrainzUser(ctx, token)
		credential = token
	}
	if err != nil {
		return err
	}
	encrypted, err := s.seal(user, provider, credential)
	if err != nil {
		return err
	}
	return s.Repo.SaveSyncConnection(ctx, user, domain.SyncConnection{Provider: provider, Username: name, Credential: encrypted})
}
func Qualified(duration, heard float64) bool {
	return !math.IsNaN(duration) && !math.IsInf(duration, 0) && !math.IsNaN(heard) && !math.IsInf(heard, 0) && duration > 30 && heard >= math.Min(duration/2, 240)
}
func ValidateEvent(e domain.SyncEvent, now time.Time) error {
	if len(e.EventID) < 16 || len(e.EventID) > 100 || strings.Trim(e.EventID, "0123456789abcdefABCDEF-") != "" || len(e.TrackID) == 0 || len(e.TrackID) > 120 || e.StartedAt < 1 || e.StartedAt > now.Unix()+5 || e.StartedAt < now.AddDate(0, 0, -30).Unix() || math.IsNaN(e.Heard) || math.IsInf(e.Heard, 0) || e.Heard < 0 || e.Heard > 172800 || math.IsNaN(e.Duration) || math.IsInf(e.Duration, 0) || e.Duration < 0 || e.Duration > 172800 {
		return errors.New("Invalid listening event")
	}
	if e.Heard > float64(now.Unix()-e.StartedAt)+5 {
		return errors.New("Listening time exceeds elapsed time")
	}
	return nil
}
func payload(t domain.Track, e domain.SyncEvent) domain.SyncPayload {
	return domain.SyncPayload{TrackID: t.ID, Title: t.Title, Artist: t.Artist, Album: t.Album, Duration: e.Duration, StartedAt: e.StartedAt}
}
func validMetadata(t domain.Track) bool {
	return strings.TrimSpace(t.Title) != "" && strings.TrimSpace(t.Artist) != "" && !strings.EqualFold(strings.TrimSpace(t.Artist), "Unknown artist")
}
func (s *Service) Listen(ctx context.Context, user string, e domain.SyncEvent) error {
	unlock := s.Lock()
	defer unlock()
	if err := ValidateEvent(e, time.Now()); err != nil {
		return err
	}
	t, err := s.Catalog.Track(ctx, user, e.TrackID)
	if err != nil {
		return err
	}
	if t.Duration > 0 {
		e.Duration = t.Duration
	}
	if !Qualified(e.Duration, e.Heard) || !validMetadata(t) {
		return nil
	}
	return s.Repo.RecordSyncListen(ctx, user, e, payload(t, e))
}
func (s *Service) NowPlaying(ctx context.Context, user string, e domain.SyncEvent) error {
	unlock := s.Lock()
	defer unlock()
	if err := ValidateEvent(e, time.Now()); err != nil {
		return err
	}
	if time.Now().Unix()-e.StartedAt > 300 {
		return nil
	}
	t, err := s.Catalog.Track(ctx, user, e.TrackID)
	if err != nil {
		return err
	}
	if !validMetadata(t) {
		return nil
	}
	if t.Duration > 0 {
		e.Duration = t.Duration
	}
	connections, err := s.Repo.SyncConnections(ctx, user)
	if err != nil {
		return err
	}
	for _, c := range connections {
		if !c.NowPlaying || c.Paused {
			continue
		}
		credential, err := s.open(user, c)
		if err != nil {
			if err = s.Repo.SyncNotificationResult(ctx, user, c.ID, "auth", "Cannot decrypt account credentials; restore sync.key or reconnect"); err != nil {
				return err
			}
			continue
		}
		id, err := s.Providers.Send(ctx, c.Provider, credential, "now", "", payload(t, e))
		status, message := "sent", ""
		if err != nil {
			var pe *providerError
			if errors.As(err, &pe) {
				status, message = pe.kind, pe.message
			} else {
				status, message = "rejected", "Now-playing notification failed"
			}
		}
		if resultErr := s.Repo.SyncNotificationResult(ctx, user, c.ID, status, message); resultErr != nil {
			return resultErr
		}
		if err == nil && id != "" {
			if err = s.Repo.SaveSyncRecording(ctx, user, c.ID, payload(t, e), id); err != nil {
				return err
			}
		}
		// Now-playing notifications are best effort, never queued or retried.
	}
	return nil
}
func (s *Service) DeliverOne(ctx context.Context) error {
	unlock := s.Lock()
	defer unlock()
	d, err := s.Repo.NextSyncDelivery(ctx)
	if err != nil || d == nil {
		return err
	}
	credential, err := s.open(d.UserID, d.Connection)
	status, message := "sent", ""
	next := time.Now()
	if err != nil {
		status = "auth"
		message = "Cannot decrypt account credentials; restore sync.key or reconnect"
	} else {
		_, err = s.Providers.Send(ctx, d.Connection.Provider, credential, d.Kind, d.RecordingID, d.Payload)
		if err != nil {
			var pe *providerError
			if errors.As(err, &pe) {
				status, message = pe.kind, pe.message
				backoff := time.Duration(1<<min(d.Attempts, 10)) * 30 * time.Second
				if pe.retryAfter > backoff {
					backoff = pe.retryAfter
				}
				next = time.Now().Add(backoff)
			} else {
				status = "pending"
				message = "Submission failed; retrying"
				next = time.Now().Add(time.Minute)
			}
		}
	}
	return s.Repo.FinishSyncDelivery(ctx, *d, status, message, next)
}
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			call, cancel := context.WithTimeout(ctx, 15*time.Second)
			_ = s.DeliverOne(call)
			cancel()
		}
	}
}
