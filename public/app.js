/**
 * 뱅! — 화면. 규칙은 서버가 쥐고, 여기서는 받은 것을 그리고 누른 것을 보낸다.
 * 접속 · 재접속 · 열린 방 목록 · 관전 · 채팅은 허브의 다른 게임(로보77 · 바퀴벌레 포커)과 같은 짜임이다.
 *
 * 판에서는 서버가 보낸 상태를 한 통씩 줄 세워 그린다. 연출(fx)이 딸려 오면 총알이 날아가고
 * "BANG!"이 터지는 것을 다 보여 준 뒤에 다음 상태로 넘어간다 — 서버도 그만큼 봇을 기다리게 한다.
 */
import { KINDS, CHARS, ROLES, SUITS, RANKS, DECK, EVENTS, ROLES_BY_N } from './cards.js';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
/** 조사 — 받침이 있으면 a, 없으면 b */
const josa = (w, a, b) => { const s = String(w), ch = s.charCodeAt(s.length - 1); return (ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28) ? a : b; };
const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
const ss = { get(k) { try { return sessionStorage.getItem('bang.' + k); } catch (_) { return null; } }, set(k, v) { try { sessionStorage.setItem('bang.' + k, v); } catch (_) {} }, del(k) { try { sessionStorage.removeItem('bang.' + k); } catch (_) {} } };

const CHAR_IMG = c => `/img/chars/${c}.webp`;
const ROLE_IMG = r => `/img/roles/${r}.webp`;
const CARD_IMG = k => `/img/cards/${k}.webp`;
const ICON = n => `/img/ui/icons/${n}.webp`;
const ROLE_EMO = { sheriff: '⭐', deputy: '🔰', outlaw: '💀', renegade: '🎭' };
const ROLE_ICON = { sheriff: 'star_sheriff', deputy: 'star_deputy', outlaw: 'outlaw', renegade: 'renegade' };
const roleImg = (r, cls = 'ri') => `<img class="${cls}" src="${ICON(ROLE_ICON[r])}" alt="${ROLES[r].name}">`;
const EMO = ['🤠', '😏', '🤔', '😱', '😤', '👏'];
/** 연출 한 가지가 걸리는 시간 — src/hub.js 의 FX_MS 와 같아야 한다 */
const FX_MS = {
  turn: 1300, shot: 900, hurt: 650, heal: 600, dodge: 750, flip: 1600, boom: 1600, die: 2400,
  jailed: 1300, gatling: 1100, indians: 1100, play: 700, equip: 700, steal: 800, lose: 700,
  store: 1000, take: 550, draw: 450, show: 1100, pass: 900, spend: 500, discard: 450, over: 1500, reshuffle: 800,
  event: 3000, revive: 1600,
};

/* 그림을 미리 받아 둔다 — 처음 뒤집힐 때 빈 칸이 보이지 않게 */
setTimeout(() => {
  const list = [...Object.keys(KINDS).map(CARD_IMG), ...Object.keys(CHARS).map(CHAR_IMG), ...Object.keys(ROLES).map(ROLE_IMG), ROLE_IMG('back'), CARD_IMG('back')];
  for (const s of list) { const i = new Image(); i.src = s; }
}, 800);

/* ─────────────────────────── 상태 ─────────────────────────── */
let ws = null, S = null, me = null, specId = null, specCtx = null, specRejoin = false, skew = 0;
const isSpec = () => !!S && S.role === 'spec';
window.__S = () => S;

/* ─────────────────────────── 소리 — 처음엔 꺼져 있다 ─────────────────────────── */
let muted = ls.get('bang.mute') !== '0';
let actx = null;
const shotAudio = new Audio('/sound/shot.mp3'); shotAudio.preload = 'auto';
function ac() {
  if (muted) return null;
  try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch (_) { return null; }
}
function tone(f, t0, dur, type = 'sine', vol = .1, f2) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, c.currentTime + t0 + dur);
  g.gain.setValueAtTime(0, c.currentTime + t0); g.gain.linearRampToValueAtTime(vol, c.currentTime + t0 + .01);
  g.gain.exponentialRampToValueAtTime(.0008, c.currentTime + t0 + dur);
  o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + .05);
}
function noise(t0, dur, vol = .2, freq = 1200) {
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination); s.start(c.currentTime + t0);
}
const sfx = {
  shot: () => { if (muted) return; const a = shotAudio.cloneNode(); a.volume = .5; a.play().catch(() => noise(0, .25, .4, 3000)); },
  pop: () => tone(740, 0, .07, 'triangle', .06, 980),
  card: () => noise(0, .12, .12, 2600),
  turn: () => { tone(784, 0, .14, 'triangle', .08); tone(1046, .12, .22, 'triangle', .08); },
  heal: () => { tone(523, 0, .12); tone(659, .09, .12); tone(784, .18, .2); },
  hurt: () => tone(170, 0, .28, 'sawtooth', .06, 110),
  miss: () => tone(1500, 0, .1, 'sine', .04, 700),
  boom: () => noise(0, 1.1, .6, 420),
  die: () => { tone(220, 0, .3, 'triangle', .08); tone(165, .25, .5, 'triangle', .08); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * .14, .3, 'triangle', .07)),
};
function syncMute() { $$('[data-mute]').forEach(b => { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기'); }); }
$$('[data-mute]').forEach(b => b.onclick = () => { muted = !muted; ls.set('bang.mute', muted ? '1' : '0'); syncMute(); if (!muted) sfx.pop(); });
syncMute();

/* ─────────────────────────── 접속 (로보77 과 같다) ─────────────────────────── */
let pingT = null, resting = false, wokeUp = false, restWhy = 0;
function resume() { connect(() => { const code = ss.get('code'), token = ss.get('token'); if (code && token) send({ t: 'resume', code, token }); }); }
function wake(e) {
  if (!resting) return;
  if (e.type === 'visibilitychange' && (document.hidden || restWhy === 4001)) return;
  resting = false; $('#toast').classList.remove('on');
  if (ss.get('code') && ss.get('token')) { wokeUp = true; resume(); }
  else if (specCtx) rejoinSpec();
  else if (watching) watchRooms(true);
}
['pointerdown', 'keydown'].forEach(t => addEventListener(t, wake, true));
document.addEventListener('visibilitychange', wake);

function connect(onOpen) {
  if (ws && ws.readyState === 1) { onOpen && onOpen(); return; }
  if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; try { ws.close(); } catch (_) {} }
  const sock = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { if (sock !== ws) return; clearInterval(pingT); pingT = setInterval(() => send({ t: 'ping' }), 25_000); onOpen && onOpen(); };
  ws.onmessage = e => {
    if (sock !== ws) return;
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.t === 'moved' || m.t === 'idle') { sock.why = m.t; sock.onclose({ code: m.t === 'moved' ? 4001 : 4000 }); ws = null; try { sock.close(); } catch (_) {} return; }
    handle(m);
  };
  ws.onclose = e => {
    if (sock !== ws) return;
    clearInterval(pingT);
    const code = sock.why === 'moved' ? 4001 : sock.why === 'idle' ? 4000 : e.code;
    if (code === 4000 || code === 4001) {
      resting = true; restWhy = code;
      const t = $('#toast');
      t.textContent = code === 4000 ? '한동안 조작이 없어서 연결을 쉬고 있어요. 아무 곳이나 누르면 다시 붙어요.' : '다른 창에서 이 자리를 이어받았어요. 여기서 계속하려면 아무 곳이나 누르세요.';
      t.classList.add('on'); clearTimeout(toastT);
      return;
    }
    if (watching && !ss.get('code')) setTimeout(() => { if (watching && (!ws || ws.readyState > 1)) watchRooms(true); }, 3000);
    else if (ss.get('code') && ss.get('token')) { toast('연결이 끊겼어요. 다시 붙는 중…'); setTimeout(resume, 1200); }
    else if (specCtx) { toast('연결이 끊겼어요. 다시 붙는 중…'); setTimeout(() => { if (specCtx && (!ws || ws.readyState > 1)) rejoinSpec(); }, 1200); }
    else show('title');
  };
}
function rejoinSpec() { if (!specCtx) return; specRejoin = true; connect(() => send({ t: 'join', code: specCtx.code, name: specCtx.name })); }
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

let leaving = false;
function handle(m) {
  if (leaving) { if (m.t !== 'left' && m.t !== 'err') return; leaving = false; if (m.t === 'err') return; }
  switch (m.t) {
    case 'welcome':
      wokeUp = false; entering = 0;
      if (m.code !== chatRoom) { chatRoom = m.code; chatReset(); }
      specRejoin = false;
      if (m.role === 'spec') {
        me = null; specId = m.specId; specCtx = { code: m.code, name: myName() };
        ss.del('code'); ss.del('token');
      } else {
        me = m.you; specId = null; specCtx = null;
        ss.set('code', m.code); ss.set('token', m.token);
        if (m.seated) toast('자리가 났어요 — 이제 같이 해요');
      }
      history.replaceState(null, '', `?r=${m.code}`);
      break;
    case 'chat': addChat(m); break;
    case 'rooms': if (watching) renderRooms(m); break;
    case 'state': onState(m); break;
    case 'react': floatEmo(m.from, m.e); break;
    case 'err':
      entering = 0;
      toast(m.fatal && wokeUp ? '오래 비워 둔 사이 테이블이 정리됐어요. 새로 열어 주세요.' : m.msg);
      if (m.fatal) { ss.del('code'); ss.del('token'); specCtx = null; specId = null; S = null; show('setup'); }
      else if (specRejoin) { specRejoin = false; specCtx = null; specId = null; show('setup'); }
      wokeUp = false;
      break;
    case 'left':
      ss.del('code'); ss.del('token'); specCtx = null; specId = null; S = null;
      history.replaceState(null, '', location.pathname);
      show('setup');
      break;
  }
}

/* ─────────────────────────── 화면 ─────────────────────────── */
let screen = '';
function show(id) {
  if (screen === id) return;
  screen = id;
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  document.body.dataset.screen = id;
  if ((id === 'setup') !== watching) watchRooms(id === 'setup');
  if (id === 'title' || id === 'setup') { chatRoom = null; chatReset(); $('#chatBtn').hidden = true; queue.length = 0; drawn = null; gateShown = false; }
  hideTip();
  if (id === 'game') requestAnimationFrame(layout);
}
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); }

const playerOf = id => (S ? S.players.find(p => p.id === id) : null);
const gp = id => (drawn && drawn.g ? drawn.g.players.find(p => p.id === id) : null);
const nameOf = id => { const p = gp(id) || playerOf(id); return p ? p.name : '?'; };

