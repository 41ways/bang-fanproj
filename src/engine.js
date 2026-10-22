/**
 * 뱅! — 규칙 엔진. 서버에서만 돈다. Cloudflare 것이 하나도 안 들어와서 node 로 바로 시험한다.
 *
 * 판의 흐름은 제너레이터 하나(main)다. 누군가 골라야 할 때마다 요청(req)을 하나 내놓고 멈춘다 —
 * 한 번에 요청은 늘 하나. 기관총 · 인디언!도 한 사람씩 차례로 묻는다(BGA 와 같다).
 * answer() 로 답이 오면 그 자리에서 이어서 돈다. 뱅! → 술통 → 빗나감! → 맞음 → 맥주 → 죽음 → 보상처럼
 * 겹겹이 이어지는 효과가 yield* 한 줄씩으로 끝난다.
 *
 * 요청(req) 모양 — 화면은 kind 로 갈래를 고른다
 *   play     내 턴에 카드 내기     답 {a:'play', c, t?, tc?} · {a:'sid', cs:[c,c]} · {a:'end'}
 *   discard  손이 생명보다 많다    답 {a:'discard', cs:[…n장]}
 *   react    뱅!·기관총·인디언!·결투에 맞섬   답 {a:'cards', cs} · {a:'take'}
 *   dying    마지막 생명을 잃음    답 {a:'beer', c} · {a:'sid', cs:[c,c]} · {a:'die'}
 *   store    잡화점에서 고르기     답 {a:'pick', c}
 *   jesse    첫 장을 어디서        답 {a:'deck'} · {a:'from', t}
 *   pedro    첫 장을 어디서        답 {a:'deck'} · {a:'discard'}
 *   kit      3장 중 1장 돌려놓기    답 {a:'back', c}
 */
import { DECK, KINDS, CHARS, ROLES_BY_N, WEAPONS, cardName, cardTag } from '../public/cards.js';

const OVER = Symbol('over');

export class Game {
  /**
   * @param seats [{id, name, bot}] 앉은 순서 = 시계 방향
   * @param opt   { rng, chars: 미리 정한 인물(시험용), roles: 미리 정한 역할(시험용) }
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
      return { id: s.id, name: s.name, bot: !!s.bot, seat: i, role, char: chars[i], hp: max, max, hand: [], table: [], alive: true };
    });
    this.deck = this.shuffle(this.cards.map(c => c.id));
    this.pile = [];             // 버린 카드, 끝이 맨 위
    this.store = [];            // 잡화점에 펼친 카드
    this.limbo = [];            // 럭키 듀크가 고르는 중인 두 장
    this.turn = this.players.find(p => p.role === 'sheriff').id;
    this.bangs = 0;
    this.req = null;
    this.seq = 0;               // 요청 번호 — 늦게 온 답을 가려낸다
    this.over = null;           // { team, winners:[id] }
    this.logs = [];             // 화면의 기록 칸
    this.fx = [];               // 이번 걸음에 생긴 연출거리(화면이 가져가고 비운다)
    this.aggro = {};            // aggro[a][b] = a 가 b 를 공격한 횟수 — 봇이 편을 짐작할 때 쓴다
    this.round = 1;
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
  cn(c) { return cardName(this.C(c)) + ' ' + cardTag(this.C(c)); }
  hit_(a, b) {
    if (!a || !b || a === b) return;
    const m = this.aggro[a.id] || (this.aggro[a.id] = {});
    m[b.id] = (m[b.id] || 0) + 1;
  }

  /** 더미에서 한 장. 비었으면 버린 카드(맨 위 한 장 빼고)를 섞어 새 더미로 */
  draw() {
    if (!this.deck.length) {
      if (this.pile.length <= 1) return null;
      const top = this.pile.pop();
      this.deck = this.shuffle(this.pile);
      this.pile = [top];
      this.log('버린 카드를 섞어 새 더미를 만들었습니다.', 'sys');
      this.emit({ fx: 'reshuffle' });
    }
    return this.deck.pop();
  }
  give(p, c) { if (c != null) p.hand.push(c); }
  drawTo(p, n) { let got = 0; for (let i = 0; i < n; i++) { const c = this.draw(); if (c == null) break; p.hand.push(c); got++; } if (got) this.emit({ fx: 'draw', to: p.id, n: got }); return got; }
  toPile(c) { this.pile.push(c); }
  fromHand(p, c) { const i = p.hand.indexOf(c); if (i < 0) return false; p.hand.splice(i, 1); return true; }
  fromTable(p, c) { const i = p.table.indexOf(c); if (i < 0) return false; p.table.splice(i, 1); return true; }
  has(p, k) { return p.table.find(c => this.C(c).k === k); }
  isK(c, k) { return this.C(c).k === k; }

