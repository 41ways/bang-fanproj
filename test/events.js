/** 이벤트 카드 하나씩 — BGA(Syarwin/bga-bang) 동작과 맞는지 */
import { Game, eventDeck } from '../src/engine.js';
import { DECK, EVENTS } from '../public/cards.js';

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.error('✗', m); } };
const find = (k, s, r) => DECK.find(c => c.k === k && (!s || c.s === s) && (!r || c.r === r)).id;
const all = k => DECK.filter(c => c.k === k).map(c => c.id);
const pull = (g, ids) => { for (const c of ids) { for (const q of g.players) { q.hand = q.hand.filter(x => x !== c); q.table = q.table.filter(x => x !== c); } g.deck = g.deck.filter(x => x !== c); g.pile = g.pile.filter(x => x !== c); } };
const hand = (g, pid, ids) => { pull(g, ids); const p = g.P(pid); g.pile.push(...p.hand); p.hand = [...ids]; };
const table = (g, pid, ids) => { pull(g, ids); g.P(pid).table.push(...ids); };
const top = (g, ids) => { pull(g, ids); g.deck.push(...ids); };
const empty = g => { for (const p of g.players) { g.pile.push(...p.hand); p.hand = []; } };
function setup(chars, events, roles = ['sheriff', 'renegade', 'outlaw', 'outlaw']) {
  return new Game(roles.map((_, i) => ({ id: 'p' + i, name: 'P' + i })), { chars, roles, events, rng: () => 0.5 });
}
/** 지금 차례인 사람의 턴을 끝낸다(묻는 것은 무난하게 답한다) */
function endTurn(g) {
  const id = g.req.to;
  for (let i = 0; i < 30 && g.req && g.req.to === id; i++) {
    const q = g.req;
    const r = q.kind === 'play' ? { a: 'end' } : q.kind === 'discard' ? { a: 'discard', cs: g.P(id).hand.slice(0, q.n) }
      : q.kind === 'react' ? { a: 'take' } : q.kind === 'liquor' ? { a: 'draw' } : q.kind === 'ranch' ? { a: 'skip' } : q.kind === 'blood' ? { a: 'skip' }
      : q.kind === 'peyote' ? { a: 'red' } : q.kind === 'kit' ? { a: 'back', c: q.cards[0] } : q.kind === 'lucky' ? { a: 'pick', c: q.cards[0] }
      : q.kind === 'dying' ? { a: 'die' } : q.kind === 'daltons' ? { a: 'pick', c: q.cards[0] } : { a: 'deck' };
    g.answer(id, r);
  }
}

/* 덱 만들기 — 장수와 마지막 카드 */
{
  const hn = eventDeck('hn', false), hn2 = eventDeck('hn', true), foc = eventDeck('foc', false), foc2 = eventDeck('foc', true), both = eventDeck('both', true);
  ok(hn.length === 12 && hn[11] === 'highnoon' && !hn.includes('ghosttown'), '하이눈 12장, 마지막 하이눈, 유령 마을 없음');
  ok(hn2.length === 13 && hn2.includes('ghosttown'), '유령 마을 넣으면 13장');
  ok(foc.length === 14 && foc[13] === 'fistful' && !foc.includes('deadman'), '한 줌의 카드 14장');
  ok(foc2.length === 15 && foc2.includes('deadman'), '죽은 자 넣으면 15장');
  ok(both.length === 13 && ['highnoon', 'fistful'].includes(both[12]), '둘 다: 12장 + 마지막 1장');
  ok(Object.keys(EVENTS).length === 28, '이벤트 28종');
}

/* 첫 이벤트는 보안관의 두 번째 턴에 뒤집힌다 */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['thirst', 'shootout', 'highnoon']);
  ok(g.event === null, '처음엔 이벤트 없음');
  for (let i = 0; i < 4; i++) endTurn(g);
  ok(g.event === 'thirst' && g.turn === 'p0', '보안관 두 번째 턴에 첫 이벤트 ' + g.event);
  ok(g.P('p0').hand.length === 1 + Math.min(5, 5), '갈증 — 1장만 뽑음');
}

