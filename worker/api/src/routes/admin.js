import { json } from '../lib/json.js';
import { corsHeaders, sjekkOpprinnelse } from '../lib/cors.js';
import { requireAdmin } from '../lib/session.js';
import { erLeaderboardAktivert, settLeaderboardAktivert } from '../lib/innstillinger.js';
import { beregnFremdrift } from '../lib/fremdrift.js';

// Forket og TRIMMET fra Bondøyas routes/admin.js — se CLAUDE.md
// "Filstruktur": ingen dashboard-endepunkter (bruksstatistikk/kostnadsbilde,
// bevisst scope-kutt), ingen sider-/invitasjon-/skjulte-arter-admin (ingen
// tilsvarende funksjonalitet i Ramme v1). Beholder kun bruker-moderasjon
// (deaktivering/permanent sletting — bl.a. for opprydding hvis
// invitasjonskoden lekker, se arkitektur.md ADR 11) og
// leaderboard-innstillingen + fremdrift-oversikten (Bondøyas Fase B,
// uendret mønster).

export async function listBrukere({ request, env }) {
  const cors = corsHeaders(env);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Krever admin-tilgang.' }, 403, cors);

  const { results } = await env.DB.prepare(
    `SELECT id, kortnavn, rolle, status, slettet_tidspunkt, opprettet
     FROM brukere ORDER BY opprettet`
  ).all();
  return json(results, 200, cors);
}

export async function oppdaterBrukerStatus({ request, env, params }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Krever admin-tilgang.' }, 403, cors);

  const id = parseInt(params.id, 10);
  if (id === admin.id) return json({ error: 'Du kan ikke endre din egen konto her.' }, 400, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ugyldig forespørsel.' }, 400, cors);
  }
  if (body.status !== 'aktiv' && body.status !== 'deaktivert') {
    return json({ error: 'Ugyldig status.' }, 400, cors);
  }

  const rad = await env.DB.prepare('SELECT slettet_tidspunkt FROM brukere WHERE id = ?').bind(id).first();
  if (!rad) return json({ error: 'Fant ikke bruker.' }, 404, cors);
  if (rad.slettet_tidspunkt) return json({ error: 'Bruker er permanent slettet.' }, 400, cors);

  await env.DB.prepare('UPDATE brukere SET status = ? WHERE id = ?').bind(body.status, id).run();

  // Umiddelbar tilbaketrekking ved deaktivering, ikke bare fremtidig sperre.
  if (body.status === 'deaktivert') {
    await env.DB.prepare('DELETE FROM sesjoner WHERE bruker_id = ?').bind(id).run();
  }

  return json({ ok: true }, 200, cors);
}

export async function slettBrukerPermanent({ request, env, params }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Krever admin-tilgang.' }, 403, cors);

  const id = parseInt(params.id, 10);
  if (id === admin.id) return json({ error: 'Du kan ikke slette din egen konto her.' }, 400, cors);

  const rad = await env.DB.prepare('SELECT slettet_tidspunkt FROM brukere WHERE id = ?').bind(id).first();
  if (!rad) return json({ error: 'Fant ikke bruker.' }, 404, cors);
  if (rad.slettet_tidspunkt) return json({ error: 'Bruker er allerede permanent slettet.' }, 400, cors);

  // Scrubber kortnavnet (ikke e-post — Ramme har ingen, se ADR 11) i stedet
  // for å slette raden — unngår å bryte funn sin fremmednøkkel, samme
  // mønster som Bondøyas Milestone C.
  const plassholderKortnavn = `slettet-${id}`;
  await env.DB.prepare(
    `UPDATE brukere SET kortnavn = ?, kortnavn_normalisert = ?, status = 'deaktivert', slettet_tidspunkt = datetime('now')
     WHERE id = ?`
  )
    .bind(plassholderKortnavn, plassholderKortnavn, id)
    .run();
  await env.DB.prepare('DELETE FROM sesjoner WHERE bruker_id = ?').bind(id).run();

  return json({ ok: true }, 200, cors);
}

export async function hentInnstillinger({ request, env }) {
  const cors = corsHeaders(env);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Krever admin-tilgang.' }, 403, cors);

  return json({ leaderboardAktivert: await erLeaderboardAktivert(env) }, 200, cors);
}

export async function oppdaterInnstillinger({ request, env }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Krever admin-tilgang.' }, 403, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ugyldig forespørsel.' }, 400, cors);
  }
  if (typeof body.leaderboardAktivert !== 'boolean') {
    return json({ error: 'Ugyldig verdi for leaderboardAktivert.' }, 400, cors);
  }

  await settLeaderboardAktivert(env, body.leaderboardAktivert);
  return json({ leaderboardAktivert: await erLeaderboardAktivert(env) }, 200, cors);
}

// Fase B (arvet fra Bondøya, uendret mønster) — admin-oversikt over alles
// fremdrift. Gjenbruker beregnFremdrift() UENDRET per bruker.
export async function hentAdminFremdrift({ request, env }) {
  const cors = corsHeaders(env);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Krever admin-tilgang.' }, 403, cors);

  const { results: brukere } = await env.DB.prepare(
    `SELECT id, kortnavn, status FROM brukere WHERE slettet_tidspunkt IS NULL ORDER BY kortnavn`
  ).all();

  const oversikt = await Promise.all(
    brukere.map(async (bruker) => {
      const f = await beregnFremdrift(bruker.id, env);
      return {
        brukerId: bruker.id,
        kortnavn: bruker.kortnavn,
        status: bruker.status,
        poengsum: f.score.totalt,
        antallMerkerOppnadd: f.badges.filter((b) => b.opptjent).length,
        antallMerkerTotalt: f.badges.length,
        antallArter: f.antallArter,
      };
    })
  );

  oversikt.sort((a, b) => b.poengsum - a.poengsum);
  return json(oversikt, 200, cors);
}
