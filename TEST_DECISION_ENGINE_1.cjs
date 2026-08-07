'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAnswer } = require('./engine/answer-service.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');

const ROOT = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'knowledge.json'), 'utf8'));
const knowledge = Array.isArray(raw) ? raw : raw.items;
const ruleEngine = new ExpertRuleEngine(path.join(ROOT, 'data', 'rules', 'expert-rules.json'));
const answer = (question, history = []) => createAnswer({ question, history, knowledge, ruleEngine, logGap() {} });

const dermavitalHistory = [
  { role: 'user', content: 'Mit ajánlasz ekcémára?' },
  { role: 'assistant', content: 'Elsőként a Dermavital krémet ajánlom.', route: 'expert_rule', intent: 'eczema' }
];
const psoriasisHistory = [
  { role: 'user', content: 'Pikkelysömörre mit ajánlasz?' },
  { role: 'assistant', content: 'Elsőként a PsoriVital csomagot, kiegészítésként a Holt-tengeri só balzsamot ajánlom.', route: 'expert_rule', intent: 'psoriasis_body' }
];

const cases = [
  // Product categories
  { q: 'van naptej?', route: 'product_category', goal: 'find_product', intent: 'catalog_category_absent', domain: 'sunscreen', source: 'catalog-absent' },
  { q: 'tusfürdőtök van?', route: 'product_category', goal: 'find_product', intent: 'catalog_category_found', domain: 'shower_gel', links: true },
  { q: 'van kézkrém?', route: 'product_category', goal: 'find_product', domain: 'hand_cream' },
  { q: 'van sarokkrém?', route: 'product_category', goal: 'find_product', domain: 'heel_care' },
  { q: 'van szappan?', route: 'product_category', goal: 'find_product', domain: 'soap', links: true },
  { q: 'van sampon?', route: 'product_category', goal: 'find_product', domain: 'shampoo', links: true },
  { q: 'milyen dezodorotok van?', route: 'product_category', goal: 'find_product', domain: 'deodorant', links: true },
  { q: 'izzadásgátlóról', route: 'product_category', domain: 'deodorant', links: true },

  // Problem domains
  { q: 'repedt a sarkam', route: 'problem_domain', goal: 'solve_problem', domain: 'cracked_heel', links: true },
  { q: 'a sarkam fel van repedve', route: 'problem_domain', goal: 'solve_problem', domain: 'cracked_heel', links: true },
  { q: 'száraz sarokra mit ajánlasz?', route: 'problem_domain', goal: 'solve_problem', domain: 'dry_heel' },
  { q: 'viszkető fejbőrre mit használjak?', route: 'expert_rule', goal: 'solve_problem', domain: 'itchy_scalp', links: true },
  { q: 'nagyon száraz a bőröm', route: 'problem_domain', goal: 'solve_problem', domain: 'dry_skin' },
  { q: 'ekcémára krémet keresek', route: 'expert_rule', goal: 'solve_problem', domain: 'eczema', links: true },
  { q: 'pikkelysömörre mit ajánlasz?', route: 'expert_rule', goal: 'solve_problem', domain: 'psoriasis', links: true },

  // Safety boundary
  { q: 'visszérre van valamilyen balzsam?', route: 'safety', goal: 'medical_boundary', domain: 'varicose_cosmetic', safety: 'caution_with_boundary' },
  { q: 'ödémára mit használjak?', route: 'safety', goal: 'medical_boundary', domain: 'edema_medical_boundary', safety: 'caution_with_boundary' },
  { q: 'visszérgyulladásom van', route: 'safety', safety: 'caution_with_boundary' },
  { q: 'javítja a keringést?', route: 'safety', domain: 'circulation_claim', safety: 'caution_with_boundary' },
  { q: 'begyulladt és erős fájdalom van a lábamban', route: 'safety', safety: 'medical_escalation' },
  { q: 'Viszér gyulladásra és ödémára keringésre', route: 'safety', safety: 'caution_with_boundary' },

  // Child use
  { q: '8 éves gyerek használhatja?', route: 'clarification', goal: 'ask_child_usage', domain: 'child_usage' },
  { q: 'A Dermavital krémet használhatja 8 éves?', route: 'context_followup', goal: 'ask_child_usage', context: true, links: true },
  { q: 'És gyereknek?', h: dermavitalHistory, route: 'context_followup', goal: 'ask_child_usage', context: true, links: true },
  { q: 'Babának jó?', route: 'clarification', goal: 'ask_child_usage' },
  { q: 'A sampon mehet gyereknek is?', route: 'clarification', goal: 'ask_child_usage' },

  // Commerce
  { q: 'Szeretném megrendelni', route: 'commerce', goal: 'start_order', intent: 'order_start' },
  { q: 'hol tudom megvenni', route: 'commerce', intent: 'purchase_location' },
  { q: 'mennyibe kerül?', route: 'clarification', goal: 'ask_price', intent: 'price_query' },
  { q: 'mennyibe kerül?', h: dermavitalHistory, route: 'commerce', goal: 'ask_price', intent: 'price_query', context: true, links: true },
  { q: 'A Dermavital krém mennyibe kerül?', route: 'commerce', goal: 'ask_price', intent: 'price_query', context: false, links: true },
  { q: 'van készleten?', route: 'clarification', goal: 'ask_availability', intent: 'availability_query' },
  { q: 'van készleten?', h: dermavitalHistory, route: 'commerce', goal: 'ask_availability', context: true, links: true },
  { q: 'hogy szállítotok?', route: 'commerce', goal: 'ask_shipping', intent: 'shipping_general' },
  { q: 'mennyi a szállítási díj?', route: 'commerce', goal: 'ask_shipping', intent: 'shipping_cost' },
  { q: 'mikor érkezik meg?', route: 'commerce', goal: 'ask_shipping', intent: 'shipping_time' },
  { q: 'lehet utánvéttel fizetni?', route: 'commerce', goal: 'ask_payment', intent: 'payment' },

  // Follow-up/context
  { q: 'Micsoda?', h: psoriasisHistory, route: 'context_followup', goal: 'clarify_previous_answer', context: true },
  { q: 'Melyik?', h: psoriasisHistory, route: 'context_followup', goal: 'compare_products', context: true, links: true },
  { q: 'Ezt hogyan használjam?', h: dermavitalHistory, route: 'context_followup', goal: 'ask_usage', context: true, links: true },
  { q: 'Van nagyobb?', h: dermavitalHistory, route: 'context_followup', goal: 'ask_variant', context: true, links: true },
  { q: 'A másodikat.', h: psoriasisHistory, route: 'context_followup', context: true, links: true },

  // Typo / no accents
  { q: 'repet a sarkam', route: 'problem_domain', domain: 'cracked_heel' },
  { q: 'van tusfurdo', route: 'product_category', domain: 'shower_gel', links: true },
  { q: 'izzadasgatlo', route: 'product_category', domain: 'deodorant', links: true },
  { q: 'pikejsomorre mit ajanlasz', route: 'problem_domain', domain: 'psoriasis' },
  { q: 'viszketo fejbor', route: 'expert_rule', domain: 'itchy_scalp' },

  // Genuine gaps / unsupported claims
  { q: 'Van SPF 50-es naptejetek?', route: 'product_category', intent: 'catalog_category_absent', domain: 'sunscreen' },
  { q: 'Melyik termék gyógyítja biztosan az ödémát?', route: 'safety', safety: 'caution_with_boundary' },
  { q: 'Holnap mennyi lesz a Dermavital ára?', route: 'hard_fallback' },
  { q: 'Garantáltan elmulasztja a visszeret?', route: 'safety' },
  { q: 'Melyik terméket használja egy konkrét híresség?', route: 'hard_fallback' },

  // Existing stable routes
  { q: 'Tartalmaz SLS-t?', route: 'expert_rule', source: 'expert-sls-sles' },
  { q: 'Ki vagy?', route: 'meta', source: 'meta-intent' },
  { q: 'Pikkelyesömöre használ?', route: 'knowledge', source: 'knowledge-fallback' },
  { q: 'Dermavital krém', route: 'exact_product', links: true }
];

