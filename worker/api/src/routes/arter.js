import { json } from '../lib/json.js';
import { corsHeaders } from '../lib/cors.js';
import { requireSession } from '../lib/session.js';
import { sjekkOgTellIp } from '../lib/ratelimit.js';
import { utledArtstype, ARTSKART_API } from '../lib/taxonomi.js';

// Forket fra Bondøyas routes/arter.js, TRIMMET til kun søkeproxyen
// (sokArter). Bondøyas artsomtale-system (arter_metadata-tabell +
// Wikipedia-fallback, lib/wikipedia.js) er en bevisst, dokumentert
// forenkling IKKE tatt med for Ramme v1 — se README.md "Bevisste
// forenklinger" for begrunnelsen (lav prioritet for et 1-2 dagers
// engangsseminar, kan legges til senere uten å berøre noe annet).
const MAKS_SOK_PER_IP_TIME = 60;
const MAKS_TREFF = 15;
const HENT_TAKE = 40;

function sorterEtterRelevans(treff, term) {
  const t = term.toLowerCase();
  const rangering = (navn) => {
    const n = navn.toLowerCase();
    if (n === t) return 0;
    if (n.startsWith(t)) return 1;
    return 2;
  };
  return treff.slice().sort((a, b) => {
    const ra = rangering(a.norsk);
    const rb = rangering(b.norsk);
    if (ra !== rb) return ra - rb;
    return a.norsk.length - b.norsk.length;
  });
}

export async function sokArter({ request, env }) {
  const cors = corsHeaders(env);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);

  const term = (new URL(request.url).searchParams.get('q') || '').trim();
  if (term.length < 2) return json([], 200, cors);

  const ip = request.headers.get('CF-Connecting-IP') || 'ukjent';
  const ipOk = await sjekkOgTellIp(ip, 'arter-sok', MAKS_SOK_PER_IP_TIME, env);
  if (!ipOk) return json({ error: 'For mange forespørsler. Prøv igjen senere.' }, 429, cors);

  let raa;
  try {
    const res = await fetch(`${ARTSKART_API}/taxon?term=${encodeURIComponent(term)}&take=${HENT_TAKE}`);
    if (!res.ok) return json({ error: 'Artsdatabanken svarte ikke.' }, 502, cors);
    raa = await res.json();
  } catch (e) {
    console.error(e);
    return json({ error: 'Kunne ikke nå Artsdatabanken.' }, 502, cors);
  }

  const treff = (Array.isArray(raa) ? raa : [])
    .filter((t) => t.SubSpecies == null && t.PrefferedPopularname)
    .map((t) => ({
      norsk: t.PrefferedPopularname,
      latinsk: t.ValidScientificName || '',
      taxonId: t.TaxonId,
      artstype: utledArtstype(t),
    }));

  return json(sorterEtterRelevans(treff, term).slice(0, MAKS_TREFF), 200, cors);
}
