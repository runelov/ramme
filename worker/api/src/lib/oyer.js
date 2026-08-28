// Forket DIREKTE OG UENDRET fra Bondøya sin worker/api/src/lib/oyer.js — se
// arkitektur.md ADR 9. Selve point-in-polygon-oppslaget (erPunktIPolygon)
// er allerede generisk (tar et polygon som lat/lon-par, ikke noe
// Bondøya-spesifikt) og produksjonsverifisert der — kun datafilen er ny for
// Ramme (data/soner-ramme.json, foreløpig PLACEHOLDER-polygoner, se
// veien-videre.md "Endelig sonedefinisjon for Rammevandrer-badgen").
//
// Filnavnet (oyer.js — norsk for "øyer") er beholdt uendret fra Bondøya
// bevisst, selv om Ramme kaller konseptet "soner" i UI/badge-navn
// (Rammevandrer) — dette ER den forkede, uendrede filen ADR 9 sikter til,
// ikke en omskrevet kopi. Funksjonsnavnet finnOy() er beholdt av samme
// grunn (uendret kode, se CLAUDE.md "Arvet UENDRET fra Bondøya").
//
// Merk stien: Bondøya lagrer selve oyer-bondoya.json under
// worker/api/src/data/ (ikke det repo-rot-nivå data/-katalogen som
// data/species.json bruker); CLAUDE.md sin uttalte filstruktur for Ramme
// plasserer derimot soner-ramme.json i repo-rotens data/-katalog, sammen
// med species.json — importstien under følger DERFOR CLAUDE.md sin
// eksplisitte plassering (samme dybde som lib/artsvisibility.js sin import
// av species.json), ikke Bondøyas fysiske plassering. Kun stien er
// tilpasset, ikke oppslagsfunksjonen selv.
import soner from '../../../../data/soner-ramme.json' with { type: 'json' };

// Standard ray-casting point-in-polygon (odd-even-regel) — polygon er en
// liste [lat, lon]-par, første og siste punkt er identiske (lukket ring).
function erPunktIPolygon(lat, lon, polygon) {
  let inne = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const skjærer = (latI > lat) !== (latJ > lat) && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
    if (skjærer) inne = !inne;
  }
  return inne;
}

// Finner hvilken kjent sone et punkt faller innenfor, eller null hvis det
// ikke treffer noen av de definerte polygonene (upresis GPS, eller genuint
// utenfor eiendommen) — ingen buffer/toleranse, samme bevisste avgrensning
// som Bondøya sin finnOy().
export function finnOy(lat, lon) {
  for (const sone of soner) {
    if (erPunktIPolygon(lat, lon, sone.polygon)) return { id: sone.id, navn: sone.navn };
  }
  return null;
}

// Eksporterer også antall definerte soner — brukt av lib/badges-ramme.js sin
// Rammevandrer-trappetrinnsberegning til å skalere terskler etter faktisk
// sonetall i stedet for et hardkodet tall (soner-ramme.json kan endre seg
// når de endelige grensene avklares, se veien-videre.md).
export function alleSoner() {
  return soner.map((s) => ({ id: s.id, navn: s.navn }));
}