assert.ok(cases.length >= 48, `Legalább 48 eset kell, jelenleg ${cases.length}.`);
for (const test of cases) {
  const result = answer(test.q, test.h || []);
  assert.strictEqual(result.route, test.route, `${test.q}: route (${result.route})`);
  if (test.goal) assert.strictEqual(result.goal, test.goal, `${test.q}: goal`);
  if (test.intent) assert.strictEqual(result.intent, test.intent, `${test.q}: intent`);
  if (test.domain) assert.strictEqual(result.domain, test.domain, `${test.q}: domain`);
  if (test.safety) assert.strictEqual(result.safetyClass, test.safety, `${test.q}: safetyClass`);
  if (test.context !== undefined) assert.strictEqual(result.contextUsed, test.context, `${test.q}: contextUsed`);
  if (test.source) assert.strictEqual(result.responseSource, test.source, `${test.q}: responseSource`);
  assert.ok(result.responseSource, `${test.q}: responseSource hiányzik`);
  assert.ok(Number.isFinite(result.routing.confidence), `${test.q}: confidence hiányzik`);
  assert.ok(result.routing.threshold >= 0, `${test.q}: threshold hiányzik`);
  assert.ok(!test.links || (result.links || []).some((item) => /^https:\/\/([a-z0-9-]+\.)*vitalis-szappan\.hu\//i.test(item.url || '')), `${test.q}: megfelelő terméklink hiányzik`);
  assert.ok(!/garantáltan (gyógyít|elmulaszt)|biztosan (gyógyít|elmulaszt)|meggyógyítja/i.test(result.answer), `${test.q}: tiltott gyógyítási állítás`);
  if (!['hard_fallback'].includes(test.route)) assert.notStrictEqual(result.route, 'hard_fallback', `${test.q}: indokolatlan hard fallback`);
}

console.log(`Decision Engine regresszió: PASS (${cases.length} kérdés)`);
