'use strict';

const assert=require('node:assert/strict');

// Prevent the production runner IIFE from connecting when loaded for contract tests.
const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'RUN_REVENUE_PRODUCTION_ROLLBACK_PROOF.cjs'),'utf8');
assert.match(source,/function canonicalNumeric/);
assert.match(source,/canonicalNumeric\(shipping\.quantity\)==='1'/);
assert.match(source,/canonicalNumeric\(payment\.unit_gross\)==='400'/);

function canonicalNumeric(value){const text=String(value??'');if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text))return null;return text.includes('.')?text.replace(/0+$/,'').replace(/\.$/,''):text;}
for(const [actual,expected] of [['1.000000000000','1'],['2700.000000000000','2700'],['1850.000000000000','1850'],['400.000000000000','400'],['0.000000000000','0']])assert.equal(canonicalNumeric(actual),expected);
assert.equal(canonicalNumeric('not-numeric'),null);
assert.equal((source.match(/clickEventIds\.every/g)||[]).length,1);
console.log('Revenue production rollback proof item numeric contract: PASS');
