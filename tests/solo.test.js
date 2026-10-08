// Solo modes and the offline fallback (Firebase not configured).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { makeFake } from './fake-firestore.js';
import { BANK } from '../js/questions.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(root, 'tests/stub-firebase.js');
const bundle = (await build({ entryPoints: [path.join(root, 'js/app.js')], bundle: true, format: 'iife', write: false, logLevel: 'error',
  plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /firebase\.js$/ }, a => a.importer.endsWith('app.js') ? { path: stub } : null); } }] })).outputFiles[0].text;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dom = new JSDOM(html, { url: 'https://friends.example/strata/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document, $ = s => d.querySelector(s);
Object.assign(w, { __fake: makeFake(), __configured: false, confirm: () => true, scrollTo() {} });
w.HTMLElement.prototype.scrollIntoView = () => {}; w.HTMLElement.prototype.focus = function () {};
w.eval(bundle);
const until = async (fn, label) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > 4000) throw new Error('timeout ' + label + ': ' + $('#app').textContent.slice(0, 200)); await sleep(10); } };

await until(() => $('#nm'), 'profile'); $('#nm').value = 'Solo'; $('[data-a=saveprof]').click();
await until(() => $('[data-a=stages]'), 'home');
assert.ok(!$('[data-a=google]'), 'no Google button offline');
// Stage climb: answer everything correctly
$('[data-a=stages]').click(); $('[data-a=topic][data-v=min]').click(); $('[data-a=play][data-v=e]').click();
for (let i = 0; i < 8; i++) {
  await until(() => $('.choice') && !$('.choice[disabled]'), 'question ' + i);
  const item = BANK.find(b => b.q === $('.qtext').textContent);
  [...d.querySelectorAll('.choice')].find(b => b.textContent.slice(1) === item.a).click();
  $('[data-a=next]').click();
}
await until(() => $('.results'), 'results');
assert.ok(/Flawless/.test($('#app').textContent) && $('.results .stars').textContent.startsWith('★★★'));
$('[data-a=home]').click(); await until(() => $('[data-a=mp]'), 'home again');
$('[data-a=stages]').click(); $('[data-a=topic][data-v=min]').click();
assert.ok(!$('[data-a=play][data-v=m]').disabled, 'medium stage unlocked');
console.log('ok  solo stage climb: 3 stars, next stage unlocks');
$('.back').click(); $('.back').click();
await until(() => $('[data-a=mp]'), 'home 3'); $('[data-a=mp]').click();
assert.ok(/not set up/.test($('#app').textContent)); console.log('ok  multiplayer explains it needs Firebase when offline');
$('.back').click(); await until(() => $('[data-a=survival]'), 'home 4'); $('[data-a=survival]').click();
await until(() => $('.choice'), 'survival q'); assert.ok($('#lives').textContent.includes('🪨'));
$('[data-a=quit]').click(); await until(() => $('[data-a=stages]'), 'quit');
const saved = JSON.parse(w.localStorage.getItem('strata-profile-v2'));
assert.ok(saved.xp > 100 && saved.stages.min.e === 3); console.log('ok  progress saved on the device (xp ' + saved.xp + ')');
console.log('\nAll solo tests passed.'); process.exit(0);
