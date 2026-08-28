-- Funn (artsobservasjoner). Skjemaet gjenspeiler Bondøyas SLUTTILSTAND
-- (etter migrations 0002/0009/0011/0013/0014/0017 der), konsolidert direkte
-- i én migrasjon her siden Ramme starter som en fresh repo — ingen grunn
-- til å replaye Bondøyas inkrementelle CHECK-constraint-ombygginger for et
-- skjema som er riktig fra dag 1.
CREATE TABLE funn (
  id INTEGER PRIMARY KEY,
  art_norsk TEXT NOT NULL,
  art_latinsk TEXT,
  art_taxon_id INTEGER,
  artstype TEXT NOT NULL CHECK (artstype IN (
    'fugl', 'sjøpattedyr', 'pattedyr', 'plante', 'alge', 'sopp', 'fisk',
    'bløtdyr', 'krepsdyr', 'insekt', 'edderkoppdyr', 'krypdyr', 'amfibium',
    'nesledyr', 'pigghud', 'leddorm', 'annet'
  )),
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  -- ISO 8601 UTC-streng, alltid generert av JS (aldri SQL datetime()) —
  -- trygt å sortere leksikografisk som TEXT siden formatet er konsistent.
  tidspunkt TEXT NOT NULL,
  bilde_r2_key TEXT,
  ki_konfidens REAL NOT NULL DEFAULT 0,
  ki_alternativer TEXT,
  -- Rødlistekategori — samme mekanisme som Bondøya (hentAutoritativArtstype
  -- i lib/taxonomi.js), kun NT/VU/EN/CR lagres.
  rodlistekategori TEXT,
  -- Fail-closed, server-utledet — se lib/artsvisibility.js. Ramme har ingen
  -- offentlig lag som faktisk leser dette feltet i v1, men kolonnen/
  -- beregningen beholdes for konsistens (CLAUDE.md "Arvet UENDRET").
  synlig_for_public INTEGER NOT NULL DEFAULT 1,
  -- Bevisst ingen ON DELETE CASCADE: funn skal bli stående med kortnavnet
  -- når en bruker slettes permanent (kortnavnet scrubbes i stedet, se
  -- routes/admin.js sin slettBrukerPermanent()).
  registrert_av_bruker_id INTEGER NOT NULL REFERENCES brukere(id),
  registrert_av_kortnavn TEXT NOT NULL,
  opprettet TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_funn_bruker ON funn(registrert_av_bruker_id);
