'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'); const PORT=3413,ROOT=__dirname,dir=fs.mkdtempSync(path.join(os.tmpdir(),'vitalis-proof-api-'));
const pid=path.join(ROOT,'chatbot.pid'),oldPid=fs.existsSync(pid)?fs.readFileSync(pid):null;
function request(method,body,origin='https://www.vitalis-szappan.hu',type='application/json') {return new Promise((resolve,reject)=>{const data=body==null?'':typeof body==='string'?body:JSON.stringify(body);const req=http.request({hostname:'127.0.0.1',port:PORT,path:'/api/commerce/order-proof',method,headers:{...(origin?{Origin:origin}:{}),...(type?{'Content-Type':type}:{}),'Content-Length':Buffer.byteLength(data)}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:text?JSON.parse(text):{}}))});req.on('error',reject);if(data)req.write(data);req.end()})}
async function main(){const eventLog=path.join(dir,'events.jsonl'),proofLog=path.join(dir,'proofs.jsonl');const child=spawn(process.execPath,['server.cjs'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',UNAS_API_KEY:'',UNAS_SYNC_INTERVAL_MS:'0',COMMERCE_EVENT_LOG:eventLog,ORDER_PROOF_LOG:proofLog,ORDER_PROOF_RATE_LIMIT:'100'},stdio:'ignore'});try{
 for(let i=0;i<60;i++){try{if((await request('GET',null,null,null)).status===405)break}catch(_){} await new Promise(r=>setTimeout(r,100));}
 const base={orderKey:'ORDER-123',attributionId:crypto.randomUUID(),schemaVersion:1,timestamp:new Date().toISOString()};
 assert.equal((await request('GET',null)).status,405); assert.equal((await request('POST',base,'https://evil.example')).status,403); assert.equal((await request('POST',base,null)).status,403);
 assert.equal((await request('POST',base,'http://127.0.0.1:'+PORT)).status,403);
 assert.equal((await request('POST',base,'https://vitalis-szappan.hu')).body.error,'attribution_not_found');
 assert.equal((await request('POST',base,undefined,'text/plain')).status,415); assert.equal((await request('POST','x'.repeat(2049))).status,413);
 for(const field of ['sku','revenue','email','orderId']) assert.equal((await request('POST',{...base,[field]:'x'})).status,400);
 assert.equal((await request('POST',{...base,attributionId:'invalid'})).body.error,'invalid_attribution_id');
 assert.equal((await request('POST',{...base,attributionId:'00000000-0000-1000-8000-000000000000'})).body.error,'invalid_attribution_id');
 assert.equal((await request('POST',{...base,schemaVersion:2})).body.error,'invalid_schema_version');
 assert.equal((await request('POST',{...base,orderKey:''})).body.error,'invalid_order_key');
 assert.equal((await request('POST',{...base,orderKey:'x'.repeat(101)})).body.error,'order_key_too_long');
 assert.equal((await request('POST',{...base,orderKey:'<unsafe>'})).body.error,'unsafe_order_key');
 assert.equal((await request('POST',{...base,timestamp:'not-iso'})).body.error,'invalid_timestamp');
 for(const hours of [24,-24])assert.equal((await request('POST',{...base,timestamp:new Date(Date.now()+hours*3600000).toISOString()})).body.error,'timestamp_out_of_range');
 const missing={...base};delete missing.timestamp;assert.equal((await request('POST',missing)).status,400);
 assert.equal((await request('POST',base)).body.error,'attribution_not_found');
 fs.writeFileSync(eventLog,JSON.stringify({attribution_id:base.attributionId,event_type:'chat_started',occurred_at:new Date(Date.now()-1000).toISOString()})+'\n');
 assert.equal((await request('POST',base)).body.error,'product_clicked_not_found');
 }finally{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,200));if(oldPid)fs.writeFileSync(pid,oldPid);else if(fs.existsSync(pid))fs.unlinkSync(pid);fs.rmSync(dir,{recursive:true,force:true})} console.log('Order proof API security regresszio: OK')}
main().catch(e=>{console.error(e);process.exitCode=1});
