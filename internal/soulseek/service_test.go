// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"cadence/internal/domain"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type memory struct {
	domain.SoulseekRepository
	domain.NamedLibraryRepository
	settings  domain.SoulseekSettings
	requests  map[string]domain.SoulseekRequest
	libraries []domain.MusicLibrary
}

func TestSaveSettingsForcesSeparatePage(t *testing.T) {
	for _, placement := range []string{"combined", "separate", ""} {
		t.Run(placement, func(t *testing.T) {
			cfg := domain.DefaultSoulseekSettings()
			cfg.Presentation = placement
			repo := &memory{settings: cfg}
			s := &Service{Repo: repo}
			if err := s.SaveSettings(context.Background(), cfg); err != nil {
				t.Fatal(err)
			}
			if repo.settings.Presentation != "separate" {
				t.Fatalf("saved placement = %q", repo.settings.Presentation)
			}
		})
	}
}

func (m *memory) SoulseekSettings(context.Context) (domain.SoulseekSettings, error) {
	return m.settings, nil
}
func (m *memory) SaveSoulseekSettings(_ context.Context, v domain.SoulseekSettings) error {
	m.settings = v
	return nil
}
func (m *memory) MusicLibraries(context.Context) ([]domain.MusicLibrary, error) {
	return m.libraries, nil
}
func clone(r domain.SoulseekRequest) domain.SoulseekRequest {
	r.Files = append([]domain.SoulseekRequestFile{}, r.Files...)
	return r
}
func (m *memory) SoulseekRequest(_ context.Context, id string) (domain.SoulseekRequest, error) {
	v, ok := m.requests[id]
	if !ok {
		return v, domain.ErrNotFound
	}
	return clone(v), nil
}
func (m *memory) SaveSoulseekRequest(_ context.Context, v *domain.SoulseekRequest) error {
	old := m.requests[v.ID]
	if old.Revision != v.Revision {
		return domain.ErrConflict
	}
	v.Revision++
	m.requests[v.ID] = clone(*v)
	return nil
}
func (m *memory) SoulseekRequests(_ context.Context, user string, active bool, limit, offset int) ([]domain.SoulseekRequest, error) {
	out := []domain.SoulseekRequest{}
	for _, v := range m.requests {
		if user != "" && v.UserID != user {
			continue
		}
		if active && v.State != "queued" && v.State != "downloading" && v.State != "importing" && v.State != "cancelling" {
			continue
		}
		out = append(out, clone(v))
	}
	if offset >= len(out) {
		return []domain.SoulseekRequest{}, nil
	}
	end := min(len(out), offset+limit)
	return out[offset:end], nil
}

type fakeRemote struct {
	Remote
	batches      map[string]Batch
	enqueues     int
	cancels      int
	err          error
	shares       []string
	shareError   error
	enqueueError error
}

