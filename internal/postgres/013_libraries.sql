CREATE TABLE music_libraries (
 id text PRIMARY KEY,
 name text NOT NULL CHECK (btrim(name) <> ''),
 everyone boolean NOT NULL DEFAULT false
);
CREATE TABLE library_folders (
 library_id text NOT NULL REFERENCES music_libraries(id) ON DELETE CASCADE,
 path text NOT NULL,
 PRIMARY KEY(library_id,path)
);
CREATE TABLE library_users (
 library_id text NOT NULL REFERENCES music_libraries(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(library_id,user_id)
);
CREATE TABLE library_groups (
 library_id text NOT NULL REFERENCES music_libraries(id) ON DELETE CASCADE,
 group_id text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 PRIMARY KEY(library_id,group_id)
);
-- Capture upgrade state before the first setup/login can create an account.
INSERT INTO settings(key,enabled) VALUES
 ('libraries_legacy_pending', EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM tracks)),
 ('libraries_initialized',false);
