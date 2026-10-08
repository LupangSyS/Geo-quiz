// Multiplayer rooms. No DOM and no direct Firebase import: the Firestore functions
// are injected as `F`, so the same code runs in the browser and in the Node tests.
import { BANK } from './questions.js';

export const MODES = {
  duel:  { id: 'duel',  name: 'Duel',        icon: '⚔️', min: 2, blurb: '1 vs 1. Highest score after the last question wins.' },
  team:  { id: 'team',  name: 'Team battle', icon: '🛡️', min: 2, blurb: 'Two teams of 3 to 5. Every member adds to the team score.' },
  death: { id: 'death', name: 'Deathmatch',  icon: '☠️', min: 2, blurb: 'Any number of players. Three wrong answers and you are out. Last one standing wins.' }
};
export const MP_TIME = 20;        // seconds per question
export const WRONG_LIMIT = 3;
export const TIMING = Object.assign({ reveal: 3200, stall: (MP_TIME + 8) * 1000 }, globalThis.__STRATA_TIMING);   // ms (tests shrink these)
const DAY = 24 * 3600 * 1000;

export const pointsFor = (diff, fractionLeft) =>
  ({ e: 10, m: 15, h: 20 }[diff] || 10) + Math.round(10 * Math.max(0, Math.min(1, fractionLeft)));

const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const genCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

/** Ordered list of question ids for a room. */
export function buildQuestionIds({ mode, topic = 'all', diff = 'r', count }) {
  const pool = BANK.filter(q => (topic === 'all' || q.t === topic) && (diff === 'r' || q.d === diff));
  const n = Math.min(count || (mode === 'death' ? 60 : 10), pool.length);
  if (diff !== 'r') return shuffle(pool).slice(0, n).map(q => q.id);
  const by = { e: shuffle(pool.filter(q => q.d === 'e')), m: shuffle(pool.filter(q => q.d === 'm')), h: shuffle(pool.filter(q => q.d === 'h')) };
  const want = { e: Math.round(n * .4), m: Math.round(n * .35) }; want.h = n - want.e - want.m;
  const out = [], used = new Set();
  for (const d of ['e', 'm', 'h']) for (const q of by[d].slice(0, want[d])) { out.push(q); used.add(q.id); }
  if (out.length < n) for (const q of shuffle(pool.filter(q => !used.has(q.id)))) { if (out.length >= n) break; out.push(q); }
  out.sort((a, b) => 'emh'.indexOf(a.d) - 'emh'.indexOf(b.d));
  return out.map(q => q.id);
}

const newPlayer = (me, team) => ({
  uid: me.uid, name: String(me.name).slice(0, 18), avatar: me.avatar, guest: !!me.guest, team,
  score: 0, correct: 0, wrong: 0, totalMs: 0, alive: true, left: false, lastQ: -1, lastOk: false, lastIdx: -1,
  joinedAt: Date.now(), expireAt: new Date(Date.now() + DAY)
});

export async function createRoom(F, me, opts) {
  const qIds = buildQuestionIds(opts);
  for (let i = 0; i < 6; i++) {
    const code = genCode();
    const ref = F.doc(F.db, 'rooms', code);
    if ((await F.getDoc(ref)).exists()) continue;
    await F.setDoc(ref, {
      code, mode: opts.mode, hostId: me.uid, status: 'lobby', topic: opts.topic || 'all', diff: opts.diff || 'r',
      qCount: qIds.length, qIds, qIndex: 0, teamSize: opts.mode === 'team' ? (opts.teamSize || 3) : 0,
      wrongLimit: WRONG_LIMIT, createdAt: Date.now(), expireAt: new Date(Date.now() + DAY)
    });
    return code;
  }
  throw new Error('Could not create a room. Try again.');
}

