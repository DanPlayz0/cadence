CREATE TABLE soulseek_settings (id boolean PRIMARY KEY DEFAULT true CHECK(id), payload jsonb NOT NULL, managed_shares jsonb NOT NULL DEFAULT '[]');
CREATE TABLE soulseek_searches (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, created timestamptz NOT NULL DEFAULT now());
CREATE TABLE soulseek_requests (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, payload jsonb NOT NULL, revision bigint NOT NULL, created timestamptz NOT NULL DEFAULT now());
CREATE INDEX soulseek_requests_owner ON soulseek_requests(user_id,created DESC);
