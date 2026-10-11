// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import "context"

// Apply only to unchanged source credits without an existing catalog override.
// The guard and accepted provenance record commit together, preserving manual edits.
func (s *Store) ApplyConfirmedArtistSplit(ctx context.Context, id, expected, value, source string) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE tracks SET overrides=jsonb_set(overrides,'{artist}',to_jsonb($3::text))
 WHERE id=$1 AND artist=$2 AND available AND NOT (overrides ? 'artist')
 AND EXISTS(SELECT 1 FROM settings WHERE key='enrichment' AND enabled)`, id, expected, value)
	if err != nil || result.RowsAffected() == 0 {
		return false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO suggestions(id,track_id,field,value,source,status) VALUES($1,$2,'artist',$3,$4,'accepted')
 ON CONFLICT(track_id,field,value,source) DO UPDATE SET status='accepted'`, ID(), id, value, source); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
