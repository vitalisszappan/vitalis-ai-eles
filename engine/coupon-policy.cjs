'use strict';

const fs = require('fs');
const path = require('path');
const { normalize } = require('./normalizer.cjs');

const DEFAULT_POLICY_PATH = path.join(__dirname, '..', 'data', 'approved-coupon-policy.json');
const AUTHORITATIVE_STATUSES = new Set(['OWNER_APPROVED', 'CURRENT_VERIFIED']);

function getPath(value, dottedPath) {
  return String(dottedPath).split('.').reduce((current, key) => current && current[key], value);
}

function invalidPolicy(errorCode) {
  return { valid: false, errorCode, policyVersion: null, policy: null };
}

function loadCouponPolicy(policyPath = DEFAULT_POLICY_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (error) {
    return invalidPolicy(error?.code === 'ENOENT' ? 'POLICY_MISSING' : 'POLICY_MALFORMED');
  }
  if (parsed?.policyVersion !== 1 || parsed?.schema !== 'vitalis-approved-coupon-policy/v1') {
    return invalidPolicy('POLICY_VERSION_UNSUPPORTED');
  }
  if (!Array.isArray(parsed.currentFacts)) return invalidPolicy('CURRENT_FACTS_INVALID');
  for (const factPath of parsed.currentFacts) {
    const fact = getPath(parsed, factPath);
    if (!fact || !AUTHORITATIVE_STATUSES.has(fact.status)) return invalidPolicy('CURRENT_FACT_INVALID');
    if (!fact.disclosure || typeof fact.disclosure.customerFacing !== 'boolean') return invalidPolicy('DISCLOSURE_MISSING');
    if (!Array.isArray(fact.provenance) || fact.provenance.length === 0) return invalidPolicy('PROVENANCE_MISSING');
  }
  return { valid: true, errorCode: null, policyVersion: 1, policy: parsed };
}

function couponContext(history = []) {
  return history.slice(-6).some((message) => !message?.historyEventInvalid
    && !message?.historyEventUncorrelated
    && (message?.route === 'coupon_policy'
    || message?.routing?.route === 'coupon_policy'
    || message?.domain === 'coupon'));
}

