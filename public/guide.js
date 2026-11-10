/**
 * 뱅! — 초보자 가이드. 지금 판을 보고 "무엇을 하면 좋은지"를 두세 줄로 알려 주고,
 * 추천하는 손 카드 · 대상 자리에 표시를 단다. 화면 위 🧭 단추로 켜고 끈다.
 *
 * 편 짐작은 봇(src/bot.js)과 같다 — 누가 누구를 공격했는지(g.aggro)를 보고,
 * 보안관을 친 사람은 무법자 쪽, 그 사람을 친 사람은 보안관 쪽으로 가늠한다.
 * 살아 있는 사람의 역할은 보안관 말고는 모른다. 죽은 사람의 역할만 센다.
 */
import { KINDS, WEAPONS, ROLES_BY_N } from './cards.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const josa = (w, a, b) => {
  const s = String(w).replace(/[^가-힣]/g, '') || 'ㄱ', ch = s.charCodeAt(s.length - 1), jong = (ch - 0xac00) % 28;
  if (a === '으로' && jong === 8) return b;          // ㄹ 받침은 "로" — 강탈!로
  return (ch >= 0xac00 && ch <= 0xd7a3 && jong) ? a : b;
};
const roNum = n => n + (n === 3 || n === 6 ? '으로' : '로');
const N = p => `<b>${esc(p.name)}</b>`;
const K = k => `<b>${KINDS[k].name}</b>`;
const KJ = (k, a, b) => K(k) + josa(KINDS[k].name, a, b);

/** 보안관 쪽을 공격해 온 정도 — 클수록 무법자 냄새 */
function suspicion(g, o) {
  const sh = g.players.find(p => p.role === 'sheriff');
  if (!sh || o === sh) return 0;
  const ag = g.aggro || {}, a = ag[o.id] || {}, bySh = ag[sh.id] || {};
  let s = (a[sh.id] || 0) * 2;
  for (const q of g.players) {
    if (q === o || q === sh) continue;
    if (bySh[q.id] && a[q.id]) s -= 1;                       // 보안관이 친 사람을 같이 쳤다
    if ((ag[q.id] || {})[sh.id] && a[q.id]) s -= 1.5;          // 보안관을 친 사람을 쳤다
  }
  return s + (bySh[o.id] || 0) * 0.5;
}

/** 남은 역할 수 — 처음 역할 구성에서 죽어 드러난 역할을 뺀다 */
function rolesLeft(g) {
  const all = ROLES_BY_N[g.players.length] || [];
  const left = { sheriff: 0, deputy: 0, outlaw: 0, renegade: 0 };
  for (const r of all) left[r]++;
  for (const p of g.players) if (!p.alive && p.role) left[p.role]--;
  return left;
}

/** 내가 보기에 o 가 얼마나 적인가 — 0 아래면 편 */
function enemy(g, me, o) {
  if (o === me || !o.alive) return -99;
  const live = g.players.filter(p => p.alive);
  const left = rolesLeft(g);
  const s = suspicion(g, o), sheriff = o.role === 'sheriff';
  switch (me.role) {
    case 'sheriff': return (left.outlaw ? 0.6 : 1) + s;
    case 'deputy': return sheriff ? -10 : (!left.outlaw && left.renegade ? 0.8 : 0.15) + s;
    case 'outlaw': return sheriff ? 10 : 0.2 - s;
    case 'renegade': {
      if (sheriff) return live.filter(p => p !== me && p.role !== 'sheriff').length ? -3 : 10;
      if (live.length <= 2 || !left.outlaw) return 5;
      return 0.3 + s;
    }
  }
  return 0;
}

