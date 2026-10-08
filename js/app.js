import { TOPICS, TOPIC, BANK, BYID } from './questions.js';
import { configured, F, A } from './firebase.js';
import { MODES, MP_TIME, WRONG_LIMIT, createRoom, joinRoom, RoomSession, pointsFor, isIn } from './rooms.js';
import { qrSvg } from './qr.js';

/* ============ constants & helpers ============ */
const DIFF = { e: { name: 'Easy', xp: 10, cls: '' }, m: { name: 'Medium', xp: 20, cls: 'm' }, h: { name: 'Hard', xp: 30, cls: 'h' } };
const TIME = 25, STAGE_PASS = 5;
const AVATARS = ['🪨', '💎', '🌋', '🦴', '🐚', '⛏️', '🧭', '🔬', '🏔️', '🌊', '🦕', '🧲'];
const RANKS = ['Grain of Sand', 'Pebble', 'Cobble', 'Boulder', 'Outcrop', 'Ridge', 'Mesa', 'Mountain', 'Massif', 'Craton', 'Supercontinent'];
const TEAM = [{ name: 'Team Basalt', cls: 'tA' }, { name: 'Team Granite', cls: 'tB' }];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const levelOf = xp => Math.floor(Math.sqrt((xp || 0) / 50)) + 1;
const xpFor = l => 50 * (l - 1) * (l - 1);
const rankOf = l => RANKS[Math.min(l - 1, RANKS.length - 1)];
const starStr = (n, max = 3) => `<span class="stars" aria-label="${n} of ${max} stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(max - n)}</span></span>`;
const starsFor = (s, n) => s >= n ? 3 : s >= n - 1 ? 2 : s >= STAGE_PASS ? 1 : 0;
const roomLink = code => `${location.origin}${location.pathname}?room=${code}`;
const prep = q => { const ch = shuffle([q.a, ...q.w]); return { ...q, ch, ci: ch.indexOf(q.a) }; };
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }

/* ============ profile storage ============ */
const LS = 'strata-profile-v2';
let P = null;
let U = { uid: null, anon: true, gname: '' };
let ONLINE = false;
const blank = (name, avatar) => ({ name, avatar, xp: 0, created: Date.now(), wins: 0, played: 0, recentRooms: [],
  stats: { answered: 0, correct: 0, bestStreak: 0, byTopic: {} }, stages: {}, bestSurvival: 0, rounds: 0 });
function norm(p) {
  if (!p || !p.name) return null;
  const o = Object.assign(blank(p.name, p.avatar || '🪨'), p);
  o.stats = Object.assign({ answered: 0, correct: 0, bestStreak: 0, byTopic: {} }, p.stats || {});
  o.stats.byTopic = Object.assign({}, (p.stats || {}).byTopic || {});
  o.stages = Object.assign({}, p.stages || {});
  o.recentRooms = Array.isArray(p.recentRooms) ? p.recentRooms.slice(-20) : [];
  return o;
}
const lsGet = () => { try { return norm(JSON.parse(localStorage.getItem(LS))); } catch (e) { return null; } };
const lsSet = () => { try { localStorage.setItem(LS, JSON.stringify(P)); } catch (e) {} };
const totalStars = p => { let n = 0; for (const t in p.stages) for (const d in p.stages[t]) n += p.stages[t][d] || 0; return n; };
function boardDoc() {
  const s = P.stats;
  return { name: String(P.name).slice(0, 18), avatar: P.avatar, xp: P.xp, level: levelOf(P.xp), bestSurvival: P.bestSurvival || 0, wins: P.wins || 0,
    stars: totalStars(P), accuracy: s.answered ? Math.round(100 * s.correct / s.answered) : 0, updatedAt: Date.now() };
}
let chain = Promise.resolve();
function save() {
  if (!P) return; lsSet();
  if (!ONLINE || U.anon) return;           // only Google accounts are stored online
  const snap = JSON.parse(JSON.stringify(P)), bd = boardDoc(), uid = U.uid;
  chain = chain.then(() => F.setDoc(F.doc(F.db, 'users', uid), snap)).catch(() => {})
    .then(() => F.setDoc(F.doc(F.db, 'leaderboard', uid), bd)).catch(() => {});
}

/* ============ auth ============ */
let pendingRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase() || null;
async function afterAuth(user) {
  U = { uid: user.uid, anon: user.isAnonymous, gname: user.displayName || (user.providerData && user.providerData[0] && user.providerData[0].displayName) || '' };
  ONLINE = true;
  if (!U.anon) {
    try {
      const s = await F.getDoc(F.doc(F.db, 'users', U.uid));
      if (s.exists()) {
        const remote = norm(s.data());
        if (remote && (!P || (remote.xp || 0) >= (P.xp || 0))) { P = remote; lsSet(); } else if (P) save();
      } else if (P) save();
      else { P = blank((U.gname || 'Geologist').split(' ')[0].slice(0, 18), AVATARS[0]); save(); }
    } catch (e) {}
  }
  if (S.screen === 'boot' || S.screen === 'new') route(); else render();
}
async function googleSignIn() {
  if (!ONLINE) { toast('Online features are not set up yet. See the README.'); return; }
  const prov = new A.GoogleAuthProvider();
  try {
    const cu = A.auth.currentUser;
    if (cu && cu.isAnonymous) {
      try { await A.linkWithPopup(cu, prov); }
      catch (e) { if (e.code === 'auth/credential-already-in-use') await A.signInWithCredential(A.auth, A.GoogleAuthProvider.credentialFromError(e)); else throw e; }
    } else await A.signInWithPopup(A.auth, prov);
    await afterAuth(A.auth.currentUser);
  } catch (e) {
    toast(e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request' ? 'Sign-in cancelled'
      : 'Google sign-in failed. Inside a chat app? Open the link in Chrome or Safari.');
  }
}
async function signOutNow() {
  try { await A.signOut(A.auth); } catch (e) {}
  P = null; try { localStorage.removeItem(LS); } catch (e) {}
  S.draft = null; go('boot');            // the auth listener signs in a fresh guest and routes
}

/* ============ leaderboard ============ */
let LB = null, lbUnsub = null, lbErr = false;
function subLB() {
  if (lbUnsub) { lbUnsub(); lbUnsub = null; } LB = null; lbErr = false;
  if (!ONLINE) return;
  const field = { xp: 'xp', surv: 'bestSurvival', wins: 'wins' }[S.tab] || 'xp';
  const qy = F.query(F.collection(F.db, 'leaderboard'), F.orderBy(field, 'desc'), F.limit(50));
  lbUnsub = F.onSnapshot(qy, snap => { LB = snap.docs.map(d => ({ id: d.id, ...d.data() })); if (S.screen === 'board') render(); },
    () => { LB = []; lbErr = true; if (S.screen === 'board') render(); });
}

