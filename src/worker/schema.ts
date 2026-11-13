// Kept identical to migrations/0001_init.sql. The test fails if they drift.
export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  streak INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  strength INTEGER NOT NULL DEFAULT 1,
  discipline INTEGER NOT NULL DEFAULT 1,
  health INTEGER NOT NULL DEFAULT 1,
  mind INTEGER NOT NULL DEFAULT 1,
  difficulty TEXT NOT NULL DEFAULT 'normal',
  program_start TEXT,
  team_id TEXT,
  rank INTEGER,
  flagged INTEGER NOT NULL DEFAULT 0,
  flag_codes TEXT,
  burst_start INTEGER,
  burst_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  created_day TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  PRIMARY KEY (user_id, day, quest_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  xp INTEGER NOT NULL,
  level INTEGER NOT NULL,
  streak INTEGER NOT NULL,
  strength INTEGER NOT NULL,
  discipline INTEGER NOT NULL,
  health INTEGER NOT NULL,
  mind INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_users_team ON users (team_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_day ON snapshots (day);`;

export const PHASE2_SQL = `ALTER TABLE users ADD COLUMN program_choice TEXT;
ALTER TABLE users ADD COLUMN duel_wins INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  day TEXT NOT NULL,
  status TEXT NOT NULL,
  winner_id TEXT,
  created_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_duels_team_day ON duels (team_id, day);`;

export const VOUCHER_SQL = `CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  milestone TEXT NOT NULL,
  value INTEGER NOT NULL,
  status TEXT NOT NULL,
  issued_day TEXT NOT NULL,
  expires_day TEXT NOT NULL,
  redeemed_day TEXT,
  UNIQUE (user_id, milestone)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers (user_id);`;

export const STORE_SQL = `CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  blurb TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  shopee_url TEXT NOT NULL,
  suggest TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  gateway TEXT NOT NULL,
  provider_ref TEXT,
  created_day TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);`;
