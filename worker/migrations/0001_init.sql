-- Schema iniziale. Il database applica gli stessi vincoli delle primitive di dominio.

CREATE TABLE leagues (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 40),
  join_code TEXT NOT NULL UNIQUE CHECK (length(join_code) = 8),
  daily_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_limit BETWEEN 1 AND 100),
  injury_check_enabled INTEGER NOT NULL DEFAULT 0 CHECK (injury_check_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  -- Ultimo utilizzo (ISO 8601 UTC): dopo 60 giorni senza utilizzo la lega viene cancellata
  last_active_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (length(last_active_at) = 24)
) STRICT;

CREATE INDEX leagues_by_last_active ON leagues (last_active_at);

CREATE TABLE league_secrets (
  league_id TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  api_key_key_version INTEGER NOT NULL CHECK (api_key_key_version >= 1),
  api_key_updated_at TEXT NOT NULL,
  admin_password_hash TEXT NOT NULL,
  admin_password_updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE rulebooks (
  league_id TEXT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 200 AND 150000),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE members (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 24),
  name_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version >= 1),
  joined_at TEXT NOT NULL,
  removed_at TEXT,
  CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CHECK (role = 'member' OR status = 'active')
) STRICT;

CREATE UNIQUE INDEX members_active_name ON members (league_id, name_key) WHERE status = 'active';
CREATE UNIQUE INDEX members_one_admin ON members (league_id) WHERE role = 'admin';
CREATE INDEX members_by_league ON members (league_id, status);

CREATE TABLE daily_usage (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK (length(day) = 10),
  count INTEGER NOT NULL CHECK (count BETWEEN 0 AND 100),
  PRIMARY KEY (member_id, day)
) STRICT;

CREATE TABLE monthly_usage (
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (length(month) = 7),
  questions INTEGER NOT NULL CHECK (questions >= 0),
  PRIMARY KEY (league_id, month)
) STRICT;

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  actor_member_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'league_created', 'rulebook_updated', 'api_key_updated', 'settings_updated',
    'join_code_regenerated', 'member_joined', 'member_removed',
    'admin_login', 'admin_password_changed'
  )),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_by_league ON audit_events (league_id, created_at);
