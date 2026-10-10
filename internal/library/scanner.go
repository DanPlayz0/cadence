// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cadence/internal/domain"
)

type Scanner struct {
	Repo             domain.Repository
	Roots            []string
	ExcludedRoots    []string
	ArtDir           string
	Enricher         *Enricher
	busy             atomic.Bool
	ManagedLibraries bool
	scanMu           sync.Mutex
	pending          bool
	Context          context.Context
}

var extensions = map[string]string{".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav"}

func Hash(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func Canonical(path string) (string, error) {
	p, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	p, err = resolveCanonicalPath(p)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Clean(p)), nil
}
func Within(root, path string) bool {
	rel, err := filepath.Rel(filepath.FromSlash(root), filepath.FromSlash(path))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
func ResolveFile(roots []string, path string) (string, error) {
	p, err := Canonical(path)
	if err != nil {
		return "", err
	}
	for _, r := range roots {
		root, e := Canonical(r)
		if e == nil && Within(root, p) {
			f, e := os.Stat(p)
			if e == nil && f.Mode().IsRegular() {
				return p, nil
			}
		}
	}
	return "", errors.New("file outside library or unavailable")
}

type ScanOptions struct {
	Full        bool
	MissingOnly bool
	Artist      string
}

func MissingMetadata(t domain.Track) bool {
	t.NormalizeAlbum()
	values := []string{t.Title, t.Artist}
	if !t.Single {
		values = append(values, t.AlbumArtist)
	}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || strings.EqualFold(value, "Unknown artist") || strings.EqualFold(value, "Unknown album") {
			return true
		}
	}
	if t.ArtPath == "" {
		return true
	}
	info, err := os.Stat(t.ArtPath)
	return err != nil || !info.Mode().IsRegular()
}

func (s *Scanner) Start(full bool) (string, bool) {
	return s.StartWithOptions(ScanOptions{Full: full})
}

func (s *Scanner) StartWithOptions(options ScanOptions) (string, bool) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	return s.startLocked(options)
}

func (s *Scanner) startLocked(options ScanOptions) (string, bool) {
	if !s.busy.CompareAndSwap(false, true) {
		return "", false
	}
	id := Hash(time.Now().String())[:32]
	ctx := s.Context
	if ctx == nil {
		ctx = context.Background()
	}
	v := domain.Scan{ID: id, Started: time.Now().UTC(), Status: "running", Errors: []string{}}
	if err := s.Repo.ScanStart(ctx, v); err != nil {
		s.busy.Store(false)
		slog.Error("start scan", "error", err)
		return "", false
	}
	go s.run(ctx, v, options)
	return id, true
}