/* 하이눈 — 턴 시작에 생명 −1 (다이너마이트·감옥보다 먼저) */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['highnoon']);
  for (let i = 0; i < 4; i++) endTurn(g);
  ok(g.event === 'highnoon' && g.P('p0').hp === 4, '하이눈 — 보안관 5 → 4');
}

/* 축복 · 저주 — 뽑기! 무늬 */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  g.event = 'curse';
  table(g, 'p1', [find('barrel', 'S', 12)]);
  hand(g, 'p0', [find('bang', 'C', 2), find('beer', 'H', 6)]); hand(g, 'p1', [find('beer', 'H', 7)]);
  top(g, [find('beer', 'H', 8)]);              // 원래 ♥지만 저주면 ♠
  g.answer('p0', { a: 'play', c: find('bang', 'C', 2), t: 'p1' });
  g.answer('p1', { a: 'barrel' });
  ok(g.req.kind === 'react' && !g.req.barrel, '저주 — ♥ 카드도 ♠ 취급이라 술통 실패');
  g.answer('p1', { a: 'take' });
  const g2 = setup(['bart', 'sid', 'pedro', 'willy'], []);
  g2.event = 'blessing';
  table(g2, 'p1', [find('barrel', 'S', 12)]);
  hand(g2, 'p0', [find('bang', 'C', 2), find('beer', 'H', 6)]); hand(g2, 'p1', [find('beer', 'H', 7)]);
  top(g2, [find('bang', 'C', 5)]);
  g2.answer('p0', { a: 'play', c: find('bang', 'C', 2), t: 'p1' });
  g2.answer('p1', { a: 'barrel' });
  ok(g2.P('p1').hp === 4 && g2.req.to === 'p0', '축복 — ♣도 ♥ 취급이라 술통 성공');
}

/* 설교 · 총격전 · 목사 · 판사 · 숙취 */
{
  const g = setup(['willy', 'sid', 'pedro', 'kit'], []);
  empty(g);
  hand(g, 'p0', [find('bang', 'D', 2), find('bang', 'D', 3), find('bang', 'D', 4), find('beer', 'H', 6), find('mustang', 'H', 8)]);
  g.P('p0').hp = 3;
  g.event = 'sermon';
  ok(g.whyNot(g.P('p0'), find('bang', 'D', 2), 'p1') !== null, '설교 — 뱅! 금지');
  g.event = 'reverend';
  ok(g.whyNot(g.P('p0'), find('beer', 'H', 6)) !== null, '목사 — 맥주 금지');
  g.event = 'judge';
  ok(g.whyNot(g.P('p0'), find('mustang', 'H', 8)) !== null, '판사 — 파란 카드 금지');
  g.event = 'hangover';
  g.answer('p0', { a: 'play', c: find('bang', 'D', 2), t: 'p1' });
  if (g.req.kind === 'react') g.answer('p1', { a: 'take' });
  ok(g.whyNot(g.P('p0'), find('bang', 'D', 3), 'p1') !== null, '숙취 — 윌리 더 키드도 뱅! 한 장');
  g.event = 'shootout';
  ok(g.whyNot(g.P('p0'), find('bang', 'D', 3), 'p1') === null, '총격전 — 두 번째 뱅! 가능');
}

/* 의사 · 달튼 형제 (나오는 순간) */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['doctor', 'daltons', 'highnoon']);
  g.P('p2').hp = 1; g.P('p3').hp = 1;
  for (let i = 0; i < 4; i++) endTurn(g);
  ok(g.event === 'doctor' && g.P('p2').hp === 2 && g.P('p3').hp === 2 && g.P('p1').hp === 4, '의사 — 가장 적은 사람들 +1');
  table(g, 'p1', [find('mustang', 'H', 8), find('barrel', 'S', 12)]);
  table(g, 'p2', [find('scope')]);
  for (let i = 0; i < 4; i++) endTurn(g);
  ok(g.event === 'daltons' && g.req.kind === 'daltons' && g.req.to === 'p1', '달튼 형제 — 파란 카드 2장이면 고른다');
  g.answer('p1', { a: 'pick', c: find('mustang', 'H', 8) });
  ok(g.P('p1').table.length === 1 && g.P('p2').table.length === 0, '달튼 형제 — 1장씩 버림');
}

