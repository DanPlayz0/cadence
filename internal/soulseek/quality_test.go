// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDownloadEligibility(t *testing.T) {
	p := domain.DefaultSoulseekSettings().DownloadPolicy()
	for _, tc := range []struct {
		name        string
		rate, depth int
		want        bool
	}{
		{"song.FLAC", 44100, 16, true}, {"song.flac", 0, 0, false},
		{"song.wav", 44100, 0, false}, {"song.m4a", 0, 16, false},
		{"song.m4a", 44100, 24, true}, {"cover.jpg", 44100, 16, false},
	} {
		f := domain.SoulseekFile{Filename: tc.name, SampleRate: tc.rate, BitDepth: tc.depth}
		if got := EligibleFile(f, p); got != tc.want {
			t.Errorf("%+v: got %v", tc, got)
		}
	}
	p.AllowedFormats = []string{"flac"}
	if EligibleFile(domain.SoulseekFile{Filename: "song.wav", SampleRate: 44100, BitDepth: 16}, p) {
		t.Fatal("format restriction ignored")
	}
	p.LosslessOnly = false
	if !EligibleFile(domain.SoulseekFile{Filename: "song.flac"}, p) {
		t.Fatal("disabled lossless filter still requires metadata")
	}
	if !EligibleFile(files()[0], nil) {
		t.Fatal("legacy selection rejected")
	}
}

func TestDownloadSettingsDefaultsAndValidation(t *testing.T) {
	v := domain.DefaultSoulseekSettings()
	if e := json.Unmarshal([]byte(`{"enabled":true}`), &v); e != nil {
		t.Fatal(e)
	}
	if !v.LosslessOnly || !reflect.DeepEqual(v.AllowedFormats, domain.SoulseekAudioFormats()) {
		t.Fatal("missing-field defaults lost")
	}
	s, m, _, _, _ := setup(t)
	v = m.settings
	v.LosslessOnly = true
	v.AllowedFormats = []string{"flac", "m4a"}
	if e := s.SaveSettings(context.Background(), v); e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(m.settings)
	restored := domain.DefaultSoulseekSettings()
	if e := json.Unmarshal(b, &restored); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(restored.DownloadPolicy(), v.DownloadPolicy()) {
		t.Fatal("policy did not persist")
	}
	for _, formats := range [][]string{nil, {}, {"flac", "flac"}, {"exe"}, {"FLAC"}} {
		v.AllowedFormats = formats
		if e := s.ValidateSettings(context.Background(), v); e == nil {
			t.Fatalf("accepted %v", formats)
		}
	}
	var legacy domain.SoulseekRequest
	json.Unmarshal([]byte(`{"id":"legacy"}`), &legacy)
	if legacy.DownloadPolicy != nil {
		t.Fatal("legacy policy changed")
	}
}

