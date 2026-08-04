'use strict';
const assert=require('assert'),fs=require('fs'),http=require('http'),path=require('path');const{spawn}=require('child_process');
const PORT=3401,TOKEN='cluster-api-test',ROOT=__dirname,taskPath=path.join(ROOT,'data','logs','knowledge-tasks.jsonl'),clusterPath=path.join(ROOT,'data','logs','knowledge-clusters.jsonl'),pidPath=path.join(ROOT,'chatbot.pid');
function request(method,pathname,token,body){return new Promise((resolve,reject)=>{const text=body===undefined?null:JSON.stringify(body),req=http.request({hostname:'127.0.0.1',port:PORT,method,path:pathname,headers:{...(token?{'X-Admin-Token':token}:{}),...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{})}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:data?JSON.parse(data):{}}));});req.on('error',reject);if(text)req.write(text);req.end();});}
async function main(){
 const originals=new Map([[taskPath,fs.existsSync(taskPath)?fs.readFileSync(taskPath):null],[clusterPath,fs.existsSync(clusterPath)?fs.readFileSync(clusterPath):null],[pidPath,fs.existsSync(pidPath)?fs.readFileSync(pidPath):null]]);
 const seed={id:'cluster-task',normalizedQuestionKey:'szallitasi ido',question:'Mennyi a szállítási idő?',classification:'missing_knowledge',rootCause:'admin_flow_missing',repairTarget:'admin_intent',priority:'high',businessValue:5,estimatedImpact:80,topic:'szállítás',occurrenceCount:2,canonicalIds:[],status:'open'};
 fs.writeFileSync(taskPath,JSON.stringify(seed)+'\n','utf8');if(fs.existsSync(clusterPath))fs.unlinkSync(clusterPath);
 const child=spawn(process.execPath,['server.cjs'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1',ADMIN_TOKEN:TOKEN,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',UNAS_API_KEY:'',UNAS_SYNC_INTERVAL_MS:'0'},stdio:'ignore'});
 try{
  for(let i=0;i<50;i++){try{if((await request('GET','/api/status')).status===200)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal((await request('POST','/api/admin/knowledge-clusters/rebuild',null,{})).status,401);
  assert.equal((await request('POST',`/api/admin/knowledge-clusters/rebuild?token=${TOKEN}`,null,{})).status,401);
  const dry=await request('POST','/api/admin/knowledge-clusters/rebuild',TOKEN,{});assert.equal(dry.status,200);assert.equal(dry.body.dryRun,true);assert.equal(fs.existsSync(clusterPath),false);
  const write=await request('POST','/api/admin/knowledge-clusters/rebuild',TOKEN,{write:true});assert.equal(write.status,200);assert.equal(write.body.dryRun,false);assert.equal(write.body.clustersCreated,1);
  const first=await request('GET','/api/admin/knowledge-clusters',TOKEN);assert.equal(first.body.items.length,1);const id=first.body.items[0].id;
  const update=await request('POST','/api/admin/knowledge-clusters/update',TOKEN,{id,status:'in_review',reviewerNote:'belső megjegyzés'});assert.equal(update.status,200);
  assert.equal((await request('POST','/api/admin/knowledge-clusters/update',TOKEN,{id,status:'open',taskIds:[]})).status,400);
  const again=await request('POST','/api/admin/knowledge-clusters/rebuild',TOKEN,{write:true});assert.equal(again.body.clustersCreated,0);assert.equal(again.body.clustersUnchanged,1);
  const after=await request('GET','/api/admin/knowledge-clusters',TOKEN);assert.equal(after.body.items.length,1);assert.equal(after.body.items[0].status,'in_review');assert.equal(after.body.items[0].reviewerNote,'belső megjegyzés');
  assert.equal(JSON.stringify(dry.body).includes(seed.question),false);assert.equal(JSON.stringify(after.body).includes('ADMIN_TOKEN'),false);
  console.log('Knowledge Cluster admin API regressziótesztek: OK');
 }finally{child.kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,200));for(const[file,data]of originals){if(data)fs.writeFileSync(file,data);else if(fs.existsSync(file))fs.unlinkSync(file);}}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
