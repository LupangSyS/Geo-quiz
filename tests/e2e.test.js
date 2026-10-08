// Drives the real UI in two simulated phones against an in-memory Firestore.
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
const out = await build({ entryPoints: [path.join(root, 'js/app.js')], bundle: true, format: 'iife', write: false, logLevel: 'error',
  plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /firebase\.js$/ }, a => a.importer.endsWith('app.js') ? { path: stub } : null); } }] });
const bundle = out.outputFiles[0].text;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function phone(fake, uid, search = '') {
  const dom = new JSDOM(html, { url: 'https://friends.example/strata/' + search, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(w, { __fake: fake, __uid: uid, __STRATA_TIMING: { reveal: 60, stall: 3000 }, confirm: () => true, scrollTo() {} });
  w.HTMLElement.prototype.scrollIntoView = () => {}; w.HTMLElement.prototype.focus = function () {};
  w.eval(bundle);
  const d = w.document, $ = s => d.querySelector(s);
  return {
    w, d, $,
    click: s => { const el = $(s); assert.ok(el, 'missing ' + s); assert.ok(!el.disabled, 'disabled ' + s); el.click(); },
    until: async (fn, label, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout: ' + label + '\n' + $('#app').textContent.slice(0, 300)); await sleep(15); } },
    text: () => $('#app').textContent
  };
}
async function newPlayer(p, name) { await p.until(() => p.$('#nm'), 'profile form'); p.$('#nm').value = name; p.click('[data-a=saveprof]'); }
async function play(p, correct) {   // answer every question until results show
  let last = -1;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (p.$('[data-a=rematch]')) return;
    const q = p.$('.qtext');
    const no = p.$('.qno') && p.$('.qno').textContent;
    if (q && no !== last && !p.$('.choice[disabled]')) {
      last = no;
      const item = BANK.find(b => b.q === q.textContent), btns = [...p.d.querySelectorAll('.choice')];
      const right = btns.findIndex(b => b.textContent.slice(1) === item.a);
      const idx = correct ? right : btns.findIndex((b, i) => i !== right);
      await sleep(20 + Math.random() * 30); btns[idx].click();
    }
    await sleep(25);
  }
  throw new Error('never reached results');
}

const fake = makeFake();

// ---------- DUEL ----------
const host = phone(fake, 'host-uid');
await newPlayer(host, 'Hana');
await host.until(() => host.$('[data-a=mp]'), 'home');
host.click('[data-a=mp]'); host.click('[data-a=mpmode][data-v=duel]'); host.click('[data-a=mpcreate]');
await host.until(() => host.$('.code'), 'lobby');
const code = host.$('.code').textContent;
assert.match(code, /^[A-Z2-9]{5}$/);
assert.ok(host.$('.qrbox svg'), 'QR shown'); assert.ok(host.text().includes('?room=' + code), 'link shown');
assert.ok(host.$('[data-a=start]').disabled, 'cannot start alone');

const guest = phone(fake, 'guest-uid', '?room=' + code);          // opens the shared link
await guest.until(() => guest.$('#nm'), 'guest profile form');
assert.ok(guest.text().includes(code), 'guest told which room');
guest.$('#nm').value = 'Gus'; guest.click('[data-a=saveprof]');
await guest.until(() => guest.$('.code'), 'guest in lobby');
await host.until(() => !host.$('[data-a=start]').disabled, 'host can start');
assert.ok(host.text().includes('Gus'));
host.click('[data-a=start]');
await Promise.all([host.until(() => host.$('.qtext'), 'host quiz'), guest.until(() => guest.$('.qtext'), 'guest quiz')]);
await Promise.all([play(host, true), play(guest, false)]);
await Promise.all([host.until(() => host.$('[data-a=rematch]'), 'host results'), guest.until(() => guest.$('[data-a=rematch]'), 'guest results')]);
assert.match(host.$('h2').textContent, /You win/); assert.match(guest.$('h2').textContent, /You lost/);
console.log('ok  duel through the UI: Hana beats Gus');

// ---------- TEAM LOBBY: capacity + switching ----------
const h2 = phone(fake, 'h2');
await newPlayer(h2, 'Tess'); await h2.until(() => h2.$('[data-a=mp]'), 'home');
h2.click('[data-a=mp]'); h2.click('[data-a=mpmode][data-v=team]'); h2.click('[data-a=mts][data-v=3]'); h2.click('[data-a=mpcreate]');
await h2.until(() => h2.$('.teams'), 'team lobby');
const tcode = h2.$('.code').textContent;
const mates = [];
for (const n of ['Ada', 'Bo']) { const p = phone(fake, 'tm-' + n, '?room=' + tcode); await newPlayer(p, n); await p.until(() => p.$('.teams'), 'mate lobby'); mates.push(p); }
await h2.until(() => h2.d.querySelectorAll('.prow').length === 3, '3 players');
const sizes = () => [...h2.d.querySelectorAll('.team')].map(t => t.querySelectorAll('.prow').length);
assert.deepEqual(sizes().sort(), [1, 2]);
console.log('ok  team lobby balances players', sizes());

// ---------- DEATHMATCH with 3 players, one is hopeless ----------
const hd = phone(fake, 'hd'); await newPlayer(hd, 'Dee'); await hd.until(() => hd.$('[data-a=mp]'), 'home');
hd.click('[data-a=mp]'); hd.click('[data-a=mpmode][data-v=death]'); hd.click('[data-a=mpcreate]');
await hd.until(() => hd.$('.code'), 'death lobby');
const dcode = hd.$('.code').textContent;
const dp = [hd];
for (const n of ['Eve', 'Fox']) { const p = phone(fake, 'd-' + n, '?room=' + dcode); await newPlayer(p, n); await p.until(() => p.$('.code'), 'death join'); dp.push(p); }
await hd.until(() => !hd.$('[data-a=start]').disabled, 'death start');
hd.click('[data-a=start]');
await Promise.all(dp.map(p => p.until(() => p.$('.qtext'), 'death quiz')));
await Promise.all([play(dp[0], true), play(dp[1], true), play(dp[2], false)]);
await Promise.all(dp.map(p => p.until(() => p.$('[data-a=rematch]'), 'death results')));
assert.ok(dp[2].text().includes('Out on Q'), 'Fox eliminated');
assert.ok(dp[2].text().includes('Out on Q3'), 'Fox is out on his third wrong answer');
assert.match(dp[0].$('h2').textContent + dp[1].$('h2').textContent, /Last one standing|placed #1/);
assert.match(dp[2].$('h2').textContent, /placed #3/);
console.log('ok  deathmatch through the UI: Fox eliminated on question 3');

// ---------- errors & offline-ish screens ----------
const lost = phone(fake, 'lost', '?room=ZZZZZ'); await newPlayer(lost, 'Lo');
await lost.until(() => /Room not found/.test(lost.text()), 'not found');
console.log('ok  unknown room code shows a clear message');
const late = phone(fake, 'late', '?room=' + code); await newPlayer(late, 'Late');
await late.until(() => /already started|finished/.test(late.text()), 'late join');
console.log('ok  joining a finished game is refused');
console.log('\nAll UI tests passed.'); process.exit(0);