/* ============ state & routing ============ */
let S = { screen: 'boot', topic: null, tab: 'xp', quick: { topic: 'all', diff: 'r' }, draft: null,
  mp: { mode: 'duel', topic: 'all', diff: 'r', count: 10, teamSize: 3 }, msg: null };
let R = null, M = null, raf = 0;
function go(screen, extra) {
  cancelAnimationFrame(raf);
  if (screen !== 'board' && lbUnsub) { lbUnsub(); lbUnsub = null; }
  Object.assign(S, { screen }, extra || {});
  if (screen === 'board') subLB();
  render(); window.scrollTo(0, 0);
}
function route() {
  if (!P) return go('new');
  if (pendingRoom) { const c = pendingRoom; pendingRoom = null; return enterRoom(c); }
  go('home');
}
const showMsg = (title, text, busy) => go('msg', { msg: { title, text, busy } });

/* ============ views: shared ============ */
const chip = () => `<button class="chip" data-a="profile" aria-label="Your profile"><span class="av">${esc(P.avatar)}</span>${esc(P.name)}${U.anon ? '' : ' <span class="gbadge" title="Signed in with Google">G</span>'}</button>`;
const back = (a, label = 'Back') => `<button class="back" data-a="${a}">‹ ${label}</button>`;

function vBoot() { return `<p class="muted" style="margin-top:40vh;text-align:center">Loading…</p>`; }
function vMsg() {
  const m = S.msg || {};
  return `<div style="margin-top:22vh;text-align:center"><h2>${esc(m.title)}</h2><p class="muted" style="margin-top:8px">${esc(m.text || '')}</p>
    ${m.busy ? '' : '<button class="btn" style="margin-top:22px" data-a="home">Back to home</button>'}</div>`;
}
function vHome() {
  const l = levelOf(P.xp), cur = xpFor(l), nxt = xpFor(l + 1), pct = Math.round(100 * (P.xp - cur) / (nxt - cur));
  return `<header class="mast"><div><h1 class="wordmark">Strata</h1><p class="tagline">Geology quiz, ${BANK.length} questions deep</p></div>${chip()}</header>
  <section class="card level"><div class="lvnum">${l}<small>level</small></div>
   <div><h3>${rankOf(l)}</h3><div class="xpbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
   <p class="muted" style="font-size:.88rem;margin-top:6px">${P.xp} XP. ${nxt - P.xp} XP to level ${l + 1}</p></div></section>
  <div class="modes">
   <button class="mode" data-a="mp"><span class="ic">⚔️</span><span><b>Multiplayer</b><span>Duel, team battle or deathmatch. Play friends with a link or QR code.</span></span></button>
   <button class="mode" data-a="stages"><span class="ic">⛰️</span><span><b>Stage climb</b><span>10 branches, each with Easy, Medium and Hard stages.</span></span></button>
   <button class="mode" data-a="quick"><span class="ic">🎲</span><span><b>Quick round</b><span>10 questions from one branch or all of them.</span></span></button>
   <button class="mode" data-a="survival"><span class="ic">🪨</span><span><b>Rockslide</b><span>Endless and harder each time. Three wrong answers and you're buried.</span></span></button>
  </div>
  <div class="sub2"><button class="btn ghost" data-a="board">🏆 Leaderboard</button><button class="btn ghost" data-a="profile">📓 Field notes</button></div>
  ${U.anon && ONLINE ? `<div class="card guest"><p><b>Playing as a guest.</b> Sign in with Google to keep your progress on every device and appear on the global leaderboard.</p><button class="btn block" style="margin-top:12px" data-a="google">Continue with Google</button></div>` : ''}
  <p class="status">${ONLINE ? (U.anon ? 'Guest mode. Multiplayer is on' : 'Signed in. Progress is saved online') : 'Offline mode. Progress is saved on this device'}</p>`;
}
function vNew() {
  const d = S.draft || (S.draft = { name: P ? P.name : (U.gname || '').split(' ')[0].slice(0, 18), avatar: P ? P.avatar : AVATARS[0] });
  const editing = !!P;
  return `${editing ? back('profile') : ''}
  <div class="hero-new">${editing ? '' : '<h1 class="wordmark">Strata</h1>'}
  <h2 style="margin-top:${editing ? 4 : 14}px">${editing ? 'Edit your geologist' : 'Create your geologist'}</h2>
  <p class="muted" style="margin-top:6px">${editing ? 'Your name and badge show up in rooms and on the leaderboard.' : (pendingRoom ? `You're joining room <b>${esc(pendingRoom)}</b>. Pick a name and a badge to continue.` : 'Pick a name and a badge. You can sign in with Google later.')}</p></div>
  <label class="field"><span>Name</span><input class="input" id="nm" maxlength="18" autocomplete="off" placeholder="e.g. Rocky Mary" value="${esc(d.name)}"></label>
  <div class="field"><span>Badge</span><div class="avs">${AVATARS.map(a => `<button data-a="av" data-v="${a}" aria-pressed="${a === d.avatar}" aria-label="Badge ${a}">${a}</button>`).join('')}</div></div>
  <button class="btn block" style="margin-top:24px" data-a="saveprof">${editing ? 'Save changes' : (pendingRoom ? 'Join the room' : 'Play as guest')}</button>
  ${!editing && ONLINE && U.anon ? `<button class="btn ghost block" style="margin-top:10px" data-a="google">Continue with Google instead</button>` : ''}`;
}
function vProfile() {
  const s = P.stats, l = levelOf(P.xp), acc = s.answered ? Math.round(100 * s.correct / s.answered) : 0;
  return `${back('home', 'Home')}
  <div class="row between"><div class="row"><span class="av" style="width:56px;height:56px;font-size:1.9rem;background:var(--paper)">${esc(P.avatar)}</span><div><h2>${esc(P.name)}</h2><p class="muted">Level ${l}, ${rankOf(l)}</p></div></div>
  <button class="btn ghost" data-a="edit" style="padding:10px 14px">Edit</button></div>
  <div class="stat3"><div><b>${s.answered}</b><span>answered</span></div><div><b>${acc}%</b><span>accuracy</span></div><div><b>${s.bestStreak}</b><span>best streak</span></div>
  <div><b>${P.xp}</b><span>total XP</span></div><div><b>${P.wins || 0}/${P.played || 0}</b><span>battles won</span></div><div><b>${P.bestSurvival || 0}</b><span>Rockslide best</span></div></div>
  <h3 style="margin-top:24px">Branch mastery</h3><div class="mastery">${TOPICS.map(t => { const b = s.byTopic[t.id] || { a: 0, c: 0 }; const p = b.a ? Math.round(100 * b.c / b.a) : 0;
    return `<div class="r"><span>${t.icon}</span><span>${t.name}<div class="mbar"><i style="width:${p}%"></i></div></span><span class="muted" style="text-align:right">${b.a ? p + '%' : '–'}</span></div>`; }).join('')}</div>
  <div class="card" style="margin-top:24px"><h3>Account</h3>
   ${!ONLINE ? '<p class="muted" style="margin-top:6px">Offline mode. Online features are not set up yet.</p>'
     : U.anon ? `<p class="muted" style="margin:6px 0 12px">Guest account. Your progress lives on this device only, and guests are not on the global leaderboard.</p><button class="btn block" data-a="google">Continue with Google</button>`
     : `<p class="muted" style="margin:6px 0 12px">Signed in with Google. Progress and leaderboard rank follow you to any device.</p><button class="btn ghost" data-a="signout">Sign out</button>`}</div>`;
}
function vBoard() {
  const key = { xp: 'xp', surv: 'bestSurvival', wins: 'wins' }[S.tab] || 'xp';
  let rows = LB;
  if (!ONLINE || !rows) rows = !ONLINE ? [{ id: 'me', ...boardDoc() }] : null;
  const unit = { xp: 'XP', surv: 'correct', wins: 'wins' }[S.tab];
  return `${back('home', 'Home')}<h2>Leaderboard</h2>
  <div class="tabs" role="tablist">${[['xp', 'Total XP'], ['wins', 'Battle wins'], ['surv', 'Rockslide']].map(([k, n]) => `<button role="tab" data-a="tab" data-v="${k}" aria-selected="${S.tab === k}">${n}</button>`).join('')}</div>
  <div class="board">${rows === null ? '<div class="lrow"><span></span><span></span><span class="muted">Loading scores…</span></div>'
    : rows.length ? rows.map((r, i) => { const lv = levelOf(r.xp), me = r.id === U.uid || r.id === 'me';
      return `<div class="lrow ${me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="av">${esc(String(r.avatar || '🪨').slice(0, 4))}</span>
      <span class="nm">${esc(String(r.name).slice(0, 18))}${me ? ' (you)' : ''}<small>Lv ${lv} ${rankOf(lv)}</small></span>
      <span class="val">${r[key] || 0}<small>${unit}</small></span></div>`; }).join('')
    : `<div class="lrow"><span></span><span></span><span class="muted">${lbErr ? 'Could not load scores.' : 'No scores yet. Sign in and play to claim the top spot.'}</span></div>`}</div>
  <p class="note">${!ONLINE ? 'Online features are not set up, so only your own score is shown.' : U.anon ? 'Only Google accounts appear on the global board. Guests can still play every mode.' : 'Updates live as players finish rounds.'}</p>`;
}

/* ============ views: solo menus ============ */
const topicStars = t => { const s = P.stages[t] || {}; return ['e', 'm', 'h'].map(d => s[d] || 0); };
function vStages() {
  return `${back('home', 'Home')}<h2>Stage climb</h2><p class="muted" style="margin-top:6px">Score ${STAGE_PASS} of 8 to pass a stage. Perfect runs earn three stars.</p>
  <div class="topics">${TOPICS.map(t => { const st = topicStars(t.id), n = st.reduce((a, b) => a + b, 0);
    return `<button class="topic" data-a="topic" data-v="${t.id}"><span class="ic">${t.icon}</span><span><b>${t.name}</b><small>${t.blurb}</small></span>
    <span class="row" style="gap:8px"><small class="muted">${n}/9★</small><span class="mini" aria-hidden="true"><i class="${st[0] ? 'on' : ''}"></i><i class="${st[1] ? 'on2' : ''}"></i><i class="${st[2] ? 'on3' : ''}"></i></span></span></button>`; }).join('')}</div>`;
}
const unlocked = (t, d) => { const s = P.stages[t] || {}; return d === 'e' || (d === 'm' && s.e > 0) || (d === 'h' && s.m > 0); };
function vTopic() {
  const t = TOPIC[S.topic], st = P.stages[t.id] || {};
  return `${back('stages', 'All branches')}
  <div class="row" style="margin-top:4px"><span style="font-size:2.2rem">${t.icon}</span><div><h2>${t.name}</h2><p class="muted">${t.blurb}</p></div></div>
  <div class="stages">${['e', 'm', 'h'].map((d, i) => { const ok = unlocked(t.id, d);
    return `<button class="stage ${DIFF[d].cls}" data-a="play" data-v="${d}" ${ok ? '' : 'disabled'}><span><b class="disp" style="font-size:1.15rem">Stage ${i + 1}: ${DIFF[d].name}</b><br><small class="muted">${ok ? `8 questions, ${DIFF[d].xp} XP each` : `Pass ${DIFF[i === 1 ? 'e' : 'm'].name} to unlock`}</small></span>
    <span>${ok ? starStr(st[d] || 0) : '🔒'}</span></button>`; }).join('')}</div>`;
}
const topicChips = (cur, a) => [{ id: 'all', name: 'All branches', icon: '🌐' }, ...TOPICS].map(t => `<button class="opt" data-a="${a}" data-v="${t.id}" aria-pressed="${cur === t.id}">${t.icon} ${t.name}</button>`).join('');
function vQuick() {
  const q = S.quick;
  return `${back('home', 'Home')}<h2>Quick round</h2><p class="muted" style="margin-top:6px">Ten questions. Choose a branch or mix them all.</p>
  <h3 style="margin-top:20px">Branch</h3><div class="opts">${topicChips(q.topic, 'qt')}</div>
  <h3 style="margin-top:20px">Difficulty</h3><div class="opts">${[['e', 'Easy'], ['m', 'Medium'], ['h', 'Hard'], ['r', 'Rising: easy to hard']].map(([v, n]) => `<button class="opt" data-a="qd" data-v="${v}" aria-pressed="${q.diff === v}">${n}</button>`).join('')}</div>
  <button class="btn block" style="margin-top:26px" data-a="quickgo">Start round</button>`;
}

/* ============ solo quiz engine ============ */
function startRound(mode, o) {
  let qs = [];
  if (mode === 'stage') qs = shuffle(BANK.filter(q => q.t === o.topic && q.d === o.diff));
  if (mode === 'quick') {
    const pool = BANK.filter(q => o.topic === 'all' || q.t === o.topic), pick = (d, n) => shuffle(pool.filter(q => q.d === d)).slice(0, n);
    qs = o.diff === 'r' ? [...pick('e', 4), ...pick('m', 3), ...pick('h', 3)] : pick(o.diff, 10);
  }
  R = { mode, o, qs, i: 0, score: 0, streak: 0, best: 0, xp: 0, lives: 3, fifty: true, log: [], used: new Set(), startLv: levelOf(P.xp) };
  if (mode === 'survival') R.qs.push(nextSurv());
  startQ();
}
function nextSurv() {
  const tier = R.score < 5 ? 'e' : R.score < 12 ? 'm' : 'h';
  let pool = BANK.filter(q => q.d === tier && !R.used.has(q.id));
  if (!pool.length) pool = BANK.filter(q => !R.used.has(q.id));
  if (!pool.length) { R.used.clear(); pool = BANK; }
  const q = pool[Math.floor(Math.random() * pool.length)]; R.used.add(q.id); return q;
}
function startQ() { R.cur = prep(R.qs[R.i]); R.done = false; R.t0 = performance.now(); go('quiz'); tick(); }
function timerLoop(getStart, secs, onEnd, alive) {
  cancelAnimationFrame(raf);
  const loop = () => {
    if (!alive()) return;
    const left = Math.max(0, secs - (performance.now() - getStart()) / 1000), bar = $('#tbar');
    if (bar) { bar.style.transform = `scaleX(${left / secs})`; bar.parentNode.classList.toggle('low', left < 6); }
    if (left <= 0) { onEnd(); return; }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
const tick = () => timerLoop(() => R.t0, TIME, () => answer(-1), () => R && !R.done && S.screen === 'quiz');
function coreHTML() {
  const survival = R.mode === 'survival', slots = survival ? 12 : R.qs.length, log = survival ? R.log.slice(-12) : R.log, off = survival ? Math.max(0, R.log.length - 12) : 0;
  let h = ''; for (let i = 0; i < slots; i++) { const e = log[i];
    h += !e ? '<i class="empty"></i>' : `<i class="${e.ok ? '' : 'bad'} ${i === log.length - 1 && e.fresh ? 'new' : ''}" style="${e.ok ? 'background:var(--s' + (((i + off) % 5) + 1) + ')' : ''}"></i>`; }
  return h;
}
const choicesHTML = q => q.ch.map((c, i) => `<button class="choice" data-a="ans" data-v="${i}"><span class="k">${'ABCD'[i]}</span><span>${esc(c)}</span></button>`).join('');
function vQuiz() {
  const q = R.cur, t = TOPIC[q.t], total = R.mode === 'survival' ? '' : '/' + R.qs.length;
  const title = R.mode === 'stage' ? `${t.name}<small>Stage: ${DIFF[q.d].name}</small>` : R.mode === 'quick' ? `Quick round<small>${t.icon} ${t.name}, ${DIFF[q.d].name}</small>` : `Rockslide<small>${t.icon} ${t.name}, ${DIFF[q.d].name}</small>`;
  return `<div class="qhead"><button class="x" data-a="quit" aria-label="Quit round">✕</button><div class="t">${title}</div>
   <div class="lives" id="lives">${R.mode === 'survival' ? livesHTML(R.lives, 3) : ''}</div></div>
  <div class="timer"><i id="tbar"></i></div>
  <div class="qbody"><div class="core" id="core" aria-hidden="true">${coreHTML()}</div>
   <div><p class="qno">Question ${R.i + 1}${total}</p><p class="qtext">${esc(q.q)}</p><div class="choices" id="choices">${choicesHTML(q)}</div><div id="fb"></div></div></div>
  <div class="qfoot"><button class="pill" data-a="fifty" ${R.fifty ? '' : 'disabled'}>✂️ 50/50</button>
   <span class="row" style="gap:8px"><span class="pill" id="streak">🔥 ${R.streak}</span><span class="pill" id="xpp">+${R.xp} XP</span></span></div>`;
}
const livesHTML = (n, max) => '🪨'.repeat(Math.max(0, n)) + `<span style="opacity:.25">${'🪨'.repeat(Math.max(0, max - Math.max(0, n)))}</span>`;
function markChoices(q, i) {
  document.querySelectorAll('.choice').forEach((b, j) => { b.disabled = true; b.classList.add(j === q.ci ? 'ok' : j === i ? 'bad' : 'dim'); });
}
const smooth = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth';
function answer(i) {
  if (!R || R.done) return; R.done = true; cancelAnimationFrame(raf);
  const q = R.cur, ok = i === q.ci, left = Math.max(0, TIME - (performance.now() - R.t0) / 1000); let gain = 0;
  if (ok) { R.score++; R.streak++; R.best = Math.max(R.best, R.streak); gain = DIFF[q.d].xp + Math.round(5 * left / TIME) + (R.streak >= 3 ? Math.min(10, (R.streak - 2) * 2) : 0); R.xp += gain; }
  else { R.streak = 0; if (R.mode === 'survival') R.lives--; }
  const s = P.stats; s.answered++; if (ok) s.correct++; s.bestStreak = Math.max(s.bestStreak, R.streak);
  const bt = s.byTopic[q.t] || (s.byTopic[q.t] = { a: 0, c: 0 }); bt.a++; if (ok) bt.c++;
  R.log.forEach(e => e.fresh = false); R.log.push({ ok, q: q.q, a: q.a, pick: i >= 0 ? q.ch[i] : null, fresh: true });
  markChoices(q, i);
  const last = R.mode === 'survival' ? R.lives <= 0 : R.i + 1 >= R.qs.length;
  $('#fb').innerHTML = `<div class="fb"><b class="${ok ? 'okt' : 'badt'}">${ok ? 'Correct, +' + gain + ' XP' : i < 0 ? "Time's up" : 'Not quite'}</b>${ok ? '' : ` The answer is <b>${esc(q.a)}</b>.`}<p>${esc(q.x)}</p></div>
   <button class="btn block" style="margin-top:12px" data-a="next" id="nextb">${last ? 'See results' : 'Next question'}</button>`;
  $('#core').innerHTML = coreHTML(); $('#streak').textContent = '🔥 ' + R.streak; $('#xpp').textContent = '+' + R.xp + ' XP';
  if (R.mode === 'survival') $('#lives').innerHTML = livesHTML(R.lives, 3);
  const tb = $('#tbar'); if (tb && i < 0) tb.style.transform = 'scaleX(0)';
  $('#nextb').focus({ preventScroll: true }); $('#nextb').scrollIntoView({ block: 'nearest', behavior: smooth() });
}
function nextQ() {
  if (R.mode === 'survival') { if (R.lives <= 0) return finish(); R.qs.push(nextSurv()); R.i++; return startQ(); }
  R.i++; if (R.i >= R.qs.length) return finish(); startQ();
}
function fifty() {
  if (!R.fifty || R.done) return; R.fifty = false;
  shuffle([0, 1, 2, 3].filter(i => i !== R.cur.ci)).slice(0, 2).forEach(i => { const b = document.querySelectorAll('.choice')[i]; b.classList.add('gone'); b.disabled = true; });
  document.querySelector('[data-a="fifty"]').disabled = true;
}
function finish() {
  cancelAnimationFrame(raf);
  const res = { mode: R.mode, o: R.o, score: R.score, n: R.mode === 'survival' ? R.log.length : R.qs.length, xp: R.xp, best: R.best, log: R.log, startLv: R.startLv };
  P.xp += R.xp; P.rounds = (P.rounds || 0) + 1;
  if (R.mode === 'stage') { const st = P.stages[R.o.topic] || (P.stages[R.o.topic] = {}); res.stars = starsFor(R.score, res.n); res.prevStars = st[R.o.diff] || 0; if (res.stars > res.prevStars) st[R.o.diff] = res.stars; }
  if (R.mode === 'survival') { res.prevBest = P.bestSurvival || 0; P.bestSurvival = Math.max(res.prevBest, R.score); }
  res.endLv = levelOf(P.xp); save(); R = null; go('results', { res });
}
function vResults() {
  const r = S.res, nextD = { e: 'm', m: 'h' }[r.o && r.o.diff]; let head;
  if (r.mode === 'stage') { const pass = r.stars > 0;
    head = `<p class="muted">${TOPIC[r.o.topic].icon} ${TOPIC[r.o.topic].name}, ${DIFF[r.o.diff].name}</p><h2 style="margin-top:6px">${r.stars === 3 ? 'Flawless outcrop' : pass ? 'Stage cleared' : 'Eroded this time'}</h2><div style="margin-top:8px">${starStr(r.stars)}</div>
    ${pass && r.prevStars === 0 && nextD ? `<p style="margin-top:8px;font-weight:700">${DIFF[nextD].name} stage unlocked</p>` : ''}${!pass ? `<p class="muted" style="margin-top:6px">Get ${STAGE_PASS} of 8 to pass.</p>` : ''}`; }
  else if (r.mode === 'survival') head = `<p class="muted">Rockslide</p><h2 style="margin-top:6px">${r.score > r.prevBest ? 'New personal best' : 'Buried'}</h2>`;
  else head = `<p class="muted">Quick round</p><h2 style="margin-top:6px">${r.score / r.n >= .8 ? 'Excellent fieldwork' : r.score / r.n >= .5 ? 'Solid survey' : 'Keep digging'}</h2>`;
  const btns = [];
  if (r.mode === 'stage' && r.stars > 0 && nextD) btns.push(`<button class="btn block" data-a="playnext">Play ${DIFF[nextD].name} stage</button>`);
  btns.push(`<button class="btn ${r.mode === 'stage' && r.stars > 0 && nextD ? 'ghost' : ''} block" data-a="retry">Play again</button>`);
  return `<div class="card results">${head}
   <div class="stat3"><div><b>${r.score}${r.mode === 'survival' ? '' : '/' + r.n}</b><span>correct</span></div><div><b>+${r.xp}</b><span>XP earned</span></div><div><b>${r.best}</b><span>best streak</span></div></div>
   ${r.endLv > r.startLv ? `<div class="levelup">Level up! You reached level ${r.endLv}${rankOf(r.endLv) !== rankOf(r.startLv) ? ', now a ' + rankOf(r.endLv) : ''}.</div>` : ''}
   <div class="stack" style="margin-top:18px">${btns.join('')}<div class="sub2" style="margin-top:12px"><button class="btn ghost" data-a="board">🏆 Leaderboard</button><button class="btn ghost" data-a="home">Home</button></div></div></div>
  <details class="card review"><summary style="font-weight:700;cursor:pointer;min-height:32px">Review answers</summary><ul>${r.log.map(e => `<li>${e.ok ? '✅' : '❌'} ${esc(e.q)}<div class="a">${e.ok ? '' : (e.pick ? 'You said ' + esc(e.pick) + '. ' : 'No answer. ')}Answer: ${esc(e.a)}</div></li>`).join('')}</ul></details>`;
}

/* ============ multiplayer: menus ============ */
function vMP() {
  if (!ONLINE) return `${back('home', 'Home')}<h2>Multiplayer</h2><div class="card" style="margin-top:16px"><p><b>Online features are not set up yet.</b></p><p class="muted" style="margin-top:6px">Add your Firebase config in <code>js/firebase-config.js</code> (see the README) to play rooms with friends.</p></div>`;
  return `${back('home', 'Home')}<h2>Multiplayer</h2>
  <p class="muted" style="margin-top:6px">${U.anon ? 'Playing as a guest works fine. You can join with just a name.' : 'Create a room and share the link or QR code.'}</p>
  <div class="modes">${Object.values(MODES).map(m => `<button class="mode" data-a="mpmode" data-v="${m.id}"><span class="ic">${m.icon}</span><span><b>${m.name}</b><span>${m.blurb}</span></span></button>`).join('')}</div>
  <div class="card" style="margin-top:16px"><h3>Join with a code</h3>
   <div class="row" style="margin-top:10px"><input class="input" id="jc" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="5-letter code" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700"><button class="btn" data-a="joincode">Join</button></div></div>`;
}
function vMPSetup() {
  const m = S.mp, mode = MODES[m.mode], counts = m.mode === 'death' ? [30, 60, 100] : [10, 15, 20];
  return `${back('mp')}<h2>${mode.icon} ${mode.name}</h2><p class="muted" style="margin-top:6px">${mode.blurb}</p>
  <h3 style="margin-top:20px">Branch</h3><div class="opts">${topicChips(m.topic, 'mt')}</div>
  <h3 style="margin-top:20px">Difficulty</h3><div class="opts">${[['e', 'Easy'], ['m', 'Medium'], ['h', 'Hard'], ['r', 'Rising']].map(([v, n]) => `<button class="opt" data-a="md" data-v="${v}" aria-pressed="${m.diff === v}">${n}</button>`).join('')}</div>
  <h3 style="margin-top:20px">${m.mode === 'death' ? 'Question pool' : 'Questions'}</h3><div class="opts">${counts.map(n => `<button class="opt" data-a="mc" data-v="${n}" aria-pressed="${m.count === n}">${n}</button>`).join('')}</div>
  ${m.mode === 'death' ? '<p class="note">The round ends when one player is left, or when the pool runs out. A single branch has at most 24 questions.</p>' : ''}
  ${m.mode === 'team' ? `<h3 style="margin-top:20px">Players per team</h3><div class="opts">${[3, 4, 5].map(n => `<button class="opt" data-a="mts" data-v="${n}" aria-pressed="${m.teamSize === n}">${n}</button>`).join('')}</div>` : ''}
  <button class="btn block" style="margin-top:26px" data-a="mpcreate">Create room</button>`;
}

