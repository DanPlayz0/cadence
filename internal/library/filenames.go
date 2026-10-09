// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"path/filepath"
	"regexp"
	"strings"
)

var youtubeSuffix = regexp.MustCompile(`\s*\[[A-Za-z0-9_-]{11}\]\s*$`)
var videoLabel = regexp.MustCompile(`(?i)\s*(?:\(|\[)(?:(?:(?:4k|hd)\s+)?official\s+(?:(?:hd|4k)\s+)?(?:(?:music|lyric)\s+)?(?:video|audio)|lyric\s+video|lyrics|4k\s+upgrade)(?:\)|\])`)
var movieName = regexp.MustCompile(`(?i)^(.*?)\s*\(from\s+["“]?(.+?)["”]?\)\s+(.+)$`)
var versionName = regexp.MustCompile(`(?i)^(?:the\s+)?(?:piano|acoustic|instrumental|live|slowed|sped up)\s+(?:version|mix)$`)

// FilenameMetadata is a conservative fallback for absent embedded tags.
// Video labels and IDs are removed; arbitrary parentheses and credits survive.
func FilenameMetadata(path string) (title, artist, album string) {
	stem := strings.TrimSpace(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	stem = youtubeSuffix.ReplaceAllString(stem, "")
	if match := movieName.FindStringSubmatch(stem); match != nil {
		return strings.TrimSpace(videoLabel.ReplaceAllString(match[1], "")), strings.TrimSpace(match[3]), strings.TrimSpace(match[2])
	}
	for _, separator := range []string{" - ", " – ", " — ", "： "} {
		left, right, found := strings.Cut(stem, separator)
		if !found || strings.TrimSpace(left) == "" || strings.TrimSpace(right) == "" {
			continue
		}
		if versionName.MatchString(strings.TrimSpace(right)) {
			break
		}
		// Title [Official Video] - Artist is common in official channel downloads.
		if videoLabel.MatchString(left) && !videoLabel.MatchString(right) {
			return strings.TrimSpace(videoLabel.ReplaceAllString(left, "")), strings.TrimSpace(right), ""
		}
		return strings.TrimSpace(videoLabel.ReplaceAllString(right, "")), strings.TrimSpace(left), ""
	}
	title = strings.TrimSpace(videoLabel.ReplaceAllString(stem, ""))
	if title == "" {
		title = strings.TrimSpace(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	}
	return title, "", ""
}
