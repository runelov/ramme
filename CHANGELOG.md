# Endringslogg

Semver-ish (`## 0.x.0 — <kort tittel>`), samme mønster som Bondøya/FungiFinder.
Versjonsnummereringen starter på nytt fra `0.1.0` her — Ramme er en egen,
uavhengig repo-historie fra forgreningstidspunktet, følger ikke videre på
Bondøyas løpende versjonsnummer (se CLAUDE.md).

## 0.1.15 — Kartkontrollene hang for lavt i vanlig mobil-Safari

Produkteier viste et skjermbilde: lagvelger-ikonet (nede til venstre)
hang synlig lenger ned enn zoom-/GPS-klyngen (nede til høyre).

**Rotårsak**: `#map` har `inset: 0` — fyller HELE layout-viewporten, uten
hensyn til `--safe-bottom`/`--browser-chrome-bottom` slik appens EGNE
faste bunn-elementer (FAB, bunn-ark, A2HS-kortet) allerede har. Leaflets
egne `.leaflet-bottom`-hjørner ankres derfor til `bottom: 0` av DEN fulle
høyden — i vanlig Safari-fane (ikke installert PWA), der Safaris eget
bunn-krom dekker en del av dette, endte lagvelgeren (eneste kontroll i
det hjørnet, ingenting å stable oppå) helt nede ved den reelle
skjermkanten. Zoom-/GPS-klyngen (tre stablede kontroller) så mindre
rammet ut fordi stablingen løftet de ØVRE knappene høyere uansett — men
den NEDERSTE knappen der hadde nøyaktig samme problem, bare mindre synlig.

**Fiks**: én ny regel, `.leaflet-bottom{ bottom: calc(var(--safe-bottom)
+ var(--browser-chrome-bottom)); }` — løfter BEGGE bunn-hjørnene likt
(uniform justering, ikke en venstre-spesifikk lapp), samme mål som resten
av appen allerede bruker. Verifisert med en isolert kopi av ekte
Leaflet+CSS og en simulert 60px "Safari-krom"-sone: uten fiksen havnet
lagvelgeren og den nederste zoom-knappen inni sonen; med fiksen løftes
begge tydelig over.

## 0.1.14 — Lagvelger for kartet: Kartverket topo ↔ Esri satellitt

Produkteier savnet lagvelgeren fra Bondøyas kart nede til venstre. Den har
aldri eksistert i Ramme — bevisst kuttet ved forgreningen (kun ett
kartlag, ingen Mapbox). CSS-en for `.leaflet-control-layers` fantes
derimot allerede i `css/styles.css` fra design-gjennomgangen 28.08, uten
at noen kontroll noensinne ble lagt til i `js/map.js` — død kode inntil nå.

Undersøkte grundig om Kartverket selv har et gratis, tokenfritt
flyfoto-lag før noe ble bygget (se `js/map.js` sin toppkommentar for full
verifisering): **nei** — `cache.kartverket.no` har kun topo/topograatone/
toporaster/sjøkartraster, den faktiske flyfoto-tjenesten
(`tilecache.norgeibilder.no`) krever en Bearer-token, og den eldre
WMS-varianten (`wms.geonorge.no/skwms1/wms.nib*`) er IP-hvitelistet for
Norge digitalt-partnere. Endte på **Esri World Imagery** i stedet — ekte
gratis/tokenfri global satellittjeneste, verifisert med et faktisk
flis-kall over Ramme sin egen posisjon før den ble bygget inn.

- `L.control.layers` (bottomleft, samme plassering som Bondøya) lar
  brukeren bytte mellom "Kartverket (terreng)" (default) og
  "Esri (satellitt)". Ingen innloggingssjekk (til forskjell fra Bondøyas
  betalte Mapbox-lag) — begge lagene er gratis og åpne uansett.
- Verifisert visuelt (ekte Leaflet + ekte `css/styles.css`, lokal server):
  lagvelger-ikonet matcher zoom-/GPS-knappenes stil, utvidet liste viser
  begge alternativene korrekt, bytte til Esri viser faktisk satellittbilde
  med riktig attribution.

## 0.1.13 — A2HS-tilbudet så ut som en blobbete sirkel i stedet for et kort

