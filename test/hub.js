/** 대기방 · 방 · 판 흐름을 가짜 소켓으로 — 사람 둘 + 봇, 끝까지 */
import { Hub } from '../src/hub.js';
import { decide } from '../src/bot.js';

const hub = new Hub({ fast: true });
const mk = name => { const s = { name, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() {} }; hub.connect(s); return s; };
const last = (s, t) => [...s.got].reverse().find(m => m.t === t);
const wait = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('실패:', m); process.exit(1); } };

const a = mk('A'), b = mk('B');
hub.message(a, { t: 'hello', name: '앨리스', pid: 'aaaaaaaaaa' });
hub.message(b, { t: 'hello', name: '밥', pid: 'bbbbbbbbbb' });
assert(last(a, 'hi').name === '앨리스', 'hi');
hub.message(a, { t: 'chat', text: '안녕 대기방' });
await wait(5);
assert(b.got.some(m => m.t === 'chat' && m.m.text === '안녕 대기방'), '대기방 채팅');
hub.message(a, { t: 'create', title: '테스트방' });
await wait(5);
const code = last(a, 'room').room.code;
assert(last(b, 'lobby').rooms.some(r => r.code === code), '방 목록');
hub.message(b, { t: 'join', code });
hub.message(b, { t: 'chat', text: '방 채팅' });
assert(a.got.some(m => m.t === 'chat' && m.ch === 'room' && m.m.text === '방 채팅'), '방 채팅');
hub.message(a, { t: 'addbot' }); hub.message(a, { t: 'addbot' }); hub.message(a, { t: 'addbot' });
assert(last(a, 'room').room.seats.length === 5, '봇 추가');
hub.message(b, { t: 'start' });
assert(last(b, 'err').m.includes('방장'), '방장만 시작');
hub.message(a, { t: 'start' });
const room = hub.rooms.get(code);
assert(room.phase === 'play', '시작');
// 사람 둘은 봇 두뇌로 대신 둔다
for (let i = 0; i < 5000 && room.phase === 'play'; i++) {
  const g = room.game;
  if (g.req && (g.req.to === 'aaaaaaaaaa' || g.req.to === 'bbbbbbbbbb')) {
    const s = g.req.to === 'aaaaaaaaaa' ? a : b;
    hub.message(s, { t: 'act', seq: g.req.seq, r: decide(g, g.req.to) });
  } else await wait(1);
}
assert(room.phase === 'over', '끝남 ' + room.phase);
const gv = last(a, 'game');
assert(gv.v.over && gv.v.players.every(p => p.role), '끝나면 역할 공개');
assert(a.got.filter(m => m.t === 'game').some(m => m.v.me && m.v.me.hand.length >= 0), '내 손');
// 남의 손은 안 보인다
assert(a.got.filter(m => m.t === 'game').every(m => typeof m.v.players[0].hand === 'number'), '남의 손 숨김');
hub.message(a, { t: 'again' });
assert(room.phase === 'wait' && room.seats.length === 5, '다시 하기');
hub.close(b);
await wait(80);
assert(room.seats.length === 4, '나가면 자리 빔');
console.log('hub ok', gv.v.over.team);
process.exit(0);
