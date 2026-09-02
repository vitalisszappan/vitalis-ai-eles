'use strict';

const {
  searchKnowledge
} = require(
  './knowledge-fallback.cjs'
);

const {
  normalize
} = require(
  './normalizer.cjs'
);

const {
  buildConversationContext,
  detectProblem,
  looksLikeEmail,
  isFollowUpMessage,
  resolveProductReference
} = require(
  './conversation-context.cjs'
);

const {
  PRODUCTS,
  productCards,
  validProductUrl
} = require('./product-catalog.cjs');

const {
  findProductInText
} = require('./product-faq.cjs');

const {
  resolveMetaIntent
} = require('./meta-intents.cjs');

const { routeAnswer } = require('./answer-router.cjs');
const { createCatalogSearch } = require('./catalog-search.cjs');
const { childAnswer } = require('./product-faq.cjs');
const { composeCommunication } = require('./communication-engine.cjs');
const {classifyFallback,gapDisposition}=require('./fallback-classifier.cjs');
const {matchesProductType}=require('./product-type-constraint.cjs');
const {comparisonAnswer,recommendation:hairRecommendation,availability:hairAvailability}=require('./hair-wash-products.cjs');
const { planAnswer } = require('./answer-planner.cjs');
const { buildSemanticEvidence } = require('./semantic-evidence.cjs');
const { validateSemanticRoute } = require('./semantic-route-guard.cjs');
const { applySemanticGuardEnforcement } = require('./semantic-guard-enforcement.cjs');
const { resolveComplaint, resolveResolvedComplaint } = require('./complaint-resolution.cjs');
const { detectResolvedComplaintTransition } = require('./complaint-intents.cjs');
const { structuredState } = require('./conversation-memory.cjs');
const { resolveBusinessInfo } = require('./business-info.cjs');
const { createCommerceAssistance } = require('./commerce-assistance.cjs');
const { validateStructuredOutput } = require('./structured-output-safety.cjs');
const { CONCERNS } = require('./product-intelligence-schema.cjs');
const { buildRecommendationIntentContract } = require('./product-intelligence-recommendation-intent-contract.cjs');

const decisionCatalog = createCatalogSearch();
const commerceAssistance = createCommerceAssistance({ catalog: decisionCatalog });

function attachDecision(answer, routing) {
  return {
    ...answer,
    route: routing.route,
    goal: routing.goal,
    domain: routing.domain,
    safetyClass: routing.safetyClass,
    contextUsed: routing.contextUsed,
    contextTarget: routing.contextTarget,
    responseSource: routing.responseSource,
    answerMode: routing.answerMode,
    routing
  };
}

function catalogCard(item, index = 0) {
  return {
    id: item.id,
    name: item.name,
    title: item.name,
    label: item.name,
    description: '',
    url: item.url,
    image: item.image,
    price: item.price,
    currency: item.currency,
    rank: index + 1,
    recommendationType: index === 0 ? 'primary' : 'secondary'
  };
}

