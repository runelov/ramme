#!/usr/bin/env bash
# Førstegangs infrastruktur-oppsett for Ramme — kjøres av produkteier selv,
# ikke av Claude (permission-klassifisereren i denne Claude Code-økten
# blokkerer bevisst repo-/ressurs-opprettende kommandoer og selv-tildeling
# av tillatelser, som en sikkerhetssperre — ikke noe å prøve å omgå).
#
# Forutsetninger: `gh auth status` og `npx wrangler whoami` viser at du
# allerede er innlogget (verifisert i denne økten — gh som runelov, wrangler
# mot Rune.lovneseth@gmail.com sin Cloudflare-konto).
#
# Kjør fra roten av dette repoet:
#   cd ~/claude/ramme-workspace/ramme
#   bash scripts/forste-oppsett.sh
#
# Skriptet stopper ved første feil (set -e). Trygt å kjøre på nytt —
# allerede opprettede ressurser feiler bare med en tydelig "already exists"
# du kan ignorere og fortsette forbi manuelt (fjern -e-stoppen for den
# linjen, eller kjør resten av linjene for hånd).

set -euo pipefail
cd "$(dirname "$0")/.."

GH_BRUKER="runelov"
REPO_NAVN="ramme"
PAGES_URL="https://${GH_BRUKER}.github.io/${REPO_NAVN}"

echo "== 1. GitHub-repo ==" >&2
gh repo create "${GH_BRUKER}/${REPO_NAVN}" --public \
  --description "Naturregistrering på Ramme Fjordhotell (arbeidsseminar-app, forgrenet fra Bondøya)" \
  --source=. --remote=origin
git push -u origin main

echo "== 2. GitHub Pages (deploy fra main-grenens rot) ==" >&2
gh api "repos/${GH_BRUKER}/${REPO_NAVN}/pages" -X POST \
  -f "source[branch]=main" -f "source[path]=/" || \
  echo "  (feilet/allerede satt opp — sjekk manuelt under Settings → Pages i repoet)" >&2

echo "== 3. Cloudflare: worker/api — D1, KV, R2 ==" >&2
cd worker/api

D1_OUT=$(npx wrangler d1 create ramme)
echo "$D1_OUT"
DB_ID=$(echo "$D1_OUT" | grep -oE 'database_id = "[^"]+"' | head -1 | cut -d'"' -f2)

KV_OUT=$(npx wrangler kv namespace create RATE_LIMIT)
echo "$KV_OUT"
KV_ID=$(echo "$KV_OUT" | grep -oE 'id = "[^"]+"' | head -1 | cut -d'"' -f2)

npx wrangler r2 bucket create ramme-bilder || \
  echo "  (R2-opprettelse feilet — sjekk at wrangler-tokenet ditt har R2-tilgang, eller opprett 'ramme-bilder' manuelt i dashbordet)" >&2

# Patch wrangler.toml med de faktiske ID-ene
sed -i '' "s/database_id = \"<SETT_INN_VED_DEPLOY>\"/database_id = \"${DB_ID}\"/" wrangler.toml
sed -i '' "s/id = \"<SETT_INN_VED_DEPLOY>\"/id = \"${KV_ID}\"/" wrangler.toml
sed -i '' "s#ALLOWED_ORIGIN = \"https://<SETT_INN_BRUKERNAVN>.github.io\"#ALLOWED_ORIGIN = \"${PAGES_URL%/ramme}\"#" wrangler.toml

echo "== 4. D1-migrasjoner ==" >&2
npx wrangler d1 migrations apply ramme --remote

echo "== 5. App-interne hemmeligheter (generert her, ikke ekte tredjeparts-nøkler) ==" >&2
INVITASJONSKODE=$(node -e "console.log(require('crypto').randomBytes(6).toString('base64url'))")
KI_PROXY_SHARED_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "$INVITASJONSKODE" | npx wrangler secret put INVITASJONSKODE
echo "$KI_PROXY_SHARED_SECRET" | npx wrangler secret put KI_PROXY_SHARED_SECRET

echo ""
echo "  >>> INVITASJONSKODE (del denne med de 15-20 kollegene, IKKE commit den): ${INVITASJONSKODE}"
echo ""

echo "== 6. Cloudflare: worker/ki-proxy ==" >&2
cd ../ki-proxy
sed -i '' "s#ALLOWED_ORIGIN = \"https://<SETT_INN_BRUKERNAVN>.github.io\"#ALLOWED_ORIGIN = \"${PAGES_URL%/ramme}\"#" wrangler.toml
echo "$KI_PROXY_SHARED_SECRET" | npx wrangler secret put APP_SHARED_SECRET

echo ""
echo "  >>> MANUELT STEG (ekte tredjeparts-nøkler — kjør selv, aldri via Claude):"
echo "      npx wrangler secret put ANTHROPIC_API_KEY"
echo "      npx wrangler secret put ARTSORAKEL_ENDPOINT   # produksjon: https://ai.artsdatabanken.no/identify"
echo "      npx wrangler secret put ARTSORAKEL_TOKEN"
echo ""
read -p "Trykk Enter når de tre secretsene over er satt (eller Ctrl+C for å gjøre det senere og kjøre resten manuelt) ..." _

KI_DEPLOY_OUT=$(npx wrangler deploy)
echo "$KI_DEPLOY_OUT"
KI_URL=$(echo "$KI_DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)

echo "== 7. Deploy worker/api (nå som KI_PROXY_URL er kjent) ==" >&2
cd ../api
sed -i '' "s#KI_PROXY_URL = \"https://<SETT_INN_VED_DEPLOY>.workers.dev\"#KI_PROXY_URL = \"${KI_URL}\"#" wrangler.toml
API_DEPLOY_OUT=$(npx wrangler deploy)
echo "$API_DEPLOY_OUT"
API_URL=$(echo "$API_DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)

echo "== 8. Frontend: pek på faktisk API-URL ==" >&2
cd ../..
sed -i '' "s#'https://<SETT_INN_VED_DEPLOY>.workers.dev'#'${API_URL}'#" js/api-client.js

git add worker/api/wrangler.toml worker/ki-proxy/wrangler.toml js/api-client.js
git commit -m "Fyll inn faktiske Cloudflare-ressurs-ID-er og URL-er etter førstegangsoppsett"
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
