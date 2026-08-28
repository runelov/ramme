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
