// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"cadence/internal/domain"
)

type missingScanRepo struct {
	domain.Repository
	tracks      map[string]domain.Track
	seen        map[string]bool
	indexed     []string
	finished    domain.Scan
	lookupError error
	cleaned     bool
	enrichment  bool
}

func (r *missingScanRepo) Settings(context.Context) (map[string]bool, error) {
	return map[string]bool{"enrichment": r.enrichment}, nil
}
func (r *missingScanRepo) TrackByPath(_ context.Context, p string) (domain.Track, error) {
	if r.lookupError != nil {
		return domain.Track{}, r.lookupError
	}
	track, ok := r.tracks[p]
	if !ok {
		return track, domain.ErrNotFound
	}
	return track, nil
}
func (r *missingScanRepo) FileStamp(_ context.Context, p string) (int64, int64, error) {
	track, ok := r.tracks[p]
	if !ok {
		return 0, 0, domain.ErrNotFound
	}
	return track.Size, track.Modified, nil
}
func (r *missingScanRepo) MarkSeen(_ context.Context, p, scan string) error {
	r.seen[p] = true
	return nil
}
func (r *missingScanRepo) UpsertTrack(_ context.Context, t domain.Track, scan string) (string, error) {
	r.indexed = append(r.indexed, t.Path)
	return t.Path, nil
}
func (r *missingScanRepo) FinishRoot(context.Context, string, string) error {
	r.cleaned = true
	return nil
}
func (r *missingScanRepo) ScanFinish(_ context.Context, v domain.Scan) error {
	r.finished = v
	return nil
}
func (r *missingScanRepo) AddSuggestion(context.Context, domain.Suggestion) error { return nil }

func TestMissingMetadata(t *testing.T) {
	art := filepath.Join(t.TempDir(), "art.jpg")
	if err := os.WriteFile(art, []byte("art"), 0600); err != nil {
		t.Fatal(err)
	}
	complete := domain.Track{Title: "Song", Artist: "Artist", Album: "Album", AlbumArtist: "Artist", ArtPath: art}
	if MissingMetadata(complete) {
		t.Fatal("optional year/genre/numbers must not make a track incomplete")
	}
	single := complete
	single.Album, single.AlbumArtist = "", ""
	if MissingMetadata(single) {
		t.Fatal("singles do not require album metadata")
	}
	for _, field := range []string{"title", "artist", "albumArtist", "artwork", "unknown", "deleted", "directory"} {
		t.Run(field, func(t *testing.T) {
			track := complete
			switch field {
			case "title":
				track.Title = "  "
			case "artist":
				track.Artist = ""
			case "album":
				track.Album = ""
			case "albumArtist":
				track.AlbumArtist = ""
			case "artwork":
				track.ArtPath = ""
			case "unknown":
				track.Artist = "Unknown artist"
			case "deleted":
				track.ArtPath = art + "-missing"
			case "directory":
				track.ArtPath = filepath.Dir(art)
			}
			if !MissingMetadata(track) {
				t.Fatal("missing metadata not recognized")
			}
		})
	}
}

