// js/app.js — Ramme
//
// Forgrenet fra Bondøyas js/app.js (se mittbondøya-workspace/bondoya/js/app.js),
// men BEVISST TRIMMET til Rammes faktiske funksjonsbredde — se README.md
// "Bevisste forenklinger" for den fulle listen av det som IKKE er tatt med
// (bl.a. artsomtale/Wikipedia, sider-system, invitasjonslenker, admin-
// dashboard, Mapbox-satellittlag, KI-bilde-beskjæring, galleri-visning og
// gruppering av funnlisten). Dette er en villet, dokumentert avgrensning
// for et 3-4-ukers engangsseminar-prosjekt, ikke en forglemmelse.
(function(){
"use strict";

const APP_VERSION = '0.1.6';
const APP_BUILD_DATE = '2026-08-28';

// Speilbilde av ARTSTYPER i worker/api/src/lib/taxonomi.js — appen har
// ingen build-step som lar de to dele en fil, listen må holdes i synk
// manuelt (se CLAUDE.md/Bondøyas tilsvarende kommentar).
const ARTSTYPER = [
  'fugl', 'sjøpattedyr', 'pattedyr', 'plante', 'alge', 'sopp', 'fisk',
  'bløtdyr', 'krepsdyr', 'insekt', 'edderkoppdyr', 'krypdyr', 'amfibium',
  'nesledyr', 'pigghud', 'leddorm', 'annet',
];

const el = id => document.getElementById(id);

let mapCtx = null;
let funnCache = [];
let speciesCache = [];
let sonerCache = []; // data/soner-ramme.json — kun til kartmarkering, se js/map.js sin renderSonerPaKart()
let activeFilter = 'alle';
let activeVisning = 'alle'; // 'alle' | 'mine'
let activeSort = 'nyeste';
let brukerCache = null; // {kortnavn, rolle} eller null — satt av sjekkSesjon()
let adminInnstillingerCache = null;
let pendingImageBlob = null;
let pendingPosition = null; // {lat, lon}
let pendingPositionKilde = null; // 'gps' | 'exif' | 'manuell'
let pendingTimestamp = null;
let pendingKiResultat = null;
let pendingArt = null; // { norsk, latinsk, artstype, taxonId }
let pendingEntry = null; // hele det siste forsøkte innsendings-objektet, brukt av "Prøv igjen" ved feil, se saveFind()
let fremdriftCache = null;
let fremdriftPinnetMerke = null;
let harNoensinneRegistrertFunn = false; // se sjekkA2HSBetingelse() — satt fra /meg/fremdrift, ikke bare fra denne øktens registreringer

// ---------- oppstart ----------

document.addEventListener('DOMContentLoaded', async () => {
  wireDynamiskNettleserKromMargin();
  mapCtx = await initMapNarKlar();
  window.addEventListener('funn:selected', e => openDetail(e.detail));

  await loadSpecies();
  await loadSoner();
  await sjekkSesjon();
  await refreshFromRepo();

  wireAccountPanel();
  wireAdminPanel();
  wireListPanel();
  wireRegisterFlow();
  wireFremdriftPanel();
  wireLeaderboardPanel();
  wireSheetDismiss();
  wireVersionUpdateCheck();
  wireA2HS();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW-registrering feilet', err));
  }
});

// Rapportert bug 2026-08-28: midtstilte bunn-knapper (.fab/.fabSecondary)
// nesten helt skjult av iPhone sin knapperad når appen kjøres i vanlig
// mobil Safari (IKKE installert/standalone). Rotårsak: CSS-variabelen
// --safe-bottom (env(safe-area-inset-bottom)) dekker KUN hjem-indikator-
// området på notch-telefoner — den vet ingenting om Safaris egen adresse-/
// verktøylinje, som tar ekstra plass i selve nettleseren og som CSS ikke
// har noen egen mekanisme for å måle. Fikset ved å lese den faktisk synlige
// høyden via window.visualViewport (krymper når Safari-kromet vises) mot
// window.innerHeight (layout-viewporten, upåvirket av kromet) — differansen
// er omtrent hvor mye av bunnen som faktisk er dekket akkurat nå, satt som
// --browser-chrome-bottom og brukt i tillegg til --safe-bottom (se
// css/styles.css :root). Gir 0px (ingen endring) når appen kjøres
// installert som PWA, siden Safari-kromet da er borte helt — kun et
// problem i vanlig nettleser-modus, se veien-videre.md.
function wireDynamiskNettleserKromMargin(){
  if (!window.visualViewport) return; // eldre nettlesere: fallback er 0px (satt i CSS), ingen krasj
  function oppdater(){
    const vv = window.visualViewport;
    const dekket = window.innerHeight - vv.height - vv.offsetTop;
    document.documentElement.style.setProperty('--browser-chrome-bottom', `${Math.max(0, Math.round(dekket))}px`);
  }
  window.visualViewport.addEventListener('resize', oppdater);
  window.visualViewport.addEventListener('scroll', oppdater);
  oppdater();
}

// #map-containeren kan ha 0x0 størrelse akkurat idet denne kjører (viewport/
// embedding ikke ferdig lagt ut ennå). Bondøyas js/app.js dokumenterer det
// samme problemet med ETT enkelt fast 100ms-retry — under manuell
// verifisering av Ramme viste det seg util at et fast delay-forsøk kan bomme
// (layout er ikke nødvendigvis ferdig innen NOEN fast tid i alle miljøer).
// Sjekker derfor eksplisitt at containeren faktisk har fått en reell
// størrelse (offsetWidth/offsetHeight > 0) FØR L.map() i det hele tatt
// kalles, i stedet for å gjette på en tidsforsinkelse — retter selve
// årsaken (ukjent layout-tidspunkt), ikke bare symptomet. Fast delay-retry
// beholdes likevel som et bakstopp for andre, ekte feil (se catch-grenen).
function ventPaMapContainerKlar(maksForsokMs){
  return new Promise((resolve) => {
    const start = Date.now();
    function sjekk(){
      const container = document.getElementById('map');
      if (container && container.offsetWidth > 0 && container.offsetHeight > 0) {
        resolve(true);
        return;
      }
      if (Date.now() - start > maksForsokMs) {
        resolve(false); // gir opp — initMap() får uansett prøve, se forsok() under
        return;
      }
      requestAnimationFrame(sjekk);
    }
    sjekk();
  });
}

async function initMapNarKlar(){
  await ventPaMapContainerKlar(3000);

  const FORSOK_FORSINKELSER_MS = [100, 200, 400, 800];
  return new Promise((resolve) => {
    function forsok(gjenstaende){
      try {
        resolve(initMap());
      } catch (e) {
        if (gjenstaende.length === 0) {
          console.error('Kartinitialisering feilet etter flere forsøk, fortsetter uten kart', e);
          resolve(null);
          return;
        }
        const [forsinkelse, ...rest] = gjenstaende;
        console.warn(`Kartinitialisering feilet, prøver på nytt om ${forsinkelse}ms`, e);
        setTimeout(() => forsok(rest), forsinkelse);
      }
    }
    forsok(FORSOK_FORSINKELSER_MS);
  });
}

async function loadSpecies(){
  try {
    const res = await fetch('data/species.json');
    speciesCache = await res.json();
  } catch (e) {
    console.warn('Kunne ikke laste species.json', e);
    speciesCache = [];
  }
}

async function loadSoner(){
  try {
    const res = await fetch('data/soner-ramme.json');
    sonerCache = await res.json();
  } catch (e) {
    console.warn('Kunne ikke laste soner-ramme.json', e);
    sonerCache = [];
  }
  if (mapCtx) renderSonerPaKart(mapCtx.sonerLayer, sonerCache);
}

// Feiler bevisst aldri (nettverksfeil -> behandlet som "ikke innlogget").
async function sjekkSesjon(){
  try {
    brukerCache = await window.ApiClient.meg();
  } catch (e) {
    console.warn('Kunne ikke sjekke innloggingsstatus', e);
    brukerCache = null;
  }
  renderAccountPanel();
  if (brukerCache) await oppdaterHarRegistrertFunnFlagg();
  oppdaterA2HSVisning();
  return brukerCache;
}

// A2HS skal vises først etter FØRSTE vellykkede funn-registrering (konsept.md
// UX-beslutning 3) — ikke bare denne øktens registreringer (en bruker som
// logger inn på en ny enhet etter å alt ha registrert noe tidligere, skal
// ikke måtte registrere på nytt for å se tilbudet). Henter derfor et lett
// signal fra /meg/fremdrift (antall registreringer) i stedet for å anta
// false ved hver ny sesjon.
async function oppdaterHarRegistrertFunnFlagg(){
  try {
    const f = await window.ApiClient.hentFremdrift();
    const registreringerElement = f.score.elementer.find(e => e.nokkel === 'registreringer');
    harNoensinneRegistrertFunn = !!registreringerElement && registreringerElement.poeng > 0;
  } catch (e) {
    // Stille — påvirker kun A2HS-tilbudets timing, ikke noe kritisk.
  }
}

// Ramme har ingen offentlig (uinnlogget) visning — uinnlogget betyr her kun
// et tomt kart/tom liste, ikke et eget datasett fra en offentlig rute.
async function refreshFromRepo(){
  if (!brukerCache) {
    funnCache = [];
    renderFindsPaKart();
    renderList();
    return;
  }
  try {
    funnCache = await window.ApiClient.hentFunn();
  } catch (e) {
    showToast('Kunne ikke hente funn: ' + e.message);
    return;
  }
  renderFindsPaKart();
  renderList();
}

// ---------- konto / registrering (invitasjonskode + kortnavn + PIN) ----------

function wireAccountPanel(){
  el('accountToggle').addEventListener('click', () => toggleSheet('accountPanel'));

  el('loginSendBtn').addEventListener('click', async () => {
    const invitasjonskode = el('loginInvitasjonskode').value.trim();
    const kortnavn = el('loginKortnavn').value.trim();
    const pin = el('loginPin').value.trim();
    if (!invitasjonskode || !kortnavn || !pin) {
      el('loginNote').textContent = 'Fyll ut alle tre feltene.';
      return;
    }
    el('loginNote').textContent = 'Sender …';
    el('loginSendBtn').disabled = true;
    try {
      const data = await window.ApiClient.registrer(invitasjonskode, kortnavn, pin);
      brukerCache = { kortnavn: data.kortnavn, rolle: data.rolle };
      el('loginPin').value = '';
      el('loginNote').textContent = '';
      renderAccountPanel();
      toggleSheet('accountPanel', false);
      showToast(`Velkommen, ${data.kortnavn}!`);
      await oppdaterHarRegistrertFunnFlagg();
      oppdaterA2HSVisning();
      await refreshFromRepo();
    } catch (e) {
      el('loginNote').textContent = 'Feil: ' + e.message;
    } finally {
      el('loginSendBtn').disabled = false;
    }
  });

  el('loggUtBtn').addEventListener('click', async () => {
    await window.ApiClient.loggUt();
    brukerCache = null;
    renderAccountPanel();
    toggleSheet('accountPanel', false);
    showToast('Logget ut.');
    await refreshFromRepo();
  });

  renderAccountPanel();
}

function renderAccountPanel(){
  el('accountLoggedOut').hidden = !!brukerCache;
  el('accountLoggedInn').hidden = !brukerCache;
  if (brukerCache) {
    el('accountKortnavn').textContent = brukerCache.kortnavn;
    el('accountVersion').textContent = `Ramme v${APP_VERSION}`;
  }
  // Kun kosmetisk skjuling — faktisk håndhevelse skjer server-side
  // (requireAdmin()/requireSession() på hvert endepunkt).
  el('adminToggle').hidden = !brukerCache || brukerCache.rolle !== 'admin';
  el('fabRegister').hidden = !brukerCache;
  el('fabGallery').hidden = !brukerCache;
  el('fremdriftToggle').hidden = !brukerCache;
  el('listToggle').hidden = !brukerCache;
  // Leaderboard-ikonet: synlig for innloggede KUN når admin har skrudd det
  // på (samme fail-closed-mønster som resten av toppbaren, se konsept.md
  // UX-beslutning 1 — window.ApiClient.erLeaderboardAktivert() er satt av
  // siste meg()-kall).
  el('leaderboardToggle').hidden = !brukerCache || !window.ApiClient.erLeaderboardAktivert();
  if (mapCtx) mapCtx.settInnloggingsstatus(!!brukerCache);
}

// ---------- min fremdrift ----------
// "Merker" (norsk for "badges") — rene ikon-knapper, delt i
// "oppnådd"/"gjenstående utfordringer". Ikonene er et RENT presentasjonsvalg
// (serveren eier opptjent/progresjon/tekst) — et merke uten kjent nøkkel
// faller tilbake til 🏅.
const MERKE_IKONER = {
  oppdageren: '🔭',
  rodlistejeger: '⚠️',
  artssamler_1: '🥉',
  artssamler_2: '🥈',
  artssamler_3: '🥇',
  mangfoldsmester: '🧩',
  rammevandrer_1: '🚶',
  rammevandrer_2: '🗺️',
  arstidene_rundt: '🔄',
  hele_gjengen: '🤝',
};

function wireFremdriftPanel(){
  el('fremdriftToggle').addEventListener('click', async () => {
    toggleSheet('fremdriftPanel', true);
    await renderFremdrift();
  });
}

function merkeRing(b){
  if (b.opptjent || !b.progresjon || !b.progresjon.mal) return '';
  const r = 22, c = 2 * Math.PI * r, size = (r + 3) * 2, mid = size / 2;
  const andel = Math.min(1, b.progresjon.naa / b.progresjon.mal);
  return `<svg class="ring" viewBox="0 0 ${size} ${size}">
    <circle class="track" cx="${mid}" cy="${mid}" r="${r}"></circle>
    <circle class="fill" cx="${mid}" cy="${mid}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - andel)}"></circle>
  </svg>`;
}

function merkeKnappHtml(b){
  const ikon = MERKE_IKONER[b.nokkel] || '🏅';
  return `
    <button type="button" class="merke ${b.opptjent ? 'earned' : 'locked'}" data-nokkel="${escapeHtml(b.nokkel)}" aria-label="${escapeHtml(b.navn)}">
      ${merkeRing(b)}${ikon}
    </button>`;
}

function merkeDetalj(nokkel){
  const panel = el('fremdriftMerkeDetalj');
  if (!panel) return;
  const b = nokkel && fremdriftCache ? fremdriftCache.badges.find(x => x.nokkel === nokkel) : null;
  if (!b) {
    panel.innerHTML = '<span class="merkeDetaljHint">Trykk på et merke for å se navn og beskrivelse.</span>';
    return;
  }
  const ikon = MERKE_IKONER[b.nokkel] || '🏅';
  const progresjon = b.progresjon && b.progresjon.mal ? `<span class="prog">${b.progresjon.naa}/${b.progresjon.mal}</span> — ` : '';
  panel.innerHTML = `
    <span class="merkeDetaljIkon${b.opptjent ? '' : ' locked'}">${ikon}</span>
    <span class="merkeDetaljTekst"><strong>${escapeHtml(b.navn)}</strong><span>${progresjon}${escapeHtml(b.beskrivelse)}</span></span>`;
}

async function renderFremdrift(){
  const container = el('fremdriftInnhold');
  container.innerHTML = '<p class="hint">Laster …</p>';
  fremdriftPinnetMerke = null;
  let f;
  try {
    f = await window.ApiClient.hentFremdrift();
  } catch (e) {
    container.innerHTML = `<p class="hint">Kunne ikke hente fremdrift: ${escapeHtml(e.message)}</p>`;
    return;
  }
  fremdriftCache = f;

  const scoreRader = f.score.elementer.map(e => `
    <div class="scoreRow">
      <span class="lbl">${escapeHtml(e.etikett)}<span class="detail">${escapeHtml(e.detalj)}</span></span>
      <span class="val">${e.poeng} p</span>
    </div>`).join('') + `
    <div class="scoreRow total">
      <span class="lbl">Totalt</span>
      <span class="val">${f.score.totalt} p</span>
    </div>`;

  const artstypeChips = f.artstypeDekning.typer.map(t =>
    `<span class="fremdriftChip${t.dekket ? ' dekket' : ''}">${escapeHtml(t.artstype.charAt(0).toUpperCase() + t.artstype.slice(1))}</span>`
  ).join('');

  const oppnadd = f.badges.filter(b => b.opptjent);
  const gjenstaar = f.badges.filter(b => !b.opptjent);

  container.innerHTML = `
    <div class="scoreCard" id="fremdriftScoreCard">
      <button type="button" class="scoreHead" aria-expanded="false">
        <span>
          <span class="big">Poengsum: ${f.score.totalt}</span>
          <span class="sub">Trykk for å se hva som teller</span>
        </span>
        <span class="scoreChev">▾</span>
      </button>
      <div class="scoreBody">${scoreRader}</div>
    </div>
    <h3>Artstype-dekning (${f.artstypeDekning.dekket}/${f.artstypeDekning.totalt})</h3>
    <div class="fremdriftChipWrap">${artstypeChips}</div>
    <h4>Oppnådd <span class="count">(${oppnadd.length}/${f.badges.length})</span></h4>
    <div class="merkeGrid">${oppnadd.map(merkeKnappHtml).join('') || '<p class="hint">Ingen merker oppnådd ennå.</p>'}</div>
    <h4>Gjenstående utfordringer <span class="count">(${gjenstaar.length}/${f.badges.length})</span></h4>
    <div class="merkeGrid">${gjenstaar.map(merkeKnappHtml).join('') || '<p class="hint">Alle merker oppnådd!</p>'}</div>
    <div class="merkeDetalj" id="fremdriftMerkeDetalj">
      <span class="merkeDetaljHint">Trykk på et merke for å se navn og beskrivelse.</span>
    </div>`;

  const scoreCard = el('fremdriftScoreCard');
  scoreCard.querySelector('.scoreHead').addEventListener('click', () => {
    const head = scoreCard.querySelector('.scoreHead');
    const body = scoreCard.querySelector('.scoreBody');
    const open = scoreCard.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
    body.style.maxHeight = open ? body.scrollHeight + 'px' : '0px';
  });

  container.querySelectorAll('.merke').forEach((btn) => {
    const nokkel = btn.dataset.nokkel;
    btn.addEventListener('mouseenter', () => { if (!fremdriftPinnetMerke) merkeDetalj(nokkel); });
    btn.addEventListener('mouseleave', () => { if (!fremdriftPinnetMerke) merkeDetalj(fremdriftPinnetMerke); });
    btn.addEventListener('click', () => {
      container.querySelectorAll('.merke.picked').forEach(t => t.classList.remove('picked'));
      if (fremdriftPinnetMerke === nokkel) { fremdriftPinnetMerke = null; merkeDetalj(null); return; }
      fremdriftPinnetMerke = nokkel;
      btn.classList.add('picked');
      merkeDetalj(nokkel);
    });
  });
}

// ---------- leaderboard ----------
// Eget topbar-ikon/panel — bevisst avvik fra Bondøyas plassering nederst i
// "Min fremdrift" (konsept.md UX-beslutning 1: Ramme skal FREMHEVE
// leaderboardet, ikke dempe det). Kun hentet når admin har skrudd det på,
// se renderAccountPanel().
function wireLeaderboardPanel(){
  el('leaderboardToggle').addEventListener('click', async () => {
    toggleSheet('leaderboardPanel', true);
    await renderLeaderboard();
  });
}

async function renderLeaderboard(){
  const kollektivEl = el('leaderboardKollektiv');
  const listeEl = el('leaderboardInnhold');
  kollektivEl.textContent = '';
  listeEl.innerHTML = '<p class="hint">Laster …</p>';
  let data;
  try {
    data = await window.ApiClient.hentLeaderboard();
  } catch (e) {
    listeEl.innerHTML = `<p class="hint">Kunne ikke hente leaderboard: ${escapeHtml(e.message)}</p>`;
    return;
  }

  const { rangering, kollektiv } = data;
  // Navnløs "X/Y har registrert"-indikator (konsept.md UX-beslutning 2) —
  // ingen navn, kun tallene. "Hele gjengen!" vises i tillegg når oppnådd,
  // samme datagrunnlag som badgen med samme navn i "Min fremdrift".
  //
  // RETTET v0.1.3: "Y" er nå kollektiv.forventetDeltakere (admin-satt
  // måltall), IKKE lenger antallAktivt (faktisk registrerte kontoer så
  // langt) — se routes/leaderboard.js for hvorfor det opprinnelige tallet
  // var en reell bug med selvregistrering (ADR 11). Vis en tydelig
  // "ikke satt opp ennå"-tekst i stedet for et misvisende 0-tall når admin
  // ikke har satt måltallet ennå, i stedet for å late som 0 er en gyldig verdi.
  if (kollektiv.forventetDeltakere <= 0) {
    kollektivEl.textContent = `${kollektiv.antallMedFunn} har registrert minst ett funn (forventet antall deltakere ikke satt av admin ennå).`;
  } else {
    kollektivEl.textContent = kollektiv.heleGjengenOppnadd
      ? `🎉 ${kollektiv.antallMedFunn}/${kollektiv.forventetDeltakere} har registrert — Hele gjengen!`
      : `${kollektiv.antallMedFunn}/${kollektiv.forventetDeltakere} har registrert minst ett funn.`;
  }

  const rader = rangering.map((r, i) => {
    const duSelv = brukerCache && r.kortnavn === brukerCache.kortnavn;
    const merkerHtml = r.merker
      .map(m => `<span class="leaderboardMerke" title="${escapeHtml(m.navn)}">${MERKE_IKONER[m.nokkel] || '🏅'}</span>`)
      .join('');
    return `
      <div class="leaderboardRow${duSelv ? ' deg' : ''}">
        <span class="leaderboardRank">${i + 1}</span>
        <span class="leaderboardNavn">${escapeHtml(r.kortnavn)}${duSelv ? ' <span class="hint">(deg)</span>' : ''}</span>
        <span class="leaderboardMerker">${merkerHtml}</span>
        <span class="leaderboardPoeng">${r.poengsum} p</span>
      </div>`;
  }).join('') || '<p class="hint">Ingen har registrert et funn ennå.</p>';

  listeEl.innerHTML = rader;
}

// ---------- admin ----------

function wireAdminTabs(){
  const knapper = document.querySelectorAll('.adminTabBtn');
  function velgFane(navn){
    knapper.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === navn));
    document.querySelectorAll('.adminTabPanel').forEach(panel => {
      panel.hidden = panel.id !== `adminTab-${navn}`;
    });
  }
  knapper.forEach(btn => btn.addEventListener('click', () => velgFane(btn.dataset.tab)));
  velgFane('innstillinger');
}

