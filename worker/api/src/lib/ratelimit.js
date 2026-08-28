// Gjenbruker Bondøyas Workers KV-mønster for rate-limiting (samme
// mekanisme), men beslutningslogikken er skilt ut i en ren, testbar
// funksjon (vurderRateLimitVindu) — se CLAUDE.md "Test-strategi (fase 6)":
// "implementasjonen [må skille] beslutningslogikken fra selve I/O-et" for
// at rate-limit-telleren skal kunne node:test-dekkes uten faktisk Workers
// KV. Se test/lib/ratelimit.test.js.
//
// Merk: Workers KV er eventually consistent (skriving kan ta opptil ~60 sek
// å nå alle edge-noder) — to raske forespørsler mot ulike POP-er kan i
// teorien begge lese en gammel telling og begge slippe gjennom. Akseptabel
// restrisiko på denne skalaen (15-20 brukere), samme vurdering som Bondøya
// gjorde for sin egen rate-limiting.

const TIME_WINDOW_MS = 60 * 60 * 1000; // 1 time — felles vindusstørrelse for begge nøkkelrom under

// ---------- Ren beslutningsfunksjon (testbar uten KV) ----------
//
// tilstand: { antall, vindusStart } — antall forsøk i INNEVÆRENDE vindu, og
// når vinduet startet (unix-epoch millisekunder). Første gang for en nøkkel:
// { antall: 0, vindusStart: 0 }.
// na: Date.now() (injisert, ikke lest direkte — gjør funksjonen ren/testbar).
// maksAntall: terskel for vinduet (5 for pinforsok, 20 for regforsok).
// vindusMs: vindusstørrelse i millisekunder (TIME_WINDOW_MS i praksis).
//
// Returnerer { tillatt, nyTilstand } — kalleren (sjekkOgTellRateLimit under)
// skriver nyTilstand tilbake til KV kun når tillatt er true ELLER vinduet
// faktisk ble resatt (se der for hvorfor "avvist" fortsatt kan trenge en
// skriving i sjeldne tilfeller — i praksis: nei, se kommentaren der).
export function vurderRateLimitVindu(tilstand, na, maksAntall, vindusMs) {
  const gjeldende = tilstand || { antall: 0, vindusStart: 0 };
  const vindusUtlopt = na - gjeldende.vindusStart >= vindusMs;

  if (vindusUtlopt) {
    // Nytt vindu — forsøk nr. 1 telles med det samme, alltid tillatt
    // (maksAntall er uansett >= 1 i praksis).
    return { tillatt: true, nyTilstand: { antall: 1, vindusStart: na } };
  }

  if (gjeldende.antall >= maksAntall) {
    return { tillatt: false, nyTilstand: gjeldende };
  }

  return { tillatt: true, nyTilstand: { antall: gjeldende.antall + 1, vindusStart: gjeldende.vindusStart } };
}

// ---------- KV-I/O rundt beslutningsfunksjonen ----------

async function lesTilstand(env, key) {
  const raw = await env.RATE_LIMIT.get(key);
  return raw ? JSON.parse(raw) : { antall: 0, vindusStart: 0 };
}

async function sjekkOgTellRateLimit(env, key, maksAntall, vindusMs) {
  const tilstand = await lesTilstand(env, key);
  const { tillatt, nyTilstand } = vurderRateLimitVindu(tilstand, Date.now(), maksAntall, vindusMs);
  // Skriv alltid tilbake ved tillatelse (telleren økte, eller vinduet ble
  // resatt) — ved avvisning er tilstanden uendret, ingen ny skriving
  // nødvendig (sparer en KV-skriving per avvist forsøk).
  if (tillatt) {
    await env.RATE_LIMIT.put(key, JSON.stringify(nyTilstand), { expirationTtl: Math.ceil(vindusMs / 1000) });
  }
  return tillatt;
}

// PIN-forsøk: maks 5/kortnavn/time — se arkitektur.md ADR 11 for
// begrunnelsen for tallet (6-sifret PIN, 1 000 000 kombinasjoner).
// Nøkkelrom `pinforsok:<kortnavn>`, ADSKILT fra registreringsforsøk under.
const PIN_FORSOK_MAKS = 5;
export async function sjekkOgTellPinForsok(kortnavnNormalisert, env) {
  return sjekkOgTellRateLimit(env, `pinforsok:${kortnavnNormalisert}`, PIN_FORSOK_MAKS, TIME_WINDOW_MS);
}

// Registreringsendepunktet: maks 20 forsøk/IP/time — beskytter mot at noen
// prøver å gjette selve invitasjonskoden, uavhengig av kortnavn. Nøkkelrom
// `regforsok:<ip>`, ADSKILT fra PIN-forsøk over (se ADR 11).
const REG_FORSOK_MAKS = 20;
export async function sjekkOgTellRegistreringsForsok(ip, env) {
  return sjekkOgTellRateLimit(env, `regforsok:${ip}`, REG_FORSOK_MAKS, TIME_WINDOW_MS);
}

// Generisk per-IP-teller for andre endepunkter (artssøk, KI-gjenkjenning) —
// portert uendret fra Bondøyas lib/ratelimit.js sin sjekkOgTellIp(), samme
// enkle fast-vindu-KV-mønster (ikke migrert til vurderRateLimitVindu(), som
// kun de to nye, sikkerhetskritiske nøkkelrommene over krever eksplisitt
// testdekning for).
export async function sjekkOgTellIp(ip, formal, maks, env) {
  const key = `rl:ip:${formal}:${ip}`;
  const data = await lesTellingLegacy(env, key);
  if (data.antall >= maks) return false;
  await env.RATE_LIMIT.put(
    key,
    JSON.stringify({ antall: data.antall + 1, sisteForsok: Date.now() }),
    { expirationTtl: Math.ceil(TIME_WINDOW_MS / 1000) }
  );
  return true;
}

async function lesTellingLegacy(env, key) {
  const raw = await env.RATE_LIMIT.get(key);
  return raw ? JSON.parse(raw) : { antall: 0, sisteForsok: 0 };
}
