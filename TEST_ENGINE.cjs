const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const cwd = __dirname;
const child = spawn(process.execPath, ['server.cjs'], { cwd, env: {...process.env, PORT:'3299'}, stdio:['ignore','pipe','pipe'] });
function post(message, history=[]) { return new Promise((resolve,reject)=>{ const data=JSON.stringify({message,history}); const req=http.request({hostname:'127.0.0.1',port:3299,path:'/api/chat',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve(JSON.parse(b)));});req.on('error',reject);req.end(data);}); }
(async()=>{await new Promise(r=>setTimeout(r,500)); const tests=[
 ['Viszket a fejbőröm',[],/fejbőrproblémánál|viszketés|korpásodás/i],
 ['Mennyi a szállítási idő?',[],/2 munkanap/i],
 ['Viszket a fejbőröm',[{role:'user',content:'Mennyi a szállítási idő?'}],/fejbőrproblémánál|viszketés|korpásodás/i],
 ['Mire javaslod a Dermavital krémet?',[],/száraz, érzékeny|ekcémára hajlamos/i],
 ['És milyen gyakran használjam?',[{role:'user',content:'Mire javaslod a Dermavital krémet?'}],/vékony rétegben|kis bőrfelületen/i],
 ['Bőrproblémával kapcsolatban kérdeznék.',[],/Melyik bőrproblémáról/i]
 ];
 let failed=0; for(const [q,h,re] of tests){const out=await post(q,h);const ok=re.test(out.answer||'');console.log(ok?'OK':'HIBA','-',q,'=>',out.answer);if(!ok)failed++;}
 child.kill(); process.exit(failed?1:0);
})().catch(e=>{console.error(e);child.kill();process.exit(1)});
