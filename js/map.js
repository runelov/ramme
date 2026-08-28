// js/map.js
// Leaflet-kart begrenset til Ramme-eiendommen (Hvitsten, Vestby kommune) —
// forket fra Bondøyas js/map.js, men FORENKLET: kun Kartverket topografisk
// (gratis, tokenfritt), INGEN Mapbox-satellittlag/flis-proxy. Dette er en
// bevisst, dokumentert forenkling for v1 (se README.md "Bevisste
// forenklinger") — ikke nevnt som et krav i konsept.md/arkitektur.md, og
// koster en egen Mapbox-token-/kostnadsoppsett en ren topografisk visning
// ikke trenger for et 1-2 dagers hagepark-seminar. Enkel å legge til igjen
// senere (worker/api/src/routes/tiles.js-mønsteret finnes fortsatt i
// Bondøya som referanse) hvis produkteier ønsker satellittvisning.
//
// PLACEHOLDER, IKKE endelig — se veien-videre.md "Eksakt kartavgrensning":
// senterpunktet (59.5985391°N, 10.6553105°E) er hentet fra artsliste.md sin
// geokoding av "Ramme fjord-hotel" (OpenStreetMap Overpass 2026-08-26).
// maxBounds/minZoom under er en grov, praktisk boks rundt dette punktet —
// IKKE en oppmålt eiendomsgrense. Avklares med produkteier/befaring.
const RAMME_SENTRUM = L.latLngBounds(
  [59.5945, 10.6420],
  [59.6025, 10.6690]
);

// Snevrere boks brukt kun til startvisningen (fitBounds), slik at tunet/
// parken fyller skjermen ved åpning i stedet for å drukne i et for stort
// utsnitt — samme "startvisning vs. ytre panoreringsgrense"-idé som
// Bondøyas BONDOYA_BOUNDS/ISLANDS_BOUNDS.
//
// STRAMMET INN 2026-08-28 (rapportert bug): senterpunktet var matematisk
// riktig (gjennomsnittet av boksen under er 59.5985/10.6555, ~15m fra det
// Overpass-verifiserte Ramme-punktet — ingen koordinatfeil), men den
// opprinnelige boksen (~850×670m) var vid nok til at store deler av selve
// Hvitsten sentrum også var synlig ved åpning — uten et satellittlag (se
// README.md "Bevisste forenklinger", ingen Mapbox i v1) gir det topografiske
// kartet ingen visuell markør som skiller eiendommen fra tettstedet rundt,
// så det så ut som "sentrert på Hvitsten" selv om tallene stemte. Denne
// boksen er fortsatt en PLACEHOLDER (~330×225m rundt punktet, ikke en
// oppmålt eiendomsgrense) — se veien-videre.md "Eksakt kartavgrensning".
const START_BOUNDS = L.latLngBounds(
  [59.5970, 10.6533],
  [59.6001, 10.6573]
);

const TOPO_MAX_ZOOM = 18;

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
  map.setMaxZoom(TOPO_MAX_ZOOM);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Kartverket topografisk — eneste kartlag i v1 (se toppkommentaren).
  L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: TOPO_MAX_ZOOM,
    attribution: '&copy; Kartverket'
  }).addTo(map);

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

  // Ingen innlogget/uinnlogget kartlag-forskjell i Ramme (ingen offentlig
  // lag, ingen Mapbox-lagvelger) — settInnloggingsstatus() beholdes som en
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
