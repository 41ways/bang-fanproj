/**
 * 뱅! — 방 · 자리 · 관전 · 채팅 · 시계. 판의 규칙은 engine.js, 봇의 머리는 bot.js.
 *
 * 짜임은 허브의 다른 게임(로보77 · 바퀴벌레 포커)과 같다.
 *   create / join / resume(token) / rooms·unwatch(열린 방 목록) / cfg / addBot / kick / start / again / leave / chat / react
 * 소켓은 send(문자열) · close() · readyState 만 쓴다 — Node(server.js)와 Cloudflare(worker.js)가 같이 쓴다.
 *
 * 판이 열리는 순서 (BGA 와 같다)
 *   intro    역할 카드를 받고(보안관만 모두에게 드러난다) 인물 카드 두 장 중 하나를 고른다.
 *            모두 고르거나 시간이 다 되면 →
 *   playing  "보안관 ○○부터" 관문을 잠깐 보여 준 뒤 보안관의 첫 턴.
 *
 * 속도: 봇은 생각하는 틈(1.2~2.2초)에 더해, 방금 일어난 일(총알 · 뽑기! · 쓰러짐)을 화면이 다 보여 줄
 * 만큼 더 기다렸다가 둔다. 사람 차례의 제한 시간도 그 연출이 끝난 뒤부터 잰다.
 */
import { Game, eventDeck } from './engine.js';
import { decide } from './bot.js';
import { CHARS, ROLES_BY_N, MIN_PLAYERS, MAX_PLAYERS } from '../public/cards.js';

const FAST = typeof process !== 'undefined' && !!process.env && process.env.BANG_FAST === '1';
const MAX_SPECS = 10;
const TURN_SECS = [30, 60, 90, 0];          // 0 = 무제한
const REACT_SECS = [15, 20, 30];
const INTRO_SECS = FAST ? 1 : 40;
const GATE_MS = FAST ? 10 : 3200;            // "보안관 ○○부터" 관문
const DC_GRACE = FAST ? 100 : 6000;          // 끊긴 사람 차례를 봇이 대신 두기까지
const LOBBY_GRACE = FAST ? 200 : 20_000;
const BOT_THINK = FAST ? [1, 5] : [1200, 2200];
const BOT_NAMES = ['빌리', '장고', '애니', '와이엇', '돌리', '부치', '캘빈', '로이', '매기', '행크'];

/** 연출 한 가지가 화면에서 걸리는 시간(ms) — app.js 의 FX_MS 와 같아야 한다 */
const FX_MS = {
  turn: 1300, shot: 900, hurt: 650, heal: 600, dodge: 750, flip: 1600, boom: 1600, die: 2400,
  jailed: 1300, gatling: 1100, indians: 1100, play: 700, equip: 700, steal: 800, lose: 700,
  store: 1000, take: 550, draw: 450, show: 1100, pass: 900, spend: 500, discard: 450, over: 1500, reshuffle: 800,
  event: 3000, revive: 1600,
};
const fxMs = fx => FAST ? 0 : Math.min(6000, fx.reduce((a, e) => a + (FX_MS[e.fx] || 300), 0));

/* ─────────────────────────── 유틸 ─────────────────────────── */

const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const token = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ─────────────────────────── 방 ─────────────────────────── */

export const rooms = new Map();

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(c));
  return c;
}

