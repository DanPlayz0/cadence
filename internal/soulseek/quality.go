// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"cadence/internal/domain"
	"errors"
	"path"
	"slices"
	"strings"
)

func ValidateDownloadPolicy(p *domain.SoulseekDownloadPolicy) error {
	if p == nil {
		return nil
	}
	if len(p.AllowedFormats) == 0 {
		return errors.New("Choose at least one allowed audio format")
	}
	seen := map[string]bool{}
	for _, format := range p.AllowedFormats {
		if !slices.Contains(domain.SoulseekAudioFormats(), format) || seen[format] {
			return errors.New("Invalid or duplicate allowed audio format")
		}
		seen[format] = true
	}
	return nil
}

// Matches slskd 0.26.0 src/web/src/lib/searches.js islossless filter.
// Extensions alone do not prove the peer advertised lossless audio.
func EligibleFile(f domain.SoulseekFile, p *domain.SoulseekDownloadPolicy) bool {
	if !Audio(f.Filename) {
		return false
	}
	if p == nil {
		return true
	} // Legacy requests retain their original policy.
	format := strings.TrimPrefix(strings.ToLower(path.Ext(f.Filename)), ".")
	return slices.Contains(p.AllowedFormats, format) && (!p.LosslessOnly || (f.SampleRate != 0 && f.BitDepth != 0))
}

func FilterFiles(files []domain.SoulseekFile, p *domain.SoulseekDownloadPolicy) []domain.SoulseekFile {
	out := []domain.SoulseekFile{}
	for _, f := range files {
		if EligibleFile(f, p) {
			out = append(out, f)
		}
	}
	return out
}
