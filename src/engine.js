/**
 * 뱅! — 규칙 엔진. 서버에서만 돈다. Cloudflare 것이 하나도 안 들어와서 node 로 바로 시험한다.
 *
 * 판의 흐름은 제너레이터 하나(main)다. 누군가 골라야 할 때마다 요청(req)을 하나 내놓고 멈춘다 —
 * 한 번에 요청은 늘 하나. 기관총 · 인디언!도 한 사람씩 차례로 묻는다(BGA 와 같다).
 * answer() 로 답이 오면 그 자리에서 이어서 돈다. 뱅! → 술통 → 빗나감! → 맞음 → 맥주 → 죽음 → 보상처럼
 * 겹겹이 이어지는 효과가 yield* 한 줄씩으로 끝난다.
 *
 * 확장(하이눈 · 한 줌의 카드)은 BGA 소스(Syarwin/bga-bang)를 따른다. 이벤트 카드는 보안관의 두 번째
 * 턴부터 보안관 차례마다 한 장씩 뒤집히고, 한 바퀴 동안 모두에게 걸린다. 마지막 카드(하이눈 /
 * 한 줌의 카드)는 끝까지 남는다.
 *
 * 요청(req) 모양 — 화면은 kind 로 갈래를 고른다
 *   play     내 턴에 카드 내기     답 {a:'play', c, t?, tc?, c2?} · {a:'sid', cs:[c,c]} · {a:'end'}
 *   discard  손이 생명보다 많다    답 {a:'discard', cs:[…n장]} · {a:'cancel'}
 *   react    뱅!·기관총·인디언!·결투·도탄·룰렛에 맞섬   답 {a:'cards', cs} · {a:'barrel'} · {a:'take'}
 *   dying    마지막 생명을 잃음    답 {a:'beer', c} · {a:'sid', cs:[c,c]} · {a:'die'}
 *   store    잡화점에서 고르기     답 {a:'pick', c}
 *   jesse / pedro / kit / lucky   인물 능력
 *   daltons  달튼 형제 — 내 앞의 파란 카드 1장 버리기   답 {a:'pick', c}
 *   blood    피를 나눈 형제 — 생명 1을 남에게           답 {a:'give', t} · {a:'skip'}
 *   liquor   독한 술 — 뽑기 대신 생명 +1                답 {a:'heal'} · {a:'draw'}
 *   peyote   페요테 — 빨강/검정 맞히기                  답 {a:'red'} · {a:'black'}
 *   ranch    목장 — 손 카드를 버리고 그만큼 다시 뽑기   답 {a:'swap', cs} · {a:'skip'}
 */
import { DECK, KINDS, CHARS, ROLES_BY_N, WEAPONS, EVENTS, cardName, cardTag } from '../public/cards.js';

const OVER = Symbol('over');

export class Game {
  /**
   * @param seats [{id, name, bot}] 앉은 순서 = 시계 방향
   * @param opt   { rng, chars, roles, events: 이벤트 카드 순서(맨 앞이 먼저 뒤집힌다, 맨 끝이 마지막 카드) }
   */
  constructor(seats, opt = {}) {
    const n = seats.length;
    if (!ROLES_BY_N[n]) throw new Error('4~7명이어야 합니다');
    this.rng = opt.rng || Math.random;
    this.cards = DECK.map(c => ({ ...c }));
    const roles = opt.roles || this.shuffle([...ROLES_BY_N[n]]);
    const chars = opt.chars || this.shuffle(Object.keys(CHARS)).slice(0, n);
    this.players = seats.map((s, i) => {
      const role = roles[i];
      const max = CHARS[chars[i]].hp + (role === 'sheriff' ? 1 : 0);
      // status: live · down(쓰러졌지만 유령 마을/죽은 자로 돌아올 수 있음) · ghost(유령으로 한 턴) · out(완전히 탈락)
      return { id: s.id, name: s.name, bot: !!s.bot, seat: i, role, char: chars[i], hp: max, max, hand: [], table: [], alive: true, status: 'live' };
    });
    this.deck = this.shuffle(this.cards.map(c => c.id));
    this.pile = [];             // 버린 카드, 끝이 맨 위
    this.store = [];            // 잡화점에 펼친 카드
    this.limbo = [];            // 럭키 듀크 · 킷 칼슨이 보고 있는 카드
    this.turn = this.players.find(p => p.role === 'sheriff').id;
    this.bangs = 0;
    this.req = null;
    this.seq = 0;               // 요청 번호 — 늦게 온 답을 가려낸다
    this.over = null;           // { team, winners:[id] }
    this.logs = [];             // 화면의 기록 칸
    this.fx = [];               // 이번 걸음에 생긴 연출거리(화면이 가져가고 비운다)
    this.aggro = {};            // aggro[a][b] = a 가 b 를 공격한 횟수 — 봇이 편을 짐작할 때 쓴다
    this.round = 1;
    this.evDeck = [...(opt.events || [])];
    this.event = null;          // 지금 걸린 이벤트
    this.firstOut = null;       // 처음 쓰러진 사람(죽은 자)
    this.mustPlay = null;       // 서부의 법 — 이번 턴에 꼭 내야 하는 카드
    this.again = false;         // 복수 — 한 턴 더
    this.phaseDrawn = null;
    for (const p of this.players) for (let k = 0; k < p.max; k++) this.give(p, this.draw());
    this.gen = this.main();
    this.step(undefined);
  }

  /* ───────────── 도구 ───────────── */
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  P(id) { return this.players.find(p => p.id === id); }
  C(id) { return this.cards[id]; }
  alive() { return this.players.filter(p => p.alive); }
  log(text, cls) { this.logs.push({ n: this.logN = (this.logN || 0) + 1, text, cls }); if (this.logs.length > 400) this.logs.splice(0, 100); }
  emit(e) { this.fx.push(e); }
  nm(p) { return p.name; }
  cn(c) { return cardName(this.C(c)) + '(' + cardTag(this.C(c)) + ')'; }
  /** 카드 이름 + 조사 — "레밍턴(♣K)을", "맥주(♥6)를" (받침은 카드 이름으로 본다) */
  cnj(c, a, b) { return this.cn(c) + josa(cardName(this.C(c)).replace(/[^가-힣]/g, '') || 'ㄱ', a, b); }
  ev(k) { return this.event === k; }
  evName() { return EVENTS[this.event] ? EVENTS[this.event].name : ''; }
  /** 인물 능력 — 숙취(Hangover)면 모두 꺼진다 */
  ab(p, ch) { return p.char === ch && !this.ev('hangover'); }
  hit_(a, b) {
    if (!a || !b || a === b) return;
    const m = this.aggro[a.id] || (this.aggro[a.id] = {});
    m[b.id] = (m[b.id] || 0) + 1;
  }
  /** 무늬 — 축복이면 모두 ♥, 저주면 모두 ♠ (뽑기!·블랙 잭 판정에만) */
  suitOf(c) { return this.ev('blessing') ? 'H' : this.ev('curse') ? 'S' : this.C(c).s; }

