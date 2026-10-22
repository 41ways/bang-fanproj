/** 방 흐름을 가짜 소켓으로 — 만들기 · 들어오기 · 봇 · 인물 고르기 · 끝까지 · 다시 하기 · 이어 붙기 · 관전 */
process.env.BANG_FAST = '1';
const { handle, disconnect, rooms } = await import('../src/hub.js');
const { decide } = await import('../src/bot.js');

const mk = name => ({ name, readyState: 1, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() { this.readyState = 3; } });
const last = (s, t) => [...s.got].reverse().find(m => m.t === t);
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('✗', m); } };

const a = mk('A'), b = mk('B'), w = mk('W');
handle(w, { t: 'rooms' });
handle(a, { t: 'create', name: '앨리스' });
const code = last(a, 'welcome').code;
await wait(5);
ok(last(w, 'rooms').list.some(r => r.code === code && r.state === 'wait'), '열린 방 목록에 뜬다');
handle(b, { t: 'join', code, name: '밥' });
ok(last(b, 'welcome').role === 'player', '들어가면 자리');
handle(b, { t: 'chat', text: '안녕' });
ok(a.got.some(m => m.t === 'chat' && m.text === '안녕'), '채팅');
handle(b, { t: 'addBot' });
ok(last(b, 'state').players.length === 2, '방장 아니면 봇 못 부름');
for (let i = 0; i < 3; i++) handle(a, { t: 'addBot' });
handle(a, { t: 'cfg', chars: 'pick' });
handle(a, { t: 'start' });
const room = rooms.get(code);
ok(room.phase === 'intro', '시작하면 인물 고르기부터');
const sa = last(a, 'state');
ok(sa.intro && sa.intro.offers.length === 2 && sa.intro.myRole, '인물 두 장 · 내 역할');
ok(!sa.g, '고르는 동안 판은 아직');
// 남의 역할은 안 내려온다
ok(JSON.stringify(last(b, 'state')).split('myRole').length === 2, '역할은 내 것만');
await wait(20);
handle(a, { t: 'pick', c: sa.intro.offers[1] });
handle(b, { t: 'pick', c: last(b, 'state').intro.offers[0] });
await wait(30);
ok(room.phase === 'playing', '모두 고르면 판 시작 ' + room.phase);
ok(room.game.P(room.players.find(p => p.name === '앨리스').id).char === sa.intro.offers[1], '고른 인물로');

// 사람 둘은 봇 두뇌로 대신 둔다
const A = () => room.players.find(p => p.name === '앨리스'), B = () => room.players.find(p => p.name === '밥');
for (let i = 0; i < 20000 && room.phase === 'playing'; i++) {
  const g = room.game;
  if (g.req && (g.req.to === A().id || g.req.to === B().id)) {
    const s = g.req.to === A().id ? a : b;
    handle(s, { t: 'act', seq: g.req.seq, r: decide(g, g.req.to) });
  } else await wait(1);
}
ok(room.phase === 'over', '끝남 ' + room.phase);
const end = last(a, 'state');
ok(end.g && end.g.over && end.g.players.every(p => p.role), '끝나면 역할 공개');
ok(a.got.filter(m => m.t === 'state' && m.g).every(m => m.g.players.every(p => typeof p.hand === 'number')), '남의 손은 장수만');

// 이어 붙기 — 새로고침
const tok = last(b, 'welcome').token;
disconnect(b);
const b2 = mk('B2');
handle(b2, { t: 'resume', code, token: tok });
ok(last(b2, 'welcome') && last(b2, 'welcome').you === B().id, '토큰으로 같은 자리');

handle(a, { t: 'again' });
ok(room.phase === 'lobby' && room.players.length === 5, '다시 하기 → 대기실');

// 무작위 인물 — 한 장을 확인하면 시작
handle(a, { t: 'cfg', chars: 'random' });
handle(a, { t: 'start' });
ok(last(a, 'state').intro.offers.length === 1, '무작위면 인물 한 장');
// 관전 — 시작한 방에 들어오면 구경
const c = mk('C');
handle(c, { t: 'join', code, name: '구경꾼' });
ok(last(c, 'welcome').role === 'spec', '판 중엔 관전');
handle(c, { t: 'chat', text: '구경 왔어요' });
ok(a.got.some(m => m.t === 'chat' && m.spec && m.text === '구경 왔어요'), '관전자 채팅');

// 나가기 — 판 중이면 봇이 이어받음
handle(b2, { t: 'leave' });
ok(B() && B().bot && B().left, '판 중에 나가면 봇이 이어받음');

console.log(fails ? `✗ ${fails}개 실패` : '방 흐름 통과');
process.exit(fails ? 1 : 0);
