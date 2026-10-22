/**
 * 뱅! — 로컬 개발 서버. Cloudflare 없이 node 로 똑같이 돈다.
 *   node server.js            http://localhost:8860
 *   BANG_FAST=1 node server.js   봇이 기다리지 않는다(시험용) — node server.js 8861 fast 도 같다
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Hub } from './src/hub.js';

const PORT = Number(process.argv[2] || process.env.PORT || 8860);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.json': 'application/json' };

const hub = new Hub({ fast: process.env.BANG_FAST === '1' || process.argv[3] === 'fast' });
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/healthz') { res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size })); return; }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  const s = { send: t => ws.readyState === 1 && ws.send(t), close: (c, r) => ws.close(c, r) };
  hub.connect(s);
  ws.on('message', d => { let m; try { m = JSON.parse(String(d)); } catch (_) { return; } if (m && m.t !== 'ping') hub.message(s, m); });
  ws.on('close', () => hub.close(s));
});
setInterval(() => hub.sweep(), 20_000).unref();
server.listen(PORT, () => console.log(`뱅! http://localhost:${PORT}`));
