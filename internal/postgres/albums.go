// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
)

// Group by effective metadata, independent of file location and extracted IDs.
const albumTitle = `btrim(coalesce(t.overrides->>'album',t.album))`
const albumArtist = `coalesce(nullif(btrim(coalesce(t.overrides->>'albumArtist',t.album_artist)),''),btrim(coalesce(t.overrides->>'artist',t.artist)))`
const albumIdentity = `CASE WHEN ` + albumTitle + `='' OR lower(` + albumTitle + `)='unknown album' THEN '' ELSE md5(jsonb_build_array(lower(` + albumTitle + `),lower(` + albumArtist + `))::text) END`

func (s *Store) MoveTrackAlbum(ctx context.Context, user, track, album string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var title, artist string
	// The destination must still exist and be visible to this administrator.
	err = tx.QueryRow(ctx, `SELECT `+albumTitle+`,`+albumArtist+` FROM tracks t WHERE `+allowed+` AND `+albumIdentity+`=$2 AND `+albumIdentity+`<>'' ORDER BY t.id LIMIT 1 FOR SHARE`, user, album).Scan(&title, &artist)
	if err != nil {
		return mapped(err)
	}
	tag, err := tx.Exec(ctx, `UPDATE tracks t SET overrides=t.overrides||jsonb_build_object('album',$3::text,'albumArtist',$4::text) WHERE t.id=$2 AND `+allowed, user, track, title, artist)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return tx.Commit(ctx)
}
