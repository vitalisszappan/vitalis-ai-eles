const path = require('path');
const fs = require('fs');
const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const engine = new ExpertRuleEngine(path.join(__dirname,'data','rules','expert-rules.json'));
const tests = [
  ['Szállítás érdekelne.','shipping_general','Segítek a szállítással kapcsolatban'],
  ['Rendeléssel kapcsolatban kérdeznék.','order_general','Segítek a rendeléssel kapcsolatban'],
  ['Korpás a fejbőröm.','scalp_general','Dermavital sampont'],
  ['Hogyan kapom meg a kuponkódot?','coupon','fel kell iratkozni']
];
let failed=0;
for(const [q,id,needle] of tests){
 const r=engine.resolve(q,[]);
 const ok=r && r.ruleId===id && r.answer.includes(needle);
 console.log(ok?'OK  ':'HIBA',q,'=>',r?.ruleId,r?.answer);
 if(!ok) failed++;
}
const html=fs.readFileSync(path.join(__dirname,'public','widget.html'),'utf8');
for(const needle of ['Kérdezd a készítőt!','Szalacsi Zoltán · v1.4','Azonnali válaszok','sok év alatt felépített szakmai tapasztalataimra']){
 const ok=html.includes(needle); console.log(ok?'OK  ':'HIBA','UI:',needle); if(!ok) failed++;
}
if(failed){console.error(`\n${failed} teszt hibás.`);process.exit(1);} else console.log('\nMinden 1.4 teszt sikeres.');
