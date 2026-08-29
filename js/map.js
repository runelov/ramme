// js/map.js
// Leaflet-kart begrenset til Ramme-eiendommen (Hvitsten, Vestby kommune) —
// forket fra Bondøyas js/map.js, men FORENKLET: kun Kartverket topografisk
// (gratis, tokenfritt) i utgangspunktet, INGEN Mapbox-satellittlag/
// flis-proxy (Bondøyas betalte, sesjonsbeskyttede løsning). Dette var en
// bevisst, dokumentert forenkling for v1 (se README.md "Bevisste
// forenklinger") — ikke nevnt som et krav i konsept.md/arkitektur.md.
//
// OPPDATERT 2026-08-29 — lagvelgeren lagt til likevel, produkteier savnet
// den fra Bondøya. Undersøkt grundig FØR noe ble bygget (se CHANGELOG.md):
// Kartverkets EGEN flyfoto-tjeneste er IKKE faktisk gratis/tokenfri slik
// topo-laget er — verifisert direkte mot tre reelle endepunkter:
//   - cache.kartverket.no (samme tjeneste som topo-laget under) har
//     KUN topo/topograatone/toporaster/sjøkartraster — ingen flyfoto,
//     bekreftet mot tjenestens egen WMTSCapabilities.xml.
//   - tilecache.norgeibilder.no (den faktiske flyfoto-tjenesten) svarte
//     `{"error":{"code":499,"message":"Token Required"}}` på et ekte kall.
//   - wms.geonorge.no/skwms1/wms.nib* (eldre WMS-variant) svarte med en
//     ekte autentiseringsfeil — IP-hvitelisting for Norge digitalt-
//     partnere, ikke åpent for alle. Selv token-siden
//     (services.norgeibilder.no/token) krever et eksisterende ArcGIS
//     Enterprise-brukernavn/passord, ikke selvbetjent registrering.
// Endte i stedet på Esri sin World Imagery — en global satellittjeneste
// som FAKTISK er gratis og tokenfri (ingen konto, ingen nøkkel), verifisert
// med et ekte flis-kall over Ramme sin egen posisjon før dette ble bygget
// inn. Ulempen: Esri-merket (ikke Kartverket), og trolig lavere/eldre
// oppløsning enn et ekte norsk flyfoto-opptak — akseptabel avveining for et
// gratis alternativ til et 1-2 dagers seminar, ikke en løsning å bygge
// videre på for et produkt som trenger ekte norsk ortofoto-kvalitet (se
// "Engangsverktøy eller gjenbruk?" — vurder Mapbox eller en faktisk
// Norge-digitalt-avtale da).
//
// RETTET 2026-08-28 — FEIL ANKERPUNKT OPPDAGET av produkteier, ikke bare
// unøyaktig: forrige senterpunkt (59.5985391°N, 10.6553105°E, en OSM-node
// merket "Ramme fjord-hotel", valgt av Claude UTEN å bekrefte med
// produkteier) lå i Hvitsten sentrum, ikke ved selve Ramme Gård/basen for
// seminaret. Nytt senterpunkt er produkteiers EGEN Google Maps-lenke
// ("Rammeveien 100", https://maps.app.goo.gl/NJavBqWLMofNiCrBA, løst opp
// til 59.6089546°N/10.6543468°E) — ca. 1,2 km nord for det gamle,
// feilaktige punktet. Se memory "geografiske-valg-krever-bekreftelse":
// stedsspesifikke geografiske valg skal bekreftes med produkteier FØR de
// bygges videre på, ikke antas fra en offentlig kartdatabase alene.
//
// OPPDATERT 2026-08-29 — produkteier har selv tegnet og bekreftet de
// faktiske Rammevandrer-sonene i Google My Maps (satellittbilde), se
// data/soner-ramme.json og CHANGELOG.md. Grensene under er nå satt til å
// romme alle seks sonenes faktiske utstrekning (lat 59.6014–59.6111,
// lon 10.6501–10.6568), IKKE lenger en gjettet boks rundt ett enkelt
// punkt — Strandsonen og Rammeveien strekker seg vesentlig lenger sør enn
// det forrige (fortsatt placeholder-baserte) utsnittet dekket, og ville
// vært utenfor panorerings-grensen uten denne utvidelsen.
const RAMME_SENTRUM = L.latLngBounds(
  [59.5989, 10.6461],
  [59.6136, 10.6608]
);

