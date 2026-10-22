/**
 * 뱅! — 화면. 규칙은 서버가 쥐고 있고, 여기는 받은 것을 그리고 누른 것을 보낸다.
 *
 * 화면 넷: 시작(이름) → 대기방(방 목록 · 잡담) → 방(자리 · 봇 · 설정 · 채팅) → 판
 * 판에서 누를 수 있는 것은 서버가 보내 준 moves(낼 수 있는 카드와 대상)만 밝힌다.
 */
import { KINDS, CHARS, ROLES, SUITS, RANKS, DECK } from './cards.js';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('bang.' + k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem('bang.' + k, v); } catch (_) {} },
};
const ROLE_ICON = { sheriff: '⭐', deputy: '🔰', outlaw: '💀', renegade: '🎭' };
const CHAR_IMG = c => `img/chars/${c}.webp`;
const ROLE_IMG = r => `img/roles/${r}.webp`;
const CARD_IMG = k => `img/cards/${k}.webp`;
const isMobile = () => matchMedia('(max-width: 900px)').matches;

/* ───────────── 상태 ───────────── */
const S = {
  pid: store.get('pid'), name: store.get('name') || '',
  view: 'title', lobby: null, room: null, roomChat: [], lobbyChat: [],
  g: null, me: null, auto: false, timer: null,
  sel: [], mode: null,            // mode: 'sid' (시드 2장 고르기)
  seenGame: null, prevHand: new Set(), lastSeq: 0,
};

/* ───────────── 소리 ───────────── */
const Snd = (() => {
  let ctx = null, muted = store.get('mute') === '1';
  const shot = new Audio('sound/shot.mp3'); shot.preload = 'auto';
  const ac = () => { if (!ctx) try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} return ctx; };
  const tone = (f, d, type = 'sine', g = 0.08, delay = 0) => {
    const c = ac(); if (!c || muted) return;
    const o = c.createOscillator(), v = c.createGain();
    o.type = type; o.frequency.value = f;
    const t = c.currentTime + delay;
    v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v).connect(c.destination); o.start(t); o.stop(t + d + .02);
  };
  const noise = (d, g = .3, lp = 900) => {
    const c = ac(); if (!c || muted) return;
    const b = c.createBuffer(1, c.sampleRate * d, c.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / a.length, 2);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), v = c.createGain();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = lp; v.gain.value = g;
    s.connect(f).connect(v).connect(c.destination); s.start();
  };
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; store.set('mute', muted ? '1' : '0'); return muted; },
    shot(vol = .55) { if (muted) return; const a = shot.cloneNode(); a.volume = vol; a.play().catch(() => noise(.25, .5, 2500)); },
    click() { tone(660, .06, 'triangle', .05); },
    turn() { tone(784, .14, 'triangle', .08); tone(1046, .22, 'triangle', .08, .12); },
    heal() { tone(523, .12, 'sine', .07); tone(659, .12, 'sine', .07, .09); tone(784, .2, 'sine', .07, .18); },
    hurt() { tone(160, .25, 'sawtooth', .07); },
    boom() { noise(1.1, .7, 500); },
    miss() { tone(1400, .12, 'sine', .04); tone(900, .16, 'sine', .03, .05); },
    die() { tone(220, .3, 'triangle', .08); tone(165, .5, 'triangle', .08, .25); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .3, 'triangle', .07, i * .14)); },
    unlock() { ac(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
  };
})();
addEventListener('pointerdown', () => Snd.unlock(), { once: true });
$('#muteBtn').textContent = Snd.muted ? '🔇' : '🔊';
$('#muteBtn').onclick = () => { $('#muteBtn').textContent = Snd.toggle() ? '🔇' : '🔊'; };