func TestMissingOnlyScan(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " missing")
		}
	}
	root := t.TempDir()
	art := filepath.Join(t.TempDir(), "art.jpg")
	os.WriteFile(art, []byte("art"), 0600)
	tracks := map[string]domain.Track{}
	for _, name := range []string{"complete", "missing", "new"} {
		p := filepath.Join(root, name+".wav")
		if b, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.1", "-y", p).CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", err, b)
		}
		info, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		track := domain.Track{Title: "Song", Artist: "Artist", Album: "Album", AlbumArtist: "Artist", ArtPath: art, Size: info.Size(), Modified: info.ModTime().UnixNano()}
		if name == "missing" {
			track.ArtPath = ""
		}
		if name != "new" {
			tracks[filepath.ToSlash(p)] = track
		}
	}
	for _, full := range []bool{false, true} {
		repo := &missingScanRepo{tracks: tracks, seen: map[string]bool{}}
		scanner := Scanner{Repo: repo, Roots: []string{root}, ArtDir: t.TempDir()}
		scanner.run(context.Background(), domain.Scan{ID: "test"}, ScanOptions{Full: full, MissingOnly: true})
		if len(repo.indexed) != 2 || !repo.seen[filepath.ToSlash(filepath.Join(root, "complete.wav"))] {
			t.Fatalf("selection or seen tracking: %+v %+v", repo.indexed, repo.seen)
		}
		for _, p := range repo.indexed {
			if filepath.Base(p) == "complete.wav" {
				t.Fatal("complete file was re-probed")
			}
		}
		if repo.finished.Status != "complete" || !repo.cleaned {
			t.Fatalf("scan failed: %+v", repo.finished)
		}
	}
	scoped := &missingScanRepo{tracks: tracks, seen: map[string]bool{}}
	artistScanner := Scanner{Repo: scoped, Roots: []string{root}, ArtDir: t.TempDir()}
	artistScanner.run(context.Background(), domain.Scan{ID: "artist"}, ScanOptions{Full: true, Artist: "Artist"})
	if len(scoped.indexed) != 2 {
		t.Fatalf("accepted artist selection must survive probe fallback: %+v", scoped.indexed)
	}
	enriched := &missingScanRepo{tracks: tracks, seen: map[string]bool{}, enrichment: true}
	lookupCount := 0
	enricher := &Enricher{UserAgent: "Cadence test/contact", Repo: enriched, Client: &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		lookupCount++
		if !strings.Contains(req.URL.Query().Get("query"), "artist:\"Artist\"") {
			t.Fatalf("accepted artist not used for enrichment: %s", req.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"releases":[]}`)), Header: make(http.Header)}, nil
	})}}
	enrichedScanner := Scanner{Repo: enriched, Roots: []string{root}, ArtDir: t.TempDir(), Enricher: enricher}
	enrichedScanner.run(context.Background(), domain.Scan{ID: "artist-enriched"}, ScanOptions{Full: true, Artist: "Artist"})
	if lookupCount == 0 {
		t.Fatal("artist-scoped enrichment skipped accepted artist")
	}
	otherTracks := map[string]domain.Track{}
	for path, track := range tracks {
		otherTracks[path] = track
	}
	otherPath := filepath.ToSlash(filepath.Join(root, "complete.wav"))
	other := otherTracks[otherPath]
	other.Artist = "Other artist"
	otherTracks[otherPath] = other
	otherRepo := &missingScanRepo{tracks: otherTracks, seen: map[string]bool{}}
	otherScanner := Scanner{Repo: otherRepo, Roots: []string{root}, ArtDir: t.TempDir()}
	otherScanner.run(context.Background(), domain.Scan{ID: "artist-selection"}, ScanOptions{Full: true, Artist: "Artist"})
	if len(otherRepo.indexed) != 1 || !otherRepo.seen[otherPath] {
		t.Fatalf("unrelated artist was rescanned or not kept seen: %+v", otherRepo.indexed)
	}
	repo := &missingScanRepo{tracks: tracks, seen: map[string]bool{}, lookupError: errors.New("database unavailable")}
	scanner := Scanner{Repo: repo, Roots: []string{root}, ArtDir: t.TempDir()}
	scanner.run(context.Background(), domain.Scan{ID: "error"}, ScanOptions{MissingOnly: true})
	if repo.cleaned || len(repo.indexed) != 0 || repo.finished.Status != "complete_with_errors" {
		t.Fatal("lookup failures must not hide or re-probe tracks")
	}
}

func TestArtistMatches(t *testing.T) {
	if !ArtistMatches("First Artist, Second Artist", "Second Artist") || ArtistMatches("Artist Other", "Artist") || ArtistMatches("First Artist", "Second Artist") {
		t.Fatal("artist filter must match whole individual credits")
	}
}
