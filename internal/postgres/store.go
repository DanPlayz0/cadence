// SPDX-License-Identifier: GPL-2.0-or-later
package postgres

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"cadence/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

//go:embed 002_user_names.sql
var userNamesMigration string

//go:embed 003_playlist_icons.sql
var playlistIconsMigration string

//go:embed 004_user_avatars.sql
var userAvatarsMigration string

//go:embed 005_metadata_numbers.sql
var metadataNumbersMigration string

//go:embed 006_playback.sql
var playbackMigration string

//go:embed 007_artist_credits.sql
var artistCreditsMigration string

//go:embed 008_artist_profiles.sql
var artistProfilesMigration string

type Store struct{ pool *pgxpool.Pool }

var _ domain.Repository = (*Store)(nil)

func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 24
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	s := &Store{p}
	if err = s.migrate(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(78419321)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY)"); err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=1)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, schema); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(1)"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, userNamesMigration); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(2)"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=3)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, playlistIconsMigration); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(3)"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=4)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, userAvatarsMigration); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(4)"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=5)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, metadataNumbersMigration); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(5)"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=6)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, playbackMigration); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(6)"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=7)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, artistCreditsMigration); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(7)"); err != nil {
			return err
		}
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=8)").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, artistProfilesMigration); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations VALUES(8)"); err != nil {
			return err
		}
	}
	// A previous process may have stopped in the middle of a scan.
	_, err = tx.Exec(ctx, "UPDATE scans SET status='interrupted',finished=now() WHERE status='running'")
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }
func mapped(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrNotFound
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) && (pe.Code == "23505" || pe.Code == "23503") {
		return domain.ErrConflict
	}
	return err
}
func affected(tag pgconn.CommandTag, err error) error {
	if err != nil {
		return mapped(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
func (s *Store) HasUsers(ctx context.Context) (bool, error) {
	var b bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users)").Scan(&b)
	return b, err
}
func (s *Store) CreateUser(ctx context.Context, u domain.User, first bool) (domain.User, error) {
	u.ID = ID()
	u.Username = strings.ToLower(strings.TrimSpace(u.Username))
	u.DisplayName = strings.TrimSpace(u.DisplayName)
	if u.DisplayName == "" {
		u.DisplayName = u.Username
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return u, err
	}
	defer tx.Rollback(ctx)
	if first {
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(78419322)"); err != nil {
			return u, err
		}
		var b bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users)").Scan(&b); err != nil {
			return u, err
		}
		if b {
			return u, domain.ErrConflict
		}
		u.Admin = true
	}
	err = tx.QueryRow(ctx, "INSERT INTO users(id,username,password,admin,display_name) VALUES($1,lower($2),$3,$4,$5) RETURNING username", u.ID, u.Username, u.Password, u.Admin, u.DisplayName).Scan(&u.Username)
	if err != nil {
		return u, mapped(err)
	}
	return u, tx.Commit(ctx)
}
func (s *Store) UserByUsername(ctx context.Context, username string) (domain.User, error) {
	var u domain.User
	err := s.pool.QueryRow(ctx, "SELECT id,username,display_name,password,admin,octet_length(avatar)>0,avatar_version FROM users WHERE username=lower($1)", strings.ToLower(strings.TrimSpace(username))).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Password, &u.Admin, &u.Avatar, &u.AvatarVersion)
	return u, mapped(err)
}
func (s *Store) SaveSession(ctx context.Context, token, user, csrf string, expires time.Time, expectedHash string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var hash string
	if err = tx.QueryRow(ctx, "SELECT password FROM users WHERE id=$1 FOR SHARE", user).Scan(&hash); err != nil {
		return mapped(err)
	}
	if hash != expectedHash {
		return domain.ErrConflict
	}
	if _, err = tx.Exec(ctx, "DELETE FROM sessions WHERE expires<now()"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO sessions VALUES($1,$2,$3,$4)", token, user, csrf, expires); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Session(ctx context.Context, token string) (domain.Session, error) {
	var v domain.Session
	err := s.pool.QueryRow(ctx, "SELECT u.id,u.username,u.display_name,u.admin,s.csrf,s.expires,octet_length(u.avatar)>0,u.avatar_version,ARRAY(SELECT group_id FROM user_groups WHERE user_id=u.id ORDER BY group_id) FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires>now()", token).Scan(&v.User.ID, &v.User.Username, &v.User.DisplayName, &v.User.Admin, &v.CSRF, &v.Expires, &v.User.Avatar, &v.User.AvatarVersion, &v.User.Groups)
	return v, mapped(err)
}
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, "DELETE FROM sessions WHERE token=$1", token)
	return err
}
func (s *Store) RevokeSessions(ctx context.Context, user string) error {
	_, err := s.pool.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1", user)
	return err
}