  /** 더미에서 한 장. 비었으면 버린 카드를 모두(맨 위 카드까지 — BGA 와 같다) 섞어 새 더미로 */
  draw() {
    if (!this.deck.length) {
      if (!this.pile.length) return null;
      this.deck = this.shuffle(this.pile);
      this.pile = [];
      this.log('버린 카드를 섞어 새 더미를 만들었습니다.', 'sys');
      this.emit({ fx: 'reshuffle' });
    }
    return this.deck.pop();
  }
  /** 1단계에서 뽑는 곳 — 버려진 광산이면 버린 카드에서(모자라면 더미에서) */
  drawP1() {
    if (this.ev('mine') && this.pile.length) return this.pile.pop();
    return this.draw();
  }
  give(p, c) { if (c != null) p.hand.push(c); }
  drawTo(p, n, p1) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      const c = p1 ? this.drawP1() : this.draw();
      if (c == null) break;
      p.hand.push(c); got++;
      if (this.phaseDrawn) this.phaseDrawn.push(c);
    }
    if (got) this.emit({ fx: 'draw', to: p.id, n: got, from: p1 && this.ev('mine') ? 'pile' : 'deck' });
    return got;
  }
  toPile(c) { this.pile.push(c); }
  fromHand(p, c) { const i = p.hand.indexOf(c); if (i < 0) return false; p.hand.splice(i, 1); return true; }
  fromTable(p, c) { const i = p.table.indexOf(c); if (i < 0) return false; p.table.splice(i, 1); return true; }
  /** 앞에 놓인 카드의 효과 — 올가미면 앞에 놓인 카드는 효과가 없다 */
  has(p, k) { return p.table.find(c => this.C(c).k === k); }
  on(p, k) { return !this.ev('lasso') && this.has(p, k); }
  isK(c, k) { return this.C(c).k === k; }

  /** 사거리 = 무기(없으면 콜트 45 · 1) */
  range(p) { if (this.ev('lasso')) return 1; const w = p.table.find(c => WEAPONS.includes(this.C(c).k)); return w ? KINDS[this.C(w).k].range : 1; }
  /** a 가 b 를 볼 때의 거리. 매복이면 모두 1에서 시작한다 */
  dist(a, b) {
    if (a === b) return 0;
    const live = this.alive();
    const ia = live.indexOf(a), ib = live.indexOf(b);
    if (ia < 0 || ib < 0) return 99;
    const d0 = Math.abs(ia - ib);
    let d = this.ev('ambush') ? 1 : Math.min(d0, live.length - d0);
    if (this.on(b, 'mustang')) d++;
    if (this.ab(b, 'paul')) d++;
    if (this.on(a, 'scope')) d--;
    if (this.ab(a, 'rose')) d--;
    return Math.max(1, d);
  }
  /** 다음 사람(왼쪽 = 시계 방향), 살아 있는 사람만 — 카드 효과는 늘 시계 방향 */
  next(p) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) { const q = this.players[(p.seat + k) % n]; if (q.alive) return q; }
    return p;
  }
  /** p 부터 시계 방향으로 다른 사람들 */
  others(p) { const out = []; let q = this.next(p); while (q !== p) { out.push(q); q = this.next(q); } return out; }
  canBeer() { return this.alive().length > 2 && !this.ev('reverend'); }
  bangLimit(p) {
    if (this.ab(p, 'willy') || this.on(p, 'volcanic')) return 99;
    if (this.ev('sermon')) return 0;
    return this.ev('shootout') ? 2 : 1;
  }
  /** 이 사람이 지금 쓰러지면 돌아올 수 있는가(유령 마을 · 죽은 자가 아직 남아 있으면) */
  revivable(p) {
    const pool = [...this.evDeck, this.event];
    return pool.includes('ghosttown') || (pool.includes('deadman') && (this.firstOut == null || this.firstOut === p.id));
  }

  /* ───────────── 요청 · 답 ───────────── */

  *ask(q) {
    // 수지 라파예트는 낸 카드가 다 풀린 뒤에 뽑는다(FAQ Q22) — 그래서 카드와 카드 사이에서만 본다
    if (q.kind === 'play' || q.kind === 'discard') this.suzy();
    q.seq = ++this.seq;
    this.req = q;
    const r = yield q;
    this.req = null;
    return r;
  }

  /** 답 받기. 맞지 않으면 Error 를 던진다(판은 그대로) */
  answer(pid, r) {
    const q = this.req;
    if (!q || this.over) throw new Error('지금은 고를 차례가 아닙니다');
    if (q.to !== pid) throw new Error('지금은 다른 사람 차례입니다');
    if (!r || typeof r !== 'object') throw new Error('잘못된 답');
    this.check(q, r);
    this.step(r);
  }

  step(r) {
    try {
      const x = this.gen.next(r);
      if (x.done && !this.over) this.req = null;
    } catch (e) {
      if (e !== OVER) throw e;
      this.req = null;
    }
  }

  /** 답이 요청에 맞는지 — 화면을 믿지 않는다 */
  check(q, r) {
    const p = this.P(q.to);
    const inHand = c => p.hand.includes(c);
    const bad = m => { throw new Error(m); };
    const two = cs => Array.isArray(cs) && cs.length === 2 && cs[0] !== cs[1] && cs.every(inHand);
    switch (q.kind) {
      case 'play':
        if (r.a === 'end') {
          if (this.mustPlay != null && p.hand.includes(this.mustPlay) && this.moves(p)[this.mustPlay]) bad('서부의 법 — 보여 준 카드를 먼저 내야 합니다');
          return;
        }
        if (r.a === 'sid') {
          if (!this.ab(p, 'sid') || !two(r.cs)) bad('카드 2장을 고르세요');
          if (p.hp >= p.max) bad('생명이 가득합니다');
          return;
        }
        if (r.a !== 'play') bad('잘못된 답');
        { const why = this.whyNot(p, r.c, r.t, r.tc, r.c2); if (why) bad(why); }
        return;
      case 'lucky': if (r.a !== 'pick' || !q.cards.includes(r.c)) bad('두 장 중 하나를 고르세요'); return;
      case 'discard':
        if (r.a === 'cancel') return;
        if (r.a !== 'discard' || !Array.isArray(r.cs) || r.cs.length !== q.n || new Set(r.cs).size !== q.n || !r.cs.every(inHand)) bad(q.n + '장을 골라 버리세요');
        return;
      case 'react':
        if (r.a === 'take') return;
        if (r.a === 'barrel') { if (!q.barrel) bad('쓸 술통이 없습니다'); return; }
        if (r.a !== 'cards' || !Array.isArray(r.cs) || r.cs.length < 1 || r.cs.length > q.need || new Set(r.cs).size !== r.cs.length || !r.cs.every(inHand)) bad('카드 ' + q.need + '장까지 낼 수 있습니다');
        if (!r.cs.every(c => q.ok.includes(this.C(c).k))) bad('그 카드로는 막을 수 없습니다');
        return;
      case 'dying':
        if (r.a === 'die') return;
        if (r.a === 'beer') { if (!inHand(r.c) || !this.isK(r.c, 'beer') || !this.canBeer()) bad('맥주를 낼 수 없습니다'); return; }
        if (r.a === 'sid') { if (!this.ab(p, 'sid') || !two(r.cs)) bad('카드 2장을 고르세요'); return; }
        bad('잘못된 답');
        return;
      case 'store': if (r.a !== 'pick' || !this.store.includes(r.c)) bad('펼친 카드 중에서 고르세요'); return;
      case 'jesse': {
        if (r.a === 'deck') return;
        const t = this.P(r.t);
        if (r.a !== 'from' || !t || !t.alive || t === p || !t.hand.length) bad('손에 카드가 있는 사람을 고르세요');
        return;
      }
      case 'pedro': if (r.a === 'deck' || (r.a === 'discard' && this.pile.length)) return; bad('잘못된 답'); return;
      case 'kit': if (r.a !== 'back' || !q.cards.includes(r.c)) bad('돌려놓을 카드를 고르세요'); return;
      case 'daltons': if (r.a !== 'pick' || !p.table.includes(r.c)) bad('내 앞의 파란 카드를 고르세요'); return;
      case 'blood': {
        if (r.a === 'skip') return;
        const t = this.P(r.t);
        if (r.a !== 'give' || !t || !q.tg.includes(t.id)) bad('생명을 줄 사람을 고르세요');
        return;
      }
      case 'liquor': if (r.a !== 'heal' && r.a !== 'draw') bad('잘못된 답'); return;
      case 'peyote': if (r.a !== 'red' && r.a !== 'black') bad('빨강이나 검정을 고르세요'); return;
      case 'ranch':
        if (r.a === 'skip') return;
        if (r.a !== 'swap' || !Array.isArray(r.cs) || !r.cs.length || new Set(r.cs).size !== r.cs.length || !r.cs.every(inHand)) bad('버릴 카드를 고르세요');
        return;
    }
  }

  /** 이 카드를 지금 낼 수 없는 까닭. 낼 수 있으면 null
   *  tc: 강탈·캣 벌로우의 대상 카드('hand' = 손에서 무작위), 도탄이면 겨냥한 카드
   *  c2: 저격수 — 함께 내는 두 번째 뱅! */
  whyNot(p, c, t, tc, c2) {
    if (!p.hand.includes(c)) return '손에 없는 카드입니다';
    const asBang = x => this.isK(x, 'bang') || (this.isK(x, 'missed') && this.ab(p, 'calamity'));
    let k = this.C(c).k;
    if (k === 'missed' && this.ab(p, 'calamity')) k = 'bang';
    const def = KINDS[k];
    const T = t != null ? this.P(t) : null;
    if (k === 'missed') return '빗나감!은 남의 턴에 막을 때만 냅니다';
    if (k === 'bang') {
      if (c2 != null) {                                    // 저격수: 뱅! 두 장을 함께 — 뱅! 횟수에 들지 않는다
        if (!this.ev('sniper')) return '지금은 뱅! 두 장을 함께 낼 수 없습니다';
        if (c2 === c || !p.hand.includes(c2) || !asBang(c2)) return '함께 낼 뱅!을 고르세요';
        if (!T || !T.alive || T === p) return '대상을 고르세요';
        if (this.dist(p, T) > this.range(p)) return '사거리 밖입니다';
        return null;
      }
      if (tc != null) {                                    // 도탄: 남의 앞에 놓인 카드를 겨냥 — 거리·횟수와 상관없다
        if (!this.ev('ricochet')) return '지금은 카드를 겨냥할 수 없습니다';
        if (!T || !T.alive || T === p || !T.table.includes(tc)) return '겨냥할 카드를 고르세요';
        return null;
      }
      if (this.ev('sermon')) return '설교 — 내 턴에는 뱅!을 쓸 수 없습니다';
      if (this.bangs >= this.bangLimit(p)) return this.ev('shootout') ? '총격전에도 뱅!은 두 장까지입니다' : '뱅!은 한 턴에 한 장만 쏠 수 있습니다';
    }
    if (k === 'beer' && this.ev('reverend')) return '목사 — 맥주를 낼 수 없습니다';
    if (def.blue && this.ev('judge')) return '판사 — 앞에 놓는 카드를 낼 수 없습니다';
    // 맥주는 생명이 가득하거나 두 명만 남아도 낼 수는 있다 — 효과가 없을 뿐(FAQ Q16 · Q25). 화면이 한 번 묻는다
    if (def.blue && k !== 'jail') {
      if (this.has(p, k)) return '같은 카드를 두 장 놓을 수 없습니다';
    }
    if (def.tg) {
      const self = T === p && (k === 'panic' || k === 'catbalou');   // 내 앞의 카드(다이너마이트 등)는 내가 치워도 된다(BGA)
      if (!T || !T.alive || (T === p && !self)) return '대상을 고르세요';
      if (self && (tc === 'hand' || !T.table.includes(tc))) return '내 앞에 놓인 카드만 고를 수 있습니다';
      if (def.tg === 'reach' && this.dist(p, T) > this.range(p)) return '사거리 밖입니다';
      if (def.tg === 'one' && this.dist(p, T) > 1) return '거리 1 안이어야 합니다';
      if (def.tg === 'jail') {
        if (T.role === 'sheriff') return '보안관은 감옥에 넣을 수 없습니다';
        if (this.has(T, 'jail')) return '이미 감옥에 있습니다';
      }
      if (k === 'panic' || k === 'catbalou') {
        if (tc === 'hand') { if (!T.hand.length) return '손에 카드가 없습니다'; }
        else if (!T.table.includes(tc)) return '빼앗을 카드를 고르세요';
      }
    }
    return null;
  }

  /** 지금 낼 수 있는 카드와 대상 — 화면이 밝혀 보여 주고, 봇이 고른다
   *  { [카드]: { tg:[사람]|null, steal?, rico?:[[사람, 카드]], snipe?:[함께 낼 뱅!] } } */
  moves(p) {
    const out = {};
    const asBang = x => this.isK(x, 'bang') || (this.isK(x, 'missed') && this.ab(p, 'calamity'));
    for (const c of p.hand) {
      let k = this.C(c).k;
      if (k === 'missed' && this.ab(p, 'calamity')) k = 'bang';
      const def = KINDS[k];
      if (def.tg) {
        const tg = [];
        const cands = (k === 'panic' || k === 'catbalou') && p.table.length ? [p, ...this.others(p)] : this.others(p);
        for (const T of cands) {
          if (k === 'panic' || k === 'catbalou') {
            if (!this.whyNot(p, c, T.id, 'hand') || T.table.some(x => !this.whyNot(p, c, T.id, x))) tg.push(T.id);
          } else if (!this.whyNot(p, c, T.id)) tg.push(T.id);
        }
        const m = { tg, steal: k === 'panic' || k === 'catbalou' };
        if (k === 'bang' && this.ev('ricochet')) {
          m.rico = [];
          for (const T of this.others(p)) for (const x of T.table) m.rico.push([T.id, x]);
        }
        if (k === 'bang' && this.ev('sniper')) {
          m.snipe = p.hand.filter(x => x !== c && asBang(x));
          m.sniperTg = this.others(p).filter(T => this.dist(p, T) <= this.range(p)).map(T => T.id);
          if (!m.snipe.length || !m.sniperTg.length) { delete m.snipe; delete m.sniperTg; }
        }
        if (tg.length || (m.rico && m.rico.length) || m.snipe) out[c] = m;
      } else if (!this.whyNot(p, c)) out[c] = { tg: null };
    }
    return out;
  }

  /* ───────────── 판 ───────────── */

  *main() {
    const sh = this.P(this.turn);
    this.log(`${this.nm(sh)} 님이 보안관입니다. 보안관부터 시작합니다.`, 'sys');
    let p = sh;
    for (;;) {
      this.turn = p.id;
      yield* this.turnOf(p, false);
      // 복수(Vendetta) — ♥가 나오면 같은 사람이 한 턴 더(이벤트 효과는 건너뛴다)
      while (this.again && p.alive) { this.again = false; this.turn = p.id; this.log(`${this.nm(p)} 님의 복수 — 한 턴 더!`, 'turn'); yield* this.turnOf(p, true); }
      this.again = false;
      this.suzy();
      p = this.nextTurn(p);
      if (p.role === 'sheriff') this.round++;
    }
  }

  /** 다음 차례 — 골드 러시면 한 바퀴 반시계 방향. 쓰러진 사람은 유령 마을·죽은 자일 때만 차례가 온다 */
  nextTurn(p) {
    const n = this.players.length, dir = this.ev('goldrush') ? -1 : 1;
    for (let k = 1; k <= n; k++) {
      const q = this.players[((p.seat + dir * k) % n + n) % n];
      if (q.alive) return q;
      if (q.status === 'down' && (this.ev('ghosttown') || (this.ev('deadman') && q.id === this.firstOut))) return q;
    }
    return p;
  }

  *turnOf(p, extra) {
    this.bangs = 0;
    this.mustPlay = null;
    this.log(`— ${this.nm(p)} 님의 차례 —`, 'turn');
    this.emit({ fx: 'turn', id: p.id });

    /* 보안관 차례마다 이벤트 카드 한 장(두 번째 턴부터) */
    if (!extra && p.role === 'sheriff' && this.round > 1 && this.evDeck.length) yield* this.newEvent();

    /* 쓰러졌던 사람이 돌아온다 */
    if (p.status === 'down') {
      if (this.ev('ghosttown')) {
        p.status = 'ghost'; p.alive = true; p.hp = 0;
        this.log(`👻 ${this.nm(p)} 님이 유령으로 돌아왔습니다! 이번 턴에는 죽지 않고, 턴이 끝나면 다시 쓰러집니다.`, 'sys');
        this.emit({ fx: 'revive', id: p.id, ghost: true });
      } else if (this.ev('deadman') && p.id === this.firstOut) {
        p.status = 'live'; p.alive = true; p.hp = 2;
        this.log(`⚰ 죽은 자 — ${this.nm(p)} 님이 생명 2 · 카드 2장으로 돌아왔습니다!`, 'heal');
        this.emit({ fx: 'revive', id: p.id });
        this.drawTo(p, 2);
      } else return;
    } else if (!extra) {
      yield* this.startOfTurn(p);
      if (!p.alive) return;
    }

    /* 다이너마이트가 먼저, 감옥이 다음. 올가미면 다이너마이트는 뽑지도 않고, 감옥은 뽑아도 효과가 없다 */
    const dyn = this.has(p, 'dynamite');
    if (dyn && !this.ev('lasso')) {
      const boom = yield* this.flip(p, s => !(s.s === 'S' && s.r >= 2 && s.r <= 9), '다이너마이트');
      this.fromTable(p, dyn);
      if (boom === false) {
        this.toPile(dyn);
        this.log(`💥 다이너마이트가 ${this.nm(p)} 님 앞에서 터졌습니다!`, 'hit');
        this.emit({ fx: 'boom', id: p.id });
        yield* this.hurt(p, 3, null);
        if (!p.alive) return;
      } else {
        const q = this.next(p);
        q.table.push(dyn);
        this.log(`다이너마이트가 ${this.nm(q)} 님에게 넘어갑니다.`);
        this.emit({ fx: 'pass', from: p.id, to: q.id, c: dyn });
      }
    }
    const jail = this.has(p, 'jail');
    if (jail) {
      const free = yield* this.flip(p, s => s.s === 'H', '감옥');
      if (this.ev('lasso')) this.log(`올가미 — 감옥은 효과가 없습니다. ${this.nm(p)} 님은 턴을 합니다.`);
      else {
        this.fromTable(p, jail);
        this.toPile(jail);
        if (!free) { this.log(`${this.nm(p)} 님은 감옥에서 턴을 거릅니다.`); this.emit({ fx: 'jailed', id: p.id }); return; }
        this.log(`${this.nm(p)} 님이 감옥에서 풀려났습니다.`);
      }
    }

    /* 1단계 — 뽑기 */
    let skip = false;
    if (this.ev('liquor') && p.status !== 'ghost') {
      const r = yield* this.ask({ to: p.id, kind: 'liquor' });
      if (r.a === 'heal') {
        skip = true;
        if (p.hp < p.max) { p.hp++; this.emit({ fx: 'heal', id: p.id }); }
        this.log(`독한 술 — ${this.nm(p)} 님이 뽑기를 건너뛰고 생명 1을 되찾았습니다.`, 'heal');
      }
    }
    if (!skip && this.ev('peyote') && p.status !== 'ghost') { yield* this.peyote(p); skip = true; }
    if (!skip) {
      this.phaseDrawn = [];
      yield* this.drawPhase(p);
      const shown = this.phaseDrawn[1];
      this.phaseDrawn = null;
      if (this.ev('lawwest') && shown != null && p.hand.includes(shown)) {
        this.mustPlay = shown;
        this.log(`서부의 법 — ${this.nm(p)} 님이 두 번째 장 ${this.cnj(shown, '을', '를')} 보여 줍니다. 낼 수 있으면 꼭 내야 합니다.`);
        this.emit({ fx: 'show', id: p.id, c: shown });
      }
    }
    if (this.ev('ranch') && p.hand.length) {
      const r = yield* this.ask({ to: p.id, kind: 'ranch' });
      if (r.a === 'swap') {
        for (const c of r.cs) { this.fromHand(p, c); this.toPile(c); }
        this.emit({ fx: 'discard', id: p.id, cs: r.cs });
        this.drawTo(p, r.cs.length);
        this.log(`목장 — ${this.nm(p)} 님이 카드 ${r.cs.length}장을 바꿨습니다.`);
      }
    }

    /* 2단계 내기 → 3단계 버리기. 버리기에서 "취소"하면 내기로 돌아간다(BGA 와 같다) */
    for (;;) {
      for (;;) {
        if (!p.alive) return;
        this.suzy();
        if (!p.hand.length) { this.log(`${this.nm(p)} 님은 손에 카드가 없어 턴을 마칩니다.`); break; }
        const r = yield* this.ask({ to: p.id, kind: 'play', moves: this.moves(p) });
        if (r.a === 'end') break;
        if (r.a === 'sid') { yield* this.sidHeal(p, r.cs); continue; }
        if (r.c === this.mustPlay || r.c2 === this.mustPlay) this.mustPlay = null;
        yield* this.play(p, r.c, r.t, r.tc, r.c2);
      }
      if (!p.alive) return;
      this.suzy();
      if (p.status === 'ghost' || p.hand.length <= p.hp) break;
      const n = p.hand.length - p.hp;
      const r = yield* this.ask({ to: p.id, kind: 'discard', n });
      if (r.a === 'cancel') continue;
      if (this.ev('mine')) {
        for (const c of r.cs) { this.fromHand(p, c); this.deck.push(c); }
        this.log(`버려진 광산 — ${this.nm(p)} 님이 카드 ${n}장을 더미 위에 엎어 버렸습니다.`);
        this.emit({ fx: 'discard', id: p.id, cs: r.cs, deck: true });
      } else {
        for (const c of r.cs) { this.fromHand(p, c); this.toPile(c); }
        this.log(`${this.nm(p)} 님이 카드 ${n}장을 버렸습니다.`);
        this.emit({ fx: 'discard', id: p.id, cs: r.cs });
      }
      break;
    }

    /* 턴 끝 */
    if (p.status === 'ghost') { yield* this.unghost(p); return; }
    if (this.ev('vendetta') && !extra && p.alive) {
      if (yield* this.flip(p, s => s.s === 'H', '복수')) this.again = true;
    }
  }

  /** 보안관 차례 맨 처음 — 이벤트 카드를 뒤집는다 */
  *newEvent() {
    this.event = this.evDeck.shift();
    const E = EVENTS[this.event];
    this.log(`📜 이벤트 — ${E.name}: ${E.desc}`, 'event');
    this.emit({ fx: 'event', k: this.event });
    // 이제 돌아올 길이 없는 사람은 완전히 떠난다
    for (const q of this.players) if (q.status === 'down' && !this.revivable(q)) q.status = 'out';
    if (this.event === 'doctor') {
      const live = this.alive().filter(q => q.status !== 'ghost');
      const low = Math.min(...live.map(q => q.hp));
      for (const q of live) if (q.hp === low && q.hp < q.max) { q.hp++; this.emit({ fx: 'heal', id: q.id }); this.log(`의사 — ${this.nm(q)} 님이 생명 1을 되찾았습니다.`, 'heal'); }
    }
    if (this.event === 'daltons') {
      const sh = this.players.find(q => q.role === 'sheriff');
      for (const q of [sh, ...this.others(sh)]) {
        const blues = q.table.filter(c => KINDS[this.C(c).k].blue);
        if (!blues.length) continue;
        const c = blues.length === 1 ? blues[0] : (yield* this.ask({ to: q.id, kind: 'daltons', cards: blues })).c;
        this.fromTable(q, c); this.toPile(c);
        this.log(`달튼 형제 — ${this.nm(q)} 님이 ${this.cnj(c, '을', '를')} 버렸습니다.`);
        this.emit({ fx: 'lose', id: q.id, c });
      }
    }
    if (this.event === 'roulette') {
      const sh = this.players.find(q => q.role === 'sheriff');
      const order = [sh, ...this.others(sh)];
      done: for (let lap = 0; lap < 7; lap++) {
        for (const q of order) {
          if (!q.alive) continue;
          if (!(yield* this.dodge(null, q, 1, 'roulette'))) {
            this.log(`러시안 룰렛 — ${this.nm(q)} 님이 빗나감!을 내지 못해 생명 2를 잃습니다.`, 'hit');
            yield* this.hurt(q, 2, null);
            break done;
          }
        }
      }
    }
  }

  /** 턴 시작 이벤트 — 하이눈(생명 −1), 한 줌의 카드(손 카드 수만큼 뱅!), 피를 나눈 형제 */
  *startOfTurn(p) {
    if (this.ev('highnoon')) {
      this.log(`☀ 하이눈 — ${this.nm(p)} 님이 생명 1을 잃습니다.`, 'hit');
      yield* this.hurt(p, 1, null);
    }
    if (this.ev('fistful')) {
      const n = p.hand.length;
      if (n) this.log(`🃏 한 줌의 카드 — ${this.nm(p)} 님에게 뱅!이 ${n}발 날아옵니다.`, 'atk');
      for (let i = 0; i < n && p.alive; i++) {
        this.emit({ fx: 'shot', from: null, to: p.id });
        if (!(yield* this.dodge(null, p, 1, 'fistful', n - i - 1))) yield* this.hurt(p, 1, null);
      }
    }
    if (this.ev('bloodbros') && p.alive) {
      const tg = this.alive().filter(q => q !== p && q.status !== 'ghost' && q.hp < q.max).map(q => q.id);
      if (p.hp > 1 && tg.length) {
        const r = yield* this.ask({ to: p.id, kind: 'blood', tg });
        if (r.a === 'give') {
          const t = this.P(r.t);
          p.hp--; t.hp = Math.min(t.max, t.hp + 1);
          this.log(`피를 나눈 형제 — ${this.nm(p)} 님이 ${this.nm(t)} 님에게 생명 1을 나눠 줬습니다.`, 'heal');
          this.emit({ fx: 'hurt', id: p.id, n: 1 }); this.emit({ fx: 'heal', id: t.id });
        }
      }
    }
  }

  /** 페요테 — 1단계 대신 빨강/검정을 맞히며 뽑는다. 틀리면 그 카드는 버리고 끝 */
  *peyote(p) {
    for (let i = 0; i < 40; i++) {
      const r = yield* this.ask({ to: p.id, kind: 'peyote' });
      const c = this.draw();
      if (c == null) return;
      const red = this.C(c).s === 'H' || this.C(c).s === 'D';
      const ok = (r.a === 'red') === red;
      this.emit({ fx: 'flip', id: p.id, cs: [c], pick: c, ok, what: '페요테' });
      if (ok) { p.hand.push(c); this.log(`페요테 — ${this.nm(p)} 님이 ${r.a === 'red' ? '빨강' : '검정'}을 맞혀 ${this.cnj(c, '을', '를')} 가졌습니다.`); }
      else { this.toPile(c); this.log(`페요테 — ${this.nm(p)} 님이 틀렸습니다(${this.cn(c)}).`); return; }
    }
  }

  /** 유령의 턴이 끝났다 — 다시 쓰러지고, 이번에는 아주 떠난다 */
  *unghost(p) {
    p.alive = false; p.status = 'out'; p.hp = 0;
    const all = [...p.hand, ...p.table];
    p.hand = []; p.table = [];
    for (const c of all) this.toPile(c);
    this.log(`👻 ${this.nm(p)} 님이 다시 쓰러졌습니다.`, 'die');
    this.emit({ fx: 'die', id: p.id, role: p.role });
    this.win();
  }

  /** "뽑기!" — good(카드 무늬·숫자) 이 참이면 좋은 결과. 럭키 듀크는 두 장을 보고 직접 고른다 */
  *flip(p, good, what) {
    const judge = c => good({ s: this.suitOf(c), r: this.C(c).r });
    const n = this.ab(p, 'lucky') ? 2 : 1;
    const got = [];
    for (let i = 0; i < n; i++) { const c = this.draw(); if (c != null) got.push(c); }
    if (!got.length) return true;
    let pick = got[0];
    if (got.length > 1) {
      this.limbo = [...got];
      const r = yield* this.ask({ to: p.id, kind: 'lucky', cards: [...got], what, good: got.filter(judge) });
      this.limbo = [];
      pick = r.c;
    }
    for (const c of got) this.toPile(c);
    this.pile.splice(this.pile.indexOf(pick), 1); this.pile.push(pick);   // 고른 카드가 맨 위에 보이게
    const ok = judge(pick);
    const why = (this.ev('blessing') || this.ev('curse')) && this.suitOf(pick) !== this.C(pick).s ? ` (${this.evName()} 때문에)` : '';
    this.log(`${this.nm(p)} 님 ${what} 뽑기!: ${got.map(c => this.cn(c)).join(', ')} → ${ok ? '성공' : '실패'}${why}`);
    this.emit({ fx: 'flip', id: p.id, cs: got, pick, ok, what, ov: this.ev('blessing') ? 'H' : this.ev('curse') ? 'S' : null });
    return ok;
  }

  /** 1단계 뽑기. 갈증이면 1장(능력 없이), 열차 도착이면 1장 더, 유령은 3장 */
  *drawPhase(p) {
    if (p.status === 'ghost') return void this.drawTo(p, 3, true);
    if (this.ev('thirst')) return void this.drawTo(p, 1, true);
    const extra = this.ev('train') ? 1 : 0;
    yield* this.drawTwo(p);
    if (extra) this.drawTo(p, extra, true);
  }

  *drawTwo(p) {
    if (this.ab(p, 'jesse') && this.others(p).some(q => q.hand.length)) {
      const r = yield* this.ask({ to: p.id, kind: 'jesse' });
      if (r.a === 'from') {
        const t = this.P(r.t);
        const c = t.hand.splice(Math.floor(this.rng() * t.hand.length), 1)[0];
        p.hand.push(c);
        if (this.phaseDrawn) this.phaseDrawn.push(c);
        this.log(`${this.nm(p)} 님이 ${this.nm(t)} 님의 손에서 1장을 가져왔습니다.`);
        this.emit({ fx: 'steal', from: t.id, to: p.id });
        this.drawTo(p, 1, true);
        return;
      }
    }
    if (this.ab(p, 'pedro') && this.pile.length) {
      const r = yield* this.ask({ to: p.id, kind: 'pedro', top: this.pile[this.pile.length - 1] });
      if (r.a === 'discard') {
        const c = this.pile.pop();
        p.hand.push(c);
        if (this.phaseDrawn) this.phaseDrawn.push(c);
        this.log(`${this.nm(p)} 님이 버린 카드에서 ${this.cnj(c, '을', '를')} 가져왔습니다.`);
        this.emit({ fx: 'draw', to: p.id, n: 1, from: 'pile' });
        this.drawTo(p, 1, true);
        return;
      }
    }
    if (this.ab(p, 'kit')) {
      const three = [];
      for (let i = 0; i < 3; i++) { const c = this.drawP1(); if (c != null) three.push(c); }
      if (three.length === 3) {
        this.limbo = [...three];
        const r = yield* this.ask({ to: p.id, kind: 'kit', cards: three });
        this.limbo = [];
        for (const c of three) if (c !== r.c) { p.hand.push(c); if (this.phaseDrawn) this.phaseDrawn.push(c); }
        this.deck.push(r.c);
        this.log(`${this.nm(p)} 님이 3장을 보고 2장을 골랐습니다.`);
      } else { p.hand.push(...three); if (this.phaseDrawn) this.phaseDrawn.push(...three); }
      this.emit({ fx: 'draw', to: p.id, n: Math.min(2, three.length) });
      return;
    }
    if (this.ab(p, 'blackjack')) {
      this.drawTo(p, 1, true);
      const c = this.drawP1();
      if (c != null) {
        p.hand.push(c);
        if (this.phaseDrawn) this.phaseDrawn.push(c);
        const red = this.suitOf(c) === 'H' || this.suitOf(c) === 'D';
        this.log(`${this.nm(p)} 님이 두 번째 장 ${this.cnj(c, '을', '를')} 보여 줍니다${red ? ' — 1장 더!' : '.'}`);
        this.emit({ fx: 'show', id: p.id, c });
        if (red) this.drawTo(p, 1, true);
      }
      return;
    }
    this.drawTo(p, 2, true);
  }

  *sidHeal(p, cs) {
    for (const c of cs) { this.fromHand(p, c); this.toPile(c); }
    p.hp = Math.min(p.max, p.hp + 1);
    this.log(`${this.nm(p)} 님이 카드 2장을 버리고 생명 1을 되찾았습니다.`, 'heal');
    this.emit({ fx: 'heal', id: p.id });
  }

  /** 카드 내기 */
  *play(p, c, t, tc, c2) {
    this.fromHand(p, c);
    const card = this.C(c);
    let k = card.k;
    if (k === 'missed' && this.ab(p, 'calamity')) k = 'bang';
    const def = KINDS[k];
    const T = t != null ? this.P(t) : null;

    if (def.blue) {
      if (k === 'jail') { T.table.push(c); this.hit_(p, T); this.log(`${this.nm(p)} 님이 ${this.nm(T)} 님을 감옥에 넣었습니다.`); this.emit({ fx: 'equip', id: T.id, c, by: p.id }); return; }
      if (WEAPONS.includes(k)) {
        const old = p.table.find(x => WEAPONS.includes(this.C(x).k));
        if (old) { this.fromTable(p, old); this.toPile(old); }
      }
      p.table.push(c);
      this.log(`${this.nm(p)} 님이 ${this.cnj(c, '을', '를')} 앞에 놓았습니다.`);
      this.emit({ fx: 'equip', id: p.id, c });
      return;
    }

    this.toPile(c);
    if (c2 != null) { this.fromHand(p, c2); this.toPile(c2); }
    this.emit({ fx: 'play', id: p.id, c, to: T ? T.id : null });

    switch (k) {
      case 'bang':
        this.hit_(p, T);
        if (c2 != null) {
          this.log(`🎯 저격수 — ${this.nm(p)} 님이 뱅! 두 장으로 ${this.nm(T)} 님을 노립니다. 빗나감! 2장이 있어야 막습니다.`, 'atk');
          yield* this.shoot(p, T, 2, '저격');
        } else if (tc != null) {
          this.log(`🪃 도탄 — ${this.nm(p)} 님이 ${this.nm(T)} 님의 ${this.cnj(tc, '을', '를')} 겨냥합니다.`, 'atk');
          this.emit({ fx: 'shot', from: p.id, to: T.id });
          if (!(yield* this.dodge(p, T, 1, 'ricochet', 0, tc)) && T.table.includes(tc)) {
            this.fromTable(T, tc); this.toPile(tc);
            this.log(`${this.nm(T)} 님의 ${this.cnj(tc, '이', '가')} 튕겨 나갔습니다.`);
            this.emit({ fx: 'lose', id: T.id, c: tc });
          }
        } else {
          this.bangs++;
          this.log(`${this.nm(p)} 님이 ${this.nm(T)} 님에게 ${this.cn(c)}!`, 'atk');
          yield* this.shoot(p, T, this.ab(p, 'slab') ? 2 : 1, '뱅!');
        }
        break;
      case 'beer':
        if (!this.canBeer() || p.hp >= p.max) { this.log(`${this.nm(p)} 님이 맥주를 마셨지만 아무 효과가 없습니다.`); break; }
        p.hp = Math.min(p.max, p.hp + 1);
        this.log(`${this.nm(p)} 님이 맥주를 마셨습니다.`, 'heal');
        this.emit({ fx: 'heal', id: p.id });
        break;
      case 'saloon':
        this.log(`${this.nm(p)} 님이 주점을 열었습니다. 모두 생명 1을 되찾습니다.`, 'heal');
        for (const q of this.alive()) if (q.hp < q.max && q.status !== 'ghost') { q.hp++; this.emit({ fx: 'heal', id: q.id }); }
        break;
      case 'stagecoach':
        this.log(`${this.nm(p)} 님이 역마차로 2장을 뽑았습니다.`);
        this.drawTo(p, 2);
        break;
      case 'wellsfargo':
        this.log(`${this.nm(p)} 님이 웰스 파고로 3장을 뽑았습니다.`);
        this.drawTo(p, 3);
        break;
      case 'generalstore': {
        const live = [p, ...this.others(p)];
        this.store = [];
        for (let i = 0; i < live.length; i++) { const x = this.draw(); if (x != null) this.store.push(x); }
        this.log(`${this.nm(p)} 님이 잡화점을 열었습니다.`);
        this.emit({ fx: 'store', cs: [...this.store] });
        for (const q of live) {
          if (!this.store.length) break;
          if (!q.alive) continue;
          let pick;
          // 남은 카드가 한 장뿐이거나 모두 같은 종류면 저절로(BGA 기본 설정)
          if (this.store.length === 1 || this.store.every(x => this.C(x).k === this.C(this.store[0]).k)) pick = this.store[0];
          else pick = (yield* this.ask({ to: q.id, kind: 'store', cards: [...this.store] })).c;
          this.store.splice(this.store.indexOf(pick), 1);
          q.hand.push(pick);
          this.log(`${this.nm(q)} 님이 잡화점에서 ${this.cnj(pick, '을', '를')} 가져갔습니다.`);
          this.emit({ fx: 'take', id: q.id, c: pick });
        }
        for (const x of this.store) this.toPile(x);
        this.store = [];
        break;
      }
      case 'panic':
      case 'catbalou': {
        this.hit_(p, T);
        let got;
        if (tc === 'hand') got = T.hand.splice(Math.floor(this.rng() * T.hand.length), 1)[0];
        else { got = tc; this.fromTable(T, tc); }
        if (k === 'panic') {
          p.hand.push(got);
          this.log(`${this.nm(p)} 님이 ${this.nm(T)} 님에게서 ${tc === 'hand' ? '손의 카드 1장을' : this.cnj(got, '을', '를')} 빼앗았습니다.`, 'atk');
          this.emit({ fx: 'steal', from: T.id, to: p.id, c: tc === 'hand' ? null : got });
        } else {
          this.toPile(got);
          this.log(`${this.nm(p)} 님의 캣 벌로우 — ${this.nm(T)} 님이 ${this.cnj(got, '을', '를')} 버렸습니다.`, 'atk');
          this.emit({ fx: 'lose', id: T.id, c: got });
        }
        break;
      }
      case 'gatling':
        this.log(`${this.nm(p)} 님이 기관총을 쏩니다!`, 'atk');
        this.emit({ fx: 'gatling', id: p.id });
        for (const q of this.others(p)) {
          if (!q.alive) continue;
          this.hit_(p, q);
          yield* this.shoot(p, q, 1, '기관총');
          if (!p.alive) return;
        }
        break;
      case 'indians':
        this.log(`${this.nm(p)} 님이 인디언!을 불렀습니다.`, 'atk');
        this.emit({ fx: 'indians', id: p.id });
        for (const q of this.others(p)) {
          if (!q.alive) continue;
          this.hit_(p, q);
          const ok = this.ab(q, 'calamity') ? ['bang', 'missed'] : ['bang'];
          const r = q.hand.length
            ? yield* this.ask({ to: q.id, kind: 'react', why: 'indians', from: p.id, need: 1, ok })
            : { a: 'take' };
          if (r.a === 'cards') { this.spend(q, r.cs); this.log(`${this.nm(q)} 님이 뱅!을 버려 피했습니다.`); }
          else yield* this.hurt(q, 1, p);
          if (!p.alive) return;
        }
        break;
      case 'duel': {
        this.hit_(p, T);
        this.log(`${this.nm(p)} 님이 ${this.nm(T)} 님에게 결투를 신청했습니다!`, 'atk');
        let cur = T, oth = p;
        for (;;) {
          const ok = this.ab(cur, 'calamity') ? ['bang', 'missed'] : ['bang'];
          // 설교 중에는 차례인 사람이 결투에서 뱅!을 낼 수 없어 저절로 진다(BGA)
          const sermon = this.ev('sermon') && cur.id === this.turn;
          if (sermon) this.log(`설교 — ${this.nm(cur)} 님은 자기 턴에 뱅!을 쓸 수 없어 결투에서 집니다.`);
          const r = cur.hand.length && !sermon
            ? yield* this.ask({ to: cur.id, kind: 'react', why: 'duel', from: oth.id, need: 1, ok })
            : { a: 'take' };
          // 결투를 건 사람이 지면 아무도 탓하지 않는다 — 현상금도, 엘 그링고도 없다(FAQ Q21 · Q23)
          if (r.a === 'take') { yield* this.hurt(cur, 1, cur === p ? null : oth); break; }
          this.spend(cur, r.cs);
          this.log(`${this.nm(cur)} 님이 뱅!을 버렸습니다.`);
          [cur, oth] = [oth, cur];
        }
        break;
      }
    }
  }

  spend(p, cs) { for (const c of cs) { this.fromHand(p, c); this.toPile(c); } this.emit({ fx: 'spend', id: p.id, cs }); }

  /** 뱅! · 기관총 한 발 */
  *shoot(src, T, need, what) {
    this.emit({ fx: 'shot', from: src ? src.id : null, to: T.id });
    if (!(yield* this.dodge(src, T, need, what === '뱅!' ? 'bang' : what === '저격' ? 'sniper' : 'gatling'))) yield* this.hurt(T, 1, src);
  }

  /** 빗나감!(과 술통)으로 막아 본다. 막았으면 true.
   *  BGA 처럼 술통은 "술통 쓰기"를 눌러야 뽑는다(공격 하나에 술통 하나당 한 번). 손에 카드가 있으면
   *  막을 카드가 없어도 묻는다 — 바로 맞으면 "빗나감!이 없구나" 하고 손이 드러나기 때문이다. */
  *dodge(src, T, need, why, left = 0, tc = null) {
    const ok = this.ab(T, 'calamity') ? ['missed', 'bang'] : ['missed'];
    let barrels = (this.on(T, 'barrel') ? 1 : 0) + (this.ab(T, 'jourdonnais') ? 1 : 0);
    for (;;) {
      if (!barrels && !T.hand.length) return false;
      const r = yield* this.ask({ to: T.id, kind: 'react', why, from: src ? src.id : null, need, ok, barrel: barrels, left, tc });
      if (r.a === 'barrel') {
        barrels--;
        if (yield* this.flip(T, s => s.s === 'H', '술통')) {
          need--;
          this.log(`술통 성공 — ${this.nm(T)} 님이 술통 뒤로 피했습니다.`);
          this.emit({ fx: 'dodge', id: T.id });
          if (need <= 0) return true;
          this.log(`그래도 빗나감!이 ${need}장 더 필요합니다.`);
        } else this.log('술통 실패!');
        continue;
      }
      if (r.a === 'cards') {
        this.spend(T, r.cs);
        need -= r.cs.length;
        this.log(`${this.nm(T)} 님: 빗나감!`);
        this.emit({ fx: 'dodge', id: T.id });
        if (need <= 0) return true;
        this.log(`하지만 ${this.nm(T)} 님은 빗나감!이 ${need}장 더 필요합니다.`);
        continue;
      }
      return false;
    }
  }

  /** 생명을 잃는다. src 는 그렇게 만든 사람(다이너마이트·이벤트면 null). 유령은 죽지 않는다 */
  *hurt(p, n, src) {
    if (p.status === 'ghost') { this.log(`👻 ${this.nm(p)} 님은 유령이라 다치지 않습니다.`); return; }
    p.hp -= n;
    this.log(`${this.nm(p)} 님이 생명 ${n}을 잃었습니다.`, 'hit');
    this.emit({ fx: 'hurt', id: p.id, n });
    if (p.hp <= 0) {
      yield* this.dying(p, src);
      if (!p.alive) return;
    }
    if (this.ab(p, 'bart')) { this.drawTo(p, n); this.log(`바트 캐시디: 카드 ${n}장을 뽑았습니다.`); }
    if (this.ab(p, 'elgringo') && src && src !== p && src.alive) {
      for (let i = 0; i < n && src.hand.length; i++) {
        const c = src.hand.splice(Math.floor(this.rng() * src.hand.length), 1)[0];
        p.hand.push(c);
        this.emit({ fx: 'steal', from: src.id, to: p.id });
      }
      this.log(`엘 그링고: ${this.nm(src)} 님의 손에서 카드를 가져왔습니다.`);
    }
  }

  *dying(p, src) {
    while (p.hp <= 0) {
      const beers = this.canBeer() ? p.hand.filter(c => this.isK(c, 'beer')) : [];
      const sid = this.ab(p, 'sid') && p.hand.length >= 2;
      if (!beers.length && !sid) {
        if (this.ev('reverend') && p.hand.some(c => this.isK(c, 'beer'))) this.log(`목사 — ${this.nm(p)} 님은 맥주로 버틸 수 없습니다.`);
        break;
      }
      const r = yield* this.ask({ to: p.id, kind: 'dying', need: 1 - p.hp });
      if (r.a === 'die') break;
      if (r.a === 'beer') {
        this.fromHand(p, r.c); this.toPile(r.c); p.hp++;
        this.log(`${this.nm(p)} 님이 맥주로 버텼습니다!`, 'heal');
        this.emit({ fx: 'heal', id: p.id });
      } else if (r.a === 'sid') yield* this.sidHeal(p, r.cs);
    }
    if (p.hp <= 0) yield* this.kill(p, src);
  }

  *kill(p, src) {
    p.alive = false;
    p.hp = 0;
    const back = this.revivable(p);
    if (this.firstOut == null) this.firstOut = p.id;
    p.status = back ? 'down' : 'out';
    this.log(`☠ ${this.nm(p)} 님이 쓰러졌습니다. 정체는 ${roleKo(p.role)}!${back ? ' (이벤트로 돌아올 수도 있습니다)' : ''}`, 'die');
    this.emit({ fx: 'die', id: p.id, role: p.role });
    const all = [...p.table, ...p.hand];
    p.hand = []; p.table = [];
    const vul = this.alive().find(q => this.ab(q, 'vulture'));
    if (vul && all.length) {
      vul.hand.push(...all);
      this.log(`벌처 샘이 ${this.nm(p)} 님의 카드 ${all.length}장을 모두 가져갑니다.`);
      this.emit({ fx: 'steal', from: p.id, to: vul.id, n: all.length });
    } else for (const c of all) this.toPile(c);

    this.win();

    if (src && src.alive && src !== p) {
      if (p.role === 'outlaw') { this.drawTo(src, 3); this.log(`${this.nm(src)} 님이 무법자를 잡아 현상금으로 3장을 뽑습니다.`); }
      if (p.role === 'deputy' && src.role === 'sheriff') {
        for (const c of [...src.hand, ...src.table]) this.toPile(c);
        src.hand = []; src.table = [];
        this.log(`보안관이 부관을 쏘았습니다! 보안관은 가진 카드를 모두 버립니다.`, 'hit');
        this.emit({ fx: 'lose', id: src.id, all: true });
      }
    }
  }

  /** 이긴 편이 정해졌으면 판을 멈춘다 — 쓰러져 돌아올 수 있는 사람은 세지 않는다(BGA) */
  win() {
    const live = this.alive();
    const sh = this.players.find(p => p.role === 'sheriff');
    let team = null;
    if (!sh.alive) team = (live.length === 1 && live[0].role === 'renegade') ? 'renegade' : 'outlaw';
    else if (!live.some(p => p.role === 'outlaw' || p.role === 'renegade')) team = 'sheriff';
    if (!team) return;
    const winners = this.players.filter(p =>
      team === 'sheriff' ? (p.role === 'sheriff' || p.role === 'deputy')
        : team === 'outlaw' ? p.role === 'outlaw' : (p.role === 'renegade' && p.alive)).map(p => p.id);
    this.over = { team, winners };
    this.req = null;
    this.log(team === 'sheriff' ? '⭐ 보안관 편이 이겼습니다!' : team === 'outlaw' ? '💀 무법자들이 이겼습니다!' : '🎭 배신자가 홀로 살아남았습니다!', 'win');
    this.emit({ fx: 'over', team });
    throw OVER;
  }

  /** 수지 라파예트 — 손이 비면 1장 */
  suzy() {
    if (this.over) return;
    for (const p of this.players) if (p.alive && this.ab(p, 'suzy') && !p.hand.length) {
      if (this.drawTo(p, 1)) this.log('수지 라파예트: 손이 비어 1장을 뽑았습니다.');
    }
  }

  /* ───────────── 보여 주기 ───────────── */

  /** 사람마다 보이는 것이 다르다 — 남의 손은 장수만, 역할은 보안관 · 쓰러진 사람 · 나 · 끝난 뒤만 */
  view(pid) {
    const me = this.P(pid);
    const q = this.req;
    const card = c => this.C(c);
    const v = {
      turn: this.turn, round: this.round, deck: this.deck.length,
      pile: this.pile.length ? card(this.pile[this.pile.length - 1]) : null,
      pileN: this.pile.length,
      store: this.store.map(card),
      over: this.over,
      event: this.event, eventNext: this.evDeck[0] || null, eventLeft: this.evDeck.length, events: this.evDeck.length || this.event ? true : false,
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, seat: p.seat, char: p.char, hp: p.hp, max: p.max, alive: p.alive, status: p.status,
        role: (p === me || p.role === 'sheriff' || p.status !== 'live' || this.over) ? p.role : null,
        hand: p.hand.length, table: p.table.map(card),
        range: this.range(p),
        dist: me && me.alive && p.alive ? this.dist(me, p) : null,
      })),
      me: me ? { id: me.id, hand: me.hand.map(card), mustPlay: this.turn === me.id ? this.mustPlay : null } : null,
      req: null,
      bangs: this.bangs, bangLimit: me ? this.bangLimit(me) : 1,
    };
    if (q) {
      v.req = { kind: q.kind, to: q.to, seq: q.seq, why: q.why, from: q.from, need: q.need, n: q.n, left: q.left };
      if (q.tc != null) v.req.tc = card(q.tc);
      if (q.to === pid) {
        if (q.kind === 'play') {
          v.req.moves = q.moves = this.moves(me);
          // 못 내는 카드마다 까닭 — 화면이 눌렀을 때 알려 준다
          v.req.why = {};
          for (const c of me.hand) {
            if (q.moves[c]) continue;
            let w = this.whyNot(me, c);
            if (w === '대상을 고르세요') {
              const ws = this.others(me).map(o => this.whyNot(me, c, o.id, this.isK(c, 'panic') || this.isK(c, 'catbalou') ? 'hand' : undefined)).filter(x => x && x !== '대상을 고르세요');
              w = ws[0] || '낼 수 있는 대상이 없습니다';
              if (w === '손에 카드가 없습니다' || w === '빼앗을 카드를 고르세요') w = '빼앗거나 버리게 할 카드가 있는 사람이 없습니다';
            }
            v.req.why[c] = w;
          }
        }
        if (q.kind === 'react') { v.req.ok = q.ok; v.req.barrel = q.barrel; }
        if (q.kind === 'lucky') { v.req.cards = q.cards.map(card); v.req.what = q.what; }
        if (q.kind === 'store' || q.kind === 'kit' || q.kind === 'daltons') v.req.cards = q.cards.map(card);
        if (q.kind === 'pedro') v.req.top = card(q.top);
        if (q.kind === 'blood') v.req.tg = q.tg;
      }
    }
    return v;
  }
}