/** 대상으로 고른 까닭 한마디 */
function whyFoe(g, me, o) {
  if (o.role === 'sheriff') return '보안관이에요';
  const ag = g.aggro || {}, sh = g.players.find(p => p.role === 'sheriff');
  const hitSh = sh ? (ag[o.id] || {})[sh.id] || 0 : 0;
  if (hitSh && me.role !== 'outlaw') return `보안관을 ${hitSh}번 공격했어요`;
  if ((ag[o.id] || {})[me.id]) return '나를 공격했어요';
  if (o.hp <= 1) return '생명이 1뿐이에요';
  if (me.role === 'renegade' && suspicion(g, o) > 0) return '무법자로 보여요 — 배신자는 무법자부터 줄여요';
  if (me.role === 'sheriff' && suspicion(g, o) <= 0) return '아직 정체는 몰라도 무법자가 가장 많아요';
  if (me.role === 'outlaw') return '보안관 편으로 보여요';
  return '';
}

/** 카드 값어치 — 봇과 같은 눈금. 버릴 카드 · 잡화점 고르기에 쓴다 */
const VAL = {
  missed: 6, beer: 6, bang: 5, wellsfargo: 6, stagecoach: 5, generalstore: 4, panic: 5, catbalou: 4,
  gatling: 5, indians: 4, duel: 4, barrel: 5, scope: 3, mustang: 4, jail: 4, dynamite: 1, saloon: 3,
  volcanic: 2, schofield: 2, remington: 3, carabine: 3, winchester: 3,
};
function val(me, c) {
  const k = c.k;
  let v = VAL[k] || 2;
  if (k === 'beer' && me.hp >= me.max) v = 3;
  if (WEAPONS.includes(k) && KINDS[k].range <= me.range) v = 1;
  if (KINDS[k].blue && k !== 'jail' && !WEAPONS.includes(k) && me.table.some(t => t.k === k)) v = 0;
  return v;
}

/** 잡화점에서 고를 때 한마디 */
const GOOD = {
  missed: '누가 쏠 때 막을 수 있어요.', beer: '생명을 되찾고, 쓰러질 때 살아날 수도 있어요.', bang: '내 차례에 한 명을 공격해요.',
  barrel: '앞에 놓으면 뱅!을 운 좋게 막아요.', mustang: '앞에 놓으면 남이 나를 쏘기 어려워져요.', scope: '앞에 놓으면 더 멀리 쏠 수 있어요.',
  wellsfargo: '카드를 3장 더 받아요.', stagecoach: '카드를 2장 더 받아요.', panic: '남의 카드를 빼앗아요.', catbalou: '남의 카드를 버리게 해요.',
  gatling: '다른 모두를 한꺼번에 공격해요.', indians: '다른 모두가 뱅!을 버리거나 생명을 잃어요.', duel: '한 명과 뱅!을 번갈아 버리며 겨뤄요.',
  jail: '적 앞에 놓으면 그 사람이 턴을 거를 수도 있어요.', saloon: '모두의 생명을 1씩 채워요.', generalstore: '모두 한 장씩 카드를 가져가요.',
  dynamite: '운에 맡기는 카드예요. 터지면 생명 3을 잃어요.', volcanic: '무기예요. 사거리는 1이지만 뱅!을 여러 장 쏠 수 있어요.',
};

/** 역할마다 할 일 — 맨 윗줄 */
function goalLine(g, me) {
  const sh = g.players.find(p => p.role === 'sheriff');
  const left = rolesLeft(g);
  switch (me.role) {
    case 'sheriff': return `<i>⭐ 보안관</i> 무법자 ${left.outlaw}명과 배신자를 모두 쓰러뜨리면 이겨요. 나를 쏘는 사람이 적이에요.`;
    case 'deputy': return `<i>🔰 부관</i> 보안관 ${N(sh)} 님을 지키세요. 보안관을 쏘는 사람이 적이에요. 정체는 숨겨도 돼요.`;
    case 'outlaw': return `<i>💀 무법자</i> 보안관 ${N(sh)} 님을 쓰러뜨리면 이겨요. 보안관을 같이 쏘는 사람은 같은 편일 가능성이 커요.`;
    case 'renegade': return left.outlaw
      ? `<i>🎭 배신자</i> 마지막 한 명으로 남아야 해요. 지금은 보안관 편인 척 무법자부터 줄이세요. 보안관은 맨 마지막에.`
      : `<i>🎭 배신자</i> 무법자가 다 쓰러졌어요. 이제 남은 사람을 모두 쓰러뜨려야 해요.`;
  }
  return '';
}

