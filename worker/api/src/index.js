import { createRouter } from './router.js';
import { corsHeaders } from './lib/cors.js';
import { json } from './lib/json.js';
import { rullerSesjonHvisNodvendig, sesjonCookieHeader } from './lib/session.js';
import { registrer, loggUt } from './routes/auth.js';
import { meg, hentFremdrift } from './routes/meg.js';
import { hentLeaderboard } from './routes/leaderboard.js';
import { listFunn, opprettFunn, oppdaterFunn, slettFunn, hentBilde } from './routes/funn.js';
import { sokArter } from './routes/arter.js';
import { gjenkjennArt } from './routes/ki.js';
import {
  listBrukere, oppdaterBrukerStatus, slettBrukerPermanent,
  hentInnstillinger, oppdaterInnstillinger,
  hentAdminFremdrift,
} from './routes/admin.js';

// Rutelisten er bevisst kortere enn Bondøyas — se CLAUDE.md "Filstruktur":
// ingen /auth/be-om-lenke|verifiser (magic-link, se ADR 11), ingen
// /invitasjon/*|/admin/invitasjoner (individuelle lenker, ikke bygget),
// ingen /funn/offentlig|/offentlig/innstillinger (ingen offentlig lag),
// ingen /tiles/* (Mapbox-satellitt droppet for v1, se README "Bevisste
// forenklinger"), ingen /sider|/admin/sider, ingen /admin/skjulte-arter,
// ingen /admin/dashboard, ingen /arter/:taxonId/beskrivelse|/miniatyrbilde
// (artsomtale-systemet droppet, se routes/arter.js).
const router = createRouter();
router.post('/auth/registrer', registrer);
router.post('/auth/logg-ut', loggUt);
router.get('/meg', meg);
router.get('/meg/fremdrift', hentFremdrift);
router.get('/leaderboard', hentLeaderboard);
router.get('/funn', listFunn);
router.post('/funn', opprettFunn);
router.patch('/funn/:id', oppdaterFunn);
router.delete('/funn/:id', slettFunn);
router.get('/funn/bilde/:id', hentBilde);
router.get('/arter/sok', sokArter);
router.post('/ki/gjenkjenn', gjenkjennArt);
router.get('/admin/brukere', listBrukere);
router.patch('/admin/brukere/:id', oppdaterBrukerStatus);
router.delete('/admin/brukere/:id', slettBrukerPermanent);
router.get('/admin/innstillinger', hentInnstillinger);
router.patch('/admin/innstillinger', oppdaterInnstillinger);
router.get('/admin/fremdrift', hentAdminFremdrift);

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    let res;
    try {
      res = await router.handle(request, env, ctx);
      if (!res) res = json({ error: 'Ikke funnet.' }, 404, cors);
    } catch (e) {
      console.error(e);
      res = json({ error: 'Uventet feil.' }, 500, cors);
    }
    return leggTilRullertSesjonCookie(request, env, res);
  },
};

// Periodisk sesjonstoken-rotasjon (se lib/session.js) — sentralt her,
// portert uendret fra Bondøya/FungiFinder.
async function leggTilRullertSesjonCookie(request, env, response) {
  const rullert = await rullerSesjonHvisNodvendig(request, env);
  if (!rullert) return response;

  const maxAgeSekunder = (rullert.utloper - Date.now()) / 1000;
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', sesjonCookieHeader(rullert.token, maxAgeSekunder));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
