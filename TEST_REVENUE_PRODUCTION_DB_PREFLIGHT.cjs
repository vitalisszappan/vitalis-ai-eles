'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONNECTION_ENV, CERT_ENV, REVENUE_TABLES, PREFLIGHT_STEPS, DIAGNOSTIC_CATEGORIES, CONNECT_INTERNAL_CATEGORIES, CODELESS_CONNECT_CATEGORIES, validateConnectionString, buildVerifiedClientConfig, categorizePreflightError, buildSafePreflightDiagnostic, classifyPostgresInternalConnectError, classifyCodelessConnectError, buildSafeConnectDiagnostic, runProductionDbPreflight } = require('./engine/revenue-production-db-preflight.cjs');

assert.equal(CONNECTION_ENV,'DATABASE_URL');
assert.equal(CERT_ENV,'SUPABASE_CA_CERT_PATH');
assert.deepEqual(PREFLIGHT_STEPS,['CONNECT','SELECT_1','TABLE_EXISTENCE','TARGET_ORDER_LOOKUP']);
assert.throws(()=>validateConnectionString('postgresql://user:secret@example.test/postgres'),/sslmode_verify_full_required/);
assert.throws(()=>validateConnectionString('postgresql://user:secret@example.test/postgres?sslmode=require'),/sslmode_verify_full_required/);
assert.doesNotThrow(()=>validateConnectionString('postgresql://user:secret@example.test/postgres?sslmode=verify-full'));
const diagnosticCases=[
 [{code:'DATABASE_URL_MISSING'},'DATABASE_URL_MISSING'],[{code:'ENOTFOUND'},'DNS_NOT_FOUND'],
 [{code:'EAI_AGAIN'},'DNS_TEMPORARY_FAILURE'],[{code:'ENETUNREACH'},'NETWORK_UNREACHABLE'],
 [{code:'EHOSTUNREACH'},'HOST_UNREACHABLE'],[{code:'28P01'},'AUTHENTICATION_FAILED'],
 [{code:'3D000'},'INVALID_DATABASE'],[{code:'ETIMEDOUT'},'CONNECTION_TIMEOUT'],
 [{code:'ECONNREFUSED'},'CONNECTION_REFUSED'],[{code:'XX000',preflightPhase:'query:tables'},'QUERY_FAILED'],
 [{message:'postgresql://user:super-secret@example.test'},'UNKNOWN_CONNECTION_FAILURE']
];
const tlsCases={
 ERR_TLS_CERT_ALTNAME_INVALID:'TLS_HOSTNAME_MISMATCH',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'TLS_CHAIN_UNVERIFIED',
 SELF_SIGNED_CERT_IN_CHAIN:'TLS_SELF_SIGNED_CHAIN',DEPTH_ZERO_SELF_SIGNED_CERT:'TLS_SELF_SIGNED_CERT',
 CERT_HAS_EXPIRED:'TLS_CERT_EXPIRED',UNABLE_TO_GET_ISSUER_CERT:'TLS_ISSUER_CERT_MISSING',
 UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'TLS_ISSUER_CERT_MISSING'
};
for(const [code,expected] of Object.entries(tlsCases)) diagnosticCases.push([{code},expected]);
for(const [error,expected] of diagnosticCases){const category=categorizePreflightError(error);assert.equal(category,expected);assert.equal(DIAGNOSTIC_CATEGORIES.has(category),true);assert.equal(category.includes('secret'),false);}

assert.equal(categorizePreflightError({code:'08006'}),'POSTGRES_CONNECTION_FAILURE');
assert.equal(categorizePreflightError({code:'53300'}),'POSTGRES_RESOURCE_LIMIT');
assert.equal(categorizePreflightError({code:'57P01'}),'POSTGRES_SERVER_SHUTDOWN');
assert.equal(categorizePreflightError({code:'58000'}),'POSTGRES_SYSTEM_ERROR');
assert.equal(categorizePreflightError({code:'XX000'}),'POSTGRES_INTERNAL_ERROR');
assert.equal(categorizePreflightError({code:'42P01'}),'POSTGRES_ERROR');

