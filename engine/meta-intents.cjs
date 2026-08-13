'use strict';

const { normalize } = require('./normalizer.cjs');

function result(ruleId, intent, answer) {
  return {
    source: 'meta-intent',
    ruleId,
    intent,
    answer,
    confidence: 100,
    links: [],
    suggestions: [],
    matchedKnowledgeIds: []
  };
}

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(normalize(phrase)));
}

function resolveMetaIntent(question) {
  const q = normalize(question);
  if (!q) return null;

  if (/^(koszonom|koszi|nagyon koszonom|koszonom szepen|oke koszonom|rendben koszonom)[.! ]*$/.test(q)) {
    return result('social-thanks', 'social-thanks', 'Nagyon sz\u00edvesen! Ha szeretn\u00e9l, seg\u00edtek m\u00e9g a v\u00e1laszt\u00e1sban vagy a haszn\u00e1latban.');
  }
  if (/^(rendben|oke|ertem|szuper)[.! ]*$/.test(q)) {
    return result('social-acknowledgement', 'social-acknowledgement', 'Rendben! Ha felmer\u00fcl m\u00e9g k\u00e9rd\u00e9sed, sz\u00edvesen seg\u00edtek.');
  }
  if (/^(viszlat|szia|hello|hello)[.! ]*$/.test(q)) {
    const greeting = /^(szia|hello|hello)/.test(q);
    return result(greeting ? 'social-greeting' : 'social-goodbye', greeting ? 'social-greeting' : 'social-goodbye', greeting ? 'Szia! Miben seg\u00edthetek a Vitalis term\u00e9kekkel kapcsolatban?' : 'Viszl\u00e1t! Ha k\u00e9s\u0151bb k\u00e9rd\u00e9sed lesz, sz\u00edvesen seg\u00edtek.');
  }

  const asksAboutProductCreator =
    includesAny(q, [
      'ki az a szalacsi zoltan',
      'ki szalacsi zoltan',
      'mit csinal szalacsi zoltan'
    ]) ||
    (
      includesAny(q, ['ki kesziti', 'ki fejleszti', 'ki alkotja', 'ki csinalja']) &&
      includesAny(q, ['vitalis termek', 'termekeket', 'naturkozmetikum'])
    );

  if (asksAboutProductCreator) {
    return result(
      'vitalis-product-creator',
      'vitalis-product-creator',
      'Szalacsi Zoltán a Vitalis natúrkozmetikumok fejlesztője és készítője.'
    );
  }

  if (includesAny(q, [
    'milyen technologiaval mukodsz',
    'milyen technologia mukodtet',
    'hogyan mukodsz technikailag',
    'milyen rendszer vagy',
    'mi van a hatterben'
  ])) {
    return result(
      'chatbot-technology',
      'chatbot-technology',
      'AI-alapú rendszer vagyok, amely a Vitalis jóváhagyott terméktudásából, webshopadataiból és beszélgetési szabályaiból dolgozik. A háttérrendszer részletes technikai felépítéséről nem adok ki belső vagy bizonytalan információt.'
    );
  }

  if (includesAny(q, [
    'mesterséges intelligencia vagy',
    'mesterseges intelligencia vagy',
    'ai vagy',
    'te egy ai'
  ])) {
    return result(
      'chatbot-ai-identity',
      'chatbot-identity',
      'Igen, AI-alapú asszisztens vagyok. A feladatom, hogy a Vitalis termékekkel, használatukkal és a gyakori vásárlói kérdésekkel kapcsolatban segítsek eligazodni.'
    );
  }

  if (includesAny(q, ['hol dolgozol', 'hol vegzed a munkad'])) {
    return result(
      'chatbot-workplace',
      'chatbot-identity',
      'A Vitalis webshop online asszisztenseként segítek a vásárlóknak.'
    );
  }

  const asksAboutChatbotDeveloper =
    includesAny(q, [
      'ki fejlesztett',
      'ki fejlesztette a chatbotot',
      'ki csinalta ezt a chatbotot',
      'ki keszitette ezt a chatbotot',
      'ki csinalta a chatbotot',
      'ki keszitette a chatbotot',
      'ki all a chatbot mogott'
    ]);

  if (asksAboutChatbotDeveloper) {
    const asksForImplementation = includesAny(q, [
      'ki csinalta ezt a chatbotot',
      'ki keszitette ezt a chatbotot',
      'ki all a chatbot mogott'
    ]);

    return result(
      'chatbot-development',
      'chatbot-development',
      asksForImplementation
        ? 'A chatbot a Vitalis saját ügyféltámogató rendszere. A háttérben több technológiai komponens dolgozik együtt, de a rendszer célja és tudása a Vitalis igényeire épül. A technikai megvalósítás belső részleteiről nem adok ki bizonytalan vagy érzékeny információt.'
        : 'A chatbot a Vitalis saját digitális asszisztense, amelyet a Vitalis webshop vásárlóinak támogatására fejlesztettünk és folyamatosan továbbfejlesztünk. A rendszer a Vitalis terméktudására és jóváhagyott információira épül. A Vitalis natúrkozmetikumok fejlesztője és készítője Szalacsi Zoltán.'
    );
  }

  if (includesAny(q, ['ki vagy', 'mi vagy', 'mi ez a chatbot'])) {
    return result(
      'chatbot-identity',
      'chatbot-identity',
      'A Vitalis webshop vásárlóit segítő AI-alapú asszisztens vagyok. A Vitalis jóváhagyott terméktudására, webshopadataira és beszélgetési szabályaira támaszkodom.'
    );
  }

  if (/^ki (csinalta|keszitette|fejlesztette)( ezt)?\??$/.test(q)) {
    return result(
      'meta-clarification',
      'meta-clarification',
      'Arra gondolsz, hogy ki készíti a Vitalis termékeket, vagy arra, hogyan készült a chatbot? Szívesen pontosítok.'
    );
  }

  return null;
}

module.exports = { resolveMetaIntent };
