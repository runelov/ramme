import { randomToken, sha256Hex } from './crypto.js';

// Forket fra FUNGIFINDERS opprinnelige session.js (SameSite=None-variant,
// fra før FungiFinder selv migrerte til samme domene), IKKE fra Bondøyas
// nåværende SameSite=Lax-variant — se lib/cors.js og arkitektur.md ADR 2.
//
// Sesjons*mekanikken* selv (D1-tabellstruktur, kun hash lagres, grace
// period-rotasjon) er UENDRET fra Bondøya — se arkitektur.md ADR 10. Det som
// er annerledes her er utelukkende cookie-attributtene (SameSite=None i
// stedet for Lax) og at requireSession()/opprettSesjon() ikke er koblet til
// noen magic-link-flyt — se routes/auth.js for den nye inngangen (ADR 11).

const COOKIE_NAVN = 'ramme_sesjon';
const LEVETID_MS = 30 * 24 * 60 * 60 * 1000; // 30 dager — dekker godt et par dagers seminar

// Sesjonstokenet i cookien rulleres periodisk i stedet for å stå fast i hele
// levetiden — begrenser hvor lenge et ev. lekket token forblir gyldig. Se
// Bondøyas worker/api/src/lib/session.js for den fulle race-begrunnelsen
// (portert uendret sammen med resten av mekanikken).
const ROTASJON_INTERVALL_MS = 24 * 60 * 60 * 1000; // 24 timer
const ROTASJON_OVERLAPP_MS = 5 * 60 * 1000; // 5 minutter

export async function opprettSesjon(brukerId, env) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const na = Date.now();
  const utloper = na + LEVETID_MS;
  await env.DB.prepare('INSERT INTO sesjoner (hash, bruker_id, utloper, rullert) VALUES (?, ?, ?, ?)')
    .bind(hash, brukerId, utloper, na)
    .run();
  return token;
}

// SameSite=None (IKKE Lax) — frontend (github.io) og dette API-et
// (workers.dev) er ulike registrerbare domener, se lib/cors.js sin
// sjekkOpprinnelse() for motvekten dette krever på muterende ruter.
// Fortsatt HttpOnly+Secure, host-only (ingen Domain-attributt).
export function sesjonCookieHeader(token, maxAgeSekunder) {
  const maxAge = maxAgeSekunder != null ? Math.max(0, Math.floor(maxAgeSekunder)) : LEVETID_MS / 1000;
  return `${COOKIE_NAVN}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}

export function slettSesjonCookieHeader() {
  return `${COOKIE_NAVN}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
}

// Den delte autorisasjonsfunksjonen — alle beskyttede ruter kaller DENNE,
// aldri en egen kopiert sjekk. Umiddelbar tilbaketrekking ved deaktivering:
// status sjekkes på hver forespørsel, ikke bare ved innlogging (derfor
// sesjonsbasert i D1, ikke JWT).
export async function requireSession(request, env) {
  const token = parseCookie(request.headers.get('Cookie') || '', COOKIE_NAVN);
  if (!token) return null;

  const hash = await sha256Hex(token);
  const na = Date.now();
  // Godtar enten det GJELDENDE tokenet, eller det FORRIGE innenfor
  // rullerings-overlappen (se ROTASJON_OVERLAPP_MS) — dekker klienten som
  // ikke rakk å lagre den nyeste Set-Cookie-en.
  const rad = await env.DB.prepare(
    `SELECT brukere.id, brukere.kortnavn, brukere.rolle, brukere.status
     FROM sesjoner
     JOIN brukere ON brukere.id = sesjoner.bruker_id
     WHERE sesjoner.utloper > ?2 AND (
       sesjoner.hash = ?1
       OR (sesjoner.forrige_hash = ?1 AND sesjoner.forrige_utloper > ?2)
     )`
  )
    .bind(hash, na)
    .first();

  if (!rad || rad.status !== 'aktiv') return null;
  return rad;
}

// Bygger på requireSession() — samme "én delt funksjon"-prinsipp, alle
// admin-ruter kaller DENNE, aldri en egen kopiert rolle-sjekk.
export async function requireAdmin(request, env) {
  const bruker = await requireSession(request, env);
  if (!bruker || bruker.rolle !== 'admin') return null;
  return bruker;
}

// Kalles sentralt fra src/index.js sin fetch()-handler, ETTER at
// router.handle() allerede er ferdig — denne inneværende forespørselen
// autentiseres fortsatt med det GAMLE tokenet (uendret av dette), rullering
// gjelder først NESTE forespørsel. Returnerer null hvis ikke innlogget eller
// sesjonen ikke er moden for rullering ennå (rullert < 24t siden); ellers
// { token, utloper } — index.js bygger en ny Set-Cookie av dette.
export async function rullerSesjonHvisNodvendig(request, env) {
  const gammelToken = parseCookie(request.headers.get('Cookie') || '', COOKIE_NAVN);
  if (!gammelToken) return null;

  const gammelHash = await sha256Hex(gammelToken);
  const nyttToken = randomToken();
  const nyHash = await sha256Hex(nyttToken);
  const na = Date.now();

  // Atomisk: matcher kun en sesjon som fortsatt er gyldig OG moden for
  // rullering i samme UPDATE — unngår en separat les-så-skriv-race mot en
  // samtidig forespørsel som rullerer først. forrige_hash/forrige_utloper
  // lagrer det gamle tokenet med en kort overlappende gyldighet
  // (ROTASJON_OVERLAPP_MS), se requireSession().
  const rad = await env.DB.prepare(
    `UPDATE sesjoner SET hash = ?1, rullert = ?2, forrige_hash = ?3, forrige_utloper = ?2 + ?5
     WHERE hash = ?3 AND utloper > ?2 AND rullert <= ?4
     RETURNING utloper`
  )
    .bind(nyHash, na, gammelHash, na - ROTASJON_INTERVALL_MS, ROTASJON_OVERLAPP_MS)
    .first();

  if (!rad) return null;
  return { token: nyttToken, utloper: rad.utloper };
}

export async function slettSesjon(request, env) {
  const token = parseCookie(request.headers.get('Cookie') || '', COOKIE_NAVN);
  if (!token) return;
  const hash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sesjoner WHERE hash = ?').bind(hash).run();
}

function parseCookie(header, navn) {
  for (const del of header.split(';')) {
    const i = del.indexOf('=');
    if (i === -1) continue;
    if (del.slice(0, i).trim() === navn) return decodeURIComponent(del.slice(i + 1).trim());
  }
  return null;
}
