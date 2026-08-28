#!/usr/bin/env bash
# Førstegangs infrastruktur-oppsett for Ramme — kjøres av produkteier selv,
# ikke av Claude (permission-klassifisereren i den Claude Code-økten som
# skrev dette blokkerer bevisst repo-/ressurs-opprettende kommandoer og
# selv-tildeling av tillatelser, som en sikkerhetssperre — ikke noe å prøve
# å omgå). Ingenting her er blokkert når DU kjører det i din egen terminal.
#
# Forutsetninger: `gh auth status` og `npx wrangler whoami` viser at du
# allerede er innlogget.
#
# Kjør fra roten av dette repoet:
#   cd ~/claude/ramme-workspace/ramme
#   bash scripts/forste-oppsett.sh
#
# Idempotent: hvert steg sjekker om ressursen allerede finnes før den
# forsøker å opprette den, så skriptet er trygt å kjøre på nytt etter en
# delvis kjøring eller en feil.
#
# Kjent, allerede fikset 2026-08-28: `wrangler kv namespace create
# RATE_LIMIT` feiler fordi Bondøya allerede har en KV-namespace med akkurat
# den tittelen i samme Cloudflare-konto (namespace-titler er unike per
# KONTO, ikke per Worker). Løst ved å gi Rammes namespace en egen, unik
# tittel ("ramme-RATE_LIMIT") — selve bindingsnavnet i wrangler.toml
# ("RATE_LIMIT", det koden bruker som env.RATE_LIMIT) er uendret.

set -uo pipefail
cd "$(dirname "$0")/.."

GH_BRUKER="runelov"
REPO_NAVN="ramme"
PAGES_URL="https://${GH_BRUKER}.github.io/${REPO_NAVN}"
FRONTEND_OPPRINNELSE="https://${GH_BRUKER}.github.io"
KV_TITTEL="ramme-RATE_LIMIT" # IKKE "RATE_LIMIT" alene, se toppkommentar

feil() { echo "FEIL: $1" >&2; exit 1; }

echo "== 1. GitHub-repo ==" >&2
if gh repo view "${GH_BRUKER}/${REPO_NAVN}" >/dev/null 2>&1; then
  echo "  Repoet finnes allerede — hopper over opprettelse." >&2
else
  gh repo create "${GH_BRUKER}/${REPO_NAVN}" --public \
    --description "Naturregistrering på Ramme Fjordhotell (arbeidsseminar-app, forgrenet fra Bondøya)" \
    --source=. --remote=origin || feil "gh repo create feilet"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/${GH_BRUKER}/${REPO_NAVN}.git"
git push -u origin main

echo "== 2. GitHub Pages (deploy fra main-grenens rot) ==" >&2
if gh api "repos/${GH_BRUKER}/${REPO_NAVN}/pages" >/dev/null 2>&1; then
  echo "  Pages er allerede satt opp — hopper over." >&2
else
  gh api "repos/${GH_BRUKER}/${REPO_NAVN}/pages" -X POST \
    -f "source[branch]=main" -f "source[path]=/" || \
    echo "  (feilet — sjekk manuelt under Settings → Pages i repoet)" >&2
fi

echo "== 3. Cloudflare: worker/api — D1, KV, R2 ==" >&2
cd worker/api

DB_ID=$(npx wrangler d1 list 2>/dev/null | grep -A0 "│ .* │ ramme *│" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -n "$DB_ID" ]; then
  echo "  D1-database 'ramme' finnes allerede (id ${DB_ID}) — hopper over opprettelse." >&2
else
  D1_OUT=$(npx wrangler d1 create ramme) || feil "wrangler d1 create feilet"
  echo "$D1_OUT"
  DB_ID=$(echo "$D1_OUT" | grep -oE 'database_id = "[^"]+"' | head -1 | cut -d'"' -f2)
fi
[ -n "$DB_ID" ] || feil "Fant ikke database_id for D1-databasen 'ramme' — sjekk 'wrangler d1 list' manuelt."

KV_ID=$(npx wrangler kv namespace list 2>/dev/null | grep -B2 "\"title\": \"${KV_TITTEL}\"" | grep -oE '"id": "[^"]+"' | head -1 | cut -d'"' -f4)
if [ -n "$KV_ID" ]; then
  echo "  KV-namespace '${KV_TITTEL}' finnes allerede (id ${KV_ID}) — hopper over opprettelse." >&2
else
  KV_OUT=$(npx wrangler kv namespace create "$KV_TITTEL") || feil "wrangler kv namespace create feilet"
  echo "$KV_OUT"
  KV_ID=$(echo "$KV_OUT" | grep -oE 'id = "[^"]+"' | head -1 | cut -d'"' -f2)
fi
[ -n "$KV_ID" ] || feil "Fant ikke id for KV-namespace '${KV_TITTEL}' — sjekk 'wrangler kv namespace list' manuelt."

if npx wrangler r2 bucket list 2>/dev/null | grep -q "ramme-bilder"; then
  echo "  R2-bucket 'ramme-bilder' finnes allerede — hopper over." >&2
else
  npx wrangler r2 bucket create ramme-bilder || \
    echo "  (R2-opprettelse feilet — sjekk at wrangler-tokenet ditt har R2-tilgang, eller opprett 'ramme-bilder' manuelt i dashbordet)" >&2
