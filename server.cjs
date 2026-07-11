const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const KNOWLEDGE_PATH = path.join(DATA_DIR, 'knowledge.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const PORT = Number(process.env.PORT || 3218);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
for (const dir of [DATA_DIR, BACKUP_DIR, LOG_DIR]) fs.mkdirSync(dir, { recursive: true });

let knowledge = [];
let loadedAt = null;
function loadKnowledge() {
  const raw = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
  const items = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : null;
  if (!items) throw new Error('A knowledge.json nem megfelelő formátumú.');
  knowledge = items.filter((x) => x && typeof x === 'object' && x.id);
  loadedAt = new Date().toISOString();
}
loadKnowledge();

const { ExpertRuleEngine } = require('./engine/rule-engine.cjs');
const { createAnswer } = require('./engine/answer-service.cjs');
const RULE_PATH = path.join(DATA_DIR, 'rules', 'expert-rules.json');
const ruleEngine = new ExpertRuleEngine(RULE_PATH);

function logGap(question, score, history) {
  fs.appendFileSync(path.join(LOG_DIR,'knowledge-gaps.jsonl'), JSON.stringify({ at:new Date().toISOString(), question, score, history:history.slice(-5) })+'\n');
}

function sendJson(res,status,obj){const body=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(body);}
function serveFile(res,filePath,type,cache='no-store'){fs.readFile(filePath,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':type,'Cache-Control':cache,'Access-Control-Allow-Origin':'*'});res.end(data);});}
function parseBody(req,limit=5e6){return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>limit)reject(new Error('Túl nagy kérés.'));});req.on('end',()=>resolve(body));req.on('error',reject);});}

const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);try{
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
  if(req.method==='POST'&&url.pathname==='/api/chat'){const parsed=JSON.parse(await parseBody(req)||'{}');const question=String(parsed.message||parsed.question||'').trim();if(!question)return sendJson(res,400,{success:false,answer:'Kérlek, írd be a kérdésedet.'});const history=Array.isArray(parsed.history)?parsed.history:[];const result=createAnswer({ question, history, knowledge, ruleEngine, logGap });return sendJson(res,200,{success:true,...result,matchedKnowledgeIds:result.ids});}
  if(req.method==='POST'&&url.pathname==='/api/admin/import'){
    if(!ADMIN_TOKEN) return sendJson(res,503,{ok:false,error:'Az admin import éles környezetben nincs engedélyezve.'});
    const supplied = String(req.headers['x-admin-token'] || '').trim();
    if(supplied !== ADMIN_TOKEN) return sendJson(res,401,{ok:false,error:'Hibás admin kulcs.'});
    const parsed=JSON.parse(await parseBody(req)||'{}');const items=Array.isArray(parsed)?parsed:Array.isArray(parsed.items)?parsed.items:null;if(!items)return sendJson(res,400,{ok:false,error:'A fájl nem érvényes knowledge.json.'});const valid=items.filter(x=>x&&typeof x==='object'&&x.id&&(x.fullAnswer||x.shortAnswer));if(!valid.length)return sendJson(res,400,{ok:false,error:'Nem található érvényes tudáselem.'});const stamp=new Date().toISOString().replace(/[:.]/g,'-');if(fs.existsSync(KNOWLEDGE_PATH))fs.copyFileSync(KNOWLEDGE_PATH,path.join(BACKUP_DIR,`knowledge-${stamp}.json`));fs.writeFileSync(KNOWLEDGE_PATH,JSON.stringify(valid,null,2),'utf8');loadKnowledge();return sendJson(res,200,{ok:true,items:knowledge.length,loadedAt});}
  if(req.method==='GET'&&url.pathname==='/api/status')return sendJson(res,200,{ok:true,version:'Éles 1.8',items:knowledge.length,loadedAt,port:PORT,rules:ruleEngine.status()});
  if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html'||url.pathname==='/widget'))return serveFile(res,path.join(PUBLIC_DIR,'widget.html'),'text/html; charset=utf-8');
  if(req.method==='GET'&&url.pathname==='/demo')return serveFile(res,path.join(PUBLIC_DIR,'demo.html'),'text/html; charset=utf-8');
  if(req.method==='GET'&&url.pathname==='/admin')return serveFile(res,path.join(PUBLIC_DIR,'admin.html'),'text/html; charset=utf-8');
  const staticMap={ '/embed.js':['embed.js','text/javascript; charset=utf-8'], '/widget.js':['widget.js','text/javascript; charset=utf-8'], '/admin.js':['admin.js','text/javascript; charset=utf-8'], '/widget.css':['widget.css','text/css; charset=utf-8'], '/admin.css':['admin.css','text/css; charset=utf-8'], '/vitalis-logo.jpg':['vitalis-logo.jpg','image/jpeg'] };
  if(req.method==='GET'&&staticMap[url.pathname]){const [f,t]=staticMap[url.pathname];return serveFile(res,path.join(PUBLIC_DIR,f),t,'no-store');}
  res.writeHead(404);res.end('Not found');
}catch(e){console.error(e);sendJson(res,500,{ok:false,success:false,error:e.message,answer:'Technikai hiba történt. Kérlek, próbáld meg újra.'});}});
server.on('error',err=>{if(err.code==='EADDRINUSE')console.error(`A ${PORT}-es port foglalt. Zárd be a korábbi chatbot fekete ablakát.`);else console.error(err);process.exit(1);});
server.listen(PORT,HOST,()=>{fs.writeFileSync(path.join(ROOT,'chatbot.pid'),String(process.pid));console.log('==========================================');console.log(' Kérdezd a készítőt! – Éles 1.8 elindult');console.log(` Chat:  http://localhost:${PORT}/widget`);console.log(` Demo:  http://localhost:${PORT}/demo`);console.log(` Admin: http://localhost:${PORT}/admin`);console.log(` Tudaselemek: ${knowledge.length}`);console.log('==========================================');});

function cleanupPid(){ try { const pidPath=path.join(ROOT,'chatbot.pid'); if(fs.existsSync(pidPath)) fs.unlinkSync(pidPath); } catch {} }
process.on('exit', cleanupPid);
process.on('SIGINT',()=>{cleanupPid();process.exit(0);});
process.on('SIGTERM',()=>{cleanupPid();process.exit(0);});
