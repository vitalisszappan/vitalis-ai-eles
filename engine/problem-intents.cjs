'use strict';

const { normalize } = require('./normalizer.cjs');

const DOMAIN_PATTERNS = [
  ['edema_medical_boundary', /\b(odema|vizenyos|vizesedes)\w*/],
  ['varicose_cosmetic', /\b(visszer|viszer|venas)\w*/],
  ['circulation_claim', /\b(keringes|verkeringes|nyirokkeringes)\w*/],
  ['cracked_heel', /\b(reped\w*|repet|kireped\w*)\b.*\b(sarok|sarkam|sarka)|\b(sarok|sarkam|sarka)\b.*\b(reped\w*|repet|kireped\w*)/],
  ['dry_heel', /\b(szaraz|kemeny|borkemenyedes)\b.*\b(sarok|sarkam)|\b(sarok|sarkam)\b.*\b(szaraz|kemeny|borkemenyedes)/],
  ['itchy_scalp', /\b(viszket|viszketo|korpas|hamlo)\b.*\b(fejbor|fejem)|\b(fejbor|fejem)\b.*\b(viszket|viszketo|korpas|hamlo)/],
  ['psoriasis', /\b(pikkelysomor|pszoriazis|pikej?somor)\w*/],
  ['eczema', /\b(ekcema|ekcemas|atopia|atopias|dermatitisz)\w*/],
  ['acne', /\b(akne|aknes|pattanas|pattanasos|mitesszer)\w*/],
  ['rosacea', /\b(rosacea|rozacea|rozsacea|kipirosodas)\w*/],
  ['couperose', /\b(couperose|kuperoz|hajszaler|ertagulat)\w*/],
  ['dry_skin', /\b(szaraz bor|szaraz a bor(?:om)?|kiszaradt bor(?:om)?|huzodik a bor(?:om)?)\b/],
  ['child_usage', /\b(gyerek|gyermek|kisgyerek|baba|[0-9]{1,2} eves)\b.*\b(hasznal|hasznalhat|jo|adhato)|\b(hasznal|hasznalhat|jo|adhato)\w*.*\b(gyerek|gyermek|baba)\b/]
];

const EXPERT_DOMAIN_MAP = Object.freeze({
  itchy_scalp: 'scalp_itchy', psoriasis: 'psoriasis_body', eczema: 'eczema',
  acne: 'acne', dry_skin: 'dry_skin'
});

function detectProblemIntent(question) {
  const text = normalize(question);
  for (const [domain, pattern] of DOMAIN_PATTERNS) {
    if (pattern.test(text)) return { domain, evidence: [`problem:${domain}`], expertRuleId: EXPERT_DOMAIN_MAP[domain] || null };
  }
  return null;
}

module.exports = { detectProblemIntent, EXPERT_DOMAIN_MAP };