function createRoom({ priv = false, spec = true } = {}) {
  const room = {
    code: makeCode(),
    phase: 'lobby',                 // lobby | intro | playing | over
    hostId: null, players: [], specs: [], nextId: 1,
    cfg: { max: 7, turn: 60, react: 20, chars: 'random', exp: 'none', revive: false, priv: !!priv, spec: spec !== false },
    game: null, intro: null, gate: 0,
    deadline: 0, holdUntil: 0,
    timers: { act: null, dc: null, host: null, intro: null },
    lastActive: Date.now(), madeAt: Date.now(), gameNo: 0, pushN: 0,
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, { name, bot }) {
  const p = { id: room.nextId++, token: token(), name: name || `총잡이 ${room.nextId - 1}`, bot: !!bot, ws: null, connected: !!bot, lastChat: 0, lastReact: 0, afk: false, logN: -1 };
  room.players.push(p);
  if (!p.bot && room.hostId == null) room.hostId = p.id;
  return p;
}
const playerOf = (room, id) => room.players.find(p => p.id === id) || null;
const live = room => room.phase === 'intro' || room.phase === 'playing';

function pickHost(room) {
  const next = room.players.find(p => !p.bot && p.connected) || room.players.find(p => !p.bot);
  room.hostId = next ? next.id : null;
}

/** 대기실이면 자리를 뺀다. 판 중이면 봇이 이어받는다(카드가 사라지면 판이 안 된다) */
function removePlayer(room, id) {
  const i = room.players.findIndex(p => p.id === id);
  if (i < 0) return;
  const p = room.players[i];
  clearTimeout(p.leaveT);
  if (live(room)) {
    p.bot = true; p.ws = null; p.connected = true; p.left = true;
    if (room.game) { const gp = room.game.P(p.id); if (gp) gp.bot = true; }
    if (room.hostId === p.id) pickHost(room);
    sys(room, `${p.name} 님이 나갔어요. 남은 판은 봇이 이어서 합니다.`);
    if (room.phase === 'intro') introPickBot(room, p);
    else schedule(room);
  } else {
    room.players.splice(i, 1);
    if (room.hostId === p.id) pickHost(room);
  }
  listChanged();
  seatSpecs(room);
}

/* ── 관전자 ── */
const specOf = (room, ws) => room.specs.find(s => s.ws === ws) || null;
function addSpec(room, ws, name) {
  watchers.delete(ws);
  const sp = { id: room.nextId++, name, ws, lastChat: 0, logN: -1 };
  room.specs.push(sp);
  ws.roomCode = room.code; ws.playerId = null; ws.specId = sp.id;
  send(ws, { t: 'welcome', role: 'spec', you: null, specId: sp.id, code: room.code });
  pushState(room);
  listChanged();
}
function removeSpec(room, ws) {
  const i = room.specs.findIndex(s => s.ws === ws);
  if (i >= 0) room.specs.splice(i, 1);
  ws.specId = null;
  return i >= 0;
}
/** 대기실로 돌아오면 구경하던 사람을 빈자리에 앉힌다 */
function seatSpecs(room) {
  if (room.phase !== 'lobby') return;
  while (room.specs.length && room.players.length < room.cfg.max) {
    const sp = room.specs.shift();
    if (!sp.ws || sp.ws.readyState !== 1) continue;
    const p = addPlayer(room, { name: sp.name });
    sp.ws.specId = null;
    attach(room, p, sp.ws, { seated: true });
    sys(room, `${p.name} 님이 자리에 앉았어요.`);
  }
}

function clearAll(room) { for (const k in room.timers) { clearTimeout(room.timers[k]); room.timers[k] = null; } }

function dropRoom(room) {
  clearAll(room);
  for (const sp of room.specs) {
    send(sp.ws, { t: 'err', msg: '방이 사라졌어요.', fatal: true });
    sp.ws.roomCode = null; sp.ws.specId = null;
  }
  room.specs = [];
  rooms.delete(room.code);
  listChanged();
}

/* ─────────────────────────── 판 열기: 역할 · 인물 고르기 ─────────────────────────── */

function startGame(room) {
  clearAll(room);
  room.gameNo++;
  // 자리 순서를 섞는다 — 누가 보안관 옆에 앉느냐가 판을 가른다
  shuffle(room.players);
  const n = room.players.length;
  const roles = shuffle([...ROLES_BY_N[n]]);
  const deck = shuffle(Object.keys(CHARS));
  // 인물: BGA 의 "Choose characters" — 무작위(기본)면 한 장, 고르기면 두 장 중 하나
  const two = room.cfg.chars === 'pick';
  room.intro = { mode: two ? 'pick' : 'random', roles: {}, offers: {}, picks: {}, ready: {}, ends: Date.now() + INTRO_SECS * 1000 };
  room.players.forEach((p, i) => {
    room.intro.roles[p.id] = roles[i];
    room.intro.offers[p.id] = two ? [deck[i * 2], deck[i * 2 + 1]] : [deck[i]];
    if (!two) room.intro.picks[p.id] = deck[i];
    p.afk = false; p.logN = -1;
  });
  for (const s of room.specs) s.logN = -1;
  room.phase = 'intro';
  room.game = null;
  sys(room, two ? '역할 카드를 나눠 줬어요. 인물을 골라 주세요.' : '역할 카드와 인물 카드를 나눠 줬어요. 확인하면 시작합니다.');
  for (const p of room.players) if (p.bot) setTimeout(() => introPickBot(room, p), FAST ? 0 : rnd(1500, 5000));
  room.timers.intro = setTimeout(() => finishIntro(room), INTRO_SECS * 1000);
  pushState(room);
  listChanged();
}

/** 봇은 둘 중 더 센 인물을 고른다 — 대충 이 순서 */
const CHAR_RANK = ['willy', 'slab', 'jourdonnais', 'calamity', 'bart', 'rose', 'paul', 'sid', 'lucky', 'kit', 'blackjack', 'jesse', 'pedro', 'elgringo', 'suzy', 'vulture'];
function introPickBot(room, p) {
  if (room.phase !== 'intro' || room.intro.ready[p.id]) return;
  const o = room.intro.offers[p.id];
  introPick(room, p, o.length > 1 && CHAR_RANK.indexOf(o[1]) < CHAR_RANK.indexOf(o[0]) ? o[1] : o[0]);
}
/** 인물을 고른다(고르기 판) · 확인한다(무작위 판) — 모두 마치면 판이 열린다 */
function introPick(room, p, c) {
  const I = room.intro;
  if (room.phase !== 'intro' || I.ready[p.id] || !I.offers[p.id].includes(c)) return;
  I.picks[p.id] = c;
  I.ready[p.id] = true;
  if (room.players.every(q => I.ready[q.id])) finishIntro(room);
  else pushState(room);
}
function finishIntro(room) {
  if (room.phase !== 'intro') return;
  const I = room.intro;
  clearTimeout(room.timers.intro);
  for (const p of room.players) if (!I.picks[p.id]) I.picks[p.id] = I.offers[p.id][0];
  room.game = new Game(room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot })), {
    roles: room.players.map(p => I.roles[p.id]),
    chars: room.players.map(p => I.picks[p.id]),
    events: eventDeck(room.cfg.exp, room.cfg.revive),
  });
  room.game.fx = [];                 // 첫 "차례" 연출은 관문이 대신한다
  room.phase = 'playing';
  room.gate = Date.now() + GATE_MS;
  room.holdUntil = room.gate;
  const sh = room.game.players.find(x => x.role === 'sheriff');
  sys(room, `보안관은 ${sh.name} 님! 보안관부터 시작합니다.`);
  schedule(room);
  pushState(room);
  listChanged();
}

