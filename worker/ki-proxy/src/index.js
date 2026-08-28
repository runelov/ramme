// worker/ki-proxy/src/index.js — Ramme
//
// Forket fra Bondøyas worker/ki-proxy/src/index.js SOM EN EGEN, UAVHENGIG
// KOPI (arkitektur.md ADR 3) — IKKE en delt ressurs med Bondøya. Egen
// Cloudflare-utrulling, egen ANTHROPIC_API_KEY-hemmelighet, egen
// APP_SHARED_SECRET, egen *.workers.dev-subdomene (ikke et kjøpt domene, se
// ADR 2). En fremtidig endring i Bondøyas prompt/artsutvalg overføres IKKE
// automatisk hit — vurder eksplisitt per endring.
//
// Kontrakt appen (js/ki-client.js) forventer:
//   POST multipart/form-data: bilde=<fil>, kandidater=<JSON-array>
//   Header: X-App-Secret: <delt hemmelighet>
//   -> 200 { kandidater: [ { norsk, latinsk, artstype, taxonId, konfidens, saertrekk }, ... ] }
// taxonId ER ENDRET FRA BONDØYA (v0.1.3, se losOppManglendeTaxonId() under
// og CHANGELOG.md) — Bondøyas kontrakt har bevisst ALDRI taxonId på
// KI-kandidater (ren bildegjenkjenning, badges er der en bonusfunksjon).
// Ramme løser den opp server-side her i stedet, siden badges er selve
// poenget med appen — taxonId kan fortsatt mangle (feltet er `undefined`,
// ikke `null`) hvis Artskart-oppslaget ikke gir noe treff.
//
// HYBRID (Claude vision + Artsorakel/Artsdatabanken-Naturalis parallelt) er
// forket UENDRET i STRUKTUR fra Bondøya — se der for hele
// benchmark-begrunnelsen (Artsorakel slår Claude klart utenom
// pattedyr/sjøpattedyr). Kun stedsbeskrivelsen i Claude-prompten og
// "application"-feltet sendt til Artsorakel er oppdatert til Ramme.
// ARTSORAKEL_ENDPOINT/ARTSORAKEL_TOKEN er valgfrie — uten dem hopper
// Workeren over Artsorakel og kjører ren Claude, se hentArtsorakelKandidater().

const ARTSKART_API = 'https://artskart.artsdatabanken.no/publicapi/api';

// Pattedyr-artstyper Artsorakel taper klart på i Bondøyas benchmark — samme
// datadrevne fallback-regel forket uendret (ikke re-benchmarket for Rammes
// artsutvalg, men ingen grunn til å tro dette er stedsavhengig).
const PATTEDYR_ARTSTYPER = new Set(['pattedyr', 'sjøpattedyr']);

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Kun POST støttes.' }, 405, cors);
    }

    if (!env.APP_SHARED_SECRET) {
      return json({ error: 'Workeren er ikke satt opp riktig: APP_SHARED_SECRET mangler. Sett den med "wrangler secret put APP_SHARED_SECRET".' }, 500, cors);
    }
    if (!timingSafeEqual(request.headers.get('X-App-Secret') || '', env.APP_SHARED_SECRET)) {
      return json({ error: 'Ugyldig eller manglende X-App-Secret.' }, 401, cors);
    }

    try {
      let form;
      try {
        form = await request.formData();
      } catch (e) {
        return json({ error: 'Kunne ikke lese multipart/form-data.' }, 400, cors);
      }

      const bildeFil = form.get('bilde');
      if (!bildeFil || typeof bildeFil.arrayBuffer !== 'function') {
        return json({ error: 'Mangler feltet "bilde".' }, 400, cors);
      }
      let kandidater = [];
      try {
        kandidater = JSON.parse(form.get('kandidater') || '[]');
      } catch (e) { /* tom liste er greit */ }

      const buf = await bildeFil.arrayBuffer();
      const mediaType = bildeFil.type && bildeFil.type.startsWith('image/') ? bildeFil.type : 'image/jpeg';

      const [claudeResultat, artsorakelResultat] = await Promise.all([
        hentClaudeKandidater(buf, mediaType, kandidater, env),
        hentArtsorakelKandidater(buf, mediaType, env),
      ]);

      if (claudeResultat.feil && (!artsorakelResultat || artsorakelResultat.feil)) {
        return json({ error: claudeResultat.feil }, 502, cors);
      }

      const sammenslatt = await slaSammenKandidater(claudeResultat, artsorakelResultat);
      const endelig = await losOppManglendeTaxonId(sammenslatt);
      return json({ kandidater: endelig }, 200, cors);
    } catch (e) {
      return json({ error: `Uventet feil i KI-proxyen: ${e.message}` }, 500, cors);
    }
  },
};

