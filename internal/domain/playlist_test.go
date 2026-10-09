// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import "testing"

func TestPlaylistIcons(t *testing.T) {
	for _, icon := range []string{"", "music", "heart", "headphones", "disc", "sparkles", "moon"} {
		if !ValidPlaylistIcon(icon) {
			t.Errorf("rejected supported icon %q", icon)
		}
	}
	for _, icon := range []string{"Moon", " moon ", "unknown", "<svg>"} {
		if ValidPlaylistIcon(icon) {
			t.Errorf("accepted invalid icon %q", icon)
		}
	}
}