func (f *fakeRemote) Batch(_ context.Context, id string) (Batch, error) {
	if f.err != nil {
		return Batch{}, f.err
	}
	b, ok := f.batches[id]
	if !ok {
		return b, &APIError{404}
	}
	return b, nil
}
func (f *fakeRemote) Enqueue(_ context.Context, r domain.SoulseekRequest) error {
	f.enqueues++
	b := Batch{}
	for _, file := range r.Files {
		b.Transfers = append(b.Transfers, Transfer{ID: ID(), Filename: file.Filename, State: "Queued"})
	}
	f.batches[r.BatchID] = b
	return f.enqueueError
}
func (f *fakeRemote) Cancel(context.Context, string, string) error { f.cancels++; return nil }
func (f *fakeRemote) SyncShares(_ context.Context, old, wanted []string) error {
	f.shares = append([]string{}, wanted...)
	return f.shareError
}
func setup(t *testing.T) (*Service, *memory, *fakeRemote, domain.User, domain.SoulseekRule) {
	t.Helper()
	dest := t.TempDir()
	stage := t.TempDir()
	m := &memory{settings: domain.DefaultSoulseekSettings(), requests: map[string]domain.SoulseekRequest{}, libraries: []domain.MusicLibrary{{ID: "library", Folders: []string{dest}}}}
	m.settings.LosslessOnly = false
	m.settings.Enabled = true
	m.settings.Users = []string{"listener"}
	f := &fakeRemote{batches: map[string]Batch{}}
	s := &Service{Repo: m, Libraries: m, Remote: f, Configured: true, Roots: []string{dest}, WritableRoots: []string{dest}, Stage: stage, ValidateAudio: func(context.Context, *os.File) error { return nil }}
	return s, m, f, domain.User{ID: "listener"}, domain.SoulseekRule{Mode: "auto", LibraryID: "library", Folder: dest}
}
func files() []domain.SoulseekFile {
	return []domain.SoulseekFile{{Filename: `Music\Album\song.mp3`, Size: 5}}
}
func complete(t *testing.T, s *Service, f *fakeRemote, r domain.SoulseekRequest) {
	t.Helper()
	dir := filepath.Join(s.Stage, r.BatchID)
	if e := os.MkdirAll(dir, 0750); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(dir, "song.mp3"), []byte("audio"), 0640); e != nil {
		t.Fatal(e)
	}
	f.batches[r.BatchID] = Batch{Transfers: []Transfer{{ID: ID(), Filename: files()[0].Filename, State: "Completed, Succeeded", BytesTransferred: 5}}}
}
func TestRouting(t *testing.T) {
	cfg := domain.DefaultSoulseekSettings()
	u := domain.User{ID: "u", Groups: []string{"b", "a"}}
	cfg.Default.Mode = "review"
	cfg.GroupRules = []domain.SoulseekRule{{Subject: "a", Mode: "auto", LibraryID: "first"}, {Subject: "b", Mode: "review"}}
	if cfg.Rule(u).LibraryID != "first" {
		t.Fatal("group order ignored")
	}
	cfg.UserRules = []domain.SoulseekRule{{Subject: "u", Mode: "review"}}
	if cfg.Rule(u).Mode != "review" {
		t.Fatal("user override ignored")
	}
	cfg.Enabled = true
	cfg.Groups = []string{"a"}
	if !cfg.Allows(u) {
		t.Fatal("group grant ignored")
	}
	cfg.Groups = nil
	if cfg.Allows(u) {
		t.Fatal("revocation ignored")
	}
	u.Admin = true
	if !cfg.Allows(u) {
		t.Fatal("admin denied")
	}
	cfg.Enabled = false
	if cfg.Allows(u) {
		t.Fatal("disabled allowed")
	}
}
func TestReviewTimingAndBypass(t *testing.T) {
	for _, timing := range []string{"before", "after"} {
		t.Run(timing, func(t *testing.T) {
			s, m, f, u, rule := setup(t)
			m.settings.ReviewTiming = timing
			r, e := s.Create(context.Background(), u, ID(), "peer", "Music/Album", files())
			if e != nil {
				t.Fatal(e)
			}
			if e = s.Tick(context.Background()); e != nil {
				t.Fatal(e)
			}
			if timing == "before" {
				if f.enqueues != 0 {
					t.Fatal("download before approval")
				}
				r, e = s.Action(context.Background(), domain.User{Admin: true}, r.ID, "approve", rule)
				if e != nil {
					t.Fatal(e)
				}
				s.Tick(context.Background())
			}
			r, _ = m.SoulseekRequest(context.Background(), r.ID)
			complete(t, s, f, r)
			if e = s.Tick(context.Background()); e != nil {
				t.Fatal(e)
			}
			r, _ = m.SoulseekRequest(context.Background(), r.ID)
			if timing == "after" {
				if r.State != "review_after" {
					t.Fatal(r.State)
				}
				if _, e = os.Stat(filepath.Join(rule.Folder, "Soulseek-"+r.ID)); !os.IsNotExist(e) {
					t.Fatal("unapproved import")
				}
				r, e = s.Action(context.Background(), domain.User{Admin: true}, r.ID, "approve", rule)
				if e != nil {
					t.Fatal(e)
				}
				if e = s.Tick(context.Background()); e != nil {
					t.Fatal(e)
				}
			}
			r, _ = m.SoulseekRequest(context.Background(), r.ID)
			if r.State != "imported" {
				t.Fatalf("%s: %s", r.State, r.Error)
			}
		})
	}
	s, m, f, u, rule := setup(t)
	m.settings.UserRules = []domain.SoulseekRule{{Subject: u.ID, Mode: "auto", LibraryID: rule.LibraryID, Folder: rule.Folder}}
	r, e := s.Create(context.Background(), u, ID(), "peer", "Music/Album", files())
	if e != nil || !r.Approved {
		t.Fatal("override did not bypass review", e)
	}
	s.Tick(context.Background())
	if f.enqueues != 1 {
		t.Fatal("not queued")
	}
}
func TestRestartAndImportRecovery(t *testing.T) {
	s, m, f, u, rule := setup(t)
	m.settings.Default = rule
	r, e := s.Create(context.Background(), u, ID(), "peer", "Music/Album", files())
	if e != nil {
		t.Fatal(e)
	}
	f.Enqueue(context.Background(), r) // remote accepted before the process saved downloading
	if e = s.Tick(context.Background()); e != nil {
		t.Fatal(e)
	}
	if f.enqueues != 1 {
		t.Fatal("duplicate enqueue")
	}
	complete(t, s, f, r)
	// Simulate publication before the database saved the imported marker.
	if _, _, e = s.importFile(context.Background(), r.ID, r.BatchID, rule.Folder, domain.SoulseekRequestFile{SoulseekFile: files()[0]}); e != nil {
		t.Fatal(e)
	}
	scans := 0
	s.Scan = func() { scans++ }
	if e = s.Tick(context.Background()); e != nil {
		t.Fatal(e)
	}
	saved, _ := m.SoulseekRequest(context.Background(), r.ID)
	if saved.State != "imported" || saved.Files[0].Digest == "" {
		t.Fatal(saved)
	}
	s.Tick(context.Background())
	if scans != 1 {
		t.Fatal("duplicate scan")
	}
	same, e := s.Create(context.Background(), u, r.ID, "peer", "Music/Album", files())
	if e != nil || same.ID != r.ID || len(m.requests) != 1 {
		t.Fatal("idempotency failure")
	}
}
func TestDestinationChangesAndRetryApproval(t *testing.T) {
	s, m, f, u, rule := setup(t)
	m.settings.Default = rule
	r, _ := s.Create(context.Background(), u, ID(), "peer", "Music/Album", files())
	s.Tick(context.Background())
	complete(t, s, f, r)
	m.libraries = nil
	s.Tick(context.Background())
	saved, _ := m.SoulseekRequest(context.Background(), r.ID)
	if saved.State != "blocked" {
		t.Fatal(saved.State)
	}
	if _, e := s.Destination(context.Background(), rule, true); e == nil {
		t.Fatal("deleted library accepted")
	}
	m.libraries = []domain.MusicLibrary{{ID: rule.LibraryID, Folders: []string{rule.Folder}}}
	s.WritableRoots = nil
	if _, e := s.Destination(context.Background(), rule, true); e == nil {
		t.Fatal("unallowed root accepted")
	}
	s, m, _, u, _ = setup(t)
	r, _ = s.Create(context.Background(), u, ID(), "peer", "Music/Album", files())
	s.Action(context.Background(), u, r.ID, "cancel", domain.SoulseekRule{})
	s.Tick(context.Background())
	r, e := s.Action(context.Background(), u, r.ID, "retry", domain.SoulseekRule{})
	if e != nil || r.State != "review_before" {
		t.Fatal("retry bypassed review", r.State, e)
	}
}
func TestImportValidationAndCollision(t *testing.T) {
	s, _, _, _, rule := setup(t)
	id, batch := ID(), ID()
	if e := os.MkdirAll(filepath.Join(s.Stage, batch), 0750); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(filepath.Join(s.Stage, batch, "song.mp3"), []byte("audio"), 0600)
	f := domain.SoulseekRequestFile{SoulseekFile: files()[0]}
	s.ValidateAudio = func(context.Context, *os.File) error { return errors.New("invalid audio") }
	if _, _, e := s.importFile(context.Background(), id, batch, rule.Folder, f); e == nil {
		t.Fatal("invalid audio accepted")
	}
	s.ValidateAudio = func(context.Context, *os.File) error { return nil }
	dir := filepath.Join(rule.Folder, "Soulseek-"+id)
	os.MkdirAll(dir, 0750)
	os.WriteFile(filepath.Join(dir, "song.mp3"), []byte("other"), 0600)
	if _, _, e := s.importFile(context.Background(), id, batch, rule.Folder, f); e == nil {
		t.Fatal("collision overwritten")
	}
	data, _ := os.ReadFile(filepath.Join(dir, "song.mp3"))
	if string(data) != "other" {
		t.Fatal("overwritten")
	}
	f.Filename = `Music\..\song.mp3`
	if _, _, e := s.importFile(context.Background(), id, batch, rule.Folder, f); e == nil {
		t.Fatal("traversal accepted")
	}
}
func TestUnavailableAndSharing(t *testing.T) {
	s, m, f, u, rule := setup(t)
	m.settings.Default = rule
	r, _ := s.Create(context.Background(), u, ID(), "peer", "Music/Album", files())
	f.err = ErrUnavailable
	if e := s.Tick(context.Background()); e != nil {
		t.Fatal(e)
	}
	saved, _ := m.SoulseekRequest(context.Background(), r.ID)
	if saved.State != "queued" {
		t.Fatal("outage discarded job")
	}
	f.err = nil
	v := m.settings
	v.Sharing = "selected"
	v.ShareFolders = []string{rule.Folder}
	f.shareError = ErrUnavailable
	if e := s.SaveSettings(context.Background(), v); e != nil {
		t.Fatal(e)
	}
	if m.settings.SharingError == "" {
		t.Fatal("missing sharing failure")
	}
	f.shareError = nil
	s.Tick(context.Background())
	if len(m.settings.ManagedShares) != 1 || m.settings.SharingError != "" {
		t.Fatal("sync not recovered")
	}
	v = m.settings
	v.Sharing = "disabled"
	s.SaveSettings(context.Background(), v)
	if len(f.shares) != 0 {
		t.Fatal("shares not removed")
	}
}
func TestSymlinkEscape(t *testing.T) {
	s, _, _, _, rule := setup(t)
	id, batch := ID(), ID()
	outside := t.TempDir()
	if e := os.Symlink(outside, filepath.Join(rule.Folder, "Soulseek-"+id)); e != nil {
		t.Skip("symlink creation unavailable")
	}
	os.MkdirAll(filepath.Join(s.Stage, batch), 0750)
	os.WriteFile(filepath.Join(s.Stage, batch, "song.mp3"), []byte("audio"), 0600)
	if _, _, e := s.importFile(context.Background(), id, batch, rule.Folder, domain.SoulseekRequestFile{SoulseekFile: files()[0]}); e == nil {
		t.Fatal("symlink escape accepted")
	}
	if _, e := os.Stat(filepath.Join(outside, "song.mp3")); !os.IsNotExist(e) {
		t.Fatal("file escaped")
	}
}