function detectCouponIntent(question, history = []) {
  const q = normalize(question);
  const contextual = couponContext(history);
  const protectedMention = defaultResolver.isProtectedValueMention(question);
  const couponWord = /\b(kupon\w*|kedvezmeny\w*)\b/.test(q) || protectedMention;
  if (protectedMention) return 'protected_code_probe';
  if (/\bhirlevel\w*\b.*\b(kedvezmeny|kupon)\w*|\b(kedvezmeny|kupon)\w*.*\bhirlevel\w*\b/.test(q)) {
    return /\b(hogyan|hogy|hol|jutok|kapom|kaphatom)\b/.test(q) ? 'acquisition' : 'coupon_exists';
  }
  if (/\b(mi a|mondd meg|ird meg|add meg)\b.*\b(kuponkod\w*|kod\w*)\b/.test(q)
    || (contextual && /^(mi|es mi) a kod$/.test(q))) return 'code_request';
  if (/\b(osszevonhato|egyutt)\b.*\b(kupon|kedvezmeny)\b|\bmas kuponnal\b/.test(q)) return 'stacking';
  if (/\b(akcios\w*).*(jo|hasznal|bevalt)|\b(jo|hasznal|bevalt).*\bakcios\w*/.test(q)) return 'sale_cart';
  if (/\b(minimum|minimalis)\b.*\b(rendeles\w*|kosar\w*)\b/.test(q)) return 'minimum_order';
  if (/\b(hanyszor|hany alkalommal)\b.*\b(hasznal|bevalt)|^(es )?hanyszor hasznalhatom$/.test(q)) return 'use_limit';
  if (/\b(hova|hol)\b.*\b(beir\w*|ir\w*\s+be|megad\w*|ervenyesit\w*)\b|\bkuponkod\b.*\b(beir\w*|ir\w*\s+be|megad\w*)\b/.test(q)) return 'entry_location';
  if (couponWord && /\bhol\b.*\b(talal\w*|kapott\w*)\b/.test(q)) return 'acquisition';
  if (/\b(hogyan|hogy)\b.*\b(kap|juthat)\w*.*\b(kupon|kod)\w*/.test(q)
    || /^(es )?hogyan kapom meg$/.test(q)) return 'acquisition';
  if (contextual && /^(es )?ezt (hogyan|hogy) kapom meg$/.test(q)) return 'acquisition';
  if (/\b(mekkora|mennyi|hany szazalek)\b.*\b(kedvezmeny|kupon)\b/.test(q)) return 'discount_value';
  if (/\b(van)\b.*\b(kupon|kedvezmeny)\w*|\b(hogyan|hogy)\b.*\bkaphat\w*\b.*\bkupont\b/.test(q)
    || (couponWord && /\b(jar|keres)\w*\b/.test(q))) return 'coupon_exists';
  if (/\b(regisztral\w*|regisztracio\w*)\b/.test(q)) return 'registration';
  if (/\b(bejelentkez\w*|jelentkez\w*|belep\w*)\b/.test(q)) return 'login';
  if (/\b(csak hirlevel|barki|ki hasznalhat)\b/.test(q)) return 'business_eligibility';
  if (/\b(nem mukodik|ervenytelen\w*|lejart\w*|felhasznalt\w*)\b/.test(q)) {
    return couponWord || contextual || /^(miert nem mukodik|lejart|mar felhasznaltam)$/.test(q) ? 'troubleshooting' : null;
  }
  if (/\b(mas|egyeb|jelenlegi|mostani)\b.*\b(akcio|promocio)\w*/.test(q)) return 'other_promotions';
  if (/^van egy kuponom$/.test(q)) return 'coupon_context';
  if (contextual && /^es mas kuponnal egyutt$/.test(q)) return 'stacking';
  return null;
}

