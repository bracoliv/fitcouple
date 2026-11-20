CREATE TABLE IF NOT EXISTS owner_alerts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (day, kind)
);

CREATE TABLE IF NOT EXISTS ai_failure_counts (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