const hostileError={
 name:'Error\npostgresql://user:password@secret-host',code:'ECONNREFUSED\npassword=secret',errno:'secret-password',
 syscall:'connect secret-host',message:'postgresql://user:password@secret-host/db',stack:'secret stack',
 host:'secret-host',address:'10.0.0.1',connectionString:'postgresql://user:password@secret-host/db',cert:'secret-cert'
};
assert.deepEqual(buildSafePreflightDiagnostic(hostileError),{CATEGORY:'UNKNOWN_CONNECTION_FAILURE'});
const safeDiagnostic=buildSafePreflightDiagnostic({name:'Error',code:'ECONNREFUSED',errno:-4078,syscall:'connect',message:'password=secret',stack:'secret'});
assert.deepEqual(safeDiagnostic,{name:'Error',code:'ECONNREFUSED',errno:-4078,syscall:'connect',CATEGORY:'CONNECTION_REFUSED'});
const safeJson=JSON.stringify(safeDiagnostic);assert.equal(/password|stack|host|url|cert|secret/i.test(safeJson),false);
assert.deepEqual(Object.keys(safeDiagnostic),['name','code','errno','syscall','CATEGORY']);

const internalConnectCases=[
 ['Tenant or user not found','TENANT_OR_USER_NOT_FOUND'],
 ['database user hidden-value does not exist','DATABASE_USER_NOT_FOUND'],
 ['invalid pooler user hidden-value','INVALID_POOLER_USER'],
 ['Supavisor internal error for hidden-value','POOLER_INTERNAL_ERROR'],
 ['Max client connections reached','MAX_CLIENT_CONNECTIONS'],
 ['unrecognized internal condition involving password=secret','OTHER_POSTGRES_INTERNAL_ERROR']
];
for(const [message,expected] of internalConnectCases){
 const category=classifyPostgresInternalConnectError({code:'XX000',message});
 assert.equal(category,expected);assert.equal(CONNECT_INTERNAL_CATEGORIES.has(category),true);
 const diagnostic=buildSafeConnectDiagnostic({name:'error',code:'XX000',message,stack:'postgresql://user:secret@host/db'});
 assert.deepEqual(diagnostic,{code:'XX000',name:'error',category:expected});
 assert.equal(/hidden-value|password|secret|postgresql|host/i.test(JSON.stringify(diagnostic)),false);
}
assert.deepEqual(buildSafeConnectDiagnostic({name:'error\nsecret',code:'bad secret',message:'password=secret'}),{code:'NONE',name:'NONE',category:'UNKNOWN_CODELESS_CONNECT_ERROR'});
assert.deepEqual(buildSafeConnectDiagnostic({name:'Error',code:'ECONNREFUSED',message:'password=secret'}),{code:'ECONNREFUSED',name:'Error'});

const codelessCases=[
 ['supabase_ca_cert_unreadable','CA_CERT_FILE_ERROR'],
 ['certificate altname does not match hidden-host','TLS_HOSTNAME_MISMATCH'],
 ['unable to verify the first certificate','TLS_CERTIFICATE_VERIFY_ERROR'],
 ['sslmode_verify_full_required','SSL_MODE_CONFIGURATION_ERROR'],
 ['invalid_database_url','CONNECTION_STRING_PARSE_ERROR'],
 ['URI malformed near password=secret','PASSWORD_ENCODING_ERROR'],
 ['client password must be a string','CLIENT_CONFIGURATION_ERROR'],
 ['connection timeout for hidden-host','CONNECTION_TIMEOUT'],
 ['unrecognized failure password=secret host=hidden','UNKNOWN_CODELESS_CONNECT_ERROR']
];
for(const [message,expected] of codelessCases){
 const error={name:'Error',message,stack:`${message}\npostgresql://user:secret@hidden/db`};
 assert.equal(classifyCodelessConnectError(error),expected);assert.equal(CODELESS_CONNECT_CATEGORIES.has(expected),true);
 const diagnostic=buildSafeConnectDiagnostic(error);
 assert.deepEqual(diagnostic,{code:'NONE',name:'Error',category:expected});
 assert.deepEqual(Object.keys(diagnostic),['code','name','category']);
 assert.equal(/stack|postgresql|secret|hidden|user:|@/i.test(JSON.stringify(diagnostic)),false);
}

const calls=[];
class Client {
  constructor(config){calls.push(['config',config]);}
  async connect(){calls.push(['connect']);}
  async query(sql,params){calls.push([sql,params]);return{rows:[]};}
  async end(){calls.push(['end']);}
}

