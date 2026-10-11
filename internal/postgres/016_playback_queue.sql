ALTER TABLE playback ADD COLUMN queue jsonb;
ALTER TABLE playback ALTER COLUMN track_id DROP NOT NULL;
ALTER TABLE playback DROP CONSTRAINT playback_track_id_fkey;
ALTER TABLE playback ADD CONSTRAINT playback_track_id_fkey
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL;
