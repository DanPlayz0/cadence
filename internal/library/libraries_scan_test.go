// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"cadence/internal/domain"
)

type namedScanRepo struct {
	missingScanRepo
	domain.NamedLibraryRepository
	mu        sync.Mutex
	libraries []domain.MusicLibrary
	folders   []string
	snapshots int
	gate      chan struct{}
	captured  chan struct{}
	done      chan domain.Scan
}

func (r *namedScanRepo) MusicLibraries(context.Context) ([]domain.MusicLibrary, error) {
	r.mu.Lock()
	libs := append([]domain.MusicLibrary(nil), r.libraries...)
	r.snapshots++
	first := r.snapshots == 1
	r.mu.Unlock()
	if first && r.gate != nil {
		close(r.captured)
		<-r.gate
	}
	return libs, nil
}
func (r *namedScanRepo) ScanStart(context.Context, domain.Scan) error      { return nil }
func (r *namedScanRepo) ScanFinish(_ context.Context, v domain.Scan) error { r.done <- v; return nil }
func (r *namedScanRepo) FinishFolder(_ context.Context, folder, scan string) error {
	r.mu.Lock()
	r.folders = append(r.folders, folder)
	r.mu.Unlock()
	return nil
}

func scanResult(t *testing.T, ch <-chan domain.Scan) domain.Scan {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(10 * time.Second):
		t.Fatal("scan did not finish")
		return domain.Scan{}
	}
}
func TestManagedScanFoldersAndQueuedConfiguration(t *testing.T) {
	root := t.TempDir()
	family := filepath.Join(root, "Family")
	other := filepath.Join(root, "Other")
	child := filepath.Join(family, "Albums")
	for _, p := range []string{family, other, child} {
		if e := os.MkdirAll(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	family, _ = Canonical(family)
	other, _ = Canonical(other)
	child, _ = Canonical(child)
	repo := &namedScanRepo{missingScanRepo: missingScanRepo{tracks: map[string]domain.Track{}, seen: map[string]bool{}}, libraries: []domain.MusicLibrary{{Folders: []string{family, child, family}}}, gate: make(chan struct{}), captured: make(chan struct{}), done: make(chan domain.Scan, 3)}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	scanner := Scanner{Repo: repo, Roots: []string{root}, ManagedLibraries: true, Context: ctx}
	if _, ok := scanner.Start(false); !ok {
		t.Fatal("scan start failed")
	}
	select {
	case <-repo.captured:
	case <-time.After(10 * time.Second):
		t.Fatal("snapshot not captured")
	}
	repo.mu.Lock()
	repo.libraries = []domain.MusicLibrary{{Folders: []string{other}}}
	repo.mu.Unlock()
	scanner.RequestScan()
	scanner.RequestScan()
	close(repo.gate)
	first := scanResult(t, repo.done)
	second := scanResult(t, repo.done)
	if first.Status != "complete" || second.Status != "complete" {
		t.Fatal("scan failed", first, second)
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.folders) != 2 || repo.folders[0] != family || repo.folders[1] != other {
		t.Fatal("overlap deduplication or queued latest configuration failed", repo.folders)
	}
}

func TestManagedScanUnavailableAndEmptyLibraries(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	repo := &namedScanRepo{missingScanRepo: missingScanRepo{tracks: map[string]domain.Track{}, seen: map[string]bool{}}, libraries: []domain.MusicLibrary{{Folders: []string{filepath.Join(root, "missing"), outside}}}, done: make(chan domain.Scan, 2)}
	scanner := Scanner{Repo: repo, Roots: []string{root}, ManagedLibraries: true}
	scanner.run(context.Background(), domain.Scan{ID: "missing"}, ScanOptions{})
	v := scanResult(t, repo.done)
	if v.Status != "complete_with_errors" || len(repo.folders) != 0 {
		t.Fatal("unavailable/outside mount reconciled", v, repo.folders)
	}
	repo.libraries = nil
	scanner.run(context.Background(), domain.Scan{ID: "empty"}, ScanOptions{})
	v = scanResult(t, repo.done)
	if v.Status != "complete" || len(repo.folders) != 0 {
		t.Fatal("empty libraries scanned broad mount", v)
	}
}

func TestManagedScanFailureDoesNotReconcileFolder(t *testing.T) {
	root, e := Canonical(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(root, "song.mp3"), []byte("fixture"), 0600); e != nil {
		t.Fatal(e)
	}
	repo := &namedScanRepo{
		missingScanRepo: missingScanRepo{tracks: map[string]domain.Track{}, seen: map[string]bool{}, lookupError: errors.New("database unavailable")},
		libraries:       []domain.MusicLibrary{{Folders: []string{root}}}, done: make(chan domain.Scan, 1),
	}
	scanner := Scanner{Repo: repo, Roots: []string{root}, ManagedLibraries: true}
	scanner.run(context.Background(), domain.Scan{ID: "partial"}, ScanOptions{MissingOnly: true})
	v := scanResult(t, repo.done)
	if v.Status != "complete_with_errors" || len(repo.folders) != 0 {
		t.Fatal("failed folder reconciled", v, repo.folders)
	}
}