/** Join (or rejoin) a room. Returns {code, room} or {error}. */
export async function joinRoom(F, me, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return { error: 'notfound' };
  const rs = await F.getDoc(F.doc(F.db, 'rooms', code));
  if (!rs.exists()) return { error: 'notfound' };
  const room = rs.data();
  const pref = F.doc(F.db, 'rooms', code, 'players', me.uid);
  const ps = await F.getDoc(pref);
  if (ps.exists()) {
    const p = ps.data();
    if (p.left && room.status !== 'lobby') return { error: room.status === 'finished' ? 'finished' : 'started' };
    if (p.left || p.name !== me.name || p.avatar !== me.avatar) await F.updateDoc(pref, { left: false, name: String(me.name).slice(0, 18), avatar: me.avatar });
    return { code, room };
  }
  if (room.status !== 'lobby') return { error: room.status === 'finished' ? 'finished' : 'started' };
  const list = (await F.getDocs(F.collection(F.db, 'rooms', code, 'players'))).docs.map(d => d.data());
  let team = null;
  if (room.mode === 'duel' && list.length >= 2) return { error: 'full' };
  if (room.mode === 'team') {
    const c = [0, 0]; list.forEach(p => { if (p.team === 0 || p.team === 1) c[p.team]++; });
    const cap = room.teamSize || 3;
    team = c[0] <= c[1] ? 0 : 1;
    if (c[team] >= cap) { team = 1 - team; if (c[team] >= cap) return { error: 'full' }; }
  }
  await F.setDoc(pref, newPlayer(me, team));
  return { code, room };
}

export const isIn = p => p.alive !== false && !p.left;

export class RoomSession {
  constructor(F, me, code, onChange) {
    Object.assign(this, { F, me, code, onChange, room: null, players: [], gotRoom: false, gotPlayers: false, gone: false, closed: false, error: null });
    this._timer = null; this._key = ''; this._seenQ = -1; this._seenAt = 0;
  }
  start() {
    const { F } = this;
    this.rref = F.doc(F.db, 'rooms', this.code);
    this.pref = F.doc(F.db, 'rooms', this.code, 'players', this.me.uid);
    this.u1 = F.onSnapshot(this.rref, s => { this.gotRoom = true; this.gone = !s.exists(); this.room = s.exists() ? s.data() : null; this._changed(); }, e => { this.error = e; this._changed(); });
    this.u2 = F.onSnapshot(F.collection(F.db, 'rooms', this.code, 'players'), s => {
      this.gotPlayers = true;
      this.players = s.docs.map(d => d.data()).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      this._changed();
    }, e => { this.error = e; this._changed(); });
  }
  stop() { this.closed = true; clearTimeout(this._timer); try { this.u1 && this.u1(); this.u2 && this.u2(); } catch (e) {} }
  _changed() { if (this.closed) return; this._schedule(); this.onChange(this); }

  get mine() { return this.players.find(p => p.uid === this.me.uid) || null; }
  get isHost() { return !!this.room && this.room.hostId === this.me.uid; }
  get ready() { return this.gotRoom && this.gotPlayers; }
  get kicked() { return this.ready && !!this.room && !this.mine; }
  teamMembers(t) { return this.players.filter(p => p.team === t); }

  /** Players the room still waits for on each question. */
  required() { return this.players.filter(isIn); }

  canStart() {
    const r = this.room; if (!r) return 'No room';
    const n = this.players.length;
    if (r.mode === 'duel') return n === 2 ? '' : 'Waiting for one opponent';
    if (r.mode === 'team') return this.teamMembers(0).length && this.teamMembers(1).length ? '' : 'Each team needs at least one player';
    return n >= 2 ? '' : 'Need at least 2 players';
  }
  async startGame() {
    if (!this.isHost || this.canStart() || this.room.status !== 'lobby') return;
    await this.F.updateDoc(this.rref, { status: 'playing', qIndex: 0, qStartedAt: Date.now() });
  }
  async setTeam(t) {
    const m = this.mine; if (!m || this.room.status !== 'lobby' || m.team === t) return false;
    if (this.teamMembers(t).length >= (this.room.teamSize || 3)) return false;
    m.team = t; await this.F.updateDoc(this.pref, { team: t }); return true;
  }
  async kick(uid) { if (this.isHost && uid !== this.me.uid) await this.F.deleteDoc(this.F.doc(this.F.db, 'rooms', this.code, 'players', uid)); }

  async answer(qIndex, idx, ok, ms, points) {
    const m = this.mine; if (!m || !this.room || this.room.qIndex !== qIndex || m.lastQ === qIndex) return;
    const wrong = m.wrong + (ok ? 0 : 1);
    const patch = { lastQ: qIndex, lastOk: ok, lastIdx: idx, score: m.score + (ok ? points : 0), correct: m.correct + (ok ? 1 : 0), wrong, totalMs: (m.totalMs || 0) + ms };
    if (this.room.mode === 'death' && wrong >= (this.room.wrongLimit || WRONG_LIMIT)) { patch.alive = false; patch.diedAt = qIndex; }
    Object.assign(m, patch);
    await this.F.updateDoc(this.pref, patch);
  }