/* ─────────────────────────── 채팅 (로보77 과 같다) ─────────────────────────── */
let chatUnread = 0, chatRoom = null, chatAway = 0, chatPeekT = 0;
const chatTitle0 = document.title;
function chatReset() { $('#chatLog').textContent = ''; $('#chat').hidden = true; chatUnread = 0; chatBadge(); chatPeekOff(); chatAway = 0; chatTitle(); }
function chatOpen(on) {
  $('#chat').hidden = !on;
  if (!on) return;
  chatUnread = 0; chatBadge(); chatPeekOff();
  $('#chatText').focus();
  const log = $('#chatLog'); log.scrollTop = log.scrollHeight;
}
function addChat(m) {
  const log = $('#chatLog');
  const d = document.createElement('p');
  const mine = !m.sys && m.from === (me != null ? me : specId);
  d.className = 'chat-msg' + (mine ? ' mine' : '') + (m.sys ? ' sys' : '');
  d.innerHTML = m.sys ? esc(m.text) : `<b>${esc(m.name)}${m.spec ? ' (관전)' : ''}</b>${esc(m.text)}`;
  log.appendChild(d);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  if (mine || m.sys) return;
  if ($('#chat').hidden) { chatUnread++; chatBadge(); chatPeek(m.name, m.text); }
  if (document.hidden || !document.hasFocus()) { chatAway++; chatTitle(); }
  if (screen === 'game' && m.from != null && !m.spec) bubble(m.from, m.text);
}
function chatBadge() { const n = $('#chatN'); n.textContent = chatUnread > 99 ? '99+' : chatUnread; n.hidden = !chatUnread; if (chatUnread) { n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); } }
function chatPeek(name, text) {
  const p = $('#chatPeek');
  p.innerHTML = `<b>${esc(name)}</b>${esc(text)}`;
  p.classList.remove('bye'); p.hidden = false;
  p.style.animation = 'none'; void p.offsetWidth; p.style.animation = '';
  clearTimeout(chatPeekT);
  chatPeekT = setTimeout(() => { p.classList.add('bye'); chatPeekT = setTimeout(chatPeekOff, 260); }, Math.min(6000, Math.max(3000, 1200 + 70 * text.length)));
}
function chatPeekOff() { clearTimeout(chatPeekT); const p = $('#chatPeek'); p.hidden = true; p.classList.remove('bye'); }
function chatTitle() { document.title = (chatAway ? `(${chatAway > 99 ? '99+' : chatAway}) ` : '') + chatTitle0; }
function chatBack() { if (chatAway && !document.hidden && document.hasFocus()) { chatAway = 0; chatTitle(); } }
document.addEventListener('visibilitychange', chatBack);
addEventListener('focus', chatBack);
function syncChatVisible() {
  const humans = S ? S.players.filter(p => !p.bot).length + (S.specs ? S.specs.length : 0) : 0;
  const on = humans > 1;
  $('#chatBtn').hidden = !on;
  if (!on) { $('#chat').hidden = true; chatPeekOff(); } else $('#chatWho').textContent = `${humans}명`;
}
$('#chatBtn').onclick = () => chatOpen($('#chat').hidden);
$('#chatPeek').onclick = () => chatOpen(true);
$('#chatX').onclick = () => chatOpen(false);
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const box = $('#chatText'), text = box.value.trim();
  if (!text) return;
  send({ t: 'chat', text }); box.value = '';
});

/* ─────────────────────────── 타이틀 · 방 고르기 ─────────────────────────── */
const myName = () => ($('#gName').value || '').trim().slice(0, 12);
$('#bBegin').onclick = () => { show('setup'); setTimeout(() => { if (!myName()) $('#gName').focus(); }, 80); ac(); sfx.pop(); };
$('#bBack').onclick = () => show('title');

let entering = 0;
function enter(msg) {
  if (!myName()) { toast('이름을 먼저 적어 주세요.'); $('#gName').focus(); $('#gName').classList.remove('need'); void $('#gName').offsetWidth; $('#gName').classList.add('need'); return; }
  if (Date.now() - entering < 4000) return;
  entering = Date.now();
  ss.del('code'); ss.del('token');
  ls.set('bang.name', myName());
  sfx.pop();
  connect(() => send(Object.assign(msg, { name: myName() })));
}
$('#bCreate').onclick = () => enter({ t: 'create', priv: $('#gPriv').checked, spec: $('#gSpec').checked });
function doJoin() {
  const code = ($('#gCode').value || '').trim().toUpperCase();
  if (code.length !== 4) return toast('네 글자 방 코드를 넣어 주세요.');
  enter({ t: 'join', code });
}
$('#bJoin').onclick = doJoin;
$('#gCode').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) doJoin(); };
$('#gName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('#bCreate').click(); };

let watching = false;
function watchRooms(on) {
  watching = on;
  if (on) connect(() => { if (watching && !ss.get('code')) send({ t: 'rooms' }); });
  else send({ t: 'unwatch' });
}
const ROOM_STATE = { wait: '자리 있음', full: '가득 참', playing: '게임 중' };
function renderRooms(m) {
  const list = m.list;
  const open = list.filter(r => r.state === 'wait' && !r.priv).length;
  $('#roomCount').textContent = list.length ? `· 열린 테이블 ${open}곳` : '';
  $('#online').textContent = m.online ? `지금 ${m.online}명이 마을에 있어요` : '';
  $('#roomEmpty').hidden = list.length > 0;
  $('#roomList').innerHTML = list.map(r => {
    let off = false, label = ROOM_STATE[r.state];
    if (r.priv) off = true;
    else if (r.state !== 'wait') { if (r.spec !== false) label = r.state === 'playing' ? '게임 중 · 관전' : '가득 참 · 관전'; else off = true; }
    return `<li><button class="room-row" ${r.priv ? '' : `data-code="${esc(r.code)}"`}${off ? ' disabled' : ''}>
      <span class="rr-main"><span class="rr-host">${esc(r.host || '이름 없음')}의 테이블</span>
        <span class="rr-meta">${r.priv ? '비공개' : `<b class="rr-code">${esc(r.code)}</b>`} · ${r.n}/${r.max}명 (사람 ${r.humans})${r.watching ? ` · 관전 ${r.watching}` : ''}</span></span>
      <span class="rr-st ${esc(r.state)}">${label}</span></button></li>`;
  }).join('');
}
$('#roomList').addEventListener('click', e => {
  const b = e.target.closest('.room-row');
  if (!b || b.disabled || !b.dataset.code) return;
  $('#gCode').value = b.dataset.code; doJoin();
});

/* ─────────────────────────── 상태 받기 ─────────────────────────── */
function onState(m) {
  if (m.now) skew = m.now - Date.now();
  me = m.role === 'spec' ? null : (m.you != null ? m.you : me);
  const prev = S;
  S = m;
  countGame(prev, m);
  document.body.classList.toggle('spec', isSpec());
  syncChatVisible();
  if (m.phase === 'lobby') { queue.length = 0; drawn = null; gateShown = false; closePop(); show('lobby'); renderLobby(); return; }
  if (m.phase === 'intro') { queue.length = 0; drawn = null; gateShown = false; show('intro'); renderIntro(); return; }
  // 판 — 연출을 차례로 보여 주며 그린다
  if (m.reset && !queue.length) $('#logIn').textContent = '';
  queue.push(m);
  pump();
}

let gameAt = 0;
function countGame(prev, m) {
  if (!window.norara) return;
  if (m.role === 'spec') { norara.live(false); return; }
  norara.live(m.phase === 'playing' || m.phase === 'intro');
  if (m.hostId !== me) return;
  const humans = m.players.filter(p => !p.bot).length;
  if (m.phase === 'intro' && (!prev || prev.phase !== 'intro')) { gameAt = Date.now(); norara.ev('start', { n: humans, p: m.players.length }); }
  else if (m.phase === 'over' && prev && prev.phase !== 'over' && gameAt) { norara.ev('end', { n: humans, sec: Math.round((Date.now() - gameAt) / 1000) }); gameAt = 0; }
}

/* ─────────────────────────── 대기실 ─────────────────────────── */
function renderLobby() {
  const spec = isSpec(), host = !spec && S.hostId === me;
  $('#lCode').textContent = S.code;
  $('#lCount').textContent = `${S.players.length} / ${S.cfg.max}명` + (S.cfg.priv ? ' · 비공개' : '') + (S.specs.length ? ` · 관전 ${S.specs.length}명` : '');
  $('#lSpecNote').hidden = !spec;
  const seats = [];
  for (let i = 0; i < S.cfg.max; i++) {
    const p = S.players[i];
    if (!p) { seats.push(`<li class="seat-card free">${host ? '<button class="add-bot" data-add>＋ 봇 앉히기</button>' : '<span class="free-t">빈자리</span>'}</li>`); continue; }
    const badges = [p.id === S.hostId ? '<i class="bd b-host">방장</i>' : '', p.bot ? '<i class="bd b-bot">봇</i>' : '', !p.bot && !p.connected ? '<i class="bd b-off">끊김</i>' : '', p.id === me ? '<i class="bd b-me">나</i>' : ''].join('');
    seats.push(`<li class="seat-card ${p.connected ? '' : 'off'} ${p.id === me ? 'is-me' : ''}" data-id="${p.id}">
      <span class="sc-av">${p.bot ? '🤖' : '🤠'}</span><b class="sc-name">${esc(p.name)}</b><span class="sc-bd">${badges}</span>
      ${host && p.id !== me ? `<button class="sc-menu" data-menu="${p.id}" aria-label="메뉴">⋯</button>` : ''}</li>`);
  }
  $('#lSeats').innerHTML = seats.join('');
  $('#lHostBox').hidden = !host;
  $('#lWait').hidden = host;
  $('#lWait').textContent = spec ? '관전 중 — 방장이 시작하면 구경할 수 있어요' : '방장이 시작하기를 기다리는 중…';
  for (const [id, v] of [['#segMax', S.cfg.max], ['#segTurn', S.cfg.turn], ['#segReact', S.cfg.react]]) $$(`${id} button`).forEach(b => b.classList.toggle('on', Number(b.dataset.v) === v));
  $$('#segChars button').forEach(b => b.classList.toggle('on', b.dataset.v === S.cfg.chars));
  $$('#segExp button').forEach(b => b.classList.toggle('on', b.dataset.v === S.cfg.exp));
  $('#optRevive').hidden = S.cfg.exp === 'none';
  $('#tRevive').setAttribute('aria-checked', String(!!S.cfg.revive));
  $('#lRules').textContent = rulesLine(S.cfg);
  $$('#segMax button').forEach(b => { b.disabled = Number(b.dataset.v) < S.players.length; });
  $('#tPriv').setAttribute('aria-checked', String(!!S.cfg.priv));
  $('#tSpec').setAttribute('aria-checked', String(S.cfg.spec !== false));
  $('#bBot').disabled = S.players.length >= S.cfg.max;
  const n = S.players.length;
  $('#bStart').disabled = n < S.min;
  $('#lHint').textContent = n < S.min ? `${S.min}명부터 시작할 수 있어요 — 빈자리에 봇을 앉혀 보세요.` : `${n}명으로 시작합니다. 자리 순서와 역할은 시작할 때 섞여요.`;
}
$('#lSeats').addEventListener('click', e => {
  if (e.target.closest('[data-add]')) { send({ t: 'addBot' }); sfx.pop(); return; }
  const mb = e.target.closest('[data-menu]');
  if (!mb) return;
  const p = playerOf(Number(mb.dataset.menu));
  if (!p) return;
  openPop(`<p class="pop-title">${esc(p.name)}</p><div class="pop-acts">
    ${!p.bot && p.connected ? '<button class="wbtn" data-do="host"><span>방장 넘기기</span></button>' : ''}
    <button class="wbtn red" data-do="kick"><span>${p.bot ? '봇 빼기' : '내보내기'}</span></button>
    <button class="wbtn dark" data-x><span>닫기</span></button></div>`);
  $$('#popBox [data-do]').forEach(b => b.onclick = () => { send({ t: b.dataset.do === 'host' ? 'host' : 'kick', id: p.id }); closePop(); });
});
for (const [id, key] of [['#segMax', 'max'], ['#segTurn', 'turn'], ['#segReact', 'react']]) {
  $$(`${id} button`).forEach(b => b.onclick = () => { send({ t: 'cfg', [key]: Number(b.dataset.v) }); sfx.pop(); });
}
$$('#segChars button').forEach(b => b.onclick = () => { send({ t: 'cfg', chars: b.dataset.v }); sfx.pop(); });
$$('#segExp button').forEach(b => b.onclick = () => { send({ t: 'cfg', exp: b.dataset.v }); sfx.pop(); });
$('#tRevive').onclick = () => send({ t: 'cfg', revive: !S.cfg.revive });
const EXP_NAME = { none: '기본판', hn: '하이눈 확장', foc: '한 줌의 카드 확장', both: '하이눈 + 한 줌의 카드', either: '하이눈 · 한 줌의 카드 중 하나' };
function rulesLine(cfg) {
  return [EXP_NAME[cfg.exp] + (cfg.exp !== 'none' && cfg.revive ? '(유령 마을 · 죽은 자 포함)' : ''), cfg.chars === 'pick' ? '인물 두 장 중 고르기' : '인물 무작위',
    cfg.turn ? `내 턴 ${cfg.turn}초` : '시간 무제한', `막기 ${cfg.react}초`].join(' · ');
}
$('#tPriv').onclick = () => send({ t: 'cfg', priv: S.cfg.priv !== true });
$('#tSpec').onclick = () => send({ t: 'cfg', spec: S.cfg.spec === false });
$('#bBot').onclick = () => { send({ t: 'addBot' }); sfx.pop(); };
$('#bStart').onclick = () => { send({ t: 'start' }); ac(); sfx.pop(); };
$('#bCopy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?r=${S.code}`;
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요'); } catch (_) { toast(url); }
};

/* ─────────────────────────── 역할 · 인물 고르기 ─────────────────────────── */
let introKey = '';
function renderIntro() {
  const I = S.intro;
  const key = S.code + ':' + S.gameNo;
  const sh = playerOf(I.sheriff);
  if (introKey !== key) {
    introKey = key;
    $('#iRole').classList.remove('open');
    setTimeout(() => { $('#iRole').classList.add('open'); sfx.card(); }, 900);   // 뒷면을 먼저 보여 주고 내 역할이 뒤집힌다
  }
  if (isSpec()) {
    $('#iStep').textContent = '역할을 나눠 주는 중 — 구경하는 중이에요';
    $('#iRole').hidden = true;
    $('.intro-chars').hidden = true;
  } else {
    $('#iRole').hidden = false;
    $('.intro-chars').hidden = false;
    const r = I.myRole;
    $('#iRoleImg').src = ROLE_IMG(r);
    $('#iRoleName').textContent = ROLES[r].name;
    $('#iGoal').innerHTML = r === 'sheriff'
      ? `<b>당신이 보안관입니다.</b> 모두가 알고 있어요.<br>${esc(ROLES[r].goal)} 생명이 1 더 많고, 당신부터 시작합니다.`
      : `<b>당신은 ${esc(ROLES[r].name)}입니다.</b> ${esc(ROLES[r].goal)}<br>정체는 들키지 않게! 보안관은 <b>${esc(sh ? sh.name : '')}</b> 님이에요.`;
    $('#iStep').textContent = I.myPick ? '좋아요! 다른 사람들을 기다리는 중' : '당신의 정체와 인물';
    const pickMode = I.mode === 'pick';
    $('#iCharT').textContent = pickMode ? (I.myPick ? '고른 인물' : '인물을 한 명 고르세요') : '당신의 인물';
    $('#bReady').hidden = pickMode || !!I.myPick;
    const sig = I.offers.join(',') + '|' + (I.myPick || '');
    if ($('#iChars').dataset.sig !== sig) {
      $('#iChars').dataset.sig = sig;
      $('#iChars').innerHTML = I.offers.map(c => `<button class="char-card ${I.myPick === c ? 'picked' : ''} ${I.myPick && I.myPick !== c ? 'dim' : ''} ${I.mode === 'pick' ? 'choose' : 'solo'}" data-c="${c}" ${I.myPick || I.mode !== 'pick' ? 'disabled' : ''}>
        <img src="${CHAR_IMG(c)}" alt=""><b class="cc-name">${CHARS[c].name}</b>
        <span class="hp">${'<i></i>'.repeat(CHARS[c].hp + (I.myRole === 'sheriff' ? 1 : 0))}</span>
        <span class="cc-desc">${esc(CHARS[c].desc)}</span></button>`).join('');
    }
  }
  const left = Math.max(0, Math.round((I.ends - (Date.now() + skew)) / 1000));
  $('#iFoot').textContent = I.myPick || isSpec() ? `다른 사람들을 기다리는 중… (${I.picked.length}/${S.players.length})`
    : I.mode === 'pick' ? `${left}초 안에 고르세요 — 고르지 않으면 왼쪽 인물로 정해져요` : `${left}초 뒤에 저절로 시작해요`;
  $('#iWho').innerHTML = S.players.map(p => `<span class="iw ${I.picked.includes(p.id) ? 'done' : ''}">${p.id === I.sheriff ? roleImg('sheriff', 'ri sm') + ' ' : ''}${esc(p.name)}${I.picked.includes(p.id) ? ' ✓' : ''}</span>`).join('');
}
$('#iChars').addEventListener('click', e => {
  const b = e.target.closest('.char-card');
  if (!b || b.disabled) return;
  send({ t: 'pick', c: b.dataset.c }); sfx.card();
});
$('#bReady').onclick = () => { const o = S && S.intro && S.intro.offers; if (o) { send({ t: 'pick', c: o[0] }); sfx.card(); } };
setInterval(() => { if (screen === 'intro' && S && S.intro) renderIntro(); }, 1000);

/* ─────────────────────────── 판: 줄 세워 그리기 ─────────────────────────── */
const queue = [];
let drawn = null, pumping = false, overShown = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const m = queue.shift();
      const fast = queue.length > 2;               // 밀렸으면 연출을 건너뛰고 따라잡는다
      if (screen !== 'game' && screen !== 'over') show('game');
      if (m.reset) $('#logIn').textContent = '';
      const had = !!drawn;
      drawn = m;
      addLogs(m.logs);
      renderGame();
      // 새 상태를 먼저 그리고 그 위에서 연출을 보여 준다 — 다 끝나야 다음 상태로 (서버도 그만큼 기다린다)
      if (!fast && had && m.fx && m.fx.length) await playFx(m.fx);
      if (m.phase === 'over' && !overShown) { overShown = true; setTimeout(showOver, fast ? 300 : 1800); }
      if (m.phase !== 'over') overShown = false;
    }
  } finally { pumping = false; }
}

