-- Server list feature schema
-- Apply with: npx wrangler d1 execute <YOUR_DB_NAME> --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  region TEXT NOT NULL,
  about TEXT NOT NULL,
  invite_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected (revoked rows are deleted, not flagged)
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

-- One key/value settings table so the cooldown (and other knobs) can be
-- changed later without redeploying code.
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('submit_cooldown_seconds', '300');

-- Reference list of game names, purely to seed the /addserver autocomplete
-- with sensible suggestions before anyone has submitted anything for that
-- game yet. Autocomplete also searches already-submitted games (see
-- src/serverlist/gameNames.js), so this isn't a hard restriction — someone
-- can still type a game not on this list.
CREATE TABLE IF NOT EXISTS known_games (
  name TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO known_games (name) VALUES
  -- Popular MOBA / mobile SEA titles
  ('Mobile Legends: Bang Bang'),
  ('Arena of Valor'),
  ('Free Fire'),
  ('PUBG Mobile'),
  ('Call of Duty: Mobile'),
  ('Point Blank'),
  ('CrossFire'),
  ('Rules of Survival'),
  ('League of Legends'),
  ('League of Legends: Wild Rift'),
  ('Valorant'),
  ('Dota 2'),
  ('Counter-Strike 2'),
  -- Sandbox / roleplay, strong private-server culture
  ('Minecraft'),
  ('Roblox'),
  ('Growtopia'),
  ('GTA V FiveM'),
  ('GTA San Andreas Multiplayer (SA-MP)'),
  ('Garry''s Mod'),
  -- Classic MMORPGs with a long private-server history in SEA
  ('Ragnarok Online'),
  ('Ragnarok Online 2'),
  ('Ragnarok M: Eternal Love'),
  ('Ragnarok X: Next Generation'),
  ('Ragnarok Origin'),
  ('Ragnarok V: Returns'),
  ('Dragon Nest'),
  ('Dragon Nest SEA'),
  ('Dragon Nest Europe'),
  ('Dragon Nest M'),
  ('Dragon Nest 2: Evolution'),
  ('Dragon Nest R'),
  ('MU Online'),
  ('Cabal Online'),
  ('Rohan Online'),
  ('Lineage II'),
  ('Perfect World'),
  ('Silkroad Online'),
  ('Priston Tale'),
  ('Grand Fantasia'),
  ('Metin2'),
  -- Gacha / open world
  ('Genshin Impact'),
  ('Honkai: Star Rail'),
  ('Honkai Impact 3rd'),
  ('Zenless Zone Zero'),
  ('Tower of Fantasy'),
  -- Other popular titles
  ('Clash of Clans'),
  ('Clash Royale'),
  ('Stumble Guys'),
  ('Identity V'),
  ('eFootball'),
  ('EA Sports FC Mobile'),
  ('Lost Ark'),
  ('Black Desert Online'),
  ('Undawn');

-- ===== Idle Miner game feature =====
CREATE TABLE IF NOT EXISTS players (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  gems INTEGER NOT NULL DEFAULT 0,
  shards INTEGER NOT NULL DEFAULT 0,
  prestige_tokens INTEGER NOT NULL DEFAULT 0,
  pickaxe_tier INTEGER NOT NULL DEFAULT 0,
  backpack_tier INTEGER NOT NULL DEFAULT 0,
  backpack_blocks INTEGER NOT NULL DEFAULT 0,
  total_blocks_mined INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  rebirths INTEGER NOT NULL DEFAULT 0,
  prestiges INTEGER NOT NULL DEFAULT 0,
  last_collected_at INTEGER NOT NULL DEFAULT 0,
  last_daily_at INTEGER NOT NULL DEFAULT 0,
  last_weekly_at INTEGER NOT NULL DEFAULT 0,
  last_monthly_at INTEGER NOT NULL DEFAULT 0,
  last_hunt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS player_pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pet_key TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  obtained_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_pets_owner ON player_pets (guild_id, user_id);

CREATE TABLE IF NOT EXISTS player_boosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  booster_type TEXT NOT NULL,
  multiplier REAL NOT NULL,
  expires_at INTEGER NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_boosters_owner ON player_boosters (guild_id, user_id, expires_at);

CREATE TABLE IF NOT EXISTS global_boosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  multiplier REAL NOT NULL,
  expires_at INTEGER NOT NULL,
  label TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_global_boosters_guild ON global_boosters (guild_id, expires_at);

CREATE TABLE IF NOT EXISTS player_crates (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  crate_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, crate_type)
);

-- ===== Idle Miner v2: passive income model + mine minigame =====
-- Renamed concepts (backpack_blocks -> materials, total_blocks_mined -> xp)
-- and a new cooldown column for the /mine minigame. ALTER TABLE ADD COLUMN
-- is safe to re-run only once per column — if you already applied this,
-- skip re-running this block (D1/SQLite has no IF NOT EXISTS for columns).
ALTER TABLE players ADD COLUMN materials INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_mine_click_at INTEGER NOT NULL DEFAULT 0;
-- Old columns (backpack_blocks, total_blocks_mined) are left in place,
-- unused, rather than dropped — SQLite ALTER TABLE DROP COLUMN support in
-- D1 is limited, and leaving them costs nothing.

-- ===== Idle Miner v3: real Size/Miner/Workers upgrade model =====
CREATE TABLE IF NOT EXISTS player_upgrades (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  upgrade_key TEXT NOT NULL,   -- 'size' | 'miner' | 'workers'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, upgrade_key)
);

-- ===== Idle Miner v6: pet shards + corporations =====
-- ALTER TABLE ADD COLUMN is safe to re-run only once — skip if already applied.
ALTER TABLE players ADD COLUMN pet_shards INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS corporations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  leader_id TEXT NOT NULL,
  bank_coins INTEGER NOT NULL DEFAULT 0,
  bank_gems INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_corp_name ON corporations (guild_id, name);

CREATE TABLE IF NOT EXISTS corp_members (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  corp_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'leader' | 'member'
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_corp_members_corp ON corp_members (corp_id);

-- ===== Idle Miner v7: crate/booster reward system =====
-- player_crates (above) already tracks HOW MANY of each crate type a player
-- owns — it existed in the schema but nothing wrote to it until now.
-- This adds the matching table for UNACTIVATED boosters pulled from crates.
-- player_boosters (above) only ever holds ACTIVE, ticking boosters (it has
-- a real expires_at). A booster earned from a crate sits here first — as
-- inventory, doing nothing — until the player taps "Activate" in /booster,
-- at which point a row gets inserted into player_boosters with a real
-- expires_at and this row's quantity goes down by 1.
-- Each row is ONE distinct (multiplier, duration) combo a player has
-- rolled from a crate and not yet activated — quantity only goes above 1
-- if they roll that exact combo again. See rollBooster() in
-- src/game/data.ts for how multiplier/duration_minutes get picked.
CREATE TABLE IF NOT EXISTS player_booster_items (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  multiplier REAL NOT NULL,
  duration_minutes INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, multiplier, duration_minutes)
);