/* ============ multiplayer: room flow ============ */
const meInfo = () => ({ uid: U.uid, name: P.name, avatar: P.avatar, guest: U.anon });
async function mpCreate(opts) {
  showMsg('Creating room…', '', true);
  try {
    const code = await createRoom(F, meInfo(), opts);
    await enterRoom(code);
  } catch (e) { showMsg('Could not create the room', 'Check your connection and that the Firestore rules are published.'); }
}
async function enterRoom(code) {
  if (!ONLINE) return showMsg('Multiplayer is offline', 'Online features are not set up yet.');
  showMsg('Joining room…', '', true);
  let r; try { r = await joinRoom(F, meInfo(), code); } catch (e) { return showMsg('Could not join', 'Check your connection and try again.'); }
  if (r.error) return showMsg({ notfound: 'Room not found', started: 'Game already started', finished: 'That game has finished', full: 'Room is full' }[r.error],
    { notfound: 'Check the code, or ask the host for a new link.', started: 'You can join the next one.', finished: 'Ask the host to create a new room.', full: 'Ask the host for a bigger room.' }[r.error]);
  history.replaceState(null, '', roomLink(r.code));
  if (M) M.session.stop();
  M = { session: null, q: null, finalized: false, res: null };
  M.session = new RoomSession(F, meInfo(), r.code, onRoom); M.session.start();
}
function endRoom() { if (M) { M.session.stop(); M = null; } cancelAnimationFrame(raf); history.replaceState(null, '', location.pathname); }
async function leaveRoom() { const s = M && M.session; M = null; cancelAnimationFrame(raf); history.replaceState(null, '', location.pathname); if (s) await s.leave(); go('home'); }
function onRoom(s) {
  if (!M || M.session !== s) return;
  if (s.error) { endRoom(); return showMsg('Connection problem', `Could not sync this room (${s.error.code || 'error'}). Check that the Firestore rules are published.`); }
  if (s.gotRoom && s.gone) { endRoom(); return showMsg('Room closed', 'The host closed this room.'); }
  if (!s.ready || !s.room) return;
  if (s.kicked) { endRoom(); return showMsg('Removed from room', 'The host removed you from this room.'); }
  const st = s.room.status;
  if (st === 'lobby') { if (S.screen !== 'lobby') go('lobby'); else render(); }
  else if (st === 'playing') {
    if (M.q && M.q.i === s.room.qIndex && S.screen === 'mpquiz') { patchBoard(); return; }
    mpNewQ(); go('mpquiz'); mpTick();
  } else if (st === 'finished') { finalizeMP(); if (S.screen !== 'mpresults') go('mpresults'); else render(); }
}
async function copyLink() {
  const link = roomLink(M.session.code);
  try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { window.prompt('Copy this link', link); }
}
async function shareLink() {
  const s = M.session, link = roomLink(s.code);
  if (navigator.share) { try { await navigator.share({ title: 'Strata geology quiz', text: `Join my ${MODES[s.room.mode].name} room: ${s.code}`, url: link }); } catch (e) {} }
  else copyLink();
}
const playerRow = (s, p) => `<div class="prow"><span class="av">${esc(p.avatar)}</span><span class="nm">${esc(p.name)}${p.uid === s.me.uid ? ' (you)' : ''}<small>${p.uid === s.room.hostId ? 'Host' : p.guest ? 'Guest' : 'Google'}</small></span>
  ${s.isHost && p.uid !== s.me.uid ? `<button class="x" data-a="kick" data-v="${esc(p.uid)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</div>`;