// RequestScan coalesces configuration changes into one incremental follow-up scan.
func (s *Scanner) RequestScan() {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	if s.busy.Load() {
		s.pending = true
		return
	}
	s.startLocked(ScanOptions{})
}
func (s *Scanner) run(ctx context.Context, v domain.Scan, options ScanOptions) {
	defer func() {
		s.scanMu.Lock()
		defer s.scanMu.Unlock()
		s.busy.Store(false)
		if s.pending && ctx.Err() == nil {
			s.pending = false
			s.startLocked(ScanOptions{})
		}
	}()
	settings, err := s.Repo.Settings(ctx)
	if err != nil {
		v.Errors = append(v.Errors, "Unable to read enrichment settings")
	}
	addErr := func(msg string) {
		if len(v.Errors) < 200 {
			v.Errors = append(v.Errors, msg)
		}
	}
	folders := s.Roots
	if s.ManagedLibraries {
		repo, ok := s.Repo.(domain.NamedLibraryRepository)
		if !ok {
			addErr("Library configuration unavailable")
			folders = nil
		} else {
			libraries, e := repo.MusicLibraries(ctx)
			if e != nil {
				addErr("Unable to load libraries")
				folders = nil
			} else {
				folders = []string{}
				for _, l := range libraries {
					for _, folder := range l.Folders {
						p, e := ResolveDirectory(s.Roots, folder)
						if e != nil || p != folder {
							addErr(folder + ": mount unavailable or outside music roots")
							continue
						}
						folders = append(folders, p)
					}
				}
				folders = MinimalFolders(folders)
			}
		}
	}
	for _, configured := range folders {
		root, err := Canonical(configured)
		if s.ManagedLibraries {
			root, err = ResolveDirectory(s.Roots, configured)
			if err == nil && root != configured {
				err = fmt.Errorf("music directory path changed")
			}
		}
		if err != nil {
			addErr(configured + ": mount unavailable")
			continue
		}
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			addErr(configured + ": not a directory")
			continue
		}
		complete := true
		err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if walkErr != nil {
				complete = false
				addErr(path + ": " + walkErr.Error())
				return nil
			}
			for _, excluded := range s.ExcludedRoots {
				if Within(excluded, filepath.ToSlash(path)) {
					if d.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
			}
			if d.IsDir() {
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				return nil
			}
			mime, ok := extensions[strings.ToLower(filepath.Ext(path))]
			if !ok {
				return nil
			}
			path = filepath.ToSlash(path)
			if s.ManagedLibraries {
				resolved, e := ResolveFile(s.Roots, path)
				if e != nil || resolved != path {
					complete = false
					addErr(path + ": file unavailable or path changed")
					return nil
				}
			}
			info, err := d.Info()
			if err != nil {
				complete = false
				addErr(path + ": stat failed")
				return nil
			}
			matchedArtist := false
			if options.MissingOnly || options.Artist != "" {
				track, lookupErr := s.Repo.TrackByPath(ctx, path)
				if lookupErr != nil && !errors.Is(lookupErr, domain.ErrNotFound) {
					complete = false
					addErr("Database: " + lookupErr.Error())
					return nil
				}
				matchedArtist = lookupErr == nil && ArtistMatches(track.Artist, options.Artist)
				// New files are incomplete; existing complete files still need to be marked seen.
				if lookupErr == nil && ((options.Artist != "" && !ArtistMatches(track.Artist, options.Artist)) || (options.MissingOnly && !MissingMetadata(track))) {
					if err = s.Repo.MarkSeen(ctx, path, v.ID); err != nil {
						complete = false
						addErr("Database: " + err.Error())
					}
					return nil
				}
			}
			size, mod, err := s.Repo.FileStamp(ctx, path)
			if !options.Full && !options.MissingOnly && err == nil && size == info.Size() && mod == info.ModTime().UnixNano() {
				if err = s.Repo.MarkSeen(ctx, path, v.ID); err != nil {
					complete = false
					addErr("Database: " + err.Error())
				}
				return nil
			}
			if err != nil && !errors.Is(err, domain.ErrNotFound) {
				complete = false
				addErr("Database: " + err.Error())
				return nil
			}
			// Mark existing entries seen before probing; a corrupt changed file must not erase the catalog.
			if err = s.Repo.MarkSeen(ctx, path, v.ID); err != nil {
				complete = false
				addErr("Database: " + err.Error())
				return nil
			}
			t, tags, err := Probe(ctx, path, mime)
			if err != nil {
				addErr(path + ": " + err.Error())
				return nil
			}
			if options.Artist != "" && !matchedArtist && !ArtistMatches(t.Artist, options.Artist) {
				return nil
			}
			t.Root = root
			if s.ManagedLibraries {
				for _, boundary := range s.Roots {
					p, e := Canonical(boundary)
					if e == nil && Within(p, path) {
						t.Root = p
						break
					}
				}
			}
			t.Size = info.Size()
			t.Modified = info.ModTime().UnixNano()
			t.ArtPath = s.art(ctx, path, tags, info.ModTime().UnixNano())
			id, err := s.Repo.UpsertTrack(ctx, t, v.ID)
			if err != nil {
				complete = false
				addErr("Database: " + err.Error())
				return nil
			}
			t.ID = id
			v.Indexed++
			for field, value := range map[string]string{"title": t.Title, "artist": t.Artist, "album": t.Album, "albumArtist": t.AlbumArtist} {
				trim := strings.TrimSpace(value)
				if trim != "" && trim != value {
					if err = s.Repo.AddSuggestion(ctx, domain.Suggestion{TrackID: id, Field: field, Value: trim, Source: "scan: whitespace cleanup"}); err != nil {
						addErr("Suggestion: " + err.Error())
					}
				}
			}
			if settings["enrichment"] && s.Enricher != nil {
				enrichmentTrack := t
				if options.Artist != "" {
					enrichmentTrack, err = s.Repo.TrackByPath(ctx, path)
					if err != nil {
						addErr("Metadata catalog: " + err.Error())
						return nil
					}
				}
				if err = s.Enricher.Suggest(ctx, enrichmentTrack, tags); err != nil {
					addErr("Metadata " + t.Title + ": " + err.Error())
				}
			}
			return nil
		})
		if err != nil {
			complete = false
			addErr(err.Error())
		}
		if complete {
			if s.ManagedLibraries {
				err = s.Repo.(domain.NamedLibraryRepository).FinishFolder(ctx, root, v.ID)
			} else {
				err = s.Repo.FinishRoot(ctx, root, v.ID)
			}
			if err != nil {
				addErr("Database: " + err.Error())
			}
		}
	}
	now := time.Now().UTC()
	v.Finished = &now
	v.Status = "complete"
	if len(v.Errors) > 0 {
		v.Status = "complete_with_errors"
	}
	if ctx.Err() != nil {
		v.Status = "interrupted"
	}
	finishCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = s.Repo.ScanFinish(finishCtx, v); err != nil {
		slog.Error("finish scan", "error", err)
	}
	slog.Info("scan finished", "indexed", v.Indexed, "errors", len(v.Errors))
}