function wireAdminPanel(){
  wireAdminTabs();
  el('adminToggle').addEventListener('click', async () => {
    toggleSheet('adminPanel');
    if (!el('adminPanel').hidden) {
      document.querySelector('.adminTabBtn[data-tab="innstillinger"]')?.click();
      await renderInnstillinger();
      await renderBrukerListe();
      await renderAdminFremdrift();
    }
  });

  el('leaderboardAktivertBtn').addEventListener('click', async () => {
    const nyVerdi = !adminInnstillingerCache.leaderboardAktivert;
    el('leaderboardAktivertBtn').disabled = true;
    try {
      adminInnstillingerCache = await window.ApiClient.settAdminInnstillinger({ leaderboardAktivert: nyVerdi });
      oppdaterLeaderboardKnapp();
      // Oppdaterer det mellomlagrede flagget window.ApiClient.erLeaderboardAktivert()
      // leser (satt av meg()) med en gang, slik at 🏆-ikonet dukker
      // opp/forsvinner uten at brukeren må laste appen på nytt selv.
      await window.ApiClient.meg();
      renderAccountPanel();
      showToast(nyVerdi ? 'Leaderboard er nå PÅ.' : 'Leaderboard er nå AV.');
    } catch (e) {
      showToast('Feil: ' + e.message);
    } finally {
      el('leaderboardAktivertBtn').disabled = false;
    }
  });

  // Lagt til v0.1.3 sammen med forventetDeltakere-fiksen (arkitektur.md
  // ADR 12) — samme lagre-knapp-mønster som resten av admin-innstillingene,
  // men et talledit-felt i stedet for en av/på-bryter.
  el('forventetDeltakereLagreBtn').addEventListener('click', async () => {
    const input = el('forventetDeltakereInput');
    const verdi = parseInt(input.value, 10);
    if (!Number.isFinite(verdi) || verdi < 0) { showToast('Skriv inn et heltall ≥ 0.'); return; }
    el('forventetDeltakereLagreBtn').disabled = true;
    try {
      adminInnstillingerCache = await window.ApiClient.settAdminInnstillinger({ forventetDeltakere: verdi });
      showToast(`Forventet antall deltakere satt til ${verdi}.`);
    } catch (e) {
      showToast('Feil: ' + e.message);
    } finally {
      el('forventetDeltakereLagreBtn').disabled = false;
    }
  });
}