/** 조사 — 받침이 있으면 a, 없으면 b */
export function josa(w, a, b) { const ch = String(w).charCodeAt(String(w).length - 1); return (ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28) ? a : b; }

export function roleKo(r) { return { sheriff: '보안관', deputy: '부관', outlaw: '무법자', renegade: '배신자' }[r] || r; }

/** 이벤트 덱 만들기 — BGA: 마지막 카드(하이눈 / 한 줌의 카드)는 맨 아래, 둘 다 쓰면 12장 + 마지막 1장
 *  exp: 'hn' | 'foc' | 'both' | 'either'   revive: 유령 마을 · 죽은 자를 넣는가 */
export function eventDeck(exp, revive, rng = Math.random) {
  if (!exp || exp === 'none') return [];
  const sh = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let sets = exp === 'both' ? ['hn', 'foc'] : exp === 'either' ? [rng() < .5 ? 'hn' : 'foc'] : [exp];
  let cards = Object.keys(EVENTS).filter(k => sets.includes(EVENTS[k].set) && !EVENTS[k].last && (revive || !EVENTS[k].revive));
  sh(cards);
  if (sets.length === 2) cards = cards.slice(0, 12);
  const lasts = Object.keys(EVENTS).filter(k => sets.includes(EVENTS[k].set) && EVENTS[k].last);
  cards.push(lasts[Math.floor(rng() * lasts.length)]);
  return cards;
}
