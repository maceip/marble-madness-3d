// Marble Madness dev/prod server: static files, lobbies over WebSocket, leaderboard API.
//
//   PORT=3000 HOST=0.0.0.0 PUBLIC_ORIGIN=https://marbles.secure.build node tools/serve.mjs
//
// Routes
//   GET  /                     index.html (sets mm_lobby cookie with a fresh lobby id if absent)
//   GET  /<uuid>               index.html for a specific lobby (agents open this)
//   GET  /api/session          { lobbyId, publicOrigin }
//   GET  /api/leaderboard      { top50 }
//   POST /api/leaderboard      { name, score, intelligence, stage, timeRemaining, deaths }
//   GET  /assets/*, /audio/*, /bundle.js, /favicon.png   static from www/
//   WS   /ws?lobby=<id>&role=human|ai|multi
//
// Lobby protocol (JSON):
//   c->s  { type:'join', lobby, role, name, color }
//   s->c  { type:'welcome', id, lobby, role, players:[...] }
//   c->s  { type:'state', stage, u,v,z,vu,vv,phase,score,time,progress }   (≤30 Hz)
//   s->c  { type:'tick', players:[{id,role,name,color,stage,u,v,z,vu,vv,phase,score,progress}] }  (20 Hz)
//   c->s  { type:'bump', targetId, iu, iv }        s->c { type:'bump', from, iu, iv }
//   c->s  { type:'start', stage }                  s->c { type:'start', stage, by }   (2P race start sync)
//   s->c  { type:'joined'|'left', id, role, name }
import http from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');
const PORT = +(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || path.join(root, 'data', 'leaderboard.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.map': 'application/json',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.css': 'text/css', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.txt': 'text/plain',
};

/* ------------------------------------------------------------------------ */
/* leaderboard                                                               */
/* ------------------------------------------------------------------------ */
let leaderboard = [];
try { leaderboard = JSON.parse(readFileSync(LEADERBOARD_FILE, 'utf8')); } catch { leaderboard = []; }
function saveLeaderboard() {
  try { writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2)); } catch (e) { console.warn('[serve] leaderboard write failed', e.message); }
}
function addEntry(p) {
  const name = String(p.name || 'ACE').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 6) || 'ACE';
  const score = Math.max(0, Math.min(9_999_999, Math.floor(+p.score || 0)));
  const entry = {
    name, score,
    intelligence: p.intelligence === 'AI' ? 'AI' : 'NI',
    stage: Math.max(1, Math.min(8, Math.floor(+p.stage || 1))),
    timeRemaining: Math.max(0, Math.min(99, Math.floor(+p.timeRemaining || 0))),
    deaths: Math.max(0, Math.min(999, Math.floor(+p.deaths || 0))),
    date: new Date().toISOString().slice(0, 10),
  };
  leaderboard.push(entry);
  leaderboard.sort((a, b) => b.score - a.score || b.timeRemaining - a.timeRemaining);
  leaderboard = leaderboard.slice(0, 50).map((e, i) => ({ ...e, rank: i + 1 }));
  saveLeaderboard();
  return entry;
}
const postTimes = new Map();

/* ------------------------------------------------------------------------ */
/* http                                                                      */
/* ------------------------------------------------------------------------ */
const UUID_RE = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

function sendJson(res, code, obj, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra });
  res.end(JSON.stringify(obj));
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}
function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const st = statSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
  createReadStream(filePath).pipe(res);
}
function serveIndex(req, res, lobbyFromPath) {
  const cookies = parseCookies(req);
  let lobby = lobbyFromPath || cookies.mm_lobby;
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (!lobby || !/^[0-9a-f-]{36}$/i.test(lobby)) {
    lobby = crypto.randomUUID();
  }
  if (!lobbyFromPath) headers['Set-Cookie'] = `mm_lobby=${lobby}; Path=/; Max-Age=86400; SameSite=Lax`;
  let html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const origin = PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  html = html.replace('</head>', `<script>window.__MM__=${JSON.stringify({ lobby, fromPath: !!lobbyFromPath, publicOrigin: origin })};</script></head>`);
  res.writeHead(200, headers);
  res.end(html);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') return serveIndex(req, res, null);
    const m = p.match(UUID_RE);
    if (m) return serveIndex(req, res, m[1].toLowerCase());
    if (p === '/api/session') {
      const cookies = parseCookies(req);
      return sendJson(res, 200, { lobbyId: cookies.mm_lobby || null, publicOrigin: PUBLIC_ORIGIN || `http://${req.headers.host}` });
    }
    if (p === '/api/leaderboard' && req.method === 'GET') return sendJson(res, 200, { status: 'ok', top50: leaderboard });
    if (p === '/api/leaderboard' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
      const last = postTimes.get(ip) || 0;
      if (Date.now() - last < 3000) return sendJson(res, 429, { error: 'slow down' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (payload.score > 8 * 60000 + 300000) return sendJson(res, 400, { error: 'score outside realistic bounds' });
          postTimes.set(ip, Date.now());
          const entry = addEntry(payload);
          broadcastAll({ type: 'leaderboard', top50: leaderboard.slice(0, 10) });
          return sendJson(res, 200, { status: 'ok', entry, top50: leaderboard });
        } catch { return sendJson(res, 400, { error: 'bad json' }); }
      });
      return;
    }
    // static
    const rel = decodeURIComponent(p).replace(/^\/+/, '');
    const candidates = [path.join(www, rel), path.join(root, rel)];
    for (const f of candidates) {
      if (!f.startsWith(root)) continue;
      if (existsSync(f) && statSync(f).isFile()) return serveFile(res, f);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  } catch (e) {
    console.error('[serve]', e);
    res.writeHead(500); res.end('error');
  }
});