async function renderInnstillinger(){
  const lbBtn = el('leaderboardAktivertBtn');
  lbBtn.disabled = true;
  lbBtn.textContent = 'Laster …';
  try {
    adminInnstillingerCache = await window.ApiClient.hentAdminInnstillinger();
  } catch (e) {
    lbBtn.textContent = 'Kunne ikke laste innstilling';
    return;
  }
  oppdaterLeaderboardKnapp();
  el('forventetDeltakereInput').value = adminInnstillingerCache.forventetDeltakere || 0;
  lbBtn.disabled = false;
}

function oppdaterLeaderboardKnapp(){
  const btn = el('leaderboardAktivertBtn');
  btn.textContent = adminInnstillingerCache.leaderboardAktivert
    ? 'Skru av leaderboard'
    : 'Skru på leaderboard';
}

let visSlettedeBrukere = false;

async function renderBrukerListe(){
  const container = el('brukerList');
  container.innerHTML = '<p class="hint">Laster …</p>';
  let brukere;
  try {
    brukere = await window.ApiClient.hentBrukere();
  } catch (e) {
    container.innerHTML = `<p class="hint">Kunne ikke hente brukerliste: ${escapeHtml(e.message)}</p>`;
    return;
  }

  const slettede = brukere.filter(b => b.slettet_tidspunkt);
  const synlige = visSlettedeBrukere ? brukere : brukere.filter(b => !b.slettet_tidspunkt);

  const toggleHtml = slettede.length
    ? `<button id="brukerVisSlettedeBtn" class="linkBtn">${visSlettedeBrukere ? 'Skjul' : 'Vis'} ${slettede.length} slettet${slettede.length === 1 ? '' : 'e'}</button>`
    : '';
  const listeHtml = synlige.map((b) => {
    const slettetPermanent = !!b.slettet_tidspunkt;
    const erSelv = brukerCache && b.kortnavn === brukerCache.kortnavn;
    return `
      <div class="findRow" style="display:flex;flex-direction:column;align-items:stretch;gap:6px">
        <div><strong>${escapeHtml(b.kortnavn)}</strong> <span class="hint">${escapeHtml(b.rolle)}</span></div>
        <div class="hint">${slettetPermanent ? 'permanent slettet' : b.status} · registrert ${new Date(b.opprettet.replace(' ', 'T') + 'Z').toLocaleDateString('no-NO')}</div>
        <div class="sheetActions">
          <button class="secondaryBtn" data-handling="status" data-id="${b.id}" data-neste="${b.status === 'aktiv' ? 'deaktivert' : 'aktiv'}"
            ${slettetPermanent || erSelv ? 'disabled' : ''}>${b.status === 'aktiv' ? 'Deaktiver' : 'Reaktiver'}</button>
          <button class="secondaryBtn" data-handling="slett" data-id="${b.id}"
            ${slettetPermanent || erSelv ? 'disabled' : ''}>Slett permanent</button>
        </div>
      </div>`;
  }).join('') || '<p class="hint">Ingen brukere.</p>';
  container.innerHTML = toggleHtml + listeHtml;

  const brukerVisSlettedeBtn = el('brukerVisSlettedeBtn');
  if (brukerVisSlettedeBtn) {
    brukerVisSlettedeBtn.addEventListener('click', () => {
      visSlettedeBrukere = !visSlettedeBrukere;
      renderBrukerListe();
    });
  }

  container.querySelectorAll('[data-handling="status"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await window.ApiClient.settBrukerStatus(btn.dataset.id, btn.dataset.neste);
        await renderBrukerListe();
      } catch (e) {
        showToast('Feil: ' + e.message);
      }
    });
  });
  container.querySelectorAll('[data-handling="slett"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Slette denne brukeren permanent? Kortnavnet fjernes for godt — kan ikke angres.')) return;
      try {
        await window.ApiClient.slettBrukerPermanent(btn.dataset.id);
        showToast('Bruker slettet.');
        await renderBrukerListe();
      } catch (e) {
        showToast('Feil: ' + e.message);
      }
    });
  });
}