/* ───────────── 연결 ───────────── */
let ws = null, wsTry = 0, pingT = null, wantOpen = false;
function connect() {
  wantOpen = true;
  const url = location.origin.replace(/^http/, 'ws') + '/ws';
  ws = new WebSocket(url);
  $('#net').hidden = false; $('#net').textContent = '연결 중…';
  ws.onopen = () => {
    wsTry = 0; $('#net').hidden = true;
    send({ t: 'hello', pid: S.pid, name: S.name });
    clearInterval(pingT); pingT = setInterval(() => send({ t: 'ping' }), 25000);
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
  ws.onclose = ev => {
    clearInterval(pingT);
    if (!wantOpen) return;
    if (ev.code === 4001) { $('#net').hidden = false; $('#net').textContent = '다른 창에서 접속 중'; return; }
    $('#net').hidden = false;
    $('#net').textContent = ev.code === 4000 ? '오래 쉬어서 끊겼습니다 — 누르면 다시 연결' : '끊김 — 다시 연결하는 중…';
    if (ev.code === 4000) { $('#net').onclick = () => { $('#net').onclick = null; connect(); }; return; }
    setTimeout(connect, Math.min(8000, 500 * 2 ** wsTry++));
  };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function onMsg(m) {
  switch (m.t) {
    case 'hi':
      S.pid = m.pid; S.name = m.name; store.set('pid', m.pid); store.set('name', m.name);
      $('#meName').textContent = m.name;
      break;
    case 'lobby':
      S.lobby = m;
      if (m.chat) { S.lobbyChat = m.chat; S.room = null; S.g = null; closeModal(); go('lobby'); renderChat('lobby'); }
      renderLobby();
      break;
    case 'room': {
      S.room = m.room;
      if (m.chat) { S.roomChat = m.chat; renderChat('room'); }
      if (m.room.phase === 'wait') { S.g = null; if (S.view === 'game') closeModal(); go('room'); }
      renderRoom();
      break;
    }
    case 'chat':
      if (m.ch === 'lobby') { S.lobbyChat.push(m.m); addChat('lobby', m.m); }
      else { S.roomChat.push(m.m); addChat('room', m.m); }
      break;
    case 'game': onGame(m); break;
    case 'err': toast(m.m); break;
    case 'kicked': toast(m.m); wantOpen = false; break;
    case 'idle': break;
  }
}

/* ───────────── 화면 전환 ───────────── */
function go(v) {
  if (S.view === v) return;
  S.view = v;
  document.body.dataset.view = v;
  hideTip();
  if (v === 'game') requestAnimationFrame(layoutSeats);
}

/* 시작 */
$('#nameIn').value = S.name;
$('#nameForm').onsubmit = e => {
  e.preventDefault();
  const n = $('#nameIn').value.trim();
  if (!n) return;
  S.name = n; store.set('name', n);
  Snd.click();
  if (ws && ws.readyState === 1) send({ t: 'name', name: n }); else connect();
  go('lobby');
};

$('#renameBtn').onclick = () => {
  openModal(`<h3>이름 바꾸기</h3><form id="rnF" class="name-form"><input id="rnI" maxlength="12" value="${esc(S.name)}"><button class="btn">바꾸기</button></form>`);
  $('#rnI').focus(); $('#rnI').select();
  $('#rnF').onsubmit = e => { e.preventDefault(); const n = $('#rnI').value.trim(); if (n) { S.name = n; store.set('name', n); send({ t: 'name', name: n }); } closeModal(); };
};

/* ───────────── 대기방 ───────────── */
$('#createForm').onsubmit = e => { e.preventDefault(); Snd.click(); send({ t: 'create', title: $('#titleIn').value }); $('#titleIn').value = ''; };
$('#codeForm').onsubmit = e => { e.preventDefault(); const c = $('#codeIn').value.trim().toUpperCase(); if (c) send({ t: 'join', code: c }); $('#codeIn').value = ''; };

function renderLobby() {
  const L = S.lobby; if (!L) return;
  const list = $('#roomList');
  if (!L.rooms.length) list.innerHTML = '<div class="empty">아직 열린 방이 없습니다.<br>방을 만들고 봇과 먼저 해 보세요!</div>';
  else list.innerHTML = L.rooms.map(r => `
    <div class="room-item">
      <div class="rt">${esc(r.title)}<span class="badge ${r.phase !== 'wait' ? 'play' : ''}">${r.phase === 'wait' ? '모집 중' : r.phase === 'play' ? '게임 중' : '끝남'}</span></div>
      <button class="btn ${r.phase === 'wait' ? '' : 'ghost'} sm" data-join="${esc(r.code)}">${r.phase === 'wait' ? (r.n >= r.max ? '꽉 참' : '입장') : '구경'}</button>
      <div class="rm">#${esc(r.code)} · 방장 ${esc(r.host)} · ${r.n}/${r.max}명 (사람 ${r.humans})${r.watch ? ' · 구경 ' + r.watch : ''}</div>
    </div>`).join('');
  list.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { Snd.click(); send({ t: 'join', code: b.dataset.join }); });
  const on = L.online || [];
  $('#online').textContent = `접속 ${on.length}명`;
  $('#online').title = on.map(u => u.name).join(', ');
}

/* ───────────── 채팅 ───────────── */
const fmtT = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const chatHtml = m => m.sys
  ? `<div class="m sys">${esc(m.text)}</div>`
  : `<div class="m ${m.pid === S.pid ? 'mine' : ''}"><b>${esc(m.name)}</b>${esc(m.text)}<time>${fmtT(m.ts)}</time></div>`;
function renderChat(ch) {
  const logs = ch === 'lobby' ? [$('#lobbyChat')] : [$('#roomChat'), $('#gameChat')];
  const arr = ch === 'lobby' ? S.lobbyChat : S.roomChat;
  for (const el of logs) { el.innerHTML = arr.map(chatHtml).join(''); el.scrollTop = el.scrollHeight; }
}
function addChat(ch, m) {
  const logs = ch === 'lobby' ? [$('#lobbyChat')] : [$('#roomChat'), $('#gameChat')];
  for (const el of logs) {
    const stick = el.scrollTop + el.clientHeight > el.scrollHeight - 30;
    el.insertAdjacentHTML('beforeend', chatHtml(m));
    while (el.children.length > 120) el.firstChild.remove();
    if (stick) el.scrollTop = el.scrollHeight;
  }
  if (ch === 'room' && S.view === 'game' && $('.side').dataset.tab !== 'chat' && !m.sys) $('#chatDot').hidden = false;
}
document.querySelectorAll('.chat-form').forEach(f => f.onsubmit = e => {
  e.preventDefault();
  const i = f.querySelector('input'); const text = i.value.trim();
  if (!text) return;
  send({ t: 'chat', text }); i.value = '';
});

/* ───────────── 방 대기실 ───────────── */
$('#leaveBtn').onclick = () => { Snd.click(); send({ t: 'leave' }); };
$('#addBotBtn').onclick = () => { Snd.click(); send({ t: 'addbot' }); };
$('#startBtn').onclick = () => { Snd.click(); send({ t: 'start' }); };
$('#sitBtn').onclick = () => send({ t: 'sit' });
for (const [id, key] of [['#optMax', 'max'], ['#optTurn', 'turn'], ['#optReact', 'react']]) {
  $(id).onchange = () => send({ t: 'opt', [key]: Number($(id).value) });
}

function renderRoom() {
  const R = S.room; if (!R) return;
  const host = R.host === S.pid;
  $('#roomTitle').textContent = R.title;
  $('#roomCode').textContent = R.code;
  const slots = [];
  for (let i = 0; i < R.opts.max; i++) {
    const s = R.seats[i];
    if (!s) { slots.push(`<div class="slot free"><div class="sn">빈 자리</div>${host ? '<button class="btn ghost sm" data-addbot>🤖 봇</button>' : ''}</div>`); continue; }
    const isHost = s.id === R.host;
    slots.push(`<div class="slot ${s.on ? '' : 'off'}">
      ${isHost ? '<span class="crown">👑</span>' : ''}
      ${host && s.id !== S.pid ? `<button class="kick" data-kick="${esc(s.id)}" title="내보내기">✕</button>` : ''}
      <div class="sn">${s.bot ? '🤖 ' : '🤠 '}${esc(s.name)}</div>
      <div class="ss">${s.bot ? '봇' : s.id === S.pid ? '나' : s.on ? '준비' : '연결 끊김'}</div></div>`);
  }
  $('#seatList').innerHTML = slots.join('');
  $('#seatList').querySelectorAll('[data-kick]').forEach(b => b.onclick = () => send({ t: 'kick', pid: b.dataset.kick }));
  $('#seatList').querySelectorAll('[data-addbot]').forEach(b => b.onclick = () => send({ t: 'addbot' }));
  $('#watchers').textContent = R.watchers.length ? '구경: ' + R.watchers.join(', ') : '';
  $('#optMax').value = R.opts.max; $('#optTurn').value = R.opts.turn; $('#optReact').value = R.opts.react;
  $('#hostOpts').classList.toggle('locked', !host);
  $('#addBotBtn').hidden = !host || R.seats.length >= R.opts.max;
  $('#startBtn').hidden = !host;
  const seated = R.seats.some(s => s.id === S.pid);
  $('#sitBtn').hidden = seated;
  const n = R.seats.length;
  $('#roomHint').textContent = host
    ? (n < R.min ? `${R.min}명이 안 되면 모자란 자리는 봇으로 채워 시작합니다.` : `${n}명으로 시작합니다. 자리 순서와 역할은 무작위로 정해집니다.`)
    : '방장이 시작하기를 기다리는 중…';
}

/* ───────────── 판 ───────────── */
$('#exitBtn').onclick = () => {
  if (S.g && S.g.v.over) { send({ t: 'leave' }); return; }
  openModal(`<h3>나가기</h3><p style="text-align:center">판이 끝나기 전에 나가면 남은 판은 봇이 대신합니다.<br>같은 방 번호로 다시 들어오면 자리로 돌아올 수 있어요.</p>
    <div class="acts"><button class="btn ghost" data-x>계속하기</button><button class="btn" id="exitYes">나가기</button></div>`);
  $('#exitYes').onclick = () => { closeModal(); send({ t: 'leave' }); };
};
document.querySelectorAll('.side-tabs [data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('.side-tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b));
  $('.side').dataset.tab = b.dataset.tab;
  if (b.dataset.tab === 'chat') { $('#chatDot').hidden = true; const c = $('#gameChat'); c.scrollTop = c.scrollHeight; }
});
$('.side').dataset.tab = 'log';

