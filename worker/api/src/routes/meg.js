import { json } from '../lib/json.js';
import { corsHeaders } from '../lib/cors.js';
import { requireSession } from '../lib/session.js';
import { beregnFremdrift } from '../lib/fremdrift.js';
import { erLeaderboardAktivert } from '../lib/innstillinger.js';

// Svarer alltid 200 — statussjekk, ikke en beskyttet ressurs. Se Bondøyas
// routes/meg.js for hvorfor 401 her var feil (rød konsollfeil for hver
// uinnlogget besøkende) — samme resonnement portert uendret, selv om Ramme
// uansett ikke har noe offentlig lag.
export async function meg({ request, env }) {
  const cors = corsHeaders(env);
  const bruker = await requireSession(request, env);
  // leaderboardAktivert sendes med UANSETT innloggingsstatus, samme mønster
  // som Bondøyas Fase D — selve /leaderboard-endepunktet krever likevel
  // innlogging.
  const leaderboardAktivert = await erLeaderboardAktivert(env);
  if (!bruker) return json({ loggedIn: false, leaderboardAktivert }, 200, cors);
  return json(
    { loggedIn: true, kortnavn: bruker.kortnavn, rolle: bruker.rolle, leaderboardAktivert },
    200,
    cors
  );
}

// Beskyttet ressurs (brukerens egne poeng/badges/fremdrift) — vanlig 401.
export async function hentFremdrift({ request, env }) {
  const cors = corsHeaders(env);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);
  return json(await beregnFremdrift(bruker.id, env), 200, cors);
}