/* ─────────────────────────── 판 진행 ─────────────────────────── */

/** 이 자리를 지금 봇이 대신 두는가 — 'bot'(봇·나간 사람) · 'away'(끊김·자리 비움) · null(사람) */
function autoOf(room, id) {
  const p = playerOf(room, id);
  if (!p || p.bot) return 'bot';
  if (!p.connected) return 'away';
  if (p.afk) return 'away';
  return null;
}

function act(room, p, r, seq) {
  const g = room.game;
  if (!g || room.phase !== 'playing') return;
  if (!g.req || g.req.to !== p.id) return send(p.ws, { t: 'err', msg: '지금은 내 차례가 아니에요.' });
  if (seq !== g.req.seq) return;                       // 한 발 늦은 답
  p.afk = false;
  try { g.answer(p.id, r); }
  catch (e) { return send(p.ws, { t: 'err', msg: String(e.message || e) }); }
  after(room);
}

/** 판이 한 걸음 나간 뒤 — 연출 시간을 재 두고, 모두에게 보내고, 다음 시계를 건다 */
function after(room) {
  const g = room.game;
  const ms = fxMs(g.fx);
  room.holdUntil = Math.max(room.holdUntil, Date.now()) + ms;
  if (g.over && room.phase === 'playing') {
    room.phase = 'over';
    clearAll(room);
    listChanged();
  }
  schedule(room);
  pushState(room, g.fx);
  g.fx = [];
}

