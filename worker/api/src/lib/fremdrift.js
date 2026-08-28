import { ARTSTYPER, RODLISTE_LABELS } from './taxonomi.js';
import { finnOy, alleSoner } from './oyer.js';
import { beregnRammevandrerNiva, erHeleGjengenOppnadd } from './badges-ramme.js';
import { hentForventetDeltakere } from './innstillinger.js';

// Forket fra Bondøyas lib/fremdrift.js — se konsept.md "Poeng og badges —
// Ramme-tilpasset". Beregnes on-the-fly ved hver forespørsel (ingen egen
// poeng-/badge-tabell), samme v1-beslutning som Bondøya, billig på denne
// skalaen (15-20 brukere).
//
// Forskjeller fra Bondøya, eksplisitt:
// - "Øyhopper" (distanse-/polygon-klynging over flere landmasser) er
//   erstattet med "Rammevandrer" (sone-dekning på én sammenhengende
//   eiendom) — se arkitektur.md ADR 9 og lib/badges-ramme.js.
// - "Sjeldenhetsjeger" (Bondøyas 40 km Artskart-observasjonscache) er IKKE
//   bygget for Ramme v1 — Ramme har ikke det tilsvarende datagrunnlaget i
//   drift ennå (se arkitektur.md ADR 8/veien-videre.md, anbefalt men ikke
//   bindende utvidelse). Ingen sjeldenhet-score-element her.
// - Oppdageren, Rødlistejeger, Artssamler (x3), Mangfoldsmester, Årstidene
//   rundt er UENDRET fra Bondøya — ingen sted-spesifikk avhengighet i disse.
//   NB: Mangfoldsmester sitt mål er fortsatt ARTSTYPER.length (17), selv om
//   artsliste.md sin research kun fant reelle kandidater for 7 av de 17
//   artstypene i Rammes nærområde — konsept.md/veien-videre.md flagger
//   eksplisitt at dette gjør badgen vanskelig/kanskje uoppnåelig og at en
//   nedskalering er en åpen, IKKE tatt beslutning (produkteier avgjør,
//   ikke denne implementasjonen).

const POENG = {
  REGISTRERING: 1,
  NY_ART: 3,
  NY_ARTSTYPE: 10,
  RODLISTE: { NT: 5, VU: 10, EN: 20, CR: 20 },
  OPPDAGER: 25,
  RAMMEVANDRER_PER_EKSTRA_SONE: 15,
};

const ARTSSAMLER_TERSKLER = [10, 25, 50];
const ARTSSAMLER_NAVN = ['Artssamler', 'Ivrig artssamler', 'Artsmester'];

function sesong(tidspunktIso) {
  const m = new Date(tidspunktIso).getUTCMonth(); // 0-11
  if (m === 11 || m === 0 || m === 1) return 'vinter';
  if (m >= 2 && m <= 4) return 'var';
  if (m >= 5 && m <= 7) return 'sommer';
  return 'host';
}

// Norsk tekst for besøkte soner — samme flertallsbøying-idé som Bondøyas
// beskrivOyer(), men soner har alltid navn her (ingen "navnløse skjær"-
// kategori er relevant på én eiendom).
function beskrivSonerListe(soner) {
  const navn = soner.map((s) => s.navn).filter(Boolean);
  if (navn.length === 0) return '';
  if (navn.length === 1) return `: ${navn[0]}`;
  return `: ${navn.slice(0, -1).join(', ')} og ${navn[navn.length - 1]}`;
}