function formatWholeForint(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function shortProductName(value) {
  const text = cleanText(value);
  const withoutSizeTail = text.replace(/\s+\d+\s*(?:ml|g)\b.*$/i, '').trim();
  const parts = withoutSizeTail.split(/\s+[–—]\s+/).map((part) => part.trim()).filter(Boolean);
  if (/^(természetes )?tusfürdő$/i.test(parts[0]) && parts[1]) return `${parts[0]} – ${parts[1]}`;
  const conciseProduct = /^(.*?\b(?:szappan|sampon|krém|balzsam|tusfürdő))\b/i.exec(parts[0] || withoutSizeTail);
  return conciseProduct?.[1] || parts[0] || withoutSizeTail;
}

function productAttributeAnswer(target, intent, question) {
  const product = PRODUCTS[target];
  if (!product) return null;
  const normalizedQuestion = normalize(question);
  if (intent === 'scent') {
    if (/levendula/.test(normalize(`${product.name} ${product.description}`))) return 'Ennek a szappannak levendulaillata van.';
    return 'Az illatáról nem tudok biztosat mondani.';
  }
  if (/arcra/.test(normalizedQuestion)) return 'Nem tudom biztosan, hogy arcra használható-e.';
  if (/szappan vagy sampon/.test(normalizedQuestion)) return /solid_shampoo/.test(product.productType || '') ? 'Ez szilárd sampon, nem samponszappan.' : /shampoo_soap/.test(product.productType || '') ? 'Ez samponszappan, vagyis szappanalapú hajtisztító.' : `Ez ${product.name}.`;
  return null;
}

function recommendationName(value) {
  const name = shortProductName(value);
  if (/szappan$/i.test(name)) return name.replace(/szappan$/i, 'szappant');
  if (/sampon$/i.test(name)) return name.replace(/sampon$/i, 'sampont');
  if (/krém$/i.test(name)) return name.replace(/krém$/i, 'krémet');
  if (/balzsam$/i.test(name)) return name.replace(/balzsam$/i, 'balzsamot');
  return `${name} terméket`;
}

function lowerInitial(value) {
  const text = cleanText(value);
  return text ? `${text[0].toLocaleLowerCase('hu-HU')}${text.slice(1)}` : text;
}

function plannedMetadata(plan) {
  return { answerIntent: plan.answerIntent, targetProductId: plan.targetProductId, factsUsed: plan.factsUsed, groundingStatus: plan.groundingStatus, responseStrategy: plan.responseStrategy, ctaStrategy: plan.ctaStrategy };
}

function materializePlannedAnswer(plan, routing) {
  if (!plan || plan.responseStrategy === 'existing_commerce') return null;
  const metadata = plannedMetadata(plan);
  const productIds = plan.targetProductId ? [plan.targetProductId, ...(plan.relatedProductIds || [])] : [];
  const links = productCards([...new Set(productIds)]);
  const base = { source: 'answer-planner', confidence: 100, links, suggestions: [], ruleId: null, intent: routing?.intent || plan.answerIntent, matchedKnowledgeIds: [], ...metadata };
  if (plan.responseStrategy === 'clarify_comparison') return { ...base, answer: 'Melyik két terméket hasonlítsam össze?', links: [] };
  if (plan.answerIntent === 'comparison') {
    const ids = plan.comparisonProductIds || productIds;
    const cards = productCards(ids);
    const facts = Object.fromEntries((plan.factsUsed || []).map((fact) => [fact.productId, fact]));
    const name = (id) => cards.find((card) => card.id === id)?.name || PRODUCTS[id]?.name || id;
    const fact = (id) => facts[id];
    let answer;
    const missingComparisonFallback = () => {
      const missingIds = ids.filter((id) => fact(id)?.status !== 'grounded');
      if (missingIds.length === 0) return null;
      if (missingIds.length === 1) {
        return `${name(missingIds[0])} esetében jelenleg nincs elég biztos információm ahhoz, hogy a két terméket megbízhatóan összehasonlítsam.`;
      }
      return 'Erről a két termékről jelenleg nincs elég biztos információm ahhoz, hogy megbízhatóan összehasonlítsam őket.';
    };
    if (plan.comparisonFactType === 'price') {
      const a = fact(ids[0]), b = fact(ids[1]);
      if (a?.status === 'grounded' && b?.status === 'grounded') {
        const relation = a.value === b.value ? 'azonos árú' : a.value < b.value ? `${name(ids[0])} az olcsóbb` : `${name(ids[1])} az olcsóbb`;
        answer = `${name(ids[0])}: ${formatWholeForint(a.value)} Ft; ${name(ids[1])}: ${formatWholeForint(b.value)} Ft. ${relation}.`;
      } else {
        const groundedIds = ids.filter((id) => fact(id)?.status === 'grounded');
        if (groundedIds.length === 1) {
          const groundedId = groundedIds[0];
          const missingId = ids.find((id) => id !== groundedId);
          answer = `${name(groundedId)} árát tudom megerősíteni. ${name(missingId)} esetében jelenleg nincs elég biztos információm ahhoz, hogy a két terméket megbízhatóan összehasonlítsam.`;
        } else {
          answer = missingComparisonFallback() || 'A két termék árát nem tudom teljes körűen összehasonlítani.';
        }
      }
    } else if (plan.comparisonFactType === 'ingredients') {
      const available = ids.filter((id) => fact(id)?.status === 'grounded');
      if (available.length === 2) {
        answer = `${name(ids[0])} összetevői: ${fact(ids[0]).value.map((item) => item.rawName).join(', ')}. ${name(ids[1])} összetevői: ${fact(ids[1]).value.map((item) => item.rawName).join(', ')}.`;
      } else if (available.length === 1) {
        const groundedId = available[0];
        const missingId = ids.find((id) => id !== groundedId);
        answer = `${name(groundedId)} összetevői: ${fact(groundedId).value.map((item) => item.rawName).join(', ')}. ${name(missingId)} esetében jelenleg nincs elég biztos információm ahhoz, hogy a két terméket megbízhatóan összehasonlítsam.`;
      } else {
        answer = missingComparisonFallback() || 'Erről a két termékről jelenleg nincs elég biztos információm ahhoz, hogy érdemi különbséget mondjak.';
      }
    } else if (plan.comparisonFactType === 'usageInstructions') {
      const groundedIds = ids.filter((id) => fact(id)?.status === 'grounded');
      if (groundedIds.length === 2) {
        answer = `${name(ids[0])} használata: ${fact(ids[0]).value} ${name(ids[1])} használata: ${fact(ids[1]).value}`;
      } else if (groundedIds.length === 1) {
        const groundedId = groundedIds[0];
        const missingId = ids.find((id) => id !== groundedId);
        answer = `${name(groundedId)} használata: ${fact(groundedId).value}. ${name(missingId)} esetében jelenleg nincs elég biztos információm ahhoz, hogy a két terméket megbízhatóan összehasonlítsam.`;
      } else {
        answer = missingComparisonFallback() || 'Erről a két termékről jelenleg nincs elég biztos információm ahhoz, hogy érdemi különbséget mondjak.';
      }
    } else {
      const description = (id) => (fact(id)?.status === 'grounded' ? fact(id).value?.[0]?.claim : null)?.replace(/[.]+$/, '');
      const bothMissing = ids.every((id) => fact(id)?.status !== 'grounded');
      const groundedIds = ids.filter((id) => fact(id)?.status === 'grounded');
      if (bothMissing) {
        answer = 'Erről a két termékről jelenleg nincs elég biztos információm ahhoz, hogy megbízhatóan összehasonlítsam őket.';
      } else if (groundedIds.length === 1) {
        const groundedId = groundedIds[0];
        const missingId = ids.find((id) => id !== groundedId);
        answer = `${name(groundedId)}: ${description(groundedId)}. ${name(missingId)} esetében jelenleg nincs elég biztos információm ahhoz, hogy a két terméket megbízhatóan összehasonlítsam.`;
      } else {
        answer = `${name(ids[0])}: ${description(ids[0])}. ${name(ids[1])}: ${description(ids[1])}.`;
      }
      if (plan.comparisonRequiresChoice) answer += ' Az, hogy melyik jobb választás, attól függ, milyen igényre keresed.';
    }
    return { ...base, answer, links: cards };
  }
  if (plan.responseStrategy === 'clarify_product') return { ...base, answer: 'Melyik termékre gondolsz?', links: [] };
  const byType = Object.fromEntries(plan.factsUsed.map((fact) => [fact.factType, fact]));
  const firstClaim = (fact) => fact?.status === 'grounded' && Array.isArray(fact.value) ? fact.value[0]?.claim : null;
  if (plan.answerIntent === 'product_recommendation') {
    const claim = firstClaim(byType.productBenefits);
    if (plan.responseStrategy === 'expert_relationship') {
      const names = links.map((link, index) => index === 0 ? recommendationName(link.name) : lowerInitial(recommendationName(link.name)));
      const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} és a ${names.at(-1)}` : names[0] || 'kapcsolódó terméket';
      return { ...base, answer: `Az ${listed} tudom kapcsolódó termékként megmutatni. Részletes, termékspecifikus előnyről most nincs elég bizonyított adatom.`, links: links.map((link) => ({ ...link, reason: 'Kapcsolódó termék az ajánláshoz.', reasonSource: 'expert_relationship' })) };
    }
    if (plan.groundingStatus !== 'grounded' || !claim) return { ...base, answer: 'Ehhez még pontosítanod kell, milyen bőrproblémára keresel terméket.', links: [] };
    return { ...base, answer: `Ezt ajánlom: ${links[0]?.name || 'a kiválasztott termék'}. ${claim}`, links: links.map((link, index) => index === 0 ? { ...link, reason: claim, reasonSource: 'grounded_product_fact' } : { ...link, reason: 'Kapcsolódó termék az ajánláshoz.', reasonSource: 'expert_relationship' }) };
  }
  if (plan.answerIntent === 'product_benefits') {
    const claim = firstClaim(byType.productBenefits);
    return { ...base, answer: claim || 'Ehhez a termékhez nincs jóváhagyott, termékspecifikus előnyállításunk.' };
  }
  if (plan.answerIntent === 'ingredients') {
    const ingredients = byType.ingredients;
    const existence = byType.ingredientExistence;
    if (existence) {
      const label = plan.requestedIngredientId === 'urea' ? 'urea' : plan.requestedIngredientId;
      if (existence.status !== 'grounded') return { ...base, answer: 'Erről az összetevőről nincs elég bizonyított termékadatunk.' };
      const article = /^[aeiou]/i.test(label || '') ? 'az' : 'a';
      return { ...base, answer: existence.value ? `Igen, az összetevők között szerepel ${article} ${label}.` : `A jelenlegi bizonyított összetevőlistában nem szerepel ${label}.` };
    }
    if (ingredients?.status !== 'grounded') return { ...base, answer: 'Ehhez a termékhez nincs elérhető, bizonyított összetevőlistánk.' };
    return { ...base, answer: `Az összetevői: ${ingredients.value.map((item) => item.rawName).join(', ').replace(/[.]+$/, '')}.` };
  }
  if (plan.answerIntent === 'ingredient_benefit') {
    const existence = byType.ingredientExistence;
    const benefits = byType.ingredientBenefits;
    const label = plan.requestedIngredientId === 'urea' ? 'urea' : plan.requestedIngredientId || 'összetevő';
    if (existence?.status === 'grounded' && existence.value === false) return { ...base, answer: `A jelenlegi bizonyított összetevőlistában nem szerepel ${label}.` };
    const claim = benefits?.status === 'grounded' ? benefits.value.find((item) => item.ingredientId === plan.requestedIngredientId) : null;
    if (existence?.status === 'grounded' && existence.value === true && claim) return { ...base, answer: claim.benefit };
    if (existence?.status === 'grounded' && existence.value === true) return { ...base, answer: `Az összetevők között szerepel az ${label}, de a jelenlegi jóváhagyott termékadatainkban nincs külön bizonyított leírás arról, hogy ebben a termékben milyen szerepet tölt be.` };
    return { ...base, answer: 'Ehhez az összetevőhöz nincs elég bizonyított termékadatunk.' };
  }
  if (plan.answerIntent === 'usage') {
    const usage = byType.usageInstructions;
    return { ...base, answer: usage?.status === 'grounded' ? usage.value : 'Ehhez a termékhez nincs elérhető, bizonyított használati útmutatónk.' };
  }
  if (plan.answerIntent === 'price_query') {
    const price = byType.price, currency = byType.currency;
    if (price?.status !== 'grounded' || currency?.status !== 'grounded') return { ...base, answer: 'Ehhez a termékhez nincs elérhető, bizonyított aktuális árunk.' };
    const unit = currency.value === 'HUF' ? 'Ft' : currency.value;
    const productName = PRODUCTS[plan.targetProductId]?.name || links[0]?.name || null;
    return { ...base, answer: `A ${productName || 'termék'} jelenlegi ára ${formatWholeForint(price.value)} ${unit}.` };
  }
  return { ...base, answer: 'Ehhez nincs elég bizonyított termékadatunk.' };
}

function materializeDecision({ routing, question, history, knowledge, ruleEngine, logGap, conversationState, technicalFailure, logDiagnostic, answerPlan = null }) {
  if (routing.route === 'business_info') return attachDecision(resolveBusinessInfo(routing.intent, decisionCatalog), routing);
  if (routing.responseSource === 'acne-decision') {
    const selected = routing.acneDecision?.selectedProductId || null;
    const factType = routing.acneDecision?.kind === 'usage' ? 'usageInstructions' : 'productBenefits';
    const factsApi = require('./product-facts.cjs');
    const fact = selected ? factsApi.getFact(selected, factType) : null;
    const evidence = fact?.provenance || [];
    if (!selected) return attachDecision({
      source: 'owner-approved-acne-decision',
      answer: 'Mennyire zsíros a bőröd, inkább néha vagy rendszeresen jelentkeznek a pattanások, és az arcodon, a fejbőrödön vagy a hátad, vállad területén érintett?',
      confidence: 100, links: [], suggestions: [], ruleId: 'acne-decision-clarification', intent: 'acne', matchedKnowledgeIds: [],
      answerIntent: 'product_recommendation', targetProductId: null, factsUsed: [], groundingStatus: 'ambiguous', responseStrategy: 'targeted_clarification', ctaStrategy: 'clarify_need'
    }, routing);
    const rawCard = productCards([selected])[0] || null;
    const card = rawCard && selected === 'aktiv_szenes_szappan'
      ? { ...rawCard, url: '', commerce: undefined, price: undefined, priceGross: undefined, actualPriceGross: undefined, currency: undefined, availability: undefined }
      : rawCard;
    let answer;
    if (routing.acneDecision.kind === 'usage') answer = 'Igen, a Kátrány szappan hajmosásra is használható.';
    else if (routing.acneDecision.reasonCode === 'scalp_acne') answer = 'A Kátrány szappant ajánlom. Hajmosásra is használható, és fejbőrön jelentkező pattanásoknál ajánlott.';
    else if (selected === 'aktiv_szenes_szappan') answer = 'Az Aktív szenes szappant ajánlom. Kombinált, enyhén zsíros és mitesszeres bőrre ajánljuk.';
    else answer = 'A Kátrány szappant ajánlom. Zsíros, problémás, pattanásos és aknés bőrre ajánljuk.';
    const usedFacts = routing.acneDecision.reasonCode === 'scalp_acne'
      ? ['usageInstructions', 'recommendedFor'].map((type) => { const item = factsApi.getFact(selected, type); return { factType: type, status: item.status, value: item.status === 'grounded' ? item.value : null, provenance: item.provenance || [] }; })
      : [{ factType, status: fact?.status || 'unavailable', value: fact?.status === 'grounded' ? fact.value : null, provenance: evidence }];
    const isGrounded = usedFacts.every((item) => item.status === 'grounded');
    const draft = attachDecision({
      source: 'owner-approved-acne-decision', answer, confidence: 100, links: card ? [card] : [], suggestions: [], ruleId: routing.matchedRuleId, intent: routing.intent, matchedKnowledgeIds: [],
      answerIntent: routing.acneDecision.kind === 'usage' ? 'usage' : 'product_recommendation', targetProductId: selected,
      factsUsed: usedFacts,
      groundingStatus: isGrounded ? 'grounded' : 'unavailable', responseStrategy: 'owner_approved_acne_decision', ctaStrategy: selected === 'aktiv_szenes_szappan' ? 'none' : 'view_product'
    }, routing);
    if (routing.acneDecision?.kind === 'resolved') {
      const intentContract = buildRecommendationIntentContract({
        route: routing.route,
        intent: routing.intent,
        plannerAnswerIntent: draft.answerIntent,
        productId: selected,
        concernContext: routing.acneDecision?.concernContext || routing.concernContext || null,
        applicationArea: routing.acneDecision?.applicationArea || routing.applicationArea || null,
        recommendationRole: routing.acneDecision?.recommendationRole || routing.recommendationRole || null,
        groundingStatus: isGrounded ? 'grounded' : 'unavailable'
      });
      Object.defineProperty(draft, 'recommendationIntent', {
        value: intentContract,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }
    return draft;
  }
  const planned = materializePlannedAnswer(answerPlan, routing);
  if (planned) return attachDecision(planned, routing);
  if (routing.responseSource === 'meta-intent') return attachDecision(resolveMetaIntent(question), routing);
  if(routing.route==='hair_type_knowledge')return attachDecision(comparisonAnswer(),routing);
  if(routing.route==='hair_product_type')return attachDecision(routing.intent==='product_type_availability'?hairAvailability(question,routing.productTypeConstraint):hairRecommendation(question,routing.productTypeConstraint),routing);
  if (routing.matchedRuleId === 'sls-sles-free') return attachDecision(answerSlsSlesQuestion(question), routing);

  if (routing.route === 'safety') {
    const urgent = routing.safetyClass === 'medical_escalation';
    const vascular = routing.domain === 'varicose_cosmetic';
    const answer = urgent
      ? 'Ezt a tünetet nem biztonságos kozmetikai kérdésként kezelni. Kérj mielőbb orvosi segítséget; hirtelen rosszabbodás, nehézlégzés, mellkasi fájdalom vagy erős fájdalom esetén sürgős ellátás szükséges.'
      : vascular
        ? 'Visszeres, fáradt láb bőrének kozmetikai ápolására található Vitalis balzsam, de visszérgyulladást, ödémát vagy keringési betegséget kozmetikum nem kezel. Fájdalom, melegség, pirosság vagy egyoldali duzzanat esetén kérj orvosi tanácsot.'
        : 'Ödéma, gyulladás vagy keringési panasz okát nem lehet kozmetikai tanácsadással megállapítani. Ilyen tünetnél kérj orvosi tanácsot; kozmetikum legfeljebb az ép bőr komfortápolására használható.';
    return attachDecision({ source: 'safety-gate', answer, confidence: 100, links: [], suggestions: [], ruleId: null, intent: routing.intent, matchedKnowledgeIds: [] }, routing);
  }

  if (routing.route === 'commerce') {
    if (routing.responseSource === 'admin-intent') return attachDecision(ruleEngine.resolve(question, history), routing);
    const assisted = commerceAssistance.resolve({ routing, question, conversationState });
    if (assisted) return attachDecision({ ...assisted, ruleId: routing.matchedRuleId, matchedKnowledgeIds: [], ...(answerPlan ? plannedMetadata(answerPlan) : {}) }, routing);
    const target = routing.contextTarget;
    const cards = target ? productCards([target]) : [];
    const byIntent = {
      order_start: target ? 'Rendben. A termékkártyán tudod kosárba tenni.' : 'Melyik terméket szeretnéd?',
      purchase_location: 'A Vitalis termékeket a vitalis-szappan.hu webshopban tudod megvásárolni.',
      price_query: cards[0]?.price != null ? `A ${PRODUCTS[target]?.name || cards[0].name} jelenlegi ára ${formatWholeForint(cards[0].price)} Ft.` : 'A pontos aktuális árat a termékoldalon látod.',
      availability_query: cards[0]?.availability?.orderable === false ? 'Ez a termék a jelenlegi katalógusadat szerint nem rendelhető.' : 'A termék aktuális rendelhetőségét a termékoldalon tudod ellenőrizni.',
      shipping_general: 'A rendelés szállítási módjait és aktuális díját a pénztárban tudod kiválasztani és ellenőrizni.',
      shipping_cost: 'A szállítás díja a választott szállítási és fizetési módtól függ; az aktuális összeget a pénztár mutatja.',
      shipping_time: 'A kiszállítás általában körülbelül 2 munkanap, a pontos idő a választott szállítási módtól függ.',
      payment: 'Az elérhető fizetési módokat a pénztárban tudod kiválasztani.',
      order_status: 'A rendelés állapotáról a rendelési visszaigazolás és az ügyfélszolgálat tud pontos tájékoztatást adni.'
    };
    return attachDecision({ source: 'commerce-intent', answer: byIntent[routing.intent] || 'Miben segíthetek a rendeléssel kapcsolatban?', confidence: 100, links: cards, suggestions: [], ruleId: routing.matchedRuleId, intent: routing.intent, matchedKnowledgeIds: [], ...(answerPlan ? plannedMetadata(answerPlan) : {}) }, routing);
  }

  if (routing.route === 'clarification') {
    const contextMissing=routing.rejectionReasons?.some(reason=>['missing_product_context','ambiguous_product_reference'].includes(reason));
    if (contextMissing) {
      try {
        logDiagnostic?.({ type: 'context_diagnostic', rootCause: 'context_missing' });
      } catch {}
    }
    if (routing.matchedCanonicalIds?.length) {
      return attachDecision({ ...clarificationAnswer(buildConversationContext(history, normalize), routing.matchedCanonicalIds), ...(contextMissing?{fallbackRootCause:'context_missing'}:{}) }, routing);
    }
    const guidedNeed = routing.guidedDiscovery?.needState?.value;
    const guidedType = routing.guidedDiscovery?.productType?.value;
    const guidedAnswer = routing.contextTarget === 'guided_discovery'
      ? guidedNeed === 'sensitive_skin' && !guidedType ? 'Érzékeny bőrre szappant vagy krémet/balzsamot keresel?'
      : guidedNeed === 'dry_hands' && !guidedType ? 'Kézkrémet vagy szappant keresel?'
      : guidedNeed === 'wrinkles_or_mature_skin' && !guidedType ? 'Krémet vagy balzsamot keresel?'
      : !guidedNeed && guidedType ? `Milyen bőrigényre keresel ${guidedType === 'krem' ? 'krémet' : guidedType === 'szappan' ? 'szappant' : guidedType === 'balzsam' ? 'balzsamot' : 'sampont'}?`
      : guidedNeed === 'dry_hands' ? 'Megmutathatom a választott terméktípus kínálatát, de száraz kézre való alkalmasságot most nem tudok biztosan állítani.'
      : guidedNeed === 'wrinkles_or_mature_skin' ? 'Megmutathatom a krémek és balzsamok kínálatát, de ránccsökkentő hatást most nem tudok biztosan állítani.'
      : 'Megmutathatom a választott kategória kínálatát, de ehhez a bőrigényhez most nem tudok biztos termékalkalmasságot állítani.'
      : null;
    const answer = guidedAnswer || (routing.contextTarget === 'excluded_product_type'
      ? 'Milyen terméktípust keresel a sampon helyett?'
      : routing.contextTarget === 'semantic_product_match'
      ? 'Nem találtam biztos termékegyezést. Meg tudod írni pontosabban, mit keresel?'
      : routing.contextTarget === 'product'
      ? (routing.intent === 'product_recommendation' ? 'Milyen problémára vagy milyen terméktípusból keresel ajánlást?' : 'Melyik termékre gondolsz?')
      : 'Mire gondolsz pontosan?');
    return attachDecision({ source: routing.responseSource, answer, confidence: 100, links: [], suggestions: [], ruleId: 'clarify-missing-argument', intent: routing.contextTarget === 'guided_discovery' ? 'conversation-clarification' : routing.intent, matchedKnowledgeIds: [], ...(contextMissing ? { fallbackRootCause: 'context_missing' } : {}) }, routing);
  }

  if (routing.route === 'context_followup') {
    const target = routing.contextTarget;
    if (routing.goal === 'clarify_previous_answer') {
      const previous = [...history].reverse().find((item) => item?.role === 'assistant')?.content || '';
      return attachDecision({ source: 'conversation-context', answer: previous ? `Az előző válasz lényege röviden: ${shorten(previous, 260)}` : 'Írd meg, melyik rész nem volt világos, és másképp megfogalmazom.', confidence: 100, links: target && PRODUCTS[target] ? productCards([target]) : [], suggestions: [], ruleId: 'clarify-previous-answer', intent: routing.intent, matchedKnowledgeIds: [] }, routing);
    }
    if (routing.goal === 'ask_child_usage') {
      const answer = childAnswer(target);
      if (answer) return attachDecision({ source: 'product-faq', answer, confidence: 100, links: productCards([target]), suggestions: [], ruleId: `child_${target}`, intent: 'child_usage', matchedKnowledgeIds: [] }, routing);
    }
    if (routing.goal === 'ask_usage') {
      const explicitQuestion = PRODUCTS[target] ? `Hogyan használjam a ${PRODUCTS[target].name} terméket?` : question;
      const expert = ruleEngine.resolve(explicitQuestion, []);
      if (expert?.intent === 'product_usage') return attachDecision(expert, routing);
      if (target === 'psorivital_csomag') return attachDecision({ source: 'product-faq', answer: 'A PsoriVital csomag balzsamját az érintett, megtisztított bőrfelületen használd rendszeresen. A csomag szappanjait nedves bőrön habosítsd fel, majd alaposan öblítsd le.', confidence: 100, links: productCards([target]), suggestions: [], ruleId: 'usage_psorivital_csomag', intent: 'product_usage', matchedKnowledgeIds: [] }, routing);
    }
    if (routing.goal === 'ask_variant') {
      const card = productCards([target])[0];
      const size = /\b(\d+\s*(?:ml|g))\b/i.exec(card?.name || '')?.[1] || null;
      const asksSize = /kiszereles|mekkora/.test(normalize(question));
      const asksScent = /illat/.test(normalize(question));
      const answer = asksSize && size ? `A kiszerelése ${size.replace(/\s+/g, ' ')}.` : asksScent ? 'Más illatról most nem tudok biztosat mondani.' : 'Másik változatról most nem tudok biztosat mondani.';
      return attachDecision({ source: 'conversation-context', answer, confidence: 100, links: card ? [card] : [], suggestions: [], ruleId: 'variant-query', intent: 'variant_query', matchedKnowledgeIds: [] }, routing);
    }
    if (routing.goal === 'ask_product_information') {
      const attributeAnswer = productAttributeAnswer(target, routing.intent, question);
      if (attributeAnswer) return attachDecision({ source: 'product-context', answer: attributeAnswer, confidence: 100, links: productCards([target]), suggestions: [], ruleId: `product_attribute_${target}`, intent: routing.intent, matchedKnowledgeIds: [] }, routing);
      return attachDecision({ ...buildProductReferenceAnswer(target, knowledge), intent: 'product_information' }, routing);
    }
    if(!PRODUCTS[target]){const item=decisionCatalog.all().find(product=>product.id===String(target));if(item)return attachDecision({source:'unas-catalog',answer:`A megjelen\u00edtett lista kiv\u00e1lasztott eleme: ${item.name}.`,confidence:100,links:[catalogCard(item)],suggestions:[],ruleId:'catalog-ordinal-reference',intent:'select_recommendation',matchedKnowledgeIds:[]},routing);}
    return attachDecision(buildProductReferenceAnswer(target, knowledge), routing);
  }

  if (routing.route === 'expert_rule') {const expert=ruleEngine.resolve(question, history);if(expert&&routing.productTypeConstraint){const constrained=(expert.links||[]).filter(item=>matchesProductType(item,routing.productTypeConstraint)||(routing.productTypeConstraint==='szappan'&&item.id==='tengeri_soszappan'));if(constrained.length)return attachDecision({...expert,links:constrained,answer:`A k\u00e9rt ${routing.productTypeConstraint} kateg\u00f3ri\u00e1ban els\u0151k\u00e9nt a ${constrained[0].name} term\u00e9ket javaslom.`},routing);}return attachDecision(expert,routing);}

  if (routing.route === 'exact_product') {
    const canonical = routing.matchedCanonicalIds[0];
    if (canonical) return attachDecision(buildProductReferenceAnswer(canonical, knowledge), routing);
    const item = decisionCatalog.all().find((product) => product.id === routing.matchedProductIds[0]);
    return attachDecision({ source: 'unas-catalog', answer: item ? `Igen, van ${lowerInitial(shortProductName(item.name))}.` : 'Igen, van ilyen termékünk.', confidence: 100, links: item ? [catalogCard(item)] : [], suggestions: [], ruleId: null, intent: 'product_detail', matchedKnowledgeIds: [] }, routing);
  }

  if (routing.route === 'product_category') {
    const found = decisionCatalog.searchCategory(routing.domain);
    const constrained=routing.productTypeConstraint?found.products.filter(item=>matchesProductType(item,routing.productTypeConstraint)):found.products;
    let products=routing.productTypeConstraint?constrained:found.products;
    const q = normalize(question);
    if (/normal\w* bor/.test(q)) products = products.filter((item) => /normal\w* bor/.test(normalize(item.name)));
    if (/erzekeny\w* bor/.test(q)) products = products.filter((item) => /erzekeny\w*.*bor|bor\w*.*erzekeny/.test(normalize(item.name)));
    if (!products.length) return attachDecision({ source: 'catalog-absent', answer: `A jelenlegi kínálatban nem találok ${found.category?.label || 'ilyen terméket'}.`, confidence: 100, links: [], suggestions: [], ruleId: null, intent: 'catalog_category_absent', matchedKnowledgeIds: [] }, routing);
    const names = products.slice(0, 3).map((item) => shortProductName(item.name)).join(', ');
    const distinction = routing.domain === 'deodorant' ? ' Ezek dezodorok: a testszag kialakulását segítenek megelőzni, de nem állítjuk róluk, hogy az izzadást megszüntetik.' : '';
    const recommendation = routing.productQuestionIntent === 'recommendation';
    const preferred = /erzekeny\w* bor/.test(q) ? products.find((item) => /natur kecsketejes/.test(normalize(item.name))) : products[0];
    const recommendationReason = /erzekeny\w* bor/.test(q) ? 'Illatmentes, érzékeny és száraz bőrre készült.' : /normal\w* bor/.test(q) ? 'A leírása szerint normál bőrre készült.' : 'A leírása szerint megfelel annak, amit keresel.';
    const genericCreamDiscovery = recommendation && routing.domain === 'cream' && !/\b(?:borre|arcra|kezre|testre|szaraz|erzekeny|irritalt|ekcem|pattanas|problem)\w*\b/.test(q);
    const answer = genericCreamDiscovery ? 'Milyen bőrigényre keresel krémet?'
      : recommendation
      ? (preferred ? `A ${recommendationName(preferred.name)} ajánlom. ${recommendationReason}` : `Ezek felelnek meg a leírtaknak: ${names}.`)
      : /tusfurdo/.test(q) ? 'Igen. Mentás-citromos, rózsás és levendulás tusfürdőnk van.' : `Igen, van ${found.category.label}. Ezek közül választhatsz: ${names}.${distinction}`;
    const discoveryLinks = genericCreamDiscovery && !(routing.excludedProductTypes || []).length ? [] : products.slice(0, 3).map(catalogCard);
    return attachDecision({ source: 'unas-catalog', answer, confidence: 100, links: discoveryLinks, suggestions: [], ruleId: null, intent: genericCreamDiscovery ? 'conversation-clarification' : recommendation ? 'product_recommendation' : 'catalog_category_found', matchedKnowledgeIds: [] }, routing);
  }

  if (routing.route === 'problem_domain') {
    const legacyDomain = { itchy_scalp: 'scalp', psoriasis: 'psoriasis', eczema: 'eczema', acne: 'acne', dry_skin: 'dry_skin', rosacea: 'rosacea', couperose: 'couperose' }[routing.domain];
    if (legacyDomain) return attachDecision(attachProductLinks(buildProblemAnswer(legacyDomain), knowledge), routing);
    if (['cracked_heel', 'dry_heel'].includes(routing.domain)) {
      const found = decisionCatalog.searchCategory('heel_care');
      return attachDecision({ source: 'problem-domain', answer: 'Repedt vagy nagyon száraz sarok kozmetikai ápolására kímélő tisztítást és rendszeres, zsírosabb hidratáló ápolást javaslok. Nyílt, vérző vagy gyulladt repedésnél ne használj irritáló kozmetikumot, és kérj szakembertől tanácsot.', confidence: 100, links: found.products.slice(0, 3).map(catalogCard), suggestions: [], ruleId: 'problem-cracked-heel', intent: 'problem_recommendation', matchedKnowledgeIds: [] }, routing);
    }
  }

  if (routing.route === 'knowledge') {
    const matches = searchKnowledge(knowledge, question);
    const selected = matches.find((item) => item.item.id === routing.matchedKnowledgeIds[0]);
    if (selected) return attachDecision(buildSingleAnswer(selected.item, Math.round(routing.confidence * 100)), routing);
  }

  const fallbackRootCause=classifyFallback({routing,candidateCount:routing.candidateCount,question,state:conversationState,technicalFailure});const disposition=gapDisposition(fallbackRootCause);
  if(disposition==='knowledge_gap')logGap(question,Math.round(routing.confidence*100),history,{fallbackRootCause,routing});else try{logDiagnostic?.({type:disposition,rootCause:fallbackRootCause});}catch{}
  return attachDecision({ source: 'hard-fallback', fallbackRootCause, answer: 'Ehhez nem találtam elég pontos, jóváhagyott Vitalis-információt. Írd meg kérlek részletesebben, melyik termékről vagy témáról van szó.', confidence: Math.round(routing.confidence * 100), links: [], suggestions: [], ruleId: null, intent: routing.intent, matchedKnowledgeIds: [] }, routing);
}

/* =========================================================
   SEGÉDFÜGGVÉNYEK
========================================================= */

function cleanText(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(
  value,
  maxLength = 240
) {
  const text =
    cleanText(value);

  if (
    text.length <=
    maxLength
  ) {
    return text;
  }

  const cut =
    text.slice(
      0,
      maxLength
    );

  const lastSentence =
    Math.max(
      cut.lastIndexOf('.'),
      cut.lastIndexOf('!'),
      cut.lastIndexOf('?')
    );

  if (
    lastSentence >
    80
  ) {
    return cut
      .slice(
        0,
        lastSentence + 1
      )
      .trim();
  }

  return (
    cut
      .replace(
        /\s+\S*$/,
        ''
      )
      .trim() +
    '…'
  );
}

function getItemAnswer(
  item
) {
  return cleanText(
    item.shortAnswer ||
    item.fullAnswer ||
    item.answer ||
    ''
  );
}

function getItemTitle(
  item
) {
  return cleanText(
    item.title ||
    item.name ||
    item.products?.[0] ||
    'Termék'
  );
}

function isProductItem(
  item
) {
  return (
    item &&
    item.source === 'unas' &&
    (
      item.sourceType === 'product' ||
      item.type === 'product' ||
      item.category === 'UNAS termék'
    )
  );
}

/* =========================================================
   TECHNIKAI ZAJ ELTÁVOLÍTÁSA
========================================================= */

function removeTechnicalNoise(
  value
) {
  let text =
    cleanText(
      value
    );

  const cutMarkers = [
    'Összetevők (INCI):',
    'Összetevők:',
    'INCI:',
    'Ingredients:',
    'Mit tapasztalhatsz rendszeres használat mellett?',
    'Használati javaslat'
  ];

  for (
    const marker of
    cutMarkers
  ) {
    const index =
      text.indexOf(
        marker
      );

    if (
      index >
      50
    ) {
      text =
        text.slice(
          0,
          index
        );
    }
  }

  return text
    .replace(
      /\bÁr:\s*[^.]{0,160}\.?/gi,
      ''
    )
    .replace(
      /\bKiszerelés vagy egység:\s*[^.]{0,160}\.?/gi,
      ''
    )
    .replace(
      /\bnormal\b/gi,
      ''
    )
    .replace(
      /\b\d{3,6}\s+\d{3,6}\s*Ft\b/gi,
      ''
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

/* =========================================================
   SLS / SLES
========================================================= */

function answerSlsSlesQuestion(
  question
) {
  const q =
    normalize(
      question
    );

  const asksAboutSls =
    /\bsls\b/.test(q) ||
    /\bsles\b/.test(q) ||
    q.includes(
      'sodium lauryl sulfate'
    ) ||
    q.includes(
      'sodium laureth sulfate'
    );

  if (
    !asksAboutSls
  ) {
    return null;
  }

  return {
    source:
      'expert-sls-sles',

    answer:
      'Szia! Nem, a Vitalis termékeink nem tartalmaznak SLS-t vagy SLES-t. Ha megírod, melyik konkrét terméket nézed, szívesen segítek az összetevőivel kapcsolatban is.',

    confidence:
      100,

    links:
      [],

    suggestions:
      [],

    ruleId:
      'sls-sles-free',

    intent:
      'ingredient-question',

    matchedKnowledgeIds:
      []
  };
}

/* =========================================================
   AJÁNLOTT TERMÉKEK AUTOMATIKUS UNAS LINKELÉSE
========================================================= */

function findUnasProductBySuggestion(
  knowledge,
  suggestion
) {
  const wanted =
    normalize(
      suggestion
    );

  if (
    !wanted
  ) {
    return null;
  }

  const wantedTokens =
    wanted
      .split(
        ' '
      )
      .filter(
        (
          token
        ) =>
          token.length >=
          3
      );

  const candidates =
    knowledge
      .filter(
        isProductItem
      )
      .map(
        (
          item
        ) => {

          const title =
            normalize(
              getItemTitle(
                item
              )
            );

          let score =
            0;

          if (
            title ===
            wanted
          ) {
            score +=
              1000;
          }

          if (
            title.includes(
              wanted
            ) ||
            wanted.includes(
              title
            )
          ) {
            score +=
              500;
          }

          for (
            const token of
            wantedTokens
          ) {
            if (
              title.includes(
                token
              )
            ) {
              score +=
                100;
            }
          }

          return {
            item,
            score
          };
        }
      )
      .filter(
        (
          candidate
        ) =>
          candidate.score >
          0
      )
      .sort(
        (
          a,
          b
        ) =>
          b.score -
          a.score
      );

  return candidates[0]?.item ||
    null;
}

function attachProductLinks(
  answer,
  knowledge
) {
  if (
    !answer ||
    !Array.isArray(
      answer.suggestions
    ) ||
    !answer.suggestions.length
  ) {
    return answer;
  }

  const links =
    [];

  const matchedKnowledgeIds =
    [];

  const seenUrls =
    new Set();

  for (
    const suggestion of
    answer.suggestions
  ) {
    const item =
      findUnasProductBySuggestion(
        knowledge,
        suggestion
      );

    const localProductId = findProductInText(normalize(suggestion));
    const localCard = localProductId
      ? productCards([localProductId])[0]
      : null;
    const unasUrl = validProductUrl(item?.url);
    const card = item && unasUrl
      ? {
          id: item.productId || item.id || localCard?.id || '',
          name: getItemTitle(item),
          title: getItemTitle(item),
          label: getItemTitle(item),
          description: removeTechnicalNoise(getItemAnswer(item)),
          url: unasUrl,
          image: item.image || '',
          rank: links.length + 1,
          recommendationType: links.length === 0 ? 'primary' : 'secondary'
        }
      : localCard;

    if (
      !card ||
      seenUrls.has(
        card.url || card.id || card.name
      )
    ) {
      continue;
    }

    seenUrls.add(
      card.url || card.id || card.name
    );

    links.push({
      ...card,
      rank: links.length + 1,
      recommendationType: links.length === 0 ? 'primary' : 'secondary'
    });

    if (
      item?.id
    ) {
      matchedKnowledgeIds.push(
        item.id
      );
    }
  }

  return {
    ...answer,

    links,

    matchedKnowledgeIds
  };
}

/* =========================================================
   PROBLÉMAKÖRÖK ELSŐBBSÉGI AJÁNLÁSA
========================================================= */

function buildProblemAnswer(
  problem
) {
  const concernContext = CONCERNS.includes(problem) ? problem : null;

  if (
    problem ===
    'psoriasis'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Pikkelysömörre hajlamos, száraz és hámló bőr mindennapi kozmetikai ápolására elsősorban a PsoriVital csomagot ajánlom. A csomag Holt-tengeri só balzsamot, shea vajas szappant és Holt-tengeri iszapos szappant tartalmaz. A balzsam rendszeresen használható az érintett bőrfelületek ápolására. A termékek kozmetikumok, nem helyettesítik az orvosi kezelést.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'PsoriVital csomag',
          'Holt-tengeri só balzsam'
        ],

      ruleId:
        'problem-psoriasis',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        [],

      ...(concernContext ? { concernContext } : {})
    };
  }

  if (
    problem ===
    'eczema'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Ekcémára vagy atópiára hajlamos, érzékeny bőr kozmetikai ápolására elsősorban a Dermavital termékcsaládot ajánlom. A kíméletes tisztítás és az illatmentes bőrápolás lehet a legjobb kiindulás. Ha megírod, hogy arcra, testre vagy fejbőrre keresel megoldást, pontosabban is tudok ajánlani.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'Dermavital szappan',
          'Dermavital krém',
          'Dermavital sampon'
        ],

      ruleId:
        'problem-eczema',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        [],

      ...(concernContext ? { concernContext } : {})
    };
  }

  if (
    problem ===
    'rosacea'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Rosaceára, kipirosodásra hajlamos érzékeny arcbőrnél kíméletes bőrápolást javaslok. A Dermavital krém lehet jó kiindulás az érzékeny, irritált és kipirosodásra hajlamos bőr mindennapi kozmetikai ápolására. Erős illóolajos vagy intenzíven hámlasztó termékeket ilyen bőrnél érdemes kerülni.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'Dermavital krém'
        ],

      ruleId:
        'problem-rosacea',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'couperose'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Hajszálértágulatra vagy couperose-ra hajlamos arcbőrnél különösen fontos a kíméletes ápolás. Ilyen esetben a Dermavital krém lehet jó kiindulás az érzékeny bőr mindennapi kozmetikai ápolására. A látható hajszálereket kozmetikum nem tünteti el.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'Dermavital krém'
        ],

      ruleId:
        'problem-couperose',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'acne'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Pattanásos, aknéra hajlamos bőrnél a kíméletes tisztítás és a bőr túlzott kiszárításának kerülése fontos. Ha megírod, hogy arcbőrre vagy testre keresel terméket, segítek a megfelelő Vitalis termék kiválasztásában.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [],

      ruleId:
        'problem-acne',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        [],

      ...(concernContext ? { concernContext } : {})
    };
  }

  if (
    problem ===
    'dry_skin'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Száraz, húzódó bőr ápolására kíméletes tisztítást és zsírosabb, tápláló bőrápolást javaslok. A shea vajat tartalmazó Vitalis szappanok és krémes bőrápolók jó kiindulást jelenthetnek. Ha megírod, hogy arcra, kézre vagy testre keresel terméket, pontosabban is ajánlok.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [],

      ruleId:
        'problem-dry-skin',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  if (
    problem ===
    'scalp'
  ) {
    return {
      source:
        'expert-problem',

      answer:
        'Problémás, viszkető vagy korpás fejbőrre elsőként a Dermavital sampont ajánlom. Ha megírod, hogy inkább száraz, zsíros, hámló vagy irritált a fejbőröd, segítek pontosítani az ajánlást.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [
          'Dermavital sampon'
        ],

      ruleId:
        'problem-scalp',

      intent:
        'problem-recommendation',

      matchedKnowledgeIds:
        []
    };
  }

  return null;
}

/* =========================================================
   BESZÉLGETÉSI FOLYTATÁS
========================================================= */

function resolveProblemFromContext({
  question,
  history
}) {
  const directProblem =
    detectProblem(
      question
    );

  if (
    directProblem
  ) {
    return directProblem;
  }

  const context =
    buildConversationContext(
      history,
      normalize
    );

  if (
    isFollowUpMessage(
      question
    ) &&
    context.lastProblem
  ) {
    return context.lastProblem;
  }

  return null;
}

/* =========================================================
   KATALÓGUSKÉRDÉS
========================================================= */

function isCatalogQuestion(
  question
) {
  const q =
    normalize(
      question
    );

  return (
    q.includes(
      'termek'
    ) ||
    q.includes(
      'termekeitek'
    ) ||
    q.includes(
      'termeketek'
    ) ||
    q.includes(
      'milyen'
    ) ||
    q.includes(
      'mik vannak'
    ) ||
    q.includes(
      'mit ajanl'
    ) ||
    q.includes(
      'melyik'
    )
  );
}

/* =========================================================
   KERESŐSZAVAK
========================================================= */

const GENERIC_WORDS =
  new Set([
    'milyen',
    'mik',
    'melyik',
    'van',
    'vannak',
    'termek',
    'termekek',
    'termekeitek',
    'termeketek',
    'nalatok',
    'keresek',
    'szeretnek',
    'ajanlasz',
    'ajanlotok',
    'lehet',
    'kapni'
  ]);

function getMeaningfulTokens(
  question
) {
  return normalize(
    question
  )
    .split(
      ' '
    )
    .filter(
      (
        token
      ) =>
        token.length >=
          4 &&
        !GENERIC_WORDS.has(
          token
        )
    );
}

/* =========================================================
   UNAS TERMÉKKERESÉS
========================================================= */

function findMatchingProducts(
  knowledge,
  question
) {
  const tokens =
    getMeaningfulTokens(
      question
    );

  if (
    !tokens.length
  ) {
    return [];
  }

  const scored =
    knowledge
      .filter(
        isProductItem
      )
      .map(
        (
          item
        ) => {

          const title =
            normalize(
              getItemTitle(
                item
              )
            );

          const searchable =
            normalize(
              [
                item.title,
                item.name,
                item.shortAnswer,
                item.fullAnswer,
                item.keywords?.join(
                  ' '
                ),
                item.products?.join(
                  ' '
                ),
                item.category,
                item.subcategory
              ]
                .filter(
                  Boolean
                )
                .join(
                  ' '
                )
            );

          let score =
            0;

          for (
            const token of
            tokens
          ) {
            if (
              title.includes(
                token
              )
            ) {
              score +=
                100;
            }

            if (
              searchable.includes(
                token
              )
            ) {
              score +=
                25;
            }
          }

          return {
            item,
            score
          };
        }
      )
      .filter(
        (
          match
        ) =>
          match.score >
          0
      )
      .sort(
        (
          a,
          b
        ) =>
          b.score -
          a.score
      );

  const unique =
    [];

  const seen =
    new Set();

  for (
    const match of
    scored
  ) {
    const title =
      getItemTitle(
        match.item
      );

    const key =
      normalize(
        title
      );

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    unique.push(
      match
    );

    if (
      unique.length >=
      6
    ) {
      break;
    }
  }

  return unique;
}

/* =========================================================
   TERMÉKLISTA
========================================================= */

function buildProductListAnswer(
  matches
) {
  if (
    !matches.length
  ) {
    return null;
  }

  const items =
    matches
      .map(
        (
          match
        ) =>
          match.item
      )
      .slice(
        0,
        6
      );

  const lines =
    items.map(
      (
        item
      ) => {

        const title =
          getItemTitle(
            item
          );

        const raw =
          removeTechnicalNoise(
            getItemAnswer(
              item
            )
          );

        const summary =
          shorten(
            raw,
            110
          );

        return summary
          ? `• ${title} – ${summary}`
          : `• ${title}`;
      }
    );

  return {
    source:
      'unas-list',

    answer:
      `Több kapcsolódó termékünk is van:\n\n${lines.join(
        '\n'
      )}\n\nHa megírod, melyik érdekel, szívesen segítek részletesebben is.`,

    confidence:
      matches[0]
        .score,

    links:
      items
        .filter(
          (
            item
          ) =>
            item.url
        )
        .map(
          (
            item
          ) => ({
            label:
              getItemTitle(
                item
              ),

            url:
              item.url
          })
        ),

    suggestions:
      [],

    ruleId:
      null,

    intent:
      'product-list',

    matchedKnowledgeIds:
      items.map(
        (
          item
        ) =>
          item.id
      )
  };
}

/* =========================================================
   EGYEDI TUDÁSVÁLASZ
========================================================= */

function buildSingleAnswer(
  item,
  score
) {
  const raw =
    removeTechnicalNoise(
      getItemAnswer(
        item
      )
    );

  return {
    source:
      item.source ===
      'unas'
        ? 'unas-knowledge'
        : 'knowledge-fallback',

    answer:
      shorten(
        raw,
        480
      ),

    confidence:
      score,

    links:
      item.url
        ? [
            {
              label:
                getItemTitle(
                  item
                ),

              url:
                item.url
            }
          ]
        : [],

    suggestions:
      [],

    ruleId:
      null,

    intent:
      item.intents?.[0] ||
      null,

    matchedKnowledgeIds:
      [
        item.id
      ]
  };
}

function productName(productId) {
  return PRODUCTS[productId]?.name || null;
}

function buildProductReferenceAnswer(productId, knowledge) {
  const product = PRODUCTS[productId];
  if (!product) return null;

  const matches = searchKnowledge(knowledge, product.name)
    .filter(({ item }) => {
      const haystack = normalize([
        item.title,
        item.canonicalQuestion,
        ...(Array.isArray(item.products) ? item.products : [])
      ].filter(Boolean).join(' '));
      return findProductInText(haystack) === productId &&
        (item.source === 'approved-knowledge' || isProductItem(item));
    })
    .sort((a, b) => {
      const approvedA = a.item.source === 'approved-knowledge' ? 1 : 0;
      const approvedB = b.item.source === 'approved-knowledge' ? 1 : 0;
      return approvedB - approvedA || b.score - a.score;
    });

  if (matches[0]) return buildSingleAnswer(matches[0].item, matches[0].score);

  return {
    source: 'product-context',
    answer: `A ${product.name} ${lowerInitial(product.description).replace(/[.]+$/, '')} készült.`,
    confidence: 100,
    links: productCards([productId]),
    suggestions: [],
    ruleId: `product_context_${productId}`,
    intent: 'product-detail',
    matchedKnowledgeIds: []
  };
}

function resolveTypedProductFollowUp(question, context) {
  const q = normalize(question);
  const type = /\bszappan/.test(q) ? 'szappan'
    : /\b(krem|balzsam)/.test(q) ? 'balzsam'
      : /\bsampon/.test(q) ? 'sampon' : null;

  if (!type || !/^(es\b|szappant?\b|kremet?\b|balzsamot?\b|sampont?\b)/.test(q)) return null;

  const candidates = context.lastRecommendedProducts.filter((id) =>
    normalize(productName(id) || '').includes(type)
  );

  if (candidates.length === 1) return { productId: candidates[0] };
  if (candidates.length > 1) return { ambiguous: true, candidates };
  return null;
}

function clarificationAnswer(context, candidates = []) {
  const ids = candidates.length ? candidates : context.lastRecommendedProducts;
  const names = ids.map(productName).filter(Boolean);
  const choices = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} vagy ${names[1]}` : names.join(', ');
  return {
    source: 'conversation-context',
    answer: choices ? `A ${choices} termékre gondolsz?` : 'Melyik termékre gondolsz?',
    confidence: 100,
    links: productCards(ids),
    suggestions: names.map((name) => ({ label: name, question: name })),
    ruleId: 'clarify-product-reference',
    intent: 'conversation-clarification',
    matchedKnowledgeIds: []
  };
}

function complaintSubjectProduct(routing, evidence, conversationState = {}) {
  const candidates = [
    ...(routing.matchedCanonicalIds || []),
    routing.contextTarget,
    evidence?.complaint?.causality === 'asserted' ? conversationState.focusedProductId : null
  ].filter(Boolean);
  const id = candidates.find((candidate) => PRODUCTS[candidate]);
  return id ? { id, ...PRODUCTS[id] } : null;
}

function complaintRouting(routing, complaint) {
  const semanticGuard = {
    ...routing.semanticGuard,
    ownershipApplied: true,
    ownershipClass: 'complaint',
    resolvedRoute: { route: 'complaint', goal: 'resolve_complaint', intent: complaint.intent, domain: 'complaint', source: 'complaint-resolution' }
  };
  return {
    ...routing,
    route: 'complaint', goal: 'resolve_complaint', intent: complaint.intent, domain: 'complaint',
    responseSource: 'complaint-resolution', answerMode: 'DIRECT', contextUsed: false, contextTarget: null,
    matchedCanonicalIds: [], matchedProductIds: [], primaryProductId: null, targetProductId: null,
    focusedProductId: null, purchaseProductId: null, recommendedProductIds: [], matchedRuleId: null,
    semanticGuard
  };
}

function latestComplaintBoundary(history = []) {
  return [...history].map((item, index) => ({ item, index })).reverse().find(({ item }) =>
    item?.role === 'assistant' && (item.route === 'complaint' || ['complaint', 'resolved_complaint'].includes(item.routing?.semanticGuard?.ownershipClass))) || null;
}

function resolvedComplaintRouting(routing, transition, { preserveRoute = false } = {}) {
  const resolvedRoute = preserveRoute
    ? { route: routing.route || null, goal: routing.goal || null, intent: routing.intent || null, domain: routing.domain || null, source: routing.responseSource || null }
    : { route: 'complaint', goal: 'resolve_complaint', intent: 'complaint_resolved', domain: 'complaint', source: 'complaint-resolution' };
  const semanticGuard = {
    ...routing.semanticGuard,
    resolutionOwner: 'complaint', ownershipApplied: true, ownershipClass: 'resolved_complaint',
    complaintState: 'resolved', resolvedTransitionApplied: true,
    resolvedFromHistory: Boolean(transition.resolvedFromHistory), resolvedRoute
  };
  if (preserveRoute) return { ...routing, semanticGuard };
  return {
    ...routing,
    route: 'complaint', goal: 'resolve_complaint', intent: 'complaint_resolved', domain: 'complaint',
    responseSource: 'complaint-resolution', answerMode: 'DIRECT', contextUsed: false, contextTarget: null,
    matchedCanonicalIds: [], matchedProductIds: [], primaryProductId: null, targetProductId: null,
    focusedProductId: null, purchaseProductId: null, recommendedProductIds: [], matchedRuleId: null,
    semanticGuard
  };
}

function historyAfterComplaintBoundary(history = []) {
  const boundary = [...history].map((item, index) => ({ item, index })).reverse().find(({ item }) =>
    item?.role === 'assistant' && (item.route === 'complaint' || ['complaint', 'resolved_complaint'].includes(item.routing?.semanticGuard?.ownershipClass)));
  return boundary ? history.slice(boundary.index + 1) : history;
}

/* =========================================================
   FŐ VÁLASZKÉPZÉS
========================================================= */

function createAnswerUnsafe({
  question,
  history,
  knowledge,
  ruleEngine,
  logGap,
  conversationState,
  technicalFailure=false,
  logDiagnostic
}) {

  const complaintBoundary = latestComplaintBoundary(history);
  const effectiveHistory = historyAfterComplaintBoundary(history);
  const effectiveState = complaintBoundary ? structuredState(effectiveHistory) : conversationState;
  const selectedRouting = routeAnswer({ question, history: effectiveHistory, knowledge, ruleEngine, conversationState: effectiveState });
  const semanticEvidence = buildSemanticEvidence({ question, routing: selectedRouting, history: effectiveHistory, conversationState: effectiveState });
  const semanticGuard = validateSemanticRoute({ routing: selectedRouting, evidence: semanticEvidence });
  const { routing } = applySemanticGuardEnforcement({ routing: selectedRouting, guard: semanticGuard });
  const relevantComplaintHistory = Boolean(complaintBoundary
    && complaintBoundary.index === history.length - 1
    && complaintBoundary.item.intent !== 'complaint_resolved'
    && complaintBoundary.item.routing?.semanticGuard?.ownershipClass !== 'resolved_complaint');
  const resolvedTransition = detectResolvedComplaintTransition(question, {
    complaint: semanticEvidence.complaint,
    relevantComplaintHistory
  });
  if (routing.route !== 'safety' && routing.semanticGuard.enforcementEnabled && resolvedTransition) {
    if (!resolvedTransition.explicitGoal) {
      const subjectProduct = resolvedTransition.resolvedFromHistory ? null : complaintSubjectProduct(selectedRouting, semanticEvidence, effectiveState || {});
      const resolvedRouting = resolvedComplaintRouting(routing, resolvedTransition);
      const resolvedDraft = resolveResolvedComplaint({ resolvedFromHistory: resolvedTransition.resolvedFromHistory, complaintSubjectProduct: subjectProduct });
      return composeCommunication({ decision: resolvedRouting, draft: attachDecision(resolvedDraft, resolvedRouting), question, history: effectiveHistory });
    }
    const goalQuestion = resolvedTransition.explicitGoal;
    const goalState = structuredState(effectiveHistory);
    const goalSelectedRouting = routeAnswer({ question: goalQuestion, history: effectiveHistory, knowledge, ruleEngine, conversationState: goalState });
    const goalEvidence = buildSemanticEvidence({ question: goalQuestion, routing: goalSelectedRouting, history: effectiveHistory, conversationState: goalState });
    const goalGuard = validateSemanticRoute({ routing: goalSelectedRouting, evidence: goalEvidence });
    const { routing: enforcedGoalRouting } = applySemanticGuardEnforcement({ routing: goalSelectedRouting, guard: goalGuard });
    const goalRouting = resolvedComplaintRouting(enforcedGoalRouting, resolvedTransition, { preserveRoute: true });
    const goalPlan = planAnswer({ question: goalQuestion, routing: goalRouting, conversationState: goalState });
    const goalDraft = materializeDecision({ routing: goalRouting, question: goalQuestion, history: effectiveHistory, knowledge, ruleEngine, logGap, conversationState: goalState, technicalFailure, logDiagnostic, answerPlan: goalPlan });
    const composed = composeCommunication({ decision: goalRouting, draft: goalDraft, question, history: effectiveHistory });
    return {
      ...composed,
      answer: `Örülök, hogy elmúlt. ${composed.answer}`,
      complaintState: 'resolved', resolvedTransitionApplied: true,
      resolvedFromHistory: Boolean(resolvedTransition.resolvedFromHistory)
    };
  }
  if (routing.semanticGuard.enforcementEnabled && routing.semanticGuard.resolutionOwner === 'complaint') {
    const subjectProduct = complaintSubjectProduct(selectedRouting, semanticEvidence, effectiveState || {});
    const resolvedRouting = complaintRouting(routing, semanticEvidence.complaint);
    const complaintDraft = resolveComplaint({ complaint: semanticEvidence.complaint, complaintSubjectProduct: subjectProduct });
    return composeCommunication({ decision: resolvedRouting, draft: attachDecision(complaintDraft, resolvedRouting), question, history: effectiveHistory });
  }
  const answerPlan = planAnswer({ question, routing, conversationState: effectiveState });
  const draft = materializeDecision({ routing, question, history: effectiveHistory, knowledge, ruleEngine, logGap, conversationState: effectiveState, technicalFailure, logDiagnostic, answerPlan });
  const result = composeCommunication({ decision: routing, draft, question, history: effectiveHistory });
  if (draft && draft.recommendationIntent) {
    Object.defineProperty(result, 'recommendationIntent', {
      value: draft.recommendationIntent,
      enumerable: false,
      writable: true,
      configurable: true
    });
  }
  return result;

  /* Legacy pipeline retained temporarily as a rollback reference during the
     incremental Decision Engine migration. */

  const metaAnswer = resolveMetaIntent(question);
  if (metaAnswer) return metaAnswer;

  const context = buildConversationContext(history, normalize);

  const reference = resolveProductReference(question, context);
  if (reference?.ambiguous) return clarificationAnswer(context);
  if (reference?.productId) {
    return buildProductReferenceAnswer(reference.productId, knowledge);
  }

  const typedFollowUp = resolveTypedProductFollowUp(question, context);
  if (typedFollowUp?.ambiguous) {
    return clarificationAnswer(context, typedFollowUp.candidates);
  }
  if (typedFollowUp?.productId) {
    return buildProductReferenceAnswer(typedFollowUp.productId, knowledge);
  }

  const directProductId = findProductInText(normalize(question));
  const isBareProductName = directProductId && normalize(question).split(' ').length <= 6;
  if (isBareProductName) {
    return buildProductReferenceAnswer(directProductId, knowledge);
  }

  /*
    1. E-MAIL-CÍM
  */

  if (
    looksLikeEmail(
      question
    )
  ) {
    return {
      source:
        'conversation-context',

      answer:
        'Köszönöm, megkaptam az e-mail-címet. Ha egy korábbi kérdésedhez vagy kuponkódhoz kapcsolódik, kérlek írd meg röviden azt is, miben segíthetek tovább.',

      confidence:
        100,

      links:
        [],

      suggestions:
        [],

      ruleId:
        'email-followup',

      intent:
        'conversation-followup',

      matchedKnowledgeIds:
        []
    };
  }

  /*
    2. SLS / SLES
  */

  const slsAnswer =
    answerSlsSlesQuestion(
      question
    );

  if (
    slsAnswer
  ) {
    return slsAnswer;
  }

  /*
    A konkrét problémára és konkrét termékekre épülő expert szabályok
    elsőbbséget élveznek az általános, kézzel épített problémaválaszokkal
    szemben. Így az expert szabály terméksorrendje és kártyái nem vesznek el.
  */

  const expert = ruleEngine.resolve(
    question,
    history
  );

  const specificProductRuleIds = new Set([
    'scalp_general',
    'scalp_psoriasis',
    'scalp_itchy',
    'hair_loss',
    'eczema',
    'psoriasis_body',
    'acne',
    'dry_skin'
  ]);

  if (expert && specificProductRuleIds.has(expert.ruleId)) {
    return expert;
  }

  /*
    3. PROBLÉMAKÖR ELSŐBBSÉGI FELISMERÉS
  */

  const problem =
    resolveProblemFromContext({
      question,
      history
    });

  if (
    problem
  ) {
    const problemAnswer =
      buildProblemAnswer(
        problem
      );

    if (
      problemAnswer
    ) {
      return attachProductLinks(
        problemAnswer,
        knowledge
      );
    }
  }

  /*
    4. KATALÓGUSKERESÉS
  */

  if (
    isCatalogQuestion(
      question
    )
  ) {
    const productMatches =
      findMatchingProducts(
        knowledge,
        question
      );

    if (
      productMatches.length
    ) {
      const listAnswer =
        buildProductListAnswer(
          productMatches
        );

      if (
        listAnswer
      ) {
        return listAnswer;
      }
    }
  }

  /*
    5. SZAKÉRTŐI SZABÁLYOK
  */

  if (
    expert
  ) {
    return expert;
  }

  /*
    6. TUDÁSBÁZIS
  */

  const matches =
    searchKnowledge(
      knowledge,
      question
    );

  const best =
    matches[0];

  if (
    !best ||
    best.score <
    60
  ) {
    logGap(
      question,
      best?.score ||
      0,
      history
    );

    return {
      source:
        'gap',

      answer:
        'Erre még nem találtam elég pontos, jóváhagyott Vitalis-információt. Írd meg kérlek részletesebben, melyik termékről vagy problémáról van szó.',

      confidence:
        best?.score ||
        0,

      links:
        [],

      suggestions:
        [],

      ruleId:
        null,

      intent:
        null,

      matchedKnowledgeIds:
        []
    };
  }

  return buildSingleAnswer(
    best.item,
    best.score
  );
}

function createAnswer(options) {
  const unsafe = createAnswerUnsafe(options);
  const validated = validateStructuredOutput(unsafe);
  if (unsafe && unsafe.recommendationIntent) {
    Object.defineProperty(validated, 'recommendationIntent', {
      value: unsafe.recommendationIntent,
      enumerable: false,
      writable: true,
      configurable: true
    });
  }
  return validated;
}

module.exports = {
  createAnswer
};