function vLobby() {
  const s = M.session, r = s.room, mode = MODES[r.mode], link = roomLink(r.code), why = s.canStart(), t = TOPIC[r.topic];
  const info = `${mode.icon} ${mode.name} · ${t ? t.name : 'All branches'} · ${r.qCount} questions`;
  let people;
  if (r.mode === 'team') {
    const me = s.mine, cap = r.teamSize || 3;
    people = `<div class="teams">${[0, 1].map(k => { const m = s.teamMembers(k);
      return `<div class="team ${TEAM[k].cls}"><h3>${TEAM[k].name}</h3><small class="muted">${m.length} of ${cap}</small>${m.map(p => playerRow(s, p)).join('')}
      ${me && me.team !== k && m.length < cap ? `<button class="btn ghost block" style="margin-top:8px" data-a="team" data-v="${k}">Join this team</button>` : ''}</div>`; }).join('')}</div>`;
  } else people = `<div class="board" style="margin-top:12px">${s.players.map(p => playerRow(s, p)).join('')}</div>`;
  return `<div class="row between"><button class="back" data-a="leave">‹ Leave</button><span class="pill">${s.players.length} in room</span></div>
  <h2>Room <span class="code">${esc(r.code)}</span></h2><p class="muted" style="margin-top:4px">${esc(info)}</p>
  <div class="card share"><div class="qrbox">${qrSvg(link)}</div>
   <p class="muted" style="font-size:.9rem;text-align:center;margin-top:10px">Scan to join, or send the link</p>
   <p class="linkline">${esc(link)}</p>
   <div class="sub2" style="margin-top:10px"><button class="btn ghost" data-a="copy">Copy link</button><button class="btn" data-a="share">Share</button></div></div>
  <h3 style="margin-top:20px">Players</h3>${people}
  ${s.isHost ? `<button class="btn block" style="margin-top:18px" data-a="start" ${why ? 'disabled' : ''}>Start game</button>${why ? `<p class="note" style="text-align:center">${why}</p>` : ''}`
    : '<p class="note" style="text-align:center;margin-top:18px">Waiting for the host to start…</p>'}`;
}

