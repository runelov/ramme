import { json } from '../lib/json.js';
import { corsHeaders } from '../lib/cors.js';
import { requireSession } from '../lib/session.js';
import { erLeaderboardAktivert } from '../lib/innstillinger.js';
import { beregnFremdrift } from '../lib/fremdrift.js';
import { erHeleGjengenOppnadd } from '../lib/badges-ramme.js';

// Portert fra Bondøyas routes/meg.js sin hentLeaderboard() (Fase D), se
// arkitektur.md ADR 5. To Ramme-spesifikke avvik fra det forkede grunnlaget,
// begge NYE, IKKE en del av Bondøyas sikkerhetsgjennomgåtte diff:
//
// 1. EXISTS-filter mot funn-tabellen — Bondøya lister ALLE aktive brukere
//    (inkl. 0-funn/0-poeng); Ramme viser KUN brukere med minst ett
//    registrert funn (se ADR 5 for personvernbegrunnelsen).
// 2. Kollektiv "X/Y har registrert"-teller (ux-skisse.md funn 2/konsept.md
//    UX-beslutning 2) — samme datagrunnlag som "Hele gjengen"-badgen
//    (COUNT DISTINCT bruker_id FRA funn mot totalt antall aktive brukere),
//    kun uten den fulle rangerte listen. Styres av samme admin-bryter som
//    resten av leaderboardet, ingen egen av/på-bryter.
export async function hentLeaderboard({ request, env }) {
  const cors = corsHeaders(env);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);
  if (!(await erLeaderboardAktivert(env))) {
    return json({ error: 'Leaderboard er ikke aktivert.' }, 403, cors);
  }

  const [{ results: brukereMedFunn }, antallAktivtRad, antallMedFunnRad] = await Promise.all([
    env.DB.prepare(
      `SELECT id, kortnavn FROM brukere
       WHERE slettet_tidspunkt IS NULL AND status = 'aktiv'
         AND EXISTS (SELECT 1 FROM funn WHERE funn.registrert_av_bruker_id = brukere.id)
       ORDER BY kortnavn`
    ).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS antall FROM brukere WHERE slettet_tidspunkt IS NULL AND status = 'aktiv'`
    ).first(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT funn.registrert_av_bruker_id) AS antall
       FROM funn
       JOIN brukere ON brukere.id = funn.registrert_av_bruker_id
       WHERE brukere.slettet_tidspunkt IS NULL AND brukere.status = 'aktiv'`
    ).first(),
  ]);

  const rangering = await Promise.all(
    brukereMedFunn.map(async (b) => {
      const f = await beregnFremdrift(b.id, env);
      return {
        kortnavn: b.kortnavn,
        poengsum: f.score.totalt,
        antallArter: f.antallArter,
        merker: f.badges.filter((m) => m.opptjent).map((m) => ({ nokkel: m.nokkel, navn: m.navn })),
      };
    })
  );
  rangering.sort((a, b) => b.poengsum - a.poengsum);

  const antallAktivt = antallAktivtRad?.antall || 0;
  const antallMedFunn = antallMedFunnRad?.antall || 0;

  return json(
    {
      rangering,
      kollektiv: {
        antallMedFunn,
        antallAktivt,
        heleGjengenOppnadd: erHeleGjengenOppnadd(antallMedFunn, antallAktivt),
      },
    },
    200,
    cors
  );
}