/* 고르는 중인 것 — 요청(seq)이 바뀌면 비운다 */
let sel = [], mode = null, selSeq = 0, sentSeq = 0;
function resetSel() { sel = []; mode = null; }

const G = () => drawn && drawn.g;
const myReq = () => { const g = G(); return g && g.req && g.req.to === me && !drawn.auto && g.req.seq !== sentSeq ? g.req : null; };
const myP = () => (G() && me != null ? G().players.find(p => p.id === me) : null);

let gateShown = false;
function renderGame() {
  const g = G(); if (!g) return;
  if (!g.req || g.req.seq !== selSeq) { resetSel(); selSeq = g.req ? g.req.seq : 0; }
  document.body.classList.toggle('my-turn', g.turn === me && !g.over);
  renderOpps(); renderCenter(); renderMe(); renderHand(); renderAct();
  const gateLeft = (drawn.gate || 0) - (Date.now() + skew);
  if (gateLeft > 300 && !gateShown) showGate(gateLeft);
}

/* 다른 사람 자리 — 나를 아래에 두고 시계 방향(내 왼쪽이 다음 사람) */
function oppOrder() {
  const g = G(), n = g.players.length;
  const mi = Math.max(0, g.players.findIndex(p => p.id === me));
  const out = [];
  for (let k = 1; k < n; k++) out.push(g.players[(mi + k) % n]);
  if (me == null) out.unshift(g.players[mi]);
  return out;
}
function hpHTML(p) {
  let h = '';
  for (let i = 0; i < p.max; i++) h += `<i class="${i < p.hp ? '' : 'lost'}"></i>`;
  return `<span class="hp" title="생명 ${Math.max(0, p.hp)}/${p.max}">${h}</span>`;
}
function roleBadge(p) {
  if (!p.role) return '<span class="rb unk" title="정체 모름">?</span>';
  return `<span class="rb ${p.role}" title="${ROLES[p.role].name}">${roleImg(p.role)}</span>`;
}
const RING_R = 37, RING_C = 2 * Math.PI * RING_R;
const ringSVG = `<svg class="ring" viewBox="0 0 80 80"><circle class="fg" cx="40" cy="40" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>`;
function seatHTML(p) {
  const g = G(), req = g.req;
  const aims = aimSet();
  const cls = ['opp', p.status === 'ghost' ? 'ghost' : '', p.status === 'down' ? 'down' : '', p.id === g.turn && !g.over ? 'turn' : '', req && req.to === p.id && !g.over ? 'thinking' : '', req && req.to === p.id && req.to !== g.turn && !g.over ? 'asked' : '', !p.alive ? 'dead' : '',
    targets().has(p.id) ? 'target' : ''].join(' ');
  const mp = myP();
  const inRange = mp && mp.alive && p.alive && p.dist != null && p.dist <= mp.range;
  const pl = playerOf(p.id);
  return `<div class="${cls}" data-pid="${p.id}">
    <div class="por" data-char="${p.char}"><img src="${CHAR_IMG(p.char)}" alt="">${ringSVG}${roleBadge(p)}</div>
    <div class="o-info">
      <b class="o-name">${p.status === 'ghost' ? '👻 ' : ''}${esc(p.name)}${p.bot ? ' <i class="otag">봇</i>' : ''}${pl && !pl.bot && !pl.connected ? ' <i class="otag off">끊김</i>' : ''}</b>
      <span class="o-char" data-char="${p.char}">${CHARS[p.char].name}${!p.alive && p.role ? ' · ' + ROLES[p.role].name : ''}</span>
      ${hpHTML(p)}
      <span class="o-meta"><span class="hc" title="손에 든 카드"><img class="mi" src="${ICON('cards')}" alt="">${p.hand}</span>${p.dist != null && p.id !== me ? `<span class="ds ${inRange ? 'in' : ''}" title="내가 보는 거리${inRange ? ' — 사거리 안' : ''}"><img class="mi" src="${ICON('crosshair')}" alt="">${p.dist}</span>` : ''}<span class="rg" title="사거리"><img class="mi" src="${ICON('revolver')}" alt="">${p.range}</span></span>
    </div>
    <div class="o-tbl">${p.table.map(c => cardHTML(c, 'mini' + (aims.has(c.id) ? ' aim' : ''))).join('')}</div>
    <div class="think">생각 중…</div>
  </div>`;
}
function renderOpps() {
  $('#opps').innerHTML = oppOrder().map(seatHTML).join('');
  layout();
}
/** 자리를 탁자 둘레 위쪽에 고르게 — 내 왼쪽부터 시계 방향 */
function layout() {
  if (!G()) return;
  const t = $('#table').getBoundingClientRect();
  const els = $$('#opps .opp'), k = els.length;
  // 폰에서는 둥글게 앉히지 않고 위쪽에 3칸씩 줄 세운다(CSS) — 차례 순서는 그대로 왼쪽 위부터
  if (innerWidth < 760) { els.forEach(el => { el.style.left = ''; el.style.top = ''; }); return; }
  const narrow = t.width < 900;
  els.forEach((el, i) => {
    const a = (narrow ? 168 : 158) + (i + .5) * ((narrow ? 204 : 224) / k);
    const rad = a * Math.PI / 180;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = t.width / 2 + t.width * (narrow ? .36 : .40) * Math.cos(rad);
    let y = t.height * .62 + t.height * .54 * Math.sin(rad);
    x = Math.min(t.width - w / 2 - 6, Math.max(w / 2 + 6, x));
    y = Math.min(t.height - h / 2 - 4, Math.max(h / 2 + 4, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  });
}
addEventListener('resize', () => requestAnimationFrame(layout));

function evCard(k, cls = '') {
  if (!k) return `<span class="ecard none ${cls}">이벤트 없음</span>`;
  const E = EVENTS[k];
  const icon = { hn: '☀', foc: '🃏' }[E.set];
  return `<span class="ecard ${E.set} ${cls}" data-ev="${k}"><img src="/img/events/${k}.webp" alt="" onerror="this.classList.add('noart');this.nextElementSibling.hidden=false"><span class="ek" hidden>${icon}</span><b>${E.name}</b><small>${esc(E.desc)}</small></span>`;
}
function renderEvents() {
  const g = G(), box = $('#events');
  box.hidden = !g.events;
  if (!g.events) return;
  box.innerHTML = (g.eventNext ? evCard(g.eventNext, 'next').replace('</span>', '</span>') : '') + evCard(g.event) ;
  if (g.eventLeft) box.firstElementChild.insertAdjacentHTML('beforeend', `<span class="eleft">${g.eventLeft}</span>`);
}
function renderCenter() {
  const g = G();
  renderEvents();
  $('#deckN').textContent = g.deck;
  $('#pile').innerHTML = g.pile ? cardHTML(g.pile) : '<span class="pile-empty">버린 카드</span>';
  const st = $('#store'), r = myReq();
  st.hidden = !g.store.length;
  st.innerHTML = g.store.length ? `<p class="store-t">잡화점${r && r.kind === 'store' ? ' — 1장을 고르세요' : ''}</p><div class="store-row">${g.store.map(c => cardHTML(c, r && r.kind === 'store' ? 'can' : '')).join('')}</div>` : '';
}

/* 카드 한 장 */
function cardHTML(c, extra = '') {
  const def = KINDS[c.k];
  const red = c.s === 'H' || c.s === 'D';
  return `<span class="card ${def.blue ? 'blue' : 'brown'} ${extra}" data-cid="${c.id}" data-k="${c.k}">
    <img class="c-art" src="${CARD_IMG(c.k)}" alt="" draggable="false">
    <span class="c-tag ${red ? 'r' : ''}">${RANKS[c.r]}<small>${SUITS[c.s]}</small></span>
    <span class="c-name">${def.name}</span>
    <span class="c-desc">${SHORT[c.k] || ''}</span></span>`;
}
const SHORT = {
  bang: '사거리 안 1명을 쏜다', missed: '뱅! 하나를 막는다', beer: '생명 +1', saloon: '모두 생명 +1', stagecoach: '2장 뽑기', wellsfargo: '3장 뽑기',
  generalstore: '모두 1장씩 고르기', panic: '거리 1 · 1장 빼앗기', catbalou: '아무나 · 1장 버리게', gatling: '모두에게 뱅!', indians: '모두 뱅! 버리거나 −1', duel: '뱅!을 번갈아 버린다',
  barrel: '하트면 빗나감!', scope: '남이 1 가까워짐', mustang: '내가 1 멀어짐', jail: '하트가 아니면 턴을 거름', dynamite: '♠2~9면 −3',
  volcanic: '사거리 1 · 뱅! 무제한', schofield: '사거리 2', remington: '사거리 3', carabine: '사거리 4', winchester: '사거리 5',
};

/* 내 자리 — 인물 카드 · 역할 · 생명 · 앞에 놓은 카드 */
function renderMe() {
  const p = myP(), box = $('#me');
  if (!p) { box.className = 'me spec'; box.innerHTML = '<p class="me-spec">관전 중 — 손 카드는 보이지 않아요</p>'; return; }
  const g = G();
  box.className = 'me' + (p.id === g.turn && !g.over ? ' turn' : '') + (!p.alive ? ' dead' : '') + (g.req && g.req.to === me && !g.over ? ' asked' : '') + (targets().has(me) ? ' target' : '');
  const bangUsed = g.turn === me && g.bangs && p.char !== 'willy' && !p.table.some(c => c.k === 'volcanic');
  box.innerHTML = `
    <div class="me-card por" data-char="${p.char}"><img src="${CHAR_IMG(p.char)}" alt="">${ringSVG}<span class="rb ${p.role}">${roleImg(p.role)}</span></div>
    <div class="me-info">
      <b class="me-name">${esc(p.name)} <span class="me-role ${p.role}">${ROLES[p.role].name}</span></b>
      <span class="me-char" data-char="${p.char}"><b>${CHARS[p.char].name}</b> — ${esc(CHARS[p.char].desc)}</span>
      ${hpHTML(p)}
      <span class="o-meta"><span class="rg"><img class="mi" src="${ICON('revolver')}" alt="">사거리 ${p.range}</span><span class="hc"><img class="mi" src="${ICON('cards')}" alt="">${G().me.hand.length}</span>${bangUsed ? '<span class="used">뱅! 사용함</span>' : ''}</span>
    </div>
    <div class="me-tbl">${p.table.map(c => cardHTML(c, 'mini')).join('')}</div>`;
}

/* 손 */
let prevHand = new Set();
function renderHand() {
  const g = G(), el = $('#hand');
  hideTip();
  if (!g.me) { el.innerHTML = ''; return; }
  const ok = eligible();
  const now = new Set(g.me.hand.map(c => c.id));
  el.innerHTML = g.me.hand.map(c => cardHTML(c, [g.me.mustPlay === c.id ? 'must' : '', sel.includes(c.id) ? 'sel' : '', ok ? (ok.has(c.id) ? 'can' : 'dim') : '', prevHand.size && !prevHand.has(c.id) ? 'new' : ''].join(' '))).join('');
  prevHand = now;
  el.style.setProperty('--n', g.me.hand.length);
}
$('#hand').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) clickCard(Number(c.dataset.cid)); });
$('#hand').addEventListener('dblclick', e => {
  const c = e.target.closest('.card'); if (!c) return;
  const r = myReq(), id = Number(c.dataset.cid);
  if (r && r.kind === 'play' && r.moves[id] && !r.moves[id].tg) playNoTarget(id);
});
/** 대상 없는 카드 — 효과 없는 맥주만 한 번 묻는다(BGA 와 같다) */
function playNoTarget(id) {
  const g = G(), p = myP();
  const k = DECK[id].k, old = p.table.find(c => KINDS[c.k].range && c.id !== id);
  if (KINDS[k].range && old && !playNoTarget.ok) {
    openPop(`<p class="pop-title">${KINDS[k].name}</p><p class="pop-sub">지금 든 ${KINDS[old.k].name}(사거리 ${KINDS[old.k].range})${josa(KINDS[old.k].name, '을', '를')} 버리고 ${KINDS[k].name}(사거리 ${KINDS[k].range})${josa(KINDS[k].name, '으로', '로')} 바꿀까요? 무기는 하나만 쓸 수 있어요.</p><div class="pop-acts"><button class="wbtn dark" data-x><span>그만두기</span></button><button class="wbtn red" id="wpYes"><span>바꾸기</span></button></div>`);
    $('#wpYes').onclick = () => { closePop(); playNoTarget.ok = true; playNoTarget(id); playNoTarget.ok = false; };
    return;
  }
  if (DECK[id].k === 'beer' && (p.hp >= p.max || g.players.filter(x => x.alive).length <= 2)) {
    openPop(`<p class="pop-title">맥주</p><p class="pop-sub">${p.hp >= p.max ? '생명이 가득 차 있어서' : '두 명만 남아서'} 마셔도 아무 효과가 없어요. 그래도 마실까요?</p><div class="pop-acts"><button class="wbtn dark" data-x><span>그만두기</span></button><button class="wbtn red" id="beerYes"><span>마시기</span></button></div>`);
    $('#beerYes').onclick = () => { closePop(); act({ a: 'play', c: id }); };
    return;
  }
  act({ a: 'play', c: id });
}