function schedule(room) {
  clearTimeout(room.timers.act); room.timers.act = null;
  clearTimeout(room.timers.dc); room.timers.dc = null;
  const g = room.game;
  if (!g || g.over || !g.req || room.phase !== 'playing') { room.deadline = 0; return; }
  const q = g.req, seq = q.seq;
  const hold = Math.max(0, room.holdUntil - Date.now());
  const run = fn => () => {
    room.timers.act = null;
    if (room.game !== g || !g.req || g.req.seq !== seq) return;
    try { fn(); } catch (e) { console.error('auto', e); try { g.answer(q.to, decide(g, q.to)); } catch (_) { g.answer(q.to, { a: q.kind === 'play' ? 'end' : 'take' }); } }
    after(room);
  };
  const who = autoOf(room, q.to);
  if (who === 'bot') {
    room.deadline = 0;
    room.timers.act = setTimeout(run(() => g.answer(q.to, decide(g, q.to))), hold + rnd(...BOT_THINK));
    return;
  }
  if (who === 'away') {
    room.deadline = 0;
    room.timers.act = setTimeout(run(() => g.answer(q.to, decide(g, q.to))), hold + (FAST ? 0 : DC_GRACE));
    return;
  }
  const secs = q.kind === 'play' ? room.cfg.turn : room.cfg.react;
  if (!secs) { room.deadline = 0; return; }           // 무제한
  room.deadline = Date.now() + hold + secs * 1000;
  room.timers.act = setTimeout(run(() => {
    const p = playerOf(room, q.to);
    if (p) { p.afk = true; send(p.ws, { t: 'err', msg: '시간이 다 되어 봇이 대신 둡니다. 아무 단추나 누르면 돌아와요.' }); }
    g.answer(q.to, q.kind === 'play' ? { a: 'end' } : decide(g, q.to));
  }), hold + secs * 1000 + 250);
}

/* ─────────────────────────── 통신 ─────────────────────────── */

function send(ws, obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (_) {} } }

function stateFor(room, me, fx) {
  const base = {
    t: 'state', code: room.code, phase: room.phase, hostId: room.hostId, cfg: room.cfg,
    min: MIN_PLAYERS, maxCap: MAX_PLAYERS, gameNo: room.gameNo, now: Date.now(),
    you: me ? me.id : null, role: me ? 'player' : 'spec',
    specs: room.specs.map(s => s.name),
    players: room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot, left: !!p.left, connected: p.connected })),
  };
  if (room.phase === 'intro') {
    const I = room.intro;
    const sh = room.players.find(p => I.roles[p.id] === 'sheriff');
    base.intro = {
      ends: I.ends, sheriff: sh ? sh.id : null,
      myRole: me ? I.roles[me.id] : null,
      offers: me ? I.offers[me.id] : null,
      mode: I.mode,
      myPick: me && I.ready[me.id] ? I.picks[me.id] : null,
      picked: room.players.filter(p => I.ready[p.id]).map(p => p.id),
    };
  }
  if (room.game && (room.phase === 'playing' || room.phase === 'over')) {
    const g = room.game;
    const who = me || null;
    base.g = g.view(who ? who.id : null);
    base.deadline = room.deadline;
    base.secs = g.req ? (g.req.kind === 'play' ? room.cfg.turn : room.cfg.react) : 0;
    base.gate = room.gate;
    base.auto = who ? !!autoOf(room, who.id) && !who.bot : false;
    const holder = who || null;
    const reset = !holder || holder.logN < 0;
    base.logs = reset ? g.logs.slice(-150) : g.logs.filter(l => l.n >= holder.logN);
    base.reset = reset;
    if (holder) holder.logN = g.logs.length ? g.logs[g.logs.length - 1].n + 1 : 0;
    base.fx = fx || [];
  }
  return base;
}