// Snevrere boks brukt kun til startvisningen (fitBounds), slik at
// eiendommen fyller skjermen ved åpning i stedet for å drukne i et for
// stort utsnitt — samme "startvisning vs. ytre panoreringsgrense"-idé som
// Bondøyas BONDOYA_BOUNDS/ISLANDS_BOUNDS. Satt til faktisk sone-utstrekning
// + liten buffer, ikke en gjettet størrelse.
const START_BOUNDS = L.latLngBounds(
  [59.6006, 10.6486],
  [59.6119, 10.6583]
);

// Felles maks-zoom for begge kartlag under (Leafletes map.setMaxZoom() er
// ett globalt tak uansett — å ha to ulike per-lag-tall ville uansett vært
// begrenset av det laveste ved lagbytte). Navnet er ikke lenger
// "TOPO_"-spesifikt siden Esri-laget (se toppkommentaren) kom til.
const MAX_ZOOM = 18;

function initMap(){
  const map = L.map('map', {
    zoomControl: false,
    maxBounds: RAMME_SENTRUM,
    maxBoundsViscosity: 1.0
  });

  try {
    map.fitBounds(START_BOUNDS, { padding: [20, 20] });
    map.setMinZoom(map.getBoundsZoom(RAMME_SENTRUM));
  } catch (e) {
    // Se Bondøyas js/map.js for hvorfor map.remove() er nødvendig her (0x0
    // container ved første forsøk) — portert uendret.
    map.remove();
    throw e;
  }
  map.setMaxZoom(MAX_ZOOM);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Kartverket topografisk — default-laget, uendret fra før lagvelgeren
  // kom til (se toppkommentaren).
  const topo = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: MAX_ZOOM,
    attribution: '&copy; Kartverket'
  }).addTo(map);

  // Esri World Imagery — gratis/tokenfri satellittvisning, se
  // toppkommentaren for hvorfor dette (ikke Kartverkets eget flyfoto) ble
  // valgt. IKKE lagt til på kartet by default — kun tilgjengelig via
  // lagvelgeren under, samme "topo er default"-oppførsel som Bondøya.
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: MAX_ZOOM,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  });

  // bottomleft: Leafletes standard topright/bottomright kolliderer med
  // appens egne topplinje-knapper og GPS/zoom-knappene — bottomleft er
  // ledig (samme plassvalg som Bondøyas layersControl). Ingen
  // innlogget/uinnlogget-gate her (til forskjell fra Bondøyas Mapbox-lag,
  // som er sesjonsbeskyttet fordi det koster penger per flis) — begge
  // lagene her er gratis og åpne uansett innloggingsstatus.
  L.control.layers(
    { 'Kartverket (terreng)': topo, 'Esri (satellitt)': satellite },
    {},
    { position: 'bottomleft' }
  ).addTo(map);

  const sonerLayer = L.layerGroup().addTo(map);
  const findsLayer = L.layerGroup().addTo(map);

  let meMarker = null;
  function showMyPosition(){
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.circleMarker([latitude, longitude], {
        radius: 8, color: '#0a84ff', fillColor: '#0a84ff', fillOpacity: 0.9, weight: 3
      }).addTo(map).bindPopup('Du er her').openPopup();
      map.panTo([latitude, longitude]);
    }, err => {
      console.warn('Kunne ikke hente posisjon', err);
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  const locateBtn = L.control({ position: 'bottomright' });
  locateBtn.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar locateBtn');
    div.innerHTML = '📍';
    div.title = 'Min posisjon';
    div.onclick = (e) => { e.stopPropagation(); showMyPosition(); };
    return div;
  };
  locateBtn.addTo(map);

  // OPPDATERT 2026-08-29: Ramme HAR nå en lagvelger (se toppkommentaren),
  // men fortsatt ingen innlogget/uinnlogget kartlag-forskjell — begge
  // lagene (Kartverket topo, Esri satellitt) er gratis og åpne uansett
  // innloggingsstatus, til forskjell fra Bondøyas betalte Mapbox-lag som
  // faktisk trenger denne sjekken. settInnloggingsstatus() beholdes som en
  // no-op-funksjon kun for å holde samme kall-kontrakt som app.js allerede
  // bruker (renderAccountPanel() kaller den ubetinget).
  function settInnloggingsstatus(){ /* ingen lagbytte nødvendig i Ramme */ }

  return { map, findsLayer, sonerLayer, showMyPosition, settInnloggingsstatus };
}

