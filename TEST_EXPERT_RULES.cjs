const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const { structuredState } = require('./engine/conversation-memory.cjs');
const engine = new ExpertRuleEngine(path.join(__dirname,'data','rules','expert-rules.json'));
const knowledge=JSON.parse(fs.readFileSync(path.join(__dirname,'data','knowledge.json'),'utf8'));
const ask=(question)=>createAnswer({question,history:[],conversationState:structuredState([]),knowledge,ruleEngine:engine,logGap(){},logDiagnostic(){}});
const tests = [
  ['Korpás a fejbőröm.','scalp_general','Dermavital sampont'],
  ['Viszket a fejbőröm.','scalp_itchy','Dermavital sampont'],
  ['Pikkelysömörös a fejbőröm.','scalp_psoriasis','Dermavital sampont'],
  ['Hajhullásra mit ajánlasz?','hair_loss','rozmaringos samponszappant'],
  ['Mit ajánlasz ekcémára?','eczema','Dermavital krémet'],
  ['Mit ajánlasz pikkelysömörre?','psoriasis_body','PsoriVital csomagot'],
  ['Mennyi a szállítási idő?','shipping_time','2 munkanap'],
  ['Hogyan kapom meg a kuponkódot?','coupon','fel kell iratkozni']
];
let failed=0;
for(const [q,id,needle] of tests){
  const r=engine.resolve(q,[]);
  const ok=r && r.ruleId===id && r.answer.includes(needle);
  console.log(ok?'OK  ':'HIBA',q,'=>',r?.ruleId,r?.answer);
  if(!ok) failed++;
}
for(const question of ['Szia pikkelysömörre mit ajánlasz','Mit ajánlasz pikkelysömörre?']){
  const result=ask(question);
  assert.equal(result.route,'expert_rule',question);
  assert.deepEqual(result.links.map(item=>item.id),['psorivital_csomag','dermavital_szappan','tengeri_soszappan'],question);
  assert.equal(result.links.some(item=>item.id==='holt_tengeri_so_balzsam'),false,question);
  assert.doesNotMatch(result.answer,/kiegészítésként a Holt-tengeri só balzsam/i,question);
}
const soap=ask('Pikkelysömörre milyen szappant ajánlasz?');
assert.equal(soap.route,'expert_rule');
assert.deepEqual(soap.links.map(item=>item.id),['dermavital_szappan','tengeri_soszappan']);
assert.equal(soap.links.some(item=>item.id==='psorivital_csomag'),false);
assert.equal(soap.links.some(item=>item.id==='holt_tengeri_iszapos_szappan'),false);
const itchy=ask('Viszket a fejbőröm. Melyik sampont ajánlod?');
assert.equal(itchy.intent,'scalp_itchy');
assert.deepEqual(itchy.links.map(item=>item.id),['dermavital_sampon','rozmaringos_samponszappan']);
if(failed){console.error(`\n${failed} teszt hibás.`);process.exit(1);} else console.log(`\nMinden teszt sikeres (${tests.length}/${tests.length}).`);
