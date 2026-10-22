/**
 * 뱅! — 봇. 사람이 모자랄 때 자리를 채우고, 시간이 다 된 사람 대신 막기·고르기를 한다.
 *
 * 편 짐작: 역할은 보안관만 드러나 있으니, 누가 누구를 쐈는지(game.aggro)로 적·편을 가늠한다.
 *   보안관을 친 사람은 무법자일 공산이 크고, 무법자로 보이는 사람을 친 사람은 보안관 편일 공산이 크다.
 * 점수(enemy)가 클수록 쏠 만한 상대, 0 아래면 편이라 여겨 건드리지 않는다.
 */
import { KINDS, WEAPONS } from '../public/cards.js';

/** 보안관 쪽으로 기운 정도. 양수면 보안관을 공격해 온 사람(무법자 냄새) */
function suspicion(g, o) {
  const sh = g.players.find(p => p.role === 'sheriff');
  const a = g.aggro[o.id] || {};
  let s = (a[sh.id] || 0) * 2;
  // 보안관이 쏜 사람을 같이 친 사람은 보안관 편 쪽
  for (const q of g.players) {
    if (q === o || q === sh) continue;
    const bySh = (g.aggro[sh.id] || {})[q.id] || 0;
    if (bySh && a[q.id]) s -= 1;
    const qAtkSh = (g.aggro[q.id] || {})[sh.id] || 0;
    if (qAtkSh && a[q.id]) s -= 1.5;      // 보안관을 친 사람을 쏜 사람
  }
  // 보안관이 이 사람을 쏘고 있었다면 — 보안관 짐작도 반영
  s += ((g.aggro[sh.id] || {})[o.id] || 0) * 0.5;
  return s;
}

/** me 가 보기에 o 가 얼마나 적인가 */
export function enemy(g, me, o) {
  if (o === me || !o.alive) return -99;
  const live = g.alive();
  const lateGame = live.length <= 2;
  // 죽은 뒤 드러난 역할은 다 안다. 산 사람은 보안관만.
  const known = o.role === 'sheriff' ? 'sheriff' : null;
  const outlawsLeft = live.filter(p => p.role === 'outlaw').length;   // 죽은 역할을 세면 누구나 안다
  const renLeft = live.some(p => p.role === 'renegade');
  const s = suspicion(g, o);
  // 판이 길어지면 다들 조급해진다 — 서로 눈치만 보다 끝나지 않는 판을 막는다
  const rush = Math.max(0, g.round - 6) * 0.15;
  switch (me.role) {
    case 'sheriff':
      if (!outlawsLeft) return 1 + s + rush;          // 남은 건 부관 아니면 배신자
      return 0.6 + s + rush;                           // 처음엔 다 의심스럽다(무법자가 가장 많다)
    case 'deputy':
      if (known === 'sheriff') return -10;
      if (!outlawsLeft && renLeft) return 0.8 + s + rush;
      return 0.15 + s + rush;
    case 'outlaw':
      if (known === 'sheriff') return 10;
      return 0.2 - s + rush;                           // 보안관을 친 사람은 같은 편
    case 'renegade': {
      const othersAlive = live.filter(p => p !== me && p.role !== 'sheriff').length;
      if (known === 'sheriff') return othersAlive ? -3 : 10;
      if (lateGame || !outlawsLeft) return 5;
      return 0.3 + s + rush;                           // 보안관 편인 척하며 무법자부터 줄인다
    }
  }
  return 0;
}

const VAL = {
  missed: 6, beer: 6, bang: 5, wellsfargo: 6, stagecoach: 5, generalstore: 4, panic: 5, catbalou: 4,
  gatling: 5, indians: 4, duel: 4, barrel: 5, scope: 3, mustang: 4, jail: 4, dynamite: 1, saloon: 3,
  volcanic: 2, schofield: 2, remington: 3, carabine: 3, winchester: 3,
};
const val = (g, me, c) => {
  const k = g.C(c).k;
  let v = VAL[k] || 2;
  if (k === 'beer' && me.hp >= me.max) v = 3;
  if (WEAPONS.includes(k) && KINDS[k].range <= g.range(me)) v = 1;
  if (KINDS[k].blue && k !== 'jail' && !WEAPONS.includes(k) && g.has(me, k)) v = 0;
  return v;
};
const worst = (g, me, cs, n) => [...cs].sort((a, b) => val(g, me, a) - val(g, me, b)).slice(0, n);

