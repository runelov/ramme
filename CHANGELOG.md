# Endringslogg

Semver-ish (`## 0.x.0 — <kort tittel>`), samme mønster som Bondøya/FungiFinder.
Versjonsnummereringen starter på nytt fra `0.1.0` her — Ramme er en egen,
uavhengig repo-historie fra forgreningstidspunktet, følger ikke videre på
Bondøyas løpende versjonsnummer (se CLAUDE.md).

## 0.1.7 — Kartsenteret var feil sted, ikke bare unøyaktig

Produkteier: sonene/kartsenteret virket å ligge i Hvitsten sentrum, ikke
ved selve Ramme Gård. Riktig — det forrige senterpunktet
(59.5985391°N/10.6553105°E) var en feil OSM-node valgt av Claude uten å
bekrefte med produkteier først (se memory
"geografiske-valg-krever-bekreftelse" og v0.1.6 sin advarsel om nettopp
dette). Produkteier ga en Google Maps-lenke til den faktiske adressen
("Rammeveien 100"), som løser seg til **59.6089546°N/10.6543468°E** — ca.
1,2 km nord for det gamle, feilaktige punktet.

`js/map.js` sitt kartsenter (`RAMME_SENTRUM`/`START_BOUNDS`) er rettet til
det nye, bekreftede punktet — samme relative boksstørrelse som før, kun
re-sentrert. Et påfølgende Overpass-søk rundt det nye punktet fant en
rikt kartlagt skulpturhage (mange navngitte bygninger/dammer/kunstverk,
inkl. selve "Havlystparken" som en egen, navngitt `leisure=garden`-
polygon) — **`data/soner-ramme.json` er bevisst IKKE oppdatert i denne
runden**: kandidatsonene presenteres for produkteier til bekreftelse
først, ikke besluttet ensidig igjen (se v0.1.6 sin feil).

## 0.1.6 — Rammevandrer-sonene oppgradert fra gjettede firkanter til ekte OSM-geometri

`data/soner-ramme.json` hadde tre rene, hånd-tegnede placeholder-firkanter
(Tunet, Havlystparken, Strandsonen). Et Overpass-søk mot OpenStreetMap
rundt det geokodede hotellpunktet fant faktiske, kartlagte polygoner for
flere av disse — en `leisure=park`-polygon (trolig selve Havlystparken),
en `natural=beach`-sandstrand rett ved hotellet, og en liten
`natural=wood`-løvskogflekk. Byttet inn de tre ekte polygonene, og lagt
til en helt ny fjerde sone, **Skogholtet**, bygget fra skogpolygonen —
matcher det opprinnelige femte sonenavnet fra konsept.md sin
brainstorming, som aldri fikk geometri før nå.

Fortsatt IKKE en bekreftet eiendomsgrense — dette er offentlig
OSM-terrengdata, ikke en oppmålt privat grense. Strandsonen-polygonen er
spesielt smal og kan vise seg for liten til å treffes pålitelig av
unøyaktig GPS. Tunet mangler fortsatt en tydelig OSM-kilde og er uendret
(hånd-tegnet boks). Se `data/soner-ramme.json` sine `notat`-felt for full
kildehenvisning per sone.

Ingen kodeendring nødvendig — `lib/oyer.js` sin `erPunktIPolygon()`/
`finnOy()` og `js/map.js` sin `renderSonerPaKart()` er begge allerede
generiske over antall/innhold i sonelisten.

## 0.1.5 — v0.1.3-fiksen for "Hele gjengen" dekket kun ett av to duplikat-steder

Rapportert av produkteier rett etter å ha satt `forventetDeltakere = 10`
med kun 1 registrert funn: "Hele gjengen" viste seg likevel oppnådd, i
"Min fremdrift"-panelet.

**Rotårsak**: `erHeleGjengenOppnadd()` ble kalt fra to steder —
`routes/leaderboard.js` (fikset i v0.1.3) og `lib/fremdrift.js` sin
`beregnFremdrift()` (brukt av `/meg/fremdrift` og `/admin/fremdrift`) —
v0.1.3-fiksen rettet kun det første. Se arkitektur.md ADR 14.

**Fiks**: `lib/fremdrift.js` henter nå også `forventetDeltakere` og bruker
den i stedet for `antallAktivt`, identisk med `routes/leaderboard.js`.

## 0.1.4 — Ingen kunne noensinne bli admin

Rapportert av produkteier: "hvem er admin?" — svaret var ingen,
inkludert produkteier selv, etter å ha registrert seg og prøvd å sette
`forventetDeltakere` (v0.1.3).

**Rotårsak**: `routes/auth.js` sin `INSERT INTO brukere`-setning hardkodet
`rolle='bruker'` for enhver ny konto — ingen kode noensinne satte
`rolle='admin'`. Enda en ripple-effekt av ADR 11 (selvregistrering
erstattet Bondøyas admin-oppretter-alle-kontoer-manuelt-modell, der
admin-rollen ble satt eksplisitt i den manuelle kommandoen — se
arkitektur.md ADR 13 for full sammenheng med ADR 12, funnet timer
tidligere samme kveld, samme rotårsak-klasse).

