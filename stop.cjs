const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pidPath = path.join(__dirname, 'chatbot.pid');
if (!fs.existsSync(pidPath)) {
  console.log('Nem találtam futó Vitalis chatbot folyamatot.');
  process.exit(0);
}
const pid = fs.readFileSync(pidPath, 'utf8').trim();
try {
  execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'inherit' });
} catch {
  console.log('A folyamat valószínűleg már nem fut.');
}
try { fs.unlinkSync(pidPath); } catch {}
