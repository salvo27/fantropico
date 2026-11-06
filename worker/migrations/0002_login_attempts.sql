-- Tentativi di accesso admin (login e verifica della password attuale), contati in modo atomico.
-- subject: "ip:<hash>" oppure "league:<uuid>"; window_start: inizio della finestra in secondi epoch.

CREATE TABLE login_attempts (
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 4 AND 80),
  window_start INTEGER NOT NULL CHECK (window_start >= 0),
  count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 1000),
  PRIMARY KEY (subject, window_start)
) STRICT;

CREATE INDEX login_attempts_by_window ON login_attempts (window_start);