fi

# Patch wrangler.toml med de faktiske ID-ene (trygt å kjøre flere ganger —
# sed gjør ingenting hvis placeholderen allerede er byttet ut)
sed -i '' "s/database_id = \"<SETT_INN_VED_DEPLOY>\"/database_id = \"${DB_ID}\"/" wrangler.toml
sed -i '' "s/id = \"<SETT_INN_VED_DEPLOY>\"/id = \"${KV_ID}\"/" wrangler.toml
sed -i '' "s#ALLOWED_ORIGIN = \"https://<SETT_INN_BRUKERNAVN>.github.io\"#ALLOWED_ORIGIN = \"${FRONTEND_OPPRINNELSE}\"#" wrangler.toml

echo "== 4. D1-migrasjoner ==" >&2
npx wrangler d1 migrations apply ramme --remote

echo "== 5. App-interne hemmeligheter (generert her, ikke ekte tredjeparts-nøkler) ==" >&2
if [ -z "${RAMME_INVITASJONSKODE:-}" ]; then
  INVITASJONSKODE=$(node -e "console.log(require('crypto').randomBytes(6).toString('base64url'))")
else
  INVITASJONSKODE="$RAMME_INVITASJONSKODE" # sett denne miljøvariabelen for å gjenbruke en kode på tvers av re-kjøringer
fi
KI_PROXY_SHARED_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "$INVITASJONSKODE" | npx wrangler secret put INVITASJONSKODE
echo "$KI_PROXY_SHARED_SECRET" | npx wrangler secret put KI_PROXY_SHARED_SECRET

echo ""
echo "  >>> INVITASJONSKODE (del denne med de 15-20 kollegene, IKKE commit den): ${INVITASJONSKODE}"
echo "  >>> Skriv den ned nå — den vises ikke igjen av dette skriptet ved en senere re-kjøring"
echo "      (med mindre du setter RAMME_INVITASJONSKODE=<samme kode> i miljøet før du kjører på nytt)."
echo ""

echo "== 6. Cloudflare: worker/ki-proxy ==" >&2
cd ../ki-proxy
sed -i '' "s#ALLOWED_ORIGIN = \"https://<SETT_INN_BRUKERNAVN>.github.io\"#ALLOWED_ORIGIN = \"${FRONTEND_OPPRINNELSE}\"#" wrangler.toml
echo "$KI_PROXY_SHARED_SECRET" | npx wrangler secret put APP_SHARED_SECRET

echo ""
echo "  >>> MANUELT STEG (ekte tredjeparts-nøkler — kjør selv, aldri via Claude):"
echo "      npx wrangler secret put ANTHROPIC_API_KEY"
echo "      npx wrangler secret put ARTSORAKEL_ENDPOINT   # produksjon: https://ai.artsdatabanken.no/identify"
echo "      npx wrangler secret put ARTSORAKEL_TOKEN"
echo ""
read -p "Trykk Enter når de tre secretsene over er satt (eller Ctrl+C for å gjøre det senere og kjøre resten manuelt) ..." _

KI_DEPLOY_OUT=$(npx wrangler deploy) || feil "wrangler deploy (ki-proxy) feilet"
echo "$KI_DEPLOY_OUT"
KI_URL=$(echo "$KI_DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
[ -n "$KI_URL" ] || feil "Fant ikke workers.dev-URL i deploy-output for ki-proxy."

echo "== 7. Deploy worker/api (nå som KI_PROXY_URL er kjent) ==" >&2
cd ../api
sed -i '' "s#KI_PROXY_URL = \"https://<SETT_INN_VED_DEPLOY>.workers.dev\"#KI_PROXY_URL = \"${KI_URL}\"#" wrangler.toml
API_DEPLOY_OUT=$(npx wrangler deploy) || feil "wrangler deploy (api) feilet"
echo "$API_DEPLOY_OUT"
API_URL=$(echo "$API_DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
[ -n "$API_URL" ] || feil "Fant ikke workers.dev-URL i deploy-output for api."

echo "== 8. Frontend: pek på faktisk API-URL ==" >&2
cd ../..
sed -i '' "s#'https://<SETT_INN_VED_DEPLOY>.workers.dev'#'${API_URL}'#" js/api-client.js

git add worker/api/wrangler.toml worker/ki-proxy/wrangler.toml js/api-client.js
git commit -m "Fyll inn faktiske Cloudflare-ressurs-ID-er og URL-er etter førstegangsoppsett" || true
git push

echo ""
echo "===================================================================="
echo "Ferdig. Sjekk følgende før seminaret:"
echo "  Frontend:   ${PAGES_URL}  (kan ta noen minutter før Pages er live)"
echo "  API:        ${API_URL}"
echo "  KI-proxy:   ${KI_URL}"
echo "  Invitasjonskode (delt med kollegene): ${INVITASJONSKODE}"
echo ""
echo "Gjenstår (se veien-videre.md og README.md 'Bevisste forenklinger'):"
echo "  - data/soner-ramme.json og kartgrenser er placeholder, ikke ekte"
echo "  - data/species.json ikke bekreftet mot din egen stedskunnskap"
echo "  - test hele flyten i faktisk iOS Safari/PWA-standalone-modus"
echo "===================================================================="
