// js/ki-client.js
// Forket UENDRET (mønster) fra Bondøya. Tynn klient for KI-artsgjenkjenning.
// Snakker med ramme-api sin sesjonsbeskyttede /ki/gjenkjenn-rute (se
// worker/api/src/routes/ki.js), som selv videresender til Rammes EGEN,
// uavhengige KI-proxy (worker/ki-proxy/, se arkitektur.md ADR 3) og legger
// på den delte hemmeligheten server-side. Vet ingenting om hvilken KI-motor
// som brukes bak proxyen, kun kontrakten (bilde inn, strukturerte
// kandidater ut).
const KONFIDENS_AUTO_TERSKEL = 0.75; // over dette: velg automatisk. Under: vis alternativer.

// speciesHint: liste med { norsk, latinsk, artstype, plausibilitet } — bygget
// av app.js fra species.json, se buildSpeciesHintList() der.
async function gjenkjenn(imageBlob, speciesHint){
  const data = await window.ApiClient.gjenkjennArt(imageBlob, speciesHint);

  const kandidater = data.kandidater || [];
  const beste = kandidater[0] || null;
  const autoVelg = !!beste && beste.konfidens >= KONFIDENS_AUTO_TERSKEL;
  return {
    beste: beste ? { art: { norsk: beste.norsk, latinsk: beste.latinsk, taxonId: beste.taxonId }, konfidens: beste.konfidens, artstype: beste.artstype, saertrekk: beste.saertrekk } : null,
    alternativer: kandidater.slice(0, 3),
    autoVelg
  };
}

window.KiClient = { gjenkjenn, KONFIDENS_AUTO_TERSKEL };
