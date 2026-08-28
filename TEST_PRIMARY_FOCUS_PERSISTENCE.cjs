'use strict';

const assert = require('node:assert/strict');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState, normalizeMessage } = require('./engine/conversation-memory.cjs');
const { buildConversationContext, resolveProductReference } = require('./engine/conversation-context.cjs');
const { normalize } = require('./engine/normalizer.cjs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const knowledge = require('./data/knowledge.json');

const ruleEngine = new ExpertRuleEngine('./data/rules/expert-rules.json');
const links = [
  { id: 'dermavital_krem', name: 'Dermavital krém' },
  { id: 'dermavital_szappan', name: 'Dermavital szappan' }
];
const history = [
  { role: 'user', content: 'Ekcémára mit ajánlasz?' },
  { role: 'assistant', content: 'A Dermavital krémet ajánlom, mellé a szappant.', route: 'expert_rule', intent: 'product_recommendation', targetProductId: 'dermavital_krem', links }
];
const answer = (question, sourceHistory = history) => createAnswer({ question, history: sourceHistory, conversationState: structuredState(sourceHistory), knowledge, ruleEngine, logGap() {} });

const normalized = normalizeMessage(history[1]);
assert.equal(normalized.targetProductId, 'dermavital_krem');
let state = structuredState(history);
assert.equal(state.focusedProductId, 'dermavital_krem');
assert.equal(state.productContextStatus, 'resolved');
assert.equal(state.purchaseProductId, null);

let result = answer('Miért ezt ajánlod?');
assert.equal(result.contextTarget, 'dermavital_krem');

result = answer('A második mit tud?');
assert.equal(result.contextTarget, 'dermavital_szappan');

result = answer('Inkább a Dermavital szappan érdekel.');
assert.equal(result.links[0].id, 'dermavital_szappan');

const noPrimary = [{ role: 'assistant', content: 'Két lehetőség.', links }];
state = structuredState(noPrimary);
assert.equal(state.productContextStatus, 'ambiguous');
assert.equal(state.purchaseProductId, null);
const ambiguousContext = buildConversationContext(noPrimary, normalize);
assert.equal(resolveProductReference('És ez?', ambiguousContext).ambiguous, true);

result = answer('Ezt kérem.');
assert.equal(result.route, 'commerce');
assert.equal(result.intent, 'order_start');
assert.equal(result.contextTarget, 'dermavital_krem');

console.log('Primary focus persistence: PASS (6/6)');
