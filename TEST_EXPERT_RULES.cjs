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

const genericMedicineDisclaimer = /kozmetikumok?,? (?:de )?nem gyógyszerek?|nem helyettesítik? az orvosi kezelést/i;
const eczema=ask('Melyik terméket ajánlod ekcémára?');
assert.equal(eczema.route,'expert_rule');
assert.deepEqual(eczema.links.map(item=>item.id),['dermavital_krem','dermavital_szappan']);
assert.doesNotMatch(eczema.answer,genericMedicineDisclaimer);

const psoriasis=ask('Mit ajánlasz pikkelysömörre hajlamos bőrre?');
assert.equal(psoriasis.route,'expert_rule');
assert.equal(psoriasis.links[0].id,'psorivital_csomag');
assert.doesNotMatch(psoriasis.answer,genericMedicineDisclaimer);

const sensitive=ask('Mit ajánlasz száraz, érzékeny bőrre?');
assert.notEqual(sensitive.route,'safety');
assert.doesNotMatch(sensitive.answer,genericMedicineDisclaimer);

for(const question of [
  'Ez meggyógyítja az ekcémát?',
  'Kiválthatom vele az orvos által felírt gyógyszert?',
  'Abbahagyhatom a gyógyszeremet, ha ezt használom?'
]){
  const result=ask(question);
  assert.equal(result.route,'safety',question);
  assert.equal(result.safetyClass,'medical_escalation',question);
  assert.deepEqual(result.links,[],question);
  assert.match(result.answer,/orvosi segítséget|sürgős ellátás/i,question);
}

assert.doesNotMatch(engine.resolve('Melyik terméket ajánlod ekcémára?',[]).answer,genericMedicineDisclaimer);
assert.match(engine.resolve('Ez meggyógyítja az ekcémát?',[]).answer,genericMedicineDisclaimer);
if(failed){console.error(`\n${failed} teszt hibás.`);process.exit(1);} else console.log(`\nMinden teszt sikeres (${tests.length}/${tests.length}).`);
