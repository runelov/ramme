import { randomToken } from './crypto.js';
import { erSynligForPublic, betruaTaxonId } from './artsvisibility.js';
import { ARTSTYPER, hentAutoritativArtstype } from './taxonomi.js';

// Forket UENDRET i logikk fra Bondøya (kun kommentar-referanser justert) —
// se mittbondøya-workspace/bondoya/worker/api/src/lib/funn.js.
const MAKS_BILDE_BYTES = 8 * 1024 * 1024;
const TILLATTE_BILDETYPER = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAKS_TEKST_LENGDE = 200;

// Formen appen faktisk konsumerer — skjuler D1-kolonnenavn og R2-nøkkelen.
export function parseFunnRad(rad, innloggetBruker) {
  const erEgenRegistrering = rad.registrert_av_bruker_id === innloggetBruker.id;
  return {
    id: rad.id,
    art: {
      norsk: rad.art_norsk,
      latinsk: rad.art_latinsk,
      taxonId: rad.art_taxon_id,
    },
    artstype: rad.artstype,
    rodlistekategori: rad.rodlistekategori,
    lat: rad.lat,
    lon: rad.lon,
    tidspunkt: rad.tidspunkt,
    bildeUrl: rad.bilde_r2_key ? `/funn/bilde/${rad.id}` : null,
    kiKonfidens: rad.ki_konfidens,
    kiAlternativer: rad.ki_alternativer ? JSON.parse(rad.ki_alternativer) : [],
    registrertAv: rad.registrert_av_kortnavn,
    erEgenRegistrering,
    kanSlette: erEgenRegistrering || innloggetBruker.rolle === 'admin',
    opprettet: rad.opprettet,
  };
}

export async function hentFunnRad(id, env) {
  return env.DB.prepare('SELECT * FROM funn WHERE id = ?').bind(id).first();
}

// Validerer feltene som er felles for opprettelse og redigering (alt utenom
// bildet). Kaster en Error med brukervennlig norsk melding ved ugyldig input
// — rutene fanger denne og returnerer 400.
export async function validerFunnFelter(felter, env) {
  const artNorsk = (felter.art_norsk || '').trim();
  if (!artNorsk) throw new Error('Art (norsk navn) mangler.');
  if (artNorsk.length > MAKS_TEKST_LENGDE) throw new Error('Artsnavn er for langt.');

  const artLatinsk = (felter.art_latinsk || '').trim() || null;
  if (artLatinsk && artLatinsk.length > MAKS_TEKST_LENGDE) throw new Error('Latinsk navn er for langt.');

  if (!ARTSTYPER.includes(felter.artstype)) throw new Error('Ugyldig artstype.');

  const artTaxonIdRaw = felter.art_taxon_id ? parseInt(felter.art_taxon_id, 10) : null;
  if (felter.art_taxon_id && !Number.isFinite(artTaxonIdRaw)) throw new Error('Ugyldig taxonId.');

  // Autoritativ artstype fra taxonId når en finnes — se hentAutoritativArtstype
  // i lib/taxonomi.js. Faller tilbake til klientens artstype ved manglende
  // taxonId eller Artsdatabanken-feil.
  const autoritativ = await hentAutoritativArtstype(artTaxonIdRaw);
  const artstype = autoritativ?.artstype || felter.artstype;
  const rodlistekategori = autoritativ?.rodlistekategori ?? null;

  const lat = parseFloat(felter.lat);
  const lon = parseFloat(felter.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Ugyldig breddegrad.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Ugyldig lengdegrad.');

  const tidspunkt = felter.tidspunkt;
  if (!tidspunkt || Number.isNaN(Date.parse(tidspunkt))) throw new Error('Ugyldig tidspunkt.');

  let kiKonfidens = 0;
  if (felter.ki_konfidens !== undefined && felter.ki_konfidens !== null && felter.ki_konfidens !== '') {
    kiKonfidens = parseFloat(felter.ki_konfidens);
    if (!Number.isFinite(kiKonfidens)) throw new Error('Ugyldig KI-konfidens.');
  }

  let kiAlternativer = null;
  if (felter.ki_alternativer) {
    try {
      const parsed = JSON.parse(felter.ki_alternativer);
      if (!Array.isArray(parsed)) throw new Error();
      kiAlternativer = JSON.stringify(parsed);
    } catch {
      throw new Error('Ugyldig format på KI-alternativer.');
    }
  }

  const artTaxonId = artTaxonIdRaw;
  const synligForPublic = await erSynligForPublic(betruaTaxonId(artTaxonIdRaw, artNorsk), env);

  return { artNorsk, artLatinsk, artstype, artTaxonId, rodlistekategori, lat, lon, tidspunkt, kiKonfidens, kiAlternativer, synligForPublic };
}

// Validerer og laster opp et bilde til R2. Returnerer R2-nøkkelen, eller
// null hvis ingen fil ble sendt med.
export async function lastOppBildeHvisTilstede(formData, brukerId, env) {
  const fil = formData.get('bilde');
  if (!fil || typeof fil.arrayBuffer !== 'function') return null;

  const extension = TILLATTE_BILDETYPER[fil.type];
  if (!extension) throw new Error('Ugyldig bildeformat — kun JPEG eller WebP er tillatt.');
  if (fil.size > MAKS_BILDE_BYTES) throw new Error('Bildet er for stort (maks 8MB).');

  const key = `${brukerId}/${randomToken()}.${extension}`;
  await env.IMAGES.put(key, await fil.arrayBuffer(), { httpMetadata: { contentType: fil.type } });
  return key;
}