/* 골드 러시 — 반시계 방향 */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['goldrush', 'highnoon']);
  for (let i = 0; i < 4; i++) endTurn(g);
  ok(g.event === 'goldrush', '골드 러시');
  endTurn(g);
  ok(g.turn === 'p3', '보안관 다음은 오른쪽(p3) ' + g.turn);
}

/* 열차 도착 — 3장 · 갈증 — 1장 */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['train', 'highnoon']);
  for (let i = 0; i < 3; i++) endTurn(g);
  empty(g);
  endTurn(g);
  ok(g.event === 'train' && g.P('p0').hand.length === 3, '열차 도착 — 3장 ' + g.P('p0').hand.length);
}

/* 매복 · 올가미 — 거리와 앞에 놓인 카드 */
{
  const g = setup(['bart', 'sid', 'pedro', 'kit', 'willy'], [], ['sheriff', 'renegade', 'outlaw', 'outlaw', 'deputy']);
  table(g, 'p2', [find('mustang', 'H', 8)]);
  g.event = 'ambush';
  ok(g.dist(g.P('p0'), g.P('p2')) === 2 && g.dist(g.P('p0'), g.P('p1')) === 1, '매복 — 모두 1, 야생마만 +1');
  g.event = 'lasso';
  table(g, 'p0', [find('winchester')]);
  ok(g.range(g.P('p0')) === 1 && g.dist(g.P('p0'), g.P('p2')) === 2, '올가미 — 무기·야생마 효과 없음');
}

/* 저격수 · 도탄 */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  empty(g);
  g.event = 'sniper';
  hand(g, 'p0', [find('bang', 'D', 2), find('bang', 'D', 3), find('beer', 'H', 6)]);
  hand(g, 'p1', [find('missed', 'S', 2)]);
  g.answer('p0', { a: 'play', c: find('bang', 'D', 2), c2: find('bang', 'D', 3), t: 'p1' });
  ok(g.req.kind === 'react' && g.req.need === 2, '저격수 — 빗나감! 2장 필요');
  g.answer('p1', { a: 'cards', cs: [find('missed', 'S', 2)] });
  ok(g.P('p1').hp === 3 && g.bangs === 0, '저격수 — 1장으론 못 막고, 뱅! 횟수엔 안 듦');
  const g2 = setup(['bart', 'sid', 'pedro', 'willy'], []);
  empty(g2);
  g2.event = 'ricochet';
  hand(g2, 'p0', [find('bang', 'D', 2), find('beer', 'H', 6)]);
  table(g2, 'p2', [find('barrel', 'S', 12)]);
  g2.answer('p0', { a: 'play', c: find('bang', 'D', 2), t: 'p2', tc: find('barrel', 'S', 12) });
  ok(g2.req.kind === 'react' && g2.req.why === 'ricochet' && g2.req.to === 'p2', '도탄 — 주인이 막을지 묻는다');
  g2.answer('p2', { a: 'take' });
  ok(!g2.P('p2').table.length && g2.P('p2').hp === 4, '도탄 — 멀리 있어도 술통을 떨어뜨림');
}

/* 러시안 룰렛 */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['roulette', 'fistful']);
  for (let i = 0; i < 3; i++) endTurn(g);
  empty(g);
  hand(g, 'p0', [find('missed', 'S', 2)]);
  g.answer(g.req.to, { a: 'end' }); if (g.req.kind === 'discard') g.answer(g.req.to, { a: 'discard', cs: g.P(g.req.to).hand.slice(0, g.req.n) });
  ok(g.event === 'roulette' && g.req.kind === 'react' && g.req.why === 'roulette' && g.req.to === 'p0', '룰렛 — 보안관부터');
  g.answer('p0', { a: 'cards', cs: [find('missed', 'S', 2)] });
  ok(g.P('p1').hp === 2 && g.P('p0').hp === 5, '빗나감! 없는 다음 사람이 −2');
}

