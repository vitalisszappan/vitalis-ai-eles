const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('public/widget.html');
const widget = read('public/widget.js');
const embed = read('public/embed.js');
const publicUi = [html, widget, embed, read('public/demo.html')].join('\n');

assert.match(html, /<h1>Vitalis AI Asszisztens<\/h1>/);
assert.match(html, /Mesterséges intelligenciával működő virtuális asszisztens, nem élő ügyintéző\./);
assert.match(html, /Üdvözöllek! A Vitalis mesterséges intelligenciával működő virtuális asszisztense vagyok\./);
assert.doesNotMatch(publicUi, /Kérdezd a készítőt|valós idejű chat|Azonnali válaszok|Szalacsi Zoltán vagyok/);

assert.match(widget, /card\.target = '_blank'/);
assert.match(widget, /card\.rel = 'noopener noreferrer'/);
assert.match(widget, /url\.protocol === 'https:'/);
assert.match(widget, /host === 'vitalis-szappan\.hu'/);
assert.match(widget, /vitalis-chat-state\/v2/);
assert.match(widget, /24 \* 60 \* 60 \* 1000/);
assert.match(widget, /messages\.slice\(-MAX_STORED_MESSAGES\)/);
assert.match(widget, /history\.length = 0/);
assert.match(widget, /window\.confirm/);
assert.match(widget, /localStorage\.removeItem\(STORAGE_KEY\)/);
assert.match(widget, /event\.source !== window\.parent/);
assert.match(embed, /event\.source !== frame\.contentWindow \|\| event\.origin !== base/);
assert.match(embed, /vitalis-chat-state-ready/);
assert.match(embed, /restoreFailed: true/);
assert.match(embed, /src="about:blank"/);
assert(embed.indexOf("window.addEventListener('message'") < embed.indexOf('frame.src = `${base}/widget`'), 'A parent listenernek az iframe betöltése előtt kell elkészülnie.');
assert.match(embed, /open: chatOpen/);
assert.match(embed, /startupStateResult \|\| readState\(\)/);

assert.doesNotMatch(widget + embed, /[?&](?:session|sessionId|session_id)=/);
assert.doesNotMatch(widget + embed, /ADMIN_TOKEN|service[-_]?role|SUPABASE/i);

console.log('Chat AI-átláthatósági és állapotmegőrzési tesztek: OK');
