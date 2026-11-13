CREATE TABLE IF NOT EXISTS vouchers (
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

CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers (user_id);