async function renderAdminFremdrift(){
  const container = el('adminFremdriftListe');
  container.innerHTML = '<p class="hint">Laster …</p>';
  let oversikt;
  try {
    oversikt = await window.ApiClient.hentAdminFremdrift();
  } catch (e) {
    container.innerHTML = `<p class="hint">Kunne ikke hente fremdrift-oversikt: ${escapeHtml(e.message)}</p>`;
    return;
  }

  container.innerHTML = oversikt.map((b) => `
    <div class="findRow" style="display:flex;flex-direction:column;align-items:stretch;gap:2px;${b.status === 'aktiv' ? '' : 'opacity:0.55'}">
      <div><strong>${escapeHtml(b.kortnavn)}</strong> <span class="hint">${b.status === 'aktiv' ? '' : '(deaktivert)'}</span></div>
      <div class="hint">${b.poengsum} poeng · ${b.antallMerkerOppnadd}/${b.antallMerkerTotalt} merker · ${b.antallArter} arter</div>
    </div>`).join('') || '<p class="hint">Ingen brukere ennå.</p>';
}

// ---------- artsforslag ----------

function speciesResultButtonHtml(s, i){
  return `<button class="speciesResult" data-i="${i}">
    ${escapeHtml(s.norsk)} <em>${escapeHtml(s.latinsk)}</em>
    <span class="speciesType">${escapeHtml(s.artstype || 'ukjent type')}</span>
  </button>`;
}

function buildSpeciesHintList(){
  // Ingen lokal Artskart-observasjonscache i Ramme v1 (Sjeldenhetsjeger-
  // datagrunnlaget, se arkitektur.md ADR 8/veien-videre.md — anbefalt, ikke
  // bygget) — hintlisten er derfor kun det kuraterte artsutvalget selv,
  // uten plausibilitets-vekting.
  return speciesCache.map(s => ({ norsk: s.norsk, latinsk: s.latinsk, artstype: s.artstype, plausibilitet: 0 }));
}

// ---------- registreringsflyt ----------
// Forenklet fra Bondøya: INGEN bilde-beskjæring-før-KI-steg (se README
// "Bevisste forenklinger") — KI kjører alltid på hele det komprimerte
// bildet. Kamera + kamerarull (med EXIF-lesing) er begge med.

function wireRegisterFlow(){
  el('fabRegister').addEventListener('click', () => startRegistration(false));
  el('fabGallery').addEventListener('click', () => startRegistration(true));
  el('cameraInput').addEventListener('change', onImageCaptured);
  el('galleryInput').addEventListener('change', onImageCaptured);
}

