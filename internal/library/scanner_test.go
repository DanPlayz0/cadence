// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPathBoundaries(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "song.mp3")
	os.WriteFile(file, []byte("x"), 0600)
	if _, e := ResolveFile([]string{root}, file); e != nil {
		t.Fatal(e)
	}
	outside := filepath.Join(t.TempDir(), "song.mp3")
	os.WriteFile(outside, []byte("x"), 0600)
	if _, e := ResolveFile([]string{root}, outside); e == nil {
		t.Fatal("outside file allowed")
	}
	if Within("/music/Artist", "/music/ArtistOther/song") {
		t.Fatal("prefix escaped root")
	}
	if Within(root, filepath.Join(root, "..", "escape.mp3")) {
		t.Fatal("parent traversal allowed")
	}
}
func TestProbeFallback(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("ffmpeg missing")
	}
	if _, e := exec.LookPath("ffprobe"); e != nil {
		t.Skip("ffprobe missing")
	}
	file := filepath.Join(t.TempDir(), "01-音.wav")
	if b, e := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.1", "-y", file).CombinedOutput(); e != nil {
		t.Fatalf("%v %s", e, b)
	}
	track, _, e := Probe(context.Background(), file, "audio/wav")
	if e != nil {
		t.Fatal(e)
	}
	if track.Title != "01-音" || track.Artist != "Unknown artist" || track.Duration <= 0 {
		t.Fatalf("fallback: %+v", track)
	}
	if !track.Single || track.Album != "" || track.AlbumID != "" || track.AlbumArtist != "" {
		t.Fatalf("untagged song must be a single: %+v", track)
	}
}

func TestVorbisStreamTags(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("ffmpeg missing")
	}
	if _, e := exec.LookPath("ffprobe"); e != nil {
		t.Skip("ffprobe missing")
	}
	file := filepath.Join(t.TempDir(), "Wrong Artist - Wrong Title (Official Video).ogg")
	if b, e := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.1", "-metadata", "title=Tagged title", "-metadata", "artist=Tagged artist", "-metadata", "album=Tagged album", "-y", file).CombinedOutput(); e != nil {
		t.Fatalf("%v %s", e, b)
	}
	track, _, e := Probe(context.Background(), file, "audio/ogg")
	if e != nil {
		t.Fatal(e)
	}
	if track.Title != "Tagged title" || track.Artist != "Tagged artist" || track.Album != "Tagged album" {
		t.Fatalf("stream tags not indexed: %+v", track)
	}
}

func TestFLACProbe(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " missing")
		}
	}
	for _, ext := range []string{".flac", ".FLAC"} {
		path := filepath.Join(t.TempDir(), "song"+ext)
		if b, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.2", "-c:a", "flac", "-metadata", "title=FLAC title", "-metadata", "artist=FLAC artist", "-metadata", "album=FLAC album", "-y", path).CombinedOutput(); err != nil {
			t.Fatalf("%v %s", err, b)
		}
		mime := extensions[filepath.Ext(strings.ToLower(path))]
		track, _, err := Probe(context.Background(), path, mime)
		if err != nil {
			t.Fatal(err)
		}
		if track.Codec != "flac" || track.MIME != "audio/flac" || track.Duration <= 0 || track.Title != "FLAC title" || track.Artist != "FLAC artist" || track.Album != "FLAC album" {
			t.Fatalf("FLAC metadata: %+v", track)
		}
	}
}