func TestDownloadPolicySnapshotAndAlbums(t *testing.T) {
	ctx := context.Background()
	s, m, remote, u, rule := setup(t)
	m.settings.LosslessOnly = true
	m.settings.AllowedFormats = []string{"flac"}
	good := domain.SoulseekFile{Filename: `Music\Album\song.flac`, Size: 5, SampleRate: 44100, BitDepth: 16}
	mixed := []domain.SoulseekFile{good, files()[0]}
	if _, e := s.Create(ctx, u, ID(), "peer", "Music/Album", mixed); e == nil {
		t.Fatal("explicit lossy selection accepted")
	}
	if _, e := s.CreateSelection(ctx, u, ID(), "peer", "Music/Album", nil, true); e == nil || !strings.Contains(e.Error(), "No audio files") {
		t.Fatal("empty folder accepted", e)
	}
	if _, e := s.CreateSelection(ctx, u, ID(), "peer", "Music/Album", files(), true); e == nil || !strings.Contains(e.Error(), "No audio files") {
		t.Fatal("empty eligible album accepted", e)
	}
	r, e := s.CreateSelection(ctx, u, ID(), "peer", "Music/Album", mixed, true)
	if e != nil || len(r.Files) != 1 {
		t.Fatal("album filtering", r, e)
	}
	m.settings.LosslessOnly = false
	m.settings.AllowedFormats[0] = "mp3"
	if !r.DownloadPolicy.LosslessOnly || r.DownloadPolicy.AllowedFormats[0] != "flac" {
		t.Fatal("snapshot aliases settings")
	}
	b, _ := json.Marshal(domain.SoulseekStoredRequest{SoulseekRequest: r})
	var stored domain.SoulseekStoredRequest
	if e = json.Unmarshal(b, &stored); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(stored.DownloadPolicy, r.DownloadPolicy) {
		t.Fatal("restart lost snapshot")
	}
	approved, e := s.Action(ctx, domain.User{Admin: true}, r.ID, "approve", rule)
	if e != nil || !reflect.DeepEqual(approved.DownloadPolicy, r.DownloadPolicy) {
		t.Fatal("approval changed policy", e)
	}
	r = approved
	r.State = "failed"
	if e = m.SaveSoulseekRequest(ctx, &r); e != nil {
		t.Fatal(e)
	}
	retried, e := s.Action(ctx, u, r.ID, "retry", domain.SoulseekRule{})
	if e != nil || !reflect.DeepEqual(retried.DownloadPolicy, r.DownloadPolicy) {
		t.Fatal("retry changed policy", e)
	}
	if e = s.Tick(ctx); e != nil || remote.enqueues != 1 {
		t.Fatal("settings change blocked original policy", e)
	}
}

func TestLosslessImportCodecs(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, e := exec.LookPath(tool); e != nil {
			t.Skip(tool + " unavailable")
		}
	}
	for _, tc := range []struct {
		name, codec, ext string
		want             bool
	}{
		{"flac", "flac", "flac", true}, {"alac", "alac", "m4a", true},
		{"pcm", "pcm_s16le", "wav", true}, {"aac", "aac", "m4a", false},
		{"mp3", "libmp3lame", "mp3", false}, {"mislabeled", "libmp3lame", "mp3", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _, _, rule := setup(t)
			s.ValidateAudio = nil
			id, batch := ID(), ID()
			dir := filepath.Join(s.Stage, batch)
			if e := os.MkdirAll(dir, 0750); e != nil {
				t.Fatal(e)
			}
			p := filepath.Join(dir, "song."+tc.ext)
			cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=0.2", "-c:a", tc.codec, "-y", p)
			if b, e := cmd.CombinedOutput(); e != nil {
				t.Fatalf("fixture: %v %s", e, b)
			}
			if tc.name == "mislabeled" {
				renamed := filepath.Join(dir, "song.flac")
				if e := os.Rename(p, renamed); e != nil {
					t.Fatal(e)
				}
				p = renamed
			}
			info, e := os.Stat(p)
			if e != nil {
				t.Fatal(e)
			}
			f := domain.SoulseekRequestFile{SoulseekFile: domain.SoulseekFile{Filename: `Music\Album\` + filepath.Base(p), Size: info.Size(), SampleRate: 44100, BitDepth: 16}}
			_, _, e = s.importFile(context.Background(), id, batch, rule.Folder, f, domain.DefaultSoulseekSettings().DownloadPolicy())
			if (e == nil) != tc.want {
				t.Fatalf("acceptance: %v", e)
			}
			if !tc.want {
				if !strings.Contains(e.Error(), "not lossless") {
					t.Fatal(e)
				}
				if _, e := os.Stat(filepath.Join(rule.Folder, "Soulseek-"+id, filepath.Base(p))); !os.IsNotExist(e) {
					t.Fatal("lossy file published")
				}
				if _, _, e := s.importFile(context.Background(), id, batch, rule.Folder, f); e != nil {
					t.Fatal("legacy import rejected", e)
				}
			}
		})
	}
}
