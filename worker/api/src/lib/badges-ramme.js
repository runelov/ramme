// Ny, egenskrevet logikk for Ramme (ingen Bondøya-ekvivalent) — se
// konsept.md "Poeng og badges — Ramme-tilpasset" og CLAUDE.md "Test-strategi
// (fase 6)". Rene funksjoner av allerede hentet data (ikke egne D1-spørringer)
// nettopp for å være enkle å node:test-dekke uten D1/KV-oppsett, se
// worker/api/test/lib/badges-ramme.test.js.

// ---------- Rammevandrer (sone-dekning) ----------
//
// Trappetrinn skalert etter FAKTISK antall definerte soner (ikke et
// hardkodet tall) — data/soner-ramme.json er eksplisitt PLACEHOLDER og kan
// endre seg før seminaret (se veien-videre.md). Med N soner: trinn 1 ved
// halvparten (opprundet, minst 1), trinn 2 (toppnivå) ved ALLE soner. Med
// dagens 3 placeholder-soner gir det 2/3.
//
// besokteSoneIder: Set/array av sone-id-er brukeren har minst ett funn i.
// alleSoner: [{id, navn}, ...] — den fulle, gjeldende sonelisten.
//
// Et funn i en sone-ID som IKKE finnes i alleSoner lenger (utdatert
// sone-ID, f.eks. etter at soner-ramme.json er redigert) telles ALDRI med —
// bevisst fail-closed mot ukjente ID-er, ikke en krasj og ikke en for høy
// telling. Se testsettet for at nøyaktig dette er dekket eksplisitt.
export function beregnRammevandrerNiva(besokteSoneIder, alleSoner) {
  const gyldigeIder = new Set((alleSoner || []).map((s) => s.id));
  const besokt = new Set([...(besokteSoneIder || [])].filter((id) => gyldigeIder.has(id)));
  const totalt = gyldigeIder.size;
  const antallBesokt = besokt.size;

  // totalt === 0 (ingen soner definert i det hele tatt) — ingen trinn er
  // meningsfullt oppnåelig; unngå en falsk "toppnivå nådd" fra en
  // 0-av-0-sammenligning.
  if (totalt === 0) {
    return {
      antallBesokt: 0,
      totalt: 0,
      badges: [
        { nokkel: 'rammevandrer_1', navn: 'Rammevandrer', opptjent: false, progresjon: { naa: 0, mal: 0 } },
        { nokkel: 'rammevandrer_2', navn: 'Rammevandrer II', opptjent: false, progresjon: { naa: 0, mal: 0 } },
      ],
    };
  }

  const trinn1Mal = Math.max(1, Math.ceil(totalt / 2));
  const trinn2Mal = totalt;

  return {
    antallBesokt,
    totalt,
    badges: [
      {
        nokkel: 'rammevandrer_1',
        navn: 'Rammevandrer',
        opptjent: antallBesokt >= trinn1Mal,
        progresjon: { naa: antallBesokt, mal: trinn1Mal },
      },
      {
        nokkel: 'rammevandrer_2',
        navn: 'Rammevandrer II',
        opptjent: antallBesokt >= trinn2Mal,
        progresjon: { naa: antallBesokt, mal: trinn2Mal },
      },
    ],
  };
}

// ---------- Hele gjengen (kollektivt lagmerke) ----------
//
// antallMedFunn: COUNT(DISTINCT bruker_id) fra funn (kun aktive, ikke
// slettede brukere).
// antallAktiveBrukere: totalt antall aktive, ikke-slettede brukere.
//
// antallAktiveBrukere === 0 håndteres eksplisitt som "ikke oppnådd" — en
// naiv antallMedFunn >= antallAktiveBrukere-sammenligning ville gitt
// 0 >= 0 === true (alltid "oppnådd" før noen i det hele tatt har
// registrert seg), som er en produktfeil, ikke en teknisk detalj: badgen
// skal aldri fremstå oppnådd før det finnes noen å oppnå den sammen med.
export function erHeleGjengenOppnadd(antallMedFunn, antallAktiveBrukere) {
  if (!antallAktiveBrukere || antallAktiveBrukere <= 0) return false;
  return antallMedFunn >= antallAktiveBrukere;
}
