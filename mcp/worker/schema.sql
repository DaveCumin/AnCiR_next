-- Durable log of every Worker hit (/build, /edit, /mcp, client_error), so the record outlives
-- Workers Logs' ~7-day retention. Apply once against the D1 database bound as LOGS_DB:
--   npx wrangler d1 execute ancir-nl-logs --remote --file worker/schema.sql
--
-- One row per hit. The stable, queryable fields are columns; anything event-specific (nodes,
-- plots, repaired, intentMet, errors, warnings, sessionSize, …) is kept as JSON in `detail` so
-- new fields never need a migration. NEVER stores the API key or an IP — the Worker's logEvent
-- already omits both, and this writes the same fields.
CREATE TABLE IF NOT EXISTS hits (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	ts         TEXT    NOT NULL,   -- ISO 8601, e.g. 2026-07-19T05:53:53.139Z
	event      TEXT,               -- 'build' | 'edit' | 'mcp_build' | 'client_error'
	outcome    TEXT,               -- 'ok' | 'llm_error' | 'empty_edit' | …
	model      TEXT,
	prompt     TEXT,               -- the natural-language request (full)
	ms         INTEGER,            -- wall-clock the hit took, when known
	session_id TEXT,               -- links to the built session / the log line
	detail     TEXT                -- JSON: every other field from the log event
);

-- Time-ordered reads are the common query ("the last N prompts", "hits since <date>").
CREATE INDEX IF NOT EXISTS idx_hits_ts ON hits (ts);
CREATE INDEX IF NOT EXISTS idx_hits_event ON hits (event);
