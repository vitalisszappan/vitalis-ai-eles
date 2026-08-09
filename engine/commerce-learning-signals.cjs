'use strict';

function learningSignalFromOutcome(outcome) {
  if (!outcome || outcome.outcomeType !== 'verified_order' || !Array.isArray(outcome.matchedSkus) || !outcome.matchedSkus.length) return null;
  return { schemaVersion:1, signalId:`${outcome.outcomeId}:recommendation_converted`, signalType:'recommendation_converted',
    outcomeId:outcome.outcomeId, attributionId:outcome.attributionId, matchedSkus:[...outcome.matchedSkus],
    conversationSessionIds:[...(outcome.conversationSessionIds||[])], observedAt:outcome.verifiedAt,
    meaning:'clicked_sku_matched_server_verified_order_sku', autonomousActionAllowed:false };
}
module.exports={learningSignalFromOutcome};
