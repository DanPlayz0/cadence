// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
	"strings"
)

// Browse the indexed, permission-filtered catalog; never enumerate arbitrary disk paths.
func (s *Store) LibraryDirectory(ctx context.Context, user, folder string, limit, offset int) (domain.LibraryDirectory, error) {
	folder = strings.ReplaceAll(folder, `\`, "/")
	if folder != "/" {
		folder = strings.TrimRight(folder, "/")
	}
	page := domain.LibraryDirectory{Items: []domain.LibraryEntry{}, Limit: limit, Offset: offset}
	rows, err := s.pool.Query(ctx, `WITH visible AS (
 SELECT t.id,replace(t.path,chr(92),'/') AS path,rtrim(replace(t.root,chr(92),'/'),'/') AS root,
 coalesce(t.overrides->>'title',t.title) AS title,coalesce(t.overrides->>'artist',t.artist) AS artist
 FROM tracks t WHERE `+allowed+`
), descendants AS (
 SELECT *, substring(path FROM length(rtrim($2,'/'))+2) AS remainder FROM visible
 WHERE $2<>'' AND ($2=root OR left($2,length(root)+1)=root||'/' OR (root='' AND left($2,1)='/'))
 AND left(path,length(rtrim($2,'/'))+1)=rtrim($2,'/')||'/'
), raw_entries AS (
 SELECT coalesce(nullif(root,''),'/') AS name,coalesce(nullif(root,''),'/') AS path,'folder' AS kind,'' AS track_id,'' AS title,'' AS artist
 FROM visible WHERE $2=''
 UNION ALL
 SELECT split_part(remainder,'/',1),rtrim($2,'/')||'/'||split_part(remainder,'/',1),
 CASE WHEN strpos(remainder,'/')>0 THEN 'folder' ELSE 'file' END,
 CASE WHEN strpos(remainder,'/')>0 THEN '' ELSE id END,
 CASE WHEN strpos(remainder,'/')>0 THEN '' ELSE title END,
 CASE WHEN strpos(remainder,'/')>0 THEN '' ELSE artist END
 FROM descendants WHERE remainder<>''
), entries AS (
 SELECT name,path,kind,track_id,min(title) AS title,min(artist) AS artist,count(*) AS tracks
 FROM raw_entries GROUP BY name,path,kind,track_id
)
SELECT name,path,kind,track_id,title,artist,tracks,count(*) OVER() FROM entries
ORDER BY kind DESC,lower(name),path,track_id LIMIT $3 OFFSET $4`, user, folder, limit, offset)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry domain.LibraryEntry
		if err = rows.Scan(&entry.Name, &entry.Path, &entry.Kind, &entry.TrackID, &entry.Title, &entry.Artist, &entry.Tracks, &page.Total); err != nil {
			return page, err
		}
		page.Items = append(page.Items, entry)
	}
	return page, rows.Err()
}

func (s *Store) TrackSuggestions(ctx context.Context, track string) ([]domain.Suggestion, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+suggestionColumns+" FROM suggestions s JOIN tracks t ON t.id=s.track_id WHERE s.track_id=$1 AND s.status='pending' ORDER BY s.field,s.created DESC,s.id DESC", track)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Suggestion{}
	for rows.Next() {
		suggestion, e := readSuggestion(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, suggestion)
	}
	return out, rows.Err()
}

// Apply one chosen value per field atomically, checking that the compared values are still current.
func (s *Store) ApplyMetadataChoices(ctx context.Context, track string, choices []domain.MetadataChoice) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT "+suggestionColumns+" FROM suggestions s JOIN tracks t ON t.id=s.track_id WHERE s.track_id=$1 AND s.status='pending' ORDER BY s.track_id,s.field,s.created,s.id FOR UPDATE OF s", track)
	if err != nil {
		return err
	}
	pending := map[string]domain.Suggestion{}
	for rows.Next() {
		v, e := readSuggestion(rows)
		if e != nil {
			rows.Close()
			return e
		}
		pending[v.ID] = v
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var locked string
	if err = tx.QueryRow(ctx, "SELECT id FROM tracks WHERE id=$1 FOR UPDATE", track).Scan(&locked); err != nil {
		return mapped(err)
	}
	fields := map[string]bool{}
	for _, choice := range choices {
		candidate, ok := pending[choice.ID]
		if !ok || fields[candidate.Field] {
			return domain.ErrConflict
		}
		fields[candidate.Field] = true
		// Re-read after acquiring the track lock: another reviewer may have changed it.
		current, e := readSuggestion(tx.QueryRow(ctx, "SELECT "+suggestionColumns+" FROM suggestions s JOIN tracks t ON t.id=s.track_id WHERE s.id=$1", choice.ID))
		if e != nil {
			return e
		}
		if current.Current != choice.Current {
			return domain.ErrConflict
		}
		value := candidate.Value
		if choice.Value != nil {
			value = *choice.Value
		}
		if _, err = tx.Exec(ctx, "UPDATE tracks SET overrides=jsonb_set(overrides,ARRAY[$2]::text[],to_jsonb($3::text)) WHERE id=$1", track, candidate.Field, value); err != nil {
			return err
		}
		if choice.Value != nil && value != candidate.Value {
			if _, err = tx.Exec(ctx, "UPDATE suggestions SET value=$2,source=source||' (edited by administrator)' WHERE id=$1", choice.ID, value); err != nil {
				return mapped(err)
			}
		}
		if _, err = tx.Exec(ctx, "UPDATE suggestions SET status=CASE WHEN id=$3 THEN 'accepted' ELSE 'dismissed' END WHERE track_id=$1 AND field=$2 AND status='pending'", track, candidate.Field, choice.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