function pushState(room, fx) {
  room.pushN++;
  for (const p of room.players) if (!p.bot && p.ws) send(p.ws, Object.assign(stateFor(room, p, fx), { seq: room.pushN }));
  for (const sp of room.specs) {
    const v = stateFor(room, null, fx);
    if (v.g) { v.reset = sp.logN < 0; v.logs = v.reset ? room.game.logs.slice(-150) : room.game.logs.filter(l => l.n >= sp.logN); sp.logN = room.game.logs.length ? room.game.logs[room.game.logs.length - 1].n + 1 : 0; }
    send(sp.ws, Object.assign(v, { seq: room.pushN }));
  }
}
function broadcast(room, obj) {
  for (const p of room.players) if (!p.bot) send(p.ws, obj);
  for (const sp of room.specs) send(sp.ws, obj);
}
/** 방 안 알림 — 채팅 칸에 회색으로 */
function sys(room, text) { broadcast(room, { t: 'chat', sys: true, text }); }

/* ── 열린 방 목록 ── */
const watchers = new Set();
let listT = null;
function listChanged() {
  if (listT || !watchers.size) return;
  listT = setTimeout(() => { listT = null; pushList(); }, FAST ? 0 : 300);
}
function roomList() {
  const rs = [];
  for (const r of rooms.values()) {
    if (!r.players.some(p => !p.bot && p.connected)) continue;
    const state = r.phase !== 'lobby' ? 'playing' : r.players.length >= r.cfg.max ? 'full' : 'wait';
    rs.push({ r, state });
  }
  const open = x => (x.state === 'wait' && !x.r.cfg.priv ? 0 : 1);
  rs.sort((a, b) => open(a) - open(b) || b.r.madeAt - a.r.madeAt);
  const list = rs.slice(0, 20).map(({ r, state }) => {
    const host = playerOf(r, r.hostId);
    const e = { host: host ? host.name : '', exp: r.cfg.exp, n: r.players.length, humans: r.players.filter(p => !p.bot).length, max: r.cfg.max, state, spec: r.cfg.spec, watching: r.specs.length };
    if (r.cfg.priv) { e.priv = true; return e; }
    return Object.assign({ code: r.code }, e);
  });
  return { t: 'rooms', list, online: onlineCount() };
}
let socketsRef = null;
const onlineCount = () => (socketsRef ? socketsRef() : 0);
export function countSockets(fn) { socketsRef = fn; }
function pushList() {
  if (!watchers.size) return;
  const text = JSON.stringify(roomList());
  for (const ws of watchers) {
    if (ws.readyState !== 1) { watchers.delete(ws); continue; }
    try { ws.send(text); } catch (_) { watchers.delete(ws); }
  }
}

/* ─────────────────────────── 메시지 처리 ─────────────────────────── */

function attach(room, p, ws, { seated = false } = {}) {
  clearTimeout(p.leaveT);
  watchers.delete(ws);
  p.ws = ws; p.connected = true; p.logN = -1;
  const host = playerOf(room, room.hostId);
  if (!host || (!host.connected && host !== p)) room.hostId = p.id;
  ws.roomCode = room.code; ws.playerId = p.id;
  send(ws, Object.assign({ t: 'welcome', role: 'player', you: p.id, token: p.token, code: room.code }, seated ? { seated: true } : {}));
  if (room.phase === 'playing') schedule(room);         // 내 차례에 끊겼다 돌아왔으면 대신 두려던 예약을 거둔다
  pushState(room);
  listChanged();
}

function detach(ws) {
  const room = rooms.get(ws.roomCode);
  if (room && ws.specId != null) {
    if (removeSpec(room, ws)) { pushState(room); listChanged(); }
  } else if (room) {
    const p = playerOf(room, ws.playerId);
    if (p && p.ws === ws) {
      if (room.phase === 'lobby') {
        removePlayer(room, p.id);
        if (!room.players.some(x => !x.bot)) dropRoom(room); else pushState(room);
      } else disconnect(ws);
    }
  }
  ws.roomCode = null; ws.playerId = null; ws.specId = null;
}

function chatText(room, who, msg, extra) {
  const text = clean(msg.text, 200);
  if (!text) return;
  const now = Date.now();
  if (now - (who.lastChat || 0) < 400) return;
  who.lastChat = now;
  broadcast(room, Object.assign({ t: 'chat', from: who.id, name: who.name, text }, extra || {}));
}

const REACTS = 6;

