'use strict';
const assert=require('node:assert/strict');
const {parseExactDecimal,decimalToString,addExact,multiplyExact,classifyOrderItem,matchSkuEvidence,mapLifecycle,buildRevenueSnapshot}=require('./engine/revenue-domain.cjs');
const finalStatus={kind:'status',statusType:'close_ok',statusId:283142,status:'Megrendelés lezárva'};
const pendingStatus={kind:'status',statusType:'open_normal',statusId:283137,status:'Feldolgozásra vár'};
const item=(overrides={})=>({id:'1001',sku:'SKU-1',quantity:'1',priceGross:'1000',...overrides});
const order=(items=[item()],overrides={})=>({orderKey:'ORDER-1',orderId:'42',currency:'HUF',items,...overrides});

assert.throws(()=>parseExactDecimal('000'),/invalid_decimal/);assert.throws(()=>parseExactDecimal('1e3'),/invalid_decimal/);assert.throws(()=>parseExactDecimal(' 1'),/invalid_decimal/);
assert.throws(()=>parseExactDecimal('1'.repeat(31)),/decimal_out_of_range/);assert.throws(()=>parseExactDecimal('0.'+'1'.repeat(13)),/decimal_out_of_range/);
assert.equal(decimalToString(parseExactDecimal('12.3400')),'12.34');
assert.equal(decimalToString(addExact(parseExactDecimal('0.1'),parseExactDecimal('0.02'))),'0.12');
assert.equal(decimalToString(multiplyExact(parseExactDecimal('0.1'),parseExactDecimal('0.2'))),'0.02');

const caseA=buildRevenueSnapshot({order:order(),evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});
assert.equal(caseA.hasRecommendedMatch,true);assert.equal(caseA.hasClickedMatch,false);assert.equal(caseA.aiAssistedOrder,true);assert.equal(caseA.aiAssistedProductRevenue,'1000');assert.equal(caseA.finalAiAssistedRevenue,'1000');assert.equal(caseA.lifecycle.state,'finalized');
const caseB=buildRevenueSnapshot({order:order(),evidence:{clicked:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});assert.equal(caseB.hasRecommendedMatch,false);assert.equal(caseB.hasClickedMatch,true);assert.equal(caseB.finalAiAssistedRevenue,'1000');
const caseC=buildRevenueSnapshot({order:order(),evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:pendingStatus});assert.equal(caseC.lifecycle.state,'verified_pending');assert.equal(caseC.aiAssistedProductRevenue,'1000');assert.equal(caseC.finalAiAssistedRevenue,'0');
const caseD=mapLifecycle('verified_pending',{kind:'authoritative_not_found',authoritative:true});assert.equal(caseD.state,'unverifiable');assert.equal(mapLifecycle('verified_pending',{kind:'authoritative_not_found',authoritative:false}).state,'verified_pending');
const caseE=buildRevenueSnapshot({order:order([item({quantity:'2.5',priceGross:'12.34'})]),evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});assert.equal(caseE.items[0].lineGross,'30.85');assert.equal(caseE.finalAiAssistedRevenue,'30.85');
const caseF=buildRevenueSnapshot({order:order([item(),item({id:'shipping-cost',sku:'shipping-cost',priceGross:'1500'}),item({id:'handel-cost',sku:'handel-cost',priceGross:'300'})]),evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});assert.equal(caseF.aiAssistedProductRevenue,'1000');assert.equal(caseF.shippingValue,'1500');assert.equal(caseF.paymentFeeValue,'300');assert.equal(caseF.fullOrderValue,'2800');
const repeatedInput={order:order(),evidence:{recommended:[{sku:'SKU-1'},{sku:'SKU-1'}],clicked:[{sku:'SKU-1'},{sku:'SKU-1'}]},lifecycleObservation:finalStatus};assert.deepEqual(buildRevenueSnapshot(repeatedInput),buildRevenueSnapshot(repeatedInput));assert.equal(buildRevenueSnapshot(repeatedInput).finalAiAssistedRevenue,'1000');
for(const kind of ['transport_failure','login_failure','timeout','malformed_xml','upstream_failure','generic_502']){const mapped=mapLifecycle('finalized',{kind});assert.equal(mapped.state,'finalized');assert.equal(mapped.changed,false);assert.equal(mapped.refreshFailed,true);const snapshot=buildRevenueSnapshot({order:order(),evidence:{clicked:[{sku:'SKU-1'}]},currentLifecycleState:'finalized',lifecycleObservation:{kind}});assert.equal(snapshot.finalAiAssistedRevenue,'1000');}
for(const observation of [{...finalStatus,statusId:999},{...finalStatus,statusType:'close_other'},{...finalStatus,status:'Más státusz'},{kind:'status',statusType:'mystery',statusId:1,status:'Unknown'}]){const snapshot=buildRevenueSnapshot({order:order(),evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:observation});assert.equal(snapshot.lifecycle.state,'unknown');assert.equal(snapshot.finalAiAssistedRevenue,'0');}

assert.deepEqual(matchSkuEvidence('SKU-1',{recommended:[{sku:'sku-1'}],clicked:[{sku:'SKU-10'}]}),{recommendedMatch:false,clickedMatch:false});
assert.deepEqual(classifyOrderItem({id:'shipping-cost',sku:'anything'}),{lineType:'shipping',needsReview:false});assert.deepEqual(classifyOrderItem({id:'mystery-fee',sku:'mystery-fee'}),{lineType:'other',needsReview:true});
assert.deepEqual(classifyOrderItem({id:'unknown-technical',sku:'FEE',isTechnical:true}),{lineType:'other',needsReview:true});
const multi=buildRevenueSnapshot({order:order([item({quantity:'2'}),item({id:'1002',quantity:'3'})]),evidence:{clicked:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});assert.equal(multi.finalAiAssistedRevenue,'5000');
for(const bad of [item({quantity:'0'}),item({quantity:'-1'}),item({quantity:'1e2'}),item({priceGross:'-1'}),item({priceGross:'NaN'})]){const snapshot=buildRevenueSnapshot({order:order([bad]),evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});assert.equal(snapshot.needsReview,true);assert.equal(snapshot.finalAiAssistedRevenue,'0');}
const unknown=buildRevenueSnapshot({order:order([item(),item({id:'mystery-fee',sku:'mystery-fee',priceGross:'25'})]),evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});assert.equal(unknown.otherValue,'25');assert.equal(unknown.needsReview,true);assert.equal(unknown.finalAiAssistedRevenue,'0');
assert.throws(()=>buildRevenueSnapshot({order:order([item()],{currency:'huf'}),evidence:{}}),/invalid_currency/);
const safe=buildRevenueSnapshot({order:{...order(),customer:{email:'private@example.invalid'},rawXml:'<Orders>secret</Orders>'},evidence:{recommended:[{sku:'SKU-1'}]},lifecycleObservation:finalStatus});const serialized=JSON.stringify(safe);for(const forbidden of ['private@example.invalid','<Orders>','customer','rawXml'])assert.equal(serialized.includes(forbidden),false);
console.log('Revenue Attribution domain Phase 1 CASE A-I es edge regresszio: OK');
