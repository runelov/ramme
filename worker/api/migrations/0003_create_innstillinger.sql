-- Global admin-styrt appkonfigurasjon — generisk nøkkel/verdi-tabell, samme
-- mønster som Bondøyas migrations/0005 (plass til flere fremtidige
-- admin-brytere uten nye migrasjoner).
CREATE TABLE innstillinger (
  nokkel TEXT PRIMARY KEY,
  verdi TEXT NOT NULL
);

-- Leaderboardet skal være PÅ fra dag 1 for Ramme (motsatt av Bondøyas
-- fail-closed AV-som-standard) — se konsept.md "Gamification: byggerekkefølge"
-- punkt 3 og arkitektur.md ADR 5.
INSERT INTO innstillinger (nokkel, verdi) VALUES ('leaderboard_aktivert', '1');
