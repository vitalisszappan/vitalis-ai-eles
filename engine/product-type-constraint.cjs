'use strict';
const {normalize}=require('./normalizer.cjs');
const HAIR_WASH_TYPES=Object.freeze(['liquid_shampoo','solid_shampoo','shampoo_soap']);
const NEGATABLE_TYPES=Object.freeze([
  ['shampoo_soap','(?:samponszappan\\w*|sampon\\s+szappan\\w*)'],
  ['shampoo','sampon(?!szappan)\\w*'],
  ['solid_shampoo','(?:szilard\\s+sampon\\w*|samponrud\\w*|shampoo\\s+bar\\w*)'],
  ['liquid_shampoo','folyekony\\s+sampon\\w*'],
  ['tusfurdo','tusfurdo\\w*'],
  ['szappan','szappan\\w*'],
  ['krem','krem\\w*'],
  ['balzsam','balzsam\\w*']
]);
function negationPatterns(typePattern){return[
  new RegExp(`\\bnem\\s+${typePattern}(?:\\s+(?:erdekel\\w*|szeretn\\w*))?`,'g'),
  new RegExp(`\\b${typePattern}\\s+nem\\s+(?:erdekel\\w*|szeretn\\w*)`,'g'),
  new RegExp(`\\b(?:barmit\\s*)?csak\\s+${typePattern}\\s+ne\\b`,'g'),
  new RegExp(`\\b${typePattern}\\s+helyett\\b`,'g')
];}
function detectExcludedProductTypes(question){
  const q=normalize(question),excluded=[];
  for(const [type,pattern] of NEGATABLE_TYPES){if(negationPatterns(pattern).some(regex=>regex.test(q)))excluded.push(type);}
  return excluded;
}
function withoutNegatedProductTypes(question){let q=normalize(question);for(const [,pattern] of NEGATABLE_TYPES){for(const regex of negationPatterns(pattern))q=q.replace(regex,' ');}return q.replace(/\s+/g,' ').trim();}
function detectProductTypeConstraint(question){const q=withoutNegatedProductTypes(question);if(/\b(samponszappan\w*|sampon szappan\w*)/.test(q))return'shampoo_soap';if(/\b(szilard sampon\w*|samponrud\w*|shampoo bar\w*)/.test(q))return'solid_shampoo';if(/\bfolyekony sampon\w*/.test(q))return'liquid_shampoo';if(/\btusfurdo\w*/.test(q))return'tusfurdo';if(/\bszappan\w*/.test(q))return'szappan';if(/\bkrem\w*/.test(q))return'krem';if(/\bbalzsam\w*/.test(q))return'balzsam';return null;}
function inferredHairType(product){const explicit=product?.productType;if(HAIR_WASH_TYPES.includes(explicit))return explicit;const raw=[product?.id,product?.name,product?.title,product?.label,...(product?.category||[])].filter(Boolean).join(' '),text=normalize(raw);if(/shampoo_soap|\b(samponszappan\w*|sampon szappan\w*)/.test(`${raw} ${text}`))return'shampoo_soap';if(/solid_shampoo|\b(szilard sampon\w*|samponrud\w*|shampoo bar\w*)/.test(`${raw} ${text}`))return'solid_shampoo';if(/\bsampon\w*/.test(text))return'liquid_shampoo';return null;}
function matchesProductType(product,constraint){if(!constraint)return true;if(HAIR_WASH_TYPES.includes(constraint))return inferredHairType(product)===constraint;const text=normalize([product?.id,product?.name,product?.title,product?.label].filter(Boolean).join(' '));if(constraint==='tusfurdo')return /\btusfurdo\w*/.test(text);if(constraint==='szappan')return /\bszappan\w*/.test(text)&&!inferredHairType(product);if(constraint==='krem')return /\bkrem\w*/.test(text);if(constraint==='balzsam')return /\bbalzsam\w*/.test(text);return false;}
module.exports={HAIR_WASH_TYPES,detectExcludedProductTypes,detectProductTypeConstraint,inferredHairType,matchesProductType};
