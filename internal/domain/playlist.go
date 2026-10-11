// SPDX-License-Identifier: GPL-2.0-or-later
package domain

func ValidPlaylistIcon(icon string) bool {
	return icon == "" || playlistIconNames[icon]
}