/** 남이 보안관을 공격했는지 — 정체 짐작 한 줄 */
function suspectLine(g, me) {
  const sh = g.players.find(p => p.role === 'sheriff');
  if (!sh || !sh.alive) return '';
  const ag = g.aggro || {};
  const hit = g.players.filter(p => p.alive && p !== sh && p !== me && !p.role && (ag[p.id] || {})[sh.id] >= 1 && suspicion(g, p) >= 2)
    .sort((a, b) => suspicion(g, b) - suspicion(g, a));
  if (!hit.length) return '';
  const names = hit.slice(0, 2).map(N).join(' · ');
  return me.role === 'outlaw'
    ? `🕵 ${names} 님이 보안관을 공격했어요 — 같은 무법자일 가능성이 커요.`
    : `🕵 ${names} 님이 보안관을 공격했어요 — 무법자일 가능성이 커요.`;
}

/** 내 차례 — 손에서 무엇부터 낼지 */
function playAdvice(g, me, hand, r) {
  const can = id => !!r.moves[id];
  const of = k => hand.filter(c => c.k === k && can(c.id));
  const foes = g.players.filter(o => o.alive && o !== me);
  const best = ids => ids.map(id => g.players.find(p => p.id === id)).filter(Boolean)
    .map(o => ({ o, e: enemy(g, me, o) })).filter(x => x.e > 0.3).sort((a, b) => b.e - a.e || a.o.hp - b.o.hp)[0];
  const out = [];   // { c, t, html } — 먼저 할 일부터

  for (const k of ['wellsfargo', 'stagecoach']) for (const c of of(k)) out.push({ c: c.id, html: `${KJ(k, '으로', '로')} 카드부터 더 받으세요 — 뽑은 다음에 무엇을 낼지 고르는 게 이득이에요.` });
  for (const k of ['barrel', 'mustang', 'scope']) for (const c of of(k)) out.push({ c: c.id, html: `${KJ(k, '을', '를')} 앞에 놓으세요 — 한 번 놓으면 계속 효과가 나요.` });

  // 무기 — 지금보다 멀리 쏘는 것만
  const gun = of('volcanic').concat(...WEAPONS.slice(1).map(of)).filter(c => KINDS[c.k].range > me.range || (c.k === 'volcanic' && hand.filter(x => x.k === 'bang').length >= 2 && foes.some(o => o.dist <= 1 && enemy(g, me, o) > 0.3)));
  gun.sort((a, b) => KINDS[b.k].range - KINDS[a.k].range);
  if (gun[0]) {
    const k = gun[0].k;
    out.push({ c: gun[0].id, html: k === 'volcanic'
      ? `${KJ(k, '을', '를')} 들면 이번 턴에 뱅!을 여러 장 쏠 수 있어요.`
      : `${KJ(k, '으로', '로')} 바꾸면 사거리가 ${me.range}에서 ${roNum(KINDS[k].range)} 늘어요.` });
  }

  const hpLow = me.hp < me.max && (me.hp <= 2 || hand.length > me.hp + 1);
  for (const c of of('beer')) if (hpLow) { out.push({ c: c.id, html: `${KJ('beer', '으로', '로')} 생명을 채우세요 (${me.hp} → ${me.hp + 1}).` }); break; }
  for (const c of of('saloon')) if (me.hp < me.max) { out.push({ c: c.id, html: `${KJ('saloon', '으로', '로')} 생명을 채우세요 — 다른 사람도 같이 채워져요.` }); break; }

  for (const c of of('jail')) { const b = best(r.moves[c.id].tg || []); if (b) { out.push({ c: c.id, t: b.o.id, html: `${KJ('jail', '을', '를')} ${N(b.o)} 님 앞에 놓으세요 — ${whyFoe(g, me, b.o) || '적으로 보여요'}. 하트가 안 나오면 턴을 걸러요.` }); break; } }
  for (const k of ['panic', 'catbalou']) for (const c of of(k)) {
    const b = best(r.moves[c.id].tg || []);
    if (b) { const good = b.o.table.find(t => ['barrel', 'mustang', 'scope'].includes(t.k) || WEAPONS.includes(t.k)); out.push({ c: c.id, t: b.o.id, html: `${KJ(k, '으로', '로')} ${N(b.o)} 님의 ${good ? KJ(good.k, '을', '를') : '카드를'} ${k === 'panic' ? '빼앗으세요' : '버리게 하세요'}.` }); break; }
  }

  const bangs = of('bang').concat(me.char === 'calamity' ? of('missed') : []);
  if (bangs.length) {
    const b = best(r.moves[bangs[0].id].tg || []);
    if (b) out.push({ c: bangs[0].id, t: b.o.id, html: `뱅!으로 ${N(b.o)} 님을 쏘세요 — ${whyFoe(g, me, b.o) || '적으로 보여요'}.` });
  }
  for (const c of of('duel')) { const b = best(r.moves[c.id].tg || []); if (b && hand.filter(x => x.k === 'bang').length >= 2) { out.push({ c: c.id, t: b.o.id, html: `뱅!이 넉넉하니 ${N(b.o)} 님과 ${K('duel')}해 보세요 — 뱅!을 더 오래 버티는 쪽이 이겨요.` }); break; } }
  for (const k of ['gatling', 'indians']) for (const c of of(k)) {
    const friend = me.role === 'deputy' || me.role === 'renegade' ? g.players.find(p => p.role === 'sheriff' && p.alive && p.hp <= 2) : null;
    if (!friend) { out.push({ c: c.id, html: `${KJ(k, '은', '는')} 다른 모두를 한꺼번에 공격해요.` }); break; }
  }
  for (const c of of('generalstore')) { out.push({ c: c.id, html: `${KJ('generalstore', '은', '는')} 모두 한 장씩 가져가요. 내가 가장 먼저 골라요.` }); break; }
  return out;
}

