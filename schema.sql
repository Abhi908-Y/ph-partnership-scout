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
CREATE TABLE IF NOT EXISTS statuses (
  launch_id TEXT PRIMARY KEY,
  status TEXT NOT NULL, -- contacted | replied | partner ("new" = no row)
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contacts (
  launch_id TEXT PRIMARY KEY,
  data JSONB NOT NULL, -- founders' emails/LinkedIn (Hunter), drafts, sent log
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bookmarks (
  launch_id TEXT PRIMARY KEY, -- saved launches are kept after their 7-day window
  created_at TIMESTAMPTZ DEFAULT now()
);
