-- Optional: the app creates these tables automatically on first request.
-- Run this in the Neon SQL Editor if you prefer to create them up front.
CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  launched_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notes (
  launch_id TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
