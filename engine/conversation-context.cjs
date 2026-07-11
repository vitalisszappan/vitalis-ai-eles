const { findProductInText } = require('./product-faq.cjs');

const PROBLEM_PATTERNS = [
  ['eczema', ['ekcema', 'atopias', 'dermatitisz']],
  ['scalp', ['fejbor', 'korpa', 'korpas', 'hajlas', 'viszket a fejbor']],
  ['psoriasis', ['pikkelysomor', 'pszoriazis']],
  ['acne', ['akne', 'pattanas', 'pattanasos', 'mitesszer']],
  ['dry_skin', ['szaraz bor', 'kiszáradt bor', 'huzodik a borom']]
];

function detectProblem(text) {
  for (const [id, phrases] of PROBLEM_PATTERNS) {
    if (phrases.some((phrase) => text.includes(phrase))) return id;
  }
  return null;
}

function buildConversationContext(history = [], normalize) {
  const context = {
    lastUserProduct: null,
    lastAssistantProduct: null,
    lastProduct: null,
    lastProblem: null,
    mentionedProducts: []
  };

  for (const message of history.slice(-16)) {
    if (!message || !message.content) continue;
    const text = normalize(message.content);
    const product = findProductInText(text, message.role === 'assistant');
    if (product) {
      if (!context.mentionedProducts.includes(product)) context.mentionedProducts.push(product);
      if (message.role === 'user') context.lastUserProduct = product;
      if (message.role === 'assistant') context.lastAssistantProduct = product;
      context.lastProduct = product;
    }
    const problem = detectProblem(text);
    if (problem) context.lastProblem = problem;
  }

  // Konkrét felhasználói terméknév elsőbbséget kap, egyébként az utolsó ajánlás.
  context.lastProduct = context.lastUserProduct || context.lastAssistantProduct || context.lastProduct;
  return context;
}

module.exports = { buildConversationContext, detectProblem };