function onGame(m) {
  const first = !S.g || m.reset;
  S.g = m; S.me = m.me; S.auto = m.auto;
  go('game');
  const v = m.v;
  const key = (S.room ? S.room.code : '') + ':' + v.players.map(p => p.id).join(',');
  // 요청이 바뀌면 고른 것을 비운다
  if (!v.req || v.req.seq !== S.lastSeq) { S.sel = []; S.mode = null; S.lastSeq = v.req ? v.req.seq : 0; }
  if (m.reset) $('#gameLog').innerHTML = '';
  addLogs(m.logs);
  S.timer = v.req && m.left ? { end: Date.now() + m.left * 1000, secs: m.secs, to: v.req.to } : null;
  render();
  if (!first) playFx(m.ev || []);
  if (S.seenGame !== key && m.me && !v.over) { S.seenGame = key; showReveal(); }
  if (v.over && !S.overShown) { S.overShown = true; setTimeout(showResult, first ? 0 : 1400); }
  if (!v.over) S.overShown = false;
}

function addLogs(logs) {
  const el = $('#gameLog');
  for (const l of logs || []) el.insertAdjacentHTML('beforeend', `<div class="l ${l.cls || ''}">${esc(l.text)}</div>`);
  while (el.children.length > 300) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

const P = id => S.g && S.g.v.players.find(p => p.id === id);
const mine = () => S.g && S.g.v.req && S.g.v.req.to === S.me;
const myP = () => S.me && P(S.me);

function render() {
  if (!S.g) return;
  renderSeats();
  renderCenter();
  renderHand();
  renderPrompt();
}

/* 자리 — 나를 아래에 두고 시계 방향(내 왼쪽이 다음 사람)으로 */
function renderSeats() {
  const v = S.g.v;
  const box = $('#seats');
  const req = v.req;
  const targets = targetSet();
  box.innerHTML = v.players.map(p => {
    const lost = p.max - Math.max(0, p.hp);
    const hp = Array.from({ length: p.max }, (_, i) => `<i class="${i >= p.hp ? 'lost' : ''}"></i>`).join('');
    const role = p.role ? `<span class="role ${p.role}" title="${ROLES[p.role].name}">${ROLE_ICON[p.role]}</span>` : '';
    const cls = ['seat', p.id === v.turn && !v.over ? 'turn' : '', req && req.to === p.id && req.to !== v.turn ? 'asked' : '',
      p.id === S.me ? 'me' : '', !p.alive ? 'dead' : '', targets.has(p.id) ? 'target' : ''].join(' ');
    const inRange = myP() && p.id !== S.me && p.alive && p.dist != null && p.dist <= myP().range;
    return `<div class="${cls}" data-pid="${esc(p.id)}">
      <div class="por" style="background-image:url(${CHAR_IMG(p.char)})" data-char="${p.char}">${role}</div>
      <div class="nm">${esc(p.name)}${p.bot ? '<span class="bot">봇</span>' : ''}${p.id === S.me ? ' (나)' : ''}</div>
      <div class="cn" data-char="${p.char}">${CHARS[p.char].name}${p.role && !p.alive ? ' · ' + ROLES[p.role].name : ''}</div>
      <div class="hp" title="생명 ${Math.max(0, p.hp)}/${p.max}">${hp}</div>
      <div class="meta"><span class="hc" title="손에 든 카드">🂠 ${p.hand}</span>${p.dist != null && p.id !== S.me ? `<span title="내가 보는 거리" style="${inRange ? 'background:#c23a2233' : ''}">거리 ${p.dist}</span>` : ''}<span class="rg" title="사거리">🎯 ${p.range}</span></div>
      <div class="tbl">${p.table.map(c => cardHtml(c, 'mini')).join('')}</div>
      <div class="ring"><i></i></div>
    </div>`;
  }).join('');
  box.querySelectorAll('.seat').forEach(el => {
    el.onclick = () => clickSeat(el.dataset.pid);
  });
  layoutSeats();
}

function layoutSeats() {
  if (!S.g) return;
  const t = $('#table').getBoundingClientRect();
  const v = S.g.v, n = v.players.length;
  const meIdx = Math.max(0, v.players.findIndex(p => p.id === S.me));
  const cx = t.width / 2, cy = t.height * 0.48;
  const rx = t.width * 0.40, ry = t.height * 0.39;
  document.querySelectorAll('#seats .seat').forEach((el, i) => {
    const off = (i - meIdx + n) % n;
    const a = (90 + off * 360 / n) * Math.PI / 180;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
    x = Math.min(t.width - w / 2 - 6, Math.max(w / 2 + 6, x));
    y = Math.min(t.height - h / 2 - 4, Math.max(h / 2 + 40, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  });
}
addEventListener('resize', () => requestAnimationFrame(layoutSeats));

function renderCenter() {
  const v = S.g.v;
  $('#deckN').textContent = `더미 ${v.deck}`;
  $('#discardPile').innerHTML = v.pile ? cardHtml(v.pile) : '';
  $('#store').innerHTML = v.store.map(c => cardHtml(c)).join('');
  const r = v.req;
  if (r && r.kind === 'store' && r.to === S.me) $('#store').querySelectorAll('.card').forEach(el => { el.style.cursor = 'pointer'; el.onclick = () => act({ a: 'pick', c: +el.dataset.cid }); });
}

/* 카드 그림 */
function cardHtml(c, extra = '') {
  const def = KINDS[c.k];
  const red = c.s === 'H' || c.s === 'D';
  return `<div class="card ${def.blue ? 'blue' : ''} ${extra}" data-cid="${c.id}" data-k="${c.k}">
    <span class="tg ${red ? 'r' : ''}">${RANKS[c.r]}${SUITS[c.s]}</span>
    <div class="art" style="background-image:url(${CARD_IMG(c.k)})"></div>
    <div class="nmc">${def.name}</div>
    <div class="ds">${shortDesc(c.k)}</div></div>`;
}
const SHORT = {
  bang: '사거리 안의 1명을 쏜다', missed: '뱅! 하나를 막는다', beer: '생명 +1', saloon: '모두 생명 +1', stagecoach: '2장 뽑기', wellsfargo: '3장 뽑기',
  generalstore: '모두 1장씩 고르기', panic: '거리 1 — 1장 빼앗기', catbalou: '아무나 — 1장 버리게', gatling: '모두에게 뱅!', indians: '모두 뱅!을 버리거나 −1', duel: '뱅!을 번갈아 버리기',
  barrel: '하트면 빗나감!', scope: '남이 1 가까이', mustang: '나는 1 멀리', jail: '하트 아니면 턴 거름', dynamite: '♠2~9면 −3',
  volcanic: '사거리 1 · 뱅! 무제한', schofield: '사거리 2', remington: '사거리 3', carabine: '사거리 4', winchester: '사거리 5',
};
const shortDesc = k => SHORT[k] || '';

/* 손 */
function renderHand() {
  const v = S.g.v;
  const el = $('#hand');
  if (!v.me) { el.innerHTML = '<div style="color:#fff4e0;opacity:.7;padding:30px">구경하는 중입니다</div>'; return; }
  const ok = eligible();
  const now = new Set(v.me.hand.map(c => c.id));
  el.innerHTML = v.me.hand.map(c => cardHtml(c, [S.sel.includes(c.id) ? 'sel' : '', ok ? (ok.has(c.id) ? 'can' : 'dim') : '', S.prevHand.size && !S.prevHand.has(c.id) ? 'new' : ''].join(' '))).join('');
  S.prevHand = now;
  el.querySelectorAll('.card').forEach(c => {
    c.onclick = () => clickCard(+c.dataset.cid);
    c.ondblclick = () => { const id = +c.dataset.cid; const r = S.g.v.req; if (r && r.kind === 'play' && mine() && r.moves[id] && !r.moves[id].tg) act({ a: 'play', c: id }); };
  });
}

/** 지금 누를 수 있는 손 카드(밝힘). null 이면 다 보통으로 */
function eligible() {
  const v = S.g.v, r = v.req;
  if (!r || r.to !== S.me || !v.me) return null;
  const hand = v.me.hand;
  if (r.kind === 'play') {
    if (S.mode === 'sid') return new Set(hand.map(c => c.id));
    return new Set(Object.keys(r.moves).map(Number));
  }
  if (r.kind === 'discard') return new Set(hand.map(c => c.id));
  if (r.kind === 'react') return new Set(hand.filter(c => r.ok.includes(c.k)).map(c => c.id));
  if (r.kind === 'dying') {
    if (S.mode === 'sid') return new Set(hand.map(c => c.id));
    return new Set(hand.filter(c => c.k === 'beer').map(c => c.id));
  }
  return new Set();
}

/** 지금 누를 수 있는 자리 */
function targetSet() {
  const v = S.g.v, r = v.req;
  if (!r || r.to !== S.me) return new Set();
  if (r.kind === 'play' && S.sel.length === 1 && !S.mode) {
    const mv = r.moves[S.sel[0]];
    if (mv && mv.tg) return new Set(mv.tg);
  }
  if (r.kind === 'jesse') return new Set(v.players.filter(p => p.alive && p.id !== S.me && p.hand > 0).map(p => p.id));
  return new Set();
}

function clickCard(id) {
  const v = S.g.v, r = v.req;
  Snd.click();
  if (!r || r.to !== S.me) { showTipFor(id); return; }
  const ok = eligible();
  if (r.kind === 'play' && !S.mode) {
    if (!ok.has(id)) { toast(whyNotHint(id)); return; }
    if (S.sel[0] === id) {
      const mv = r.moves[id];
      if (!mv.tg) return act({ a: 'play', c: id });
      S.sel = []; render(); return;
    }
    S.sel = [id];
    const mv = r.moves[id];
    if (mv.tg && mv.tg.length === 1 && isMobile()) { /* 대상이 하나뿐이어도 직접 누르게 한다 — 실수 방지 */ }
    render();
    return;
  }
  if (!ok || !ok.has(id)) return;
  const max = r.kind === 'discard' ? r.n : r.kind === 'react' ? r.need : S.mode === 'sid' ? 2 : 1;
  if (S.sel.includes(id)) S.sel = S.sel.filter(x => x !== id);
  else { S.sel.push(id); if (S.sel.length > max) S.sel.shift(); }
  if (r.kind === 'dying' && !S.mode) return act({ a: 'beer', c: id });
  render();
}

function whyNotHint(id) {
  const c = S.g.v.me.hand.find(x => x.id === id);
  const p = myP();
  if (!c) return '';
  if (c.k === 'missed') return p.char === 'calamity' ? '사거리 안에 쏠 사람이 없거나 이미 뱅!을 쐈습니다' : '빗나감!은 뱅!을 막을 때 씁니다';
  if (c.k === 'bang') return S.g.v.bangs >= 1 ? '뱅!은 한 턴에 한 장만 쏠 수 있습니다' : '사거리 안에 쏠 사람이 없습니다';
  if (c.k === 'beer') return '생명이 가득하거나, 두 명만 남아 맥주가 듣지 않습니다';
  if (c.k === 'panic') return '거리 1 안에 카드를 가진 사람이 없습니다';
  if (KINDS[c.k].blue) return '이미 같은 카드를 앞에 놓았습니다';
  return '지금은 낼 수 없습니다';
}

function clickSeat(pid) {
  const v = S.g.v, r = v.req;
  if (!r || r.to !== S.me) return;
  if (r.kind === 'jesse') { const p = P(pid); if (p && p.alive && p.hand && pid !== S.me) act({ a: 'from', t: pid }); return; }
  if (r.kind !== 'play' || S.sel.length !== 1) return;
  const c = S.sel[0], mv = r.moves[c];
  if (!mv || !mv.tg || !mv.tg.includes(pid)) return;
  if (mv.steal) return stealPicker(c, pid);
  act({ a: 'play', c, t: pid });
}

/** 강탈 · 캣 벌로우: 손(무작위)이냐 앞에 놓인 카드냐 */
function stealPicker(c, pid) {
  const p = P(pid);
  const kind = S.g.v.me.hand.find(x => x.id === c).k;
  const opts = [];
  if (p.hand) opts.push(`<div class="handback" data-tc="hand"><div class="card back" style="--cw:78px;--ch:112px"></div>손에서 무작위 1장<br>(${p.hand}장)</div>`);
  for (const t of p.table) opts.push(`<div class="handback" data-tc="${t.id}">${cardHtml(t).replace('class="card', 'style="--cw:78px;--ch:112px" class="card')}${KINDS[t.k].name}</div>`);
  openModal(`<button class="x" data-x>✕</button><h3>${KINDS[kind].name}</h3><p style="text-align:center">${esc(p.name)} 님의 어떤 카드를 ${kind === 'panic' ? '빼앗을까요' : '버리게 할까요'}?</p><div class="steal-pick">${opts.join('')}</div>`);
  document.querySelectorAll('.steal-pick [data-tc]').forEach(el => el.onclick = () => {
    closeModal();
    act({ a: 'play', c, t: pid, tc: el.dataset.tc === 'hand' ? 'hand' : +el.dataset.tc });
  });
}

function act(r) {
  const v = S.g.v;
  if (!v.req) return;
  Snd.click();
  S.sentSeq = v.req.seq;
  send({ t: 'act', seq: v.req.seq, r });
  S.sel = []; S.mode = null;
}

/* 안내 막대 */
const WHY = { bang: '뱅!', gatling: '기관총', indians: '인디언!', duel: '결투' };
function renderPrompt() {
  const v = S.g.v, r = v.req;
  const el = $('#prompt'), tx = $('#pText'), bt = $('#pBtns');
  el.classList.toggle('mine', !!mine());
  let text = '', btns = [];
  const B = (label, fn, cls = '', dis = false) => btns.push({ label, fn, cls, dis });
  const me = myP();
  if (v.over) {
    text = v.over.team === 'sheriff' ? '⭐ 보안관 편 승리!' : v.over.team === 'outlaw' ? '💀 무법자 승리!' : '🎭 배신자 승리!';
    B('결과 보기', showResult, 'ghost');
  } else if (!r) {
    text = '…';
  } else if (r.to !== S.me) {
    const who = P(r.to);
    const doing = { play: '카드를 내는 중', discard: '카드를 버리는 중', react: r.why === 'duel' ? '결투 중' : '막을지 고민하는 중', dying: '맥주를 찾는 중', store: '잡화점에서 고르는 중', jesse: '카드를 가져올 곳을 고르는 중', pedro: '카드를 가져올 곳을 고르는 중', kit: '카드를 고르는 중' }[r.kind];
    text = `${who ? esc(who.name) : ''} 님이 ${doing}…`;
    if (!S.me) text += '<small>구경하는 중입니다</small>';
    else if (me && !me.alive) text += '<small>쓰러졌습니다 — 끝까지 구경할 수 있어요</small>';
  } else {
    switch (r.kind) {
      case 'play': {
        if (S.mode === 'sid') {
          text = `시드 케첨 — 버릴 카드 2장을 고르세요 (${S.sel.length}/2)`;
          B('생명 +1', () => act({ a: 'sid', cs: S.sel }), 'green', S.sel.length !== 2);
          B('취소', () => { S.mode = null; S.sel = []; render(); }, 'ghost');
          break;
        }
        const c = S.sel.length === 1 && v.me.hand.find(x => x.id === S.sel[0]);
        if (c) {
          const mv = r.moves[c.id];
          text = `${KINDS[c.k].name} <small>${esc(KINDS[c.k].desc)}</small>`;
          if (mv && mv.tg) text = `${KINDS[c.k].name} — 대상을 누르세요 <small>${esc(KINDS[c.k].desc)}</small>`;
          else B('사용', () => act({ a: 'play', c: c.id }), '');
          B('취소', () => { S.sel = []; render(); }, 'ghost');
        } else {
          text = `당신의 차례 — 카드를 내세요<small>밝은 카드를 누르면 고르고, 한 번 더 누르면 씁니다. ${me.char === 'willy' || me.table.some(t => t.k === 'volcanic') ? '뱅! 무제한' : v.bangs ? '이번 턴 뱅! 사용함' : '뱅!은 한 턴에 한 장'}</small>`;
        }
        if (me.char === 'sid' && me.hp < me.max && v.me.hand.length >= 2 && !c) B('시드: 2장 버리고 +1', () => { S.mode = 'sid'; S.sel = []; render(); }, 'green');
        B('턴 끝내기', () => act({ a: 'end' }), 'blue');
        break;
      }
      case 'discard':
        text = `손 카드가 생명보다 많습니다 — ${r.n}장을 버리세요 (${S.sel.length}/${r.n})`;
        B('버리기', () => act({ a: 'discard', cs: S.sel }), '', S.sel.length !== r.n);
        break;
      case 'react': {
        const from = P(r.from);
        const okName = r.ok.map(k => KINDS[k].name).join(' 또는 ');
        if (r.why === 'bang' || r.why === 'gatling') text = `${esc(from.name)} 님의 ${WHY[r.why]}${r.why === 'gatling' ? '!' : ''} ${r.need > 1 ? `빗나감! ${r.need}장이 있어야 막습니다` : '막으시겠습니까?'}`;
        else if (r.why === 'indians') text = `${esc(from.name)} 님의 인디언! 뱅!을 1장 버리거나 생명 1을 잃습니다`;
        else text = `${esc(from.name)} 님과 결투! 뱅!을 1장 버리거나 생명 1을 잃습니다`;
        text += `<small>${okName} ${r.need}장 — 카드를 골라도 되고, 그냥 막기를 눌러도 됩니다</small>`;
        const elig = v.me.hand.filter(c => r.ok.includes(c.k));
        B(r.why === 'bang' || r.why === 'gatling' ? `막기 (${r.need}장)` : '뱅! 버리기', () => {
          let cs = S.sel.filter(id => elig.some(c => c.id === id));
          // 빗나감!을 먼저(캘러미티라도 뱅!은 아껴 둔다), 모자라면 나머지
          for (const c of [...elig].sort((a, b) => (a.k === r.ok[0] ? -1 : 1) - (b.k === r.ok[0] ? -1 : 1))) { if (cs.length >= r.need) break; if (!cs.includes(c.id)) cs.push(c.id); }
          act({ a: 'cards', cs: cs.slice(0, r.need) });
        }, 'blue', elig.length < r.need);
        B('맞기 (생명 −1)', () => act({ a: 'take' }), '');
        break;
      }
      case 'dying': {
        text = `마지막 생명을 잃었습니다! 생명 ${r.need}만큼 버텨야 삽니다`;
        if (S.mode === 'sid') {
          text = `시드 케첨 — 버릴 카드 2장 (${S.sel.length}/2)`;
          B('생명 +1', () => act({ a: 'sid', cs: S.sel }), 'green', S.sel.length !== 2);
          B('취소', () => { S.mode = null; S.sel = []; render(); }, 'ghost');
          break;
        }
        const beer = v.me.hand.find(c => c.k === 'beer');
        if (beer && v.players.filter(p => p.alive).length > 2) B('🍺 맥주 마시기', () => act({ a: 'beer', c: beer.id }), 'green');
        if (me.char === 'sid' && v.me.hand.length >= 2) B('시드: 2장 버리고 +1', () => { S.mode = 'sid'; S.sel = []; render(); }, 'green');
        B('쓰러지기', () => act({ a: 'die' }), 'ghost');
        break;
      }
      case 'store':
        text = '잡화점 — 가운데 펼친 카드 중 1장을 고르세요';
        setTimeout(() => storeModal(r), 0);
        break;
      case 'jesse':
        text = '제시 존스 — 첫 장을 더미에서, 또는 다른 사람의 손에서(자리를 누르세요) 가져옵니다';
        B('더미에서 뽑기', () => act({ a: 'deck' }), 'blue');
        break;
      case 'pedro':
        text = `페드로 라미레즈 — 첫 장을 어디서 가져올까요? <small>버린 카드 맨 위: ${KINDS[r.top.k].name} ${RANKS[r.top.r]}${SUITS[r.top.s]}</small>`;
        B('더미에서 뽑기', () => act({ a: 'deck' }), 'blue');
        B(`버린 ${KINDS[r.top.k].name} 가져오기`, () => act({ a: 'discard' }), '');
        break;
      case 'kit':
        text = '킷 칼슨 — 3장 중 더미 위로 돌려놓을 1장을 고르세요';
        setTimeout(() => kitModal(r), 0);
        break;
    }
  }
  if (S.auto && S.me && me && me.alive && !v.over) {
    text = '💤 자리 비움 — 봇이 대신 두는 중입니다';
    btns = [{ label: '돌아왔어요', fn: () => send({ t: 'back' }), cls: 'green' }];
  }
  tx.innerHTML = text;
  bt.innerHTML = '';
  for (const b of btns) {
    const e = document.createElement('button');
    e.className = 'btn sm ' + b.cls; e.textContent = b.label; e.disabled = b.dis; e.onclick = b.fn;
    bt.appendChild(e);
  }
  if (mine() && r && r.kind !== 'play') { /* 막기 등 내 차례면 기록 대신 판이 보이게 */ }
}

function storeModal(r) {
  if (!mine() || S.g.v.req.kind !== 'store' || !$('#modal').hidden || S.sentSeq === S.g.v.req.seq) return;
  openModal(`<h3>잡화점</h3><p style="text-align:center">가져갈 카드 1장을 고르세요</p><div class="row">${r.cards.map(c => cardHtml(c)).join('')}</div>`, true);
  document.querySelectorAll('#modalBox .row .card').forEach(el => el.onclick = () => { closeModal(); act({ a: 'pick', c: +el.dataset.cid }); });
}
function kitModal(r) {
  if (!mine() || S.g.v.req.kind !== 'kit' || !$('#modal').hidden || S.sentSeq === S.g.v.req.seq) return;
  openModal(`<h3>킷 칼슨</h3><p style="text-align:center">더미 위로 <b>돌려놓을</b> 1장을 고르세요 — 나머지 2장을 가집니다</p><div class="row">${r.cards.map(c => cardHtml(c)).join('')}</div>`, true);
  document.querySelectorAll('#modalBox .row .card').forEach(el => el.onclick = () => { closeModal(); act({ a: 'back', c: +el.dataset.cid }); });
}

/* 남은 시간 */
function tickTimer() {
  requestAnimationFrame(tickTimer);
  const bar = $('#timerBar');
  const t = S.timer;
  if (!t || S.view !== 'game') { bar.style.transform = 'scaleX(0)'; document.querySelectorAll('.seat .ring i').forEach(i => i.style.transform = 'scaleX(0)'); return; }
  const f = Math.max(0, Math.min(1, (t.end - Date.now()) / (t.secs * 1000)));
  bar.style.transform = `scaleX(${f})`;
  bar.style.background = f < .25 ? 'var(--red-hi)' : 'var(--gold)';
  document.querySelectorAll('.seat').forEach(el => { const i = el.querySelector('.ring i'); if (i) i.style.transform = `scaleX(${el.dataset.pid === t.to ? f : 0})`; });
}
requestAnimationFrame(tickTimer);

/* ───────────── 연출 ───────────── */
const seatEl = id => document.querySelector(`#seats .seat[data-pid="${CSS.escape(String(id))}"]`);
function seatPos(id) {
  const el = seatEl(id), t = $('#table').getBoundingClientRect();
  if (!el) return { x: t.width / 2, y: t.height / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left - t.left + r.width / 2, y: r.top - t.top + r.height / 2 };
}
function fxText(id, text, cls = '', delay = 0) {
  setTimeout(() => {
    const p = id == null ? { x: $('#table').clientWidth / 2, y: $('#table').clientHeight * .4 } : seatPos(id);
    const e = document.createElement('div');
    e.className = 'fx ' + cls; e.textContent = text;
    e.style.left = p.x + 'px'; e.style.top = (p.y - 20) + 'px';
    $('#fxLayer').appendChild(e);
    setTimeout(() => e.remove(), 1300);
  }, delay);
}
function tracer(a, b, delay = 0) {
  setTimeout(() => {
    const p = seatPos(a), q = seatPos(b);
    const e = document.createElement('div');
    e.className = 'tracer';
    const dx = q.x - p.x, dy = q.y - p.y;
    e.style.left = p.x + 'px'; e.style.top = p.y + 'px';
    e.style.width = Math.hypot(dx, dy) + 'px';
    e.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    $('#fxLayer').appendChild(e);
    setTimeout(() => e.remove(), 400);
  }, delay);
}
function shake(id, delay = 0) { setTimeout(() => { const el = seatEl(id); if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); } }, delay); }
function banner(text) { const b = $('#banner'); b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
let flipT = null;
function showFlip(e) {
  const f = $('#flip');
  const byId = id => ({ id, ...cardOf(id) });
  f.innerHTML = e.cs.map(id => cardHtml(byId(id))).join('') + `<div class="verdict ${e.ok ? 'ok' : 'no'}">${e.what} 뽑기! ${e.ok ? '성공' : '실패'}</div>`;
  clearTimeout(flipT); flipT = setTimeout(() => { f.innerHTML = ''; }, 1700);
}
/* 카드 id → 무늬·종류. 서버 덱과 같은 순서로 cards.js 에서 만든다 */
const cardOf = id => DECK[id];

function playFx(evs) {
  let d = 0;
  for (const e of evs) {
    switch (e.fx) {
      case 'turn': {
        const p = P(e.id);
        if (e.id === S.me) { banner('당신의 차례!'); Snd.turn(); } else if (p) banner(`${p.name} 님의 차례`);
        break;
      }
      case 'shot': tracer(e.from, e.to, d); setTimeout(() => Snd.shot(), d); fxText(e.to, 'BANG!', '', d); d += 250; break;
      case 'hurt': fxText(e.id, '−' + e.n, 'dmg', d + 100); shake(e.id, d + 100); setTimeout(() => Snd.hurt(), d + 100); d += 200; break;
      case 'heal': fxText(e.id, '+1', 'heal', d); setTimeout(() => Snd.heal(), d); break;
      case 'dodge': fxText(e.id, '빗나감!', 'miss', d + 150); setTimeout(() => Snd.miss(), d + 150); d += 200; break;
      case 'flip': setTimeout(() => showFlip(e), d); d += 400; break;
      case 'boom': fxText(e.id, '💥', 'big', d); setTimeout(() => Snd.boom(), d); shake(e.id, d); d += 300; break;
      case 'die': { const p = P(e.id); fxText(e.id, '☠', 'big', d); setTimeout(() => { Snd.die(); banner(`${p ? p.name : ''} 쓰러짐 — ${ROLES[e.role].name}`); }, d); d += 400; break; }
      case 'jailed': fxText(e.id, '⛓ 턴 거름', 'miss', d); break;
      case 'gatling': fxText(null, '기관총!', 'big', d); setTimeout(() => { Snd.shot(.5); setTimeout(() => Snd.shot(.4), 120); setTimeout(() => Snd.shot(.35), 240); }, d); d += 300; break;
      case 'indians': fxText(null, '인디언!', 'big', d); d += 300; break;
      case 'play': if (e.c != null && !['bang', 'missed'].includes(cardOf(e.c).k)) fxText(e.id, KINDS[cardOf(e.c).k].name, 'miss', d); break;
      case 'equip': if (e.c != null) fxText(e.id, KINDS[cardOf(e.c).k].name, 'miss', d); break;
      case 'steal': if (e.to === S.me) toast(`${(P(e.from) || {}).name || ''} 님에게서 카드를 가져왔습니다`); else if (e.from === S.me) toast(`${(P(e.to) || {}).name || ''} 님이 내 카드를 가져갔습니다`); break;
      case 'over': setTimeout(() => Snd.win(), d + 300); break;
      case 'reshuffle': toast('버린 카드를 섞어 새 더미를 만들었습니다'); break;
    }
  }
}

/* ───────────── 창 ───────────── */
function openModal(html, sticky) {
  $('#modalBox').innerHTML = html;
  $('#modal').hidden = false;
  $('#modal').dataset.sticky = sticky ? '1' : '';
  $('#modalBox').querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);
}
function closeModal() {
  const was = !$('#modal').hidden;
  $('#modal').hidden = true; $('#modalBox').innerHTML = '';
  if (was && S.view === 'game' && S.g) setTimeout(renderPrompt, 0);   // 가려져 있던 잡화점·킷 창을 다시 띄운다
}
$('#modal').onclick = e => { if (e.target === $('#modal') && !$('#modal').dataset.sticky) closeModal(); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden && !$('#modal').dataset.sticky) closeModal(); });

