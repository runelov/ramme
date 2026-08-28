// Forket UENDRET i logikk fra Bondøya (kun kommentar-referanser justert) —
// se mittbondøya-workspace/bondoya/worker/api/src/lib/taxonomi.js. Delt
// mellom arter.js (søk) og funn.js (autoritativ artstype-utledning ved
// registrering) — se CLAUDE.md for at Ramme IKKE innfører noen ny artstype
// (de 17 eksisterende dekker Rammes kuraterte artsutvalg, se konsept.md).
export const ARTSKART_API = 'https://artskart.artsdatabanken.no/publicapi/api';

export const ARTSTYPER = [
  'fugl', 'sjøpattedyr', 'pattedyr', 'plante', 'alge', 'sopp', 'fisk',
  'bløtdyr', 'krepsdyr', 'insekt', 'edderkoppdyr', 'krypdyr', 'amfibium',
  'nesledyr', 'pigghud', 'leddorm', 'annet',
];

// Artsdatabankens TaxonGroup/Kingdom/Class/Family dekker ikke appens
// artstype-skjema 1:1 (spesielt sjøpattedyr vs. pattedyr). Familielisten er
// utvidet med 'Phocoenidae' i forhold til Bondøyas opprinnelige liste —
// nise (Phocoena phocoena) er et av Rammes kuraterte sjøpattedyr
// (indre Oslofjord, se artsliste.md) og hørte ikke hjemme i noen av
// Bondøyas opprinnelige familier.
const SJOPATTEDYR_FAMILIER = new Set([
  'Phocidae', 'Otariidae', 'Odobenidae', 'Phocoenidae',
  'Balaenopteridae', 'Delphinidae', 'Monodontidae', 'Physeteridae', 'Ziphiidae',
]);

export function utledArtstype(taxon) {
  if (taxon.TaxonGroup === 'Fugler') return 'fugl';
  if (taxon.TaxonGroup === 'Alger') return 'alge';
  if (taxon.Kingdom === 'Plantae') return 'plante';
  if (taxon.Kingdom === 'Fungi') return 'sopp';
  if (taxon.TaxonGroup === 'Fisker') return 'fisk';
  if (taxon.TaxonGroup === 'Bløtdyr') return 'bløtdyr';
  if (taxon.TaxonGroup === 'Krepsdyr') return 'krepsdyr';
  if (taxon.Class === 'Mammalia') {
    return SJOPATTEDYR_FAMILIER.has(taxon.Family) ? 'sjøpattedyr' : 'pattedyr';
  }
  if (taxon.Class === 'Insecta') return 'insekt';
  if (taxon.Class === 'Arachnida') return 'edderkoppdyr';
  if (taxon.Class === 'Reptilia') return 'krypdyr';
  if (taxon.Class === 'Amphibia') return 'amfibium';
  if (taxon.TaxonGroup === 'svamper, nesledyr, kammaneter') return 'nesledyr';
  if (taxon.TaxonGroup === 'Armfotinger, pigghuder, kappedyr') return 'pigghud';
  if (taxon.TaxonGroup === 'Leddormer') return 'leddorm';
  return 'annet';
}

// Speiler js/app.js sin RODLISTE_LABELS-nøkkelmengde — egen, bevisst
// duplisert server-side allow-liste (samme mønster som Bondøya). Kun
// NT/VU/EN/CR teller som rødlistet.
const RODLISTE_KATEGORIER = new Set(['NT', 'VU', 'EN', 'CR']);
export const RODLISTE_LABELS = { NT: 'nær truet', VU: 'sårbar', EN: 'sterkt truet', CR: 'kritisk truet' };

// Se Bondøyas taxonomi.js for VIKTIG-notatet om Context 'N' (fastlands-Norge)
// vs. 'S' (Svalbard) — samme filter gjenbrukt uendret, Ramme (Vestby,
// Akershus) er like mye fastlands-Norge som Bondøya var.
function utledRodlistekategori(taxon) {
  const tags = Array.isArray(taxon.TaxonTags) ? taxon.TaxonTags : [];
  const tag = tags.find((t) => t.TagGroup === 'Norsk Rødliste 2021' && t.Context === 'N');
  return tag && RODLISTE_KATEGORIER.has(tag.Tag) ? tag.Tag : null;
}

// Autoritativt taxonId → artstype-/rødlistekategori-oppslag brukt ved
// lagring/redigering av funn (se validerFunnFelter i lib/funn.js) — se
// Bondøyas taxonomi.js for hele "aldri stol på klienten"-begrunnelsen.
export async function hentAutoritativArtstype(taxonId) {
  if (!taxonId) return null;
  try {
    const res = await fetch(`${ARTSKART_API}/taxon/${taxonId}`);
    if (!res.ok) return null;
    const taxon = await res.json();
    if (!taxon || !taxon.TaxonId) return null;
    return { artstype: utledArtstype(taxon), rodlistekategori: utledRodlistekategori(taxon) };
  } catch {
    return null;
  }
}
