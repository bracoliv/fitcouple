ALTER TABLE users ADD COLUMN program_choice TEXT;
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

CREATE INDEX IF NOT EXISTS idx_duels_team_day ON duels (team_id, day);