// Lett, valgfri kartmarkering av Rammevandrer-sonene (ux-skisse.md funn 4:
// "gjør mekanikken synlig, ikke skjult" — lav prioritet, ikke blokkerende,
// men billig å bygge siden Leaflet allerede støtter polygoner nativt).
// soner: samme data/soner-ramme.json-format som worker/api/src/lib/oyer.js
// leser server-side ([{id, navn, polygon: [[lat,lon],...]}]) — polygon-
// punktene er allerede [lat,lon], samme rekkefølge Leaflet forventer.
function renderSonerPaKart(sonerLayer, soner){
  sonerLayer.clearLayers();
  (soner || []).forEach((sone) => {
    const polygon = L.polygon(sone.polygon, {
      color: '#0a84ff', weight: 2, fillColor: '#0a84ff', fillOpacity: 0.08, dashArray: '6 4'
    });
    polygon.bindTooltip(escapeHtml(sone.navn), { sticky: true });
    polygon.addTo(sonerLayer);
  });
}

const ARTSTYPE_COLORS = {
  fugl: '#0a84ff',
  sjøpattedyr: '#8e8e93',
  pattedyr: '#5e5ce6',
  alge: '#34c759',
  plante: '#ff9500',
  sopp: '#a2845e',
  fisk: '#30b0c7',
  bløtdyr: '#ff375f',
  krepsdyr: '#ff3b30',
  insekt: '#d9a521',
  edderkoppdyr: '#3a3a3c',
  krypdyr: '#7c9a3c',
  amfibium: '#14b8a6',
  nesledyr: '#7c2d78',
  pigghud: '#5c6b73',
  leddorm: '#8b4513',
  annet: '#af52de'
};

function renderFinds(map, findsLayer, funn, activeFilter){
  findsLayer.clearLayers();
  funn
    .filter(f => !activeFilter || activeFilter === 'alle' || f.artstype === activeFilter)
    .forEach(f => {
      const color = ARTSTYPE_COLORS[f.artstype] || ARTSTYPE_COLORS.annet;
      const marker = L.circleMarker([f.lat, f.lon], {
        radius: 9, color, fillColor: color, fillOpacity: 0.85, weight: 2,
        bubblingMouseEvents: false
      });

      const popup = L.popup({ closeButton: false, autoPan: false, offset: [0, -6] }).setContent(
        `<strong>${escapeHtml(f.art?.norsk || 'Ukjent art')}</strong><br>` +
        `<em>${escapeHtml(f.art?.latinsk || '')}</em><br>` +
        new Date(f.tidspunkt).toLocaleDateString('no-NO')
      );
      marker.on('mouseover', () => popup.setLatLng(marker.getLatLng()).openOn(map));
      marker.on('mouseout', () => map.closePopup(popup));
      marker.on('click', () => window.dispatchEvent(new CustomEvent('funn:selected', { detail: f })));
      marker.addTo(findsLayer);
    });
}

function panToFind(map, f){
  map.setView([f.lat, f.lon], Math.max(map.getZoom(), 17));
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
