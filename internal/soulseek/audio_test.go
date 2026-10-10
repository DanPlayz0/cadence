// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"cadence/internal/domain"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestActualAudioValidationAndImport(t *testing.T) {
	ffmpeg, e := exec.LookPath("ffmpeg")
	if e != nil {
		t.Skip("ffmpeg is unavailable")
	}
	if _, e = exec.LookPath("ffprobe"); e != nil {
		t.Skip("ffprobe is unavailable")
	}
	for _, ext := range []string{"mp3", "flac", "m4a"} {
		t.Run(ext, func(t *testing.T) {
			s, _, _, _, rule := setup(t)
			s.ValidateAudio = nil
			id, batch := ID(), ID()
			dir := filepath.Join(s.Stage, batch)
			os.MkdirAll(dir, 0750)
			name := "fixture." + ext
			p := filepath.Join(dir, name)
			cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-y", p)
			if b, e := cmd.CombinedOutput(); e != nil {
				t.Fatalf("fixture: %v %s", e, b)
			}
			info, e := os.Stat(p)
			if e != nil {
				t.Fatal(e)
			}
			out, digest, e := s.importFile(context.Background(), id, batch, rule.Folder, domain.SoulseekRequestFile{SoulseekFile: domain.SoulseekFile{Filename: `Artist\Album\` + name, Size: info.Size()}})
			if e != nil || digest == "" {
				t.Fatal(out, e)
			}
			if data, e := os.ReadFile(out); e != nil || len(data) != int(info.Size()) {
				t.Fatal("import size", e)
			}
		})
	}
}
