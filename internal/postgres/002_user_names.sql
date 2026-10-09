-- Preserve the former login name as the display name before normalizing usernames.
-- Abort atomically if legacy names would collide; never merge or discard accounts.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM users GROUP BY lower(btrim(name)) HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Cannot normalize usernames: existing accounts have names that differ only in case or surrounding spaces. Rename conflicting accounts before upgrading.';
 END IF;
END $$;
ALTER TABLE users ADD COLUMN display_name text;
UPDATE users SET display_name = name;
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE users RENAME COLUMN name TO username;
UPDATE users SET username = lower(btrim(username));
ALTER TABLE users ADD CONSTRAINT users_username_normalized CHECK (username = lower(btrim(username)) AND username <> '');