/** 지금 누를 수 있는 손 카드 */
function eligible() {
  const r = myReq(), hand = G().me ? G().me.hand : [];
  if (!r) return null;
  if (r.kind === 'play') {
    if (mode === 'sid') return new Set(hand.map(c => c.id));
    if (mode === 'snipe') return new Set([sel[0], ...((r.moves[sel[0]] || {}).snipe || [])]);
    return new Set(Object.keys(r.moves).map(Number));
  }
  if (r.kind === 'ranch') return new Set(hand.map(c => c.id));
  if (r.kind === 'discard') return new Set(hand.map(c => c.id));
  if (r.kind === 'react') return new Set(hand.filter(c => r.ok.includes(c.k)).map(c => c.id));
  if (r.kind === 'dying') return mode === 'sid' ? new Set(hand.map(c => c.id)) : new Set(hand.filter(c => c.k === 'beer').map(c => c.id));
  return new Set();
}
/** 도탄으로 겨냥할 수 있는 남의 카드 */
function aimSet() {
  const r = myReq();
  if (!r || r.kind !== 'play' || sel.length !== 1 || mode) return new Set();
  const mv = r.moves[sel[0]];
  return new Set(mv && mv.rico ? mv.rico.map(x => x[1]) : []);
}
/** 지금 누를 수 있는 자리 */
function targets() {
  const r = myReq(), g = G();
  if (!r) return new Set();
  if (r.kind === 'play' && sel.length === 1 && !mode) { const mv = r.moves[sel[0]]; if (mv && mv.tg) return new Set(mv.tg); }
  if (r.kind === 'play' && mode === 'snipe' && sel.length === 2) return new Set(r.moves[sel[0]].sniperTg || []);
  if (r.kind === 'blood') return new Set(r.tg);
  if (r.kind === 'jesse') return new Set(g.players.filter(p => p.alive && p.id !== me && p.hand > 0).map(p => p.id));
  return new Set();
}

function clickCard(id) {
  const r = myReq();
  if (!r) { tipFor(id); return; }
  const ok = eligible();
  if (r.kind === 'play' && mode === 'snipe') {
    if (!ok.has(id) || id === sel[0]) return;
    sel = [sel[0], id]; sfx.card();
    return renderGame();
  }
  if (r.kind === 'ranch') {
    sel = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]; sfx.card();
    return renderGame();
  }
  if (r.kind === 'play' && !mode) {
    if (!ok.has(id)) { toast((r.why && r.why[id]) || whyNot(id)); return; }
    sfx.card();
    if (sel[0] === id) { if (!r.moves[id].tg) return playNoTarget(id); sel = []; return renderGame(); }
    sel = [id];
    return renderGame();
  }
  if (!ok || !ok.has(id)) { if (r.kind === 'react') toast(`${r.ok.map(k => KINDS[k].name).join(' 또는 ')}만 낼 수 있어요`); return; }
  if (r.kind === 'dying' && !mode) return act({ a: 'beer', c: id });
  const max = r.kind === 'discard' ? r.n : r.kind === 'react' ? r.need : 2;
  if (sel.includes(id)) sel = sel.filter(x => x !== id);
  else { sel.push(id); if (sel.length > max) sel.shift(); }
  sfx.card();
  renderGame();
}

