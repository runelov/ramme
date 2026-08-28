// Forket fra FUNGIFINDERS opprinnelige cors.js (fra før FungiFinder selv
// migrerte til samme-domene/SameSite=Lax), IKKE fra Bondøyas nåværende
// variant — se arkitektur.md ADR 2 og CLAUDE.md. Ramme kjører på GitHub
// Pages default-domene (`<bruker>.github.io/ramme/`) og API-et på en
// `*.workers.dev`-subdomene — to ULIKE registrerbare domener, ekte
// cross-site, ikke bare cross-origin-innenfor-samme-site.
//
// Auth bruker en cookie (fetch() med credentials:'include' fra frontend) —
// en wildcard-origin er ikke lov sammen med credentials, så ALLOWED_ORIGIN
// må alltid være ett eksakt opphav.
//
// Sesjonscookien settes derfor med SameSite=None (se session.js) i stedet
// for Lax, og som motvekt krever alle muterende ruter at Origin-headeren
// nøyaktig matcher ALLOWED_ORIGIN (se sjekkOpprinnelse under) — samme
// forsvar en streng SameSite=Lax-policy ellers ville gitt gratis. Dette er
// en kjent, bevisst akseptert risiko (mistenkt rotårsak til en iOS-PWA-bug
// i FungiFinder der data stille sluttet å laste) — test eksplisitt i iOS
// Safari/PWA-standalone-modus før seminaret.
export function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// CSRF-motforanstaltning for SameSite=None-cookien — kalles fra ALLE
// muterende (POST/PATCH/DELETE) ruter, ikke bare auth. Bevisst en enkel
// eksakt-match, ikke en "starter med"-sjekk (unngår at f.eks.
// https://<bruker>.github.io.evil.no slipper gjennom).
export function sjekkOpprinnelse(request, env) {
  const origin = request.headers.get('Origin');
  return origin === env.ALLOWED_ORIGIN;
}
