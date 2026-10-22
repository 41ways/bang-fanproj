/** 봇끼리 수천 판 — 엔진이 멈추거나 카드가 사라지지 않는지 본다 */
import { Game, eventDeck } from '../src/engine.js';
import { decide } from '../src/bot.js';

let seed = Number(process.argv[2] || 1);
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const N = Number(process.argv[3] || 2000);
const wins = {}; let steps = 0, maxSteps = 0, rounds = 0;
for (let i = 0; i < N; i++) {
  const n = 4 + (i % 4);
  const seats = Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: '봇' + k, bot: true }));
  const exp = ['none', 'hn', 'foc', 'both', 'either'][i % 5];
  const g = new Game(seats, { rng, events: eventDeck(exp, i % 3 !== 0, rng) });
  let s = 0;
  while (!g.over) {
    if (!g.req) throw new Error('요청 없이 멈춤 game ' + i);
    const r = decide(g, g.req.to);
    if (!r) throw new Error('봇이 답 못함 ' + g.req.kind);
    g.answer(g.req.to, r);
    // 카드 80장이 그대로인지
    const total = g.limbo.length + g.deck.length + g.pile.length + g.store.length + g.players.reduce((a, p) => a + p.hand.length + p.table.length, 0);
    if (total !== 80) throw new Error('카드 수 ' + total + ' after ' + JSON.stringify(r) + ' game ' + i);
    if (++s > 20000) throw new Error('끝나지 않음 game ' + i + ' round ' + g.round);
  }
  steps += s; maxSteps = Math.max(maxSteps, s); rounds += g.round;
  const k = n + ':' + exp + ':' + g.over.team; wins[k] = (wins[k] || 0) + 1;
}
console.log('ok', N, '판 · 평균 걸음', (steps / N).toFixed(0), '최대', maxSteps, '평균 바퀴', (rounds / N).toFixed(1));
console.log(Object.entries(wins).sort().map(([k, v]) => k + ' ' + v).join('\n'));