let toastT = null;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

function showReveal() {
  const p = myP(); if (!p) return;
  const sh = S.g.v.players.find(x => x.role === 'sheriff');
  openModal(`<h3>당신의 정체</h3>
    <div class="reveal">
      <div class="rcard"><div class="img" style="background-image:url(${ROLE_IMG(p.role)})"></div><h4>${ROLE_ICON[p.role]} ${ROLES[p.role].name}</h4><p>${ROLES[p.role].goal}</p></div>
      <div class="rcard"><div class="img" style="background-image:url(${CHAR_IMG(p.char)})"></div><h4>${CHARS[p.char].name}</h4><p>생명 ${p.max} · ${CHARS[p.char].desc}</p></div>
    </div>
    <p style="text-align:center;margin:14px 0 0">${p.role === 'sheriff' ? '당신이 보안관입니다. 모두가 알고 있어요 — 당신부터 시작합니다.' : `보안관은 <b>${esc(sh.name)}</b> 님입니다. 정체는 들키지 않게!`}</p>
    <div class="acts"><button class="btn big" data-x>확인</button></div>`);
}

function showResult() {
  const v = S.g && S.g.v; if (!v || !v.over) return;
  const host = S.room && S.room.host === S.pid;
  const win = new Set(v.over.winners);
  const title = v.over.team === 'sheriff' ? '⭐ 보안관 편 승리' : v.over.team === 'outlaw' ? '💀 무법자 승리' : '🎭 배신자 승리';
  const meWon = S.me && win.has(S.me);
  openModal(`<button class="x" data-x>✕</button><h3>${title}</h3>
    ${S.me ? `<p style="text-align:center;font:900 18px var(--kr);margin:0">${meWon ? '🏆 이겼습니다!' : '졌습니다…'}</p>` : ''}
    <div class="result-list">${v.players.map(p => `<div class="${win.has(p.id) ? 'win' : ''}"><b>${ROLE_ICON[p.role]} ${esc(p.name)}</b><br>${ROLES[p.role].name} · ${CHARS[p.char].name}<br>${p.alive ? '생존' : '☠ 쓰러짐'}</div>`).join('')}</div>
    <div class="acts">${host ? '<button class="btn big" id="againBtn">다시 하기</button>' : '<span style="opacity:.7;align-self:center">방장이 다시 하기를 누르면 대기실로 돌아갑니다</span>'}<button class="btn ghost" id="toLobby">대기방으로</button></div>`);
  if ($('#againBtn')) $('#againBtn').onclick = () => { closeModal(); send({ t: 'again' }); };
  $('#toLobby').onclick = () => { closeModal(); send({ t: 'leave' }); };
}

