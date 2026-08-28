# Endringslogg

Semver-ish (`## 0.x.0 — <kort tittel>`), samme mønster som Bondøya/FungiFinder.
Versjonsnummereringen starter på nytt fra `0.1.0` her — Ramme er en egen,
uavhengig repo-historie fra forgreningstidspunktet, følger ikke videre på
Bondøyas løpende versjonsnummer (se CLAUDE.md).

## 0.1.1 — To feil funnet ved faktisk mobiltesting

Rapportert av produkteier rett etter første live-deploy:

- **Bunnknapper (`.fab`/`.fabSecondary`) nesten skjult av iPhone sin
  knapperad** i vanlig mobil Safari (ikke installert som PWA).
  `--safe-bottom` (`env(safe-area-inset-bottom)`) dekker kun hjem-
  indikator-området, ikke Safaris eget adresse-/verktøylinje-krom. Fikset
  med en ny `--browser-chrome-bottom`-variabel satt dynamisk via
  `window.visualViewport` (`js/app.js` `wireDynamiskNettleserKromMargin()`)
  — måler faktisk dekket høyde i sanntid i stedet for å gjette et fast tall.
  0px (ingen endring) når appen kjøres installert, siden Safari-kromet da
  er borte.
- **Kartet så ut til å være sentrert på Hvitsten, ikke Ramme.**
  Senterpunktet var faktisk korrekt (~15m fra det Overpass-verifiserte
  Ramme-punktet) — problemet var at startvisning-boksen (~850×670m) var
  vid nok til å vise mye av selve Hvitsten sentrum også, og uten et
  satellittlag (se "Bevisste forenklinger") er det ingen visuell markør som
  skiller eiendommen fra tettstedet rundt. Strammet inn til ~330×225m
  (`js/map.js` `START_BOUNDS`) — fortsatt en placeholder, ikke en oppmålt
  eiendomsgrense, se veien-videre.md.

## 0.1.0 — Fase 7: første implementasjon (forgrening fra Bondøya)

Første commit av selve appen. Forgrenet fra `mittbondøya-workspace/bondoya`
sin struktur/mønstre, per `ramme-workspace/konsept.md`, `arkitektur.md` og
`CLAUDE.md`. Se README.md "Bevisste forenklinger" for hva som ER utelatt
og hvorfor, og "Kjent, ikke fullført" for hva som gjenstår før faktisk
deploy.

**Nytt, ikke arvet fra Bondøya:**
- Auth: invitasjonskode + selvvalgt kortnavn + selvvalgt PIN
  (`worker/api/src/routes/auth.js`, `lib/pin.js`, `lib/ratelimit.js`) — se
  arkitektur.md ADR 11. Ingen magic-link, ingen e-post i det hele tatt.
- `lib/cors.js`/`lib/session.js`: forket fra FungiFinders
  `SameSite=None`+`Origin`-sjekk-variant (ikke Bondøyas `SameSite=Lax`) —
  se arkitektur.md ADR 2.
- `lib/badges-ramme.js`: "Rammevandrer" (sonebasert trappetrinn, gjenbruker
  `lib/oyer.js` sin uendrede point-in-polygon-oppslag) og "Hele gjengen"
  (kollektivt lagmerke).
- `routes/leaderboard.js`: portert fra Bondøyas Fase D, med `EXISTS`-filter
  (kun funn-registrerte vises) og en kollektiv "X/Y har registrert"-teller.
- Eget 🏆-topbar-ikon/panel for leaderboardet (ikke gjemt i "Min fremdrift"
  slik Bondøya gjør det).
- A2HS-installasjonstilbudet vises først etter første vellykkede
  funn-registrering, ikke ved innlogging.
- `data/species.json`: 55 kuraterte arter for Ramme/Hvitsten (fra
  artsliste.md).
- `data/soner-ramme.json`: **PLACEHOLDER**-polygoner for Rammevandrer-sonene
  (Tunet, Havlystparken, Strandsonen) — IKKE endelige, se veien-videre.md.
- `worker/ki-proxy/`: egen, uavhengig kopi (ikke `ki.bondoya.no`), oppdatert
  stedsbeskrivelse i KI-prompten.
- `.githooks/pre-commit`: portert fra FungiFinder (ikke Bondøya), utvidet
  filtriplett.
- `worker/api/test/lib/*.test.js`: 37 `node:test`-enheter for PIN-hashing,
  kollisjons-/gjenopprettingsbeslutningen, rate-limit-telleren,
  Rammevandrer-trappetrinn og Hele gjengen — se CLAUDE.md "Test-strategi".

**Arvet uendret (mønster/logikk) fra Bondøya:**
route/lib-splitten, `lib/taxonomi.js` (ARTSTYPER/`utledArtstype()`,
`hentAutoritativArtstype()`), `lib/artsvisibility.js`
(`betruaTaxonId()`/fail-closed synlighet), `lib/funn.js`
(`validerFunnFelter()`), `lib/fremdrift.js` sitt on-the-fly-
beregningsmønster (Oppdageren/Rødlistejeger/Artssamler/Mangfoldsmester/
Årstidene rundt uendret), `lib/oyer.js` sin `erPunktIPolygon()`/`finnOy()`,
sesjonsmekanikken (D1-tabellstruktur, grace period-rotasjon), `sw.js` sitt
network-first-mønster, `escapeHtml()`-konvensjonen, ingen build-steg.

**Bevisst IKKE tatt med** (se README.md "Bevisste forenklinger" for full
begrunnelse per punkt): Mapbox-satellittkartlag, artsomtale/Wikipedia-
integrasjon, bilde-beskjæring-før-KI, galleri-visning og gruppering av
funnlisten, offline-kø (koblet), sider-system, individuelle
invitasjonslenker, admin-dashboard, Sjeldenhetsjeger-poengelement.

**Kjent bug funnet og rettet under implementasjonen**: `js/app.js` sin
kartinitialisering (`initMapNarKlar()`) kunne mislykkes gjentatte ganger med
"Invalid LatLng"-feil ved oppstart i visse miljøer, selv med Bondøyas
opprinnelige ett-forsøk-100ms-retry. Rettet ved å eksplisitt vente på at
`#map`-containeren faktisk har fått en reell størrelse
(`offsetWidth`/`offsetHeight > 0`, polling via `requestAnimationFrame`) FØR
`L.map()` i det hele tatt kalles, med en fast delay-retry-kjede som
bakstopp for andre feil. Verifisert manuelt i en lokal nettleser-økt.
