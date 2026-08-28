-- Støttetabell for lib/artsvisibility.js sin fail-closed
-- synlig_for_public-mekanisme — forket UENDRET fra Bondøya (se
-- CLAUDE.md "Arvet UENDRET fra Bondøya"). Ramme har ingen admin-UI for å
-- legge til rader her i v1 (ingen offentlig lag å beskytte ennå) — tabellen
-- er derfor tom fra start og forblir det med mindre den kobles til et
-- fremtidig offentlig lag (se konsept.md "Engangsverktøy eller gjenbruk?").
CREATE TABLE skjulte_arter (
  taxon_id INTEGER PRIMARY KEY,
  visningsnavn TEXT NOT NULL,
  grunn TEXT,
  lagt_til_av_bruker_id INTEGER REFERENCES brukere(id),
  opprettet TEXT NOT NULL DEFAULT (datetime('now'))
);
