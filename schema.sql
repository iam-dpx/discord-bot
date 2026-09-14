-- Server list feature schema
-- Apply with: npx wrangler d1 execute <YOUR_DB_NAME> --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  region TEXT NOT NULL,
  about TEXT NOT NULL,
  invite_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  submitted_by_id TEXT NOT NULL,
  submitted_by_name TEXT NOT NULL,
  approval_message_id TEXT,          -- message id in the approval channel (to edit later)
  public_message_id TEXT,            -- message id in the public channel once approved
  screening_flag TEXT,               -- 'clean' | 'flagged' | 'invalid_invite'
  screening_reason TEXT,             -- short AI-given reason, only set when flagged
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
CREATE INDEX IF NOT EXISTS idx_servers_game ON servers(game_name);

-- One row per user, tracks their last submission time for the cooldown
CREATE TABLE IF NOT EXISTS submission_cooldowns (
  user_id TEXT PRIMARY KEY,
  last_submitted_at INTEGER NOT NULL
);

-- Simple key/value settings table so the cooldown (and other knobs) can be
-- changed later without redeploying code.
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('submit_cooldown_seconds', '300');