/** 못 내는 카드를 누르면 까닭을 알려 준다 */
function whyNot(id) {
  const g = G(), c = g.me.hand.find(x => x.id === id), p = myP();
  if (!c) return '';
  const k = c.k === 'missed' && p.char === 'calamity' ? 'bang' : c.k;
  if (c.k === 'missed' && p.char !== 'calamity') return '빗나감!은 누가 나를 쏠 때만 낼 수 있어요.';
  if (k === 'bang') return g.bangs >= 1 ? '뱅!은 한 턴에 한 장만 쏠 수 있어요.' : `사거리(${p.range}) 안에 쏠 사람이 없어요. 무기를 바꾸거나 조준경을 놓아 보세요.`;
  if (k === 'beer') return g.players.filter(x => x.alive).length <= 2 ? '두 명만 남으면 맥주는 효과가 없어요.' : '생명이 가득 차 있어요.';
  if (k === 'panic') return '거리 1 안에 카드를 가진 사람이 없어요.';
  if (k === 'jail') return '감옥에 넣을 사람이 없어요 (보안관은 못 넣어요).';
  if (KINDS[k].blue) return `이미 ${KINDS[k].name}${josa(KINDS[k].name, '을', '를')} 앞에 놓았어요. 같은 카드는 한 장만.`;
  return '지금은 낼 수 없어요.';
}

$('#opps').addEventListener('click', e => {
  const el = e.target.closest('.opp'); if (!el) return;
  const pid = Number(el.dataset.pid), r = myReq();
  if (!r) return;
  if (r.kind === 'jesse') { if (targets().has(pid)) act({ a: 'from', t: pid }); return; }
  if (r.kind === 'blood') { if (targets().has(pid)) act({ a: 'give', t: pid }); return; }
  if (r.kind === 'play' && mode === 'snipe') { if (sel.length === 2 && targets().has(pid)) act({ a: 'play', c: sel[0], c2: sel[1], t: pid }); else toast(sel.length < 2 ? '함께 낼 뱅!을 한 장 더 고르세요' : '사거리 밖이에요'); return; }
  // 도탄 — 남의 앞에 놓인 카드를 눌렀다
  const aimed = e.target.closest('.o-tbl .card.aim');
  if (aimed && r.kind === 'play' && sel.length === 1) { act({ a: 'play', c: sel[0], t: pid, tc: Number(aimed.dataset.cid) }); return; }
  if (r.kind !== 'play' || sel.length !== 1 || mode) return;
  const c = sel[0], mv = r.moves[c];
  if (!mv || !mv.tg) return;
  if (!mv.tg.includes(pid)) { toast(KINDS[DECK[c].k === 'missed' ? 'bang' : DECK[c].k].tg === 'reach' ? '사거리 밖이에요.' : '그 사람에게는 낼 수 없어요.'); return; }
  if (mv.steal) return stealPick(c, pid);
  act({ a: 'play', c, t: pid });
});

/* 내 앞의 카드를 강탈 · 캣 벌로우로 치울 때 — 내 자리를 누른다 */
$('#me').addEventListener('click', () => {
  const r = myReq();
  if (!r || r.kind !== 'play' || sel.length !== 1 || mode) return;
  const mv = r.moves[sel[0]];
  if (mv && mv.steal && mv.tg.includes(me)) stealPick(sel[0], me);
});
/** 강탈 · 캣 벌로우 — 손에서 무작위로, 또는 앞에 놓인 카드 */
function stealPick(c, pid) {
  const p = G().players.find(x => x.id === pid), k = DECK[c].k;
  const opts = [];
  if (p.hand && pid !== me) opts.push(`<button class="sp-opt" data-tc="hand"><span class="card back"><img class="c-art" src="${CARD_IMG('back')}" alt=""></span><small>손에서 무작위 1장<br>(${p.hand}장 중)</small></button>`);
  for (const t of p.table) opts.push(`<button class="sp-opt" data-tc="${t.id}">${cardHTML(t)}<small>${KINDS[t.k].name}</small></button>`);
  openPop(`<p class="pop-title">${KINDS[k].name}</p><p class="pop-sub">${pid === me ? `내 앞의 어떤 카드를 ${k === 'panic' ? '손으로 가져올까요' : '버릴까요'}?` : `${esc(p.name)} 님의 어떤 카드를 ${k === 'panic' ? '빼앗을까요' : '버리게 할까요'}?`}</p><div class="sp-row">${opts.join('')}</div><div class="pop-acts"><button class="wbtn dark" data-x><span>그만두기</span></button></div>`);
  $$('#popBox [data-tc]').forEach(b => b.onclick = () => { closePop(); act({ a: 'play', c, t: pid, tc: b.dataset.tc === 'hand' ? 'hand' : Number(b.dataset.tc) }); });
}

function act(r) {
  const q = G() && G().req;
  if (!q) return;
  sentSeq = q.seq;
  send({ t: 'act', seq: q.seq, r });
  resetSel();
  sfx.pop();
  renderGame();
}