/* 한 줌의 카드 — 손 카드 수만큼 뱅! */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['fistful']);
  for (let i = 0; i < 3; i++) endTurn(g);
  empty(g);
  hand(g, 'p0', [find('beer', 'H', 6), find('beer', 'H', 7)]);
  endTurn(g);
  ok(g.event === 'fistful' && g.req.kind === 'react' && g.req.why === 'fistful' && g.req.left === 1, '한 줌의 카드 — 2발');
  g.answer('p0', { a: 'take' }); g.answer('p0', { a: 'take' });
  ok(g.P('p0').hp === 3, '두 발 다 맞으면 −2 ' + g.P('p0').hp);
}

/* 독한 술 · 페요테 · 목장 · 서부의 법 · 피를 나눈 형제 · 버려진 광산 */
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], ['liquor', 'highnoon']);
  for (let i = 0; i < 3; i++) endTurn(g);
  g.P('p0').hp = 3; empty(g);
  endTurn(g);
  ok(g.event === 'liquor', '독한 술');
  const g2 = setup(['bart', 'sid', 'pedro', 'willy'], ['liquor', 'highnoon']);
  for (let i = 0; i < 3; i++) endTurn(g2);
  g2.P('p0').hp = 3; empty(g2);
  g2.answer(g2.req.to, { a: 'end' }); if (g2.req.kind === 'discard') g2.answer(g2.req.to, { a: 'discard', cs: g2.P(g2.req.to).hand.slice(0, g2.req.n) });
  ok(g2.req.kind === 'liquor', '독한 술 — 묻는다');
  g2.answer('p0', { a: 'heal' });
  ok(g2.P('p0').hp === 4 && g2.P('p0').hand.length === 0, '뽑지 않고 생명 +1');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  for (let i = 0; i < 4; i++) endTurn(g);
  g.event = 'peyote';
  empty(g);
  endTurn(g);                                    // p0 → p1
  g.event = 'peyote';
  for (let i = 0; i < 2; i++) endTurn(g);
  // p3 차례가 시작될 때 페요테
  top(g, [find('bang', 'C', 2), find('beer', 'H', 6)]); // 맨 위 ♥6(빨강) 다음 ♣2(검정)
  endTurn(g);                                    // p3: 빨강 맞힘 → ... 끝까지 '빨강'
  ok(true, '페요테 턴 진행');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  for (let i = 0; i < 3; i++) endTurn(g);
  g.event = 'peyote';
  empty(g);
  top(g, [find('bang', 'C', 2), find('beer', 'H', 6)]);
  g.answer(g.req.to, { a: 'end' }); if (g.req.kind === 'discard') g.answer(g.req.to, { a: 'discard', cs: g.P(g.req.to).hand.slice(0, g.req.n) });
  ok(g.req.kind === 'peyote' && g.req.to === 'p0', '페요테 — 맞히기');
  g.answer('p0', { a: 'red' });
  ok(g.req.kind === 'peyote' && g.P('p0').hand.length === 1, '맞히면 갖고 또');
  g.answer('p0', { a: 'red' });
  ok(g.req.kind === 'play' && g.P('p0').hand.length === 1, '틀리면 끝');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  for (let i = 0; i < 3; i++) endTurn(g);
  g.event = 'lawwest';
  empty(g);
  top(g, [find('bang', 'D', 5), find('beer', 'H', 6)]);  // 두 번째 장 = 뱅!(사거리 안 사람이 있음)
  g.answer(g.req.to, { a: 'end' }); if (g.req.kind === 'discard') g.answer(g.req.to, { a: 'discard', cs: g.P(g.req.to).hand.slice(0, g.req.n) });
  ok(g.mustPlay === find('bang', 'D', 5), '서부의 법 — 두 번째 장');
  let threw = false; try { g.answer('p0', { a: 'end' }); } catch (_) { threw = true; }
  ok(threw, '보여 준 카드를 내기 전엔 턴을 못 끝냄');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  for (let i = 0; i < 3; i++) endTurn(g);
  g.event = 'bloodbros';
  g.P('p2').hp = 2;
  g.answer(g.req.to, { a: 'end' }); if (g.req.kind === 'discard') g.answer(g.req.to, { a: 'discard', cs: g.P(g.req.to).hand.slice(0, g.req.n) });
  ok(g.req.kind === 'blood' && g.req.tg.includes('p2'), '피를 나눈 형제 — 묻는다');
  g.answer('p0', { a: 'give', t: 'p2' });
  ok(g.P('p0').hp === 4 && g.P('p2').hp === 3, '생명 1을 나눠 줌');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  for (let i = 0; i < 3; i++) endTurn(g);
  g.event = 'mine';
  empty(g);
  pull(g, [find('beer', 'H', 6), find('beer', 'H', 7)]); g.pile.push(find('beer', 'H', 6), find('beer', 'H', 7));
  g.answer(g.req.to, { a: 'end' }); if (g.req.kind === 'discard') g.answer(g.req.to, { a: 'discard', cs: g.P(g.req.to).hand.slice(0, g.req.n) });
  ok(g.P('p0').hand.includes(find('beer', 'H', 6)) && g.P('p0').hand.includes(find('beer', 'H', 7)), '버려진 광산 — 버린 카드에서 뽑음');
}

