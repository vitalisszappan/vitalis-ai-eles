const { searchKnowledge } = require('./knowledge-fallback.cjs');
function createAnswer({ question, history, knowledge, ruleEngine, logGap }) {
  const expert = ruleEngine.resolve(question, history);
  if (expert) return expert;
  const matches = searchKnowledge(knowledge, question);
  const best = matches[0];
  if (!best || best.score < 60) {
    logGap(question, best?.score || 0, history);
    return {
      source: 'gap',
      answer: 'Erre még nem találtam elég pontos, jóváhagyott Vitalis-információt. Írd meg kérlek részletesebben, melyik termékről vagy problémáról van szó.',
      confidence: best?.score || 0,
      links: [], suggestions: [], ruleId: null, intent: null
    };
  }
  return {
    source: 'knowledge-fallback',
    answer: String(best.item.fullAnswer || best.item.shortAnswer || '').trim(),
    confidence: best.score,
    links: [], suggestions: [], ruleId: null, intent: best.item.intents?.[0] || null,
    matchedKnowledgeIds: [best.item.id]
  };
}
module.exports = { createAnswer };
