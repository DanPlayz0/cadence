// SPDX-License-Identifier: GPL-2.0-or-later
package lyrics

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"cadence/internal/domain"
	"cadence/internal/library"
)

var lrcTimestamp = regexp.MustCompile(`\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?\]`)
var lrcWordTimestamp = regexp.MustCompile(`<\d+:\d+(?:\.\d+)?>`)
var lrcMetadata = regexp.MustCompile(`(?i)^\[(?:ar|al|ti|au|by|offset|re|ve|length):[^\]]*\]$`)

// Local reads a same-stem LRC sidecar on demand, so edits need no library rescan.
// Unavailable, oversized, or invalid UTF-8 files fall back to the online provider.
func Local(roots []string, track domain.Track) Result {
	if track.Path == "" {
		return Result{}
	}
	audio, err := library.ResolveFile(roots, track.Path)
	if err != nil {
		return Result{}
	}
	dir := filepath.Dir(audio)
	stem := strings.TrimSuffix(filepath.Base(audio), filepath.Ext(audio))
	name := stem + ".lrc"
	if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
		// Preserve the song's basename while accepting .LRC and mixed-case extensions.
		entries, err := os.ReadDir(dir)
		if err != nil {
			return Result{}
		}
		for _, entry := range entries {
			ext := filepath.Ext(entry.Name())
			if strings.TrimSuffix(entry.Name(), ext) == stem && strings.EqualFold(ext, ".lrc") {
				name = entry.Name()
				break
			}
		}
	}
	path, err := library.ResolveFile(roots, filepath.Join(dir, name))
	if err != nil || !library.Within(dir, path) {
		return Result{}
	}
	// Anchor opening to the song directory to also reject escaping symlinks
	// if the sidecar changes between validation and opening.
	root, err := os.OpenRoot(dir)
	if err != nil {
		return Result{}
	}
	defer root.Close()
	file, err := root.Open(name)
	if err != nil {
		return Result{}
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 256<<10 {
		return Result{}
	}
	body, err := io.ReadAll(io.LimitReader(file, (256<<10)+1))
	if err != nil || len(body) > 256<<10 || !utf8.Valid(body) {
		return Result{}
	}
	text := strings.TrimSpace(strings.TrimPrefix(string(body), "\ufeff"))
	var plain []string
	for _, row := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		row = strings.TrimSpace(row)
		if lrcMetadata.MatchString(row) {
			continue
		}
		row = lrcTimestamp.ReplaceAllString(row, "")
		row = lrcWordTimestamp.ReplaceAllString(row, "")
		plain = append(plain, strings.TrimSpace(row))
	}
	result := Result{Plain: strings.TrimSpace(strings.Join(plain, "\n")), Source: "Local LRC"}
	if result.Plain == "" {
		return Result{}
	}
	result.Found = true
	if lrcTimestamp.MatchString(text) {
		result.Synced = text
	}
	return result
}
