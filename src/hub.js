/**
 * 뱅! — 대기방 · 방 · 채팅. 소켓이 어떤 것인지는 모른다(send · close 만 쓴다).
 * Node 서버(server.js)와 Cloudflare(worker.js)가 이 파일을 똑같이 쓴다.
 *
 * 사람은 pid(브라우저에 저장한 무작위 표식)로 알아본다. 새로고침해도 같은 사람이고, 판에 앉아 있었다면
 * 그 자리로 돌아간다. 판은 서버가 원본이고, 화면에는 사람마다 볼 수 있는 것만 내려보낸다.
 *
 * 시간: 내 턴은 opts.turn 초, 막기·고르기는 opts.react 초. 시간이 다 되면 턴은 끝내고
 * 막기는 봇이 대신 고른다. 한 번 시간을 넘긴 사람(자리 비움)은 다시 손댈 때까지 봇이 빠르게 대신 둔다.
 */
import { Game } from './engine.js';
import { decide } from './bot.js';
import { MIN_PLAYERS, MAX_PLAYERS } from '../public/cards.js';

const BOT_NAMES = ['빌리', '장고', '애니', '와이엇', '돌리', '부치', '캘빈', '로이', '매기', '행크', '조시', '루비'];
const MAX_NAME = 12, MAX_TITLE = 24, MAX_CHAT = 200, CHAT_KEEP = 80;
const TURN_SECS = [30, 45, 60, 90], REACT_SECS = [10, 15, 20, 30];

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const pick = a => a[Math.floor(Math.random() * a.length)];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Hub {
  constructor(opt = {}) {
    this.users = new Map();     // pid → { pid, name, sock, room, seen, afk }
    this.rooms = new Map();     // code → room
    this.lobbyChat = [];
    this.fast = !!opt.fast;     // 시험용: 봇이 기다리지 않는다
    this.dirty = false;
    this.flushT = null;
  }

  /* ───────────── 소켓 ───────────── */

  send(sock, o) { if (sock) try { sock.send(JSON.stringify(o)); } catch (_) {} }
  sendU(u, o) { if (u && u.sock) this.send(u.sock, o); }

  connect(sock) { sock.u = null; }

  close(sock) {
    const u = sock.u;
    if (!u || u.sock !== sock) return;
    u.sock = null;
    u.seen = Date.now();
    const room = u.room && this.rooms.get(u.room);
    if (room) {
      // 새로고침이면 몇 초 안에 돌아온다 — 대기 중인 방에서도 자리를 잠깐 지켜 준다
      if (room.phase === 'wait') setTimeout(() => { if (!u.sock && u.room === room.code && room.phase === 'wait') this.leaveRoom(u, true); }, this.fast ? 50 : 15_000);
      this.pushRoom(room);
      if (room.game) { this.schedule(room); this.pushGame(room); }
    }
    this.lobbyDirty();
  }

  message(sock, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') return this.hello(sock, m);
    const u = sock.u;
    if (!u || u.sock !== sock) return;
    u.seen = Date.now();
    try {
      switch (m.t) {
        case 'name': u.name = clean(m.name, MAX_NAME) || u.name; this.sendU(u, { t: 'hi', pid: u.pid, name: u.name }); this.refreshName(u); break;
        case 'create': this.create(u, m); break;
        case 'join': this.join(u, String(m.code || '').toUpperCase()); break;
        case 'leave': this.leaveRoom(u); break;
        case 'chat': this.chat(u, m.text); break;
        case 'addbot': this.addBot(u); break;
        case 'kick': this.kick(u, m.pid); break;
        case 'opt': this.setOpt(u, m); break;
        case 'start': this.start(u); break;
        case 'again': this.again(u); break;
        case 'sit': this.sit(u); break;
        case 'act': this.act(u, m); break;
        case 'back': this.back(u); break;
      }
    } catch (e) {
      this.sendU(u, { t: 'err', m: String(e.message || e) });
    }
  }

  hello(sock, m) {
    let pid = clean(m.pid, 40);
    if (!/^[a-z0-9]{8,40}$/i.test(pid)) pid = Array.from({ length: 16 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('').toLowerCase();
    let u = this.users.get(pid);
    const name = clean(m.name, MAX_NAME) || (u && u.name) || '총잡이' + Math.floor(Math.random() * 900 + 100);
    if (u && u.sock && u.sock !== sock) { this.send(u.sock, { t: 'kicked', m: '다른 창에서 접속했습니다' }); try { u.sock.close(4001, 'dup'); } catch (_) {} }
    if (!u) { u = { pid, name, sock: null, room: null, seen: Date.now(), afk: false }; this.users.set(pid, u); }
    u.sock = sock; u.name = name; u.seen = Date.now(); u.afk = false;
    sock.u = u;
    this.sendU(u, { t: 'hi', pid, name });
    const room = u.room && this.rooms.get(u.room);
    if (room) { this.refreshName(u); this.enterRoom(u, room); }
    else { u.room = null; this.sendLobby(u, true); }
    this.lobbyDirty();
  }

  /* ───────────── 대기방(로비) ───────────── */

  roomList() {
    return [...this.rooms.values()].map(r => ({
      code: r.code, title: r.title, n: r.seats.length, max: r.opts.max, phase: r.phase,
      host: (this.users.get(r.host) || {}).name || '',
      humans: r.seats.filter(s => !s.bot).length, watch: this.watchers(r).length,
    })).sort((a, b) => (a.phase === 'wait' ? 0 : 1) - (b.phase === 'wait' ? 0 : 1) || b.n - a.n);
  }
  online() { return [...this.users.values()].filter(u => u.sock).map(u => ({ name: u.name, room: u.room })); }
  sendLobby(u, withChat) {
    const o = { t: 'lobby', rooms: this.roomList(), online: this.online() };
    if (withChat) o.chat = this.lobbyChat;
    this.sendU(u, o);
  }
  lobbyDirty() {
    if (this.flushT) return;
    this.flushT = setTimeout(() => {
      this.flushT = null;
      const o = JSON.stringify({ t: 'lobby', rooms: this.roomList(), online: this.online() });
      for (const u of this.users.values()) if (u.sock && !u.room) try { u.sock.send(o); } catch (_) {}
    }, this.fast ? 0 : 400);
  }

  chat(u, text) {
    text = clean(text, MAX_CHAT);
    if (!text) return;
    const now = Date.now();
    if (u.lastChat && now - u.lastChat < 400) return;
    u.lastChat = now;
    const msg = { name: u.name, pid: u.pid, text, ts: now };
    const room = u.room && this.rooms.get(u.room);
    if (room) {
      room.chat.push(msg); if (room.chat.length > CHAT_KEEP) room.chat.shift();
      for (const v of this.members(room)) this.sendU(v, { t: 'chat', ch: 'room', m: msg });
    } else {
      this.lobbyChat.push(msg); if (this.lobbyChat.length > CHAT_KEEP) this.lobbyChat.shift();
      for (const v of this.users.values()) if (v.sock && !v.room) this.sendU(v, { t: 'chat', ch: 'lobby', m: msg });
    }
  }
  sysChat(room, text) {
    const msg = { sys: true, text, ts: Date.now() };
    room.chat.push(msg); if (room.chat.length > CHAT_KEEP) room.chat.shift();
    for (const v of this.members(room)) this.sendU(v, { t: 'chat', ch: 'room', m: msg });
  }

  /* ───────────── 방 ───────────── */

  newCode() { let c; do c = Array.from({ length: 4 }, () => pick(ALPHA)).join(''); while (this.rooms.has(c)); return c; }

  create(u, m) {
    if (u.room) this.leaveRoom(u, true);
    const room = {
      code: this.newCode(), title: clean(m.title, MAX_TITLE) || `${u.name}의 방`,
      host: u.pid, phase: 'wait', seats: [], opts: { max: 7, turn: 60, react: 15 },
      game: null, chat: [], timer: null, deadline: 0, created: Date.now(), empty: 0, botN: 0,
    };
    this.rooms.set(room.code, room);
    room.seats.push({ id: u.pid, pid: u.pid, name: u.name, bot: false });
    u.room = room.code;
    this.sysChat(room, `${u.name} 님이 방을 열었습니다.`);
    this.enterRoom(u, room);
    this.lobbyDirty();
  }

  join(u, code) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('없는 방입니다');
    if (u.room === code) return this.enterRoom(u, room);
    if (u.room) this.leaveRoom(u, true);
    u.room = code;
    if (room.phase === 'wait') {
      if (room.seats.length >= room.opts.max) {
        // 봇 자리가 있으면 사람에게 내준다
        const b = room.seats.findIndex(s => s.bot);
        if (b < 0) { u.room = null; throw new Error('방이 꽉 찼습니다'); }
        room.seats.splice(b, 1);
      }
      room.seats.push({ id: u.pid, pid: u.pid, name: u.name, bot: false });
      this.sysChat(room, `${u.name} 님이 들어왔습니다.`);
    } else {
      const mine = room.seats.find(s => s.pid === u.pid && s.gone);
      if (mine && room.phase === 'play') { mine.gone = false; this.sysChat(room, `${u.name} 님이 자리로 돌아왔습니다.`); }
      else this.sysChat(room, `${u.name} 님이 구경하러 왔습니다.`);
    }
    this.enterRoom(u, room);
    this.lobbyDirty();
  }

  /** 방 화면을 처음부터 보낸다(들어올 때 · 다시 붙을 때) */
  enterRoom(u, room) {
    u.logN = -1;
    this.sendU(u, { t: 'room', room: this.roomInfo(room), chat: room.chat });
    if (room.game) this.pushGame(room, u);
  }

  leaveRoom(u, quiet) {
    const room = u.room && this.rooms.get(u.room);
    u.room = null;
    if (room) {
      const i = room.seats.findIndex(s => s.pid === u.pid);
      if (room.phase === 'wait' || room.phase === 'over') {
        if (i >= 0) room.seats.splice(i, 1);
      } else if (i >= 0) {
        room.seats[i].gone = true;                     // 판이 돌고 있으면 자리는 봇이 맡는다
        this.sysChat(room, `${u.name} 님이 나갔습니다. 남은 판은 봇이 대신합니다.`);
      }
      if (i >= 0 && room.phase !== 'play') this.sysChat(room, `${u.name} 님이 나갔습니다.`);
      if (room.host === u.pid) this.passHost(room);
      if (!this.humansIn(room).length) this.dropRoom(room);
      else { this.pushRoom(room); if (room.game) this.schedule(room); }
    }
    if (!quiet || u.sock) this.sendLobby(u, true);
    this.lobbyDirty();
  }

  passHost(room) {
    const next = this.humansIn(room).find(v => v.sock) || this.humansIn(room)[0];
    if (next) { room.host = next.pid; this.sysChat(room, `${next.name} 님이 방장이 되었습니다.`); }
  }

  /** 방 안에 있는 사람(앉은 사람 + 구경꾼) */
  members(room) { return [...this.users.values()].filter(v => v.room === room.code); }
  humansIn(room) { return this.members(room); }
  watchers(room) { return this.members(room).filter(v => !room.seats.some(s => s.pid === v.pid && !s.gone)); }

  dropRoom(room) {
    clearTimeout(room.timer);
    this.rooms.delete(room.code);
    for (const v of this.members(room)) { v.room = null; this.sendLobby(v, true); }
    this.lobbyDirty();
  }

  roomInfo(room) {
    return {
      code: room.code, title: room.title, host: room.host, phase: room.phase, opts: room.opts,
      seats: room.seats.map(s => {
        const v = s.bot ? null : this.users.get(s.pid);
        return { id: s.id, name: s.name, bot: s.bot, gone: !!s.gone, on: s.bot || !!(v && v.sock && v.room === room.code) };
      }),
      watchers: this.watchers(room).map(v => v.name),
      min: MIN_PLAYERS,
    };
  }
  pushRoom(room) { const info = this.roomInfo(room); for (const v of this.members(room)) this.sendU(v, { t: 'room', room: info }); }

  refreshName(u) {
    const room = u.room && this.rooms.get(u.room);
    if (!room) return;
    const s = room.seats.find(x => x.pid === u.pid);
    if (s && room.phase === 'wait') { s.name = u.name; this.pushRoom(room); }
  }

  hostOnly(u) {
    const room = u.room && this.rooms.get(u.room);
    if (!room) throw new Error('방에 있지 않습니다');
    if (room.host !== u.pid) throw new Error('방장만 할 수 있습니다');
    return room;
  }

  addBot(u) {
    const room = this.hostOnly(u);
    if (room.phase !== 'wait') return;
    if (room.seats.length >= room.opts.max) throw new Error('자리가 없습니다');
    const used = new Set(room.seats.map(s => s.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || '봇' + (room.botN + 1);
    room.seats.push({ id: 'bot' + (++room.botN), pid: null, name, bot: true });
    this.pushRoom(room); this.lobbyDirty();
  }

  kick(u, id) {
    const room = this.hostOnly(u);
    if (room.phase !== 'wait') return;
    const i = room.seats.findIndex(s => s.id === id);
    if (i < 0 || room.seats[i].pid === u.pid) return;
    const s = room.seats[i];
    room.seats.splice(i, 1);
    if (!s.bot) {
      const v = this.users.get(s.pid);
      if (v) { v.room = null; this.sendU(v, { t: 'err', m: '방장이 내보냈습니다' }); this.sendLobby(v, true); }
      this.sysChat(room, `${s.name} 님이 나갔습니다.`);
    }
    this.pushRoom(room); this.lobbyDirty();
  }

  setOpt(u, m) {
    const room = this.hostOnly(u);
    if (room.phase !== 'wait') return;
    if (TURN_SECS.includes(m.turn)) room.opts.turn = m.turn;
    if (REACT_SECS.includes(m.react)) room.opts.react = m.react;
    if (Number.isInteger(m.max) && m.max >= MIN_PLAYERS && m.max <= MAX_PLAYERS && m.max >= room.seats.length) room.opts.max = m.max;
    if (typeof m.title === 'string') room.title = clean(m.title, MAX_TITLE) || room.title;
    this.pushRoom(room); this.lobbyDirty();
  }

  /** 구경하던 사람이 끝난 방/대기 중인 방에 앉는다 */
  sit(u) {
    const room = u.room && this.rooms.get(u.room);
    if (!room || room.phase !== 'wait' || room.seats.some(s => s.pid === u.pid)) return;
    if (room.seats.length >= room.opts.max) {
      const b = room.seats.findIndex(s => s.bot);
      if (b < 0) throw new Error('자리가 없습니다');
      room.seats.splice(b, 1);
    }
    room.seats.push({ id: u.pid, pid: u.pid, name: u.name, bot: false });
    this.pushRoom(room); this.lobbyDirty();
  }

  start(u) {
    const room = this.hostOnly(u);
    if (room.phase !== 'wait') return;
    // 모자란 자리는 봇으로 채운다
    while (room.seats.length < MIN_PLAYERS) this.addBot(u);
    // 자리 순서를 섞는다 — 누가 보안관 옆인지가 판을 가른다
    const seats = [...room.seats];
    for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seats[i], seats[j]] = [seats[j], seats[i]]; }
    room.seats = seats;
    room.game = new Game(seats.map(s => ({ id: s.id, name: s.name, bot: s.bot })));
    room.phase = 'play';
    for (const v of this.members(room)) { v.logN = -1; v.afk = false; }
    this.sysChat(room, '판이 시작되었습니다. 역할 카드를 확인하세요!');
    this.after(room);
    this.lobbyDirty();
  }

  again(u) {
    const room = this.hostOnly(u);
    if (room.phase !== 'over') return;
    clearTimeout(room.timer);
    room.phase = 'wait'; room.game = null;
    // 나간 사람 자리는 비운다
    room.seats = room.seats.filter(s => s.bot || (!s.gone && this.users.get(s.pid) && this.users.get(s.pid).room === room.code));
    for (const v of this.members(room)) this.sendU(v, { t: 'room', room: this.roomInfo(room) });
    this.lobbyDirty();
  }

  /* ───────────── 판 ───────────── */

  seatOf(room, id) { return room.seats.find(s => s.id === id); }

  /** 이 자리를 지금 봇이 대신해야 하는가 */
  auto(room, id) {
    const s = this.seatOf(room, id);
    if (!s || s.bot || s.gone) return 'bot';
    const v = this.users.get(s.pid);
    if (!v || !v.sock || v.room !== room.code) return 'away';
    if (v.afk) return 'away';
    return null;
  }

  /** 자리 비움에서 돌아왔다 */
  back(u) {
    u.afk = false;
    const room = u.room && this.rooms.get(u.room);
    if (room && room.game && room.phase === 'play') { this.schedule(room); this.pushGame(room); }
  }

  act(u, m) {
    const room = u.room && this.rooms.get(u.room);
    if (!room || !room.game || room.phase !== 'play') return;
    const g = room.game;
    const s = room.seats.find(x => x.pid === u.pid && !x.gone);
    if (!s || !g.req || g.req.to !== s.id) throw new Error('지금은 당신 차례가 아닙니다');
    if (m.seq !== g.req.seq) return;              // 늦게 온 답
    u.afk = false;
    g.answer(s.id, m.r);
    this.after(room);
  }

  /** 판이 한 걸음 나간 뒤: 모두에게 보내고 다음 시계를 건다 */
  after(room) {
    const g = room.game;
    if (g.over && room.phase === 'play') {
      room.phase = 'over';
      clearTimeout(room.timer);
      this.lobbyDirty();
    }
    this.schedule(room);
    this.pushGame(room);
    g.fx = [];
  }

  schedule(room) {
    clearTimeout(room.timer);
    room.timer = null;
    const g = room.game;
    if (!g || g.over || !g.req) { room.deadline = 0; return; }
    const q = g.req;
    const who = this.auto(room, q.to);
    const seq = q.seq;
    const run = fn => () => {
      room.timer = null;
      if (!room.game || room.game !== g || !g.req || g.req.seq !== seq) return;
      try { fn(); } catch (e) { console.error('auto', e); try { g.answer(q.to, { a: q.kind === 'play' ? 'end' : 'take' }); } catch (_) { g.answer(q.to, decide(g, q.to)); } }
      this.after(room);
    };
    if (who) {
      const wait = this.fast ? 0 : who === 'bot' ? 600 + Math.random() * 900 : 1200;
      room.deadline = 0;
      room.timer = setTimeout(run(() => g.answer(q.to, decide(g, q.to))), wait);
      return;
    }
    const secs = q.kind === 'play' ? room.opts.turn : room.opts.react;
    room.deadline = Date.now() + secs * 1000;
    room.timer = setTimeout(run(() => {
      const s = this.seatOf(room, q.to);
      const v = s && this.users.get(s.pid);
      if (v) { v.afk = true; this.sendU(v, { t: 'err', m: '시간이 다 되어 봇이 대신합니다. 아무 조작이나 하면 돌아옵니다.' }); }
      g.answer(q.to, q.kind === 'play' ? { a: 'end' } : decide(g, q.to));
    }), secs * 1000 + 300);
  }

  pushGame(room, only) {
    const g = room.game;
    if (!g) return;
    const left = room.deadline ? Math.max(0, Math.round((room.deadline - Date.now()) / 1000)) : 0;
    const info = { phase: room.phase, left, secs: g.req ? (g.req.kind === 'play' ? room.opts.turn : room.opts.react) : 0 };
    for (const v of only ? [only] : this.members(room)) {
      if (!v.sock) continue;
      const s = room.seats.find(x => x.pid === v.pid && !x.gone);
      const view = g.view(s ? s.id : null);
      const reset = v.logN == null || v.logN < 0;
      const logs = reset ? g.logs.slice(-150) : g.logs.filter(l => l.n >= v.logN);
      v.logN = g.logs.length ? g.logs[g.logs.length - 1].n + 1 : 0;
      this.sendU(v, {
        t: 'game', v: view, ...info, me: s ? s.id : null, auto: s ? !!this.auto(room, s.id) : false,
        ev: only ? [] : g.fx, logs, reset,
      });
    }
  }

  /* ───────────── 청소 ───────────── */

  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      const live = this.members(room).some(v => v.sock);
      if (live) { room.empty = 0; continue; }
      if (!room.empty) room.empty = now;
      if (now - room.empty > (room.phase === 'play' ? 180_000 : 60_000)) this.dropRoom(room);
    }
    for (const u of [...this.users.values()]) {
      if (!u.sock && now - u.seen > 10 * 60_000 && !(u.room && this.rooms.has(u.room))) this.users.delete(u.pid);
    }
  }
  busy() { return this.rooms.size > 0 || [...this.users.values()].some(u => u.sock); }
}
