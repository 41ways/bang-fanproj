/** 방 흐름 — 어려운 경우들: 고르는 중에 방장이 나감 · 판 중 끊김과 이어 붙기 · 내보내기 · 두 방 · 모두 나가면 방이 사라짐 */
process.env.BANG_FAST = '1';
const { handle, disconnect, rooms } = await import('../src/hub.js');
const { decide } = await import('../src/bot.js');

const mk = name => ({ name, readyState: 1, got: [], send(t) { this.got.push(JSON.parse(t)); }, close() { this.readyState = 3; } });
const last = (s, t) => [...s.got].reverse().find(m => m.t === t);
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('✗', m); } };

/* 1. 인물을 고르는 중에 방장이 나간다 → 방장은 넘어가고, 나간 자리는 봇이 고른다 */
{
  const a = mk('A'), b = mk('B');
  handle(a, { t: 'create', name: '방장' });
  const code = last(a, 'welcome').code;
  handle(b, { t: 'join', code, name: '손님' });
  handle(a, { t: 'addBot' }); handle(a, { t: 'addBot' });
  handle(a, { t: 'cfg', chars: 'pick' });
  handle(a, { t: 'start' });
  const room = rooms.get(code);
  ok(room.phase === 'intro', '고르는 중');
  handle(a, { t: 'leave' });
  ok(room.hostId === room.players.find(p => p.name === '손님').id, '방장이 손님에게 넘어감');
  await wait(20);
  handle(b, { t: 'pick', c: last(b, 'state').intro.offers[0] });
  await wait(30);
  ok(room.phase === 'playing', '나간 사람 몫은 봇이 골라 판이 열림 ' + room.phase);
  // 2. 판 중에 끊겼다가 이어 붙기 — 그 사이엔 봇이 대신 둔다
  const tok = last(b, 'welcome').token;
  disconnect(b);
  for (let i = 0; i < 300 && room.phase === 'playing'; i++) await wait(2);
  const b2 = mk('B2');
  handle(b2, { t: 'resume', code, token: tok });
  ok(last(b2, 'welcome') && last(b2, 'state'), '이어 붙음');
  // 끝까지
  for (let i = 0; i < 20000 && room.phase === 'playing'; i++) {
    const g = room.game, me = room.players.find(p => p.name === '손님');
    if (g.req && g.req.to === me.id) handle(b2, { t: 'act', seq: g.req.seq, r: decide(g, g.req.to) });
    else await wait(1);
  }
  ok(room.phase === 'over', '끝까지 감 ' + room.phase);
  handle(b2, { t: 'leave' });
  await wait(5);
  ok(!rooms.has(code), '사람이 다 나가면 방이 사라짐');
}

/* 3. 대기실에서 사람을 내보낸다 · 두 방이 따로 돈다 */
{
  const a = mk('A'), b = mk('B'), c = mk('C'), d = mk('D');
  handle(a, { t: 'create', name: '첫방' });
  handle(c, { t: 'create', name: '둘째방' });
  const c1 = last(a, 'welcome').code, c2 = last(c, 'welcome').code;
  ok(c1 !== c2, '방 코드가 다름');
  handle(b, { t: 'join', code: c1, name: '쫓겨날 사람' });
  handle(d, { t: 'join', code: c2, name: '둘째 손님' });
  const r1 = rooms.get(c1);
  const bid = r1.players.find(p => p.name === '쫓겨날 사람').id;
  handle(b, { t: 'kick', id: r1.hostId });
  ok(r1.players.length === 2, '방장 아니면 못 내보냄');
  handle(a, { t: 'kick', id: bid });
  ok(r1.players.length === 1 && last(b, 'err').fatal, '방장이 내보냄');
  handle(d, { t: 'chat', text: '둘째 방 이야기' });
  ok(!a.got.some(m => m.t === 'chat' && m.text === '둘째 방 이야기'), '다른 방 채팅은 안 보임');
  ok(c.got.some(m => m.t === 'chat' && m.text === '둘째 방 이야기'), '같은 방 채팅은 보임');
  // 비공개 방은 목록에 코드가 안 뜬다
  handle(c, { t: 'cfg', priv: true });
  const w = mk('W');
  handle(w, { t: 'rooms' });
  await wait(5);
  const list = last(w, 'rooms').list;
  ok(list.some(r => r.priv && !r.code) && list.some(r => r.code === c1), '비공개 방은 코드 없이');
  handle(a, { t: 'leave' }); handle(c, { t: 'leave' }); handle(d, { t: 'leave' });
}

/* 4. 시간 무제한 · 최대 인원 · 잘못된 답은 거절(판은 그대로) */
{
  const a = mk('A');
  handle(a, { t: 'create', name: '혼자' });
  const code = last(a, 'welcome').code, room = rooms.get(code);
  handle(a, { t: 'cfg', max: 4, turn: 0 });
  for (let i = 0; i < 5; i++) handle(a, { t: 'addBot' });
  ok(room.players.length === 4, '최대 인원을 넘지 않음');
  handle(a, { t: 'start' });
  await wait(30);
  handle(a, { t: 'pick', c: last(a, 'state').intro.offers[0] });
  await wait(30);
  ok(room.phase === 'playing', '시작');
  for (let i = 0; i < 400 && !(room.game.req && room.game.req.to === room.players.find(p => p.name === '혼자').id); i++) await wait(2);
  const g = room.game;
  const before = JSON.stringify(g.view(g.req.to));
  handle(a, { t: 'act', seq: g.req.seq, r: { a: 'play', c: 99999, t: 'x' } });
  ok(last(a, 'err') && JSON.stringify(g.view(g.req.to)) === before, '잘못된 답은 거절');
  ok(!room.deadline, '무제한이면 시계 없음');
  handle(a, { t: 'leave' });
}

console.log(fails ? `✗ ${fails}개 실패` : '어려운 방 흐름 통과');
process.exit(fails ? 1 : 0);
