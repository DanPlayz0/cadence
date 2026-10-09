ALTER TABLE playlists ADD COLUMN icon text NOT NULL DEFAULT 'music'
  CHECK (icon IN ('music', 'heart', 'headphones', 'disc', 'sparkles', 'moon'));
