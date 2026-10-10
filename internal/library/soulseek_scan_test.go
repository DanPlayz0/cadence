// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"cadence/internal/domain"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestSoulseekStagingExcludedFromScan(t *testing.T) {
	root := t.TempDir()
	stage := filepath.Join(root, "staging")
	os.MkdirAll(stage, 0700)
	p := filepath.Join(stage, "unapproved.mp3")
	os.WriteFile(p, []byte("pending"), 0600)
	info, _ := os.Stat(p)
	normalized := filepath.ToSlash(p)
	r := &namedScanRepo{missingScanRepo: missingScanRepo{tracks: map[string]domain.Track{normalized: {Path: normalized, Size: info.Size(), Modified: info.ModTime().UnixNano()}}, seen: map[string]bool{}}, libraries: []domain.MusicLibrary{{ID: "all", Folders: []string{root}}}, done: make(chan domain.Scan, 1)}
	scanner := &Scanner{Repo: r, Roots: []string{root}, ExcludedRoots: []string{filepath.ToSlash(stage)}, ManagedLibraries: true, Context: context.Background()}
	if _, ok := scanner.Start(false); !ok {
		t.Fatal("scan not started")
	}
	scanResult(t, r.done)
	if r.seen[normalized] || len(r.indexed) != 0 {
		t.Fatal("staging appeared in catalog")
	}
}
