import { json } from '../lib/json.js';
import { corsHeaders, sjekkOpprinnelse } from '../lib/cors.js';
import { requireSession } from '../lib/session.js';
import { sjekkOgTellIp } from '../lib/ratelimit.js';

// Forket fra Bondøyas routes/ki.js. Kaller Rammes EGEN, uavhengig utrullede
// worker/ki-proxy (se arkitektur.md ADR 3) — ALDRI ki.bondoya.no.
//
// OPPDATERT 2026-08-28 — REELL PRODUKSJONSFEIL FUNNET VED FAKTISK TESTING:
// et vanlig fetch(env.KI_PROXY_URL) mot ki-proxyens *.workers.dev-URL ga
// konsekvent 404 (Cloudflares egen "ingen Worker her"-side) når kallet kom
// FRA en annen Worker i samme konto, selv om nøyaktig samme URL svarer
// riktig for en vanlig ekstern klient (kjent Cloudflare-begrensning:
// Worker-til-Worker-fetch mot en annen *.workers.dev-URL innad i samme
// konto er upålitelig). Byttet til en Service Binding (env.KI_PROXY, se
// wrangler.toml) — ruter direkte internt i Cloudflares nettverk, ingen
// DNS/internett involvert. KI_PROXY_URL-variabelen er fjernet.
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

  if (!env.KI_PROXY) {
    return json({ error: 'KI-gjenkjenning er ikke satt opp (KI_PROXY-binding mangler).' }, 500, cors);
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

  // env.KI_PROXY.fetch() — Service Binding, ikke et vanlig nettverkskall
  // (se toppkommentaren). URL-en i Request-objektet spiller ingen rolle for
  // ruting her (bindingen går rett til worker/ki-proxy uansett sti), men en
  // ekte URL kreves av Request-konstruktøren.
  let kiRes;
  try {
    kiRes = await env.KI_PROXY.fetch('https://ramme-ki-proxy.internal/', {
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
