# Ramme

Kartdrevet artsregistrering for et arbeidsseminar på Ramme Fjordhotell
(Hvitsten, Vestby kommune, indre Oslofjord) — 15-20 navngitte kolleger,
KI-støttet artsgjenkjenning, leaderboard/badges som teambuilding-element.

**"Ramme" er et arbeidsnavn, ikke et bekreftet produktnavn** — se
`~/claude/ramme-workspace/veien-videre.md`. Denne repoen er en bevisst
forgrening av [Bondøyas kodebase](../../mittbondøya-workspace/bondoya/),
ikke bygget fra bunnen — se `~/claude/ramme-workspace/CLAUDE.md` for den
fulle, uttalte listen over hva som er arvet uendret vs. hva som er nytt.

## Full kontekst

Les i denne rekkefølgen før du endrer noe her:

1. [`~/claude/ramme-workspace/konsept.md`](../konsept.md) — hva Ramme er og
   hvorfor, inkl. Auth-modellen (invitasjonskode + kortnavn + PIN) og
   gamification-designet.
2. [`~/claude/ramme-workspace/arkitektur.md`](../arkitektur.md) — alle
   11 ADR-ene (flere er reversert 2-3 ganger, siste versjon i dokumentet
   gjelder).
3. [`~/claude/ramme-workspace/CLAUDE.md`](../CLAUDE.md) — kodepraksis,
   filstruktur, hva som er arvet uendret vs. annerledes.
4. [`~/claude/ramme-workspace/veien-videre.md`](../veien-videre.md) — åpne
   punkter (sonegrenser, kartavgrensning, produktnavn, artsliste-
   bekreftelse) som IKKE er avklart av denne implementasjonen.
5. [`~/claude/ramme-workspace/sikkerhetssjekkliste-ramme.md`](../sikkerhetssjekkliste-ramme.md).

## Kjøre lokalt

```bash
# Statisk app
python3 -m http.server 8899 --directory ramme-workspace/ramme

# API-worker (Cloudflare Worker + D1 + KV + R2, lokal dev)
cd ramme-workspace/ramme/worker/api
npm install
cp .dev.vars.example .dev.vars   # fyll inn lokale placeholder-verdier
npx wrangler d1 migrations apply ramme --local
npx wrangler dev                 # port 8787

# KI-proxy-worker (egen, uavhengig av Bondøyas ki.bondoya.no)
cd ramme-workspace/ramme/worker/ki-proxy
npm install
cp .dev.vars.example .dev.vars
npx wrangler dev                 # port 8788 (juster i api-worker sin KI_PROXY_URL)
```

Aktiver versjons-pre-commit-hooken én gang per klon:

```bash
git config core.hooksPath .githooks
```

### Opprette den første admin-brukeren

**Rettet v0.1.4** (var en reell bug — se CHANGELOG.md og arkitektur.md
ADR 13): den **første** som noensinne registrerer seg via appen blir nå
automatisk admin (`lib/pin.js` sin `avgjorRolleVedRegistrering()`) — ingen
manuell handling nødvendig i normale tilfeller. **Registrer deg selv
FØRST**, før du deler invitasjonskoden med noen andre.

Manuell promotering/gjenoppretting (kun nødvendig hvis den automatiske
tildelingen av en eller annen grunn ikke traff riktig person — f.eks. etter
en D1-nullstilling der noen andre rakk å registrere seg "først" på nytt,
eller for en konto opprettet FØR v0.1.4-fiksen):

```bash
npx wrangler d1 execute ramme --remote --command \
  "UPDATE brukere SET rolle = 'admin' WHERE kortnavn_normalisert = 'ditt-kortnavn'"
```

## Enhetstester

```bash
cd worker/api
npm test   # node --test, ingen D1/KV-oppsett nødvendig — se test/lib/
```

Minimalt, målrettet `node:test`-sett for de rene beregningsfunksjonene
(PIN-hashing/kollisjonsbeslutning, rate-limit-telleren, Rammevandrer/Hele
gjengen) — se `~/claude/ramme-workspace/CLAUDE.md` "Test-strategi (fase 6)"
for den fulle begrunnelsen for omfanget (og hvorfor det bevisst IKKE er
fungifinders fulle `node:sqlite`-regime).

## Bevisste forenklinger (utover det som er dokumentert i konsept.md/arkitektur.md)

Disse er IKKE nevnt som krav i produktløype-dokumentene, men er bevisste
avgrensninger tatt under selve implementasjonen for å holde et 3-4-ukers
engangsseminar-prosjekt forholdsmessig — samme "skaler med risiko, ikke med
skjema"-prinsipp som resten av produktløypa:

- **Ingen Mapbox-satellittkartlag/flis-proxy.** Kun Kartverkets gratis,
  tokenfrie topografiske kart. Bondøyas `worker/api/src/routes/tiles.js`
  er IKKE forket. Enkel å legge til igjen senere (bruk Bondøyas fil som
  mal) hvis produkteier ønsker satellittvisning — krever en Mapbox-konto/
  -token.
