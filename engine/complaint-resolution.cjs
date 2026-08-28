'use strict';

const CATEGORY_QUESTIONS = Object.freeze({
  szappan: 'Melyik szappanról van szó?', krem: 'Melyik krémről van szó?',
  balzsam: 'Melyik balzsamról van szó?', sampon: 'Melyik samponról van szó?',
  dezodor: 'Melyik dezodorról van szó?', tusfurdo: 'Melyik tusfürdőről van szó?'
});

function conciseProductName(product) {
  const value = String(product?.name || '').trim();
  if (!value) return null;
  return value.split(/\s+[–—-]\s+/)[0].trim();
}

function resolveComplaint({ complaint, complaintSubjectProduct = null } = {}) {
  if (!complaint) throw new TypeError('complaint evidence is required');
  const productName = conciseProductName(complaintSubjectProduct);
  const categoryQuestion = CATEGORY_QUESTIONS[complaint.productCategory] || 'Melyik termékről van szó?';
  const statusUnclear = complaint.temporality === 'still_relevant_past';
  const resolutionFamily = statusUnclear
    ? 'complaint_status_unclear'
    : productName ? 'complaint_product_known' : 'complaint_product_unknown';
  let answer;
  let clarificationType;
  if (resolutionFamily === 'complaint_status_unclear') {
    answer = 'Sajnálom, hogy ezt tapasztaltad. Most is fennáll a panasz?';
    clarificationType = 'current_status';
  } else if (resolutionFamily === 'complaint_product_known') {
    answer = `Sajnálom, hogy ezt tapasztaltad a ${productName} használata után. Most is fennáll a ${complaint.symptomLabel || 'panasz'}?`;
    clarificationType = 'current_status';
  } else {
    answer = `Sajnálom, hogy ezt tapasztaltad. ${categoryQuestion}`;
    clarificationType = 'product_identity';
  }
  return {
    resolutionFamily,
    resolutionOwner: 'complaint', ownershipApplied: true, ownershipClass: 'complaint',
    complaintIntent: complaint.intent, severity: complaint.severity, subject: complaint.subject,
    complaintSubjectProductId: complaintSubjectProduct?.id || null,
    clarificationRequired: true, clarificationType,
    recommendationAllowed: false, purchaseAllowed: false, productLinksAllowed: false,
    source: 'complaint-resolution', intent: complaint.intent, confidence: 100,
    answer, links: [], suggestions: [], ruleId: null, matchedKnowledgeIds: [],
    targetProductId: null, recommendedProductIds: []
  };
}

function resolveResolvedComplaint({ resolvedFromHistory = false, complaintSubjectProduct = null } = {}) {
  return {
    resolutionFamily: 'complaint_resolved',
    resolutionOwner: 'complaint', ownershipApplied: true, ownershipClass: 'resolved_complaint',
    complaintState: 'resolved', resolvedTransitionApplied: true, resolvedFromHistory: Boolean(resolvedFromHistory),
    complaintSubjectProductId: complaintSubjectProduct?.id || null,
    clarificationRequired: false, clarificationType: null,
    recommendationAllowed: false, purchaseAllowed: false, productLinksAllowed: false,
    source: 'complaint-resolution', intent: 'complaint_resolved', confidence: 100,
    answer: 'Örülök, hogy elmúlt.', links: [], suggestions: [], ruleId: null, matchedKnowledgeIds: [],
    targetProductId: null, recommendedProductIds: [], primaryRecommendedProduct: null
  };
}

module.exports = { resolveComplaint, resolveResolvedComplaint };
