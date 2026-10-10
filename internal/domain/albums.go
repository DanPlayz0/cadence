// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import "context"

// AlbumMover applies an album assignment as persistent metadata overrides.
type AlbumMover interface {
	MoveTrackAlbum(context.Context, string, string, string) error
}