- **Ingen artsomtale/Wikipedia-integrasjon** (Bondøyas `arter_metadata`-
  tabell, `lib/wikipedia.js`, admin-panelets "artsomtale"-fane). Artsdetalj-
  visningen viser art/rødliste/registrering, ikke en fritekstbeskrivelse.
- **Ingen bilde-beskjæring-før-KI** (Bondøyas dra-over-bildet-steg). KI
  kjører alltid på hele det komprimerte bildet.
- **Ingen galleri-visning eller gruppering** av funnlisten (Bondøyas
  liste/galleri-veksling og art/artstype/måned/bruker-gruppering) — én
  enkel, sortérbar liste.
- **Ingen Sjeldenhetsjeger-poengelement** — se arkitektur.md ADR 8: Ramme
  har ikke (ennå) den lokale Artskart-observasjonscachen
  (`REFERANSEDATA`-KV-mønsteret) dette krever. Anbefalt, ikke bygget for v1.

Ingen av disse endrer noe i konsept.md/arkitektur.md sine faktiske
produktbeslutninger — de er implementasjonsdetaljer om HVOR MYE av Bondøyas
fulle funksjonsbredde som er forholdsmessig å bygge på nytt for et
tidsbegrenset seminarverktøy, ikke endringer i hva Ramme skal være.

## Kjent, ikke fullført — avklares før faktisk deploy

Se `veien-videre.md` for den fulle, oppdaterte listen. Kort oppsummert, det
som IKKE skal leses som ferdig avklart av denne implementasjonen:

- **`data/soner-ramme.json`** — grove PLACEHOLDER-polygoner rundt et
  omtrentlig senterpunkt (59.5985°N, 10.6553°Ø), IKKE oppmålte
  eiendomsgrenser. Krever befaring/produkteier.
- **`js/map.js` sin `maxBounds`/startvisning** — samme PLACEHOLDER-status,
  samme grunn.
- **Produktnavn i UI** — "Ramme" er brukt som arbeidsnavn/visningsnavn
  gjennomgående (tittel, manifest, topBar), ikke bekreftet endelig.
- **`data/species.json`** — kuratert fra `artsliste.md` sin GBIF-/
  Artskart-baserte research, IKKE bekreftet mot produkteiers egen
  kjennskap til eiendommen ennå.
- **`INVITASJONSKODE`, `ALLOWED_ORIGIN`, `KI_PROXY_URL` og alle D1/KV/R2-
  ressurs-ID-er** i `wrangler.toml`/`.dev.vars.example` er placeholdere —
  ingen ekte Cloudflare-ressurser er opprettet av denne implementasjonen
  (eksplisitt utenfor scope, se oppdragsbeskrivelsen).
- **Manuell verifisering før seminaret** (ikke dekket av `node:test`, se
  CLAUDE.md "Test-strategi"): leaderboardets `EXISTS`-filter og
  "X/Y har registrert"-telleren mot en ekte D1-populasjon, A2HS-
  sekvenseringen i faktisk nettleser, auth-/PIN-flytens faktiske D1-/KV-I/O
  (gjenoppretting på ny enhet, den tvetydige feilmeldingen, faktisk utløst
  rate-limiting).
  - **iOS Safari/PWA-standalone ble faktisk testet (2026-08-28) og feilet**:
    `SameSite=None`-cookien blokkeres av Safaris "Full Third-Party Cookie
    Blocking" — 401 på `/funn`/`/ki/gjenkjenn` på mobil selv om innlogging
    så ut til å lykkes. Rettet med `Authorization: Bearer`-header som
    primær sesjonsmekanisme i stedet for cookien (token i `localStorage`,
    se `lib/session.js` "OPPDATERT 2026-08-28" og CHANGELOG.md). Verifisert
    lokalt med `curl` (header-only auth uten cookie gir 200, ikke 401) —
    **fortsatt ikke verifisert i ekte iOS Safari/PWA-standalone**, gjør det
    før seminaret.
- **`npm audit`** — kjør rett etter `npm install` i begge worker-mappene,
  før første deploy (ny, separat `node_modules`-installasjon er ikke
  dekket av noen tidligere audit).
- **`/security-review`** — skal kjøres på denne nye koden (spesielt
  `routes/auth.js`/`lib/pin.js`/`lib/ratelimit.js`) før seminaret, se
  sikkerhetssjekkliste-ramme.md "Etter denne listen". Ikke kjørt som del av
  denne implementasjonen.

## Versjonering og caching

Ingen build-steg — `?v=`-query-strings ER cache-busting-mekanismen. Se
`~/claude/ramme-workspace/CLAUDE.md` "Versjonering og cache-busting" for
den fulle sjekklisten. `.githooks/pre-commit` (aktiver med `git config
core.hooksPath .githooks`) håndhever at `js/app.js` sin `APP_VERSION`,
`index.html` sine `?v=`-tagger og `sw.js` sin `CACHE_NAME`/`SHELL_FILES`
alltid bumpes sammen.