/* 크게 보기 — 카드나 인물에 마우스를 올리면 */
const tip = $('#tip');
function hideTip() { tip.hidden = true; }
function tipCard(c) {
  return `${cardHtml(c)}<h4>${KINDS[c.k].name} <small style="font-weight:500">${RANKS[c.r]}${SUITS[c.s]}${KINDS[c.k].blue ? ' · 파란 카드' : ''}</small></h4><p>${esc(KINDS[c.k].desc)}</p>`;
}
function tipChar(k) { return `<div class="por" style="background-image:url(${CHAR_IMG(k)})"></div><h4>${CHARS[k].name}</h4><p>생명 ${CHARS[k].hp} · ${esc(CHARS[k].desc)}</p>`; }
function placeTip(x, y) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let L = x + 18, T = y - h / 2;
  // 손 카드 위라면 카드를 가리지 않게 위로 띄운다
  if (y > innerHeight * .62) { L = x - w / 2; T = y - h - 30; }
  if (L + w > innerWidth - 8) L = Math.min(x - w - 18, innerWidth - w - 8);
  L = Math.max(8, L);
  T = Math.max(8, Math.min(innerHeight - h - 8, T));
  tip.style.left = L + 'px'; tip.style.top = T + 'px';
}
let tipT = null, tipAt = null;
document.addEventListener('mouseover', e => {
  if (matchMedia('(hover: none)').matches) return;
  const c = e.target.closest('.card[data-cid]');
  const ch = !c && e.target.closest('[data-char]');
  clearTimeout(tipT);
  if (!(c && !c.closest('#tip')) && !ch) { hideTip(); return; }
  tipT = setTimeout(() => {
    tip.innerHTML = c ? tipCard({ ...DECK[+c.dataset.cid] }) : tipChar(ch.dataset.char);
    tip.hidden = false;
    if (tipAt) placeTip(tipAt.x, tipAt.y);
  }, tip.hidden ? 380 : 60);
});
document.addEventListener('mousemove', e => { tipAt = { x: e.clientX, y: e.clientY }; if (!tip.hidden) placeTip(e.clientX, e.clientY); });
document.addEventListener('pointerdown', () => { clearTimeout(tipT); hideTip(); });
function showTipFor(id) { if (matchMedia('(hover: none)').matches) toast(KINDS[DECK[id].k].name + ' — ' + KINDS[DECK[id].k].desc); }

