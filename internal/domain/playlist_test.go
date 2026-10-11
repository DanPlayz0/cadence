// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import "testing"

func TestPlaylistIcons(t *testing.T) {
	for _, icon := range []string{"", "music", "heart", "headphones", "disc", "sparkles", "moon", "coffee", "tree-pine", "guitar", "a-arrow-down", "arrow-down-0-1"} {
		if !ValidPlaylistIcon(icon) {
			t.Errorf("rejected supported icon %q", icon)
		}
	}
	for _, icon := range []string{"Moon", " moon ", "unknown", "<svg>", "tree_pine", "constructor"} {
		if ValidPlaylistIcon(icon) {
			t.Errorf("accepted invalid icon %q", icon)
		}
	}
}

func TestFullPlaylistIconCatalog(t *testing.T) {
	if len(playlistIconNames) != 1544 {
		t.Fatalf("unexpected catalog size: %d", len(playlistIconNames))
	}
	for name := range playlistIconNames {
		if !ValidPlaylistIcon(name) {
			t.Errorf("catalog icon rejected: %s", name)
		}
	}
}