// Every consumer filters tracks before aggregation. Folder matches require a path boundary.
const allowed = `t.available AND NOT EXISTS (SELECT 1 FROM user_groups ug JOIN exclusions e ON e.group_id=ug.group_id WHERE ug.user_id=$1 AND ((e.kind='track' AND e.target=t.id) OR (e.kind='album' AND e.target=t.album_id) OR (e.kind='folder' AND (t.path=e.target OR left(t.path,length(e.target)+1)=e.target||'/'))))`
const columns = `t.id,coalesce(t.overrides->>'title',t.title),coalesce(t.overrides->>'artist',t.artist),coalesce(t.overrides->>'albumArtist',t.album_artist),coalesce(t.overrides->>'album',t.album),t.album_id,coalesce((t.overrides->>'number')::integer,t.number),coalesce((t.overrides->>'disc')::integer,t.disc),coalesce(t.overrides->>'year',t.year),coalesce(t.overrides->>'genre',t.genre),t.duration,t.codec,t.mime,t.path,coalesce(t.overrides->>'artwork',t.art_path),t.size,t.modified,t.root`

func readTrack(row pgx.Row) (domain.Track, error) {
	var t domain.Track
	err := row.Scan(&t.ID, &t.Title, &t.Artist, &t.AlbumArtist, &t.Album, &t.AlbumID, &t.Number, &t.Disc, &t.Year, &t.Genre, &t.Duration, &t.Codec, &t.MIME, &t.Path, &t.ArtPath, &t.Size, &t.Modified, &t.Root)
	t.Artwork = t.ArtPath != ""
	return t, mapped(err)
}
func (s *Store) Track(ctx context.Context, user, id string) (domain.Track, error) {
	return readTrack(s.pool.QueryRow(ctx, "SELECT "+columns+" FROM tracks t WHERE t.id=$2 AND "+allowed, user, id))
}
func (s *Store) AllowedIDs(ctx context.Context, user string, ids []string) ([]string, error) {
	rows, err := s.pool.Query(ctx, "SELECT t.id FROM tracks t WHERE t.id=ANY($2) AND "+allowed, user, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
func filter(q domain.Query) (string, []any, string) {
	w := allowed
	args := []any{}
	n := 1
	order := `lower(coalesce(t.overrides->>'albumArtist',t.album_artist)),lower(coalesce(t.overrides->>'album',t.album)),coalesce((t.overrides->>'disc')::integer,t.disc),coalesce((t.overrides->>'number')::integer,t.number),t.id`
	add := func(expr string, value any) { n++; w += " AND " + fmt.Sprintf(expr, n); args = append(args, value) }
	if q.Search != "" {
		add("t.search @@ websearch_to_tsquery('simple',$%d)", q.Search)
	}
	if q.Album != "" {
		add("t.album_id=$%d", q.Album)
	}
	if q.Artist != "" {
		add("artist_names(coalesce(t.overrides->>'artist',t.artist)) @> ARRAY[$%d]::text[]", q.Artist)
	}
	if q.Collection == "likes" {
		w += " AND EXISTS(SELECT 1 FROM likes l WHERE l.track_id=t.id AND l.user_id=$1)"
	}
	if q.Collection == "history" {
		w += " AND EXISTS(SELECT 1 FROM plays p WHERE p.track_id=t.id AND p.user_id=$1)"
		order = "(SELECT max(played_at) FROM plays p WHERE p.track_id=t.id AND p.user_id=$1) DESC,t.id"
	}
	if q.Playlist != "" {
		add("EXISTS(SELECT 1 FROM playlist_tracks pt JOIN playlists pl ON pl.id=pt.playlist_id WHERE pl.user_id=$1 AND pt.track_id=t.id AND pl.id=$%d)", q.Playlist)
		order = "(SELECT position FROM playlist_tracks WHERE playlist_id=$" + fmt.Sprint(n) + " AND track_id=t.id),t.id"
	}
	return w, args, order
}
func (s *Store) Tracks(ctx context.Context, user string, q domain.Query) (domain.Page, error) {
	p := domain.Page{Items: []domain.Track{}, Offset: q.Offset, Limit: q.Limit}
	w, args, order := filter(q)
	args = append([]any{user}, args...)
	err := s.pool.QueryRow(ctx, "SELECT count(*) FROM tracks t WHERE "+w, args...).Scan(&p.Total)
	if err != nil {
		return p, err
	}
	limitN := len(args) + 1
	args = append(args, q.Limit, q.Offset)
	rows, err := s.pool.Query(ctx, "SELECT "+columns+" FROM tracks t WHERE "+w+" ORDER BY "+order+fmt.Sprintf(" LIMIT $%d OFFSET $%d", limitN, limitN+1), args...)
	if err != nil {
		return p, err
	}
	defer rows.Close()
	for rows.Next() {
		t, e := readTrack(rows)
		if e != nil {
			return p, e
		}
		p.Items = append(p.Items, t)
	}
	if err = rows.Err(); err != nil {
		return p, err
	}
	ids := make([]string, len(p.Items))
	for i, t := range p.Items {
		ids[i] = t.ID
	}
	lr, err := s.pool.Query(ctx, "SELECT track_id FROM likes WHERE user_id=$1 AND track_id=ANY($2)", user, ids)
	if err != nil {
		return p, err
	}
	defer lr.Close()
	likes := map[string]bool{}
	for lr.Next() {
		var id string
		if err = lr.Scan(&id); err != nil {
			return p, err
		}
		likes[id] = true
	}
	for i := range p.Items {
		p.Items[i].Liked = likes[p.Items[i].ID]
	}
	return p, lr.Err()
}
func (s *Store) Albums(ctx context.Context, user, search string, limit, offset int) ([]domain.Album, error) {
	rows, err := s.pool.Query(ctx, `SELECT t.album_id,min(coalesce(t.overrides->>'album',t.album)),min(coalesce(t.overrides->>'albumArtist',t.album_artist)),count(*),coalesce(min(t.id) FILTER (WHERE coalesce(t.overrides->>'artwork',t.art_path)<>''),'') FROM tracks t WHERE `+allowed+` AND ($2='' OR t.search @@ websearch_to_tsquery('simple',$2)) GROUP BY t.album_id ORDER BY lower(min(coalesce(t.overrides->>'album',t.album))),t.album_id LIMIT $3 OFFSET $4`, user, search, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Album{}
	for rows.Next() {
		var a domain.Album
		if err = rows.Scan(&a.ID, &a.Title, &a.Artist, &a.Tracks, &a.CoverID); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (s *Store) Artists(ctx context.Context, user, search string, limit, offset int) ([]domain.Artist, error) {
	rows, err := s.pool.Query(ctx, `SELECT a.name,count(*) FROM tracks t CROSS JOIN LATERAL unnest(artist_names(coalesce(t.overrides->>'artist',t.artist))) AS a(name) WHERE `+allowed+` AND ($2='' OR t.search @@ websearch_to_tsquery('simple',$2)) GROUP BY a.name ORDER BY lower(a.name),a.name LIMIT $3 OFFSET $4`, user, search, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Artist{}
	for rows.Next() {
		var a domain.Artist
		if err = rows.Scan(&a.Name, &a.Tracks); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (s *Store) UpsertTrack(ctx context.Context, t domain.Track, scan string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `INSERT INTO tracks(id,path,root,size,modified,seen,title,artist,album_artist,album,album_id,number,disc,year,genre,duration,codec,mime,art_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT(path) DO UPDATE SET root=excluded.root,size=excluded.size,modified=excluded.modified,seen=excluded.seen,available=true,title=excluded.title,artist=excluded.artist,album_artist=excluded.album_artist,album=excluded.album,album_id=excluded.album_id,number=excluded.number,disc=excluded.disc,year=excluded.year,genre=excluded.genre,duration=excluded.duration,codec=excluded.codec,mime=excluded.mime,art_path=excluded.art_path RETURNING id`, ID(), t.Path, t.Root, t.Size, t.Modified, scan, t.Title, t.Artist, t.AlbumArtist, t.Album, t.AlbumID, t.Number, t.Disc, t.Year, t.Genre, t.Duration, t.Codec, t.MIME, t.ArtPath).Scan(&id)
	return id, err
}
func (s *Store) TrackByPath(ctx context.Context, path string) (domain.Track, error) {
	return readTrack(s.pool.QueryRow(ctx, "SELECT "+columns+" FROM tracks t WHERE t.path=$1", path))
}

func (s *Store) FileStamp(ctx context.Context, path string) (int64, int64, error) {
	var size, mod int64
	err := s.pool.QueryRow(ctx, "SELECT size,modified FROM tracks WHERE path=$1", path).Scan(&size, &mod)
	return size, mod, mapped(err)
}
func (s *Store) MarkSeen(ctx context.Context, path, scan string) error {
	_, err := s.pool.Exec(ctx, "UPDATE tracks SET seen=$2,available=true WHERE path=$1", path, scan)
	return err
}
func (s *Store) FinishRoot(ctx context.Context, root, scan string) error {
	_, err := s.pool.Exec(ctx, "UPDATE tracks SET available=false WHERE root=$1 AND seen<>$2", root, scan)
	return err
}
func (s *Store) RawTracks(ctx context.Context, limit, offset int) ([]domain.Track, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+columns+" FROM tracks t WHERE available ORDER BY t.id LIMIT $1 OFFSET $2", limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Track{}
	for rows.Next() {
		t, e := readTrack(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) AddSuggestion(ctx context.Context, v domain.Suggestion) error {
	_, err := s.pool.Exec(ctx, "INSERT INTO suggestions(id,track_id,field,value,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(track_id,field,value,source) DO NOTHING", ID(), v.TrackID, v.Field, v.Value, v.Source)
	return err
}
func (s *Store) ScanStart(ctx context.Context, v domain.Scan) error {
	_, err := s.pool.Exec(ctx, "INSERT INTO scans(id,started,status) VALUES($1,$2,$3)", v.ID, v.Started, v.Status)
	return err
}
func (s *Store) ScanFinish(ctx context.Context, v domain.Scan) error {
	b, _ := json.Marshal(v.Errors)
	_, err := s.pool.Exec(ctx, "UPDATE scans SET finished=$2,status=$3,indexed=$4,errors=$5 WHERE id=$1", v.ID, v.Finished, v.Status, v.Indexed, b)
	return err
}
func (s *Store) Scans(ctx context.Context) ([]domain.Scan, error) {
	rows, err := s.pool.Query(ctx, "SELECT id,started,finished,status,indexed,errors FROM scans ORDER BY started DESC LIMIT 20")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Scan{}
	for rows.Next() {
		var v domain.Scan
		var b []byte
		if err = rows.Scan(&v.ID, &v.Started, &v.Finished, &v.Status, &v.Indexed, &b); err != nil {
			return nil, err
		}
		json.Unmarshal(b, &v.Errors)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) Playlists(ctx context.Context, user string) ([]domain.Playlist, error) {
	rows, err := s.pool.Query(ctx, "SELECT id,name,icon FROM playlists WHERE user_id=$1 ORDER BY name,id", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Playlist{}
	for rows.Next() {
		var p domain.Playlist
		if err = rows.Scan(&p.ID, &p.Name, &p.Icon); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) CreatePlaylist(ctx context.Context, user, name, icon string) (domain.Playlist, error) {
	if icon == "" {
		icon = "music"
	}
	p := domain.Playlist{ID: ID(), Name: name, Icon: icon}
	_, err := s.pool.Exec(ctx, "INSERT INTO playlists(id,user_id,name,icon) VALUES($1,$2,$3,$4)", p.ID, user, name, icon)
	return p, err
}
func (s *Store) DeletePlaylist(ctx context.Context, user, id string) error {
	return affected(s.pool.Exec(ctx, "DELETE FROM playlists WHERE id=$1 AND user_id=$2", id, user))
}
func (s *Store) AddPlaylistTrack(ctx context.Context, user, playlist, track string) error {
	if _, err := s.Track(ctx, user, track); err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, "INSERT INTO playlist_tracks(playlist_id,track_id) SELECT id,$3 FROM playlists WHERE id=$2 AND user_id=$1 ON CONFLICT(playlist_id,track_id) DO UPDATE SET track_id=excluded.track_id", user, playlist, track)
	return affected(tag, err)
}
func (s *Store) RemovePlaylistTrack(ctx context.Context, user, playlist, track string) error {
	return affected(s.pool.Exec(ctx, "DELETE FROM playlist_tracks pt USING playlists p WHERE p.id=pt.playlist_id AND p.user_id=$1 AND p.id=$2 AND pt.track_id=$3", user, playlist, track))
}
func (s *Store) Like(ctx context.Context, user, track string, on bool) error {
	if _, err := s.Track(ctx, user, track); err != nil {
		return err
	}
	if on {
		_, err := s.pool.Exec(ctx, "INSERT INTO likes VALUES($1,$2) ON CONFLICT DO NOTHING", user, track)
		return err
	}
	_, err := s.pool.Exec(ctx, "DELETE FROM likes WHERE user_id=$1 AND track_id=$2", user, track)
	return err
}
func (s *Store) RecordPlay(ctx context.Context, user, track, event string) error {
	if _, err := s.Track(ctx, user, track); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, "INSERT INTO plays(user_id,track_id,event_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", user, track, event)
	return err
}
func (s *Store) Users(ctx context.Context) ([]domain.User, error) {
	rows, err := s.pool.Query(ctx, "SELECT u.id,u.username,u.display_name,u.admin,octet_length(u.avatar)>0,u.avatar_version,coalesce(array_agg(ug.group_id) FILTER(WHERE ug.group_id IS NOT NULL),'{}') FROM users u LEFT JOIN user_groups ug ON ug.user_id=u.id GROUP BY u.id ORDER BY u.username")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.User{}
	for rows.Next() {
		var u domain.User
		if err = rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Admin, &u.Avatar, &u.AvatarVersion, &u.Groups); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
func (s *Store) Groups(ctx context.Context) ([]domain.Group, error) {
	rows, err := s.pool.Query(ctx, "SELECT id,name FROM groups ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Group{}
	for rows.Next() {
		var g domain.Group
		if err = rows.Scan(&g.ID, &g.Name); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
func (s *Store) CreateGroup(ctx context.Context, name string) (domain.Group, error) {
	g := domain.Group{ID: ID(), Name: name}
	_, err := s.pool.Exec(ctx, "INSERT INTO groups VALUES($1,$2)", g.ID, g.Name)
	return g, mapped(err)
}
func (s *Store) SetGroups(ctx context.Context, user string, groups []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", user).Scan(&id); err != nil {
		return mapped(err)
	}
	if _, err = tx.Exec(ctx, "DELETE FROM user_groups WHERE user_id=$1", user); err != nil {
		return err
	}
	for _, g := range groups {
		if _, err = tx.Exec(ctx, "INSERT INTO user_groups VALUES($1,$2) ON CONFLICT DO NOTHING", user, g); err != nil {
			return mapped(err)
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) Exclusions(ctx context.Context) ([]domain.Exclusion, error) {
	rows, err := s.pool.Query(ctx, "SELECT id,group_id,kind,target FROM exclusions ORDER BY group_id,kind,target")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Exclusion{}
	for rows.Next() {
		var v domain.Exclusion
		if err = rows.Scan(&v.ID, &v.GroupID, &v.Kind, &v.Target); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) CreateExclusion(ctx context.Context, v domain.Exclusion) (domain.Exclusion, error) {
	v.ID = ID()
	_, err := s.pool.Exec(ctx, "INSERT INTO exclusions VALUES($1,$2,$3,$4)", v.ID, v.GroupID, v.Kind, strings.TrimRight(v.Target, "/"))
	return v, mapped(err)
}
func (s *Store) DeleteExclusion(ctx context.Context, id string) error {
	return affected(s.pool.Exec(ctx, "DELETE FROM exclusions WHERE id=$1", id))
}

const suggestionColumns = `s.id,s.track_id,s.field,s.value,s.source,s.status,coalesce(t.overrides->>'title',t.title),coalesce(t.overrides->>s.field,jsonb_build_object('title',t.title,'artist',t.artist,'album',t.album,'albumArtist',t.album_artist,'year',t.year,'genre',t.genre,'number',t.number,'disc',t.disc,'artwork',t.art_path)->>s.field,'')`

func readSuggestion(row pgx.Row) (domain.Suggestion, error) {
	var v domain.Suggestion
	err := row.Scan(&v.ID, &v.TrackID, &v.Field, &v.Value, &v.Source, &v.Status, &v.Title, &v.Current)
	return v, mapped(err)
}
func (s *Store) Suggestion(ctx context.Context, id string) (domain.Suggestion, error) {
	return readSuggestion(s.pool.QueryRow(ctx, "SELECT "+suggestionColumns+" FROM suggestions s JOIN tracks t ON t.id=s.track_id WHERE s.id=$1", id))
}
func (s *Store) Suggestions(ctx context.Context, limit, offset int) ([]domain.Suggestion, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+suggestionColumns+" FROM suggestions s JOIN tracks t ON t.id=s.track_id WHERE s.status='pending' ORDER BY s.created,s.id LIMIT $1 OFFSET $2", limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Suggestion{}
	for rows.Next() {
		v, err := readSuggestion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) ResolveSuggestion(ctx context.Context, id string, accept bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var track, field, value string
	err = tx.QueryRow(ctx, "SELECT track_id,field,value FROM suggestions WHERE id=$1 AND status='pending' FOR UPDATE", id).Scan(&track, &field, &value)
	if err != nil {
		return mapped(err)
	}
	status := "dismissed"
	if accept {
		status = "accepted"
		if _, err = tx.Exec(ctx, "UPDATE tracks SET overrides=jsonb_set(overrides,ARRAY[$2]::text[],to_jsonb($3::text)) WHERE id=$1", track, field, value); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE suggestions SET status=$2 WHERE id=$1", id, status); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) ClearOverride(ctx context.Context, id, field string) error {
	return affected(s.pool.Exec(ctx, "UPDATE tracks SET overrides=overrides-$2 WHERE id=$1", id, field))
}

// AcceptSuggestions applies one snapshot of all pending changes in the selected
// fields, including unpaged rows. Newest suggestions win conflicting values.
func (s *Store) AcceptSuggestions(ctx context.Context, fields []string) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,track_id FROM suggestions WHERE status='pending' AND field=ANY($1) ORDER BY track_id,field,created,id FOR UPDATE`, fields)
	if err != nil {
		return 0, err
	}
	ids, tracks := []string{}, []string{}
	for rows.Next() {
		var id, track string
		if err = rows.Scan(&id, &track); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
		tracks = append(tracks, track)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	// Stable track lock order also serializes concurrent single-field acceptance.
	if _, err = tx.Exec(ctx, `SELECT id FROM tracks WHERE id=ANY($1) ORDER BY id FOR UPDATE`, tracks); err != nil {
		return 0, err
	}
	if _, err = tx.Exec(ctx, `WITH latest AS (
	 SELECT DISTINCT ON(track_id,field) track_id,field,value FROM suggestions
	 WHERE id=ANY($1) ORDER BY track_id,field,created DESC,id DESC
	), changes AS (SELECT track_id,jsonb_object_agg(field,value) AS values FROM latest GROUP BY track_id)
	UPDATE tracks t SET overrides=t.overrides||changes.values FROM changes WHERE t.id=changes.track_id`, ids); err != nil {
		return 0, err
	}
	tag, err := tx.Exec(ctx, `UPDATE suggestions SET status='accepted' WHERE id=ANY($1)`, ids)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
func (s *Store) Settings(ctx context.Context) (map[string]bool, error) {
	var b bool
	err := s.pool.QueryRow(ctx, "SELECT enabled FROM settings WHERE key='enrichment'").Scan(&b)
	return map[string]bool{"enrichment": b}, err
}
func (s *Store) SetEnrichment(ctx context.Context, b bool) error {
	_, err := s.pool.Exec(ctx, "UPDATE settings SET enabled=$1 WHERE key='enrichment'", b)
	return err
}

func (s *Store) ArtistProfile(ctx context.Context, artist string) (domain.ArtistProfile, error) {
	var data []byte
	var profile domain.ArtistProfile
	err := s.pool.QueryRow(ctx, "SELECT profile FROM artist_profiles WHERE artist=$1", artist).Scan(&data)
	if err != nil {
		return profile, mapped(err)
	}
	err = json.Unmarshal(data, &profile)
	return profile, err
}
func (s *Store) SaveArtistProfile(ctx context.Context, artist string, profile domain.ArtistProfile) error {
	data, err := json.Marshal(profile)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO artist_profiles(artist,profile) VALUES($1,$2) ON CONFLICT(artist) DO UPDATE SET profile=excluded.profile", artist, data)
	return err
}
