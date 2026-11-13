CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  feature TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, feature)
);

CREATE TABLE IF NOT EXISTS ai_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS premium_users (
  user_id TEXT PRIMARY KEY,
  granted_day TEXT NOT NULL
);
