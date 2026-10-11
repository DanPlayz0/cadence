ALTER TABLE playlists DROP CONSTRAINT playlists_icon_check;
ALTER TABLE playlists ADD CONSTRAINT playlists_icon_check
  CHECK (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
