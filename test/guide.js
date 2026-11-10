/** 초보자 가이드 — 봇끼리 판을 돌리며 모든 요청 · 모든 자리에서 가이드를 불러 본다. 멈추거나 이상한 추천이 없는지 */
import { Game, eventDeck } from '../src/engine.js';
import { decide } from '../src/bot.js';
import { advise } from '../public/guide.js';

let seed = Number(process.argv[2] || 7);
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const N = Number(process.argv[3] || 300);
let calls = 0, cardHints = 0, targetHints = 0;
const kinds = {};
for (let i = 0; i < N; i++) {
  const n = 4 + (i % 4);
  const seats = Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: '봇' + k, bot: true }));
  const g = new Game(seats, { rng, events: eventDeck(['none', 'hn', 'foc', 'both'][i % 4], i % 3 !== 0, rng) });
  let s = 0;
  while (!g.over) {
    for (const p of g.players) {
      const v = JSON.parse(JSON.stringify(g.view(p.id)));
      const mine = v.req && v.req.to === p.id ? v.req : null;
      const a = advise(v, p.id, mine, [], null);
      calls++;
      if (!Array.isArray(a.lines) || a.lines.some(t => typeof t !== 'string' || /undefined|NaN|null/.test(t)))
        throw new Error('이상한 가이드 줄 ' + JSON.stringify(a.lines) + ' game ' + i);
      if (p.alive && a.lines.length < 1) throw new Error('산 사람에게 빈 가이드 game ' + i);
      if (a.lines.length > 4) throw new Error('가이드가 너무 김 ' + a.lines.length);
      const hand = v.me ? v.me.hand.map(c => c.id) : [];
      if (a.card != null) {
        cardHints++;
        if (!mine || mine.kind !== 'play' || !mine.moves[a.card]) throw new Error('낼 수 없는 카드를 추천 ' + a.card + ' game ' + i);
      }
      for (const c of a.cards) if (!hand.includes(c)) throw new Error('손에 없는 카드 표시 game ' + i);
      if (mine) kinds[mine.kind] = (kinds[mine.kind] || 0) + 1;
      // 카드를 고른 상태에서 대상 추천이 실제 대상 안에 있는지
      if (mine && mine.kind === 'play') for (const id of Object.keys(mine.moves).map(Number)) {
        const b = advise(v, p.id, mine, [id], null);
        if (b.target != null) { targetHints++; if (!(mine.moves[id].tg || []).includes(b.target)) throw new Error('대상 밖 추천 game ' + i); }
        // 부관은 보안관을 추천하지 않는다
        const tp = b.target != null && v.players.find(q => q.id === b.target);
        if (tp && tp.role === 'sheriff' && p.role === 'deputy') throw new Error('부관에게 보안관을 쏘라고 함 game ' + i);
      }
    }
    const r = decide(g, g.req.to);
    g.answer(g.req.to, r);
    if (++s > 20000) throw new Error('끝나지 않음');
  }
}
console.log('가이드 통과', N, '판 · 부른 횟수', calls, '· 카드 추천', cardHints, '· 대상 추천', targetHints);
