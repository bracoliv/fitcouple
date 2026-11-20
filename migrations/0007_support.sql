ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN google_name TEXT;
ALTER TABLE users ADD COLUMN support_note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS gift_codes (
  code TEXT PRIMARY KEY,
  label TEXT,
  created_day TEXT NOT NULL,
  redeem_by TEXT NOT NULL,
  gift_days INTEGER NOT NULL,
  status TEXT NOT NULL,
  redeemed_by TEXT,
  redeemed_at TEXT,
  batch_id TEXT
);

CREATE TABLE IF NOT EXISTS gifts (
  user_id TEXT PRIMARY KEY,
  expires_day TEXT NOT NULL,
  source TEXT NOT NULL,
  code TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