/** 지금 요청에 봇이 낼 답 */
export function decide(g, pid) {
  const q = g.req;
  const me = g.P(pid);
  if (!q || q.to !== pid) return null;
  const C = c => g.C(c);

  switch (q.kind) {
    case 'play': return playTurn(g, me);
    case 'discard': return { a: 'discard', cs: worst(g, me, me.hand, q.n) };
    case 'react': {
      if (q.barrel) return { a: 'barrel' };            // 술통이 있으면 먼저 뽑아 본다
      const ok = me.hand.filter(c => q.ok.includes(C(c).k))
        .sort((a, b) => (C(a).k === q.ok[0] ? -1 : 1) - (C(b).k === q.ok[0] ? -1 : 1));
      if (ok.length >= q.need) {
        if (q.why === 'duel') {
          const from = g.P(q.from);
          if (enemy(g, me, from) < -1 && me.hp > 2) return { a: 'take' };
        }
        return { a: 'cards', cs: ok.slice(0, q.need) };
      }
      return { a: 'take' };
    }
    case 'lucky': return { a: 'pick', c: (q.good && q.good[0] != null) ? q.good[0] : q.cards[0] };
    case 'dying': {
      const beer = me.hand.find(c => C(c).k === 'beer');
      if (beer && g.canBeer()) return { a: 'beer', c: beer };
      if (g.ab(me, 'sid') && me.hand.length >= 2) return { a: 'sid', cs: worst(g, me, me.hand, 2) };
      return { a: 'die' };
    }
    case 'store': {
      const best = [...q.cards].sort((a, b) => val(g, me, b) - val(g, me, a))[0];
      return { a: 'pick', c: best };
    }
    case 'jesse': {
      const t = g.others(me).filter(o => o.hand.length).sort((a, b) => enemy(g, me, b) - enemy(g, me, a) || b.hand.length - a.hand.length)[0];
      return t && enemy(g, me, t) > 0 ? { a: 'from', t: t.id } : { a: 'deck' };
    }
    case 'pedro': {
      const top = g.pile[g.pile.length - 1];
      return top != null && val(g, me, top) >= 5 ? { a: 'discard' } : { a: 'deck' };
    }
    case 'kit': return { a: 'back', c: worst(g, me, q.cards, 1)[0] };
    case 'daltons': {
      // 감옥 · 다이너마이트가 있으면 그것부터 버린다
      const bad = q.cards.find(c => C(c).k === 'jail' || C(c).k === 'dynamite');
      return { a: 'pick', c: bad != null ? bad : worst(g, me, q.cards, 1)[0] };
    }
    case 'blood': {
      const t = q.tg.map(id => g.P(id)).filter(o => enemy(g, me, o) < -1).sort((a, b) => a.hp - b.hp)[0];
      return t && me.hp >= 3 && t.hp <= 2 ? { a: 'give', t: t.id } : { a: 'skip' };
    }
    case 'liquor': return me.hp < me.max && (me.hp <= 2 || me.hand.length >= me.hp + 2) ? { a: 'heal' } : { a: 'draw' };
    case 'peyote': {
      // 지금까지 나온 카드로 빨강·검정 남은 수를 어림한다
      let red = 0, black = 0;
      for (const id of g.deck) (g.C(id).s === 'H' || g.C(id).s === 'D') ? red++ : black++;
      return { a: red >= black ? 'red' : 'black' };
    }
    case 'ranch': {
      const cs = me.hand.filter(c => val(g, me, c) <= 2);
      return cs.length ? { a: 'swap', cs } : { a: 'skip' };
    }
  }
  return null;
}

