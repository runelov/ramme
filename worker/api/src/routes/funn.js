import { json } from '../lib/json.js';
import { corsHeaders, sjekkOpprinnelse } from '../lib/cors.js';
import { requireSession } from '../lib/session.js';
import { parseFunnRad, hentFunnRad, validerFunnFelter, lastOppBildeHvisTilstede } from '../lib/funn.js';
import { beregnFremdrift } from '../lib/fremdrift.js';

// Forket fra Bondøyas routes/funn.js. Forenklet i forhold til Bondøya:
// ingen offentlig (uinnlogget) visning finnes i Ramme (se konsept.md
// "Bevisste scope-kutt"), så hentBilde() under har ingen public/edge-cache-
// gren — bildet er alltid sesjonsbeskyttet, samme private-cache-gren som
// Bondøyas ikke-offentlige funn bruker.

export async function listFunn({ request, env }) {
  const cors = corsHeaders(env);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);

  const { results } = await env.DB.prepare('SELECT * FROM funn ORDER BY tidspunkt DESC').all();
  return json(results.map((rad) => parseFunnRad(rad, bruker)), 200, cors);
}

export async function opprettFunn({ request, env }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Ugyldig forespørsel.' }, 400, cors);
  }

  let felter;
  let bildeKey;
  try {
    felter = await validerFunnFelter(Object.fromEntries(formData.entries()), env);
    bildeKey = await lastOppBildeHvisTilstede(formData, bruker.id, env);
  } catch (e) {
    return json({ error: e.message }, 400, cors);
  }

  // Snapshot rett før innsetting, sammenlignet mot samme beregning rett
  // etter — se Bondøyas routes/funn.js for hele "fremdriftEndring uten egen
  // poeng-tabell"-resonnementet, portert uendret.
  const fremdriftFor = await beregnFremdrift(bruker.id, env);

  const rad = await env.DB.prepare(
    `INSERT INTO funn (
       art_norsk, art_latinsk, art_taxon_id, artstype, rodlistekategori, lat, lon, tidspunkt,
       bilde_r2_key, ki_konfidens, ki_alternativer,
       registrert_av_bruker_id, registrert_av_kortnavn, synlig_for_public
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      felter.artNorsk,
      felter.artLatinsk,
      felter.artTaxonId,
      felter.artstype,
      felter.rodlistekategori,
      felter.lat,
      felter.lon,
      felter.tidspunkt,
      bildeKey,
      felter.kiKonfidens,
      felter.kiAlternativer,
      bruker.id,
      bruker.kortnavn,
      felter.synligForPublic ? 1 : 0
    )
    .first();

  const fremdriftEtter = await beregnFremdrift(bruker.id, env);
  const forOpptjent = new Set(fremdriftFor.badges.filter((b) => b.opptjent).map((b) => b.nokkel));
  const nyeMerker = fremdriftEtter.badges
    .filter((b) => b.opptjent && !forOpptjent.has(b.nokkel))
    .map((b) => ({ nokkel: b.nokkel, navn: b.navn }));

  const funnRespons = parseFunnRad(rad, bruker);
  funnRespons.fremdriftEndring = {
    poengEndring: fremdriftEtter.score.totalt - fremdriftFor.score.totalt,
    nyeMerker,
  };
  // Denne var brukerens FØRSTE registrering — brukt av klienten til å
  // avgjøre A2HS-sekvenseringen (vises først etter første vellykkede
  // funn-registrering, ikke ved innlogging, se konsept.md UX-beslutning 3).
  funnRespons.erFørsteRegistrering = fremdriftFor.score.elementer.find((e) => e.nokkel === 'registreringer')?.poeng === 0;
  return json(funnRespons, 201, cors);
}

export async function oppdaterFunn({ request, env, params }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);

  const eksisterende = await hentFunnRad(params.id, env);
  if (!eksisterende) return json({ error: 'Fant ikke funnet.' }, 404, cors);
  if (eksisterende.registrert_av_bruker_id !== bruker.id) {
    return json({ error: 'Du kan kun redigere dine egne funn.' }, 403, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ugyldig forespørsel.' }, 400, cors);
  }

  let felter;
  try {
    felter = await validerFunnFelter(body, env);
  } catch (e) {
    return json({ error: e.message }, 400, cors);
  }

  const rad = await env.DB.prepare(
    `UPDATE funn SET
       art_norsk = ?, art_latinsk = ?, art_taxon_id = ?, artstype = ?, rodlistekategori = ?,
       lat = ?, lon = ?, tidspunkt = ?, synlig_for_public = ?
     WHERE id = ?
     RETURNING *`
  )
    .bind(
      felter.artNorsk,
      felter.artLatinsk,
      felter.artTaxonId,
      felter.artstype,
      felter.rodlistekategori,
      felter.lat,
      felter.lon,
      felter.tidspunkt,
      felter.synligForPublic ? 1 : 0,
      params.id
    )
    .first();

  return json(parseFunnRad(rad, bruker), 200, cors);
}

export async function slettFunn({ request, env, params }) {
  const cors = corsHeaders(env);
  if (!sjekkOpprinnelse(request, env)) return json({ error: 'Ugyldig forespørsel.' }, 403, cors);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);

  const eksisterende = await hentFunnRad(params.id, env);
  if (!eksisterende) return json({ error: 'Fant ikke funnet.' }, 404, cors);
  if (eksisterende.registrert_av_bruker_id !== bruker.id && bruker.rolle !== 'admin') {
    return json({ error: 'Du kan kun slette dine egne funn.' }, 403, cors);
  }

  if (eksisterende.bilde_r2_key) await env.IMAGES.delete(eksisterende.bilde_r2_key);
  await env.DB.prepare('DELETE FROM funn WHERE id = ?').bind(params.id).run();

  return new Response(null, { status: 204, headers: cors });
}

export async function hentBilde({ request, env, params }) {
  const cors = corsHeaders(env);
  const bruker = await requireSession(request, env);
  if (!bruker) return json({ error: 'Ikke innlogget.' }, 401, cors);

  const rad = await hentFunnRad(params.id, env);
  if (!rad || !rad.bilde_r2_key) return json({ error: 'Fant ikke bilde.' }, 404, cors);

  const objekt = await env.IMAGES.get(rad.bilde_r2_key);
  if (!objekt) return json({ error: 'Fant ikke bilde.' }, 404, cors);
  return new Response(objekt.body, {
    status: 200,
    headers: {
      'Content-Type': objekt.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=31536000',
      ...cors,
    },
  });
}
