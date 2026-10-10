// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
)

func (s *Store) RecordActivity(ctx context.Context, v domain.ActivityEntry) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO activity_log(level,user_id,user_name,name,overview,type) VALUES($1,$2,$3,$4,$5,$6)`, v.Level, v.UserID, v.UserName, v.Name, v.Overview, v.Type)
	return err
}
func (s *Store) Activity(ctx context.Context, filter, query string, limit, offset int) (domain.ActivityPage, error) {
	out := domain.ActivityPage{Items: []domain.ActivityEntry{}}
	const where = ` WHERE ($1='all' OR ($1='user' AND user_id<>'') OR ($1='system' AND user_id=''))
 AND ($2='' OR strpos(lower(name||' '||overview||' '||type||' '||user_name),lower($2))>0)`
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM activity_log"+where, filter, query).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.pool.Query(ctx, "SELECT id,created,level,user_id,user_name,name,overview,type FROM activity_log"+where+" ORDER BY created DESC,id DESC LIMIT $3 OFFSET $4", filter, query, limit, offset)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var v domain.ActivityEntry
		if err := rows.Scan(&v.ID, &v.Created, &v.Level, &v.UserID, &v.UserName, &v.Name, &v.Overview, &v.Type); err != nil {
			return out, err
		}
		out.Items = append(out.Items, v)
	}
	return out, rows.Err()
}
