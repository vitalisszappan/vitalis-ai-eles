'use strict';
const assert=require('node:assert/strict');const fs=require('fs');const {createAnswer}=require('./engine/answer-service.cjs');const {ExpertRuleEngine}=require('./engine/rule-engine.cjs');const {structuredState}=require('./engine/conversation-memory.cjs');const {detectProductTypeConstraint,matchesProductType}=require('./engine/product-type-constraint.cjs');
const knowledge=JSON.parse(fs.readFileSync('data/knowledge.json','utf8')),mapping=JSON.parse(fs.readFileSync('data/canonical-unas-mapping.json','utf8')).mappings,rules=new ExpertRuleEngine('data/rules/expert-rules.json');
function answer(question){return createAnswer({question,history:[],conversationState:structuredState([]),knowledge,ruleEngine:rules,logGap:()=>{},logDiagnostic:()=>{}});}function skus(result){return result.links.map(x=>x.commerce?.sku).filter(Boolean);}function types(result){return result.links.map(x=>x.productType);}
const cases=[
 ['Van szil\u00e1rd sampon?',['VSZSP05','VSZSP04'],'solid_shampoo'],
 ['Szil\u00e1rd sampont keresek viszket\u0151 fejb\u0151rre.',['VSZSP05'],'solid_shampoo'],
 ['Milyen samponszappant aj\u00e1nlasz?',['Vssz02','Vssz01'],'shampoo_soap'],
 ['Milyen foly\u00e9kony sampont aj\u00e1nlasz probl\u00e9m\u00e1s fejb\u0151rre?',['Vitdermsamp01'],'liquid_shampoo'],
 ['Van szil\u00e1rd samponotok?',['VSZSP05','VSZSP04'],'solid_shampoo'],
 ['A szil\u00e1rd sampon \u00e9s a samponszappan ugyanaz?',[],null],
 ['Zs\u00edros hajra szil\u00e1rd sampont keresek.',['VSZSP04'],'solid_shampoo'],
 ['Norm\u00e1l hajra szil\u00e1rd sampont keresek.',['VSZSP05'],'solid_shampoo'],
 ['Viszket a fejb\u0151r\u00f6m, de szil\u00e1rd sampont szeretn\u00e9k.',['VSZSP05'],'solid_shampoo'],
 ['Samponszappant szeretn\u00e9k zs\u00edros hajra.',['Vssz01','Vssz02'],'shampoo_soap']
];
for(const [question,expectedSkus,type] of cases){const result=answer(question);assert.deepEqual(skus(result),expectedSkus,question);if(type){assert.equal(detectProductTypeConstraint(question),type,question);assert.ok(types(result).every(value=>value===type),question);}else{assert.equal(result.route,'hair_type_knowledge');assert.match(result.answer,/k\u00e9t k\u00fcl\u00f6n term\u00e9kt\u00edpus/i);assert.match(result.answer,/szappanalap/i);}}
for(const [canonicalId,sku,type] of [['solid_shampoo_normal_green_tea','VSZSP05','solid_shampoo'],['solid_shampoo_oily_rosemary_caffeine','VSZSP04','solid_shampoo'],['dermavital_sampon','Vitdermsamp01','liquid_shampoo'],['rozmaringos_samponszappan','Vssz02','shampoo_soap'],['teafa_aktiv_szen_samponszappan','Vssz01','shampoo_soap']]){const item=mapping.find(x=>x.canonicalId===canonicalId);assert.equal(item?.mappingStatus,'approved');assert.equal(item?.sku,sku);assert.equal(item?.productType,type);}
assert.equal(detectProductTypeConstraint('szil\u00e1rd term\u00e9ket keresek'),null);assert.equal(matchesProductType({name:'Szil\u00e1rd sampon'},'shampoo_soap'),false);assert.equal(matchesProductType({name:'Samponszappan'},'solid_shampoo'),false);
assert.equal(detectProductTypeConstraint('sampon'),null);assert.equal(detectProductTypeConstraint('foly\u00e9kony sampon'),'liquid_shampoo');assert.equal(detectProductTypeConstraint('szil\u00e1rd sampon'),'solid_shampoo');assert.equal(detectProductTypeConstraint('samponszappan'),'shampoo_soap');
const targeted=[
 ['Melyik sampont aj\u00e1nlod zs\u00edros hajra?','hair_product_type','solid_shampoo',['VSZSP04'],['solid_shampoo']],
 ['Milyen sampont aj\u00e1nlasz probl\u00e9m\u00e1s fejb\u0151rre?','expert_rule',null,['Vitdermsamp01'],['liquid_shampoo']],
 ['Milyen foly\u00e9kony sampont aj\u00e1nlasz zs\u00edros hajra?','hair_product_type','liquid_shampoo',[],[]],
 ['Milyen szil\u00e1rd sampont aj\u00e1nlasz zs\u00edros hajra?','hair_product_type','solid_shampoo',['VSZSP04'],['solid_shampoo']],
 ['Milyen samponszappant aj\u00e1nlasz zs\u00edros hajra?','hair_product_type','shampoo_soap',['Vssz01','Vssz02'],['shampoo_soap','shampoo_soap']],
 ['Van sampon?','hair_product_type',null,['Vitdermsamp01','VSZSP05','VSZSP04'],['liquid_shampoo','solid_shampoo','solid_shampoo']]
];
for(const [question,route,constraint,expectedSkus,expectedTypes] of targeted){const result=answer(question);assert.equal(result.route,route,question);assert.equal(result.routing.productTypeConstraint,constraint,question);assert.deepEqual(skus(result),expectedSkus,question);assert.deepEqual(types(result),expectedTypes,question);}
console.log('Three-way shampoo product type acceptance: PASS (10/10)');
