// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"context"
	"strings"

	"cadence/internal/domain"
)

func (s *Store) UserByID(ctx context.Context, id string) (domain.User, error) {
	var u domain.User
	err := s.pool.QueryRow(ctx, `SELECT id,username,display_name,password,admin,octet_length(avatar)>0,avatar_version,
    ARRAY(SELECT group_id FROM user_groups WHERE user_id=users.id ORDER BY group_id) FROM users WHERE id=$1`, id).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Password, &u.Admin, &u.Avatar, &u.AvatarVersion, &u.Groups)
	return u, mapped(err)
}

func (s *Store) UpdateUser(ctx context.Context, id string, patch domain.UserUpdate) (domain.User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.User{}, err
	}
	defer tx.Rollback(ctx)
	// Serialize role changes so concurrent demotions cannot remove every admin.
	if patch.Admin != nil {
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(78419323)"); err != nil {
			return domain.User{}, err
		}
	}
	var locked string
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", id).Scan(&locked); err != nil {
		return domain.User{}, mapped(err)
	}
	if patch.Admin != nil && !*patch.Admin {
		var last bool
		if err = tx.QueryRow(ctx, "SELECT admin AND (SELECT count(*) FROM users WHERE admin)=1 FROM users WHERE id=$1", id).Scan(&last); err != nil {
			return domain.User{}, err
		}
		if last {
			return domain.User{}, domain.ErrLastAdministrator
		}
	}
	if patch.Username != nil {
		normalized := strings.ToLower(strings.TrimSpace(*patch.Username))
		patch.Username = &normalized
	}
	if patch.DisplayName != nil {
		trimmed := strings.TrimSpace(*patch.DisplayName)
		patch.DisplayName = &trimmed
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET username=coalesce($2,username),display_name=coalesce($3,display_name),admin=coalesce($4,admin) WHERE id=$1", id, patch.Username, patch.DisplayName, patch.Admin); err != nil {
		return domain.User{}, mapped(err)
	}
	if patch.Groups != nil {
		if _, err = tx.Exec(ctx, "DELETE FROM user_groups WHERE user_id=$1", id); err != nil {
			return domain.User{}, err
		}
		for _, group := range *patch.Groups {
			if _, err = tx.Exec(ctx, "INSERT INTO user_groups VALUES($1,$2) ON CONFLICT DO NOTHING", id, group); err != nil {
				return domain.User{}, mapped(err)
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.User{}, err
	}
	return s.UserByID(ctx, id)
}

// Password replacement and session revocation must commit together. The expected
// hash prevents a concurrent administrator reset from accepting stale proof.
func (s *Store) ChangePassword(ctx context.Context, id, expectedHash, hash, keepToken string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var existing string
	if err = tx.QueryRow(ctx, "SELECT password FROM users WHERE id=$1 FOR UPDATE", id).Scan(&existing); err != nil {
		return mapped(err)
	}
	if expectedHash != "" && expectedHash != existing {
		return domain.ErrConflict
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET password=$2 WHERE id=$1", id, hash); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1 AND token<>$2", id, keepToken); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) Avatar(ctx context.Context, id string) ([]byte, error) {
	var data []byte
	err := s.pool.QueryRow(ctx, "SELECT avatar FROM users WHERE id=$1 AND octet_length(avatar)>0", id).Scan(&data)
	return data, mapped(err)
}

func (s *Store) SetAvatar(ctx context.Context, id string, data []byte) (domain.User, error) {
	if data == nil {
		data = []byte{}
	}
	if err := affected(s.pool.Exec(ctx, "UPDATE users SET avatar=$2,avatar_version=avatar_version+1 WHERE id=$1", id, data)); err != nil {
		return domain.User{}, err
	}
	return s.UserByID(ctx, id)
}