export function handle(ws, msg) {
  if (!msg || typeof msg.t !== 'string') return;
  if ((msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') && ws.roomCode) detach(ws);
  switch (msg.t) {
    case 'rooms': if (!ws.roomCode) { watchers.add(ws); send(ws, roomList()); } return;
    case 'unwatch': watchers.delete(ws); return;
    case 'create': {
      const r = createRoom({ priv: msg.priv === true, spec: msg.spec !== false });
      const p = addPlayer(r, { name: clean(msg.name, 12) || '총잡이 1' });
      attach(r, p, ws);
      return;
    }
    case 'join': {
      const code = clean(msg.code, 8).toUpperCase();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', msg: '그런 방이 없어요. 코드를 확인해 주세요.' });
      if (r.phase !== 'lobby' || r.players.length >= r.cfg.max) {
        if (!r.cfg.spec) return send(ws, { t: 'err', msg: (r.phase !== 'lobby' ? '이미 시작한 방이에요.' : '방이 가득 찼어요.') + ' 관전을 허용하지 않는 방이에요.' });
        if (r.specs.length >= MAX_SPECS) return send(ws, { t: 'err', msg: '관전석이 가득 찼어요.' });
        addSpec(r, ws, clean(msg.name, 12) || `관전자 ${r.specs.length + 1}`);
        return;
      }
      const p = addPlayer(r, { name: clean(msg.name, 12) || `총잡이 ${r.players.length + 1}` });
      attach(r, p, ws);
      sys(r, `${p.name} 님이 들어왔어요.`);
      return;
    }
    case 'resume': {
      const r = rooms.get(clean(msg.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'err', msg: '방이 사라졌어요.', fatal: true });
      const p = r.players.find(x => x.token === msg.token && !x.left);
      if (!p) return send(ws, { t: 'err', msg: '자리를 찾을 수 없어요.', fatal: true });
      if (p.ws && p.ws !== ws) { send(p.ws, { t: 'moved' }); try { p.ws.close(4001, 'moved'); } catch (_) {} }
      attach(r, p, ws);
      return;
    }
  }

  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.specId != null) return handleSpec(room, ws, msg);
  const me = playerOf(room, ws.playerId);
  if (!me || me.bot) return;
  const isHost = room.hostId === me.id;
  room.lastActive = Date.now();

  switch (msg.t) {
    case 'cfg': {
      if (!isHost || room.phase !== 'lobby') return;
      if (TURN_SECS.includes(msg.turn)) room.cfg.turn = msg.turn;
      if (REACT_SECS.includes(msg.react)) room.cfg.react = msg.react;
      if (Number.isInteger(msg.max) && msg.max >= MIN_PLAYERS && msg.max <= MAX_PLAYERS && msg.max >= room.players.length) room.cfg.max = msg.max;
      if (msg.chars === 'random' || msg.chars === 'pick') room.cfg.chars = msg.chars;
      if (['none', 'hn', 'foc', 'both', 'either'].includes(msg.exp)) room.cfg.exp = msg.exp;
      if (typeof msg.revive === 'boolean') room.cfg.revive = msg.revive;
      if (typeof msg.priv === 'boolean') room.cfg.priv = msg.priv;
      if (typeof msg.spec === 'boolean') room.cfg.spec = msg.spec;
      pushState(room); listChanged();
      break;
    }
    case 'addBot': {
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.length >= room.cfg.max) return send(ws, { t: 'err', msg: '자리가 없어요.' });
      const used = new Set(room.players.map(p => p.name));
      addPlayer(room, { name: BOT_NAMES.find(n => !used.has(n)) || `봇 ${room.players.length + 1}`, bot: true });
      pushState(room); listChanged();
      break;
    }
    case 'kick': {
      if (!isHost || room.phase !== 'lobby') return;
      const t = playerOf(room, msg.id);
      if (!t || t.id === room.hostId) return;
      if (t.ws) { send(t.ws, { t: 'err', msg: '방장이 내보냈어요.', fatal: true }); t.ws.roomCode = null; t.ws.playerId = null; }
      removePlayer(room, t.id);
      if (!t.bot) sys(room, `${t.name} 님이 나갔어요.`);
      pushState(room);
      break;
    }
    case 'host': {                                   // 방장 넘기기
      if (!isHost) return;
      const t = playerOf(room, msg.id);
      if (!t || t.bot || !t.connected) return;
      room.hostId = t.id;
      sys(room, `${t.name} 님이 방장이 되었어요.`);
      pushState(room); listChanged();
      break;
    }
    case 'start': {
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.length < MIN_PLAYERS) return send(ws, { t: 'err', msg: `${MIN_PLAYERS}명은 있어야 시작할 수 있어요. 빈자리에 봇을 앉혀 보세요.` });
      startGame(room);
      break;
    }
    case 'pick': introPick(room, me, String(msg.c)); break;
    case 'act': act(room, me, msg.r, msg.seq); break;
    case 'back': me.afk = false; schedule(room); pushState(room); break;

    case 'chat': chatText(room, me, msg); break;
    case 'react': {
      const e = msg.e | 0, now = Date.now();
      if (e < 0 || e >= REACTS || now - me.lastReact < 700) return;
      me.lastReact = now;
      broadcast(room, { t: 'react', from: me.id, e });
      break;
    }
    case 'again': {
      if (!isHost || room.phase !== 'over') return;
      clearAll(room);
      room.phase = 'lobby'; room.game = null; room.intro = null; room.deadline = 0;
      room.players = room.players.filter(p => !p.left);
      for (const p of room.players) if (!p.bot && !p.connected) armLeave(room, p);
      if (!playerOf(room, room.hostId)) pickHost(room);
      seatSpecs(room);
      pushState(room); listChanged();
      break;
    }
    case 'leave':
      removePlayer(room, me.id);
      ws.roomCode = null; ws.playerId = null;
      send(ws, { t: 'left' });
      if (!room.players.some(x => !x.bot && !x.left)) dropRoom(room);
      else pushState(room);
      break;
  }
}