// ---------- Claude vision ----------

async function hentClaudeKandidater(buf, mediaType, kandidater, env) {
  const base64 = arrayBufferToBase64(buf);
  const prompt = buildPrompt(kandidater);
  const anthropicBody = JSON.stringify({
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  // Anthropic (eller infrastrukturen foran den) svarer av og til med en
  // kort, generisk "error code: 5xx" — forbigående gateway-hikke, ikke en
  // reell feil med kall/nøkkel/bilde. Prøver derfor opptil 2 ganger til på
  // 5xx-feil før vi gir opp (portert uendret fra Bondøya).
  let anthropicRes, lastErrText, lastStatus;
  for (let forsok = 1; forsok <= 3; forsok++) {
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: anthropicBody,
      });
    } catch (e) {
      if (forsok === 3) return { feil: `Nettverksfeil mot Anthropic: ${e.message}` };
      continue;
    }
    if (anthropicRes.ok) break;
    lastStatus = anthropicRes.status;
    lastErrText = await anthropicRes.text();
    if (lastStatus < 500 || forsok === 3) {
      return { feil: `KI-kall feilet (${lastStatus}): ${lastErrText}` };
    }
    await new Promise(r => setTimeout(r, forsok * 400));
  }

  let anthropicData;
  try {
    anthropicData = await anthropicRes.json();
  } catch (e) {
    return { feil: `Kunne ikke tolke Anthropic sitt svar som JSON: ${e.message}` };
  }

  const text = (anthropicData.content || []).map(b => b.text || '').join('').trim();
  const parsed = parseModelJson(text);
  if (!parsed) {
    return { feil: 'Kunne ikke tolke KI-svaret som JSON.' };
  }
  return { kandidater: parsed.kandidater || [] };
}

function buildPrompt(kandidater) {
  const kandidatTekst = kandidater.length
    ? kandidater.slice(0, 20).map(k =>
        `- ${k.norsk} (${k.latinsk}), artstype: ${k.artstype}, ${
          k.plausibilitet > 0 ? `observert ${k.plausibilitet} ganger tidligere nær dette stedet` : 'ikke tidligere observert nær dette stedet, men økologisk mulig'
        }`
      ).join('\n')
    : '(ingen stedsspesifikk kandidatliste tilgjengelig)';

  // Stedsbeskrivelsen ER Ramme-spesifikk (ADR 3 sier eksplisitt at en
  // fremtidig Bondøya-promptendring IKKE skal overføres automatisk hit, og
  // omvendt).
  return `Du identifiserer arter (fugl, planter, alger, sopp, sjøpattedyr, fisk, bløtdyr, krepsdyr, \
insekt, edderkoppdyr, krypdyr, amfibium, nesledyr, pigghud, leddorm) fra feltbilder tatt på \
Ramme Fjordhotell/Ramme Gaard ved Hvitsten, Vestby kommune, indre Oslofjord — en fjordhage-/ \
parkeiendom (Havlystparken, gårdsdrift, strandsone), IKKE en isolert kystøy. Et kulturpark-/ \
hagelandskap med løvskog, jordbruksareal og indre-Oslofjord-strandsone.

Lokalt kjente/plausible arter (prioriter disse, men si tydelig fra hvis bildet \
åpenbart viser noe annet):
${kandidatTekst}

Se på bildet og gi 1-3 kandidater, sortert med mest sannsynlige først. Vær ærlig \
om usikkerhet — ikke tving frem en lokal art hvis bildet klart viser noe annet.

For HVER kandidat: skriv ett kort setning (maks ca. 20 ord, på norsk) i "saertrekk" \
om hva du konkret ser i DETTE bildet som peker mot akkurat denne arten — og som \
skiller den fra de andre kandidatene du foreslår (f.eks. nebbform, fargetegning, \
vokseform, størrelsesforhold). Dette vises direkte til brukeren for å hjelpe dem \
velge riktig når du er usikker, så vær konkret og bildespesifikk, ikke en generisk \
artsbeskrivelse.

Svar KUN med gyldig JSON i nøyaktig dette formatet, ingen annen tekst, ingen \
markdown-kodeblokk:
{"kandidater":[{"norsk":"...","latinsk":"...","artstype":"fugl|pattedyr|sjøpattedyr|plante|alge|sopp|fisk|bløtdyr|krepsdyr|insekt|edderkoppdyr|krypdyr|amfibium|nesledyr|pigghud|leddorm|annet","konfidens":0.0,"saertrekk":"..."}]}`;
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) { return null; }
    }
    return null;
  }
}

