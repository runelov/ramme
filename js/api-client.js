// js/api-client.js
// Klient for ramme-api-workeren. Forket fra Bondøyas js/api-client.js, men
// auth-delen er HELT NY (invitasjonskode+kortnavn+PIN, se
// worker/api/src/routes/auth.js) — ikke beOmLenke()/verifiser(). Lokalt
// (127.0.0.1/localhost) pekes det mot `wrangler dev` sin port i stedet for
// produksjons-URL-en.
//
// OPPDATERT 2026-08-28 — sesjonen er IKKE lenger (kun) en cookie. Safari
// (mobil-Safari og standalone-PWA) blokkerer cross-site-cookien (SameSite=
// None) helt, uansett — se worker/api/src/lib/session.js "OPPDATERT
// 2026-08-28" for hele forklaringen. `Authorization: Bearer <token>` er nå
// primær vei: tokenet kommer tilbake i BODY-en fra /auth/registrer (og i
// en X-Sesjon-Token-header på hvert påfølgende kall ved rotasjon), lagres i
// localStorage, og legges på hver forespørsel her i kall(). `credentials:
// 'include'` beholdes uendret — uskadelig, og lar cookien fortsatt fungere
// som sekundærforsøk i nettlesere der den faktisk lagres.
const API_BASE = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787'
  : 'https://ramme-api.bondoya.workers.dev'; // PLACEHOLDER — se README.md

const TOKEN_NOKKEL = 'ramme_sesjon_token';

// localStorage kan kaste (privat nettlesing/full lagring på enkelte
// nettlesere) — appen fungerer da fortsatt, bare uten bearer-token-
// mekanismen (samme risikonivå som cookie-only-varianten hadde uansett).
function hentLagretToken() {
  try { return localStorage.getItem(TOKEN_NOKKEL); } catch { return null; }
}
function lagreToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_NOKKEL, token);
    else localStorage.removeItem(TOKEN_NOKKEL);
  } catch { /* se kommentar over */ }
}

async function kall(sti, opts) {
  const headers = new Headers((opts && opts.headers) || {});
  const token = hentLagretToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${sti}`, { credentials: 'include', ...opts, headers });

  // Sesjonstoken-rotasjon (worker/api/src/index.js) — plukk opp et evt.
  // rullert token på HVERT kall, ikke bare ved innlogging.
  const rullertToken = res.headers.get('X-Sesjon-Token');
  if (rullertToken) lagreToken(rullertToken);

  return res;
}

// leaderboardAktivert mellomlagres her (samme mønster som Bondøyas Fase D) —
// /meg sender det alltid med, uavhengig av innloggingsstatus, se
// worker/api/src/routes/meg.js.
let sisteLeaderboardAktivert = false;
function erLeaderboardAktivert() { return sisteLeaderboardAktivert; }

// Returnerer innlogget bruker ({kortnavn, rolle}), eller null. /meg svarer
// alltid 200 (aldri 401) for "ikke innlogget" — se worker/api/src/routes/meg.js
// for hvorfor (unngår en rød DevTools-konsollfeil for hver appstart).
async function meg() {
  const res = await kall('/meg');
  if (!res.ok) return null;
  const data = await res.json();
  sisteLeaderboardAktivert = !!data.leaderboardAktivert;
  return data.loggedIn ? { kortnavn: data.kortnavn, rolle: data.rolle } : null;
}

// Ett kombinert kall for BÅDE registrering og gjenoppretting — se
// arkitektur.md ADR 11. Serveren avgjør selv hvilket av de to som skjer
// (kortnavn-oppslag), klienten sender alltid de samme tre feltene.
async function registrer(invitasjonskode, kortnavn, pin) {
  const res = await kall('/auth/registrer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invitasjonskode, kortnavn, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Uventet feil (${res.status}).`);
  lagreToken(data.sesjonToken);
  return data;
}

async function loggUt() {
  try {
    await kall('/auth/logg-ut', { method: 'POST' });
  } finally {
    // Lokal utlogging skal alltid lykkes, selv om selve kallet feiler
    // (f.eks. nettverksfeil) — ellers sitter brukeren fast innlogget lokalt.
    lagreToken(null);
  }
}

async function hentFunn() {
  const res = await kall('/funn');
  if (!res.ok) throw new Error(`Kunne ikke hente funn (${res.status}).`);
  return res.json();
}