function handleSpec(room, ws, msg) {
  const sp = specOf(room, ws);
  if (!sp) return;
  if (msg.t === 'chat') chatText(room, sp, msg, { spec: true });
  else if (msg.t === 'leave') {
    removeSpec(room, ws);
    ws.roomCode = null; ws.specId = null;
    send(ws, { t: 'left' });
    pushState(room); listChanged();
  }
}

function armLeave(room, p) {
  clearTimeout(p.leaveT);
  p.leaveT = setTimeout(() => {
    if (p.connected || room.phase !== 'lobby' || rooms.get(room.code) !== room) return;
    removePlayer(room, p.id);
    sys(room, `${p.name} 님의 연결이 끊겨 자리를 비웠어요.`);
    if (!room.players.some(x => !x.bot)) dropRoom(room); else pushState(room);
  }, LOBBY_GRACE);
}

export function disconnect(ws, { keepSeat = false } = {}) {
  watchers.delete(ws);
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.specId != null) { if (removeSpec(room, ws)) { pushState(room); listChanged(); } return; }
  const p = playerOf(room, ws.playerId);
  if (!p || p.ws !== ws) return;
  p.connected = false; p.ws = null;
  room.lastActive = Date.now();
  listChanged();
  if (room.hostId === p.id) {
    clearTimeout(room.timers.host);
    room.timers.host = setTimeout(() => {
      const h = playerOf(room, room.hostId);
      if (h && h.connected) return;
      const next = room.players.find(x => !x.bot && x.connected);
      if (next) { room.hostId = next.id; sys(room, `${next.name} 님이 방장이 되었어요.`); pushState(room); }
    }, LOBBY_GRACE);
  }
  if (room.phase === 'lobby') { if (!keepSeat) armLeave(room, p); }
  else if (room.phase === 'playing') schedule(room);
  pushState(room);
}

/** 사람이 다 떠난 방을 치운다. 통신 쪽이 20~30초마다 부른다 */
export function sweepRooms(now = Date.now()) {
  for (const room of [...rooms.values()]) {
    const humans = room.players.filter(p => !p.bot && p.connected).length;
    const seated = room.phase === 'lobby' && room.players.some(p => !p.bot);
    if (humans === 0 && !room.specs.length && now - room.lastActive > (seated ? 10 * 60_000 : 90_000)) dropRoom(room);
  }
}
export const busy = () => rooms.size > 0 || watchers.size > 0;
export const _test = { stateFor, finishIntro, schedule };
