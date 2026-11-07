-- La finestra degli ingressi legge l'ultima rigenerazione del codice a ogni join: niente scansione del registro
CREATE INDEX audit_by_league_action ON audit_events (league_id, action, created_at);
-- Conteggio degli ingressi nella finestra e dei residenti per il limite giornaliero della lega
CREATE INDEX members_by_league_joined ON members (league_id, joined_at);
