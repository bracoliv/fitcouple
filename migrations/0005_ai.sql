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

CREATE TABLE IF NOT EXISTS ai_provider_counts (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  calls INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_micro INTEGER NOT NULL,
  fallbacks INTEGER NOT NULL,
  PRIMARY KEY (day, provider)
);

CREATE TABLE IF NOT EXISTS ai_spend (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  calls INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_micro INTEGER NOT NULL,
  PRIMARY KEY (day, user_id, feature, provider)
);

CREATE TABLE IF NOT EXISTS ai_refusals (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, user_id)
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_controls (
  user_id TEXT PRIMARY KEY,
  paused INTEGER NOT NULL,
  food_photo_cap INTEGER,
  text_log_cap INTEGER,
  recommend_cap INTEGER,
  chat_cap INTEGER
);