Produkteier viste et skjermbilde fra ekte iOS Safari: "legg til på
hjemskjerm"-tilbudet var en nesten sirkulær hvit boble med teksten klemt
inn og ✕-knappen løst hengende under, i stedet for et lesbart kort.

**Rotårsak**: `.a2hsBanner` sin `border-radius: 999px` (en "pille") ble
designet for den KORTE Android/generiske teksten
("📲 Legg til Ramme på hjemskjermen for rask tilgang."). iOS-varianten
(`wireA2HS()` sin lengre Del-ikon-forklaring) er mye lengre og pakkes over
flere linjer — en pille-radius på en boks som blir høyere enn bred gir
nøyaktig den blobbete sirkelen skjermbildet viste, med ✕-knappen
tvunget ned på en egen sentrert rad av `flex-wrap`.

**Fiks**: erstattet pille-formen med et vanlig avrundet kort (samme
`--radius-lg` som bunn-arkene bruker), kolonne-layout i stedet for
rad-med-wrap, og ✕-knappen absolutt plassert øverst til høyre i stedet
for i flyten. Verifisert visuelt (før/etter, side om side) med en isolert
kopi av markup+CSS — ikke i ekte iOS Safari (ingen tilgang til enhet).

## (ingen versjonsbump) — v0.1.11-fiksen var aldri faktisk deployet

Produkteier rapporterte at "Ikke innlogget" fortsatt kom rett etter en
frisk pålogging, i vanlig mobil-Safari — altså at v0.1.11-fiksen (og
dermed v0.1.12s feilsynliggjøring) ikke hjalp i det hele tatt.

**Rotårsak (min feil, ikke en kodebug)**: `git push` publiserer den
statiske appen automatisk via GitHub Pages, men **Cloudflare Workeren gjør
ikke det** — `worker/api` ble aldri kjørt gjennom `wrangler deploy` etter
v0.1.11s kodeendringer. Bekreftet direkte: `OPTIONS /funn` mot produksjon
viste fortsatt den GAMLE CORS-headeren (`Access-Control-Allow-Headers:
Content-Type`, uten `Authorization`) time etter at v0.1.11 var committet.
Frontend sendte altså riktig `Authorization`-header hele tiden — Workeren
visste bare ikke om den ennå, så `/auth/registrer` ga aldri noe
`sesjonToken` tilbake, og alt falt tilbake til den (Safari-blokkerte)
cookien.

**Fiks**: `npx wrangler deploy` kjørt manuelt for `worker/api`. Bekreftet
med samme `OPTIONS`-sjekk at ny CORS-header (`Authorization` i
Allow-Headers, `X-Sesjon-Token` i Expose-Headers) nå er live. Se README.md
"Deploy" (ny seksjon) for at Worker-deploy alltid er et eget, manuelt steg
— `git push` er ikke nok.

## 0.1.12 — KI-gjenkjenningsfeil var usynlig i UI-et (så ut som "ingen feilmelding")

Produkteier meldte at v0.1.11 ikke løste KI-gjenkjenningen fullt ut på
mobil — nå uten feilmelding i det hele tatt, bare "ingen artsforslag".

**Rotårsak, funnet ved kodegjennomgang (ikke reprodusert live — ikke
tilgang til en ekte iPhone)**: to uavhengige steder i `js/app.js` kunne
gi et helt stille "ingen artsforslag"-utfall:

1. **`kjorKiGjenkjenning()` skilte ikke mellom "KI kjørte OK, fant ingen
   god kandidat" og "KI-kallet feilet teknisk"** (nettverk/auth/
   tidsavbrudd) — begge satte `pendingKiResultat = null`, som rendret
   IDENTISK tekst ("Fant ikke arten automatisk. Velg art manuelt under.")
   i `renderRegisterPanel()`. En reell feil (f.eks. en 401, eller en CORS-
   feil) så dermed nøyaktig ut som et legitimt "ingen treff"-svar.
2. **`compressImage()` manglet `img.onerror`** — hvis nettleseren ikke
   klarte å dekode det valgte bildet i en `<img>` (mistenkt: ekte HEIC-
   bilder valgt fra Bilder-appen på iOS, til forskjell fra et kamera-opptak
   som normalt konverteres til JPEG av OS-et før input-eventet), hang hele
   løftet for alltid — INGEN kode kjørte noensinne igjen, ikke engang
   `kjorKiGjenkjenning()` sin try/catch, siden feilen oppsto FØR den i det
   hele tatt ble kalt.