export async function beregnFremdrift(brukerId, env) {
  const { results: funn } = await env.DB.prepare(
    `SELECT art_taxon_id, art_norsk, artstype, rodlistekategori, lat, lon, tidspunkt, opprettet
     FROM funn WHERE registrert_av_bruker_id = ?`
  )
    .bind(brukerId)
    .all();

  const distinkteTaxonIder = [...new Set(funn.filter((f) => f.art_taxon_id != null).map((f) => f.art_taxon_id))];

  let globaltForste = new Map();
  if (distinkteTaxonIder.length > 0) {
    const plassholdere = distinkteTaxonIder.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT art_taxon_id, MIN(opprettet) AS forste FROM funn WHERE art_taxon_id IN (${plassholdere}) GROUP BY art_taxon_id`
    )
      .bind(...distinkteTaxonIder)
      .all();
    globaltForste = new Map(results.map((r) => [r.art_taxon_id, r.forste]));
  }

  const antallRegistreringer = funn.length;
  const antallArter = distinkteTaxonIder.length;
  const distinkteArtstyper = new Set(funn.map((f) => f.artstype));
  const artstypeTyper = ARTSTYPER.map((t) => ({ artstype: t, dekket: distinkteArtstyper.has(t) }));

  const rodlisteRekkefolge = { NT: 1, VU: 2, EN: 3, CR: 3 };
  const rodlistePerArt = new Map();
  for (const f of funn) {
    if (!f.art_taxon_id || !f.rodlistekategori) continue;
    const gjeldende = rodlistePerArt.get(f.art_taxon_id);
    if (!gjeldende || rodlisteRekkefolge[f.rodlistekategori] > rodlisteRekkefolge[gjeldende]) {
      rodlistePerArt.set(f.art_taxon_id, f.rodlistekategori);
    }
  }
  const rodlisteArter = [...rodlistePerArt.entries()].map(([artTaxonId, kategori]) => ({
    artTaxonId,
    kategori,
    artNorsk: funn.find((f) => f.art_taxon_id === artTaxonId)?.art_norsk ?? null,
  }));
  const rodlistePoeng = rodlisteArter.reduce((sum, r) => sum + POENG.RODLISTE[r.kategori], 0);

  const rodlisteTrigger = funn
    .filter((f) => f.rodlistekategori)
    .sort((a, b) => (a.opprettet < b.opprettet ? -1 : 1))[0] ?? null;

  const egenForstePerArt = new Map();
  for (const f of funn) {
    if (!f.art_taxon_id) continue;
    const gjeldende = egenForstePerArt.get(f.art_taxon_id);
    if (!gjeldende || f.opprettet < gjeldende) egenForstePerArt.set(f.art_taxon_id, f.opprettet);
  }
  const oppdagetArter = [...egenForstePerArt.entries()]
    .filter(([taxonId, egenForste]) => globaltForste.get(taxonId) === egenForste)
    .map(([artTaxonId]) => ({
      artTaxonId,
      artNorsk: funn.find((f) => f.art_taxon_id === artTaxonId)?.art_norsk ?? null,
    }));

  // --- Rammevandrer — sone-dekning, se lib/oyer.js/lib/badges-ramme.js ---
  const sonePerFunn = funn.map((f) => finnOy(f.lat, f.lon)).filter(Boolean);
  const besokteSonerMap = new Map(sonePerFunn.map((s) => [s.id, s]));
  const besokteSoner = [...besokteSonerMap.values()];
  const rammevandrer = beregnRammevandrerNiva(new Set(besokteSoner.map((s) => s.id)), alleSoner());

  const distinkteSesonger = new Set(funn.map((f) => sesong(f.tidspunkt)));

  // "Hele gjengen" — kollektivt lagmerke, ny logikk uten Bondøya-ekvivalent
  // (se konsept.md badge-tabell). Samme globale telling som
  // routes/leaderboard.js sin "X/Y har registrert"-indikator — hentet her
  // også slik at merket vises identisk i HVER brukers "Min fremdrift", ikke
  // bare i leaderboard-panelet.
  //
  // RETTET v0.1.5 (reell bug, funnet ved faktisk bruk RETT ETTER v0.1.3-
  // fiksen): denne funksjonen hadde sin EGEN, separate
  // erHeleGjengenOppnadd()-beregning, fortsatt mot antallAktivt (faktisk
  // registrerte kontoer) — v0.1.3 fikset kun kallet i
  // routes/leaderboard.js, ikke dette duplikatet her. Produkteier satte
  // forventetDeltakere=10 med kun 1 registrert funn, og "Hele gjengen"
  // viste seg likevel oppnådd i "Min fremdrift", fordi DENNE beregningen
  // fortsatt brukte antallAktivt=1. Se arkitektur.md ADR 14 for full
  // rotårsak (samme klasse feil som ADR 12/13 — en fiks gjort i én
  // funksjon, men samme logikk fantes duplisert et annet sted som ikke ble
  // søkt opp og rettet samtidig).
  const [antallAktivtRad, antallMedFunnRad, forventetDeltakere] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS antall FROM brukere WHERE slettet_tidspunkt IS NULL AND status = 'aktiv'`).first(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT funn.registrert_av_bruker_id) AS antall
       FROM funn JOIN brukere ON brukere.id = funn.registrert_av_bruker_id
       WHERE brukere.slettet_tidspunkt IS NULL AND brukere.status = 'aktiv'`
    ).first(),
    hentForventetDeltakere(env),
  ]);
  const antallAktivt = antallAktivtRad?.antall || 0; // informasjon — IKKE brukt til heleGjengenOppnadd lenger
  const antallMedFunn = antallMedFunnRad?.antall || 0;
  const heleGjengenOppnadd = erHeleGjengenOppnadd(antallMedFunn, forventetDeltakere);

  const score = {
    registreringer: antallRegistreringer * POENG.REGISTRERING,
    arter: antallArter * POENG.NY_ART,
    artstyper: distinkteArtstyper.size * POENG.NY_ARTSTYPE,
    rodliste: rodlistePoeng,
    oppdager: oppdagetArter.length * POENG.OPPDAGER,
    rammevandrer: Math.max(0, rammevandrer.antallBesokt - 1) * POENG.RAMMEVANDRER_PER_EKSTRA_SONE,
  };
  const totalt = Object.values(score).reduce((a, b) => a + b, 0);

  const badges = [
    {
      nokkel: 'oppdageren',
      navn: 'Oppdageren',
      beskrivelse: 'Først i fellesskapet til å registrere en gitt art.',
      opptjent: oppdagetArter.length > 0,
    },
    {
      nokkel: 'rodlistejeger',
      navn: 'Rødlistejeger',
      beskrivelse: rodlisteTrigger
        ? `Første funn av en rødlistet (truet) art — ${rodlisteTrigger.art_norsk}, ${RODLISTE_LABELS[rodlisteTrigger.rodlistekategori]} (${rodlisteTrigger.rodlistekategori}).`
        : 'Første funn av en rødlistet (truet) art.',
      opptjent: rodlisteArter.length > 0,
    },
    ...ARTSSAMLER_TERSKLER.map((mal, i) => ({
      nokkel: `artssamler_${i + 1}`,
      navn: ARTSSAMLER_NAVN[i],
      beskrivelse: `${mal} ulike arter.`,
      opptjent: antallArter >= mal,
      progresjon: { naa: antallArter, mal },
    })),
    {
      nokkel: 'mangfoldsmester',
      navn: 'Mangfoldsmester',
      beskrivelse: `Minst én art i hver av de ${ARTSTYPER.length} artstypene.`,
      opptjent: distinkteArtstyper.size === ARTSTYPER.length,
      progresjon: { naa: distinkteArtstyper.size, mal: ARTSTYPER.length },
    },
    ...rammevandrer.badges.map((b) => ({
      ...b,
      beskrivelse:
        b.progresjon.mal > 0 && b.opptjent
          ? `Funn registrert i minst ${b.progresjon.mal} soner${beskrivSonerListe(besokteSoner)}.`
          : `Funn registrert i minst ${b.progresjon.mal} soner på Ramme-eiendommen.`,
    })),
    {
      nokkel: 'arstidene_rundt',
      navn: 'Årstidene rundt',
      beskrivelse: 'Registrert i alle fire årstider.',
      opptjent: distinkteSesonger.size === 4,
      progresjon: { naa: distinkteSesonger.size, mal: 4 },
    },
    {
      nokkel: 'hele_gjengen',
      navn: 'Hele gjengen',
      beskrivelse: `Alle ${antallAktivt} aktive deltakere har registrert minst ett funn.`,
      opptjent: heleGjengenOppnadd,
      progresjon: { naa: antallMedFunn, mal: antallAktivt },
    },
  ];

  return {
    score: {
      totalt,
      elementer: [
        { nokkel: 'registreringer', etikett: 'Registreringer', poeng: score.registreringer, detalj: `${antallRegistreringer} registreringer` },
        { nokkel: 'arter', etikett: 'Ulike arter', poeng: score.arter, detalj: `${antallArter} arter` },
        { nokkel: 'artstyper', etikett: 'Artstype-dekning', poeng: score.artstyper, detalj: `${distinkteArtstyper.size} av ${ARTSTYPER.length} artstyper` },
        { nokkel: 'rodliste', etikett: 'Rødlistede arter', poeng: score.rodliste, detalj: `${rodlisteArter.length} rødlistede arter` },
        { nokkel: 'oppdager', etikett: 'Oppdager-bonus', poeng: score.oppdager, detalj: `${oppdagetArter.length} arter registrert først i fellesskapet` },
        { nokkel: 'rammevandrer', etikett: 'Rammevandrer', poeng: score.rammevandrer, detalj: `funn registrert i ${rammevandrer.antallBesokt} av ${rammevandrer.totalt} soner` },
      ],
    },
    antallArter,
    artstypeDekning: { totalt: ARTSTYPER.length, dekket: distinkteArtstyper.size, typer: artstypeTyper },
    rodliste: { arter: rodlisteArter },
    oppdagetArter,
    rammevandrer: { antallBesokt: rammevandrer.antallBesokt, totalt: rammevandrer.totalt, soner: besokteSoner },
    kollektiv: { antallMedFunn, antallAktivt, forventetDeltakere, heleGjengenOppnadd },
    badges,
  };
}
