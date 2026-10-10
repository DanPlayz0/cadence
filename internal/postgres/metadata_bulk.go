// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
	"fmt"
)

// Whitelisted expressions match the effective values exposed in song metadata.
func metadataExpression(field string) (string, error) {
	album := `coalesce(t.overrides->>'album',t.album)`
	single := `(btrim(` + album + `)='' OR lower(btrim(` + album + `))='unknown album')`
	switch field {
	case "title", "artist", "year", "genre":
		return `coalesce(t.overrides->>'` + field + `',t.` + field + `)`, nil
	case "album":
		return `CASE WHEN ` + single + ` THEN '' ELSE ` + album + ` END`, nil
	case "albumArtist":
		return `CASE WHEN ` + single + ` THEN '' ELSE coalesce(t.overrides->>'albumArtist',t.album_artist) END`, nil
	case "number", "disc":
		return `coalesce(t.overrides->>'` + field + `',t.` + field + `::text)`, nil
	default:
		return "", fmt.Errorf("invalid metadata field")
	}
}
func (s *Store) MetadataMatches(ctx context.Context, user, field, value string, limit, offset int) (domain.Page, error) {
	out := domain.Page{Items: []domain.Track{}, Limit: limit, Offset: offset}
	expression, err := metadataExpression(field)
	if err != nil {
		return out, err
	}
	where := allowed + ` AND lower(` + expression + `)=lower($2)`
	if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM tracks t WHERE "+where, user, value).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.pool.Query(ctx, "SELECT "+columns+" FROM tracks t WHERE "+where+" ORDER BY lower(coalesce(t.overrides->>'title',t.title)),t.id LIMIT $3 OFFSET $4", user, value, limit, offset)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		track, err := readTrack(rows)
		if err != nil {
			return out, err
		}
		track.NormalizeAlbum()
		out.Items = append(out.Items, track)
	}
	return out, rows.Err()
}
func (s *Store) BulkMetadataSuggestions(ctx context.Context, user, field, match, value string, expectedCount int) (int64, error) {
	expression, err := metadataExpression(field)
	if err != nil {
		return 0, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT t.id FROM tracks t WHERE "+allowed+" AND lower("+expression+")=lower($2) ORDER BY t.id FOR UPDATE OF t", user, match)
	if err != nil {
		return 0, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	if len(ids) != expectedCount {
		return 0, domain.ErrConflict
	}
	// No-op replacements do not create suggestions. Re-saving an older resolved
	// bulk correction reopens it, so a scan cannot make that correction unusable.
	result, err := tx.Exec(ctx, `INSERT INTO suggestions(id,track_id,field,value,source)
 SELECT md5($4||t.id),t.id,$2,$3,'administrator bulk edit' FROM tracks t WHERE t.id=ANY($1) AND `+expression+`<>$3
 ON CONFLICT(track_id,field,value,source) DO UPDATE SET status='pending',created=now() WHERE suggestions.status<>'pending'`, ids, field, value, ID())
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}