**Fiks**:
- `pendingKiFeil` er en ny, egen tilstand — skiller nå "ingen god
  kandidat" fra "teknisk feil" i UI-et. Et feilet KI-kall viser nå
  `⚠️ KI-gjenkjenning feilet: <faktisk feilmelding>` med en "Prøv KI på
  nytt"-knapp, i stedet for å se ut som et normalt nullsvar.
- `compressImage()` har nå `img.onerror` + et 10-sekunders tidsavbruddsvern
  — en bilde-dekodingsfeil gir nå en synlig feilmelding i stedet for å
  henge løpet stille. `onImageCaptured()` fanger denne feilen og åpner
  registreringspanelet med feilmeldingen synlig, i stedet for at ingenting
  merkbart skjer etter at et bilde velges.

**Ikke bekreftet løst** — dette gjør en eventuell gjenværende feil synlig
og diagnostiserbar (feilteksten selv forteller hva som faktisk skjer:
"Failed to fetch"/nettverksfeil, en fortsatt 401, en tidsavbrudds-tekst,
eller en bilde-dekodingsfeil), men er ikke i seg selv en bekreftet fiks av
et rotproblem jeg ikke kunne reprodusere lokalt. Neste steg: reprodusere
på ekte mobil og lese av den nå synlige feilteksten (evt. koble iPhone til
Mac og bruke Safaris Web Inspector for konsoll/nettverk).

## 0.1.11 — Kritisk: sesjonscookien virket ikke på mobil (Safari blokkerer cross-site-cookier)

Produkteier rapporterte 401 på `/funn` ved oppstart og mislykket
KI-artsgjenkjenning — kun på mobil (både standalone-PWA og mobil-Safari),
ikke på Mac. Se `arkitektur.md` ADR 15 for full rotårsaksanalyse.

**Rotårsak**: nøyaktig risikoen ADR 2 skrev inn som "kjent, bevisst
akseptert" og aldri fikk den varslede testrunden før nå. Safari (mobil og
standalone-PWA, begge WebKit) blokkerer alle cross-site-cookier
("Full Third-Party Cookie Blocking", Safari 13.1+/iOS 13.4+) uansett
`SameSite`-verdi. Innlogging så likevel ut til å lykkes fordi
`js/app.js` satte brukerstatus fra JSON-svaret, ikke fra cookien — først
neste kall som faktisk krevde den (aldri lagrede) cookien ga 401.

**Fiks**: `Authorization: Bearer <token>`-header er nå primær
sesjonsmekanisme:
- `POST /auth/registrer` returnerer nå `sesjonToken` i JSON-body-en, i
  tillegg til (ikke i stedet for) `Set-Cookie`.
- `js/api-client.js` lagrer tokenet i `localStorage`, sender det som
  `Authorization`-header på hvert kall, og plukker opp rullerte tokens fra
  en ny `X-Sesjon-Token`-responsheader.
- Bilde-visning (`<img src>`, kan ikke sette headere) sender tokenet som
  `?t=`-query-param i stedet — bevisst avveining (token i URL-logger) for
  et kortvarig, invitasjonsbeskyttet seminarverktøy.
- `Access-Control-Allow-Headers`/`-Expose-Headers` i `lib/cors.js` utvidet
  tilsvarende. `sjekkOpprinnelse()`-CSRF-sjekken er uendret.

Verifisert lokalt (`wrangler dev`+`curl`, uten cookie-jar — simulerer
Safaris blokkering direkte): header-only auth gir 200, ingen token gir
401, bilde-query-param autentiserer riktig, Origin-CSRF-sjekken uendret.
**Ikke** verifisert i ekte iOS Safari/PWA-standalone ennå — se
`veien-videre.md`.

## 0.1.10 — Nytt appikon: løktårnet med torvtak

Erstattet appikonet (`icons/icon-16/32/180/192/512.png`, `favicon.ico`) —
det gamle var faktisk Bondøyas øy-silhuett, arvet uendret ved
forgreningen og aldri byttet ut. Nytt motiv: løktårnet med kuppel, lykt
og torvtak på Ramme gård, som Ramme faktisk er oppkalt etter.

