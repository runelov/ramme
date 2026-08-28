// Ny, egenskrevet logikk for Ramme (ADR 11 i arkitektur.md) — invitasjonskode
// + selvvalgt kortnavn + selvvalgt PIN, ikke en fork av Bondøyas
// beOmLenke()/verifiser(). Se CLAUDE.md "Test-strategi (fase 6)" for hvorfor
// beslutningslogikken her er skilt ut som rene funksjoner (tar inn allerede
// hentet data, gjør ingen D1/KV-I/O selv) — routes/auth.js kobler disse mot
// faktisk D1-oppslag/KV-lesing.
import { sha256Hex } from './crypto.js';

export const PIN_MIN_LENGDE = 6;
export const PIN_MAKS_LENGDE = 12; // øvre grense mot åpenbart feilbruk (limt inn tekst e.l.), ikke en sikkerhetsgrense i seg selv

// Kun sifre, lengde i [PIN_MIN_LENGDE, PIN_MAKS_LENGDE] — se arkitektur.md
// ADR 11 "PIN-lengde: 6 sifre, ikke 4" for begrunnelsen for minimumet.
export function erGyldigPin(pin) {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_MIN_LENGDE},${PIN_MAKS_LENGDE}}$`).test(pin);
}

// Hasher ALLTID innsendt PIN før sammenligning — aldri klartekst-mot-
// klartekst, aldri klartekst logget. Se sikkerhetssjekkliste-ramme.md
// "PIN lagres kun som hash, aldri i klartekst".
export async function sammenlignPin(innsendtPin, lagretHash) {
  const innsendtHash = await sha256Hex(innsendtPin);
  return innsendtHash === lagretHash;
}

// Kortnavn-kollisjons-/gjenopprettingsbeslutningen (ADR 11 "Kortnavn-
// kollisjon"). Tar inn (finnes kortnavnet fra før, er PIN-en riktig mot
// lagret hash — n.a. når kortnavnet ikke finnes) og returnerer én av tre
// utfall pluss en FERDIG feilmeldingstekst for avvisTvetydig.
//
// Sikkerhetsegenskapen ADR 11 krever: de to veiene inn til avvisTvetydig —
// (a) kortnavnet finnes og PIN-en er feil på EGEN konto, (b) kortnavnet
// finnes og tilhører NOEN ANDRE (samme "finnes fra før: ja, PIN feil"-
// inputform uansett hvilket av de to det faktisk er) — er umulige å skille
// på input-formen alene, og produserer derfor per konstruksjon bit-for-bit
// identisk resultat. Se test/lib/pin.test.js for at dette verifiseres
// eksplisitt, ikke bare antas av kodestrukturen.
export function avgjorRegistreringUtfall({ kortnavnFinnes, pinKorrekt }) {
  if (!kortnavnFinnes) {
    return { utfall: 'opprettNyKonto' };
  }
  if (pinKorrekt) {
    return { utfall: 'loggInnEksisterende' };
  }
  return {
    utfall: 'avvisTvetydig',
    feilmelding:
      'Dette kortnavnet er allerede i bruk. Hvis dette er din konto, sjekk PIN-en. Hvis ikke, velg et annet kortnavn.',
    statusKode: 401,
  };
}

// Normalisering brukt for kortnavn-oppslag (case-insensitiv unikhet) —
// lagres i en egen kortnavn_normalisert-kolonne (migrations/0001), det
// synlige kortnavnet beholder brukerens egen skrivemåte (store/små
// bokstaver) i UI/leaderboard.
export function normaliserKortnavn(kortnavn) {
  return (kortnavn || '').trim().toLowerCase();
}

// ---------- Admin-rolle ved registrering ----------
//
// REELL BUG funnet ved faktisk bruk (v0.1.4, se CHANGELOG.md): den
// opprinnelige INSERT-en i routes/auth.js hardkodet rolle='bruker' for
// ENHVER ny konto — ingen kode noe sted satte noen til 'admin'. Under
// Bondøyas gamle modell (admin oppretter alle kontoer manuelt via
// `wrangler d1 execute`) var ikke dette et problem — admin-kontoen ble
// opprettet med rolle='admin' i den kommandoen. Selvregistrering (ADR 11)
// fjernet den manuelle opprettelsen helt, uten å erstatte den med noen vei
// til admin-rollen — resultat: ingen kunne noensinne logge inn som admin,
// inkludert produkteier selv.
//
// Løsning: FØRSTE registrerte bruker (antallEksisterendeBrukere === 0 idet
// registreringen skjer) blir automatisk admin. Akseptert restrisiko,
// bevisst vurdert: hvis invitasjonskoden lekker FØR produkteier selv
// registrerer seg, kan i prinsippet en annen person "stjele" admin-rollen
// ved å registrere seg først. Lav reell risiko her — koden distribueres
// først til de 15-20 etter at produkteier allerede har satt opp appen (og
// dermed alt registrert seg selv først i praksis) — men noteres eksplisitt
// i arkitektur.md, ikke stilltiende akseptert. Et sjeldent race (to
// samtidige "første"-registreringer) kan i teorien gi to admins i stedet
// for én — ikke skadelig (admin kan uansett ikke skade andre enn ved
// bevisst moderasjon), ikke verdt kompleksiteten en atomisk sperre ville
// krevd på denne skalaen (15-20 brukere).
export function avgjorRolleVedRegistrering(antallEksisterendeBrukere) {
  return antallEksisterendeBrukere === 0 ? 'admin' : 'bruker';
}

export const KORTNAVN_MAKS_LENGDE = 30;

// Enkel lengde-/tegnbegrensning ved registrering, jf.
// sikkerhetssjekkliste-ramme.md "Selvvalgt kortnavn er en ny
// brukerinput-overflate" — i TILLEGG til (ikke i stedet for) escapeHtml()
// ved visning. Tillater bokstaver (inkl. norske æøå), tall, mellomrom og
// vanlig tegnsetting i navn (bindestrek, apostrof) — ingen HTML-
// spesialtegn.
export function erGyldigKortnavn(kortnavn) {
  const trimmet = (kortnavn || '').trim();
  if (trimmet.length < 1 || trimmet.length > KORTNAVN_MAKS_LENGDE) return false;
  return /^[\p{L}\p{N} .'-]+$/u.test(trimmet);
}
