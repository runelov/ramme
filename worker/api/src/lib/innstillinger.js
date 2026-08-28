// Trimmet fra Bondøya: Ramme har ingen offentlig lag, så
// funn_synlig_for_public-innstillingen (Bondøyas equivalent) finnes ikke
// her — kun leaderboard-bryteren, se konsept.md/arkitektur.md ADR 5.
// Generisk nøkkel/verdi-tabell (migrations/0003) beholdes likevel, samme
// begrunnelse som Bondøya: plass til flere fremtidige admin-brytere uten
// nye migrasjoner.
const NOKKEL_LEADERBOARD_AKTIVERT = 'leaderboard_aktivert';

// Fail-closed dersom raden mangler — samme prinsipp som lib/artsvisibility.js:
// ukjent tilstand er IKKE "trygt å vise". I praksis alltid satt fra
// migrations/0003 sin seed (PÅ fra dag 1, se konsept.md "Gamification").
export async function erLeaderboardAktivert(env) {
  const rad = await env.DB.prepare('SELECT verdi FROM innstillinger WHERE nokkel = ?')
    .bind(NOKKEL_LEADERBOARD_AKTIVERT)
    .first();
  return rad?.verdi === '1';
}

export async function settLeaderboardAktivert(env, verdi) {
  await env.DB.prepare(
    `INSERT INTO innstillinger (nokkel, verdi) VALUES (?, ?)
     ON CONFLICT(nokkel) DO UPDATE SET verdi = excluded.verdi`
  )
    .bind(NOKKEL_LEADERBOARD_AKTIVERT, verdi ? '1' : '0')
    .run();
}

// Lagt til v0.1.3 — reell bug funnet ved faktisk bruk (se CHANGELOG.md):
// "Hele gjengen"-merket og den kollektive "X/Y har registrert"-telleren
// brukte opprinnelig COUNT(*) FROM brukere (antall FAKTISK REGISTRERTE
// kontoer) som nevner. Med selvregistrering (ADR 11, invitasjonskode i
// stedet for admin-opprettede kontoer) er det tallet IKKE en stabil
// "alle 15-20 forventede deltakere"-telling — det vokser dynamisk etter
// hvert som folk registrerer seg selv, og var derfor 1 (bare den første
// personen) idet den samme personen registrerte sitt første funn, som
// gjorde badgen/telleren trivielt "oppnådd" for kun én person. Løsningen
// er et EGET, admin-satt måltall — se arkitektur.md ADR 12.
//
// 0 = "ikke satt av admin ennå" — IKKE en gyldig deltakertelling.
// erHeleGjengenOppnadd()/routes/leaderboard.js behandler eksplisitt <=0
// som "ikke oppnåelig ennå" (samme fail-closed-prinsipp som allerede
// gjaldt for antallAktiveBrukere <= 0 i den opprinnelige, nå erstattede
// logikken) — ikke en stille fallback til det gamle, buggy tallet.
const NOKKEL_FORVENTET_DELTAKERE = 'forventet_deltakere';

export async function hentForventetDeltakere(env) {
  const rad = await env.DB.prepare('SELECT verdi FROM innstillinger WHERE nokkel = ?')
    .bind(NOKKEL_FORVENTET_DELTAKERE)
    .first();
  const tall = rad ? parseInt(rad.verdi, 10) : 0;
  return Number.isFinite(tall) && tall > 0 ? tall : 0;
}

export async function settForventetDeltakere(env, verdi) {
  const heltall = Math.max(0, Math.trunc(Number(verdi) || 0));
  await env.DB.prepare(
    `INSERT INTO innstillinger (nokkel, verdi) VALUES (?, ?)
     ON CONFLICT(nokkel) DO UPDATE SET verdi = excluded.verdi`
  )
    .bind(NOKKEL_FORVENTET_DELTAKERE, String(heltall))
    .run();
}