function playTurn(g, me) {
  const mv = g.moves(me);
  // 서부의 법 — 보여 준 카드를 낼 수 있으면 꼭 낸다
  if (g.mustPlay != null && mv[g.mustPlay]) {
    const m = mv[g.mustPlay], c = g.mustPlay;
    if (!m.tg) return { a: 'play', c };
    const order = g.others(me).map(o => ({ o, e: enemy(g, me, o) })).sort((a, b) => b.e - a.e).map(x => x.o.id);
    let t = order.find(id => m.tg.includes(id));
    if (t == null && m.tg.length) t = m.tg[0];
    if (t != null) {
      if (m.steal) { const T = g.P(t); const tc = T.hand.length && T !== me ? 'hand' : T.table.find(x => !g.whyNot(me, c, t, x)); return { a: 'play', c, t, tc }; }
      return { a: 'play', c, t };
    }
    if (m.rico && m.rico.length) return { a: 'play', c, t: m.rico[0][0], tc: m.rico[0][1] };
  }
  const has = k => Object.keys(mv).map(Number).filter(c => g.C(c).k === k);
  const first = k => has(k)[0];
  const foes = g.others(me).map(o => ({ o, e: enemy(g, me, o) })).sort((a, b) => b.e - a.e);
  const best = (ids, min = 0.3) => {
    const f = foes.find(x => ids.includes(x.o.id) && x.e >= min);
    return f ? f.o : null;
  };

  // 1. 체력
  if (g.ab(me, 'sid') && me.hp <= 1 && me.hand.length >= 4) return { a: 'sid', cs: worst(g, me, me.hand, 2) };
  if (first('beer') != null && g.canBeer() && (me.hp <= me.max - 1) && (me.hp <= 2 || me.hand.length > me.hp)) return { a: 'play', c: first('beer') };
  if (first('saloon') != null && me.hp < me.max) return { a: 'play', c: first('saloon') };

  // 2. 카드 더 뽑기
  for (const k of ['wellsfargo', 'stagecoach', 'generalstore']) if (first(k) != null) return { a: 'play', c: first(k) };

  // 3. 장비
  for (const k of ['barrel', 'mustang', 'scope']) if (first(k) != null) return { a: 'play', c: first(k) };
  const weap = Object.keys(mv).map(Number).filter(c => WEAPONS.includes(g.C(c).k));
  for (const c of weap) {
    const k = g.C(c).k;
    const r = KINDS[k].range;
    const bangsInHand = me.hand.filter(x => g.C(x).k === 'bang').length;
    if (k === 'volcanic') { if (bangsInHand >= 2 && !g.ab(me, 'willy')) return { a: 'play', c }; continue; }
    if (r > g.range(me)) return { a: 'play', c };
  }

  // 4. 감옥 · 강탈 · 캣 벌로우
  if (first('jail') != null) { const t = best(mv[first('jail')].tg, 0.5); if (t) return { a: 'play', c: first('jail'), t: t.id }; }
  for (const k of ['panic', 'catbalou']) {
    const c = first(k);
    if (c == null) continue;
    const t = best(mv[c].tg, 0.4);
    if (!t) continue;
    // 앞에 놓인 좋은 카드가 있으면 그것부터(빼앗거나 없앤다) — 감옥·다이너마이트가 내 편 앞에 있다면 걷어 준다
    const tc = t.table.find(x => !g.whyNot(me, c, t.id, x) && ['barrel', 'mustang', 'scope', ...WEAPONS].includes(g.C(x).k));
    if (tc != null) return { a: 'play', c, t: t.id, tc };
    if (t.hand.length) return { a: 'play', c, t: t.id, tc: 'hand' };
  }

  // 5. 모두를 치는 카드
  const foeSum = foes.reduce((s, x) => s + (x.e > 0 ? 1 : -1), 0);
  for (const k of ['gatling', 'indians']) {
    const c = first(k);
    if (c != null && (me.role === 'outlaw' || me.role === 'renegade' ? foeSum >= 0 : foeSum > 0)) return { a: 'play', c };
  }

  const spareAll = me.hand.length > me.hp + 1;
  // 6. 결투 — 뱅!이 넉넉할 때
  const bangs = me.hand.filter(x => g.C(x).k === 'bang' || (g.ab(me, 'calamity') && g.C(x).k === 'missed')).length;
  if (first('duel') != null && bangs >= 2) { const t = best(mv[first('duel')].tg, spareAll ? 0 : 0.5); if (t) return { a: 'play', c: first('duel'), t: t.id }; }

  // 7. 뱅!
  const bangCards = Object.keys(mv).map(Number).filter(c => g.C(c).k === 'bang' || (g.ab(me, 'calamity') && g.C(c).k === 'missed'));
  // 빗나감!은 막는 데 아껴 둔다 — 캘러미티라도 뱅!부터
  bangCards.sort((a, b) => (g.C(a).k === 'bang' ? -1 : 1) - (g.C(b).k === 'bang' ? -1 : 1));
  // 저격수 — 뱅!이 두 장 이상이면 적에게 한꺼번에
  for (const c of bangCards) {
    const m = mv[c];
    if (!m.snipe) continue;
    const t = best(m.sniperTg, 0.5);
    if (t) return { a: 'play', c, c2: m.snipe[0], t: t.id };
  }
  // 어차피 버릴 카드라면 애매한 상대라도 쏜다 — 다들 눈치만 보다 판이 늘어지지 않게
  const spare = me.hand.length > me.hp;
  for (const c of bangCards) {
    const t = best(mv[c].tg, spare ? -0.5 : 0.3);
    if (t) return { a: 'play', c, t: t.id };
  }
  // 도탄 — 쏠 사람이 없으면 적의 좋은 장비를 겨냥한다
  for (const c of bangCards) {
    const m = mv[c];
    if (!m.rico) continue;
    const hitc = m.rico.find(([t, x]) => enemy(g, me, g.P(t)) >= 0.5 && ['barrel', 'mustang', 'scope', ...WEAPONS].includes(g.C(x).k));
    if (hitc && spare) return { a: 'play', c, t: hitc[0], tc: hitc[1] };
  }

  // 8. 다이너마이트 — 무법자·배신자는 판을 흔든다
  if (first('dynamite') != null && (me.role === 'outlaw' || me.role === 'renegade') && g.alive().length > 3) return { a: 'play', c: first('dynamite') };

  // 시드 케첨: 어차피 버릴 카드로 생명을 산다 — 쏠 건 다 쏜 뒤에
  if (g.ab(me, 'sid') && me.hp < me.max && me.hand.length >= 2 && me.hand.length > me.hp) return { a: 'sid', cs: worst(g, me, me.hand, 2) };
  return { a: 'end' };
}
