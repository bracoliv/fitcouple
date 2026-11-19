CREATE TABLE IF NOT EXISTS rate_windows (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS ai_feedback_users (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);