type probeResult struct {
	Streams []struct {
		Codec string            `json:"codec_name"`
		Type  string            `json:"codec_type"`
		Tags  map[string]string `json:"tags"`
	} `json:"streams"`
	Format struct {
		Duration string            `json:"duration"`
		Tags     map[string]string `json:"tags"`
	} `json:"format"`
}

func Probe(ctx context.Context, path, mime string) (domain.Track, map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	b, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path).Output()
	if err != nil {
		return domain.Track{}, nil, fmt.Errorf("ffprobe failed: %w", err)
	}
	var p probeResult
	if err = json.Unmarshal(b, &p); err != nil {
		return domain.Track{}, nil, err
	}
	tags := map[string]string{}
	for k, v := range p.Format.Tags {
		tags[strings.ToLower(k)] = v
	}
	codec := ""
	for _, stream := range p.Streams {
		if stream.Type == "audio" {
			codec = stream.Codec
			// Vorbis/Opus commonly store tags on the audio stream rather than format.
			for k, v := range stream.Tags {
				key := strings.ToLower(k)
				if tags[key] == "" {
					tags[key] = v
				}
			}
			break
		}
	}
	if codec == "" {
		return domain.Track{}, tags, errors.New("no audio stream")
	}
	t := domain.Track{Path: path, MIME: mime, Codec: codec, Title: tags["title"], Artist: tags["artist"], Album: tags["album"], AlbumArtist: tags["album_artist"], Year: tags["date"], Genre: tags["genre"]}
	filenameTitle, filenameArtist, filenameAlbum := FilenameMetadata(path)
	if t.Title == "" {
		t.Title = filenameTitle
	}
	if t.Artist == "" {
		t.Artist = filenameArtist
		if t.Artist == "" {
			t.Artist = "Unknown artist"
		}
	}
	if t.Album == "" {
		t.Album = filenameAlbum
	}
	if t.AlbumArtist == "" {
		t.AlbumArtist = tags["albumartist"]
	}
	if t.AlbumArtist == "" {
		t.AlbumArtist = t.Artist
	}
	if t.Year == "" {
		t.Year = tags["year"]
	}
	if tags["track"] == "" {
		tags["track"] = tags["tracknumber"]
	}
	if tags["disc"] == "" {
		tags["disc"] = tags["discnumber"]
	}
	t.Number, _ = strconv.Atoi(strings.Split(tags["track"], "/")[0])
	t.Disc, _ = strconv.Atoi(strings.Split(tags["disc"], "/")[0])
	t.Duration, _ = strconv.ParseFloat(p.Format.Duration, 64)
	t.AlbumID = Hash(filepath.ToSlash(filepath.Dir(path)) + "\x00" + t.AlbumArtist + "\x00" + t.Album)[:32]
	t.NormalizeAlbum()
	return t, tags, nil
}
func (s *Scanner) art(ctx context.Context, path string, _ map[string]string, modified int64) string {
	if err := os.MkdirAll(s.ArtDir, 0750); err != nil {
		return ""
	}
	source := path
	for _, name := range []string{"cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg"} {
		candidate := filepath.Join(filepath.Dir(path), name)
		if info, err := os.Lstat(candidate); err == nil && info.Mode().IsRegular() {
			source = candidate
			modified = info.ModTime().UnixNano()
			break
		}
	}
	// All songs using the same folder cover share its thumbnail.
	key := Hash(source + strconv.FormatInt(modified, 10))
	dest := filepath.Join(s.ArtDir, key+".jpg")
	if _, err := os.Stat(dest); err == nil {
		return dest
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	tmp := dest + ".tmp.jpg"
	defer os.Remove(tmp)
	err := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-i", source, "-an", "-frames:v", "1", "-vf", "scale=600:600:force_original_aspect_ratio=decrease", "-y", tmp).Run()
	if err != nil {
		return ""
	}
	if err = os.Rename(tmp, dest); err != nil {
		return ""
	}
	return dest
}

func ArtistMatches(credit, artist string) bool {
	for _, name := range strings.Split(credit, ",") {
		if strings.TrimSpace(name) == artist {
			return true
		}
	}
	return false
}
