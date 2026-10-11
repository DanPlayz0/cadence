CREATE TABLE sync_accounts (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL,
 username text NOT NULL,
 id text NOT NULL UNIQUE,
 PRIMARY KEY(user_id,provider,username)
);
CREATE TABLE sync_connections (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK (provider IN ('lastfm','listenbrainz')),
 id text NOT NULL UNIQUE,
 username text NOT NULL,
 credential bytea NOT NULL,
 plays boolean NOT NULL DEFAULT true,
 now_playing boolean NOT NULL DEFAULT true,
 likes boolean NOT NULL DEFAULT false,
 paused boolean NOT NULL DEFAULT false,
 error text NOT NULL DEFAULT '',
 last_success timestamptz,
 connected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,provider)
);
CREATE TABLE sync_auth (
 state text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires timestamptz NOT NULL
);
CREATE TABLE sync_listens (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id text NOT NULL,
 track_id text NOT NULL,
 started_at timestamptz NOT NULL,
 heard double precision NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(user_id,event_id)
);
CREATE INDEX sync_listens_history ON sync_listens(user_id,started_at);
CREATE TABLE sync_deliveries (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id text NOT NULL,
 provider text NOT NULL,
 event_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('play','like')),
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 error text NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 revision integer NOT NULL DEFAULT 0,
 next_attempt timestamptz NOT NULL DEFAULT now(),
 created timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,kind,event_id)
);
CREATE INDEX sync_deliveries_pending ON sync_deliveries(next_attempt,created) WHERE status='pending';
CREATE TABLE sync_recordings (
 connection_id text NOT NULL,
 track_id text NOT NULL,
 title text NOT NULL,
 artist text NOT NULL,
 recording_id text NOT NULL,
 PRIMARY KEY(connection_id,track_id,title,artist)
);
CREATE TABLE sync_exports (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 eligible integer NOT NULL,
 previously_sent integer NOT NULL,
 excluded integer NOT NULL
);
CREATE TABLE sync_export_deliveries (
 export_id text NOT NULL REFERENCES sync_exports(id) ON DELETE CASCADE,
 delivery_id text NOT NULL REFERENCES sync_deliveries(id) ON DELETE CASCADE,
 PRIMARY KEY(export_id,delivery_id)
);