/* ------------------------------------------------------------------------ */
/* lobbies                                                                   */
/* ------------------------------------------------------------------------ */
const wss = new WebSocketServer({ server, path: '/ws' });
const lobbies = new Map(); // id -> Map<clientId, client>
const COLORS = ['#4b6cff', '#ff5a5a', '#5ad25a', '#ffd23f', '#ff8ae2', '#33e0ff', '#ffa84a', '#b58cff'];
let nextNum = 1;

function lobbyOf(id) { let l = lobbies.get(id); if (!l) { l = new Map(); lobbies.set(id, l); } return l; }
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(lobby, obj, except) { for (const c of lobby.values()) if (c !== except) send(c.ws, obj); }
function broadcastAll(obj) { for (const l of lobbies.values()) broadcast(l, obj); }
function publicState(c) {
  return { id: c.id, role: c.role, name: c.name, color: c.color, ...c.state };
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const lobbyId = (url.searchParams.get('lobby') || 'world').toLowerCase().slice(0, 40);
  const role = ['human', 'ai', 'multi'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'human';
  const client = {
    id: 'p_' + crypto.randomBytes(4).toString('hex'), ws, lobbyId, role,
    name: role === 'ai' ? 'AGENT' : `MARBLE ${nextNum++}`, color: COLORS[nextNum % COLORS.length],
    state: { stage: 1, u: 0, v: 0, z: 0, vu: 0, vv: 0, phase: 'alive', score: 0, time: 0, progress: 0 },
    lastSeen: Date.now(), tokens: 60,
  };
  const lobby = lobbyOf(lobbyId);
  lobby.set(client.id, client);
  send(ws, { type: 'welcome', id: client.id, lobby: lobbyId, role, players: [...lobby.values()].filter((c) => c !== client).map(publicState) });
  broadcast(lobby, { type: 'joined', id: client.id, role, name: client.name, color: client.color }, client);
  console.log(`[lobby ${lobbyId}] ${role} joined (${lobby.size} in lobby)`);

  ws.on('message', (data) => {
    client.lastSeen = Date.now();
    client.tokens = Math.min(60, client.tokens + 1.5);
    if (client.tokens < 1) return; client.tokens -= 1;
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg.type) {
      case 'join':
        if (typeof msg.name === 'string') client.name = msg.name.toUpperCase().replace(/[^A-Z0-9 \[\]]/g, '').slice(0, 10) || client.name;
        if (typeof msg.color === 'string' && /^#[0-9a-f]{6}$/i.test(msg.color)) client.color = msg.color;
        broadcast(lobby, { type: 'joined', id: client.id, role: client.role, name: client.name, color: client.color }, client);
        break;
      case 'state': {
        const s = client.state;
        for (const k of ['stage', 'u', 'v', 'z', 'vu', 'vv', 'score', 'time', 'progress']) if (typeof msg[k] === 'number' && Number.isFinite(msg[k])) s[k] = msg[k];
        if (typeof msg.phase === 'string') s.phase = msg.phase.slice(0, 12);
        break;
      }
      case 'bump': {
        const t = lobby.get(msg.targetId);
        if (t) send(t.ws, { type: 'bump', from: client.id, iu: +msg.iu || 0, iv: +msg.iv || 0 });
        break;
      }
      case 'start':
        broadcast(lobby, { type: 'start', stage: +msg.stage || 1, by: client.id }, client);
        break;
      case 'ping': send(ws, { type: 'pong', t: msg.t }); break;
    }
  });
  ws.on('close', () => {
    lobby.delete(client.id);
    broadcast(lobby, { type: 'left', id: client.id, role, name: client.name });
    if (lobby.size === 0 && lobbyId !== 'world') lobbies.delete(lobbyId);
    console.log(`[lobby ${lobbyId}] ${role} left`);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, lobby] of lobbies) {
    for (const c of lobby.values()) if (now - c.lastSeen > 20000) { try { c.ws.terminate(); } catch { /* */ } lobby.delete(c.id); }
    if (lobby.size === 0) { if (id !== 'world') lobbies.delete(id); continue; }
    const players = [...lobby.values()].map(publicState);
    const payload = JSON.stringify({ type: 'tick', players });
    for (const c of lobby.values()) if (c.ws.readyState === 1) c.ws.send(payload);
  }
}, 50);

server.listen(PORT, HOST, () => {
  console.log(`[serve] Marble Madness at http://${HOST}:${PORT}/  (public origin: ${PUBLIC_ORIGIN || 'auto'})`);
});