function startRegistration(fraGalleri){
  if (!brukerCache) {
    showToast('Logg inn for å registrere funn.');
    toggleSheet('accountPanel', true);
    return;
  }
  pendingImageBlob = null;
  pendingPosition = null;
  pendingPositionKilde = null;
  pendingTimestamp = null;
  pendingKiResultat = null;
  pendingArt = null;
  pendingEntry = null;
  if (!fraGalleri && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => { pendingPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude }; pendingPositionKilde = 'gps'; },
      () => { /* la brukeren velge i kart i stedet */ },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
  const input = fraGalleri ? el('galleryInput') : el('cameraInput');
  input.value = '';
  input.click();
}

function pickPositionOnMap(){
  if (!mapCtx) { showToast('Kartet er ikke tilgjengelig akkurat nå.'); return; }
  toggleSheet('registerPanel', false);
  showToast('Trykk i kartet der bildet ble tatt');
  mapCtx.map.once('click', (e) => {
    pendingPosition = { lat: e.latlng.lat, lon: e.latlng.lng };
    pendingPositionKilde = 'manuell';
    toggleSheet('registerPanel', true);
    renderRegisterPanel({ scanning: false });
  });
}

async function extractExif(file){
  if (!window.exifr) return {};
  let gps, dato;
  try { gps = await window.exifr.gps(file); } catch (e) { console.debug('EXIF: ingen GPS-data', e); }
  try {
    const parsed = await window.exifr.parse(file);
    dato = parsed && (parsed.DateTimeOriginal || parsed.CreateDate);
  } catch (e) { console.debug('EXIF: ingen dato-data', e); }
  return { gps, dato };
}

async function onImageCaptured(e){
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const fraGalleri = e.target.id === 'galleryInput';

  if (fraGalleri) {
    const { gps, dato } = await extractExif(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      pendingPosition = { lat: gps.latitude, lon: gps.longitude };
      pendingPositionKilde = 'exif';
    }
    if (dato instanceof Date && !isNaN(dato)) pendingTimestamp = dato;
  }

  pendingImageBlob = await compressImage(file);
  toggleSheet('registerPanel', true);
  await kjorKiGjenkjenning();
}

async function kjorKiGjenkjenning(){
  renderRegisterPanel({ scanning: true });
  try {
    const hint = buildSpeciesHintList();
    pendingKiResultat = await window.KiClient.gjenkjenn(pendingImageBlob, hint);
    console.debug('KI-svar', pendingKiResultat);
  } catch (err) {
    console.warn('KI-gjenkjenning feilet', err);
    pendingKiResultat = null;
  }
  renderRegisterPanel({ scanning: false });
}

// Skalerer ned og komprimerer bildet client-side før opplasting (maks
// 1600px lengste side, JPEG q~0.8).
function compressImage(file){
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxSide = 1600;
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        const scale = maxSide / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => { URL.revokeObjectURL(url); resolve(blob); }, 'image/jpeg', 0.8);
    };
    img.src = url;
  });
}

const FOTOTIPS_HTML = `
  <div class="fototips">
    <strong>Tips for et lettere gjenkjennelig bilde:</strong>
    <ul>
      <li>Kom så nært som mulig uten å forstyrre dyret/planten</li>
      <li>Sørg for godt lys, unngå sterk motlys</li>
      <li>Fokuser på selve arten, ikke bakgrunnen</li>
      <li>Hold kameraet i ro</li>
    </ul>
  </div>`;

function renderRegisterPanel(state){
  const c = el('registerContent');
  const previewUrl = pendingImageBlob ? URL.createObjectURL(pendingImageBlob) : null;

  if (state.scanning) {
    c.innerHTML = `
      <div class="scanWrap">
        <img src="${previewUrl}" class="scanImg" alt="">
        <div class="scanLine"></div>
      </div>
      <p class="hint">KI analyserer bildet …</p>`;
    return;
  }

  if (state.feilet) {
    c.innerHTML = `
      <img src="${previewUrl}" class="previewImg" alt="">
      <p class="hint">Kunne ikke lagre funnet: ${escapeHtml(state.feilmelding || 'ukjent feil')}.</p>
      <div class="sheetActions">
        <button id="provIgjenBtn" class="primaryBtn">Prøv igjen</button>
        <button id="cancelFindBtn" class="secondaryBtn">Avbryt</button>
      </div>`;
    el('provIgjenBtn').addEventListener('click', () => lagreEntry(pendingEntry));
    el('cancelFindBtn').addEventListener('click', () => toggleSheet('registerPanel', false));
    return;
  }

  const beste = pendingKiResultat && pendingKiResultat.beste;
  const autoVelg = pendingKiResultat && pendingKiResultat.autoVelg;
  const alternativer = (pendingKiResultat && pendingKiResultat.alternativer) || [];

  let kiHtml = '';
  if (beste && autoVelg) {
    kiHtml = `
      <div class="kiCard kiCardAuto">
        <strong>${escapeHtml(beste.art.norsk)}</strong>
        <span class="konfidensBadge">${Math.round(beste.konfidens*100)} %</span>
        <p class="hint">KI er ganske sikker — bekreft eller velg en annen art under.</p>
      </div>`;
  } else if (alternativer.length) {
    kiHtml = `
      <p class="hint">KI er usikker — velg riktig alternativ:</p>
      <div class="candidateCards">
        ${alternativer.map((a, i) => `
          <button class="candidateCard" data-idx="${i}">
            <strong>${escapeHtml(a.norsk)}</strong>
            <span class="artstypeBadge">${escapeHtml(a.artstype || '')}</span>
            <span class="konfidensBadge">${Math.round((a.konfidens||0)*100)} %</span>
            ${a.saertrekk ? `<span class="saertrekk">${escapeHtml(a.saertrekk)}</span>` : ''}
          </button>`).join('')}
      </div>
      ${FOTOTIPS_HTML}`;
  } else {
    kiHtml = `<p class="hint">Fant ikke arten automatisk. Velg art manuelt under.</p>${FOTOTIPS_HTML}`;
  }

  const kildeLabel = { gps: '(GPS)', exif: '(fra bildet)', manuell: '(valgt manuelt)' }[pendingPositionKilde] || '';
  const posHtml = pendingPosition
    ? `📍 ${pendingPosition.lat.toFixed(5)}, ${pendingPosition.lon.toFixed(5)} <span class="hint">${kildeLabel}</span> <button id="changePosBtn" class="linkBtn">endre</button>`
    : `<button id="pickPosBtn" class="secondaryBtn">📍 Velg posisjon i kart</button>`;

  const datoValue = toDatetimeLocalValue(pendingTimestamp || new Date());

  c.innerHTML = `
    <img src="${previewUrl}" class="previewImg" alt="">
    ${kiHtml}
    <div id="posStatus" class="posStatus">${posHtml}</div>
    <label for="findDato">Tidspunkt</label>
    <input id="findDato" type="datetime-local" value="${datoValue}">
    <label for="speciesSearch">Søk art manuelt</label>
    <input id="speciesSearch" type="text" placeholder="f.eks. havørn" autocomplete="off">
    <div id="speciesResults" class="speciesResults"></div>
    <div id="selectedSpecies" class="selectedSpecies"></div>
    <div class="sheetActions">
      <button id="saveFindBtn" class="primaryBtn" disabled>Lagre funn</button>
      <button id="cancelFindBtn" class="secondaryBtn">Avbryt</button>
    </div>`;

  const pickBtn = el('pickPosBtn') || el('changePosBtn');
  if (pickBtn) pickBtn.addEventListener('click', pickPositionOnMap);
  el('findDato').addEventListener('change', (ev) => {
    const d = new Date(ev.target.value);
    if (!isNaN(d)) pendingTimestamp = d;
  });

  if (!pendingArt && beste && autoVelg) {
    pendingArt = { norsk: beste.art.norsk, latinsk: beste.art.latinsk, artstype: beste.artstype, taxonId: beste.art.taxonId };
  }
  if (pendingArt) el('speciesSearch').value = pendingArt.norsk;
  updateSaveButton();
  renderSelectedSpecies();

  function setValgt(art){
    pendingArt = art;
    renderSelectedSpecies();
    updateSaveButton();
  }
  function renderSelectedSpecies(){
    el('selectedSpecies').innerHTML = pendingArt
      ? `Valgt: <strong>${escapeHtml(pendingArt.norsk)}</strong> <em>${escapeHtml(pendingArt.latinsk||'')}</em>`
      : '';
  }
  function updateSaveButton(){ el('saveFindBtn').disabled = !pendingArt || !pendingPosition; }

  c.querySelectorAll('.candidateCard').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = alternativer[Number(btn.dataset.idx)];
      setValgt({ norsk: a.norsk, latinsk: a.latinsk, artstype: a.artstype, taxonId: a.taxonId });
    });
  });

  function renderSpeciesResults(lokale, eksterne){
    const alle = [...lokale, ...eksterne];
    el('speciesResults').innerHTML =
      lokale.map((s, i) => speciesResultButtonHtml(s, i)).join('') +
      (eksterne.length ? '<p class="hint speciesResultsHint">Flere treff</p>' : '') +
      eksterne.map((s, i) => speciesResultButtonHtml(s, lokale.length + i)).join('');

    el('speciesResults').querySelectorAll('.speciesResult').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = alle[Number(btn.dataset.i)];
        setValgt({ norsk: s.norsk, latinsk: s.latinsk, artstype: s.artstype, taxonId: s.taxonId });
        el('speciesResults').innerHTML = '';
        el('speciesSearch').value = s.norsk;
      });
    });
  }

  let sokTimer = null;
  el('speciesSearch').addEventListener('input', (ev) => {
    const rawTerm = ev.target.value.trim();
    const term = rawTerm.toLowerCase();
    const lokaleTreff = term.length < 2 ? [] : speciesCache.filter(s =>
      s.norsk.toLowerCase().includes(term) || s.latinsk.toLowerCase().includes(term)
    ).slice(0, 6);
    renderSpeciesResults(lokaleTreff, []);

    clearTimeout(sokTimer);
    if (term.length < 2) return;
    sokTimer = setTimeout(async () => {
      const eksterneTreff = await window.ApiClient.sokArter(rawTerm);
      const lokaleNavn = new Set(lokaleTreff.map(s => s.norsk.toLowerCase()));
      const nyeTreff = eksterneTreff.filter(s => !lokaleNavn.has(s.norsk.toLowerCase()));
      if (el('speciesSearch').value.trim().toLowerCase() === term) {
        renderSpeciesResults(lokaleTreff, nyeTreff);
      }
    }, 300);
  });

  el('cancelFindBtn').addEventListener('click', () => toggleSheet('registerPanel', false));
  el('saveFindBtn').addEventListener('click', () => saveFind(pendingArt));
}