/* 유령 마을 · 죽은 자 */
{
  const g = setup(['bart', 'sid', 'pedro', 'kit', 'willy'], ['ghosttown', 'highnoon'], ['sheriff', 'renegade', 'outlaw', 'outlaw', 'deputy']);
  empty(g);
  hand(g, 'p0', [find('bang', 'D', 2), find('beer', 'H', 6)]);
  g.P('p1').hp = 1;
  g.answer('p0', { a: 'play', c: find('bang', 'D', 2), t: 'p1' });
  ok(g.P('p1').status === 'down' && !g.P('p1').alive, '유령 마을이 남아 있으면 "쓰러짐(돌아올 수 있음)"');
  endTurn(g); for (let i = 0; i < 3; i++) endTurn(g);
  ok(g.event === 'ghosttown', '유령 마을');
  endTurn(g);
  ok(g.turn === 'p1' && g.P('p1').status === 'ghost' && g.P('p1').hand.length === 3, '유령으로 돌아와 3장');
  endTurn(g);
  ok(g.P('p1').status === 'out' && !g.P('p1').alive, '턴이 끝나면 다시 쓰러짐');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'kit', 'willy'], ['deadman', 'fistful'], ['sheriff', 'renegade', 'outlaw', 'outlaw', 'deputy']);
  empty(g);
  hand(g, 'p0', [find('bang', 'D', 2), find('beer', 'H', 6)]);
  g.P('p1').hp = 1;
  g.answer('p0', { a: 'play', c: find('bang', 'D', 2), t: 'p1' });
  ok(g.firstOut === 'p1' && g.P('p1').status === 'down', '처음 쓰러진 사람');
  endTurn(g); for (let i = 0; i < 3; i++) endTurn(g);
  ok(g.event === 'deadman', '죽은 자');
  endTurn(g);
  ok(g.turn === 'p1' && g.P('p1').alive && g.P('p1').hp === 2 && g.P('p1').hand.length === 4, '생명 2 · 카드 2장 + 뽑기 2장 ' + g.P('p1').hand.length);
}

