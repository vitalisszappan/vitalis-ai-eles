'use strict';

const REVIEW_SCOPES = Object.freeze(['owner', 'compliance', 'customer_answer', 'comparison', 'decision_support']);
const REVIEW_DECISIONS = Object.freeze(['approved', 'rejected', 'pending_review', 'revoked']);

module.exports = { REVIEW_SCOPES, REVIEW_DECISIONS };