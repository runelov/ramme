import artskatalog from '../../../../data/species.json' with { type: 'json' };

// Forket UENDRET fra Bondøya (mekanismen, ikke bare koden — se CLAUDE.md
// "Arvet UENDRET fra Bondøya"). Ramme har IKKE noe offentlig, uinnlogget lag
// (se konsept.md "Bevisste scope-kutt") og ingen admin-UI for å administrere
// skjulte_arter i v1 — funn.synlig_for_public beregnes og lagres likevel,
// billig å beholde for konsistens og for at en eventuell fremtidig
// gjenbruk (offentlig lag, jf. "Engangsverktøy eller gjenbruk?" i
// konsept.md) ikke må gjenoppfinne fail-closed-mekanismen fra bunnen.
const taxonKatalog = new Map(artskatalog.map((a) => [a.taxonId, a]));

function normaliserNavn(navn) {
  return (navn || '').trim().toLowerCase();
}

// Se Bondøyas lib/artsvisibility.js for hele sikkerhetsreview-begrunnelsen:
// et taxonId "teller" kun som bekreftet hvis det finnes i den kuraterte
// artskatalogen OG det innsendte norske navnet samsvarer — alt annet
// behandles som om taxonId mangler (fail-closed).
export function betruaTaxonId(taxonId, artNorsk) {
  if (!taxonId) return null;
  const kjentArt = taxonKatalog.get(taxonId);
  if (!kjentArt) return null;
  if (normaliserNavn(kjentArt.norsk) !== normaliserNavn(artNorsk)) return null;
  return taxonId;
}

// Fail-closed, IKKE fail-open — se Bondøyas begrunnelse. skjulte_arter er en
// tom tabell i v1 (ingen admin-UI for å legge til rader ennå, se CLAUDE.md),
// så dette er i praksis alltid "synlig" for enhver bekreftet, kjent art —
// men mekanismen står klar hvis den trengs.
export async function erSynligForPublic(taxonId, env) {
  if (!taxonId) return false;
  const rad = await env.DB.prepare('SELECT 1 FROM skjulte_arter WHERE taxon_id = ?').bind(taxonId).first();
  return !rad;
}
