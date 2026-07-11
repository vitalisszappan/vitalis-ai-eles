const path = require('path');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const engine = new ExpertRuleEngine(path.join(__dirname,'data','rules','expert-rules.json'));
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
if(failed){console.error(`\n${failed} teszt hibás.`);process.exit(1);} else console.log(`\nMinden teszt sikeres (${tests.length}/${tests.length}).`);
