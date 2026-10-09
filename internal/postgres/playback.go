// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
)

func (s *Store) Playback(ctx context.Context, user string) (domain.Playback, error) {
	var v domain.Playback
	err := s.pool.QueryRow(ctx, `SELECT track_id,position,revision,writer,sequence FROM playback WHERE user_id=$1`, user).Scan(&v.TrackID, &v.Position, &v.Revision, &v.Writer, &v.Sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, nil
	}
	return v, err
}

func (s *Store) SavePlayback(ctx context.Context, user string, v domain.Playback) (domain.Playback, error) {
	var saved domain.Playback
	// One atomic statement checks access and orders this writer's checkpoints even
	// when an unload request overtakes an earlier in-flight update. A different
	// device must have observed the current revision to take over progress saving.
	err := s.pool.QueryRow(ctx, `INSERT INTO playback(user_id,track_id,position,revision,writer,sequence)
 SELECT $1,t.id,CASE WHEN t.duration>0 THEN least($3,t.duration) ELSE $3 END,1,$5,$6 FROM tracks t WHERE t.id=$2 AND `+allowed+`
 ON CONFLICT(user_id) DO UPDATE SET track_id=EXCLUDED.track_id,position=EXCLUDED.position,
 revision=playback.revision+1,writer=EXCLUDED.writer,sequence=EXCLUDED.sequence
 WHERE (playback.writer=EXCLUDED.writer AND playback.sequence<EXCLUDED.sequence)
 OR (playback.writer<>EXCLUDED.writer AND playback.revision=$4)
 RETURNING track_id,position,revision,writer,sequence`, user, v.TrackID, v.Position, v.Revision, v.Writer, v.Sequence).Scan(&saved.TrackID, &saved.Position, &saved.Revision, &saved.Writer, &saved.Sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, accessErr := s.Track(ctx, user, v.TrackID); accessErr != nil {
			return saved, accessErr
		}
		return saved, domain.ErrConflict
	}
	return saved, mapped(err)
}
