// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
)

var _ domain.SyncRepository = (*Store)(nil)

func (s *Store) SyncConnections(ctx context.Context, user string) ([]domain.SyncConnection, error) {
	rows, err := s.pool.Query(ctx, `SELECT c.provider,c.id,c.username,c.credential,c.plays,c.now_playing,c.likes,c.paused,c.error,c.last_success,
 (SELECT count(*) FROM sync_deliveries d WHERE d.connection_id=c.id AND d.status='pending'),
 (SELECT count(*) FROM sync_deliveries d WHERE d.connection_id=c.id AND d.status='pending' AND d.kind='like' AND c.provider='listenbrainz'
 AND NOT EXISTS(SELECT 1 FROM sync_recordings r WHERE r.connection_id=c.id AND r.track_id=d.payload->>'trackId' AND r.title=d.payload->>'title' AND r.artist=d.payload->>'artist'))
 FROM sync_connections c WHERE c.user_id=$1 ORDER BY c.provider`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.SyncConnection{}
	for rows.Next() {
		var c domain.SyncConnection
		if err = rows.Scan(&c.Provider, &c.ID, &c.Username, &c.Credential, &c.Plays, &c.NowPlaying, &c.Likes, &c.Paused, &c.Error, &c.LastSuccess, &c.Pending, &c.WaitingFeedback); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) SaveSyncConnection(ctx context.Context, user string, c domain.SyncConnection) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Reauthorizing the same account preserves its delivery ledger and preferences.
	var oldID, oldName string
	err = tx.QueryRow(ctx, `SELECT id,username FROM sync_connections WHERE user_id=$1 AND provider=$2 FOR UPDATE`, user, c.Provider).Scan(&oldID, &oldName)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if oldName == c.Username && oldID != "" {
		_, err = tx.Exec(ctx, `UPDATE sync_connections SET credential=$3,paused=false,error='' WHERE user_id=$1 AND provider=$2`, user, c.Provider, c.Credential)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE sync_deliveries SET next_attempt=now() WHERE connection_id=$1 AND status='pending'`, oldID)
	} else {
		if _, err = tx.Exec(ctx, `UPDATE sync_deliveries SET status='cancelled' WHERE connection_id=$1 AND status='pending'`, oldID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM sync_recordings WHERE connection_id=$1`, oldID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO sync_accounts(user_id,provider,username,id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, user, c.Provider, c.Username, ID()); err != nil {
			return err
		}
		var accountID string
		if err = tx.QueryRow(ctx, `SELECT id FROM sync_accounts WHERE user_id=$1 AND provider=$2 AND username=$3`, user, c.Provider, c.Username).Scan(&accountID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO sync_connections(user_id,provider,id,username,credential) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(user_id,provider) DO UPDATE SET id=EXCLUDED.id,username=EXCLUDED.username,credential=EXCLUDED.credential,plays=true,now_playing=true,likes=false,paused=false,error='',last_success=NULL,connected_at=now()`, user, c.Provider, accountID, c.Username, c.Credential)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) SetSyncPreferences(ctx context.Context, user, provider string, p domain.SyncPreferences) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `UPDATE sync_connections SET plays=$3,now_playing=$4,likes=$5 WHERE user_id=$1 AND provider=$2 RETURNING id`, user, provider, p.Plays, p.NowPlaying, p.Likes).Scan(&id)
	if err != nil {
		return mapped(err)
	}
	_, err = tx.Exec(ctx, `UPDATE sync_deliveries SET status='cancelled' WHERE connection_id=$1 AND status='pending' AND ((kind='play' AND NOT $2) OR (kind='like' AND NOT $3))`, id, p.Plays, p.Likes)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteSyncConnection(ctx context.Context, user, provider string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `DELETE FROM sync_connections WHERE user_id=$1 AND provider=$2 RETURNING id`, user, provider).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE sync_deliveries SET status='cancelled' WHERE connection_id=$1 AND status='pending'`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sync_recordings WHERE connection_id=$1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) SaveSyncAuth(ctx context.Context, user, state string, expires time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM sync_auth WHERE user_id=$1 OR expires<now()`, user); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO sync_auth(state,user_id,expires) VALUES($1,$2,$3)`, state, user, expires); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) ConsumeSyncAuth(ctx context.Context, user, state string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM sync_auth WHERE user_id=$1 AND state=$2 AND expires>now()`, user, state)
	return tag.RowsAffected() == 1, err
}

func (s *Store) RecordSyncListen(ctx context.Context, user string, event domain.SyncEvent, p domain.SyncPayload) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO sync_listens(user_id,event_id,track_id,started_at,heard,payload) VALUES($1,$2,$3,to_timestamp($4),$5,$6) ON CONFLICT DO NOTHING`, user, event.EventID, p.TrackID, event.StartedAt, event.Heard, b)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	_, err = tx.Exec(ctx, `INSERT INTO sync_deliveries(id,user_id,connection_id,provider,event_id,kind,payload)
 SELECT c.id||':play:'||$2,$1,c.id,c.provider,$2,'play',$3 FROM sync_connections c WHERE c.user_id=$1 AND c.plays AND c.connected_at<=to_timestamp($4) FOR SHARE
 ON CONFLICT DO NOTHING`, user, event.EventID, b, event.StartedAt)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Called inside the same transaction as the local like change.
func enqueueSyncLike(ctx context.Context, tx pgx.Tx, user string, p domain.SyncPayload) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO sync_deliveries(id,user_id,connection_id,provider,event_id,kind,payload)
 SELECT c.id||':like:'||$2,$1,c.id,c.provider,$2,'like',$3 FROM sync_connections c WHERE c.user_id=$1 AND c.likes FOR SHARE
 ON CONFLICT(connection_id,kind,event_id) DO UPDATE SET payload=EXCLUDED.payload,status='pending',error='',attempts=0,next_attempt=now(),created=now(),revision=sync_deliveries.revision+1`, user, p.TrackID, b)
	return err
}

func (s *Store) NextSyncDelivery(ctx context.Context) (*domain.SyncDelivery, error) {
	var d domain.SyncDelivery
	var b []byte
	err := s.pool.QueryRow(ctx, `SELECT d.id,d.user_id,d.provider,d.connection_id,c.username,c.credential,d.kind,d.payload,d.attempts,d.revision,coalesce(r.recording_id,'')
 FROM sync_deliveries d JOIN sync_connections c ON c.id=d.connection_id
 LEFT JOIN sync_recordings r ON r.connection_id=c.id AND r.track_id=d.payload->>'trackId' AND r.title=d.payload->>'title' AND r.artist=d.payload->>'artist'
 WHERE d.status='pending' AND NOT c.paused AND d.next_attempt<=now()
 AND ((d.kind='play' AND c.plays) OR (d.kind='like' AND c.likes))
 AND (d.provider<>'listenbrainz' OR d.kind<>'like' OR r.recording_id IS NOT NULL)
 ORDER BY d.created,d.id LIMIT 1`).Scan(&d.ID, &d.UserID, &d.Connection.Provider, &d.Connection.ID, &d.Connection.Username, &d.Connection.Credential, &d.Kind, &b, &d.Attempts, &d.Revision, &d.RecordingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(b, &d.Payload); err != nil {
		return nil, err
	}
	return &d, nil
}
func (s *Store) FinishSyncDelivery(ctx context.Context, d domain.SyncDelivery, status, message string, next time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE sync_deliveries SET status=$2,error=$3,attempts=attempts+1,next_attempt=$4 WHERE id=$1 AND status='pending' AND revision=$5`, d.ID, status, message, next, d.Revision)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	if status == "sent" {
		_, err = tx.Exec(ctx, `UPDATE sync_connections SET last_success=now(),error='' WHERE id=$1`, d.Connection.ID)
	} else {
		_, err = tx.Exec(ctx, `UPDATE sync_connections SET error=$2,paused=(paused OR $3) WHERE id=$1`, d.Connection.ID, message, status == "auth")
		if status == "auth" {
			if _, e := tx.Exec(ctx, `UPDATE sync_deliveries SET status='pending' WHERE id=$1`, d.ID); e != nil {
				return e
			}
		}
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) SaveSyncRecording(ctx context.Context, user, connection string, p domain.SyncPayload, id string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO sync_recordings(connection_id,track_id,title,artist,recording_id)
 SELECT id,$3,$4,$5,$6 FROM sync_connections WHERE user_id=$1 AND id=$2
 ON CONFLICT(connection_id,track_id,title,artist) DO UPDATE SET recording_id=EXCLUDED.recording_id`, user, connection, p.TrackID, p.Title, p.Artist, id)
	return err
}

func (s *Store) SyncNotificationResult(ctx context.Context, user, connection, status, message string) error {
	_, err := s.pool.Exec(ctx, `UPDATE sync_connections SET error=$4,paused=(paused OR $3='auth'),last_success=CASE WHEN $3='sent' THEN now() ELSE last_success END WHERE user_id=$1 AND id=$2`, user, connection, status, message)
	return err
}

func previewSyncExport(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, user, provider string, from, to time.Time) (domain.SyncExport, error) {
	var v domain.SyncExport
	err := q.QueryRow(ctx, `SELECT
 (SELECT count(*) FROM sync_listens l WHERE l.user_id=$1 AND l.started_at>=$3 AND l.started_at<$4),
 (SELECT count(*) FROM sync_listens l JOIN sync_connections c ON c.user_id=l.user_id AND c.provider=$2 JOIN sync_deliveries d ON d.connection_id=c.id AND d.event_id=l.event_id AND d.kind='play' AND d.status='sent' WHERE l.user_id=$1 AND l.started_at>=$3 AND l.started_at<$4),
 (SELECT count(*) FROM plays p WHERE p.user_id=$1 AND p.played_at>=$3 AND p.played_at<$4 AND NOT EXISTS(SELECT 1 FROM sync_listens l WHERE l.user_id=p.user_id AND l.event_id=p.event_id))`, user, provider, from, to).Scan(&v.Eligible, &v.PreviouslySent, &v.Excluded)
	return v, err
}
func (s *Store) PreviewSyncExport(ctx context.Context, user, provider string, from, to time.Time) (domain.SyncExport, error) {
	return previewSyncExport(ctx, s.pool, user, provider, from, to)
}
func (s *Store) StartSyncExport(ctx context.Context, user, provider string, from, to time.Time) (domain.SyncExport, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return domain.SyncExport{}, err
	}
	defer tx.Rollback(ctx)
	var connection string
	if err = tx.QueryRow(ctx, `SELECT id FROM sync_connections WHERE user_id=$1 AND provider=$2 AND plays FOR UPDATE`, user, provider).Scan(&connection); err != nil {
		return domain.SyncExport{}, mapped(err)
	}
	v, err := previewSyncExport(ctx, tx, user, provider, from, to)
	if err != nil {
		return v, err
	}
	v.ID = ID()
	if _, err = tx.Exec(ctx, `INSERT INTO sync_exports(id,user_id,eligible,previously_sent,excluded) VALUES($1,$2,$3,$4,$5)`, v.ID, user, v.Eligible, v.PreviouslySent, v.Excluded); err != nil {
		return v, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO sync_deliveries(id,user_id,connection_id,provider,event_id,kind,payload)
 SELECT $2||':play:'||l.event_id,$1,$2,$3,l.event_id,'play',l.payload FROM sync_listens l WHERE l.user_id=$1 AND l.started_at>=$4 AND l.started_at<$5
 ON CONFLICT(connection_id,kind,event_id) DO UPDATE SET status='pending',error='',attempts=0,next_attempt=now() WHERE sync_deliveries.status='cancelled'`, user, connection, provider, from, to)
	if err != nil {
		return v, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO sync_export_deliveries SELECT $1,d.id FROM sync_deliveries d JOIN sync_listens l ON l.user_id=d.user_id AND l.event_id=d.event_id WHERE d.connection_id=$2 AND d.kind='play' AND l.started_at>=$3 AND l.started_at<$4`, v.ID, connection, from, to)
	if err != nil {
		return v, err
	}
	if err = tx.Commit(ctx); err != nil {
		return v, err
	}
	return s.SyncExportStatus(ctx, user, v.ID)
}
func (s *Store) SyncExportStatus(ctx context.Context, user, id string) (domain.SyncExport, error) {
	var v domain.SyncExport
	err := s.pool.QueryRow(ctx, `SELECT e.id,e.eligible,e.previously_sent,e.excluded,
 count(*) FILTER(WHERE d.status='pending'),count(*) FILTER(WHERE d.status='sent'),count(*) FILTER(WHERE d.status='rejected'),count(*) FILTER(WHERE d.status='cancelled')
 FROM sync_exports e LEFT JOIN sync_export_deliveries x ON x.export_id=e.id LEFT JOIN sync_deliveries d ON d.id=x.delivery_id
 WHERE e.id=$2 AND e.user_id=$1 GROUP BY e.id`, user, id).Scan(&v.ID, &v.Eligible, &v.PreviouslySent, &v.Excluded, &v.Pending, &v.Sent, &v.Rejected, &v.Cancelled)
	if err != nil {
		return v, mapped(err)
	}
	v.Failures = []domain.SyncFailure{}
	rows, err := s.pool.Query(ctx, `SELECT d.payload->>'title',d.payload->>'artist',d.error FROM sync_export_deliveries x JOIN sync_deliveries d ON d.id=x.delivery_id WHERE x.export_id=$1 AND d.status='rejected' ORDER BY d.created LIMIT 25`, id)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var f domain.SyncFailure
		if err = rows.Scan(&f.Title, &f.Artist, &f.Error); err != nil {
			return v, err
		}
		v.Failures = append(v.Failures, f)
	}
	return v, rows.Err()
}
