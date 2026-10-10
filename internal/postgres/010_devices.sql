-- SPDX-License-Identifier: GPL-2.0-or-later
CREATE TABLE session_devices (
 id text PRIMARY KEY,
 token text NOT NULL UNIQUE REFERENCES sessions(token) ON DELETE CASCADE,
 user_agent text NOT NULL,
 client_version text NOT NULL DEFAULT '',
 last_active timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_devices_activity ON session_devices(last_active DESC);
