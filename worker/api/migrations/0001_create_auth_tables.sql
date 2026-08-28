-- Autentisering: brukere + sesjoner. INGEN e-post-kolonne og INGEN
-- innloggingstokens-tabell (magic-link) — Ramme bruker invitasjonskode +
-- selvvalgt kortnavn + selvvalgt PIN i stedet, se arkitektur.md ADR 11.
-- Sesjon*mekanikken* (tabellstruktur, kun hash lagres, grace period-
-- rotasjon) er forket UENDRET fra Bondøya, konsolidert direkte til
-- sluttilstanden her (ikke replayet som Bondøyas inkrementelle
-- migrasjonshistorikk 0001->0012, siden Ramme starter som en fresh repo) —
-- se arkitektur.md ADR 10 for hvorfor selve mekanikken er verdt å arve.

CREATE TABLE brukere (
  id INTEGER PRIMARY KEY,
  kortnavn TEXT NOT NULL,
  -- Case-insensitiv unikhet for kollisjons-/gjenopprettingslogikken (ADR 11)
  -- — det synlige kortnavnet (kortnavn-kolonnen) beholder brukerens egen
  -- skrivemåte, kun oppslag skjer mot denne normaliserte kolonnen.
  kortnavn_normalisert TEXT NOT NULL UNIQUE,
  -- SHA-256-hash (lib/crypto.js sitt sha256Hex-mønster) — PIN i klartekst
  -- lagres ALDRI, se sikkerhetssjekkliste-ramme.md.
  pin_hash TEXT NOT NULL,
  rolle TEXT NOT NULL DEFAULT 'bruker' CHECK (rolle IN ('bruker','admin')),
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','deaktivert')),
  slettet_tidspunkt TEXT,
  opprettet TEXT NOT NULL DEFAULT (datetime('now'))
);

-- utloper/rullert/forrige_utloper: unix-epoch MILLISEKUNDER (INTEGER), satt
-- fra Worker (Date.now()) — bevisst ikke SQL datetime()/TEXT, se Bondøyas
-- migrations/0001 for hvorfor (tegnsammenligning av ISO-streng vs.
-- datetime()-streng gir feil resultat).
CREATE TABLE sesjoner (
  hash TEXT PRIMARY KEY,
  bruker_id INTEGER NOT NULL REFERENCES brukere(id) ON DELETE CASCADE,
  utloper INTEGER NOT NULL,
  rullert INTEGER NOT NULL DEFAULT 0,
  forrige_hash TEXT,
  forrige_utloper INTEGER NOT NULL DEFAULT 0,
  opprettet TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sesjoner_bruker ON sesjoner(bruker_id);