  async leave() {
    const room = this.room, host = this.isHost; this.stop();
    try {
      if (!room) return;
      if (room.status === 'lobby') {
        if (host) await this.F.deleteDoc(this.rref);
        else await this.F.deleteDoc(this.pref);
      } else if (room.status === 'playing') await this.F.updateDoc(this.pref, { left: true, alive: false, diedAt: room.qIndex });
    } catch (e) {}
  }

  // ---- advancing questions: any player's client may do it; a transaction keeps it single ----
  shouldFinish() {
    const r = this.room, act = this.players.filter(p => !p.left);
    if (r.mode === 'duel') return act.length < 2;
    if (r.mode === 'team') return !act.some(p => p.team === 0) || !act.some(p => p.team === 1);
    return this.players.filter(isIn).length <= 1;
  }
  _schedule() {
    const r = this.room;
    if (!this.ready || !r || r.status !== 'playing') { clearTimeout(this._timer); this._key = ''; return; }
    const q = r.qIndex;
    if (this._seenQ !== q) { this._seenQ = q; this._seenAt = Date.now(); }
    const req = this.required(), done = req.every(p => p.lastQ === q);
    const key = q + (done ? 'd' : 'w') + req.length;
    if (key === this._key) return;
    clearTimeout(this._timer); this._key = key;
    const delay = done ? TIMING.reveal : Math.max(0, this._seenAt + TIMING.stall - Date.now());
    this._timer = setTimeout(() => this._advance(q), delay + Math.random() * 250);
  }
  async _advance(q) {
    if (this.closed) return;
    const finish = this.shouldFinish();
    try {
      await this.F.runTransaction(this.F.db, async tx => {
        const s = await tx.get(this.rref);
        if (!s.exists()) return;
        const d = s.data();
        if (d.status !== 'playing' || d.qIndex !== q) return;
        if (finish || q + 1 >= d.qIds.length) tx.update(this.rref, { status: 'finished', finishedAt: Date.now() });
        else tx.update(this.rref, { qIndex: q + 1, qStartedAt: Date.now() });
      });
    } catch (e) { this._key = ''; setTimeout(() => this._schedule(), 1500); }
  }

  // ---- results ----
  ranking() {
    const ps = this.players.slice(), mode = this.room.mode;
    if (mode === 'death') ps.sort((a, b) => {
      if (isIn(a) !== isIn(b)) return isIn(a) ? -1 : 1;
      if (!isIn(a)) { const d = (b.diedAt ?? -1) - (a.diedAt ?? -1); if (d) return d; }
      return b.score - a.score || a.totalMs - b.totalMs;
    });
    else ps.sort((a, b) => b.score - a.score || b.correct - a.correct || a.totalMs - b.totalMs);
    return ps;
  }
  teamTotals() {
    return [0, 1].map(t => { const m = this.teamMembers(t); return { team: t, score: m.reduce((s, p) => s + p.score, 0), correct: m.reduce((s, p) => s + p.correct, 0), members: m }; });
  }
  /** {won, draw, rank, winnerUid?, winnerTeam?} for the current player. */
  myResult() {
    const r = this.room, rank = this.ranking(), me = this.mine;
    if (!me) return { won: false, draw: false, rank: 0 };
    const idx = rank.findIndex(p => p.uid === me.uid) + 1;
    if (r.mode === 'team') {
      const [a, b] = this.teamTotals();
      if (a.score === b.score) return { won: false, draw: true, rank: idx, winnerTeam: null };
      const wt = a.score > b.score ? 0 : 1;
      return { won: me.team === wt, draw: false, rank: idx, winnerTeam: wt };
    }
    if (r.mode === 'duel') {
      const [x, y] = rank;
      const draw = !!y && x.score === y.score && x.correct === y.correct && x.totalMs === y.totalMs;
      return { won: !draw && x.uid === me.uid, draw, rank: idx, winnerUid: draw ? null : x.uid };
    }
    return { won: idx === 1, draw: false, rank: idx, winnerUid: rank[0].uid };
  }
}