  /** 사거리 = 무기(없으면 콜트 45 · 1) */
  range(p) { const w = p.table.find(c => WEAPONS.includes(this.C(c).k)); return w ? KINDS[this.C(w).k].range : 1; }
  /** a 가 b 를 볼 때의 거리 */
  dist(a, b) {
    if (a === b) return 0;
    const live = this.alive();
    const ia = live.indexOf(a), ib = live.indexOf(b);
    if (ia < 0 || ib < 0) return 99;
    const d0 = Math.abs(ia - ib);
    let d = Math.min(d0, live.length - d0);
    if (this.has(b, 'mustang')) d++;
    if (b.char === 'paul') d++;
    if (this.has(a, 'scope')) d--;
    if (a.char === 'rose') d--;
    return Math.max(1, d);
  }
  /** 다음 사람(왼쪽 = 시계 방향), 살아 있는 사람만 */
  next(p) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) { const q = this.players[(p.seat + k) % n]; if (q.alive) return q; }
    return p;
  }
  /** p 부터 시계 방향으로 다른 사람들 */
  others(p) { const out = []; let q = this.next(p); while (q !== p) { out.push(q); q = this.next(q); } return out; }
  canBeer() { return this.alive().length > 2; }

  /* ───────────── 요청 · 답 ───────────── */

  *ask(q) {
    this.suzy();
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
    if (q.kind === 'play') {
      if (r.a === 'end') return;
      if (r.a === 'sid') {
        if (p.char !== 'sid' || !Array.isArray(r.cs) || r.cs.length !== 2 || r.cs[0] === r.cs[1] || !r.cs.every(inHand)) bad('카드 2장을 고르세요');
        if (p.hp >= p.max) bad('생명이 가득합니다');
        return;
      }
      if (r.a !== 'play') bad('잘못된 답');
      const why = this.whyNot(p, r.c, r.t, r.tc);
      if (why) bad(why);
      return;
    }
    if (q.kind === 'lucky') { if (r.a !== 'pick' || !q.cards.includes(r.c)) bad('두 장 중 하나를 고르세요'); return; }
    if (q.kind === 'discard') {
      if (r.a === 'cancel') return;
      if (r.a !== 'discard' || !Array.isArray(r.cs) || r.cs.length !== q.n || new Set(r.cs).size !== q.n || !r.cs.every(inHand)) bad(q.n + '장을 골라 버리세요');
      return;
    }
    if (q.kind === 'react') {
      if (r.a === 'take') return;
      if (r.a === 'barrel') { if (!q.barrel) bad('쓸 술통이 없습니다'); return; }
      if (r.a !== 'cards' || !Array.isArray(r.cs) || r.cs.length < 1 || r.cs.length > q.need || new Set(r.cs).size !== r.cs.length || !r.cs.every(inHand)) bad('카드 ' + q.need + '장까지 낼 수 있습니다');
      if (!r.cs.every(c => q.ok.includes(this.C(c).k))) bad('그 카드로는 막을 수 없습니다');
      return;
    }
    if (q.kind === 'dying') {
      if (r.a === 'die') return;
      if (r.a === 'beer') { if (!inHand(r.c) || !this.isK(r.c, 'beer') || !this.canBeer()) bad('맥주가 아닙니다'); return; }
      if (r.a === 'sid') { if (p.char !== 'sid' || !Array.isArray(r.cs) || r.cs.length !== 2 || r.cs[0] === r.cs[1] || !r.cs.every(inHand)) bad('카드 2장을 고르세요'); return; }
      bad('잘못된 답');
    }
    if (q.kind === 'store') { if (r.a !== 'pick' || !this.store.includes(r.c)) bad('펼친 카드 중에서 고르세요'); return; }
    if (q.kind === 'jesse') {
      if (r.a === 'deck') return;
      const t = this.P(r.t);
      if (r.a !== 'from' || !t || !t.alive || t === p || !t.hand.length) bad('손에 카드가 있는 사람을 고르세요');
      return;
    }
    if (q.kind === 'pedro') { if (r.a === 'deck' || (r.a === 'discard' && this.pile.length)) return; bad('잘못된 답'); }
    if (q.kind === 'kit') { if (r.a !== 'back' || !q.cards.includes(r.c)) bad('돌려놓을 카드를 고르세요'); return; }
  }

  /** 이 카드를 지금 낼 수 없는 까닭. 낼 수 있으면 null */
  whyNot(p, c, t, tc) {
    if (!p.hand.includes(c)) return '손에 없는 카드입니다';
    let k = this.C(c).k;
    if (k === 'missed' && p.char === 'calamity') k = 'bang';
    const def = KINDS[k];
    const T = t != null ? this.P(t) : null;
    if (k === 'missed') return '빗나감!은 남의 턴에 막을 때만 냅니다';
    if (k === 'bang') {
      if (this.bangs >= 1 && p.char !== 'willy' && !this.has(p, 'volcanic')) return '뱅!은 한 턴에 한 장만 쏠 수 있습니다';
    }
    // 맥주는 생명이 가득하거나 두 명만 남아도 낼 수는 있다 — 효과가 없을 뿐(FAQ Q16 · Q25). 화면이 한 번 묻는다
    if (def.blue && k !== 'jail') {
      if (this.has(p, k)) return '같은 카드를 두 장 놓을 수 없습니다';
    }
    if (def.tg) {
      if (!T || !T.alive || T === p) return '대상을 고르세요';
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

  /** 지금 낼 수 있는 카드와 대상 — 화면이 밝혀 보여 주고, 봇이 고른다 */
  moves(p) {
    const out = {};
    for (const c of p.hand) {
      let k = this.C(c).k;
      if (k === 'missed' && p.char === 'calamity') k = 'bang';
      const def = KINDS[k];
      if (def.tg) {
        const tg = [];
        for (const T of this.others(p)) {
          if (k === 'panic' || k === 'catbalou') {
            if (!this.whyNot(p, c, T.id, 'hand') || T.table.some(x => !this.whyNot(p, c, T.id, x))) tg.push(T.id);
          } else if (!this.whyNot(p, c, T.id)) tg.push(T.id);
        }
        if (tg.length) out[c] = { tg, steal: k === 'panic' || k === 'catbalou' };
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
      yield* this.turnOf(p);
      this.suzy();
      const n = this.next(p);
      if (n.role === 'sheriff') this.round++;
      p = n;
    }
  }

  *turnOf(p) {
    this.bangs = 0;
    this.log(`— ${this.nm(p)} 님의 차례 —`, 'turn');
    this.emit({ fx: 'turn', id: p.id });

    /* 다이너마이트가 먼저, 감옥이 다음 */
    const dyn = this.has(p, 'dynamite');
    if (dyn) {
      const boom = yield* this.flip(p, c => !(c.s === 'S' && c.r >= 2 && c.r <= 9), '다이너마이트');
      this.fromTable(p, dyn);
      if (boom) {
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
      const free = yield* this.flip(p, c => c.s === 'H', '감옥');
      this.fromTable(p, jail);
      this.toPile(jail);
      if (!free) { this.log(`${this.nm(p)} 님은 감옥에서 턴을 거릅니다.`); this.emit({ fx: 'jailed', id: p.id }); return; }
      this.log(`${this.nm(p)} 님이 감옥에서 풀려났습니다.`);
    }

    yield* this.drawPhase(p);

    /* 내기 → 버리기. 버리기에서 "취소"하면 내기로 돌아간다(BGA 와 같다) */
    for (;;) {
      for (;;) {
        if (!p.alive) return;
        this.suzy();
        if (!p.hand.length) { this.log(`${this.nm(p)} 님은 손에 카드가 없어 턴을 마칩니다.`); break; }
        const r = yield* this.ask({ to: p.id, kind: 'play', moves: this.moves(p) });
        if (r.a === 'end') break;
        if (r.a === 'sid') { yield* this.sidHeal(p, r.cs); continue; }
        yield* this.play(p, r.c, r.t, r.tc);
      }
      if (!p.alive) return;
      this.suzy();
      if (p.hand.length <= p.hp) break;
      const n = p.hand.length - p.hp;
      const r = yield* this.ask({ to: p.id, kind: 'discard', n });
      if (r.a === 'cancel') continue;
      for (const c of r.cs) { this.fromHand(p, c); this.toPile(c); }
      this.log(`${this.nm(p)} 님이 카드 ${n}장을 버렸습니다.`);
      this.emit({ fx: 'discard', id: p.id, cs: r.cs });
      break;
    }
  }

  /** "뽑기!" — good(card) 이 참이면 좋은 결과. 럭키 듀크는 두 장 중 좋은 쪽 */
  *flip(p, good, what) {
    const n = p.char === 'lucky' ? 2 : 1;
    const got = [];
    for (let i = 0; i < n; i++) { const c = this.draw(); if (c != null) got.push(c); }
    if (!got.length) return true;
    let pick = got[0];
    if (got.length > 1) {
      // 럭키 듀크는 두 장을 보고 직접 고른다
      this.limbo = [...got];
      const r = yield* this.ask({ to: p.id, kind: 'lucky', cards: [...got], what, good: got.filter(c => good(this.C(c))) });
      this.limbo = [];
      pick = r.c;
    }
    for (const c of got) this.toPile(c);
    // 고른 카드가 맨 위에 보이게
    this.pile.splice(this.pile.indexOf(pick), 1); this.pile.push(pick);
    const ok = good(this.C(pick));
    this.log(`${this.nm(p)} 님 ${what} 뽑기!: ${got.map(c => this.cn(c)).join(', ')} → ${ok ? '성공' : '실패'}`);
    this.emit({ fx: 'flip', id: p.id, cs: got, pick, ok, what });
    return ok;
  }

  *drawPhase(p) {
    if (p.char === 'jesse' && this.others(p).some(q => q.hand.length)) {
      const r = yield* this.ask({ to: p.id, kind: 'jesse' });
      if (r.a === 'from') {
        const t = this.P(r.t);
        const c = t.hand.splice(Math.floor(this.rng() * t.hand.length), 1)[0];
        p.hand.push(c);
        this.log(`${this.nm(p)} 님이 ${this.nm(t)} 님의 손에서 1장을 가져왔습니다.`);
        this.emit({ fx: 'steal', from: t.id, to: p.id });
        this.drawTo(p, 1);
        return;
      }
    }
    if (p.char === 'pedro' && this.pile.length) {
      const r = yield* this.ask({ to: p.id, kind: 'pedro', top: this.pile[this.pile.length - 1] });
      if (r.a === 'discard') {
        const c = this.pile.pop();
        p.hand.push(c);
        this.log(`${this.nm(p)} 님이 버린 카드에서 ${this.cn(c)}을(를) 가져왔습니다.`);
        this.emit({ fx: 'draw', to: p.id, n: 1, from: 'pile' });
        this.drawTo(p, 1);
        return;
      }
    }
    if (p.char === 'kit') {
      const three = [];
      for (let i = 0; i < 3; i++) { const c = this.draw(); if (c != null) three.push(c); }
      if (three.length === 3) {
        const r = yield* this.ask({ to: p.id, kind: 'kit', cards: three });
        for (const c of three) if (c !== r.c) p.hand.push(c);
        this.deck.push(r.c);
        this.log(`${this.nm(p)} 님이 3장을 보고 2장을 골랐습니다.`);
      } else p.hand.push(...three);
      this.emit({ fx: 'draw', to: p.id, n: Math.min(2, three.length) });
      return;
    }
    if (p.char === 'blackjack') {
      this.drawTo(p, 1);
      const c = this.draw();
      if (c != null) {
        p.hand.push(c);
        const red = this.C(c).s === 'H' || this.C(c).s === 'D';
        this.log(`${this.nm(p)} 님이 두 번째 장 ${this.cn(c)}을(를) 보여 줍니다${red ? ' — 1장 더!' : '.'}`);
        this.emit({ fx: 'show', id: p.id, c });
        if (red) this.drawTo(p, 1);
      }
      return;
    }
    this.drawTo(p, 2);
  }

  *sidHeal(p, cs) {
    for (const c of cs) { this.fromHand(p, c); this.toPile(c); }
    p.hp = Math.min(p.max, p.hp + 1);
    this.log(`${this.nm(p)} 님이 카드 2장을 버리고 생명 1을 되찾았습니다.`, 'heal');
    this.emit({ fx: 'heal', id: p.id });
  }

  /** 카드 내기 */
  *play(p, c, t, tc) {
    this.fromHand(p, c);
    const card = this.C(c);
    let k = card.k;
    if (k === 'missed' && p.char === 'calamity') k = 'bang';
    const def = KINDS[k];
    const T = t != null ? this.P(t) : null;

    if (def.blue) {
      if (k === 'jail') { T.table.push(c); this.hit_(p, T); this.log(`${this.nm(p)} 님이 ${this.nm(T)} 님을 감옥에 넣었습니다.`); this.emit({ fx: 'equip', id: T.id, c, by: p.id }); return; }
      if (WEAPONS.includes(k)) {
        const old = p.table.find(x => WEAPONS.includes(this.C(x).k));
        if (old) { this.fromTable(p, old); this.toPile(old); }
      }
      p.table.push(c);
      this.log(`${this.nm(p)} 님이 ${this.cn(c)}을(를) 앞에 놓았습니다.`);
      this.emit({ fx: 'equip', id: p.id, c });
      return;
    }

    this.toPile(c);
    this.emit({ fx: 'play', id: p.id, c, to: T ? T.id : null });

    switch (k) {
      case 'bang':
        this.bangs++;
        this.hit_(p, T);
        this.log(`${this.nm(p)} 님이 ${this.nm(T)} 님에게 ${this.cn(c)}!`, 'atk');
        yield* this.shoot(p, T, p.char === 'slab' ? 2 : 1, '뱅!');
        break;
      case 'beer':
        if (!this.canBeer() || p.hp >= p.max) { this.log(`${this.nm(p)} 님이 맥주를 마셨지만 아무 효과가 없습니다.`); break; }
        p.hp = Math.min(p.max, p.hp + 1);
        this.log(`${this.nm(p)} 님이 맥주를 마셨습니다.`, 'heal');
        this.emit({ fx: 'heal', id: p.id });
        break;
      case 'saloon':
        this.log(`${this.nm(p)} 님이 주점을 열었습니다. 모두 생명 1을 되찾습니다.`, 'heal');
        for (const q of this.alive()) if (q.hp < q.max) { q.hp++; this.emit({ fx: 'heal', id: q.id }); }
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
          if (this.store.length === 1) pick = this.store[0];
          else pick = (yield* this.ask({ to: q.id, kind: 'store', cards: [...this.store] })).c;
          this.store.splice(this.store.indexOf(pick), 1);
          q.hand.push(pick);
          this.log(`${this.nm(q)} 님이 잡화점에서 ${this.cn(pick)}을(를) 가져갔습니다.`);
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
          this.log(`${this.nm(p)} 님이 ${this.nm(T)} 님에게서 ${tc === 'hand' ? '손의 카드 1장' : this.cn(got)}을(를) 빼앗았습니다.`, 'atk');
          this.emit({ fx: 'steal', from: T.id, to: p.id, c: tc === 'hand' ? null : got });
        } else {
          this.toPile(got);
          this.log(`${this.nm(p)} 님의 캣 벌로우 — ${this.nm(T)} 님이 ${this.cn(got)}을(를) 버렸습니다.`, 'atk');
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
          const ok = q.char === 'calamity' ? ['bang', 'missed'] : ['bang'];
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
          const ok = cur.char === 'calamity' ? ['bang', 'missed'] : ['bang'];
          const r = cur.hand.length
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

  /** 뱅! · 기관총 한 발. need = 막는 데 필요한 빗나감! 수.
   *  BGA 처럼 술통은 "술통 쓰기"를 눌러야 뽑는다(공격 하나에 술통 하나당 한 번). 손에 카드가 있으면
   *  막을 카드가 없어도 묻는다 — 바로 맞으면 "빗나감!이 없구나" 하고 손이 드러나기 때문이다. */
  *shoot(src, T, need, what) {
    this.emit({ fx: 'shot', from: src.id, to: T.id });
    const ok = T.char === 'calamity' ? ['missed', 'bang'] : ['missed'];
    let barrels = (this.has(T, 'barrel') ? 1 : 0) + (T.char === 'jourdonnais' ? 1 : 0);
    for (;;) {
      if (!barrels && !T.hand.length) { yield* this.hurt(T, 1, src); return; }
      const r = yield* this.ask({ to: T.id, kind: 'react', why: what === '뱅!' ? 'bang' : 'gatling', from: src.id, need, ok, barrel: barrels });
      if (r.a === 'barrel') {
        barrels--;
        if (yield* this.flip(T, c => c.s === 'H', '술통')) {
          need--;
          this.log(`술통 성공 — ${this.nm(T)} 님이 술통 뒤로 피했습니다.`);
          this.emit({ fx: 'dodge', id: T.id });
          if (need <= 0) return;
          this.log(`그래도 빗나감!이 ${need}장 더 필요합니다.`);
        } else this.log('술통 실패!');
        continue;
      }
      if (r.a === 'cards') {
        this.spend(T, r.cs);
        need -= r.cs.length;
        this.log(`${this.nm(T)} 님: 빗나감!`);
        this.emit({ fx: 'dodge', id: T.id });
        if (need <= 0) return;
        this.log(`하지만 ${this.nm(T)} 님은 빗나감!이 ${need}장 더 필요합니다.`);
        continue;
      }
      yield* this.hurt(T, 1, src);
      return;
    }
  }

  /** 생명을 잃는다. src 는 그렇게 만든 사람(다이너마이트면 null) */
  *hurt(p, n, src) {
    p.hp -= n;
    this.log(`${this.nm(p)} 님이 생명 ${n}을 잃었습니다.`, 'hit');
    this.emit({ fx: 'hurt', id: p.id, n });
    if (p.hp <= 0) {
      yield* this.dying(p, src);
      if (!p.alive) return;
    }
    if (p.char === 'bart') { this.drawTo(p, n); this.log(`바트 캐시디: 카드 ${n}장을 뽑았습니다.`); }
    if (p.char === 'elgringo' && src && src !== p && src.alive) {
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
      const sid = p.char === 'sid' && p.hand.length >= 2;
      if (!beers.length && !sid) break;
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
    this.log(`☠ ${this.nm(p)} 님이 쓰러졌습니다. 정체는 ${roleKo(p.role)}!`, 'die');
    this.emit({ fx: 'die', id: p.id, role: p.role });
    const all = [...p.hand, ...p.table];
    p.hand = []; p.table = [];
    const vul = this.alive().find(q => q.char === 'vulture');
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

  /** 이긴 편이 정해졌으면 판을 멈춘다 */
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

  /** 수지 라파예트 — 손이 비면 곧바로 1장 */
  suzy() {
    if (this.over) return;
    for (const p of this.players) if (p.alive && p.char === 'suzy' && !p.hand.length) {
      if (this.drawTo(p, 1)) this.log('수지 라파예트: 손이 비어 1장을 뽑았습니다.');
    }
  }

  /* ───────────── 보여 주기 ───────────── */

  /** 사람마다 보이는 것이 다르다 — 남의 손은 장수만, 역할은 보안관 · 죽은 사람 · 나 · 끝난 뒤만 */
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
      players: this.players.map(p => ({
        id: p.id, name: p.name, bot: p.bot, seat: p.seat, char: p.char, hp: p.hp, max: p.max, alive: p.alive,
        role: (p === me || p.role === 'sheriff' || !p.alive || this.over) ? p.role : null,
        hand: p.hand.length, table: p.table.map(card),
        range: this.range(p),
        dist: me && me.alive && p.alive ? this.dist(me, p) : null,
      })),
      me: me ? { id: me.id, hand: me.hand.map(card) } : null,
      req: null,
      bangs: this.bangs,
    };
    if (q) {
      v.req = { kind: q.kind, to: q.to, seq: q.seq, why: q.why, from: q.from, need: q.need, n: q.n };
      if (q.to === pid) {
        if (q.kind === 'play') v.req.moves = q.moves = this.moves(me);
        if (q.kind === 'react') { v.req.ok = q.ok; v.req.barrel = q.barrel; }
        if (q.kind === 'lucky') { v.req.cards = q.cards.map(card); v.req.what = q.what; }
        if (q.kind === 'store') v.req.cards = q.cards.map(card);
        if (q.kind === 'kit') v.req.cards = q.cards.map(card);
        if (q.kind === 'pedro') v.req.top = card(q.top);
      }
    }
    return v;
  }
}

export function roleKo(r) { return { sheriff: '보안관', deputy: '부관', outlaw: '무법자', renegade: '배신자' }[r] || r; }
