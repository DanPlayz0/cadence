CREATE TABLE users (id text PRIMARY KEY, name text NOT NULL UNIQUE, password text NOT NULL, admin boolean NOT NULL DEFAULT false);
CREATE TABLE sessions (token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf text NOT NULL, expires timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE groups (id text PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE user_groups (user_id text REFERENCES users(id) ON DELETE CASCADE, group_id text REFERENCES groups(id) ON DELETE CASCADE, PRIMARY KEY(user_id,group_id));
CREATE TABLE exclusions (id text PRIMARY KEY, group_id text NOT NULL REFERENCES groups(id) ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('track','album','folder')), target text NOT NULL, UNIQUE(group_id,kind,target));
CREATE TABLE tracks (
 id text PRIMARY KEY, path text NOT NULL UNIQUE, root text NOT NULL, size bigint NOT NULL, modified bigint NOT NULL, seen text NOT NULL, available boolean NOT NULL DEFAULT true,
 title text NOT NULL, artist text NOT NULL, album_artist text NOT NULL, album text NOT NULL, album_id text NOT NULL, number integer NOT NULL, disc integer NOT NULL, year text NOT NULL, genre text NOT NULL,
 duration double precision NOT NULL, codec text NOT NULL, mime text NOT NULL, art_path text NOT NULL DEFAULT '', overrides jsonb NOT NULL DEFAULT '{}',
 search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(overrides->>'title',title)||' '||coalesce(overrides->>'artist',artist)||' '||coalesce(overrides->>'album',album)||' '||coalesce(overrides->>'albumArtist',album_artist))) STORED
);
CREATE INDEX tracks_search ON tracks USING gin(search);
CREATE INDEX tracks_album ON tracks(album_id);
CREATE INDEX tracks_artist ON tracks(artist);
CREATE INDEX tracks_root ON tracks(root);
CREATE INDEX tracks_browse_order ON tracks(lower(coalesce(overrides->>'albumArtist',album_artist)),lower(coalesce(overrides->>'album',album)),disc,number,id) WHERE available;
CREATE INDEX tracks_effective_artist ON tracks(coalesce(overrides->>'artist',artist)) WHERE available;
CREATE TABLE playlists (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL);
CREATE INDEX playlists_owner ON playlists(user_id);
CREATE TABLE playlist_tracks (playlist_id text REFERENCES playlists(id) ON DELETE CASCADE, track_id text REFERENCES tracks(id) ON DELETE CASCADE, position bigint GENERATED ALWAYS AS IDENTITY, PRIMARY KEY(playlist_id,track_id));
CREATE TABLE likes (user_id text REFERENCES users(id) ON DELETE CASCADE, track_id text REFERENCES tracks(id) ON DELETE CASCADE, PRIMARY KEY(user_id,track_id));
CREATE TABLE plays (user_id text REFERENCES users(id) ON DELETE CASCADE, track_id text REFERENCES tracks(id) ON DELETE CASCADE, event_id text NOT NULL, played_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,event_id));
CREATE INDEX plays_recent ON plays(user_id,played_at DESC);
CREATE INDEX plays_track_history ON plays(user_id,track_id,played_at DESC);
CREATE TABLE suggestions (id text PRIMARY KEY, track_id text NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, field text NOT NULL CHECK(field IN ('title','artist','album','albumArtist','year','genre','artwork')), value text NOT NULL, source text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','dismissed')), created timestamptz NOT NULL DEFAULT now(), UNIQUE(track_id,field,value,source));
CREATE INDEX suggestions_pending ON suggestions(status,created);
CREATE TABLE scans (id text PRIMARY KEY, started timestamptz NOT NULL, finished timestamptz, status text NOT NULL, indexed integer NOT NULL DEFAULT 0, errors jsonb NOT NULL DEFAULT '[]');
CREATE TABLE settings (key text PRIMARY KEY, enabled boolean NOT NULL);
INSERT INTO settings VALUES ('enrichment',false);
