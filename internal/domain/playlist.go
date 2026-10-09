// SPDX-License-Identifier: GPL-2.0-or-later
package domain

func ValidPlaylistIcon(icon string) bool {
	switch icon {
	case "", "music", "heart", "headphones", "disc", "sparkles", "moon":
		return true
	default:
		return false
	}
}