/* ============ multiplayer: quiz ============ */
function mpNewQ() {
  const s = M.session, r = s.room, qi = r.qIndex, m = s.mine;
  M.q = { i: qi, cur: prep(BYID.get(r.qIds[qi])), t0: performance.now(), done: !!(m && m.lastQ === qi), pick: null,
    spectator: !m || m.left || (m.alive === false && m.lastQ !== qi) };
}
const mpTick = () => timerLoop(() => M.q.t0, MP_TIME, () => mpAnswer(-1), () => M && M.q && !M.q.done && !M.q.spectator && S.screen === 'mpquiz');
function boardHTML() {
  const s = M.session, r = s.room, qi = r.qIndex, tick = p => p.lastQ === qi ? '✓' : (isIn(p) ? '…' : '');
  const row = p => `<div class="mrow ${p.uid === s.me.uid ? 'me' : ''} ${isIn(p) ? '' : 'out'}"><span class="av sm">${esc(p.avatar)}</span><span class="nm">${esc(p.name)}</span>
    <span class="lv">${r.mode === 'death' ? (isIn(p) ? livesHTML((r.wrongLimit || WRONG_LIMIT) - p.wrong, r.wrongLimit || WRONG_LIMIT) : '☠️ out') : ''}</span><span class="tk">${tick(p)}</span><span class="sc">${p.score}</span></div>`;
  if (r.mode === 'team') return s.teamTotals().map(t => `<div class="mteam ${TEAM[t.team].cls}"><div class="row between"><b>${TEAM[t.team].name}</b><b>${t.score}</b></div>${t.members.map(row).join('')}</div>`).join('');
  const list = s.ranking(), top = list.slice(0, 12);
  return top.map(row).join('') + (list.length > 12 ? `<p class="note">and ${list.length - 12} more players</p>` : '');
}
function vMPQuiz() {
  const s = M.session, r = s.room, q = M.q, cur = q.cur, mode = MODES[r.mode], m = s.mine, t = TOPIC[cur.t];
  const right = r.mode === 'death' && m ? livesHTML((r.wrongLimit || WRONG_LIMIT) - m.wrong, r.wrongLimit || WRONG_LIMIT) : (r.mode === 'team' && m ? `<span class="tag ${TEAM[m.team].cls}">${TEAM[m.team].name.split(' ')[1]}</span>` : '');
  return `<div class="qhead"><button class="x" data-a="leave" aria-label="Leave room">✕</button><div class="t">${mode.icon} ${mode.name}<small>${t.icon} ${t.name}, ${DIFF[cur.d].name}</small></div><div class="lives" id="lives">${right}</div></div>
  <div class="timer"><i id="tbar"></i></div>
  <p class="qno">Question ${q.i + 1}/${r.qCount}</p><p class="qtext">${esc(cur.q)}</p>
  <div class="choices" id="choices">${q.spectator || q.done ? cur.ch.map((c, i) => `<button class="choice dim" disabled><span class="k">${'ABCD'[i]}</span><span>${esc(c)}</span></button>`).join('') : choicesHTML(cur)}</div>
  <div id="fb">${q.spectator ? '<div class="fb"><b>You are out.</b> Keep watching, the round carries on without you.</div>' : q.done ? '<p class="muted" id="mpwait" style="margin-top:12px">Answer locked in. Waiting for the others…</p>' : ''}</div>
  <h3 style="margin-top:22px">Scoreboard</h3><div class="mboard" id="mpboard">${boardHTML()}</div>`;
}
function patchBoard() {
  const b = $('#mpboard'); if (b) b.innerHTML = boardHTML();
  const s = M.session, r = s.room, m = s.mine, l = $('#lives');
  if (l && r.mode === 'death' && m) l.innerHTML = livesHTML((r.wrongLimit || WRONG_LIMIT) - m.wrong, r.wrongLimit || WRONG_LIMIT);
}
function mpAnswer(i) {
  const q = M && M.q; if (!q || q.done || q.spectator) return; q.done = true; q.pick = i; cancelAnimationFrame(raf);
  const ms = Math.min(MP_TIME * 1000, performance.now() - q.t0), ok = i === q.cur.ci, pts = ok ? pointsFor(q.cur.d, 1 - ms / (MP_TIME * 1000)) : 0;
  markChoices(q.cur, i);
  const s = M.session, mine = s.mine, dying = !ok && s.room.mode === 'death' && mine && mine.wrong + 1 >= (s.room.wrongLimit || WRONG_LIMIT);
  $('#fb').innerHTML = `<div class="fb"><b class="${ok ? 'okt' : 'badt'}">${ok ? 'Correct, +' + pts + ' points' : i < 0 ? "Time's up" : 'Not quite'}</b>${ok ? '' : ` The answer is <b>${esc(q.cur.a)}</b>.`}
    ${dying ? '<p><b>That was your last life. You can keep watching.</b></p>' : ''}<p>${esc(q.cur.x)}</p></div><p class="muted" id="mpwait" style="margin-top:12px">Waiting for the others…</p>`;
  const tb = $('#tbar'); if (tb && i < 0) tb.style.transform = 'scaleX(0)';
  s.answer(q.i, i, ok, Math.round(ms), pts).then(patchBoard).catch(() => toast('Could not send your answer. Check your connection.'));
  patchBoard();
  $('#fb').scrollIntoView({ block: 'nearest', behavior: smooth() });
}
function finalizeMP() {
  if (M.finalized) return; M.finalized = true;
  const s = M.session, m = s.mine; if (!m) return;
  const res = s.myResult(), code = s.code;
  const xp = Math.round(20 + m.score / 3 + (res.won ? 40 : 0));
  M.res = { ...res, xp };
  if (P.recentRooms.includes(code)) return;                 // already counted (page refresh)
  P.recentRooms.push(code); P.recentRooms = P.recentRooms.slice(-20);
  P.xp += xp; P.played = (P.played || 0) + 1; if (res.won) P.wins = (P.wins || 0) + 1;
  P.stats.answered += m.correct + m.wrong; P.stats.correct += m.correct;
  save();
}
function vMPResults() {
  const s = M.session, r = s.room, res = M.res || { won: false, draw: false, rank: 0, xp: 0 }, rank = s.ranking(), tt = s.teamTotals(), me = s.mine;
  let head;
  if (r.mode === 'team') head = `<h2>${res.draw ? 'A draw' : res.won ? 'Your team wins!' : 'Your team lost'}</h2><div class="mteams">${tt.map(t => `<div class="mteam ${TEAM[t.team].cls}"><b>${TEAM[t.team].name}</b><span class="big">${t.score}</span></div>`).join('')}</div>`;
  else if (r.mode === 'duel') head = `<h2>${res.draw ? 'A draw' : res.won ? 'You win!' : 'You lost this one'}</h2>`;
  else head = `<h2>${res.won ? 'Last one standing!' : `You placed #${res.rank}`}</h2>`;
  const status = p => r.mode === 'death' ? (isIn(p) ? 'Survived' : `Out on Q${(p.diedAt ?? 0) + 1}`) : `${p.correct} correct`;
  return `<div class="card results">${head}${me ? `<p class="muted" style="margin-top:8px">You scored ${me.score} points${M.res ? `, earned +${M.res.xp} XP` : ''}.</p>` : ''}</div>
  <div class="board" style="margin-top:14px">${rank.map((p, i) => `<div class="lrow ${p.uid === s.me.uid ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="av">${esc(p.avatar)}</span>
    <span class="nm">${esc(p.name)}${p.uid === s.me.uid ? ' (you)' : ''}<small>${r.mode === 'team' ? TEAM[p.team] ? TEAM[p.team].name : '' : status(p)}${r.mode === 'team' ? ', ' + status(p) : ''}</small></span><span class="val">${p.score}<small>points</small></span></div>`).join('')}</div>
  <div class="stack" style="margin-top:16px"><button class="btn block" data-a="rematch">New room, same settings</button><button class="btn ghost block" data-a="leave">Back home</button></div>`;
}
async function rematch() {
  const r = M.session.room, opts = { mode: r.mode, topic: r.topic, diff: r.diff, count: r.qCount, teamSize: r.teamSize };
  endRoom(); await mpCreate(opts);
}

