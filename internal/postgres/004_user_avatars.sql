ALTER TABLE users ADD COLUMN avatar bytea NOT NULL DEFAULT ''::bytea
  CHECK (octet_length(avatar) <= 524288);
ALTER TABLE users ADD COLUMN avatar_version bigint NOT NULL DEFAULT 0;