/* 할 일 막대 */
const WHY = { bang: '뱅!', gatling: '기관총', indians: '인디언!', duel: '결투', sniper: '저격', ricochet: '도탄', roulette: '러시안 룰렛', fistful: '한 줌의 카드' };
function renderAct() {
  const g = G(); if (!g) return;
  const r = g.req, rm = myReq();
  const box = $('#act'), tx = $('#actText'), bt = $('#actBtns');
  const p = myP();
  let text = '', btns = [];
  const B = (label, fn, cls = '', dis = false) => btns.push({ label, fn, cls, dis });
  box.classList.toggle('mine', !!rm);
  if (g.over) {
    text = g.over.team === 'sheriff' ? '⭐ 보안관 편이 이겼습니다!' : g.over.team === 'outlaw' ? '💀 무법자들이 이겼습니다!' : '🎭 배신자가 홀로 살아남았습니다!';
    B('결과 보기', showOver, 'red');
  } else if (drawn.auto && p && p.alive) {
    text = '💤 자리 비움 — 봇이 대신 두고 있어요';
    B('돌아왔어요', () => send({ t: 'back' }), 'red');
  } else if (!r) {
    text = '';
  } else if (!rm) {
    if (r.to === me) text = '…';
    else {
      const doing = { play: '카드를 내는 중', discard: '카드를 버리는 중', react: '막을지 고민하는 중', dying: '맥주를 찾는 중', store: '잡화점에서 고르는 중', jesse: '첫 장을 어디서 가져올지 고르는 중', pedro: '첫 장을 어디서 가져올지 고르는 중', kit: '카드를 고르는 중', lucky: '뽑기! 두 장 중 고르는 중', daltons: '버릴 파란 카드를 고르는 중', blood: '생명을 나눠 줄지 고민하는 중', liquor: '독한 술을 마실지 고민하는 중', peyote: '빨강일지 검정일지 맞히는 중', ranch: '바꿀 카드를 고르는 중' }[r.kind];
      text = `${esc(nameOf(r.to))} 님이 ${doing}…`;
      if (r.kind === 'react' && r.from != null) text = `${esc(nameOf(r.from))} 님의 ${WHY[r.why]} — ${esc(nameOf(r.to))} 님이 ${r.why === 'duel' || r.why === 'indians' ? '뱅!을 낼지' : '막을지'} 고민하는 중…`;
      if (r.kind === 'react' && r.why === 'roulette') text = `러시안 룰렛 — ${esc(nameOf(r.to))} 님 차례… 빗나감!을 낼까?`;
      if (r.kind === 'react' && r.why === 'fistful') text = `한 줌의 카드 — ${esc(nameOf(r.to))} 님에게 뱅!이 날아온다`;
    }
    if (isSpec()) text += '<small>구경하는 중이에요</small>';
    else if (p && !p.alive) text += '<small>쓰러졌어요 — 끝까지 지켜볼 수 있어요</small>';
  } else {
    switch (rm.kind) {
      case 'play': {
        if (mode === 'sid') {
          text = `<b>시드 케첨</b> — 버릴 카드 2장을 고르세요 (${sel.length}/2)`;
          B('생명 +1', () => act({ a: 'sid', cs: sel }), 'red', sel.length !== 2);
          B('취소', () => { resetSel(); renderGame(); }, 'dark');
          break;
        }
        if (mode === 'snipe') {
          text = sel.length < 2 ? '<b>저격수</b> — 함께 낼 뱅!을 한 장 더 고르세요' : '<b>저격수</b> — 빛나는 사람을 눌러 쏘세요 (빗나감! 2장이 있어야 막음)';
          B('취소', () => { resetSel(); renderGame(); }, 'dark');
          break;
        }
        const c = sel.length === 1 && g.me.hand.find(x => x.id === sel[0]);
        if (c) {
          const mv = rm.moves[c.id];
          if (mv && mv.snipe) B('🎯 저격수: 뱅! 두 장', () => { mode = 'snipe'; renderGame(); }, '');
          text = mv && mv.tg ? `<b>${KINDS[c.k].name}</b> — 빛나는 사람을 눌러 대상을 고르세요${mv.rico && mv.rico.length ? ' · 도탄: 남의 앞에 놓인 카드를 눌러도 돼요' : ''}<small>${esc(KINDS[c.k].desc)}</small>` : `<b>${KINDS[c.k].name}</b> — 한 번 더 누르거나 "사용하기"<small>${esc(KINDS[c.k].desc)}</small>`;
          if (!(mv && mv.tg)) B('사용하기', () => playNoTarget(c.id), 'red');
          B('취소', () => { resetSel(); renderGame(); }, 'dark');
        } else {
          const lim = g.bangLimit;
          text = `<b>당신의 차례</b> — 카드를 내거나 턴을 끝내세요<small>빛나는 카드를 누르면 고르고, 한 번 더 누르면 씁니다 · ${lim >= 99 ? '뱅! 제한 없음' : lim === 0 ? '설교 — 뱅!을 쓸 수 없어요' : g.bangs >= lim ? '이번 턴 뱅!을 다 썼어요' : `뱅!은 한 턴에 ${lim}장`}${g.me.mustPlay != null ? ' · <b>서부의 법 — 주황빛 카드를 꼭 내야 해요</b>' : ''}</small>`;
          if (p.char === 'sid' && g.event !== 'hangover' && p.hp < p.max && g.me.hand.length >= 2) B('시드: 2장 버리고 +1', () => { mode = 'sid'; sel = []; renderGame(); }, '');
        }
        B('턴 끝내기', () => act({ a: 'end' }), c ? '' : 'red');
        break;
      }
      case 'discard':
        text = `<b>손 카드가 생명보다 많아요</b> — ${rm.n}장을 골라 버리세요 (${sel.length}/${rm.n})`;
        B('버리기', () => act({ a: 'discard', cs: sel }), 'red', sel.length !== rm.n);
        B('취소 — 카드 더 내기', () => act({ a: 'cancel' }), 'dark');
        break;
      case 'react': {
        const from = esc(nameOf(rm.from));
        const elig = g.me.hand.filter(c => rm.ok.includes(c.k));
        if (rm.why === 'bang' || rm.why === 'gatling' || rm.why === 'sniper') text = `<b>${from} 님의 ${WHY[rm.why]}${rm.why === 'gatling' ? '!' : ''}</b> ${rm.need > 1 ? `빗나감! ${rm.need}장이 있어야 막을 수 있어요` : '빗나감!으로 막을까요?'}`;
        else if (rm.why === 'ricochet') { const nm = rm.tc ? KINDS[rm.tc.k].name : '카드'; text = `<b>${from} 님의 도탄!</b> 내 ${nm}${josa(nm, '을', '를')} 지키려면 빗나감!을 내세요`; }
        else if (rm.why === 'roulette') text = `<b>러시안 룰렛!</b> 빗나감!을 내지 못하면 생명 2를 잃고 룰렛이 멈춰요`;
        else if (rm.why === 'fistful') text = `<b>한 줌의 카드</b> — 뱅!이 날아옵니다${rm.left ? ` (이 뒤로 ${rm.left}발 더)` : ' (마지막 한 발)'}`;
        else if (rm.why === 'indians') text = `<b>${from} 님의 인디언!</b> 뱅!을 1장 버리거나 생명 1을 잃어요`;
        else text = `<b>${from} 님과 결투!</b> 뱅!을 1장 버리면 상대 차례, 못 버리면 생명 1을 잃어요`;
        if (rm.barrel) B(p.char === 'jourdonnais' && !p.table.some(t => t.k === 'barrel') ? '🛢 능력: 술통 뽑기' : '🛢 술통 쓰기', () => act({ a: 'barrel' }), 'red');
        if (elig.length) B(rm.why !== 'duel' && rm.why !== 'indians' ? (rm.need > 1 ? `빗나감! 내기 (${Math.min(elig.length, rm.need)}장)` : `${KINDS[rm.ok[0]].name} 내기`) : `${KINDS[rm.ok.find(k => elig.some(c => c.k === k)) || rm.ok[0]].name} 버리기`, () => {
          let cs = sel.filter(id => elig.some(c => c.id === id));
          for (const c of [...elig].sort((a, b) => (a.k === rm.ok[0] ? -1 : 1) - (b.k === rm.ok[0] ? -1 : 1))) { if (cs.length >= rm.need) break; if (!cs.includes(c.id)) cs.push(c.id); }
          act({ a: 'cards', cs: cs.slice(0, rm.need) });
        }, rm.barrel ? '' : 'red');
        B(rm.why === 'duel' ? '포기 (생명 −1)' : rm.why === 'roulette' ? '못 낸다 (생명 −2)' : rm.why === 'ricochet' ? '포기 (카드를 잃음)' : '맞기 (생명 −1)', () => act({ a: 'take' }), 'dark');
        break;
      }
      case 'dying': {
        text = `<b>마지막 생명을 잃었어요!</b> 생명 ${rm.need}만큼 버텨야 살아요`;
        if (mode === 'sid') {
          text = `<b>시드 케첨</b> — 버릴 카드 2장 (${sel.length}/2)`;
          B('생명 +1', () => act({ a: 'sid', cs: sel }), 'red', sel.length !== 2);
          B('취소', () => { resetSel(); renderGame(); }, 'dark');
          break;
        }
        const beer = g.me.hand.find(c => c.k === 'beer');
        if (beer && g.players.filter(x => x.alive).length > 2) B('🍺 맥주 마시기', () => act({ a: 'beer', c: beer.id }), 'red');
        if (p.char === 'sid' && g.event !== 'hangover' && g.me.hand.length >= 2) B('시드: 2장 버리고 +1', () => { mode = 'sid'; sel = []; renderGame(); }, '');
        B('쓰러지기', () => act({ a: 'die' }), 'dark');
        break;
      }
      case 'store': text = '<b>잡화점</b> — 가운데 펼친 카드 중 1장을 고르세요'; break;
      case 'jesse':
        text = '<b>제시 존스</b> — 첫 장을 더미에서, 또는 빛나는 사람의 손에서 가져와요';
        B('더미에서 뽑기', () => act({ a: 'deck' }), 'red');
        break;
      case 'pedro':
        text = `<b>페드로 라미레즈</b> — 첫 장을 더미에서, 또는 버린 카드 맨 위(${KINDS[rm.top.k].name})에서 가져와요`;
        B('더미에서 뽑기', () => act({ a: 'deck' }), '');
        B(`버린 ${KINDS[rm.top.k].name} 가져오기`, () => act({ a: 'discard' }), 'red');
        break;
      case 'kit':
        text = '<b>킷 칼슨</b> — 3장 중 더미 위로 <b>돌려놓을</b> 1장을 고르세요';
        setTimeout(() => kitPop(rm), 0);
        break;
      case 'lucky':
        text = `<b>럭키 듀크</b> — ${rm.what} 뽑기! 두 장 중 쓸 카드를 고르세요`;
        setTimeout(() => luckyPop(rm), 0);
        break;
      case 'daltons':
        text = '<b>달튼 형제</b> — 내 앞의 파란 카드 중 1장을 버려야 해요';
        setTimeout(() => daltonsPop(rm), 0);
        break;
      case 'blood':
        text = '<b>피를 나눈 형제</b> — 생명 1을 잃고 빛나는 사람에게 1을 줄 수 있어요';
        B('건너뛰기', () => act({ a: 'skip' }), 'dark');
        break;
      case 'liquor':
        text = '<b>독한 술</b> — 이번 뽑기를 건너뛰고 생명 1을 되찾을까요?';
        B('🥃 뽑지 않고 생명 +1', () => act({ a: 'heal' }), 'red');
        B('평소대로 뽑기', () => act({ a: 'draw' }), '');
        break;
      case 'peyote':
        text = '<b>페요테</b> — 더미 맨 위 카드는 빨강일까 검정일까? 맞히면 갖고 또 맞혀요';
        B('🔴 빨강 (♥ ♦)', () => act({ a: 'red' }), 'red');
        B('⚫ 검정 (♠ ♣)', () => act({ a: 'black' }), 'dark');
        break;
      case 'ranch':
        text = `<b>목장</b> — 바꿀 카드를 고르세요 (${sel.length}장) — 그만큼 다시 뽑아요`;
        B(`바꾸기 (${sel.length}장)`, () => act({ a: 'swap', cs: sel }), 'red', !sel.length);
        B('그대로', () => act({ a: 'skip' }), 'dark');
        break;
    }
  }
  tx.innerHTML = text;
  bt.innerHTML = '';
  for (const b of btns) {
    const e = document.createElement('button');
    e.className = 'wbtn sm ' + b.cls; e.innerHTML = `<span>${b.label}</span>`; e.disabled = b.dis; e.onclick = b.fn;
    bt.appendChild(e);
  }
  box.classList.toggle('empty', !text);
}
$('#store').addEventListener('click', e => {
  const c = e.target.closest('.card'), r = myReq();
  if (c && r && r.kind === 'store') act({ a: 'pick', c: Number(c.dataset.cid) });
});
function luckyPop(r) {
  const q = myReq();
  if (!q || q.kind !== 'lucky' || !$('#pop').hidden) return;
  const hint = { '술통': '♥가 나오면 빗나감!', '감옥': '♥가 나오면 풀려나요', '다이너마이트': '♠2~9가 나오면 터져요' }[r.what] || '';
  openPop(`<p class="pop-title">럭키 듀크 — ${esc(r.what)} 뽑기!</p><p class="pop-sub">두 장 중 하나를 고르세요 · ${hint}</p><div class="sp-row">${r.cards.map(c => `<button class="sp-opt" data-c="${c.id}">${cardHTML(c)}</button>`).join('')}</div>`, true);
  $$('#popBox [data-c]').forEach(b => b.onclick = () => { closePop(); act({ a: 'pick', c: Number(b.dataset.c) }); });
}
function daltonsPop(r) {
  const q = myReq();
  if (!q || q.kind !== 'daltons' || !$('#pop').hidden) return;
  openPop(`<p class="pop-title">달튼 형제</p><p class="pop-sub">내 앞의 파란 카드 중 버릴 1장을 고르세요</p><div class="sp-row">${r.cards.map(c => `<button class="sp-opt" data-c="${c.id}">${cardHTML(c)}</button>`).join('')}</div>`, true);
  $$('#popBox [data-c]').forEach(b => b.onclick = () => { closePop(); act({ a: 'pick', c: Number(b.dataset.c) }); });
}
function kitPop(r) {
  const q = myReq();
  if (!q || q.kind !== 'kit' || !$('#pop').hidden) return;
  openPop(`<p class="pop-title">킷 칼슨</p><p class="pop-sub">더미 위로 돌려놓을 1장을 고르세요 — 나머지 2장을 가집니다</p><div class="sp-row">${r.cards.map(c => `<button class="sp-opt" data-c="${c.id}">${cardHTML(c)}</button>`).join('')}</div>`, true);
  $$('#popBox [data-c]').forEach(b => b.onclick = () => { closePop(); act({ a: 'back', c: Number(b.dataset.c) }); });
}

/* 남은 시간 — 할 일 막대와 그 사람 초상 둘레 */
function tick() {
  requestAnimationFrame(tick);
  const g = G();
  if (screen !== 'game' || !g || !g.req || !drawn.deadline) { $('#actBar').style.transform = 'scaleX(0)'; return; }
  const left = drawn.deadline - (Date.now() + skew), total = (drawn.secs || 1) * 1000;
  const f = Math.max(0, Math.min(1, left / total));
  $('#actBar').style.transform = `scaleX(${f})`;
  $('#actBar').classList.toggle('low', f < .25);
  $$('.opp, .me').forEach(el => {
    const fg = el.querySelector('.ring .fg'); if (!fg) return;
    const id = el.classList.contains('me') ? me : Number(el.dataset.pid);
    fg.style.strokeDashoffset = id === g.req.to ? RING_C * (1 - f) : RING_C;
  });
}
requestAnimationFrame(tick);