/* ============ render & events ============ */
function render() {
  if (!P && !['new', 'boot', 'msg'].includes(S.screen)) S.screen = 'new';
  const v = { boot: vBoot, msg: vMsg, home: vHome, new: vNew, stages: vStages, topic: vTopic, quick: vQuick, board: vBoard, profile: vProfile, quiz: vQuiz, results: vResults,
    mp: vMP, mpsetup: vMPSetup, lobby: vLobby, mpquiz: vMPQuiz, mpresults: vMPResults }[S.screen] || vHome;
  $('#app').innerHTML = v();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a, v = b.dataset.v;
  switch (a) {
    case 'home': return go('home');
    case 'stages': return go('stages');
    case 'topic': return go('topic', { topic: v });
    case 'play': return startRound('stage', { topic: S.topic, diff: v });
    case 'quick': return go('quick');
    case 'qt': S.quick.topic = v; return render();
    case 'qd': S.quick.diff = v; return render();
    case 'quickgo': return startRound('quick', { ...S.quick });
    case 'survival': return startRound('survival', {});
    case 'board': return go('board');
    case 'tab': S.tab = v; subLB(); return render();
    case 'profile': return go('profile');
    case 'edit': S.draft = null; return go('new');
    case 'av': S.draft.name = $('#nm').value; S.draft.avatar = v; render(); return $('#nm').focus();
    case 'saveprof': {
      const n = $('#nm').value.trim().slice(0, 18); if (!n) { $('#nm').focus(); $('#nm').placeholder = 'Enter a name to continue'; return; }
      const wasNew = !P; if (P) { P.name = n; P.avatar = S.draft.avatar; } else P = blank(n, S.draft.avatar);
      S.draft = null; save(); return wasNew ? route() : go('home'); }
    case 'google': return googleSignIn();
    case 'signout': if (confirm('Sign out? Your progress stays safe in your Google account.')) signOutNow(); return;
    case 'ans': return S.screen === 'mpquiz' ? mpAnswer(+v) : answer(+v);
    case 'next': return nextQ();
    case 'fifty': return fifty();
    case 'quit': if (confirm("Quit this round? XP from this round won't be saved.")) { R = null; go('home'); } return;
    case 'retry': { const r = S.res; return startRound(r.mode, r.o); }
    case 'playnext': { const r = S.res; S.topic = r.o.topic; return startRound('stage', { topic: r.o.topic, diff: { e: 'm', m: 'h' }[r.o.diff] }); }
    // multiplayer
    case 'mp': return go('mp');
    case 'mpmode': S.mp = { mode: v, topic: 'all', diff: 'r', count: v === 'death' ? 60 : 10, teamSize: 3 }; return go('mpsetup');
    case 'mt': S.mp.topic = v; return render();
    case 'md': S.mp.diff = v; return render();
    case 'mc': S.mp.count = +v; return render();
    case 'mts': S.mp.teamSize = +v; return render();
    case 'mpcreate': return mpCreate({ ...S.mp });
    case 'joincode': { const c = $('#jc').value.trim(); if (c) enterRoom(c); return; }
    case 'copy': return copyLink();
    case 'share': return shareLink();
    case 'team': return M.session.setTeam(+v).then(ok => { if (!ok) toast('That team is full'); });
    case 'kick': return M.session.kick(v);
    case 'start': return M.session.startGame().catch(() => toast('Could not start the game'));
    case 'leave': if (S.screen === 'mpquiz' && !confirm('Leave the game? You will be counted as out.')) return; return leaveRoom();
    case 'rematch': return rematch();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'nm') { $('[data-a="saveprof"]').click(); return; }
  if (e.key === 'Enter' && e.target.id === 'jc') { $('[data-a="joincode"]').click(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase(), pick = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 }[k];
  if (S.screen === 'quiz' && R) {
    if (!R.done && pick !== undefined) { const btn = document.querySelectorAll('.choice')[pick]; if (btn && !btn.disabled) answer(pick); }
    else if (R.done && (k === 'enter' || k === ' ') && document.activeElement.id !== 'nextb') { e.preventDefault(); nextQ(); }
  } else if (S.screen === 'mpquiz' && M && M.q && !M.q.done && !M.q.spectator && pick !== undefined) {
    const btn = document.querySelectorAll('.choice')[pick]; if (btn && !btn.disabled) mpAnswer(pick);
  }
});

/* ============ boot ============ */
P = lsGet();
render();
if (!configured) { route(); }
else {
  let booted = false;
  const offline = setTimeout(() => { if (!booted && S.screen === 'boot') route(); }, 7000);   // Firebase unreachable: play offline
  A.onAuthStateChanged(A.auth, async user => {
    if (!user) { try { await A.signInAnonymously(A.auth); } catch (e) { if (S.screen === 'boot') route(); } return; }
    booted = true; clearTimeout(offline); afterAuth(user);
  });
}
