// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"cadence/internal/domain"
)

func TestFolderAlbumDetection(t *testing.T) {
	for _, tc := range []struct {
		name  string
		files map[string]string
		want  bool
	}{
		{"XML NFO", map[string]string{"album.nfo": `<album><title>Starboy</title><albumartist>The Weeknd</albumartist><year>2016</year><genre>R&amp;B</genre><artist>The Weeknd</artist><artist>Guest</artist></album>`, "cover.jpg": "cover", "proof.jpg": "proof"}, true},
		{"scene NFO", map[string]string{"release.NFO": "scene release notes"}, true},
		{"malformed NFO", map[string]string{"album.nfo": "<album><title>broken"}, true},
		{"cover and songs", map[string]string{"COVER.JPG": "cover", "01.flac": "audio", "02.FLAC": "audio"}, true},
		{"single cover", map[string]string{"cover.jpg": "cover", "song.flac": "audio"}, false},
		{"proof only", map[string]string{"proof.jpg": "proof", "01.flac": "audio", "02.flac": "audio"}, false},
		{"loose songs", map[string]string{"01.flac": "audio", "02.flac": "audio"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "The Weeknd", "Starboy (2016)")
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			for name, content := range tc.files {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			album := readFolderAlbum(dir)
			if (album.Title != "") != tc.want {
				t.Fatalf("detection: %+v", album)
			}
			if tc.want && (album.Title != "Starboy" || album.AlbumArtist != "The Weeknd" || album.Year != "2016") {
				t.Fatalf("metadata: %+v", album)
			}
			if readFolderAlbum(filepath.Dir(dir)).Title != "" {
				t.Fatal("album leaked to parent")
			}
		})
	}
}

func TestFolderAlbumFallbacks(t *testing.T) {
	album := folderAlbum{Title: "Starboy", AlbumArtist: "The Weeknd", Year: "2016", Genres: []string{"R&B"}}
	track := domain.Track{Path: "1-02 - Party Monster.flac"}
	album.apply(&track, map[string]string{})
	if track.Title != "Party Monster" || track.Artist != "The Weeknd" || track.AlbumArtist != "The Weeknd" || track.Album != "Starboy" || track.Number != 2 || track.Disc != 1 || track.Genre != "R&B" {
		t.Fatalf("fallback: %+v", track)
	}
	tagged := domain.Track{Path: "01 - Wrong.flac", Title: "Tagged", Artist: "Guest", Album: "Tagged album", AlbumArtist: "Tagged artist", Year: "2020", Genre: "Pop", Number: 5, Disc: 2}
	want := tagged
	album.apply(&tagged, map[string]string{"title": "Tagged", "artist": "Guest", "albumartist": "Tagged artist"})
	if tagged != want {
		t.Fatalf("embedded values replaced: %+v", tagged)
	}
}

func TestProbeFolderAlbum(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " missing")
		}
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "album.nfo"), []byte(`<album><title>Starboy</title><albumartist>The Weeknd</albumartist><year>2016</year></album>`), 0600); err != nil {
		t.Fatal(err)
	}
	var albumID string
	cover := filepath.Join(dir, "COVER.JPG")
	file, err := os.Create(cover)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(file, image.NewRGBA(image.Rect(0, 0, 20, 20)), nil); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "proof.jpg"), []byte("not album artwork"), 0600); err != nil {
		t.Fatal(err)
	}
	scanner := Scanner{ArtDir: t.TempDir()}
	var artwork string
	for _, name := range []string{"1-01 - Starboy.wav", "1-02 - Party Monster.wav"} {
		path := filepath.Join(dir, name)
		if b, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.1", "-y", path).CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", err, b)
		}
		track, _, err := Probe(context.Background(), path, "audio/wav")
		if err != nil {
			t.Fatal(err)
		}
		if track.Single || track.Album != "Starboy" || track.AlbumArtist != "The Weeknd" || track.AlbumID == "" || track.Number == 0 {
			t.Fatalf("album not indexed: %+v", track)
		}
		if albumID != "" && track.AlbumID != albumID {
			t.Fatal("songs split into different albums")
		}
		albumID = track.AlbumID
		art := scanner.art(context.Background(), path, nil, 0)
		if art == "" {
			t.Fatal("folder cover not extracted")
		}
		if artwork != "" && art != artwork {
			t.Fatal("folder cover not shared")
		}
		artwork = art
	}
}
