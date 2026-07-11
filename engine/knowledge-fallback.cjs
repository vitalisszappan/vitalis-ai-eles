const { normalize } = require('./normalizer.cjs');
const STOP = new Set(['egy','hogy','van','vagy','is','lehet','nekem','kerem','szeretnek','mit','milyen','hogyan','szia','udv','ezt','azt','most','mar','kell','kapcsolatban']);
const tokens = (v) => normalize(v).split(' ').filter((t) => t.length >= 3 && !STOP.has(t));
function itemText(item) {
  return normalize([item.title,item.canonicalQuestion,...(item.questionVariants||[]),item.shortAnswer,item.fullAnswer,item.category,item.subcategory||'',...(item.products||[]),...(item.keywords||[]),...(item.intents||[])].join(' '));
}
function lowQuality(item) {
  const q = normalize(item.canonicalQuestion || item.title || '');
  const a = normalize(item.fullAnswer || item.shortAnswer || '');
  if (!q || !a || q.length < 10 || a.length < 12) return true;
  if (/emailben keresem|majd jelzek|milyen neven|hivni fogja|keressen email|rakd kosarba|kaptam ertesitest/.test(a)) return true;
  if (['igen','oke','van','rendben'].includes(a)) return true;
  return false;
}
function searchKnowledge(knowledge, question) {
  const qt = tokens(question);
  return knowledge.filter((i) => !lowQuality(i)).map((item) => {
    const text = itemText(item);
    let score = 0;
    for (const t of qt) if (text.includes(t)) score += t.length * 3;
    if (normalize(item.canonicalQuestion || '').includes(normalize(question))) score += 100;
    return { item, score };
  }).filter((x) => x.score > 0).sort((a,b) => b.score-a.score).slice(0,5);
}
module.exports = { searchKnowledge };