function fremdriftToastTekst(endring){
  if (!endring) return 'Funn registrert ✓';
  const { poengEndring, nyeMerker } = endring;
  if (nyeMerker && nyeMerker.length > 0) {
    const navn = nyeMerker.map(m => m.navn).join(', ');
    const flertall = nyeMerker.length > 1 ? 'nye merker' : 'nytt merke';
    return `🎉 Du fikk ${flertall}: ${navn}! (+${poengEndring} poeng)`;
  }
  return `Funn registrert ✓ (+${poengEndring} poeng)`;
}

function saveFind(art){
  const pos = pendingPosition;
  if (!pos) { showToast('Velg posisjon i kartet først.'); return; }

  pendingEntry = {
    art, artstype: art.artstype, lat: pos.lat, lon: pos.lon,
    tidspunkt: (pendingTimestamp || new Date()).toISOString(), imageBlob: pendingImageBlob,
    kiKonfidens: pendingKiResultat && pendingKiResultat.beste ? pendingKiResultat.beste.konfidens : 0,
    kiAlternativer: (pendingKiResultat && pendingKiResultat.alternativer) || []
  };
  return lagreEntry(pendingEntry);
}

// Ramme har INGEN offline-kø (se konsept.md ADR 7 / CLAUDE.md) — ved en
// mislykket innsending (offline eller en midlertidig serverfeil) vises et
// tydelig varsel med en manuell "Prøv igjen"-knapp i stedet, se
// renderRegisterPanel() sin state.feilet-gren. pendingImageBlob/pendingEntry
// beholdes uendret mellom forsøk slik at "Prøv igjen" faktisk sender det
// samme funnet på nytt, ikke et tomt skjema.
async function lagreEntry(entry){
  try {
    const nyttFunn = await window.ApiClient.opprettFunn(entry);
    toggleSheet('registerPanel', false);
    const harNyttMerke = nyttFunn.fremdriftEndring && nyttFunn.fremdriftEndring.nyeMerker.length > 0;
    showToast(fremdriftToastTekst(nyttFunn.fremdriftEndring), harNyttMerke ? 5500 : undefined);
    if (nyttFunn.erFørsteRegistrering) {
      harNoensinneRegistrertFunn = true;
      oppdaterA2HSVisning();
    }
    await refreshFromRepo();
  } catch (e) {
    console.warn('Lagring feilet', e);
    renderRegisterPanel({ feilet: true, feilmelding: e.message });
  }
}

// ---------- liste ----------

const SORTERINGER = [
  { v: 'nyeste', tekst: 'Nyeste' },
  { v: 'eldste', tekst: 'Eldste' },
  { v: 'alfabetisk', tekst: 'Alfabetisk' },
];

function wireListPanel(){
  el('listToggle').addEventListener('click', () => { renderList(); toggleSheet('listPanel'); });
  el('filterIndicator').addEventListener('click', () => { renderList(); toggleSheet('listPanel', true); });

  const visninger = ['alle', 'mine'];
  el('visningRow').innerHTML = visninger.map(v =>
    `<button class="filterChip${v===activeVisning?' active':''}" data-v="${v}">${v === 'mine' ? 'Mine funn' : 'Alle funn'}</button>`
  ).join('');
  el('visningRow').querySelectorAll('.filterChip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeVisning = btn.dataset.v;
      el('visningRow').querySelectorAll('.filterChip').forEach(b => b.classList.toggle('active', b === btn));
      renderFindsPaKart();
      renderList();
    });
  });

  el('filterSelect').innerHTML = ['alle', ...ARTSTYPER].map(t =>
    `<option value="${t}"${t===activeFilter?' selected':''}>${t === 'alle' ? 'Alle typer' : t.charAt(0).toUpperCase() + t.slice(1)}</option>`
  ).join('');
  el('filterSelect').onchange = () => {
    activeFilter = el('filterSelect').value;
    renderFindsPaKart();
    renderList();
  };

  el('sortSelect').innerHTML = SORTERINGER.map(s =>
    `<option value="${s.v}"${s.v===activeSort?' selected':''}>${escapeHtml(s.tekst)}</option>`
  ).join('');
  el('sortSelect').onchange = () => {
    activeSort = el('sortSelect').value;
    renderList();
  };
}

function synligeFunn(){
  return funnCache.filter(f =>
    (activeFilter === 'alle' || f.artstype === activeFilter) &&
    (activeVisning === 'alle' || f.erEgenRegistrering)
  );
}

function sorterteFunn(list){
  const sortert = list.slice();
  if (activeSort === 'nyeste') sortert.sort((a, b) => new Date(b.tidspunkt) - new Date(a.tidspunkt));
  else if (activeSort === 'eldste') sortert.sort((a, b) => new Date(a.tidspunkt) - new Date(b.tidspunkt));
  else if (activeSort === 'alfabetisk') sortert.sort((a, b) => (a.art?.norsk || '').localeCompare(b.art?.norsk || '', 'no'));
  return sortert;
}

function renderFindsPaKart(){
  if (mapCtx) renderFinds(mapCtx.map, mapCtx.findsLayer, synligeFunn(), 'alle');
  oppdaterFilterIndikator();
}

