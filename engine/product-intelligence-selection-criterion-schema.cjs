'use strict';

const { APPLICATION_AREAS, CONCERNS, RECOMMENDATION_ROLES } = require('./product-intelligence-schema.cjs');

const CRITERION_NODE_TYPES = Object.freeze(['ALL', 'ANY', 'LEAF']);
const CRITERION_OPERATORS = Object.freeze(['EXACT', 'ANY_OF']);
const CRITERION_FIELDS = Object.freeze([
  'acneFrequencyOrIntensity', 'skinOiliness', 'blackheads', 'applicationArea',
  'concernContext', 'productType', 'recommendationRole'
]);
const CONTROLLED_VALUES = Object.freeze({
  acneFrequencyOrIntensity: Object.freeze(['occasional_mild', 'frequent_stronger']),
  skinOiliness: Object.freeze(['combination', 'mildly_oily', 'oily', 'dry', 'unknown']),
  blackheads: Object.freeze(['present', 'absent', 'unknown']),
  applicationArea: APPLICATION_AREAS,
  concernContext: CONCERNS,
  productType: Object.freeze(['soap', 'shampoo', 'cream', 'balm']),
  recommendationRole: RECOMMENDATION_ROLES
});

module.exports = {
  CRITERION_NODE_TYPES,
  CRITERION_OPERATORS,
  CRITERION_FIELDS,
  CONTROLLED_VALUES
};