**Fiks**: `lib/pin.js` sin nye `avgjorRolleVedRegistrering()` (testet, ren
funksjon) — **første registrerte bruker blir automatisk admin**.
Produkteiers eksisterende testkonto (opprettet før denne fiksen) ble
promotert manuelt, én gang, via `wrangler d1 execute --remote`.

## 0.1.3 — To badge-bugs funnet ved faktisk bruk rett etter KI-fiksen

Rapportert av produkteier: (1) "Oppdageren" utløste ikke selv om han var
først til å registrere steinsopp, (2) "Hele gjengen"/den kollektive "X/Y
har registrert"-telleren viste seg oppnådd etter at kun én person hadde
registrert ett funn.

**Bug 1 — KI-forslag fikk aldri `taxonId`.** Uten `art_taxon_id` kan
verken "Oppdageren", Rødlistejeger eller en fremtidig
Sjeldenhetsjeger-utvidelse utløses. Dette er faktisk en dokumentert,
*akseptert* begrensning i Bondøyas eget ki-proxy-opphav ("KI-kandidater
har uansett aldri en taxonId ... som er korrekt") — helt riktig prioritert
der, siden badges er en bonus oppå en allerede etablert app. I Ramme, der
gamification er selve poenget med produktet, er samme begrensning langt
mer skadelig. Løst i `worker/ki-proxy`: en ny `losOppManglendeTaxonId()`
løser opp taxonId server-side mot Artskart for enhver kandidat som mangler
en (dekker både rene Claude-forslag og et fra før eksisterende hull i
Artsorakel-stien, `lagArtsorakelKandidat()`, som hentet taxonId men glemte
å legge den i responsobjektet). Fail-open: en kandidat uten oppslagstreff
beholdes fortsatt, bare uten taxonId, fremfor å forsvinne.

**Bug 2 — "Hele gjengen" brukte feil nevner etter auth-byttet.**
Se `arkitektur.md` ADR 12 for full rotårsak: målet var opprinnelig antall
FAKTISK registrerte kontoer, som var riktig da Bondøyas admin-oppretter-
alle-kontoer-modell fortsatt gjaldt, men feil etter at ADR 11 byttet til
selvregistrering (det tallet vokser dynamisk gjennom seminaret i stedet
for å være kjent fra dag 1). Ny admin-innstilling `forventetDeltakere`
(innstillinger-fanen) erstatter det som nevner for både "Hele gjengen" og
"X/Y har registrert"-telleren. **Krever admin-handling før seminaret** —
se veien-videre.md, tallet er ikke satt automatisk.

## 0.1.2 — KI-artsgjenkjenning ga aldri treff: Worker-til-Worker-fetch mot workers.dev er upålitelig

Rapportert av produkteier: KI-artsgjenkjenning returnerte konsekvent ingen
kandidater etter flere testrunder, til tross for at både `ANTHROPIC_API_KEY`
og `ARTSORAKEL_TOKEN` var satt riktig.

**Rotårsak** (funnet via midlertidig diagnostikk-logging i
`worker/api/src/routes/ki.js`, deployet og fjernet igjen samme dag):
`routes/ki.js` sitt vanlige `fetch(env.KI_PROXY_URL, ...)`-kall mot
`worker/ki-proxy` sin `*.workers.dev`-URL ga konsekvent **404** (Cloudflares
egen "ingen Worker her"-side, ikke et svar fra ki-proxyens egen kode).
Bekreftet med `curl` direkte mot nøyaktig samme URL fra en vanlig ekstern
klient — den svarte helt riktig der. Dette er en kjent Cloudflare-
begrensning: **Worker-til-Worker-`fetch()` mot en annen Workers
`*.workers.dev`-URL innad i samme konto er upålitelig**, selv om samme URL
fungerer perfekt for eksterne klienter.

**Fiks**: byttet til en [Service
Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
(`env.KI_PROXY` i `wrangler.toml`, `env.KI_PROXY.fetch(...)` i `ki.js`) —
Cloudflares native mekanisme for Worker-til-Worker-kall, ruter direkte internt
i nettverket uten DNS/internett involvert. `KI_PROXY_URL`-variabelen er
fjernet. `worker/ki-proxy` selv er uendret — fortsatt en egen, uavhengig
deploy (ADR 3), kun *kalt* annerledes fra worker/api sin side.

**Generisk lærdom** (lagt til `~/claude/docs/erfaringsbank.md`): ethvert
fremtidig `~/claude`-produkt der én Worker skal kalle en annen Worker uten
et kjøpt domene på begge sider, bør bruke Service Bindings fra start —
ikke et rått `fetch()` mot `*.workers.dev`, som kan se ut til å fungere i
enkle tester (feilen dukket ikke opp før faktisk bruk gjennom hele
brukerflyten) men feiler i produksjon.

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