function oppdaterFilterIndikator(){
  const deler = [];
  if (activeFilter !== 'alle') deler.push(activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1));
  if (activeVisning !== 'alle') deler.push('Mine funn');

  const el_ = el('filterIndicator');
  if (deler.length) {
    el_.textContent = `🔍 ${deler.join(' · ')}`;
    el_.hidden = false;
  } else {
    el_.hidden = true;
  }
}

function findRowHtml(f){
  return `
    <button class="findRow" data-id="${f.id}">
      ${f.bildeUrl ? `<img src="${window.ApiClient.bildeUrl(f.id)}" class="findThumb" alt="" loading="lazy">` : '<div class="findThumb"></div>'}
      <span class="findRowText">
        <strong>${escapeHtml(f.art?.norsk || 'Ukjent')}</strong>
        <span class="hint">${new Date(f.tidspunkt).toLocaleDateString('no-NO')}${f.registrertAv ? ' · ' + escapeHtml(f.registrertAv) : ''}</span>
      </span>
    </button>`;
}

function renderList(){
  const liste = sorterteFunn(synligeFunn());
  el('findList').innerHTML = liste.map(findRowHtml).join('') || '<p class="hint">Ingen registrerte funn ennå.</p>';

  el('findList').querySelectorAll('.findRow').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = funnCache.find(x => String(x.id) === btn.dataset.id);
      if (f) { toggleSheet('listPanel', false); if (mapCtx) panToFind(mapCtx.map, f); openDetail(f); }
    });
  });
}

// ---------- artsdetaljer ----------

async function openDetail(funn){
  const s = speciesCache.find(sp => sp.latinsk === funn.art?.latinsk) || {};

  const bildeHtml = funn.bildeUrl
    ? `<img src="${window.ApiClient.bildeUrl(funn.id)}" class="detailImg" alt="">`
    : '';

  const artskartUrl = funn.art?.taxonId
    ? `https://artskart.artsdatabanken.no/#taxon/${funn.art.taxonId}`
    : s.artskartUrl;

  el('detailContent').innerHTML = `
    ${bildeHtml}
    <h2>${escapeHtml(funn.art?.norsk || 'Ukjent art')}</h2>
    <p><em>${escapeHtml(funn.art?.latinsk || s.latinsk || '')}</em></p>
    ${rodlisteBadge(funn.rodlistekategori || s.rodlisteNorge)}
    <p>Registrert: ${new Date(funn.tidspunkt).toLocaleString('no-NO')}${funn.registrertAv ? ' av ' + escapeHtml(funn.registrertAv) : ''}</p>
    ${artskartUrl ? `<a href="${escapeHtml(artskartUrl)}" target="_blank" rel="noopener">Se på Artsdatabanken →</a>` : ''}
    ${funn.erEgenRegistrering || funn.kanSlette ? `
      <div class="sheetActions">
        ${funn.erEgenRegistrering ? '<button id="redigerFunnBtn" class="secondaryBtn">Rediger</button>' : ''}
        ${funn.kanSlette ? '<button id="slettFunnBtn" class="secondaryBtn">Slett</button>' : ''}
      </div>
      <div id="redigerFunnForm" hidden></div>` : ''}`;
  toggleSheet('detailPanel', true);

  if (funn.erEgenRegistrering) el('redigerFunnBtn').addEventListener('click', () => renderRedigerFunnSkjema(funn));
  if (!funn.kanSlette) return;

  el('slettFunnBtn').addEventListener('click', async () => {
    if (!confirm(`Slette funnet «${funn.art?.norsk || 'Ukjent'}»? Dette kan ikke angres.`)) return;
    try {
      await window.ApiClient.slettFunn(funn.id);
      showToast('Funn slettet.');
      toggleSheet('detailPanel', false);
      await refreshFromRepo();
    } catch (e) {
      showToast('Kunne ikke slette: ' + e.message);
    }
  });
}

function renderRedigerFunnSkjema(funn){
  const container = el('redigerFunnForm');
  container.hidden = false;
  container.innerHTML = `
    <label for="redigerArtSok">Art — søk for å endre</label>
    <input id="redigerArtSok" type="text" placeholder="f.eks. havørn" autocomplete="off">
    <div id="redigerArtResultater" class="speciesResults"></div>
    <div id="redigerArtValgt" class="selectedSpecies"></div>
    <label for="redigerArtstype">Artstype</label>
    <select id="redigerArtstype">
      ${ARTSTYPER.map(t => `<option value="${t}">${t}</option>`).join('')}
    </select>
    <label for="redigerTidspunkt">Tidspunkt</label>
    <input id="redigerTidspunkt" type="datetime-local">
    <button id="redigerVelgPosisjonBtn" type="button" class="secondaryBtn">📍 Endre posisjon i kart</button>
    <div class="sheetActions">
      <button id="lagreRedigertBtn" class="primaryBtn">Lagre</button>
      <button id="avbrytRedigertBtn" class="secondaryBtn">Avbryt</button>
    </div>
    <p id="redigerNote" class="note"></p>`;

  let pendingRedigerArt = { norsk: funn.art?.norsk || '', latinsk: funn.art?.latinsk || '', artstype: funn.artstype, taxonId: funn.art?.taxonId };
  let redigerLat = funn.lat;
  let redigerLon = funn.lon;
  el('redigerArtSok').value = pendingRedigerArt.norsk;
  el('redigerArtstype').value = funn.artstype;
  el('redigerTidspunkt').value = toDatetimeLocalValue(new Date(funn.tidspunkt));

  function setValgt(art){
    pendingRedigerArt = art;
    el('redigerArtstype').value = art.artstype;
    renderValgtVisning();
  }
  function renderValgtVisning(){
    el('redigerArtValgt').innerHTML = pendingRedigerArt.norsk
      ? `Valgt: <strong>${escapeHtml(pendingRedigerArt.norsk)}</strong> <em>${escapeHtml(pendingRedigerArt.latinsk||'')}</em>`
      : '';
  }
  renderValgtVisning();

  function renderRedigerArtResultater(lokale, eksterne){
    const alle = [...lokale, ...eksterne];
    el('redigerArtResultater').innerHTML =
      lokale.map((s, i) => speciesResultButtonHtml(s, i)).join('') +
      (eksterne.length ? '<p class="hint speciesResultsHint">Flere treff</p>' : '') +
      eksterne.map((s, i) => speciesResultButtonHtml(s, lokale.length + i)).join('');

    el('redigerArtResultater').querySelectorAll('.speciesResult').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = alle[Number(btn.dataset.i)];
        setValgt({ norsk: s.norsk, latinsk: s.latinsk, artstype: s.artstype, taxonId: s.taxonId });
        el('redigerArtResultater').innerHTML = '';
        el('redigerArtSok').value = s.norsk;
      });
    });
  }

  let redigerSokTimer = null;
  el('redigerArtSok').addEventListener('input', (ev) => {
    const rawTerm = ev.target.value.trim();
    const term = rawTerm.toLowerCase();
    const lokaleTreff = term.length < 2 ? [] : speciesCache.filter(s =>
      s.norsk.toLowerCase().includes(term) || s.latinsk.toLowerCase().includes(term)
    ).slice(0, 6);
    renderRedigerArtResultater(lokaleTreff, []);

    clearTimeout(redigerSokTimer);
    if (term.length < 2) return;
    redigerSokTimer = setTimeout(async () => {
      const eksterneTreff = await window.ApiClient.sokArter(rawTerm);
      const lokaleNavn = new Set(lokaleTreff.map(s => s.norsk.toLowerCase()));
      const nyeTreff = eksterneTreff.filter(s => !lokaleNavn.has(s.norsk.toLowerCase()));
      if (el('redigerArtSok').value.trim().toLowerCase() === term) {
        renderRedigerArtResultater(lokaleTreff, nyeTreff);
      }
    }, 300);
  });

  el('avbrytRedigertBtn').addEventListener('click', () => { container.hidden = true; container.innerHTML = ''; });
  el('redigerVelgPosisjonBtn').addEventListener('click', () => {
    if (!mapCtx) { showToast('Kartet er ikke tilgjengelig akkurat nå.'); return; }
    toggleSheet('detailPanel', false);
    showToast('Trykk i kartet der funnet skal flyttes til');
    mapCtx.map.once('click', (e) => {
      redigerLat = e.latlng.lat;
      redigerLon = e.latlng.lng;
      toggleSheet('detailPanel', true);
      showToast('Ny posisjon valgt.');
    });
  });
  el('lagreRedigertBtn').addEventListener('click', async () => {
    if (!pendingRedigerArt.norsk) { el('redigerNote').textContent = 'Art (norsk navn) mangler.'; return; }
    if (el('redigerArtSok').value.trim().toLowerCase() !== pendingRedigerArt.norsk.toLowerCase()) {
      el('redigerNote').textContent = 'Velg en art fra søkeresultatene (eller avbryt endringen i søkefeltet) før du lagrer.';
      return;
    }

    const felter = {
      art_norsk: pendingRedigerArt.norsk,
      art_latinsk: pendingRedigerArt.latinsk || '',
      art_taxon_id: pendingRedigerArt.taxonId,
      artstype: el('redigerArtstype').value,
      lat: redigerLat, lon: redigerLon,
      tidspunkt: new Date(el('redigerTidspunkt').value).toISOString()
    };
    el('redigerNote').textContent = 'Lagrer …';
    try {
      const oppdatert = await window.ApiClient.oppdaterFunn(funn.id, felter);
      showToast('Funn oppdatert ✓');
      await refreshFromRepo();
      openDetail(oppdatert);
    } catch (e) {
      el('redigerNote').textContent = 'Feil: ' + e.message;
    }
  });
}

