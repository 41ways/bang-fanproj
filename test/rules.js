/** 규칙 하나씩 — 판을 손으로 짜 놓고 답을 넣어 본다 */
import { Game } from '../src/engine.js';
import { DECK } from '../public/cards.js';

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.error('✗', m); } };
const find = (k, s, r) => DECK.find(c => c.k === k && (!s || c.s === s) && (!r || c.r === r)).id;
const all = k => DECK.filter(c => c.k === k).map(c => c.id);

/** 4명 판. roles/chars 를 정해 두고, 첫 요청(보안관 play)에서 멈춘 상태로 돌려준다 */
function setup(chars, roles = ['sheriff', 'renegade', 'outlaw', 'outlaw']) {
  const seats = roles.map((_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const g = new Game(seats, { chars, roles, rng: () => 0.5 });
  return g;
}
/** 손을 비우고 원하는 카드만 쥐여 준다(카드는 어디 있든 빼 온다) */
function hand(g, pid, ids) {
  const p = g.P(pid);
  for (const c of ids) {
    for (const q of g.players) { q.hand = q.hand.filter(x => x !== c); q.table = q.table.filter(x => x !== c); }
    g.deck = g.deck.filter(x => x !== c); g.pile = g.pile.filter(x => x !== c);
  }
  g.pile.push(...p.hand); p.hand = [...ids];
}
function table(g, pid, ids) { const p = g.P(pid); for (const c of ids) { for (const q of g.players) { q.hand = q.hand.filter(x => x !== c); q.table = q.table.filter(x => x !== c); } g.deck = g.deck.filter(x => x !== c); g.pile = g.pile.filter(x => x !== c); } p.table.push(...ids); }
/** 더미 맨 위에 이 카드들을 얹는다(마지막이 맨 위) */
function top(g, ids) { for (const c of ids) { for (const q of g.players) { q.hand = q.hand.filter(x => x !== c); q.table = q.table.filter(x => x !== c); } g.deck = g.deck.filter(x => x !== c); g.pile = g.pile.filter(x => x !== c); } g.deck.push(...ids); }
const empty = g => { for (const p of g.players) { g.pile.push(...p.hand); p.hand = []; } };

/* 뱅! — 사거리, 한 장 제한, 빗나감! */
{
  const g = setup(['bart', 'blackjack', 'pedro', 'sid']);
  empty(g);
  const [b1, b2] = all('bang');
  hand(g, 'p0', [b1, b2]);
  hand(g, 'p1', [find('missed')]);
  ok(g.req.kind === 'play' && g.req.to === 'p0', '보안관부터');
  ok(g.whyNot(g.P('p0'), b1, 'p2') === '사거리 밖입니다', '4명에서 맞은편(거리 2)은 콜트로 못 쏜다');
  g.answer('p0', { a: 'play', c: b1, t: 'p1' });
  ok(g.req.kind === 'react' && g.req.to === 'p1' && g.req.need === 1, '빗나감! 물음');
  g.answer('p1', { a: 'cards', cs: g.P('p1').hand.slice() });
  ok(g.P('p1').hp === 4, '빗나감!으로 막음');
  ok(g.whyNot(g.P('p0'), b2, 'p3') === '뱅!은 한 턴에 한 장만 쏠 수 있습니다', '뱅! 한 턴 한 장');
  let threw = false; try { g.answer('p0', { a: 'play', c: b2, t: 'p3' }); } catch (_) { threw = true; }
  ok(threw, '두 번째 뱅!은 거절');
}

/* 슬랩 더 킬러는 빗나감! 2장, 술통은 1장 몫 */
{
  const g = setup(['slab', 'jourdonnais', 'pedro', 'sid']);
  empty(g);
  hand(g, 'p0', [find('bang', 'S', 1)]);
  hand(g, 'p1', [find('missed', 'C', 10)]);
  top(g, [find('beer', 'H', 6)]);             // 주르도네 술통 뽑기 → 하트
  g.answer('p0', { a: 'play', c: g.P('p0').hand[0], t: 'p1' });
  ok(g.req.kind === 'react' && g.req.need === 2 && g.req.barrel === 1, '슬랩 — 빗나감! 2장, 술통 단추');
  g.answer('p1', { a: 'barrel' });
  ok(g.req.kind === 'react' && g.req.need === 1 && !g.req.barrel, '술통 성공으로 빗나감! 1장만 더');
  g.answer('p1', { a: 'cards', cs: g.P('p1').hand.slice() });
  ok(g.P('p1').hp === 4, '슬랩 뱅!을 술통+빗나감!으로 막음');
}

/* 캘러미티: 빗나감!을 뱅!으로 */
{
  const g = setup(['calamity', 'bart', 'pedro', 'sid']);
  empty(g);
  hand(g, 'p0', [find('missed', 'S', 2), find('beer', 'H', 6)]);
  hand(g, 'p1', []);
  g.answer('p0', { a: 'play', c: g.P('p0').hand[0], t: 'p1' });
  ok(g.P('p1').hp === 3, '캘러미티 빗나감!=뱅! 맞음');
  ok(g.P('p1').hand.length === 1, '바트 캐시디 맞으면 1장');
}

/* 무법자를 잡으면 3장, 맥주는 마지막 생명에서 */
{
  const g = setup(['willy', 'bart', 'pedro', 'sid']);
  empty(g);
  const bangs = all('bang').slice(0, 3);
  hand(g, 'p0', bangs);
  hand(g, 'p3', [find('beer', 'H', 7)]);
  g.P('p3').hp = 1;
  g.answer('p0', { a: 'play', c: bangs[0], t: 'p3' });
  ok(g.req.kind === 'react' && g.req.to === 'p3', '손에 카드가 있으면 막을 카드가 없어도 묻는다');
  g.answer('p3', { a: 'take' });
  ok(g.req.kind === 'dying' && g.req.to === 'p3', '맥주 물음');
  g.answer('p3', { a: 'beer', c: g.P('p3').hand[0] });
  ok(g.P('p3').hp === 1 && g.P('p3').alive, '맥주로 버팀');
  g.answer('p0', { a: 'play', c: bangs[1], t: 'p3' });
  ok(!g.P('p3').alive, '무법자 쓰러짐');
  ok(g.P('p0').hand.length === 4, '현상금 3장 (뱅! 1장 + 3) ' + g.P('p0').hand.length);
}

/* 보안관이 부관을 쏘면 카드를 다 버린다 */
{
  const g = setup(['willy', 'bart', 'pedro', 'sid', 'kit'], ['sheriff', 'deputy', 'outlaw', 'outlaw', 'renegade']);
  empty(g);
  hand(g, 'p0', [find('bang', 'D', 2), find('beer', 'H', 8)]);
  table(g, 'p0', [find('barrel', 'S', 12)]);
  g.P('p1').hp = 1;
  g.answer('p0', { a: 'play', c: find('bang', 'D', 2), t: 'p1' });
  ok(!g.P('p1').alive, '부관 쓰러짐');
  ok(g.P('p0').hand.length === 0 && g.P('p0').table.length === 0, '보안관 벌칙');
}

/* 다이너마이트: 스페이드 2~9면 3 피해, 아니면 왼쪽으로 넘어간다 */
{
  const g = setup(['bart', 'sid', 'pedro', 'kit']);
  empty(g);
  table(g, 'p0', [find('dynamite')]);
  // 보안관의 첫 턴은 이미 시작됐으니, 한 바퀴 돌려 보안관 차례가 다시 올 때 뽑기!
  const endTurn = id => { while (g.req && g.req.to === id && g.req.kind !== 'play') g.answer(id, g.req.kind === 'kit' ? { a: 'back', c: g.req.cards[0] } : g.req.kind === 'discard' ? { a: 'discard', cs: g.P(id).hand.slice(0, g.req.n) } : { a: 'deck' }); g.answer(id, { a: 'end' }); if (g.req && g.req.kind === 'discard') g.answer(id, { a: 'discard', cs: g.P(id).hand.slice(0, g.req.n) }); };
  endTurn('p0'); endTurn('p1'); endTurn('p2');
  top(g, [find('missed', 'S', 5)]);            // p3(킷) 다음 → p0 차례에 뽑힐 카드 — 킷이 3장 보고 고르므로 아래에 둔다
  while (g.req.to === 'p3' && g.req.kind !== 'play') g.answer('p3', { a: 'back', c: g.req.cards[0] });
  top(g, [find('missed', 'S', 5)]);
  g.answer('p3', { a: 'end' }); if (g.req && g.req.kind === 'discard') g.answer('p3', { a: 'discard', cs: g.P('p3').hand.slice(0, g.req.n) });
  ok(g.P('p0').hp === 2, '다이너마이트 ♠5 → 3 피해 (5−3) ' + g.P('p0').hp);
  ok(!g.P('p0').table.length, '터진 다이너마이트는 버림');
}
{
  const g = setup(['bart', 'sid', 'pedro', 'willy']);
  empty(g);
  table(g, 'p0', [find('dynamite')]);
  const endTurn = id => { while (g.req && g.req.to === id && g.req.kind !== 'play') g.answer(id, { a: 'deck' }); g.answer(id, { a: 'end' }); if (g.req && g.req.kind === 'discard') g.answer(id, { a: 'discard', cs: g.P(id).hand.slice(0, g.req.n) }); };
  endTurn('p0'); endTurn('p1'); endTurn('p2');
  top(g, [find('beer', 'H', 6)]);              // ♥ → 안 터지고 넘어간다
  endTurn('p3');
  ok(g.P('p0').hp === 5 && g.P('p1').table.some(c => DECK[c].k === 'dynamite'), '안전한 카드면 왼쪽으로 넘어감');
}

/* 감옥: 하트면 풀려나 턴, 아니면 거름 · 보안관에게는 못 놓음 */
{
  const g = setup(['bart', 'sid', 'pedro', 'kit']);
  empty(g);
  const [j1] = all('jail');
  hand(g, 'p0', [j1, find('beer', 'H', 9)]);
  ok(g.whyNot(g.P('p0'), j1, 'p0') !== null, '자기 자신 감옥 안 됨');
  g.answer('p0', { a: 'play', c: j1, t: 'p1' });
  top(g, [find('bang', 'C', 2)]);              // 클럽 → 못 나감
  g.answer('p0', { a: 'end' });
  if (g.req.kind === 'discard') g.answer('p0', { a: 'discard', cs: g.P('p0').hand.slice(0, g.req.n) });
  ok(g.turn === 'p2', '감옥에서 턴을 거름 → ' + g.turn);
  ok(!g.P('p1').table.length, '감옥은 버림');
  const g2 = setup(['bart', 'sid', 'pedro', 'kit']);
  empty(g2);
  hand(g2, 'p1', [all('jail')[1]]);
  ok(g2.whyNot(g2.P('p1'), all('jail')[1], 'p0') === '보안관은 감옥에 넣을 수 없습니다', '보안관 감옥 금지');
}

/* 두 명만 남으면 맥주 효과 없음 · 배신자 단독 승리 */
{
  const g = setup(['willy', 'bart', 'pedro', 'sid']);
  empty(g);
  g.P('p2').alive = false; g.P('p3').alive = false; g.P('p2').hp = 0; g.P('p3').hp = 0;
  hand(g, 'p0', [find('beer', 'H', 9)]);
  g.P('p0').hp = 2;
  ok(g.whyNot(g.P('p0'), find('beer', 'H', 9)) === null && !g.canBeer(), '두 명이면 맥주는 내도 효과 없음 (FAQ Q25)');
  hand(g, 'p0', all('bang').slice(0, 5));
  g.P('p0').hp = 5;
  g.P('p1').hp = 1; hand(g, 'p1', [find('beer', 'H', 10)]);
  g.answer('p0', { a: 'play', c: g.P('p0').hand[0], t: 'p1' });
  if (g.req && g.req.kind === 'react') g.answer('p1', { a: 'take' });
  ok(g.over && g.over.team === 'sheriff', '보안관 승리 (맥주 못 씀) ' + JSON.stringify(g.over));
}
{
  const g = setup(['bart', 'willy', 'pedro', 'sid']);
  empty(g);
  g.P('p2').alive = false; g.P('p3').alive = false;
  g.answer('p0', { a: 'end' });
  if (g.req.kind === 'discard') g.answer('p0', { a: 'discard', cs: g.P('p0').hand.slice(0, g.req.n) });
  hand(g, 'p1', [find('bang', 'D', 3)]);
  g.P('p0').hp = 1; hand(g, 'p0', []);
  g.answer('p1', { a: 'play', c: find('bang', 'D', 3), t: 'p0' });
  ok(g.over && g.over.team === 'renegade', '배신자 승리');
}

/* 벌처 샘 · 수지 라파예트 · 엘 그링고 */
{
  const g = setup(['willy', 'vulture', 'suzy', 'elgringo']);
  empty(g);
  const bangs = all('bang').slice(0, 4);
  hand(g, 'p0', bangs);
  hand(g, 'p3', [find('wellsfargo'), find('beer', 'H', 11)]);
  // 엘 그링고(p3, 생명 3)를 쏘면 보안관 손에서 1장 가져온다
  g.answer('p0', { a: 'play', c: bangs[0], t: 'p3' });
  if (g.req.kind === 'react') g.answer('p3', { a: 'take' });
  ok(g.P('p3').hand.length === 3, '엘 그링고가 1장 가져옴 ' + g.P('p3').hand.length);
  table(g, 'p0', [find('volcanic', 'S', 10)]);
  table(g, 'p3', [find('mustang', 'H', 8)]);
  table(g, 'p0', [find('scope')]);
  g.P('p3').hp = 1; g.P('p3').hand = []; g.P('p3').hand.push(find('panic', 'D', 8));
  g.answer('p0', { a: 'play', c: g.P('p0').hand.find(c => DECK[c].k === 'bang'), t: 'p3' });
  if (g.req.kind === 'react') g.answer('p3', { a: 'take' });
  ok(!g.P('p3').alive, '엘 그링고 쓰러짐');
  ok(g.P('p1').hand.includes(find('panic', 'D', 8)) && g.P('p1').hand.includes(find('mustang', 'H', 8)), '벌처 샘이 손·앞 카드를 다 가져감');
  // 수지: 손이 비면 1장
  hand(g, 'p2', [find('stagecoach')]);
  g.P('p2').hand = [];
  g.suzy();
  ok(g.P('p2').hand.length === 1, '수지 라파예트 1장');
}

/* 결투 · 인디언! · 기관총 */
{
  const g = setup(['bart', 'sid', 'pedro', 'kit']);
  empty(g);
  hand(g, 'p0', [find('duel', 'D', 12), find('bang', 'C', 3)]);
  hand(g, 'p2', [find('bang', 'C', 4)]);
  g.answer('p0', { a: 'play', c: find('duel', 'D', 12), t: 'p2' });
  ok(g.req.kind === 'react' && g.req.to === 'p2' && g.req.why === 'duel', '결투 — 상대부터');
  g.answer('p2', { a: 'cards', cs: [find('bang', 'C', 4)] });
  ok(g.req.to === 'p0', '결투 — 이제 나');
  g.answer('p0', { a: 'take' });
  ok(g.P('p0').hp === 4, '결투에서 진 쪽 −1');
  hand(g, 'p0', [find('gatling'), find('indians', 'D', 13)]);
  g.answer('p0', { a: 'play', c: find('gatling') });
  ok(g.P('p1').hp === 3 && g.P('p2').hp === 3 && g.P('p3').hp === 3, '기관총 모두 −1');
}

/* 강탈: 거리 1 · 캣 벌로우: 아무나 */
{
  const g = setup(['bart', 'sid', 'pedro', 'kit']);
  empty(g);
  hand(g, 'p0', [find('panic', 'H', 11), find('catbalou', 'H', 13)]);
  table(g, 'p2', [find('barrel', 'S', 13)]);
  ok(g.whyNot(g.P('p0'), find('panic', 'H', 11), 'p2', find('barrel', 'S', 13)) === '거리 1 안이어야 합니다', '강탈 거리');
  g.answer('p0', { a: 'play', c: find('catbalou', 'H', 13), t: 'p2', tc: find('barrel', 'S', 13) });
  ok(!g.P('p2').table.length && g.pile[g.pile.length - 1] === find('barrel', 'S', 13), '캣 벌로우로 술통 버림');
}

/* 거리: 야생마 +1, 조준경 −1, 폴 리그렛 · 로즈 둘란 */
{
  const g = setup(['rose', 'paul', 'pedro', 'kit']);
  ok(g.dist(g.P('p0'), g.P('p1')) === 1, '로즈→폴: 1 +1(폴) −1(로즈) = 1');
  ok(g.dist(g.P('p2'), g.P('p1')) === 2, '페드로→폴: 1+1 = 2');
  ok(g.dist(g.P('p0'), g.P('p2')) === 1, '로즈→맞은편: 2−1 = 1');
}

/* 수지 라파예트 — 결투 중에 마지막 카드를 내도 결투가 끝난 뒤에 뽑는다 (FAQ Q22) */
{
  const g = setup(['bart', 'suzy', 'pedro', 'kit']);
  empty(g);
  hand(g, 'p0', [find('duel', 'D', 12), find('bang', 'C', 3), find('beer', 'H', 6)]);
  hand(g, 'p1', [find('bang', 'C', 4)]);
  g.answer('p0', { a: 'play', c: find('duel', 'D', 12), t: 'p1' });
  g.answer('p1', { a: 'cards', cs: [find('bang', 'C', 4)] });
  ok(g.req.to === 'p0' && g.P('p1').hand.length === 0, '결투 중에는 수지가 아직 안 뽑는다');
  g.answer('p0', { a: 'cards', cs: [find('bang', 'C', 3)] });
  ok(g.P('p1').hp === 3 && g.P('p1').hand.length === 1, '결투가 끝나고 1장 ' + g.P('p1').hand.length);
}

/* 캣 벌로우로 내 앞의 다이너마이트를 치운다 (BGA 는 자기 자신도 허용) */
{
  const g = setup(['bart', 'sid', 'pedro', 'kit']);
  empty(g);
  hand(g, 'p0', [find('catbalou', 'D', 9), find('beer', 'H', 6)]);
  table(g, 'p0', [find('dynamite')]);
  ok(g.moves(g.P('p0'))[find('catbalou', 'D', 9)].tg.includes('p0'), '내 자리도 대상');
  ok(g.whyNot(g.P('p0'), find('catbalou', 'D', 9), 'p0', 'hand') !== null, '내 손은 못 고름');
  g.answer('p0', { a: 'play', c: find('catbalou', 'D', 9), t: 'p0', tc: find('dynamite') });
  ok(!g.P('p0').table.length, '다이너마이트를 버림');
}

console.log(fails ? `✗ ${fails}/${n} 실패` : `규칙 ${n}개 통과`);
process.exit(fails ? 1 : 0);
