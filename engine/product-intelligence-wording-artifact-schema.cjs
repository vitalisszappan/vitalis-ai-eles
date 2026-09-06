'use strict';

const WORDING_MODES = Object.freeze(['EXACT_TEXT', 'CLOSED_TEMPLATE']);
const WORDING_LIFECYCLES = Object.freeze(['active', 'pending_review', 'rejected', 'deprecated', 'superseded']);
const CONTROLLED_SLOT_VALUE_TYPES = Object.freeze(['productId', 'productName', 'concernContext', 'applicationArea', 'recommendationRole']);

module.exports = { WORDING_MODES, WORDING_LIFECYCLES, CONTROLLED_SLOT_VALUE_TYPES };