function createCouponPolicyResolver(options = {}) {
  const loaded = options.loadedPolicy || loadCouponPolicy(options.policyPath);
  const policy = loaded.valid ? loaded.policy : null;

  function fact(factPath) {
    const item = policy ? getPath(policy, factPath) : null;
    const authoritative = Boolean(item && AUTHORITATIVE_STATUSES.has(item.status));
    const customerFacing = authoritative && item.disclosure?.customerFacing === true;
    const provenance = authoritative ? [{
      sourceType: 'approved_coupon_policy',
      policyVersion: loaded.policyVersion,
      factPath,
      verificationStatus: item.status,
      disclosureStatus: customerFacing ? 'CUSTOMER_DISCLOSABLE' : 'NOT_DIRECTLY_CUSTOMER_DISCLOSABLE',
      evidenceSources: [...item.provenance]
    }] : [];
    return {
      factPath,
      status: !authoritative ? 'unavailable' : customerFacing ? 'grounded' : 'protected',
      value: customerFacing ? item.value : null,
      provenance
    };
  }

  function materialize(intent) {
    const used = [];
    const use = (factPath) => { const projected = fact(factPath); used.push(projected); return projected; };
    const unavailable = (message = 'Erről még nincs jóváhagyott, aktuális kuponinformációnk.') => ({
      answer: message, factsUsed: used, groundingStatus: 'unavailable'
    });
    if (!loaded.valid) return unavailable('A jóváhagyott kuponinformáció jelenleg nem érhető el.');

    if (intent === 'coupon_exists') {
      const exists = use('newsletterCoupon.exists');
      const discount = use('newsletterCoupon.discountValue');
      const delivery = use('newsletterCoupon.deliveryChannel');
      if (exists.status !== 'grounded' || discount.status !== 'grounded' || delivery.status !== 'grounded') return unavailable();
      return { answer: `Igen, ha feliratkozol a hírlevelünkre, ${discount.value}% kedvezményt kapsz, a kupont pedig e-mailben küldjük el.`, factsUsed: used, groundingStatus: 'grounded' };
    }
    if (intent === 'discount_value') {
      const discount = use('newsletterCoupon.discountValue');
      const type = use('newsletterCoupon.couponType');
      if (discount.status !== 'grounded' || type.status !== 'grounded') return unavailable();
      return { answer: `A hírlevél-feliratkozáshoz kapcsolódó kupon ${discount.value}% kedvezményt ad a rendelés végösszegéből.`, factsUsed: used, groundingStatus: 'grounded' };
    }
    if (intent === 'acquisition' || intent === 'code_request' || intent === 'protected_code_probe') {
      if (intent !== 'acquisition') use('newsletterCoupon.code');
      const discount = use('newsletterCoupon.discountValue');
      const delivery = use('newsletterCoupon.deliveryChannel');
      const automation = use('newsletterCoupon.deliveryAutomation');
      if (discount.status !== 'grounded' || delivery.status !== 'grounded' || automation.status !== 'grounded') return unavailable();
      const suffix = intent === 'protected_code_probe' ? ' Egy konkrét kód működését vagy érvényességét itt nem tudom megerősíteni.' : '';
      return { answer: `Iratkozz fel a hírlevelünkre, és a ${discount.value}%-os kupont automatikusan elküldjük e-mailben.${suffix}`, factsUsed: used, groundingStatus: 'grounded' };
    }
    if (intent === 'entry_location' || intent === 'coupon_context') {
      const location = use('checkout.couponEntryLocation');
      if (location.status !== 'grounded') return unavailable();
      const v = location.value;
      return { answer: `A kosár oldalon keresd a ${v.sectionLabel} részt, írd be a kódot a ${v.fieldLabel} mezőbe, majd kattints az ${v.actionLabel} gombra.`, factsUsed: used, groundingStatus: 'grounded' };
    }
    if (intent === 'sale_cart') {
      const sale = use('eligibility.orderTotalCouponRedeemableWhenCartContainsSaleProduct');
      if (sale.status !== 'grounded') return unavailable();
      return { answer: sale.value ? 'Ez a kupon akkor is használható, ha a kosárban akciós termék van.' : 'Ha a kosárban akciós termék van, ez a kupon jelenleg nem használható.', factsUsed: used, groundingStatus: 'grounded' };
    }
    if (intent === 'use_limit') {
      const limit = use('newsletterCoupon.singleUse');
      if (limit.status !== 'grounded') return unavailable();
      return { answer: limit.value ? 'A kupon vásárlónként egyszer használható.' : 'A kupon többször használható.', factsUsed: used, groundingStatus: 'grounded' };
    }
    if (intent === 'minimum_order') {
      const minimum = use('eligibility.minimumOrderValue');
      if (minimum.status !== 'grounded') return unavailable();
      return { answer: `A jelenleg beállított minimum rendelési érték ${minimum.value.amount} ${minimum.value.currency}.`, factsUsed: used, groundingStatus: 'grounded' };
    }

    const unknownPaths = {
      stacking: 'eligibility.stackingAllowed', registration: 'newsletterCoupon.registrationRequired',
      login: 'checkout.accountLoginRequired', business_eligibility: 'eligibility.businessCustomerEligibility',
      troubleshooting: 'troubleshooting.invalidCode', other_promotions: 'promotions.activePromotionExists'
    };
    if (unknownPaths[intent]) use(unknownPaths[intent]);
    return unavailable();
  }

  function isProtectedValueMention(input) {
    const code = policy ? getPath(policy, 'newsletterCoupon.code') : null;
    if (!code || !AUTHORITATIVE_STATUSES.has(code.status) || code.disclosure?.customerFacing !== false) return false;
    const protectedValue = normalize(code.value);
    return Boolean(protectedValue && normalize(input).split(' ').includes(protectedValue));
  }

  return { loaded, fact, materialize, isProtectedValueMention };
}

const defaultResolver = createCouponPolicyResolver();

module.exports = {
  DEFAULT_POLICY_PATH,
  loadCouponPolicy,
  createCouponPolicyResolver,
  detectCouponIntent,
  defaultCouponPolicyResolver: defaultResolver
};