/* ───────────── 규칙 ───────────── */
function showRules() {
  const cards = Object.entries(KINDS).map(([k, d]) => `<div><b>${d.name}</b>${d.blue ? ' 🟦' : ''} — ${esc(d.desc)}</div>`).join('');
  const chars = Object.entries(CHARS).map(([k, d]) => `<div><b>${d.name}</b> (${d.hp}) — ${esc(d.desc)}</div>`).join('');
  openModal(`<button class="x" data-x>✕</button><div class="rules"><h3>뱅! 규칙</h3>
    <h4>정체</h4>
    <p>모두 역할 카드를 한 장씩 몰래 받습니다. <b>보안관</b>만 정체를 드러내고, 나머지는 숨깁니다.</p>
    <ul><li>⭐ <b>보안관</b> — 무법자와 배신자를 모두 쓰러뜨리면 승리 (생명 +1)</li>
    <li>🔰 <b>부관</b> — 보안관을 도와 같은 목표</li>
    <li>💀 <b>무법자</b> — 보안관을 쓰러뜨리면 승리</li>
    <li>🎭 <b>배신자</b> — 혼자 살아남으면 승리. 보안관은 맨 마지막에 쓰러뜨려야 합니다</li></ul>
    <p>4명: 보안관 · 배신자 · 무법자 2 / 5명: +부관 / 6명: +무법자 / 7명: +부관</p>
    <h4>내 차례</h4>
    <ol><li>카드 2장을 뽑습니다.</li><li>카드를 원하는 만큼 냅니다. 단, <b>뱅!은 한 턴에 한 장</b>.</li><li>손 카드가 남은 생명보다 많으면 그만큼 버립니다.</li></ol>
    <h4>거리와 사거리</h4>
    <p>거리는 살아 있는 사람 사이의 자리 수(왼쪽·오른쪽 중 가까운 쪽)입니다. 뱅!은 내 <b>사거리</b>(무기가 없으면 1) 안의 사람에게만 쏠 수 있습니다. 야생마는 남이 나를 볼 때 +1, 조준경은 내가 남을 볼 때 −1.</p>
    <h4>쓰러짐</h4>
    <p>생명이 0이 되면 맥주로 버티지 못하는 한 쓰러지고 정체를 밝힙니다. 무법자를 쓰러뜨린 사람은 현상금으로 3장을 뽑고, 보안관이 부관을 쓰러뜨리면 보안관은 가진 카드를 모두 버립니다.</p>
    <h4>뽑기!</h4>
    <p>술통 · 감옥 · 다이너마이트는 더미 맨 위 카드를 뒤집어 무늬로 판가름합니다. 술통·감옥은 ♥면 성공, 다이너마이트는 ♠2~9면 터집니다.</p>
    <h4>카드</h4><div class="grid">${cards}</div>
    <h4>인물</h4><div class="grid">${chars}</div>
    <h4>이 화면에서</h4>
    <p>밝게 빛나는 카드를 누르면 고르고, 한 번 더 누르면(또는 두 번 누르면) 씁니다. 대상이 필요한 카드는 빨갛게 빛나는 자리를 누르세요. 카드나 인물 위에 마우스를 올리면 크게 보입니다. 시간이 다 되면 턴이 끝나고, 막기는 봇이 대신 고릅니다.</p>
    <p>채팅은 자유지만, 손에 든 카드를 그대로 말하는 건 반칙이에요.</p>
  </div>`);
}
$('#rulesBtn').onclick = showRules;
$('#rulesBtn2').onclick = showRules;

/* 이미 이름이 있으면 바로 들어간다(새로고침해도 하던 판으로) — 모든 선언이 끝난 뒤에 */
if (S.name && S.pid) { connect(); go('lobby'); }
