// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"cadence/internal/domain"
	"context"
	"github.com/jackc/pgx/v5"
	"strings"
)

var _ domain.NamedLibraryRepository = (*Store)(nil)

// A grant in any containing library is sufficient. Exclusions are applied separately.
const libraryGrant = `(ml.everyone OR EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.admin) OR EXISTS(SELECT 1 FROM library_users lu WHERE lu.library_id=ml.id AND lu.user_id=$1) OR EXISTS(SELECT 1 FROM library_groups lg JOIN user_groups ug ON ug.group_id=lg.group_id WHERE lg.library_id=ml.id AND ug.user_id=$1))`
const libraryContains = `(replace(t.path,chr(92),'/')=lf.path OR starts_with(replace(t.path,chr(92),'/'),rtrim(lf.path,'/')||'/'))`
const libraryAccess = `EXISTS(SELECT 1 FROM library_folders lf JOIN music_libraries ml ON ml.id=lf.library_id WHERE ` + libraryContains + ` AND ` + libraryGrant + `)`

func libraryFilter(parameter string) string {
	return `EXISTS(SELECT 1 FROM library_folders lf JOIN music_libraries ml ON ml.id=lf.library_id WHERE ml.id=` + parameter + ` AND ` + libraryContains + ` AND ` + libraryGrant + `)`
}

func (s *Store) MusicLibraries(ctx context.Context) ([]domain.MusicLibrary, error) {
	rows, err := s.pool.Query(ctx, `SELECT ml.id,ml.name,ml.everyone,
 ARRAY(SELECT path FROM library_folders WHERE library_id=ml.id ORDER BY path),
 ARRAY(SELECT user_id FROM library_users WHERE library_id=ml.id ORDER BY user_id),
 ARRAY(SELECT group_id FROM library_groups WHERE library_id=ml.id ORDER BY group_id)
 FROM music_libraries ml ORDER BY lower(ml.name),ml.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.MusicLibrary{}
	for rows.Next() {
		var v domain.MusicLibrary
		if err = rows.Scan(&v.ID, &v.Name, &v.Everyone, &v.Folders, &v.Users, &v.Groups); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) AccessibleLibraries(ctx context.Context, user string) ([]domain.LibrarySummary, error) {
	rows, err := s.pool.Query(ctx, `SELECT ml.id,ml.name FROM music_libraries ml WHERE `+libraryGrant+` ORDER BY lower(ml.name),ml.id`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.LibrarySummary{}
	for rows.Next() {
		var v domain.LibrarySummary
		if err = rows.Scan(&v.ID, &v.Name); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func saveLibrary(ctx context.Context, tx pgx.Tx, v domain.MusicLibrary) (domain.MusicLibrary, error) {
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" || len(v.Folders) == 0 {
		return v, domain.ErrConflict
	}
	if v.ID == "" {
		v.ID = ID()
		if _, err := tx.Exec(ctx, `INSERT INTO music_libraries(id,name,everyone) VALUES($1,$2,$3)`, v.ID, v.Name, v.Everyone); err != nil {
			return v, mapped(err)
		}
	} else {
		tag, err := tx.Exec(ctx, `UPDATE music_libraries SET name=$2,everyone=$3 WHERE id=$1`, v.ID, v.Name, v.Everyone)
		if err = affected(tag, err); err != nil {
			return v, err
		}
	}
	for _, table := range []string{"library_folders", "library_users", "library_groups"} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE library_id=$1`, v.ID); err != nil {
			return v, err
		}
	}
	for _, p := range v.Folders {
		if _, err := tx.Exec(ctx, `INSERT INTO library_folders VALUES($1,$2) ON CONFLICT DO NOTHING`, v.ID, p); err != nil {
			return v, mapped(err)
		}
	}
	for _, u := range v.Users {
		if _, err := tx.Exec(ctx, `INSERT INTO library_users VALUES($1,$2) ON CONFLICT DO NOTHING`, v.ID, u); err != nil {
			return v, mapped(err)
		}
	}
	for _, g := range v.Groups {
		if _, err := tx.Exec(ctx, `INSERT INTO library_groups VALUES($1,$2) ON CONFLICT DO NOTHING`, v.ID, g); err != nil {
			return v, mapped(err)
		}
	}
	return v, nil
}
func (s *Store) SaveMusicLibrary(ctx context.Context, v domain.MusicLibrary) (domain.MusicLibrary, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return v, err
	}
	defer tx.Rollback(ctx)
	v, err = saveLibrary(ctx, tx, v)
	if err != nil {
		return v, err
	}
	return v, tx.Commit(ctx)
}
func (s *Store) DeleteMusicLibrary(ctx context.Context, id string) error {
	return affected(s.pool.Exec(ctx, `DELETE FROM music_libraries WHERE id=$1`, id))
}
func (s *Store) InitializeLibraries(ctx context.Context, roots []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var initialized, pending bool
	if err = tx.QueryRow(ctx, `SELECT enabled FROM settings WHERE key='libraries_initialized' FOR UPDATE`).Scan(&initialized); err != nil {
		return err
	}
	if initialized {
		return tx.Commit(ctx)
	}
	if err = tx.QueryRow(ctx, `SELECT enabled FROM settings WHERE key='libraries_legacy_pending'`).Scan(&pending); err != nil {
		return err
	}
	if pending {
		if _, err = saveLibrary(ctx, tx, domain.MusicLibrary{Name: "Existing music", Folders: roots, Everyone: true}); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE settings SET enabled=true WHERE key='libraries_initialized'`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) FinishFolder(ctx context.Context, folder, scan string) error {
	_, err := s.pool.Exec(ctx, `UPDATE tracks SET available=false WHERE starts_with(path,rtrim($1,'/')||'/') AND seen<>$2`, folder, scan)
	return err
}
