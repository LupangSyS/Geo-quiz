import assert from 'node:assert/strict';
import { makeFake } from './fake-firestore.js';
import { createRoom, joinRoom, RoomSession, TIMING, buildQuestionIds, pointsFor } from '../js/rooms.js';
import { BYID, BANK } from '../js/questions.js';

TIMING.reveal = 30; TIMING.stall = 400;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting for condition'); await sleep(10); } };

// A scripted player: answers every question using `strategy(question, index) -> boolean (correct?)`
function bot(F, name, code, strategy) {
  const me = { uid: 'u_' + name, name, avatar: '🪨', guest: true };
  const s = new RoomSession(F, me, code, async sess => {
    const r = sess.room; if (!r || r.status !== 'playing') return;
    const m = sess.mine, q = r.qIndex;
    if (!m || m.lastQ === q || m.alive === false || m.left || bot.busy.has(name + q)) return;
    bot.busy.add(name + q);
    const ok = strategy(BYID.get(r.qIds[q]), q);
    await sleep(5 + Math.random() * 20);
    await sess.answer(q, ok ? 0 : 1, ok, 1000, ok ? pointsFor('e', .5) : 0);
  });
  return { me, s };
}
bot.busy = new Set();

async function run(mode, names, strategies, opts = {}) {
  const { F } = makeFake();
  const host = { uid: 'u_' + names[0], name: names[0], avatar: '🪨', guest: true };
  const code = await createRoom(F, host, { mode, count: opts.count || 6, teamSize: 3, topic: 'all', diff: 'r' });
  const bots = [];
  for (let i = 0; i < names.length; i++) {
    const r = await joinRoom(F, { uid: 'u_' + names[i], name: names[i], avatar: '🪨' }, code);
    assert.ok(!r.error, 'join ' + names[i] + ': ' + r.error);
    bots.push(bot(F, names[i], code, strategies[i]));
  }
  bots.forEach(b => b.s.start());
  await until(() => bots.every(b => b.s.ready));
  const h = bots[0].s;
  assert.equal(h.isHost, true); assert.equal(bots[1].s.isHost, false);
  if (mode === 'team') { await until(() => bots.every(b => b.s.mine)); await bots[2].s.setTeam(1); await bots[1].s.setTeam(0); await until(() => h.teamMembers(0).length === 2 && h.teamMembers(1).length === 2); }
  await until(() => !h.canStart());
  await h.startGame();
  await until(() => h.room.status === 'finished', 15000);
  await sleep(60);
  bots.forEach(b => b.s.stop());
  return { bots, h, code };
}
const always = () => true, never = () => false;

// ---- question building ----
{
  const ids = buildQuestionIds({ mode: 'death', topic: 'all', diff: 'r' });
  assert.equal(ids.length, 60); assert.equal(new Set(ids).size, 60);
  const ds = ids.map(i => BYID.get(i).d).join('');
  assert.ok(ds.indexOf('m') > ds.indexOf('e') && ds.lastIndexOf('h') === ds.length - 1, 'rising order');
  const v = buildQuestionIds({ mode: 'duel', topic: 'volc', diff: 'h', count: 20 });
  assert.equal(v.length, 8); assert.ok(v.every(i => i.startsWith('volc-h')));
  console.log('ok  question building');
}

// ---- duel ----
{
  const { bots, h } = await run('duel', ['ann', 'bob'], [always, never]);
  const res = h.myResult();
  assert.equal(h.room.qIndex, 5);
  assert.equal(res.won, true);
  assert.equal(bots[1].s.myResult().won, false);
  assert.equal(h.ranking()[0].name, 'ann');
  console.log('ok  duel: ann beats bob after 6 questions');
}

// ---- duel: tie ----
{
  const { bots } = await run('duel', ['ann', 'bob'], [always, always]);
  assert.ok(bots[0].s.myResult().rank >= 1);
  console.log('ok  duel with equal scores finishes');
}

// ---- team battle (3 v 3 capacity, 4 players split 2/2) ----
{
  const { bots, h } = await run('team', ['a1', 'a2', 'b1', 'b2'], [always, always, never, never]);
  // a1 auto-assigned team 0; a2 auto team 1 (balanced) then moved? check by totals
  const t = h.teamTotals();
  assert.equal(t[0].members.length + t[1].members.length, 4);
  assert.ok(t[0].score > t[1].score, 'team of a1+a2 outscores b1+b2');
  assert.deepEqual(bots.map(b => b.s.myResult().won), [true, true, false, false]);
  console.log('ok  team battle finishes with team totals', t.map(x => x.score).join(' vs '));
}

// ---- deathmatch: weak players eliminated, last standing wins ----
{
  const { bots, h } = await run('death', ['ann', 'bob', 'cy', 'di'], [always, never, never, (q, i) => i % 2 === 0], { count: 30 });
  const rank = h.ranking();
  assert.equal(rank[0].name, 'ann');
  assert.ok(h.room.qIndex < 29, 'ended early when one survivor was left (q=' + h.room.qIndex + ')');
  const bob = h.players.find(p => p.name === 'bob');
  assert.equal(bob.alive, false); assert.equal(bob.wrong, 3);
  assert.equal(bots[0].s.myResult().won, true);
  console.log('ok  deathmatch: ann survives, ended at question', h.room.qIndex + 1);
}

// ---- stalled player: room still advances ----
{
  const { F } = makeFake();
  const host = { uid: 'u_a', name: 'a', avatar: '🪨' };
  const code = await createRoom(F, host, { mode: 'duel', count: 3 });
  await joinRoom(F, host, code); await joinRoom(F, { uid: 'u_b', name: 'b', avatar: '🪨' }, code);
  const a = bot(F, 'a', code, always); a.s.start();
  const ghost = new RoomSession(F, { uid: 'u_b', name: 'b' }, code, () => {}); ghost.start();   // never answers
  await until(() => a.s.ready); await a.s.startGame();
  await until(() => a.s.room.status === 'finished', 8000);
  a.s.stop(); ghost.stop();
  console.log('ok  stalled opponent does not freeze the room');
}

// ---- join rules ----
{
  const { F } = makeFake();
  const host = { uid: 'h', name: 'h', avatar: '🪨' };
  const code = await createRoom(F, host, { mode: 'duel', count: 3 });
  assert.ok(!(await joinRoom(F, host, code)).error);
  assert.ok(!(await joinRoom(F, { uid: 'x', name: 'x', avatar: '🪨' }, code)).error);
  assert.equal((await joinRoom(F, { uid: 'y', name: 'y', avatar: '🪨' }, code)).error, 'full');
  assert.equal((await joinRoom(F, host, 'ZZZZZ')).error, 'notfound');
  assert.ok(!(await joinRoom(F, host, code.toLowerCase())).error, 'rejoin is allowed, case-insensitive');
  const tc = await createRoom(F, host, { mode: 'team', teamSize: 3, count: 3 });
  for (let i = 0; i < 6; i++) assert.ok(!(await joinRoom(F, { uid: 't' + i, name: 't' + i, avatar: '🪨' }, tc)).error);
  assert.equal((await joinRoom(F, { uid: 't7', name: 't7', avatar: '🪨' }, tc)).error, 'full');
  const ps = (await F.getDocs(F.collection(F.db, 'rooms', tc, 'players'))).docs.map(d => d.data());
  assert.equal(ps.filter(p => p.team === 0).length, 3); assert.equal(ps.filter(p => p.team === 1).length, 3);
  console.log('ok  join rules: capacity, rejoin, teams balance 3/3');
}
console.log('\nAll room tests passed.');
process.exit(0);
