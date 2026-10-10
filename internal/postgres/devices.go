// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
)

// Update at most once per minute unless the client details change.
func (s *Store) RecordDevice(ctx context.Context, token, agent, version string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO session_devices(id,token,user_agent,client_version)
 SELECT $1,token,$3,$4 FROM sessions WHERE token=$2 AND expires>now()
 ON CONFLICT(token) DO UPDATE SET user_agent=excluded.user_agent,client_version=coalesce(nullif(excluded.client_version,''),session_devices.client_version),last_active=now()
 WHERE session_devices.last_active<now()-interval '1 minute' OR session_devices.user_agent<>excluded.user_agent OR (excluded.client_version<>'' AND session_devices.client_version<>excluded.client_version)`, ID(), token, agent, version)
	return err
}
func (s *Store) Devices(ctx context.Context) ([]domain.Device, error) {
	rows, err := s.pool.Query(ctx, `SELECT d.id,u.id,u.username,u.display_name,u.admin,octet_length(u.avatar)>0,u.avatar_version,ARRAY(SELECT group_id FROM user_groups WHERE user_id=u.id ORDER BY group_id),d.user_agent,d.client_version,d.last_active
 FROM session_devices d JOIN sessions s ON s.token=d.token JOIN users u ON u.id=s.user_id
 WHERE s.expires>now() ORDER BY d.last_active DESC,d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Device{}
	for rows.Next() {
		var d domain.Device
		if err := rows.Scan(&d.ID, &d.User.ID, &d.User.Username, &d.User.DisplayName, &d.User.Admin, &d.User.Avatar, &d.User.AvatarVersion, &d.User.Groups, &d.UserAgent, &d.ClientVersion, &d.LastActive); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