/* 감사에서 찾은 것 — 다시 생기지 않게 */
{
  // 조작된 두 번째 카드(c2)는 거절, 카드 수 그대로
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  empty(g);
  hand(g, 'p0', [find('beer', 'H', 6), find('stagecoach')]);
  const count = () => g.deck.length + g.pile.length + g.players.reduce((a, p) => a + p.hand.length + p.table.length, 0);
  const before = count();
  let threw = false; try { g.answer('p0', { a: 'play', c: find('beer', 'H', 6), c2: g.deck[0] }); } catch (_) { threw = true; }
  ok(threw && count() === before, '맥주에 c2 를 붙이면 거절');
  threw = false; try { g.answer('p0', { a: 'play', c: find('beer', 'H', 6), c2: 'zzz' }); } catch (_) { threw = true; }
  ok(threw && count() === before, '쓰레기 c2 거절');
}
{
  // 수지 — 한 줌의 카드로 손이 비면 1단계 전에 1장
  const g = setup(['bart', 'sid', 'pedro', 'suzy'], ['fistful']);
  for (let i = 0; i < 3; i++) endTurn(g);
  empty(g);
  hand(g, 'p3', [find('missed', 'S', 2)]);
  for (let i = 0; i < 2; i++) endTurn(g);                  // p3 → p0(이벤트 뒤집힘) … 순서대로
  for (let i = 0; i < 6 && !(g.turn === 'p3' && g.req.to === 'p3'); i++) endTurn(g);
  if (g.req.kind === 'react' && g.req.to === 'p3') g.answer('p3', { a: 'cards', cs: g.P('p3').hand.filter(c => DECK[c].k === 'missed').slice(0, 1) });
  ok(true, '수지 진행');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'suzy'], []);
  for (let i = 0; i < 3; i++) endTurn(g);
  g.event = 'fistful';
  empty(g);
  hand(g, 'p0', []);
  // p3(수지) 차례 시작 — 손에 빗나감! 1장
  hand(g, 'p3', [find('missed', 'S', 2)]);
  g.answer(g.req.to, { a: 'end' }); if (g.req.kind === 'discard') g.answer(g.req.to, { a: 'discard', cs: g.P(g.req.to).hand.slice(0, g.req.n) });
}
{
  const g = setup(['bart', 'sid', 'pedro', 'suzy'], []);
  for (let i = 0; i < 3; i++) endTurn(g);       // 이제 p3(수지) 차례 시작 직전이 아니라, p3 의 play 요청
  // 수지 차례를 처음부터: p3 턴을 끝내고 한 바퀴 돌려 p3 차례가 다시 올 때 한 줌의 카드
  endTurn(g); endTurn(g); endTurn(g);
  empty(g);
  hand(g, 'p3', [find('missed', 'S', 2)]);
  g.event = 'fistful';
  endTurn(g);                                    // p2 끝 → p3 시작: 뱅! 1발
  ok(g.req.kind === 'react' && g.req.to === 'p3' && g.req.why === 'fistful', '수지에게 한 줌의 카드 1발');
  g.answer('p3', { a: 'cards', cs: [find('missed', 'S', 2)] });
  ok(g.P('p3').hand.length === 3, '빗나감!으로 손이 비면 수지 1장 + 1단계 2장 = 3장 ' + g.P('p3').hand.length);
}
{
  // 설교 중에도 결투에서 뱅!을 버릴 수 있다
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  empty(g);
  g.event = 'sermon';
  hand(g, 'p0', [find('duel', 'D', 12), find('bang', 'C', 3), find('beer', 'H', 6)]);
  hand(g, 'p2', [find('bang', 'C', 4)]);
  g.answer('p0', { a: 'play', c: find('duel', 'D', 12), t: 'p2' });
  g.answer('p2', { a: 'cards', cs: [find('bang', 'C', 4)] });
  ok(g.req && g.req.to === 'p0' && g.req.why === 'duel', '설교 중 결투 — 차례인 사람도 응수할 수 있다');
  g.answer('p0', { a: 'cards', cs: [find('bang', 'C', 3)] });
  ok(g.P('p2').hp === 3 && g.P('p0').hp === 5, '응수 못 한 쪽이 −1');
}
{
  // 버려진 광산 — 엎어 버리는 카드는 연출에 드러나지 않는다
  const g = setup(['bart', 'sid', 'pedro', 'willy'], []);
  g.event = 'mine';
  hand(g, 'p0', all('bang').slice(0, 8));
  g.fx = [];
  g.answer('p0', { a: 'end' });
  ok(g.req.kind === 'discard', '버리기');
  g.answer('p0', { a: 'discard', cs: g.P('p0').hand.slice(0, g.req.n) });
  const e = g.fx.find(x => x.fx === 'discard');
  ok(e && e.deck && !e.cs, '엎어 버린 카드는 숨김');
}

console.log(fails ? `✗ ${fails}/${n} 실패` : `이벤트 ${n}개 통과`);
process.exit(fails ? 1 : 0);