const RODLISTE_LABELS = {
  CR: 'Kritisk truet', EN: 'Sterkt truet', VU: 'Sårbar', NT: 'Nær truet'
};
function rodlisteBadge(kode){
  const label = RODLISTE_LABELS[kode];
  if (!label) return '';
  return `<p class="rodlisteBadge">⚠ Rødlistet: ${escapeHtml(label)} (${escapeHtml(kode)}) — Norsk rødliste 2021</p>`;
}

// ---------- ny-versjon-varsel (PWA/standalone) ----------
// Forket UENDRET (mønster) fra Bondøya — se der for hele
// GitHub-Pages-Fastly-cache-forbeholdet.
function versjonErNyere(server, kjorende){
  const a = server.split('.').map(Number);
  const b = kjorende.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

function wireVersionUpdateCheck(){
  const banner = el('updateBanner');
  if (!banner) return;
  const reloadBtn = el('updateReload');
  const dismissBtn = el('updateDismiss');
  const AVVIST_NOKKEL = 'ramme-oppdatering-avvist-for';
  let sjekkerNa = false;
  let intervallId = null;

  async function sjekkForNyVersjon(){
    if (sjekkerNa || !banner.hidden) return;
    sjekkerNa = true;
    try {
      const res = await fetch(location.origin + '/index.html', { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const m = html.match(/js\/app\.js\?v=([\d.]+)/);
      if (!m || !versjonErNyere(m[1], APP_VERSION)) return;
      if (localStorage.getItem(AVVIST_NOKKEL) === m[1]) return;
      banner.dataset.serverVersion = m[1];
      banner.hidden = false;
    } catch (e) {
      // Stille.
    } finally {
      sjekkerNa = false;
    }
  }

  reloadBtn.addEventListener('click', () => location.reload());
  dismissBtn.addEventListener('click', () => {
    if (banner.dataset.serverVersion) localStorage.setItem(AVVIST_NOKKEL, banner.dataset.serverVersion);
    banner.hidden = true;
  });

  function startPolling(){ if (!intervallId) intervallId = setInterval(sjekkForNyVersjon, 5 * 60 * 1000); }
  function stopPolling(){ if (intervallId) { clearInterval(intervallId); intervallId = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { sjekkForNyVersjon(); startPolling(); }
    else stopPolling();
  });
  if (document.visibilityState === 'visible') startPolling();
}

// ---------- "legg til på hjemskjermen" (PWA-installasjon) ----------
// Forket fra Bondøya, med ÉN presisert betingelse (konsept.md UX-beslutning
// 3): oppdaterA2HSVisning() krever nå BÅDE innlogget OG at brukeren har
// registrert minst ett funn noensinne (harNoensinneRegistrertFunn) — i
// tillegg til (ikke i stedet for) de eksisterende sjekkene. Unngår at
// innlogging og installasjonstilbud stables samtidig for 15-20 personer som
// starter i samme øyeblikk ved seminarstart.
let a2hsErIOS = false;
let a2hsErAndroid = false;
let a2hsDeferredPrompt = null;

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function a2hsKanVises(){
  return !!brukerCache && harNoensinneRegistrertFunn && !isStandalone() && !localStorage.getItem('ramme-a2hs-lukket');
}

function oppdaterA2HSVisning(){
  const banner = el('a2hsBanner');
  if (!banner || !banner.dataset.a2hsKlar) return;
  if (!a2hsKanVises()) { banner.hidden = true; return; }
  if (a2hsErAndroid && !a2hsDeferredPrompt) return;
  banner.hidden = false;
}

function wireA2HS(){
  const banner = el('a2hsBanner');
  if (!banner) return;
  if (isStandalone()) return;

  const textEl = el('a2hsText');
  const actionBtn = el('a2hsAction');
  const ua = navigator.userAgent || '';
  a2hsErIOS = /iphone|ipad|ipod/i.test(ua);
  a2hsErAndroid = /android/i.test(ua);
  if (!a2hsErIOS && !a2hsErAndroid) return;

  banner.dataset.a2hsKlar = '1';
  el('a2hsClose').addEventListener('click', () => {
    localStorage.setItem('ramme-a2hs-lukket', '1');
    banner.hidden = true;
  });

  if (a2hsErIOS) {
    textEl.innerHTML = 'Rask tilgang som en app — og du slipper å logge inn i nettleseren på nytt hver gang. Trykk <b>Del</b>-ikonet nederst i Safari, og velg <b>«Legg til på Hjemskjerm»</b>.';
    oppdaterA2HSVisning();
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    a2hsDeferredPrompt = e;
    actionBtn.hidden = false;
    oppdaterA2HSVisning();
  });
  actionBtn.addEventListener('click', async () => {
    if (!a2hsDeferredPrompt) return;
    actionBtn.disabled = true;
    a2hsDeferredPrompt.prompt();
    const valg = await a2hsDeferredPrompt.userChoice.catch(() => null);
    a2hsDeferredPrompt = null;
    if (valg && valg.outcome === 'accepted') {
      localStorage.setItem('ramme-a2hs-lukket', '1');
      banner.hidden = true;
    } else {
      actionBtn.disabled = false;
    }
  });
  setTimeout(() => {
    if (!a2hsDeferredPrompt) {
      textEl.textContent = 'Rask tilgang som en app — og du slipper å logge inn i nettleseren på nytt hver gang. Åpne meny-knappen (⋮) i nettleseren og velg «Legg til på startskjerm» / «Installer app».';
      oppdaterA2HSVisning();
    }
  }, 2500);
}

// ---------- sheets / UI-hjelpere ----------

function toggleSheet(id, force){
  const sheet = el(id);
  const show = force !== undefined ? force : sheet.hidden;
  ['listPanel','detailPanel','registerPanel','accountPanel','adminPanel','fremdriftPanel','leaderboardPanel'].forEach(other => {
    if (other !== id) el(other).hidden = true;
  });
  sheet.hidden = !show;
}

function wireSheetDismiss(){
  document.querySelectorAll('.sheetHandle').forEach(handle => {
    handle.addEventListener('click', () => { handle.parentElement.hidden = true; });
  });
}

let toastTimer = null;
function showToast(msg, varighetMs){
  const t = el('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, varighetMs || 3500);
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function toDatetimeLocalValue(date){
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

})();