/* ─────────────────────────── 연출 ─────────────────────────── */
function relPt(el) { const t = $('#table').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - t.left + r.width / 2, y: r.top - t.top + r.height / 2 }; }
function anchor(id) {
  const el = id === me ? $('#me .me-card') : $(`#opps .opp[data-pid="${id}"] .por`);
  if (!el) { const t = $('#table'); return { x: t.clientWidth / 2, y: t.clientHeight / 2 }; }
  return relPt(el);
}
const deckPt = () => relPt($('#deck'));
const pilePt = () => relPt($('#pile'));
function fxEl(cls, html, at, ms = 1300) {
  const e = document.createElement('div');
  e.className = 'fx ' + cls; e.innerHTML = html;
  e.style.left = at.x + 'px'; e.style.top = at.y + 'px';
  $('#fx').appendChild(e);
  setTimeout(() => e.remove(), ms);
  return e;
}
function tracer(a, b) {
  const p = anchor(a), q = anchor(b), dx = q.x - p.x, dy = q.y - p.y;
  const e = document.createElement('div');
  e.className = 'tracer';
  e.style.left = p.x + 'px'; e.style.top = p.y + 'px'; e.style.width = Math.hypot(dx, dy) + 'px';
  e.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  $('#fx').appendChild(e);
  setTimeout(() => e.remove(), 500);
  const f = fxEl('muzzle', '', p, 420);
  f.style.transform = `translate(-10%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
  setTimeout(() => fxEl('smoke', '', p, 1200), 120);
}
function shake(id) { const el = id === me ? $('#me') : $(`#opps .opp[data-pid="${id}"]`); if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); } }
/** 카드 한 장이 a 에서 b 로 날아간다 */
function flyCard(c, from, to) {
  const p = from === 'deck' ? deckPt() : from === 'pile' ? pilePt() : anchor(from);
  const q = to === 'pile' ? pilePt() : to === 'deck' ? deckPt() : anchor(to);
  const e = document.createElement('div');
  e.className = 'fly';
  e.innerHTML = c ? cardHTML(c) : `<span class="card back"><img class="c-art" src="${CARD_IMG('back')}" alt=""></span>`;
  e.style.left = p.x + 'px'; e.style.top = p.y + 'px';
  $('#fx').appendChild(e);
  requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transform = `translate(-50%, -50%) translate(${q.x - p.x}px, ${q.y - p.y}px) rotate(${(Math.random() - .5) * 16}deg)`; }));
  setTimeout(() => e.remove(), 700);
}
function banner(text, cls = '') { return fxEl('banner ' + cls, text, { x: $('#table').clientWidth / 2, y: $('#table').clientHeight * .4 }, 1500); }
function showFlip(e) {
  const f = $('#flip');
  f.innerHTML = `<p class="flip-t">${esc(nameOf(e.id))} — ${e.what} 뽑기!</p><div class="flip-row">${e.cs.map(id => cardHTML(DECK[id], e.cs.length > 1 ? (id === e.pick ? 'pick' : 'dim') : '')).join('')}</div><p class="flip-v ${e.ok ? 'ok' : 'no'}">${e.ok ? '성공!' : '실패…'}</p>`;
  f.hidden = false;
  setTimeout(() => { f.hidden = true; }, FX_MS.flip - 100);
}

async function playFx(list) {
  for (const e of list) {
    const ms = FX_MS[e.fx] || 300;
    switch (e.fx) {
      case 'turn': if (e.id === me) { banner('당신의 차례!', 'mine'); sfx.turn(); } else banner(`${esc(nameOf(e.id))} 님의 차례`); break;
      case 'play': {
        const k = DECK[e.c].k;
        flyCard(DECK[e.c], e.id, 'pile'); sfx.card();
        if (!['bang', 'missed'].includes(k)) fxEl('word', KINDS[k].name, anchor(e.id), 1100);
        break;
      }
      case 'equip': flyCard(DECK[e.c], e.by != null ? e.by : e.id, e.id); fxEl('word', KINDS[DECK[e.c].k].name, anchor(e.id), 1100); sfx.card(); break;
      case 'shot': tracer(e.from, e.to); sfx.shot(); fxEl('burst', '<b>BANG!</b>', anchor(e.to), 1100); break;
      case 'hurt': fxEl('dmg', '−' + e.n, anchor(e.id)); shake(e.id); sfx.hurt(); break;
      case 'heal': fxEl('heal', '+1', anchor(e.id)); sfx.heal(); break;
      case 'dodge': fxEl('word miss', '빗나감!', anchor(e.id), 1100); sfx.miss(); break;
      case 'spend': case 'discard':
        if (e.deck) { for (let i = 0; i < Math.min(e.n || 1, 3); i++) setTimeout(() => flyCard(null, e.id, 'deck'), i * 100); }
        else for (const c of e.cs) flyCard(DECK[c], e.id, 'pile');
        sfx.card(); break;
      case 'flip': showFlip(e); sfx.card(); break;
      case 'boom': fxEl('boom', '<b>쾅!</b>', anchor(e.id), 1500); shake(e.id); sfx.boom(); break;
      case 'die': fxEl('skull', '☠', anchor(e.id), 2200); banner(`${esc(nameOf(e.id))} 님이 쓰러졌습니다 — ${ROLES[e.role].name}`, 'die'); sfx.die(); break;
      case 'jailed': fxEl('word', '감옥에서 턴을 거름', anchor(e.id), 1300); break;
      case 'gatling': banner('기관총!', 'big'); sfx.shot(); setTimeout(sfx.shot, 140); setTimeout(sfx.shot, 280); break;
      case 'indians': banner('인디언!', 'big'); break;
      case 'steal': flyCard(e.c != null ? DECK[e.c] : null, e.from, e.to); if (e.to === me) toast(`${nameOf(e.from)} 님에게서 카드를 가져왔어요`); else if (e.from === me) toast(`${nameOf(e.to)} 님이 내 카드를 가져갔어요`); break;
      case 'lose': if (e.c != null) flyCard(DECK[e.c], e.id, 'pile'); break;
      case 'draw': for (let i = 0; i < Math.min(e.n || 1, 3); i++) setTimeout(() => flyCard(null, e.from === 'pile' ? 'pile' : 'deck', e.to), i * 120); break;
      case 'take': flyCard(DECK[e.c], 'pile', e.id); break;
      case 'show': fxEl('word', `두 번째 장 ${KINDS[DECK[e.c].k].name} ${RANKS[DECK[e.c].r]}${SUITS[DECK[e.c].s]}`, anchor(e.id), 1100); break;
      case 'pass': flyCard(DECK[e.c], e.from, e.to); fxEl('word', '다이너마이트가 넘어간다', anchor(e.to), 900); break;
      case 'over': sfx.win(); break;
      case 'event': showEvent(e.k); break;
      case 'revive': fxEl('word', e.ghost ? '👻 유령으로 돌아왔다!' : '⚰ 다시 일어났다!', anchor(e.id), 1500); break;
      case 'reshuffle': toast('버린 카드를 섞어 새 더미를 만들었어요'); break;
    }
    await wait(ms);
  }
}

function showEvent(k) {
  const d = document.createElement('div');
  d.className = 'ev-big';
  d.innerHTML = `${evCard(k)}<p>새 이벤트!</p>`;
  $('#table').appendChild(d);
  sfx.turn();
  setTimeout(() => d.remove(), FX_MS.event - 200);
}
/** 이번 판 역할 구성 — "보안관 1 · 부관 1 · 무법자 2 · 배신자 1" */
function roleMix(n) {
  const c = {}; for (const r of ROLES_BY_N[n] || []) c[r] = (c[r] || 0) + 1;
  return ['sheriff', 'deputy', 'outlaw', 'renegade'].filter(r => c[r]).map(r => `${roleImg(r, 'ri sm')} ${ROLES[r].name} ${c[r]}`).join(' · ');
}
function showGate(ms) {
  gateShown = true;
  const g = G(), sh = g.players.find(p => p.role === 'sheriff');
  const el = $('#gate');
  el.innerHTML = `<div class="gate-in"><img src="${CHAR_IMG(sh.char)}" alt=""><p class="gate-k">⭐ 보안관</p><p class="gate-t"><b>${esc(sh.name)}</b> 님부터 시작합니다</p><p class="gate-s">${sh.id === me ? '당신이 보안관이에요 — 먼저 쏘세요!' : '차례는 시계 방향 — 내 왼쪽 사람이 다음이에요'}</p><p class="gate-r">${roleMix(g.players.length)}</p></div>`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, Math.min(ms, 3400));
}

/* 표정 · 말풍선 */
function floatEmo(pid, e) { if (screen === 'game') { const at = anchor(pid); fxEl('emo', EMO[e] || '❔', { x: at.x, y: at.y - 30 }, 1800); } }
function bubble(pid, text) {
  if (!G() || !G().players.some(p => p.id === pid)) return;
  const at = anchor(pid);
  fxEl('say', esc(text.length > 40 ? text.slice(0, 40) + '…' : text), { x: at.x, y: at.y - 50 }, Math.min(5000, 1600 + text.length * 70));
}
$('#reacts').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { send({ t: 'react', e: Number(b.dataset.e) }); $('#reacts').classList.remove('open'); } });
$('#bEmo').onclick = () => $('#reacts').classList.toggle('open');

