import { json } from '../lib/json.js';
import { corsHeaders, sjekkOpprinnelse } from '../lib/cors.js';
import { sha256Hex, timingSafeEqual } from '../lib/crypto.js';
import { sjekkOgTellRegistreringsForsok, sjekkOgTellPinForsok } from '../lib/ratelimit.js';
import { opprettSesjon, sesjonCookieHeader, slettSesjonCookieHeader, slettSesjon } from '../lib/session.js';
import { erGyldigPin, erGyldigKortnavn, normaliserKortnavn, sammenlignPin, avgjorRegistreringUtfall } from '../lib/pin.js';

// HELT NY KODE for Ramme (arkitektur.md ADR 11) — IKKE en fork av Bondøyas
// beOmLenke()/verifiser(), bruker ikke lib/epost.js/lib/turnstile.js i det
// hele tatt. Ett kombinert endepunkt: invitasjonskode + selvvalgt kortnavn +
// selvvalgt PIN. Kortnavn-oppslag avgjør om dette er en NY registrering
// eller en GJENOPPRETTING av en eksisterende konto (samme skjema, se
// lib/pin.js sin avgjorRegistreringUtfall()).
//
// Beslutningslogikken (gyldighetssjekk, kollisjons-/PIN-utfall) er skilt ut
// i lib/pin.js som rene, node:test-dekkede funksjoner — denne filen kobler
// dem mot faktisk D1/KV-I/O, se CLAUDE.md "Test-strategi (fase 6)".

export async function registrer({ request, env }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);

  if (!env.INVITASJONSKODE) {
    console.error('INVITASJONSKODE-secret er ikke satt — se .dev.vars.example.');
    return json({ error: 'Registrering er ikke tilgjengelig akkurat nå.' }, 500, cors);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'ukjent';
  const ipOk = await sjekkOgTellRegistreringsForsok(ip, env);
  if (!ipOk) return json({ error: 'For mange forsøk. Prøv igjen senere.' }, 429, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ugyldig forespørsel.' }, 400, cors);
  }

  const innsendtKode = String(body.invitasjonskode || '');
  if (!timingSafeEqual(innsendtKode, env.INVITASJONSKODE)) {
    return json({ error: 'Ugyldig invitasjonskode.' }, 401, cors);
  }

  const kortnavn = (body.kortnavn || '').trim();
  if (!erGyldigKortnavn(kortnavn)) {
    return json({ error: 'Kortnavn må være mellom 1 og 30 tegn, uten spesialtegn.' }, 400, cors);
  }

  const pin = String(body.pin || '');
  if (!erGyldigPin(pin)) {
    return json({ error: 'PIN må være minst 6 sifre (kun tall).' }, 400, cors);
  }

  const kortnavnNormalisert = normaliserKortnavn(kortnavn);
  const eksisterende = await env.DB.prepare(
    `SELECT id, kortnavn, pin_hash, rolle, status FROM brukere
     WHERE kortnavn_normalisert = ? AND slettet_tidspunkt IS NULL`
  )
    .bind(kortnavnNormalisert)
    .first();

  const kortnavnFinnes = !!eksisterende;

  if (kortnavnFinnes) {
    // Rate-limit PER KORTNAVN — eget nøkkelrom fra IP-grensen over, se ADR 11.
    const pinOk = await sjekkOgTellPinForsok(kortnavnNormalisert, env);
    if (!pinOk) return json({ error: 'For mange forsøk. Prøv igjen senere.' }, 429, cors);

    // En deaktivert konto behandles som "feil PIN" i denne responsen —
    // fail-closed, og lekker ikke at kontoen finnes men er slått av (samme
    // prinsipp som requireSession()s status-sjekk andre steder i appen).
    const pinKorrekt = eksisterende.status === 'aktiv' && (await sammenlignPin(pin, eksisterende.pin_hash));
    const utfall = avgjorRegistreringUtfall({ kortnavnFinnes: true, pinKorrekt });

    if (utfall.utfall === 'avvisTvetydig') {
      return json({ error: utfall.feilmelding }, utfall.statusKode, cors);
    }

    // loggInnEksisterende
    const sesjonToken = await opprettSesjon(eksisterende.id, env);
    return json(
      { kortnavn: eksisterende.kortnavn, rolle: eksisterende.rolle },
      200,
      { 'Set-Cookie': sesjonCookieHeader(sesjonToken), ...cors }
    );
  }

  // opprettNyKonto
  const pinHash = await sha256Hex(pin);
  const rad = await env.DB.prepare(
    `INSERT INTO brukere (kortnavn, kortnavn_normalisert, pin_hash, rolle, status)
     VALUES (?, ?, ?, 'bruker', 'aktiv') RETURNING id, kortnavn, rolle`
  )
    .bind(kortnavn, kortnavnNormalisert, pinHash)
    .first();

  const sesjonToken = await opprettSesjon(rad.id, env);
  return json(
    { kortnavn: rad.kortnavn, rolle: rad.rolle },
    201,
    { 'Set-Cookie': sesjonCookieHeader(sesjonToken), ...cors }
  );
}

export async function loggUt({ request, env }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  await slettSesjon(request, env);
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': slettSesjonCookieHeader(), ...cors },
  });
}