// entry: {art, artstype, lat, lon, tidspunkt, imageBlob, kiKonfidens?, kiAlternativer?}
async function opprettFunn(entry) {
  const form = new FormData();
  form.append('art_norsk', entry.art.norsk);
  if (entry.art.latinsk) form.append('art_latinsk', entry.art.latinsk);
  if (entry.art.taxonId) form.append('art_taxon_id', String(entry.art.taxonId));
  form.append('artstype', entry.artstype);
  form.append('lat', String(entry.lat));
  form.append('lon', String(entry.lon));
  form.append('tidspunkt', entry.tidspunkt);
  if (entry.kiKonfidens) form.append('ki_konfidens', String(entry.kiKonfidens));
  if (entry.kiAlternativer) form.append('ki_alternativer', JSON.stringify(entry.kiAlternativer));
  if (entry.imageBlob) form.append('bilde', entry.imageBlob, 'funn.jpg');

  const res = await kall('/funn', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Kunne ikke lagre funnet (${res.status}).`);
  return data;
}

async function oppdaterFunn(id, felter) {
  const res = await kall(`/funn/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(felter),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Kunne ikke oppdatere funnet (${res.status}).`);
  return data;
}

async function slettFunn(id) {
  const res = await kall(`/funn/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Kunne ikke slette funnet (${res.status}).`);
  }
}

async function hentBrukere() {
  const res = await kall('/admin/brukere');
  if (!res.ok) throw new Error(`Kunne ikke hente brukerliste (${res.status}).`);
  return res.json();
}

async function settBrukerStatus(id, status) {
  const res = await kall(`/admin/brukere/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Kunne ikke oppdatere bruker (${res.status}).`);
  return data;
}

async function slettBrukerPermanent(id) {
  const res = await kall(`/admin/brukere/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Kunne ikke slette bruker (${res.status}).`);
  return data;
}

async function hentAdminInnstillinger() {
  const res = await kall('/admin/innstillinger');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Kunne ikke hente innstillinger (${res.status}).`);
  return data;
}

async function settAdminInnstillinger(felter) {
  const res = await kall('/admin/innstillinger', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(felter),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Kunne ikke oppdatere innstillinger (${res.status}).`);
  return data;
}

async function hentAdminFremdrift() {
  const res = await kall('/admin/fremdrift');
  if (!res.ok) throw new Error(`Kunne ikke hente fremdrift-oversikt (${res.status}).`);
  return res.json();
}

async function hentFremdrift() {
  const res = await kall('/meg/fremdrift');
  if (!res.ok) throw new Error(`Kunne ikke hente fremdrift (${res.status}).`);
  return res.json();
}

// Leaderboard, se worker/api/src/routes/leaderboard.js. 403 (ikke tom liste)
// hvis admin har skrudd funksjonen av. Returnerer {rangering, kollektiv}.
async function hentLeaderboard() {
  const res = await kall('/leaderboard');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Kunne ikke hente leaderboard (${res.status}).`);
  return data;
}

// Sesjonsbeskyttet KI-gjenkjenning, se worker/api/src/routes/ki.js.
async function gjenkjennArt(imageBlob, kandidater) {
  const form = new FormData();
  form.append('bilde', imageBlob, 'funn.jpg');
  form.append('kandidater', JSON.stringify(kandidater || []));
  const res = await kall('/ki/gjenkjenn', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `KI-gjenkjenning feilet (${res.status}).`);
  return data;
}

// Live søk mot Artsdatabanken via /arter/sok-proxy. Feiler bevisst ikke ved
// nettverksfeil — brukes fra en debouncet input, én mislykket forespørsel
// bør ikke avbryte resten av registreringsflyten.
async function sokArter(term) {
  const res = await kall(`/arter/sok?q=${encodeURIComponent(term)}`);
  if (!res.ok) return [];
  return res.json();
}

// OPPDATERT 2026-08-28: en <img src="...">-tag kan ikke sette en
// Authorization-header, så bearer-tokenet (se toppkommentaren) sendes her
// som ?t=-query-param i stedet — worker/api/src/lib/session.js sin
// hentToken() godtar eksplisitt dette for akkurat denne ruten. Bevisst
// avveining: tokenet kan da havne i URL-baserte logger, akseptert for et
// kortvarig, invitasjonsbeskyttet seminarverktøy (se CHANGELOG.md). Det
// gamle cookie-only-opplegget denne kommentaren tidligere beskrev fungerte
// ikke i praksis — se session.js "OPPDATERT 2026-08-28" for hele historien.
function bildeUrl(id) {
  const token = hentLagretToken();
  return `${API_BASE}/funn/bilde/${id}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
}

window.ApiClient = {
  meg,
  registrer,
  loggUt,
  hentFunn,
  opprettFunn,
  oppdaterFunn,
  slettFunn,
  bildeUrl,
  hentBrukere,
  settBrukerStatus,
  slettBrukerPermanent,
  hentAdminInnstillinger,
  settAdminInnstillinger,
  hentAdminFremdrift,
  hentFremdrift,
  hentLeaderboard,
  erLeaderboardAktivert,
  sokArter,
  gjenkjennArt,
};
