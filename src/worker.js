/**
 * 뱅! — Cloudflare Workers 무료 플랜용 서버.
 *
 *  - 화면 파일(public/)은 정적 자산으로 나간다. 요청 수 한도에 잡히지 않는다.
 *  - /ws 소켓만 Durable Object 하나(main)로 보낸다. 대기방 · 방 · 채팅이 전부 그 안에 산다.
 *    열린 방 목록을 한곳에서 들고 있어야 해서 방마다 객체를 나누지 않았다(허브의 다른 게임과 같다).
 *
 * 돈: 결제 수단을 등록하지 않은 무료 플랜이라 한도를 넘어도 요금이 붙지 않고 그날 요청만 거절된다.
 * 무료 한도는 "객체가 켜져 있는 시간"(하루 13,000 GB·초 ≈ 128MB 객체 28시간)이 먼저 찬다.
 * 객체가 하나뿐이라 하루 종일 켜져 있어도 한도 안이다. 그래도 아무도 없을 때 잠들 수 있게
 *  - 탭은 25초마다 ping, 2분 반 넘게 소식이 없는 소켓은 끊긴 것으로 친다
 *  - 판에 앉아 있지 않은 채 30분 동안 조작이 없으면 소켓을 닫는다(화면은 누르면 다시 붙는다)
 *  - 방도 소켓도 없으면 청소 타이머까지 멈춘다
 */
import { DurableObject } from 'cloudflare:workers';
import { handle, disconnect, sweepRooms, busy, countSockets, rooms } from './hub.js';

const ALIVE_MS = 150_000;
const IDLE_MS = 30 * 60_000;
const SWEEP_MS = 20_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' || url.pathname === '/healthz') {
      return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

class Sock {
  constructor(ws) { this.ws = ws; this.open = true; this.seen = this.acted = Date.now(); }
  get readyState() { return this.open ? 1 : 3; }
  send(text) { if (!this.open) return; try { this.ws.send(text); } catch (_) { this.open = false; } }
  close(code = 1000, reason = '') { if (!this.open) return; this.open = false; try { this.ws.close(code, reason); } catch (_) {} }
}

export class BangHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.socks = new Set();
    this.timer = null;
    countSockets(() => this.socks.size);
  }

  async fetch(req) {
    if (new URL(req.url).pathname === '/healthz') {
      return Response.json({ ok: true, rooms: rooms.size, sockets: this.socks.size });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    if (this.socks.size >= 500) return new Response('busy', { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const s = new Sock(server);
    this.socks.add(s);
    server.addEventListener('message', e => {
      s.seen = Date.now();
      if (typeof e.data !== 'string' || e.data.length > 4000) return;
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (!m || m.t === 'ping') return;
      s.acted = s.seen;
      try { handle(s, m); } catch (err) { console.error('handle', err); }
    });
    const gone = () => {
      if (!this.socks.delete(s)) return;
      s.open = false;
      disconnect(s);
      this.tick();
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }

  tick() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = Date.now();
      for (const s of [...this.socks]) {
        const r = s.roomCode && rooms.get(s.roomCode);
        const playing = r && (r.phase === 'playing' || r.phase === 'intro');
        if (now - s.seen > ALIVE_MS) this.drop(s, 1001, 'gone');
        else if (!playing && now - s.acted > IDLE_MS) { s.send(JSON.stringify({ t: 'idle' })); this.drop(s, 4000, 'idle'); }
      }
      sweepRooms(now);
      if (this.socks.size || busy()) this.tick();
    }, SWEEP_MS);
  }

  /** 서버가 스스로 끊는다 — 사람이 나간 게 아니므로 대기실 자리는 남긴다 */
  drop(s, code, reason) {
    this.socks.delete(s);
    s.close(code, reason);
    disconnect(s, { keepSeat: true });
  }
}