/**
 * 지금 보여 줄 가이드.
 * @returns {{ lines: string[], card: number|null, cards: number[], target: number|null, store: number|null }}
 */
export function advise(g, myId, r, sel, mode) {
  const none = { lines: [], card: null, cards: [], target: null, store: null };
  const me = g && g.players.find(p => p.id === myId);
  if (!g || !me || !g.me || g.over) return none;
  if (!me.alive) return { ...none, lines: ['쓰러졌어요 — 남은 사람들이 어떻게 싸우는지 지켜보세요. 같은 편이 이기면 나도 이겨요.'] };
  const hand = g.me.hand;
  const goal = goalLine(g, me), sus = suspectLine(g, me);
  const res = { ...none, lines: [goal] };
  const say = h => res.lines.push(h);

  if (!r) {
    // 남의 차례 — 정체 짐작과 손 카드 아끼기
    if (sus) say(sus);
    const threats = g.players.filter(o => o.alive && o !== me && o.dist != null && o.range != null && enemy(g, me, o) > 0.3);
    const missed = hand.filter(c => c.k === 'missed').length, beer = hand.filter(c => c.k === 'beer').length;
    if (me.hp <= 2) say(`생명이 ${me.hp}뿐이에요. ${missed ? '빗나감!' : ''}${missed && beer ? '·' : ''}${beer ? '맥주' : ''}${missed || beer ? '는 꼭 아껴 두세요.' : '다음 차례에 맥주·빗나감!을 챙기세요.'}`);
    else if (!sus && threats.length === 0) say('남의 차례에는 기다려요. 누가 누구를 쏘는지 보면 정체를 짐작할 수 있어요.');
    else if (missed) say('누가 나를 쏘면 빗나감!으로 막을 수 있어요.');
    return res;
  }

  switch (r.kind) {
    case 'play': {
      if (mode) return res;
      const c = sel.length === 1 && hand.find(x => x.id === sel[0]);
      if (c) {
        const mv = r.moves[c.id];
        if (mv && mv.tg) {
          const cand = mv.tg.map(id => g.players.find(p => p.id === id)).filter(Boolean).map(o => ({ o, e: enemy(g, me, o) })).sort((a, b) => b.e - a.e || a.o.hp - b.o.hp);
          const b = cand[0];
          if (b && b.e > 0.3) { res.target = b.o.id; say(`추천 대상: ${N(b.o)} 님 — ${whyFoe(g, me, b.o) || '적으로 보여요'}. 빛나는 자리를 누르세요.`); }
          else say('빛나는 사람 중 확실한 적이 없어요. 아직 아무도 공격하지 않았다면 아껴 두는 것도 방법이에요.');
          const sh = mv.tg.map(id => g.players.find(p => p.id === id)).find(p => p && p.role === 'sheriff');
          if (sh && (me.role === 'deputy' || (me.role === 'renegade' && rolesLeft(g).outlaw))) say(`⚠ 보안관 ${N(sh)} 님은 쏘지 마세요 — ${me.role === 'deputy' ? '같은 편이에요' : '보안관이 먼저 쓰러지면 배신자는 져요'}.`);
        } else say(`${KJ(c.k, '을', '를')} 한 번 더 누르거나 "사용하기"를 누르면 써요. 다른 카드를 누르면 바꿀 수 있어요.`);
        return res;
      }
      const todo = playAdvice(g, me, hand, r);
      if (todo.length) {
        res.card = todo[0].c; res.target = null;
        say(`👉 ${todo[0].html}`);
        if (sus) say(sus);
        else if (todo[1] && todo[1].c !== todo[0].c) say(`그다음엔 ${todo[1].html}`);
      } else {
        const missed = hand.filter(x => x.k === 'missed').length;
        const over = hand.length - me.hp;
        const atk = hand.find(x => ['bang', 'duel', 'panic', 'catbalou', 'jail'].includes(x.k) && r.moves[x.id]);
        const bangNo = hand.find(x => x.k === 'bang' && !r.moves[x.id]);
        const sh = g.players.find(p => p.role === 'sheriff' && p.alive);
        const far = me.role === 'outlaw' && sh && sh.dist != null && sh.dist > me.range ? ` 보안관까지 거리 ${sh.dist}, 내 사거리 ${me.range} — 무기·조준경을 구하면 닿아요.` : '';
        const tail = `${over > 0 ? ` 끝낼 때 손 카드가 생명(${me.hp})보다 ${over}장 많아서 그만큼 버려요.` : ''}`;
        const bw = bangNo && r.why && r.why[bangNo.id] ? esc(r.why[bangNo.id]).replace(/\.?$/, '.') : '';
        if (atk) say(`${KJ(atk.k, '은', '는')} 낼 수 있지만 확실한 적이 안 보여요. 같은 편을 칠 수도 있으니 아껴 두고 <b>턴 끝내기</b>를 눌러도 돼요.${far}${tail}`);
        else say(`지금 낼 만한 카드가 없어요 — <b>턴 끝내기</b>를 누르세요.${bw ? ` ${/뱅/.test(bw) ? bw : '뱅!은 ' + bw}` : missed ? ' 빗나감!은 남의 차례에 막을 때 써요.' : ''}${far}${tail}`);
        if (sus) say(sus);
      }
      if (todo.length && hand.length - me.hp > 2 && res.lines.length < 3) say(`손 카드가 생명(${me.hp})보다 많으면 턴 끝에 버려야 해요. 쓸 수 있는 카드는 먼저 쓰세요.`);
      return res;
    }
    case 'react': {
      const elig = hand.filter(c => (r.ok || []).includes(c.k));
      const from = g.players.find(p => p.id === r.from);
      if (r.barrel) say('🛢 술통부터 쓰세요 — 하트가 나오면 카드 없이 막아요. 실패해도 빗나감!을 또 낼 수 있어요.');
      else if (r.why === 'duel') {
        const mine = elig.length;
        if (from && enemy(g, me, from) < -1) say(`${N(from)} 님은 같은 편 같아요. 뱅!을 아끼려면 포기해도 돼요.`);
        else say(mine ? `뱅!이 ${mine}장 있어요. 버티면 상대도 뱅!을 버려야 해요 — 먼저 못 버리는 쪽이 생명 1을 잃어요.` : '버릴 뱅!이 없어요 — 포기하면 생명 1을 잃어요.');
      } else if (r.why === 'indians') say(elig.length ? '뱅!을 1장 버리면 생명을 지켜요.' : '버릴 뱅!이 없어요 — 생명 1을 잃어요.');
      else if (r.why === 'ricochet') say(elig.length ? '그 카드가 아깝지 않으면 빗나감!을 아껴 두고 포기해도 돼요.' : '막을 빗나감!이 없어요.');
      else if (elig.length >= (r.need || 1)) say(`빗나감!으로 막으세요. 맞으면 생명이 ${me.hp}에서 ${roNum(me.hp - (r.why === 'roulette' ? 2 : 1))} 줄어요.`);
      else {
        const beer = hand.some(c => c.k === 'beer');
        say(me.hp <= (r.why === 'roulette' ? 2 : 1) ? (beer ? '막을 카드가 없어요. 맞아도 맥주가 있으니 살아날 수 있어요.' : '막을 카드가 없어요. 이번에 맞으면 쓰러져요.') : '막을 카드가 없어요 — 맞기를 누르세요.');
      }
      if (elig.length) res.cards = elig.slice(0, r.need || 1).map(c => c.id);
      return res;
    }
    case 'discard': {
      const pick = [...hand].sort((a, b) => val(me, a) - val(me, b)).slice(0, r.n);
      res.cards = pick.map(c => c.id);
      say(`덜 쓸모 있는 카드에 표시했어요: ${pick.map(c => K(c.k)).join(' · ')}.${pick.some(c => c.k === 'missed' || c.k === 'beer') ? '' : ' 빗나감!·맥주는 되도록 남기세요.'}`);
      return res;
    }
    case 'dying':
      say(hand.some(c => c.k === 'beer') ? '🍺 맥주를 마시면 살아나요!' : '맥주가 없어요. 쓰러져도 같은 편이 이기면 나도 이겨요.');
      return res;
    case 'store': {
      const pick = [...(g.store || [])].sort((a, b) => val(me, b) - val(me, a))[0];
      if (pick) { res.store = pick.id; say(`${KJ(pick.k, '을', '를')} 추천해요 — ${GOOD[pick.k] || (KINDS[pick.k].range ? `무기예요. 사거리 ${KINDS[pick.k].range}.` : '')}`); }
      return res;
    }
    case 'jesse': say('적으로 보이는 사람의 손에서 가져오면 그 사람 카드가 줄어요. 모르겠으면 더미에서 뽑으세요.'); return res;
    case 'pedro': say('버린 카드 맨 위가 빗나감!·맥주·뱅!이면 가져올 만해요.'); return res;
    case 'liquor': say(me.hp <= 2 ? '생명이 적어요 — 뽑지 않고 생명 +1이 좋아요.' : '생명이 넉넉하면 평소대로 뽑는 게 나아요.'); return res;
    case 'blood': say('같은 편의 생명이 1~2일 때만 나눠 주세요. 아니면 건너뛰기.'); return res;
    case 'ranch': {
      const pick = hand.filter(c => val(me, c) <= 2);
      res.cards = pick.map(c => c.id);
      say(pick.length ? `쓸모 적은 카드에 표시했어요: ${pick.map(c => K(c.k)).join(' · ')}.` : '바꿀 만한 카드가 없어요 — 그대로 두세요.');
      return res;
    }
  }
  return res;
}
