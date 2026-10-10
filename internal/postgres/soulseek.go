// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
)

var _ domain.SoulseekRepository = (*Store)(nil)

func (s *Store) SoulseekSettings(ctx context.Context) (domain.SoulseekSettings, error) {
	v := domain.DefaultSoulseekSettings()
	var b, shares []byte
	err := s.pool.QueryRow(ctx, "SELECT payload,managed_shares FROM soulseek_settings WHERE id=true").Scan(&b, &shares)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, nil
	}
	if err != nil {
		return v, err
	}
	if err = json.Unmarshal(b, &v); err != nil {
		return v, err
	}
	err = json.Unmarshal(shares, &v.ManagedShares)
	return v, err
}
func (s *Store) SaveSoulseekSettings(ctx context.Context, v domain.SoulseekSettings) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	shares, err := json.Marshal(v.ManagedShares)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO soulseek_settings(id,payload,managed_shares) VALUES(true,$1,$2) ON CONFLICT(id) DO UPDATE SET payload=$1,managed_shares=$2`, b, shares)
	return err
}
func (s *Store) CreateSoulseekSearch(ctx context.Context, id, user string) error {
	_, err := s.pool.Exec(ctx, "INSERT INTO soulseek_searches(id,user_id) VALUES($1,$2)", id, user)
	return mapped(err)
}
func (s *Store) OwnsSoulseekSearch(ctx context.Context, id, user string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM soulseek_searches WHERE id=$1 AND user_id=$2)", id, user).Scan(&ok)
	return ok, err
}
func unpackSoulseek(b []byte, revision int64) (domain.SoulseekRequest, error) {
	var stored domain.SoulseekStoredRequest
	err := json.Unmarshal(b, &stored)
	v := stored.SoulseekRequest
	v.Revision = revision
	v.PreviousBatches = stored.PreviousBatches
	for i := range v.Files {
		if i < len(stored.ImportedPaths) {
			v.Files[i].ImportedPath = stored.ImportedPaths[i]
		}
		if i < len(stored.Digests) {
			v.Files[i].Digest = stored.Digests[i]
		}
	}
	return v, err
}
func (s *Store) SoulseekRequest(ctx context.Context, id string) (domain.SoulseekRequest, error) {
	var b []byte
	var revision int64
	err := s.pool.QueryRow(ctx, "SELECT payload,revision FROM soulseek_requests WHERE id=$1", id).Scan(&b, &revision)
	if err != nil {
		return domain.SoulseekRequest{}, mapped(err)
	}
	return unpackSoulseek(b, revision)
}
func (s *Store) SoulseekRequests(ctx context.Context, user string, active bool, limit, offset int) ([]domain.SoulseekRequest, error) {
	out := []domain.SoulseekRequest{}
	rows, err := s.pool.Query(ctx, `SELECT payload,revision FROM soulseek_requests WHERE ($1='' OR user_id=$1) AND (NOT $2 OR payload->>'state' IN ('queued','downloading','importing','cancelling')) ORDER BY created DESC,id LIMIT $3 OFFSET $4`, user, active, limit, offset)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var b []byte
		var revision int64
		if err = rows.Scan(&b, &revision); err != nil {
			return out, err
		}
		v, e := unpackSoulseek(b, revision)
		if e != nil {
			return out, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) SaveSoulseekRequest(ctx context.Context, v *domain.SoulseekRequest) error {
	stored := domain.SoulseekStoredRequest{SoulseekRequest: *v, PreviousBatches: v.PreviousBatches}
	for _, f := range v.Files {
		stored.ImportedPaths = append(stored.ImportedPaths, f.ImportedPath)
		stored.Digests = append(stored.Digests, f.Digest)
	}
	b, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	if v.Revision == 0 {
		_, err = s.pool.Exec(ctx, "INSERT INTO soulseek_requests(id,user_id,payload,revision,created) VALUES($1,$2,$3,1,$4)", v.ID, v.UserID, b, v.Created)
	} else {
		tag, e := s.pool.Exec(ctx, "UPDATE soulseek_requests SET payload=$1,revision=revision+1 WHERE id=$2 AND revision=$3", b, v.ID, v.Revision)
		err = e
		if err == nil && tag.RowsAffected() != 1 {
			err = domain.ErrConflict
		}
	}
	if err == nil {
		v.Revision++
	}
	return mapped(err)
}
