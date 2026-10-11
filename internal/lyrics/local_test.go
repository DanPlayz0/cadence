// SPDX-License-Identifier: GPL-2.0-or-later
package lyrics

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cadence/internal/domain"
)

func TestLocalLyrics(t *testing.T) {
	for _, test := range []struct {
		name, extension, body, plain string
		synced, found                bool
	}{
		{"synced BOM CRLF", ".lrc", "\ufeff[ar:Artist]\r\n[offset:500]\r\n[00:01.20][00:05]Hello <00:02.00>world\r\n[00:03]\r\n[00:07]Again", "Hello world\n\nAgain", true, true},
		{"uppercase extension", ".LRC", "[00:01]Hello", "Hello", true, true},
		{"mixed extension", ".LrC", "[00:01]Hello", "Hello", true, true},
		{"plain", ".lrc", "[ti:Song]\nHello [everyone]\nWorld", "Hello [everyone]\nWorld", false, true},
		{"empty", ".lrc", " \n", "", false, false},
		{"metadata only", ".lrc", "[ar:Artist]\n[ti:Song]\n[offset:500]", "", false, false},
		{"timings only", ".lrc", "[00:01]\n[00:02]", "", false, false},
		{"invalid UTF8", ".lrc", "[00:01]\xff", "", false, false},
		{"oversized", ".lrc", strings.Repeat("x", (256<<10)+1), "", false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			audio := filepath.Join(root, "Song.live.mp3")
			writeLocalFile(t, audio, "audio")
			writeLocalFile(t, filepath.Join(root, "Song.live"+test.extension), test.body)
			result := Local([]string{root}, domain.Track{Path: audio})
			if result.Found != test.found || result.Plain != test.plain || (result.Synced != "") != test.synced {
				t.Fatalf("unexpected result: %+v", result)
			}
			if result.Found && result.Source != "Local LRC" {
				t.Fatalf("unexpected source: %q", result.Source)
			}
		})
	}
}

func TestLocalLyricsReadChangesAndValidatePaths(t *testing.T) {
	root := t.TempDir()
	audio := filepath.Join(root, "Song.mp3")
	sidecar := filepath.Join(root, "Song.lrc")
	writeLocalFile(t, audio, "audio")
	track := domain.Track{Path: audio}
	if Local([]string{root}, track).Found {
		t.Fatal("missing sidecar found")
	}
	writeLocalFile(t, filepath.Join(root, "Other.lrc"), "Wrong song")
	if Local([]string{root}, track).Found {
		t.Fatal("different basename matched")
	}
	for _, text := range []string{"First", "Updated"} {
		writeLocalFile(t, sidecar, "[00:01]"+text)
		if result := Local([]string{root}, track); result.Plain != text {
			t.Fatalf("sidecar change ignored: %+v", result)
		}
	}
	if Local([]string{t.TempDir()}, track).Found {
		t.Fatal("audio outside configured roots accepted")
	}
	if err := os.Remove(sidecar); err != nil {
		t.Fatal(err)
	}
	if Local([]string{root}, track).Found {
		t.Fatal("deleted sidecar cached")
	}
	if err := os.Mkdir(sidecar, 0700); err != nil {
		t.Fatal(err)
	}
	if Local([]string{root}, track).Found {
		t.Fatal("directory sidecar accepted")
	}
}

func TestLocalLyricsRejectEscapingSymlink(t *testing.T) {
	root := t.TempDir()
	audio := filepath.Join(root, "Song.mp3")
	writeLocalFile(t, audio, "audio")
	outside := filepath.Join(t.TempDir(), "private.lrc")
	writeLocalFile(t, outside, "Private text")
	if err := os.Symlink(outside, filepath.Join(root, "Song.lrc")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if Local([]string{root, filepath.Dir(outside)}, domain.Track{Path: audio}).Found {
		t.Fatal("sidecar escaped the song directory")
	}
}

func writeLocalFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