(async()=>{
 const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'vitalis-ca-test-'));
 const caCertPath=path.join(tempDir,'supabase-ca.crt');
 const fakeCert=['-----BEGIN CERT'+'IFICATE-----','test-only-not-a-secret','-----END CERT'+'IFICATE-----',''].join('\n');
 fs.writeFileSync(caCertPath,fakeCert,{mode:0o600});
 const url='postgresql://user:secret@example.test/postgres?application_name=preflight&sslmode=verify-full';
 const config=buildVerifiedClientConfig(url,caCertPath);
 assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.ca,fakeCert);
 assert.equal(config.connectionString.includes('sslmode'),false);assert.equal(config.connectionString.includes('application_name=preflight'),true);
 const steps=[];
 const result=await runProductionDbPreflight({connectionString:url,caCertPath,Client,onStep:(step,status)=>steps.push([step,status])});
 assert.deepEqual(steps,PREFLIGHT_STEPS.map(step=>[step,'PASS']));
 assert.equal(result.connected,true);assert.equal(result.tables.length,4);assert.equal(result.tables.every(x=>x.accessible),true);assert.equal(result.targetOrderPreexists,false);
 assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes(fakeCert),false);
 const sql=calls.filter(x=>typeof x[0]==='string').map(x=>x[0]).join('\n');
 assert.equal(REVENUE_TABLES.every(table=>calls.some(x=>x[0]===`select 1 from public.${table} limit 0`&&x[1]===undefined)),true);
 assert.equal(calls.some(x=>x[0]==='select 1 from public.commerce_revenue_orders where order_key = $1 limit 1'&&x[1]?.length===1&&x[1][0]==='99212-298722'),true);
 assert.equal(sql.includes('to_regclass'),false);assert.equal(sql.includes('schema_version'),false);
 assert.equal(/\b(insert|update|delete|create|alter|drop|grant|revoke|call)\b/i.test(sql),false);
 assert.deepEqual(calls.at(-1),['end']);
 const createdConfig=calls.find(x=>x[0]==='config')[1];assert.equal(createdConfig.ssl.rejectUnauthorized,true);assert.equal(createdConfig.ssl.ca,fakeCert);
 class QueryFailureClient extends Client{async query(){const error=new Error('contains super-secret connection data');error.code='XX000';throw error;}}
 await assert.rejects(()=>runProductionDbPreflight({connectionString:url,caCertPath,Client:QueryFailureClient}),error=>categorizePreflightError(error)==='QUERY_FAILED');
 const failedSteps=[];
 await assert.rejects(()=>runProductionDbPreflight({connectionString:url,caCertPath,Client:QueryFailureClient,onStep:(step,status)=>failedSteps.push([step,status])}));
 assert.deepEqual(failedSteps,[['CONNECT','PASS'],['SELECT_1','FAIL']]);
 class ConnectFailureClient extends Client{async connect(){const error=new Error('Tenant or user not found; password=super-secret');error.name='error';error.code='XX000';throw error;}}
 const connectFailureSteps=[];
 await assert.rejects(()=>runProductionDbPreflight({connectionString:url,caCertPath,Client:ConnectFailureClient,onStep:(step,status,error)=>connectFailureSteps.push([step,status,buildSafeConnectDiagnostic(error)])}));
 assert.deepEqual(connectFailureSteps,[['CONNECT','FAIL',{code:'XX000',name:'error',category:'TENANT_OR_USER_NOT_FOUND'}]]);
 assert.equal(JSON.stringify(connectFailureSteps).includes('super-secret'),false);
 assert.throws(()=>buildVerifiedClientConfig(url,''),error=>error.code==='SUPABASE_CA_CERT_PATH_MISSING'&&!error.message.includes('secret'));
 assert.throws(()=>buildVerifiedClientConfig(url,path.join(tempDir,'missing.crt')),error=>error.code==='SUPABASE_CA_CERT_UNREADABLE'&&!error.message.includes(tempDir));
 assert.equal(categorizePreflightError({code:'SUPABASE_CA_CERT_INVALID'}),'SSL_CONFIGURATION_FAILURE');
 fs.rmSync(tempDir,{recursive:true,force:true});
 console.log('Revenue production DB read-only preflight contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
