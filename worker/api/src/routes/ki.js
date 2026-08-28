import { json } from '../lib/json.js';
import { corsHeaders, sjekkOpprinnelse } from '../lib/cors.js';
import { requireSession } from '../lib/session.js';
import { sjekkOgTellIp } from '../lib/ratelimit.js';

// Forket fra Bondøyas routes/ki.js. KI_PROXY_URL peker mot Rammes EGEN,
// uavhengig utrullede worker/ki-proxy (se arkitektur.md ADR 3) — ALDRI mot
// ki.bondoya.no. Satt via Worker-variabelen KI_PROXY_URL (wrangler.toml
// [vars] eller secret), ikke hardkodet, siden den faktiske *.workers.dev-
// URL-en først finnes etter at ki-proxy-workeren er deployet.
//
// sjekkOpprinnelse() lagt til her (Bondøyas tilsvarende rute har den IKKE
// — Bondøya bruker SameSite=Lax, som gir CSRF-beskyttelse gratis). Ramme
// bruker SameSite=None (ADR 2) og trenger derfor den eksplisitte
// Origin-sjekken på ALLE muterende ruter, ikke bare auth/funn/admin —
// uten den kunne en ondsinnet side CSRF'e denne ruten og bruke opp
// Anthropic-/Artsorakel-kredittene bak KI-proxyen.
const MAKS_KI_PER_IP_TIME = 60;

export async function gjenkjennArt({ request, env }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);

  if (!env.KI_PROXY_URL) {
    return json({ error: 'KI-gjenkjenning er ikke satt opp (KI_PROXY_URL mangler).' }, 500, cors);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'ukjent';
  const ipOk = await sjekkOgTellIp(ip, 'ki-gjenkjenn', MAKS_KI_PER_IP_TIME, env);
  if (!ipOk) return json({ error: 'For mange forespørsler. Prøv igjen senere.' }, 429, cors);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ error: 'Kunne ikke lese bildedata.' }, 400, cors);
  }

  const bildeFil = form.get('bilde');
  if (!bildeFil || typeof bildeFil.arrayBuffer !== 'function') {
    return json({ error: 'Mangler feltet "bilde".' }, 400, cors);
  }
  const kandidater = form.get('kandidater') || '[]';

  const videreForm = new FormData();
  videreForm.append('bilde', bildeFil, 'funn.jpg');
  videreForm.append('kandidater', kandidater);

  let kiRes;
  try {
    kiRes = await fetch(env.KI_PROXY_URL, {
      method: 'POST',
      headers: { 'X-App-Secret': env.KI_PROXY_SHARED_SECRET || '' },
      body: videreForm,
    });
  } catch (e) {
    console.error('Kunne ikke nå KI-proxyen', e);
    return json({ error: 'Kunne ikke nå KI-tjenesten.' }, 502, cors);
  }

  const data = await kiRes.json().catch(() => ({ error: 'Ugyldig svar fra KI-tjenesten.' }));
  return json(data, kiRes.status, cors);
}