// ---------- Artsorakel (Artsdatabanken/Naturalis) ----------

async function hentArtsorakelKandidater(buf, mediaType, env) {
  if (!env.ARTSORAKEL_ENDPOINT || !env.ARTSORAKEL_TOKEN) return null;

  const form = new FormData();
  form.append('application', 'Ramme');
  form.append('image', new Blob([buf], { type: mediaType }), 'bilde.jpg');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(env.ARTSORAKEL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ARTSORAKEL_TOKEN}` },
      body: form,
      signal: controller.signal,
    });
    const tekst = await res.text();
    if (!res.ok) return { feil: `Artsorakel svarte ${res.status}: ${tekst.slice(0, 200)}` };
    let data;
    try { data = JSON.parse(tekst); } catch { return { feil: 'Artsorakel svarte med ugyldig JSON.' }; }
    const items = data?.predictions?.[0]?.taxa?.items || [];
    return { kandidater: items.map(i => ({ latinsk: i.scientific_name, sannsynlighet: i.probability || 0 })) };
  } catch (e) {
    return { feil: `Nettverksfeil/timeout mot Artsorakel: ${e.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function losArtsorakelTaxon(latinskNavn) {
  try {
    const res = await fetch(`${ARTSKART_API}/taxon?term=${encodeURIComponent(latinskNavn)}&take=10`);
    if (!res.ok) return null;
    const raa = await res.json();
    const treff = (Array.isArray(raa) ? raa : []).filter(t => t.SubSpecies == null && t.PrefferedPopularname);
    if (treff.length === 0) return null;
    const eksakt = treff.find(t => normNavn(t.ValidScientificName) === normNavn(latinskNavn));
    const t = eksakt || treff[0];
    return { norsk: t.PrefferedPopularname, latinsk: t.ValidScientificName, taxonId: t.TaxonId, artstype: utledArtstypeForTaxon(t) };
  } catch {
    return null;
  }
}

// Trimmet subsett av worker/api/src/lib/taxonomi.js sin utledArtstype() —
// egen, selvstendig kopi (ingen delt kodebase mellom worker/ki-proxy og
// worker/api, samme begrunnelse som Bondøya). Familielisten inkluderer
// 'Phocoenidae' (nise) — se worker/api/src/lib/taxonomi.js sin kommentar
// for hvorfor dette er en Ramme-spesifikk utvidelse.
function utledArtstypeForTaxon(t) {
  if (t.TaxonGroup === 'Fugler') return 'fugl';
  if (t.TaxonGroup === 'Alger') return 'alge';
  if (t.Kingdom === 'Plantae') return 'plante';
  if (t.Kingdom === 'Fungi') return 'sopp';
  if (t.TaxonGroup === 'Fisker') return 'fisk';
  if (t.TaxonGroup === 'Bløtdyr') return 'bløtdyr';
  if (t.TaxonGroup === 'Krepsdyr') return 'krepsdyr';
  if (t.Class === 'Mammalia') {
    const SJOPATTEDYR_FAMILIER = new Set(['Phocidae', 'Otariidae', 'Odobenidae', 'Phocoenidae', 'Balaenopteridae', 'Delphinidae', 'Monodontidae', 'Physeteridae', 'Ziphiidae']);
    return SJOPATTEDYR_FAMILIER.has(t.Family) ? 'sjøpattedyr' : 'pattedyr';
  }
  if (t.Class === 'Insecta') return 'insekt';
  if (t.Class === 'Arachnida') return 'edderkoppdyr';
  if (t.Class === 'Reptilia') return 'krypdyr';
  if (t.Class === 'Amphibia') return 'amfibium';
  if (t.TaxonGroup === 'svamper, nesledyr, kammaneter') return 'nesledyr';
  if (t.TaxonGroup === 'Armfotinger, pigghuder, kappedyr') return 'pigghud';
  if (t.TaxonGroup === 'Leddormer') return 'leddorm';
  return 'annet';
}

function normNavn(s) {
  return (s || '').toLowerCase().replace(/\s+subsp\.?\s+\S+$/, '').replace(/\s+var\.?\s+\S+$/, '').trim();
}

// ---------- Sammenslåing ----------

async function slaSammenKandidater(claudeResultat, artsorakelResultat) {
  const claudeKandidater = claudeResultat.feil ? [] : (claudeResultat.kandidater || []);

  if (!artsorakelResultat || artsorakelResultat.feil || !artsorakelResultat.kandidater?.length) {
    return claudeKandidater;
  }

  const topp3 = artsorakelResultat.kandidater.slice(0, 3);
  const taxa = await Promise.all(topp3.map(k => losArtsorakelTaxon(k.latinsk)));

  const forsteTaxon = taxa[0];
  const usikkerEllerTom = !forsteTaxon;
  const erPattedyr = forsteTaxon && PATTEDYR_ARTSTYPER.has(forsteTaxon.artstype);
  if (usikkerEllerTom || erPattedyr) {
    return claudeKandidater;
  }

  return topp3
    .map((k, i) => {
      const t = taxa[i];
      if (!t) return null;
      return lagArtsorakelKandidat(t, k.sannsynlighet, claudeKandidater);
    })
    .filter(Boolean);
}

function lagArtsorakelKandidat(taxon, sannsynlighet, claudeKandidater) {
  const treff = claudeKandidater.find(c => normNavn(c.latinsk) === normNavn(taxon.latinsk));
  return {
    norsk: taxon.norsk,
    latinsk: taxon.latinsk,
    artstype: taxon.artstype,
    taxonId: taxon.taxonId, // MANGLET her tidligere (v0.1.2 og før) — se losOppManglendeTaxonId()
    konfidens: sannsynlighet,
    saertrekk: treff ? treff.saertrekk : 'Foreslått av Artsorakel — ingen bildespesifikk begrunnelse tilgjengelig.',
  };
}

// Reell bug funnet ved faktisk testing (v0.1.3, se CHANGELOG.md): Claude
// vision gjør ren bildegjenkjenning og oppgir ALDRI en taxonId (samme
// dokumenterte, aksepterte begrensning som i Bondøyas ki-proxy — se der for
// samme kommentar). Uten taxonId kan verken "Oppdageren", Rødlistejeger
// eller en fremtidig Sjeldenhetsjeger-utvidelse noensinne utløses for et
// funn brukeren bare aksepterte KI-forslaget for, uten å bekrefte via
// artssøket separat. Det var en akseptabel begrensning i Bondøya (badges
// er en bonus der) — IKKE akseptabelt i Ramme, der badges er selve
// poenget med appen. Løst her i stedet for i frontend: løs opp taxonId
// server-side for ENHVER kandidat som mangler en (dekker både rene
// Claude-kandidater og Artsorakel-kandidater fra FØR
// lagArtsorakelKandidat()-fiksen over — begge veier er nå dekket), via
// samme Artskart-taxon-oppslag som Artsorakel-stien allerede bruker.
// Fail-open ved oppslagsfeil/ikke-treff: kandidaten beholdes UTEN taxonId
// fremfor å forsvinne — bedre med et forslag brukeren kan velge manuelt
// enn null kandidater.
async function losOppManglendeTaxonId(kandidater) {
  return Promise.all(
    kandidater.map(async (k) => {
      if (k.taxonId) return k;
      const t = await losArtsorakelTaxon(k.latinsk).catch(() => null);
      if (!t) return k;
      // Overstyr Claude sin gjettede artstype med den autoritative
      // taxonomi-utledningen når vi uansett har taxonId nå — samme prinsipp
      // som worker/api/src/lib/taxonomi.js sin server-side-autoritative
      // artstype-utledning fra taxonId ved lagring.
      return { ...k, taxonId: t.taxonId, artstype: t.artstype };
    })
  );
}

// ---------- Delt ----------

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
