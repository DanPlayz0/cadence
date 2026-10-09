CREATE TABLE playback (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position double precision NOT NULL CHECK (position >= 0 AND position <= 172800),
  revision bigint NOT NULL CHECK (revision > 0),
  writer text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0)
);
