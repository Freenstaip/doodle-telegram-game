CREATE TABLE IF NOT EXISTS players (
  tg_id TEXT PRIMARY KEY,
  first_name TEXT,
  username TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  gate_after INTEGER NOT NULL,
  max_score INTEGER NOT NULL DEFAULT 0,
  blocked_at INTEGER,
  clicked_at INTEGER,
  registered_at INTEGER,
  registration_payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_created_at ON players(created_at);
CREATE INDEX IF NOT EXISTS idx_players_clicked_at ON players(clicked_at);
CREATE INDEX IF NOT EXISTS idx_players_registered_at ON players(registered_at);