- Silhuett i sotsvart (tårnet er mørkbeiset tre, ikke lyst) på en varm
  krembunn, med et grønt torvtak som tårnet står forankret i — ikke en
  fritt­stående form. To runder med produkteier-tilbakemelding rettet
  henholdsvis en synlig luftespalte mellom hals/kuppel og resten av
  tårnet (en glipp fra en tidligere iterasjon i utkastfasen, aldri i
  produksjon), og en for løsrevet torvtak-form som fikk taket til å se ut
  som det svevde.
- `favicon.ico` er nå ekte multi-størrelse (16+32), mot den forrige
  enkelt-størrelse 48×48-filen.
- `icons/icon-192.png`/`icon-512.png` er precachet i `sw.js` sin
  `SHELL_FILES` uten egen `?v=`-cache-buster — eneste måten å tvinge
  allerede installerte PWA-er til å hente det nye ikonet er å bumpe
  `CACHE_NAME`, derfor patch-bump til `0.1.10` selv om ingen JS/CSS-logikk
  endret seg i denne releasen.

## 0.1.9 — Badge-terskler skalert ned for et engangsseminar, "Årstidene rundt" fjernet

Produkteier: Bondøyas badge-terskler (kalibrert for en flerårig hobby-app)
er urealistiske for et 1-2 dagers seminar.

- **Artssamler / Ivrig artssamler / Artsmester**: terskler endret fra
  Bondøyas 10/25/50 arter til **5/10/15**.
- **Mangfoldsmester**: endret fra "alle 17 artstyper" til **"minst 5
  artstyper"** — artsliste.md fant uansett reelle kandidater for kun 7 av
  17 i nærområdet, så "alle 17" var urealistisk selv før nedskaleringen.
- **"Årstidene rundt" er fjernet helt** — et flerårig hobbyprosjekt-merke
  (alle fire årstider) uten mening for et enkeltstående seminar.
  `sesong()`-hjelpefunksjonen og `distinkteSesonger`-beregningen i
  `lib/fremdrift.js` er fjernet sammen med badgen, ikke latt stå som død
  kode. Ikonet fjernet fra `MERKE_IKONER` i `js/app.js`.

**Fanget i samme gjennomgang** (samme feilklasse som ADR 12/14, se
arkitektur.md): "Hele gjengen"-badgens `beskrivelse`/`progresjon`-felt i
`lib/fremdrift.js` viste fortsatt `antallAktivt` (faktisk registrerte
kontoer) i teksten til brukeren, selv om selve `opptjent`-booleanen
allerede var rettet til `forventetDeltakere` i v0.1.5 — symptomet var
usynlig fordi kun VISNINGSTALLENE var feil, ikke selve oppnådd/ikke-
oppnådd-vurderingen. Rettet til `forventetDeltakere` konsekvent.

## 0.1.8 — Rammevandrer-sonene er nå tegnet og bekreftet av produkteier selv

Fortsettelse av v0.1.7: produkteier tegnet/korrigerte de foreslåtte
kandidat-sonene direkte i Google My Maps (satellittbilde), i stedet for at
Claude gjettet dem fra offentlig kartdata alene (se memory
"geografiske-valg-krever-bekreftelse"). Eksportert som KML og lagt inn i
`data/soner-ramme.json`.

**Seks reelle, bekreftede soner** (ikke lenger `placeholder: true`):
Havlystparken, Tunet/gårdsplassen, Skogholtet, Strandsonen, og to nye —
**Edvard Munchs villa** og **Rammeveien** — som ikke var i noen tidligere
plan, men som produkteier valgte å tegne som egne soner.

`js/map.js` sine `RAMME_SENTRUM`/`START_BOUNDS` er utvidet til å romme
alle seks sonenes faktiske utstrekning — Strandsonen og Rammeveien
strekker seg vesentlig lenger sør enn det forrige utsnittet dekket, og
ville vært utenfor panorerings-grensen uten denne endringen.

Ingen kodeendring i selve badge-logikken — `beregnRammevandrerNiva()` er
allerede skalert etter faktisk antall soner (nå 6: trinn 1 ved 3, trinn 2
("Rammevandrer II") ved alle 6).

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