/* 기록 */
function addLogs(logs) {
  const el = $('#logIn');
  for (const l of logs || []) { const d = document.createElement('p'); d.className = 'l ' + (l.cls || ''); d.textContent = l.text; el.appendChild(d); }
  while (el.children.length > 250) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
$('#bLog').onclick = () => $('#log').classList.toggle('open');
$('#logX').onclick = () => $('#log').classList.remove('open');

/* ─────────────────────────── 끝 ─────────────────────────── */
function showOver() {
  const g = G(); if (!g || !g.over) return;
  show('over');
  const win = new Set(g.over.winners);
  const T = { sheriff: ['보안관 편 승리', '무법자와 배신자를 모두 잡았습니다'], outlaw: ['무법자 승리', '보안관이 쓰러졌습니다'], renegade: ['배신자 승리', '배신자가 홀로 살아남았습니다'] }[g.over.team];
  $('#oTitle').textContent = T[0];
  $('#oSub').textContent = me != null ? (win.has(me) ? '🏆 당신이 이겼어요! ' : '아쉽게 졌어요. ') + T[1] : T[1];
  $('#oFinal').innerHTML = g.players.map(p => `<li class="${win.has(p.id) ? 'win' : ''} ${p.alive ? '' : 'dead'}">
    <img src="${CHAR_IMG(p.char)}" alt=""><span><b>${roleImg(p.role, 'ri sm')} ${esc(p.name)}</b><small>${ROLES[p.role].name} · ${CHARS[p.char].name}</small><small>${p.alive ? '살아남음' : '☠ 쓰러짐'}</small></span></li>`).join('');
  const host = !isSpec() && S.hostId === me;
  $('#bAgain').hidden = !host;
  $('#oWait').textContent = host ? '' : '방장이 다음 판을 고르는 중…';
  $('#oSpecNote').hidden = !isSpec();
}
$('#bAgain').onclick = () => send({ t: 'again' });

const leave = () => {
  const code = ss.get('code'), token = ss.get('token');
  ss.del('code'); ss.del('token');
  specCtx = null; specId = null; specRejoin = false; resting = false; wokeUp = false;
  $('#toast').classList.remove('on');
  if (ws && ws.readyState === 1) send({ t: 'leave' });
  else if (code && token) { leaving = true; connect(() => { send({ t: 'resume', code, token }); send({ t: 'leave' }); }); }
  history.replaceState(null, '', location.pathname);
  S = null; drawn = null; queue.length = 0;
  show('setup');
};
$('#bLeave1').onclick = leave;
$('#bLeave3').onclick = leave;
$('#bLeave2').onclick = () => {
  if (isSpec() || (G() && G().over)) return leave();
  openPop(`<p class="pop-title">테이블을 떠날까요?</p><p class="pop-sub">판이 끝나기 전에 나가면 내 자리는 봇이 이어받아요.</p><div class="pop-acts"><button class="wbtn dark" data-x><span>계속하기</span></button><button class="wbtn red" id="leaveYes"><span>떠나기</span></button></div>`);
  $('#leaveYes').onclick = () => { closePop(); leave(); };
};

/* ─────────────────────────── 창 · 크게 보기 ─────────────────────────── */
function openPop(html, sticky) {
  $('#popBox').innerHTML = html;
  $('#pop').hidden = false;
  $('#pop').dataset.sticky = sticky ? '1' : '';
  $$('#popBox [data-x]').forEach(b => b.onclick = closePop);
}
function closePop() {
  const was = !$('#pop').hidden;
  $('#pop').hidden = true; $('#popBox').innerHTML = ''; $('#pop').dataset.sticky = '';
  if (was && screen === 'game' && G()) setTimeout(() => { if (screen === 'game' && G()) renderAct(); }, 0);
}
$('#pop').onclick = e => { if (e.target.id === 'pop' && !$('#pop').dataset.sticky) closePop(); };

const tip = $('#tip');
function hideTip() { tip.hidden = true; }
function tipCard(c) { return `${cardHTML(c)}<h4>${KINDS[c.k].name} <small>${RANKS[c.r]}${SUITS[c.s]}${KINDS[c.k].blue ? ' · 파란 카드(앞에 놓는다)' : ''}</small></h4><p>${esc(KINDS[c.k].desc)}</p>`; }
function tipChar(k) { return `<img class="tip-por" src="${CHAR_IMG(k)}" alt=""><h4>${CHARS[k].name} <small>생명 ${CHARS[k].hp}</small></h4><p>${esc(CHARS[k].desc)}</p>`; }
function placeTip(x, y) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let L = x + 18, T = y - h / 2;
  if (y > innerHeight * .6) { L = x - w / 2; T = y - h - 26; }
  if (L + w > innerWidth - 8) L = Math.min(x - w - 18, innerWidth - w - 8);
  tip.style.left = Math.max(8, L) + 'px'; tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, T)) + 'px';
}
let tipT = null, tipAt = null;
document.addEventListener('mouseover', e => {
  if (matchMedia('(hover: none)').matches) return;
  const c = e.target.closest('.card[data-cid]');
  const ch = !c && e.target.closest('[data-char]');
  const evc = !c && !ch && e.target.closest('.ecard[data-ev]');
  clearTimeout(tipT);
  if ((!c || c.closest('#tip, .fly')) && !ch && !evc) { hideTip(); return; }
  tipT = setTimeout(() => {
    if (!tipAt) return;
    tip.innerHTML = c ? tipCard(DECK[Number(c.dataset.cid)]) : ch ? tipChar(ch.dataset.char) : `<h4>${EVENTS[evc.dataset.ev].name} <small>${EVENTS[evc.dataset.ev].set === 'hn' ? '하이눈' : '한 줌의 카드'}${evc.classList.contains('next') ? ' · 다음 이벤트' : ''}</small></h4><p>${esc(EVENTS[evc.dataset.ev].desc)}</p>`;
    tip.hidden = false; placeTip(tipAt.x, tipAt.y);
  }, tip.hidden ? 420 : 60);
});
document.addEventListener('mousemove', e => { tipAt = { x: e.clientX, y: e.clientY }; if (!tip.hidden) placeTip(e.clientX, e.clientY); });
document.addEventListener('pointerdown', () => { clearTimeout(tipT); hideTip(); });
function tipFor(id) { if (matchMedia('(hover: none)').matches) infoPop(tipCard(DECK[id])); }
/* 손가락으로는 마우스를 올릴 수 없으니 — 누르면 크게 보여 준다(대상을 고르는 중이 아닐 때) */
function infoPop(html) { openPop(`<div class="info-pop">${html}</div><div class="pop-acts"><button class="wbtn dark" data-x><span>닫기</span></button></div>`); }
document.addEventListener('click', e => {
  if (!matchMedia('(hover: none)').matches || screen !== 'game') return;
  if (e.target.closest('#hand, #pop, #act, .chat, #help')) return;
  if (e.target.closest('.o-tbl .card.aim, .opp.target, .me.target')) return;
  const c = e.target.closest('.card[data-cid]'), ch = !c && e.target.closest('[data-char]'), ev = !c && !ch && e.target.closest('.ecard[data-ev]');
  if (c) infoPop(tipCard(DECK[Number(c.dataset.cid)]));
  else if (ch) infoPop(tipChar(ch.dataset.char));
  else if (ev) { const E = EVENTS[ev.dataset.ev]; infoPop(`<h4>${E.name}</h4><p>${esc(E.desc)}</p>`); }
}, true);

/* ─────────────────────────── 규칙 ─────────────────────────── */
const HELP = {
  basic: () => `
    <p class="lead">정체를 숨긴 총잡이들이 서로를 쏘는 서부 카드게임. 4~7명이 한 테이블에 둘러앉는다.</p>
    <div class="roles-strip">${Object.keys(ROLES).map(r => `<figure><img src="${ROLE_IMG(r)}" alt=""><figcaption>${roleImg(r, 'ri sm')} <b>${ROLES[r].name}</b><small>${ROLES[r].goal}</small></figcaption></figure>`).join('')}</div>
    <p>역할은 몰래 받는다. <b>보안관만 정체를 드러내고</b>, 생명이 1 더 많으며 먼저 시작한다. 4명: 보안관·배신자·무법자 2 / 5명: +부관 / 6명: +무법자 / 7명: +부관</p>
    <h4>내 차례</h4>
    <ol><li><b>뽑기</b> — 카드 2장을 뽑는다.</li><li><b>내기</b> — 원하는 만큼 카드를 낸다. 단, <b>뱅!은 한 턴에 한 장</b>. 앞에 놓는 파란 카드는 같은 것을 두 장 놓을 수 없고, 무기는 하나만.</li><li><b>버리기</b> — 손 카드가 남은 생명보다 많으면 그만큼 버린다.</li></ol>
    <h4>거리와 사거리</h4>
    <p>거리는 살아 있는 사람 사이의 자리 수(왼쪽·오른쪽 중 가까운 쪽). 뱅!은 내 <b>사거리</b> 안의 사람에게만 쏠 수 있다(무기가 없으면 콜트 45 · 사거리 1). 야생마는 남이 나를 볼 때 +1, 조준경은 내가 남을 볼 때 −1.</p>
    <h4>쓰러짐</h4>
    <p>생명이 0이 되면 곧바로 맥주를 내 버틸 수 있다. 못 버티면 쓰러지고 정체를 밝힌다. <b>무법자를 쓰러뜨린 사람은 현상금으로 3장</b>을 뽑고, <b>보안관이 부관을 쓰러뜨리면</b> 보안관은 가진 카드를 모두 버린다.</p>
    <h4>뽑기!</h4>
    <p>술통 · 감옥 · 다이너마이트는 더미 맨 위 카드를 뒤집어 무늬로 판가름한다. 술통 · 감옥은 ♥면 성공, 다이너마이트는 ♠2~9면 터져 생명 3을 잃는다. 턴을 시작할 때 다이너마이트를 먼저, 감옥을 나중에 본다.</p>
    <h4>이기는 조건</h4>
    <p>보안관이 쓰러지면 무법자 승리(단, 마지막에 배신자 혼자 남았다면 배신자 승리). 무법자와 배신자가 모두 쓰러지면 보안관 편 승리.</p>`,
  cards: () => `<div class="help-cards">${Object.keys(KINDS).map(k => `<div class="hcard">${cardHTML(DECK.find(c => c.k === k))}<p><b>${KINDS[k].name}</b>${KINDS[k].blue ? ' <small>파란 카드</small>' : ''}<br>${esc(KINDS[k].desc)}</p></div>`).join('')}</div>`,
  exp: () => `<p class="lead">BGA 의 확장 두 가지 — 방장이 대기실에서 고른다.</p>
    <p>이벤트 카드는 <b>보안관의 두 번째 턴부터</b> 보안관 차례마다 한 장씩 뒤집히고, 한 바퀴 동안 모두에게 걸린다. 가운데 흐리게 보이는 카드가 다음 이벤트. 마지막 카드(하이눈 / 한 줌의 카드)는 끝까지 남는다. 둘 다 쓰면 12장 + 마지막 1장.</p>
    <p><b>부활 카드</b>(유령 마을 · 죽은 자)를 넣으면, 그 카드가 남아 있는 동안 쓰러진 사람이 다시 돌아올 수 있다.</p>
    <h4>☀ 하이눈</h4><div class="help-ev">${Object.keys(EVENTS).filter(k => EVENTS[k].set === 'hn').map(k => `<div><b>${EVENTS[k].name}</b>${EVENTS[k].last ? ' (마지막)' : ''} — ${esc(EVENTS[k].desc)}</div>`).join('')}</div>
    <h4>🃏 한 줌의 카드</h4><div class="help-ev">${Object.keys(EVENTS).filter(k => EVENTS[k].set === 'foc').map(k => `<div><b>${EVENTS[k].name}</b>${EVENTS[k].last ? ' (마지막)' : ''} — ${esc(EVENTS[k].desc)}</div>`).join('')}</div>`,
  chars: () => `<div class="help-chars">${Object.keys(CHARS).map(k => `<div class="hch"><img src="${CHAR_IMG(k)}" alt=""><p><b>${CHARS[k].name}</b> <small>생명 ${CHARS[k].hp}</small><br>${esc(CHARS[k].desc)}</p></div>`).join('')}</div>`,
  ui: () => `<ul class="tips">
    <li>시작하면 역할 카드를 받고, <b>인물 카드 두 장 중 하나</b>를 고른다. 모두 고르면 보안관부터 시작한다.</li>
    <li>내 차례에 <b>빛나는 카드</b>를 누르면 고르고, 한 번 더 누르면(또는 두 번 누르면) 쓴다. 대상이 필요한 카드는 <b>빨갛게 빛나는 자리</b>를 누른다.</li>
    <li>못 내는 카드를 누르면 까닭을 알려 준다.</li>
    <li>누가 나를 쏘면 아래 막대에 <b>막기 / 맞기</b>가 뜬다. 술통은 저절로 먼저 뽑는다.</li>
    <li>카드나 인물 위에 마우스를 올리면 크게 보인다. 📜는 지금까지의 기록.</li>
    <li>시간이 다 되면 턴은 끝나고 막기는 봇이 대신 고른다. 판 중에 나가면 그 자리는 봇이 이어받는다.</li>
    <li>채팅은 자유지만 손에 든 카드를 그대로 말하는 건 반칙!</li></ul>`,
};
function helpTab(t) { $$('#helpTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $('#helpBody').innerHTML = HELP[t](); $('#helpBody').scrollTop = 0; }
const openHelp = () => { helpTab('basic'); $('#help').hidden = false; };
$$('[data-help]').forEach(b => b.onclick = openHelp);
$$('#helpTabs button').forEach(b => b.onclick = () => helpTab(b.dataset.tab));
$('#bHelpX').onclick = () => { $('#help').hidden = true; };
$('#help').onclick = e => { if (e.target.id === 'help') $('#help').hidden = true; };
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  $('#help').hidden = true; if (!$('#pop').dataset.sticky) closePop(); $('#log').classList.remove('open'); if (!$('#chat').hidden) chatOpen(false);
});

/* 계측용 — ?qa 로 들어올 때만 연출을 손으로 틀어 본다 */
if (new URLSearchParams(location.search).has('qa')) window.__qa = { playFx, G, me: () => me, feed: m => { show('game'); onState(m); } };

/* ─────────────────────────── 시작 ─────────────────────────── */
$('#gName').value = ls.get('bang.name') || '';
const invited = new URLSearchParams(location.search).get('r');
if (invited) $('#gCode').value = invited.toUpperCase().slice(0, 4);
if (ss.get('code') && ss.get('token')) resume();
else if (invited) show('setup');
else show('title');
