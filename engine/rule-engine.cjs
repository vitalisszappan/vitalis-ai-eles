const fs = require('fs');
const path = require('path');
const { normalize } = require('./normalizer.cjs');
const { productCards } = require('./product-catalog.cjs');
const { findRecentProductFromHistory, childAnswer } = require('./product-faq.cjs');
const { buildConversationContext } = require('./conversation-context.cjs');
const { isRelationQuestion, resolveRelation } = require('./product-relations.cjs');
const { resolveAdministrativeIntent } = require('./admin-intents.cjs');

class ExpertRuleEngine {
  constructor(rulePath) {
    this.rulePath = rulePath;
    this.rules = [];
    this.loadedAt = null;
    this.load();
  }
  load() {
    const parsed = JSON.parse(fs.readFileSync(this.rulePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('Az expert-rules.json nem tömb.');
    this.rules = parsed.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.loadedAt = new Date().toISOString();
  }
  matches(rule, text) {
    const n = normalize(text);
    const matchAll = (rule.matchAll || []).map(normalize);
    const matchAny = (rule.matchAny || []).map(normalize);
    const excludeAny = (rule.excludeAny || []).map(normalize);
    if (excludeAny.some((x) => x && n.includes(x))) return false;
    if (matchAll.length && !matchAll.every((x) => n.includes(x))) return false;
    if (matchAny.length && !matchAny.some((x) => n.includes(x))) return false;
    return matchAll.length > 0 || matchAny.length > 0;
  }
  resolve(question, history = []) {
    // A rendelési, szállítási, fizetési és kuponos kérdések mindig a jelenlegi
    // mondat alapján kapnak választ. Ezeknél tilos a korábbi termékkontextust örökíteni.
    const administrative = resolveAdministrativeIntent(question);
    if (administrative) return administrative;

    const current = normalize(question);
    const combined = normalize([
      ...history.filter((m) => m && m.role === 'user').slice(-3).map((m) => m.content || ''),
      question
    ].join(' '));

    const isGenericUsageFollowUp = /^(es )?(hogyan hasznaljam|milyen gyakran hasznaljam|naponta hanyszor|ezt hogyan hasznaljam)/.test(current);
    const isChildFollowUp = /^(es )?(gyermeknek|gyereknek|kisgyereknek|babának|babanak)( is)? (hasznalhato|jo|adhato)|^(hasznalhato|jo) (gyermeknek|gyereknek|kisgyereknek|babának|babanak)/.test(current);
    const context = buildConversationContext(history, normalize);
    let rule = null;

    // Kapcsolódó termékre vonatkozó rövid kérdések: „Milyen szappant használjak mellé?”
    if (isRelationQuestion(current)) {
      const productId = context.lastProduct || findRecentProductFromHistory(history.slice(-12), normalize);
      const relation = productId ? resolveRelation(productId, current) : null;
      if (relation) {
        const ids = [relation.relatedProduct].filter(Boolean);
        return {
          source: 'product-relation',
          ruleId: `relation_${productId}_${relation.type}`,
          intent: 'product_companion',
          answer: relation.answer,
          confidence: 100,
          links: productCards(ids),
          suggestions: relation.relatedProduct ? [
            { label: 'Hogyan használjam?', question: `Hogyan használjam ezt a terméket?` }
          ] : []
        };
      }
    }

    // Rövid gyermekhasználati kérdésnél a legutóbb említett vagy ajánlott termékhez válaszolunk.
    if (isChildFollowUp) {
      const productId = findRecentProductFromHistory(history.slice(-10), normalize);
      const answer = productId ? childAnswer(productId) : null;
      if (answer) {
        return {
          source: 'product-faq',
          ruleId: `child_${productId}`,
          intent: 'child_usage',
          answer,
          confidence: 100,
          links: productCards([productId]),
          suggestions: []
        };
      }
      return {
        source: 'product-faq',
        ruleId: 'child_clarify_product',
        intent: 'child_usage',
        answer: 'Melyik termékre gondolsz? Írd meg a nevét, és rögtön válaszolok.',
        confidence: 100,
        links: [],
        suggestions: [
          { label: 'Dermavital krém', question: 'A Dermavital krém gyermeknek is használható?' },
          { label: 'Dermavital szappan', question: 'A Dermavital szappan gyermeknek is használható?' },
          { label: 'Dermavital sampon', question: 'A Dermavital sampon gyermeknek is használható?' }
        ]
      };
    }

    // Rövid használati kérdésnél először az utolsó ajánlott/megnevezett terméket keressük.
    if (isGenericUsageFollowUp) {
      const recentConversation = normalize(history.slice(-6).map((m) => m && m.content || '').join(' '));
      const productPhrases = [
        ['aktiv szenes szappan', 'Hogyan használjam az Aktív szenes szappant?'],
        ['dermavital sampon', 'Hogyan használjam a Dermavital sampont?'],
        ['dermavital krem', 'Hogyan használjam a Dermavital krémet?'],
        ['dermavital szappan', 'Hogyan használjam a Dermavital szappant?'],
        ['shea vajas szappan', 'Hogyan használjam a Shea vajas szappant?']
      ];
      const found = productPhrases.find(([phrase]) => recentConversation.includes(normalize(phrase)));
      if (found) rule = this.rules.find((r) => this.matches(r, normalize(found[1])));
    }

    if (!rule) rule = this.rules.find((r) => this.matches(r, current));
    if (!rule && /^(es |ezt |azt |milyen gyakran|hogyan hasznaljam|gyereknek is)/.test(current)) {
      rule = this.rules.find((r) => this.matches(r, combined));
    }
    if (!rule) return null;
    const ids = [rule.primaryProduct, ...(rule.secondaryProducts || [])].filter(Boolean);
    let answer = rule.answer;
    if (rule.safetyNote) answer += `\n\n${rule.safetyNote}`;
    return {
      source: 'expert-rule',
      ruleId: rule.id,
      intent: rule.intent,
      answer,
      confidence: 100,
      links: productCards(ids),
      suggestions: rule.suggestions || []
    };
  }
  status() {
    return { count: this.rules.length, loadedAt: this.loadedAt };
  }
}
module.exports = { ExpertRuleEngine };
