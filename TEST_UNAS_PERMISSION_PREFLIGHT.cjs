'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {parseLoginPermissions,runUnasPermissionPreflight,createPermissionPreflightHandler}=require('./engine/unas-permission-preflight.cjs');
const secret='UNAS-API-KEY-SECRET',sessionToken='UNAS-SESSION-TOKEN-SECRET';
const trueXml=`<Login><Token>${sessionToken}</Token><Permissions><Permission>getProduct</Permission><Permission>getOrder</Permission></Permissions><ShopId>SECRET-SHOP</ShopId></Login>`;
const falseXml=`<Login><Token>${sessionToken}</Token><Permissions><Permission>getProduct</Permission></Permissions></Login>`;
assert.deepEqual(parseLoginPermissions(trueXml),{getOrderAllowed:true});
assert.deepEqual(parseLoginPermissions(falseXml),{getOrderAllowed:false});
assert.deepEqual(parseLoginPermissions('<Login><Token>x</Token></Login>'),{getOrderAllowed:false});
assert.deepEqual(parseLoginPermissions('<Login><Permissions>getProduct,getOrder</Permissions></Login>'),{getOrderAllowed:true});
assert.deepEqual(parseLoginPermissions('<Login><Permissions><getOrder>1</getOrder></Permissions></Login>'),{getOrderAllowed:true});
assert.deepEqual(parseLoginPermissions('<Login><Permissions><Permission><Name>getOrder</Name><Allowed>false</Allowed></Permission></Permissions></Login>'),{getOrderAllowed:false});
assert.throws(()=>parseLoginPermissions('<Login>'),/invalid_unas_login_xml/);
function sendJson(res,status,body){res.status=status;res.body=body;}
async function invoke(handler,headers={},query=''){const res={headers:{'cache-control':'no-store'}};await handler({headers},res,new URL(`http://localhost/api/admin/unas/permission-preflight${query}`));return res;}
(async()=>{
 assert.deepEqual(await runUnasPermissionPreflight({unasConfigured:true,loginFn:async()=>({token:sessionToken,raw:trueXml})}),{unasConfigured:true,loginOk:true,getOrderAllowed:true});
 assert.deepEqual(await runUnasPermissionPreflight({unasConfigured:true,loginFn:async()=>({token:sessionToken,raw:falseXml})}),{unasConfigured:true,loginOk:true,getOrderAllowed:false});
 assert.deepEqual(await runUnasPermissionPreflight({unasConfigured:true,loginFn:async()=>({token:sessionToken,raw:'<Login><Token>x</Token></Login>'})}),{unasConfigured:true,loginOk:true,getOrderAllowed:false});
 await assert.rejects(runUnasPermissionPreflight({unasConfigured:true,loginFn:async()=>({token:sessionToken,raw:'<Login>'})}),/invalid_unas_login_xml/);
 await assert.rejects(runUnasPermissionPreflight({unasConfigured:false}),/unas_not_configured/);
 await assert.rejects(runUnasPermissionPreflight({unasConfigured:true,loginFn:async()=>{throw Error(`${secret} ${sessionToken}`);}}));
 const logs=[];let loginCalls=0;
 const successHandler=createPermissionPreflightHandler({adminToken:'ADMIN-SECRET',unasConfigured:()=>true,sendJson,loginFn:async()=>{loginCalls+=1;return{token:sessionToken,raw:trueXml};},logger:event=>logs.push(event)});
 assert.equal((await invoke(successHandler)).status,401);assert.equal((await invoke(successHandler,{},'?token=ADMIN-SECRET')).status,401);
 const success=await invoke(successHandler,{'x-admin-token':'ADMIN-SECRET'});assert.equal(success.status,200);assert.equal(success.headers['cache-control'],'no-store');
 assert.deepEqual(success.body,{unasConfigured:true,loginOk:true,getOrderAllowed:true});assert.equal(loginCalls,1);
 const failureLogs=[];const failureHandler=createPermissionPreflightHandler({adminToken:'ADMIN-SECRET',unasConfigured:()=>true,sendJson,loginFn:async()=>{throw Error(`${secret} ${sessionToken} <Login><Permissions>getOrder</Permissions></Login>`);},logger:event=>failureLogs.push(event)});
 const failure=await invoke(failureHandler,{'x-admin-token':'ADMIN-SECRET'});assert.deepEqual(failure.body,{ok:false,error:'unas_permission_preflight_failed'});
 const serialized=JSON.stringify({success,logs,failure,failureLogs});for(const forbidden of [secret,sessionToken,'<Login>','Permissions','getProduct','ADMIN-SECRET'])assert.equal(serialized.includes(forbidden),false);
 for(const event of [...logs,...failureLogs])assert.deepEqual(Object.keys(event).sort(),['code','getOrderAllowed','loginOk','operation','permissionChecked','status'].sort());
 const root=__dirname,temp=fs.mkdtempSync(path.join(os.tmpdir(),'vitalis-unas-permission-')),port=3414;
 const child=spawn(process.execPath,['server.cjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ADMIN_TOKEN:'ADMIN-SECRET',UNAS_API_KEY:'',UNAS_SYNC_INTERVAL_MS:'0',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',COMMERCE_EVENT_LOG:path.join(temp,'events.jsonl'),ORDER_PROOF_LOG:path.join(temp,'proofs.jsonl')},stdio:'ignore'});
 const request=(pathname,headers={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:pathname,method:'GET',headers},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(body)}));});req.on('error',reject);req.end();});
 try{for(let attempt=0;attempt<50;attempt+=1){try{if((await request('/api/status')).status===200)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal((await request('/api/admin/unas/permission-preflight')).status,401);assert.equal((await request('/api/admin/unas/permission-preflight?token=ADMIN-SECRET')).status,401);
  const unavailable=await request('/api/admin/unas/permission-preflight',{'X-Admin-Token':'ADMIN-SECRET'});assert.equal(unavailable.status,503);assert.equal(unavailable.headers['cache-control'],'no-store');assert.deepEqual(unavailable.body,{ok:false,error:'unas_permission_preflight_failed'});
 }finally{child.kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,200));fs.rmSync(temp,{recursive:true,force:true});}
 console.log('UNAS getOrder permission preflight security regresszio: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
