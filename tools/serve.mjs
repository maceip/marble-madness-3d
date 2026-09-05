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
//   c->s  { type:'state', stage, u,v,z,vu,vv,phase,score,time,progress,fin,deaths }   (≤30 Hz)
//   s->c  { type:'tick', players:[{id,role,name,color,stage,u,v,z,vu,vv,phase,score,progress}] }  (20 Hz)
//   c->s  { type:'bump', targetId, iu, iv }        s->c { type:'bump', from, iu, iv }
//   c->s  { type:'start', stage }                  s->c { type:'start', stage, by }   (2P race start sync)
//   s->c  { type:'joined'|'left', id, role, name }
import http from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync, readdirSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');

if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch {}
} else if (existsSync(path.join(root, '.env'))) {
  const lines = readFileSync(path.join(root, '.env'), 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
  }
}

const PORT = +(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || path.join(root, 'data', 'leaderboard.json');

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
const TWITTER_CALLBACK = process.env.TWITTER_CALLBACK || 'https://marbles.secure.build/callback/twitter';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_CALLBACK = process.env.GITHUB_CALLBACK || 'https://marbles.secure.build/callback/github';
/** custom scheme the Android host registers (see tiny-apk-haptics/): <scheme>://oauth-callback */
const APP_SCHEME = process.env.APP_SCHEME || 'marbles';
/** telemetry: JSONL file of installs / crashes / events; installs are only counted with a valid app proof */
const TELEMETRY_FILE = process.env.TELEMETRY_FILE || path.join(root, 'data', 'telemetry.jsonl');
const SHARE_DIR = process.env.SHARE_DIR || path.join(path.dirname(LEADERBOARD_FILE), 'shares');
const SHARE_PENDING_TTL_MS = Math.max(60_000, +(process.env.SHARE_PENDING_TTL_MS || 12 * 60 * 60 * 1000));
const SHARE_MAX_PENDING = Math.max(1, +(process.env.SHARE_MAX_PENDING || 12));
const SHARE_MAX_PENDING_BYTES = Math.max(1024 * 1024, +(process.env.SHARE_MAX_PENDING_BYTES || 96 * 1024 * 1024));
const SHARE_MAX_RENDERED = Math.max(1, +(process.env.SHARE_MAX_RENDERED || 250));
/** sha256 (hex, no colons) of the APK signing certificate(s); Play's app-signing cert for store builds */
const APK_CERT_SHA256 = (process.env.APK_CERT_SHA256 || '').toLowerCase().split(',').map((x) => x.replace(/:/g, '').trim()).filter(Boolean);
const installNonces = new Map();          // nonce -> expiry (single use, 60 s)
const telemetryTimes = new Map();         // ip -> [timestamps] for rate limiting
function mintInstallNonce() {
  const now = Date.now();
  for (const [k, exp] of installNonces) if (exp < now) installNonces.delete(k);
  const n = crypto.randomBytes(16).toString('base64url');
  installNonces.set(n, now + 60_000);
  return n;
}
function telemetryAppend(obj) {
  try { appendFileSync(TELEMETRY_FILE, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); } catch (e) { console.warn('[serve] telemetry write failed', e.message); }
}
function telemetryAllowed(ip, perMinute) {
  const now = Date.now(); const arr = (telemetryTimes.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= perMinute) { telemetryTimes.set(ip, arr); return false; }
  arr.push(now); telemetryTimes.set(ip, arr); return true;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { req.destroy(); reject(new Error('too large')); } });
    req.on('end', () => resolve(body)); req.on('error', reject);
  });
}
function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) { failed = true; reject(new Error('too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** The Android app starts a login as /auth/<provider>?app=<nonce>; the nonce rides along in the state cookie. */
function appNonce(url) { const a = url.searchParams.get('app') || ''; return /^[A-Za-z0-9_-]{8,64}$/.test(a) ? a : ''; }
/** Finish an OAuth flow. Web callers go back to the game page; app callers (nonce set) get a page that jumps to
 *  <scheme>://oauth-callback?user=..&provider=..&state=<nonce>  (or &error=..) and offers a link if the jump is blocked. */
function authExit(res, { app = '', handle = '', provider = '', error = '', clear = '' }) {
  const headers = {};
  const cookies = [];
  if (handle) cookies.push(`mm_user=${encodeURIComponent(handle)}; Path=/; Max-Age=2592000; SameSite=Lax`);
  if (clear) cookies.push(`${clear}=; Path=/; Max-Age=0; HttpOnly`);
  if (cookies.length) headers['Set-Cookie'] = cookies;
  if (!app) {
    headers['Location'] = error ? `/?auth_error=${encodeURIComponent(error)}` : `/?user=${encodeURIComponent(handle)}`;
    res.writeHead(302, headers); res.end(); return;
  }
  const q = new URLSearchParams({ state: app, provider });
  if (error) q.set('error', error); else q.set('user', handle);
  const target = `${APP_SCHEME}://oauth-callback?${q}`;
  const safe = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  headers['Content-Type'] = 'text/html; charset=utf-8'; headers['Cache-Control'] = 'no-store'; headers['Referrer-Policy'] = 'no-referrer';
  res.writeHead(200, headers);
  res.end(`<!doctype html><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="0;url=${safe}"><body style="background:#000;color:#cfd2ff;font-family:'Courier New',monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><a href="${safe}" style="color:#79a8ff;font-size:18px">Return to Marble Madness</a><script>location.replace(${JSON.stringify(target)})</script></body>`);
}

/** Fetch the signed-in user's profile once the token is in hand. One retry for transient failures; never invents a
 *  name: a missing username becomes an auth error the client shows (profile_<status>) instead of a bogus "@PLAYER"
 *  handle that used to be written into the 30-day mm_user cookie. Quota / auth failures are logged, not retried. */
async function fetchProfile(provider, url, headers) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, { headers });
      const text = await r.text();
      let body = null; try { body = JSON.parse(text); } catch { /* HTML error page */ }
      const username = provider === 'twitter' ? body?.data?.username : body?.login;
      if (r.ok && username) return { username: String(username) };
      last = r.status;
      console.warn(`[serve] ${provider} profile lookup failed (attempt ${attempt}): HTTP ${r.status} ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
      if (r.status === 429 || r.status === 401 || r.status === 403) break;   // retrying only burns quota
    } catch (err) {
      last = 0;
      console.warn(`[serve] ${provider} profile lookup threw (attempt ${attempt}):`, err);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { error: `profile_${last || 'error'}` };
}
/** a handle the old fallback could have written into the cookie; never trust it */
function bogusHandle(h) { return !h || /^@?player$/i.test(h); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.css': 'text/css', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webm': 'video/webm', '.bin': 'application/octet-stream', '.txt': 'text/plain',
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
  const name = String(p.name || 'ACE').trim().slice(0, 16) || 'ACE';
  const score = Math.max(0, Math.min(9_999_999, Math.floor(+p.score || 0)));
  const intel = (p.intelligence === 'AI' || p.intelligence === 'Artificial') ? 'Artificial' : 'Natural';
  const entry = {
    name, score,
    intelligence: intel,
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
function cacheFor(ext) {
  if (ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.map') return 'no-cache';
  // no immutable / no CDN: stage art is still moving, and hashed filenames are not wired up
  if (ext === '.png' || ext === '.jpg' || ext === '.mp3' || ext === '.wav' || ext === '.json') return 'public, max-age=3600';
  return 'public, max-age=300';
}

/** Safari / iOS HTMLAudio sends Range: bytes=0-1 first; a 200-only server can leave BGM silent. */
function serveFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const st = statSync(filePath);
  const ctype = path.basename(filePath) === 'apple-app-site-association'
    ? 'application/json'
    : MIME[ext] || 'application/octet-stream';
  const cache = cacheFor(ext);
  const range = req.headers.range;
  if (typeof range === 'string') {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (m) {
      let start = m[1] ? +m[1] : 0;
      let end = m[2] ? +m[2] : st.size - 1;
      if (start >= st.size || end >= st.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': ctype,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': cache,
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': ctype,
    'Content-Length': st.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
  });
  createReadStream(filePath).pipe(res);
}
function serveIndex(req, res, lobbyFromPath) {
  const cookies = parseCookies(req);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let lobby = lobbyFromPath || cookies.mm_lobby;
  let user = url.searchParams.get('user') || cookies.mm_user || null;
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (!lobby || !/^[0-9a-f-]{36}$/i.test(lobby)) {
    lobby = crypto.randomUUID();
  }
  const setCookies = [];
  // a "@PLAYER" left behind by the old profile-lookup fallback is not a login: drop it and expire the cookie
  if (user && bogusHandle(user)) { user = null; setCookies.push('mm_user=; Path=/; Max-Age=0; SameSite=Lax'); }
  // every served page gets a session cookie (including agent /<uuid> pages) so telemetry beacons are accepted;
  // without it the agent's page 403s on /api/telemetry/event and logs a console error in its embedded browser.
  setCookies.push(`mm_lobby=${lobby}; Path=/; Max-Age=86400; SameSite=Lax`);
  if (user && url.searchParams.get('user')) setCookies.push(`mm_user=${encodeURIComponent(user)}; Path=/; Max-Age=2592000; SameSite=Lax`);
  if (setCookies.length) headers['Set-Cookie'] = setCookies;
  let html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const origin = PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const mm = JSON.stringify({ lobby, fromPath: !!lobbyFromPath, publicOrigin: origin, user, nonce: mintInstallNonce() });
  // inline script for the fast path, plus a <meta> copy: a Content-Security-Policy at the edge can block the inline
  // script (production did), and then the client must still learn its lobby / agent role
  // The module reads this before boot. Keep configuration in one CSP-safe
  // channel; the former inline window.__MM__ assignment was blocked by the
  // production script-src policy and duplicated the same data.
  html = html.replace('</head>', `<meta name="mm-config" content="${mm.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></head>`);
  res.writeHead(200, headers);
  res.end(html);
}

function sharePath(id, name) { return path.join(SHARE_DIR, id, name); }
function shareMeta(id) {
  try { return JSON.parse(readFileSync(sharePath(id, 'meta.json'), 'utf8')); } catch { return null; }
}
function removeShare(id, reason) {
  if (!/^[0-9a-f]{32}$/.test(id)) return false;
  for (const name of ['source.webm', 'moment.gif', 'title.ppm', 'meta.json']) {
    try { unlinkSync(sharePath(id, name)); } catch { /* absent */ }
  }
  try { rmdirSync(sharePath(id, '')); }
  catch { return false; }
  console.log(`[share prune] ${id} ${reason}`);
  return true;
}
function pruneShares(now = Date.now()) {
  mkdirSync(SHARE_DIR, { recursive: true });
  const records = [];
  for (const entry of readdirSync(SHARE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name)) continue;
    const meta = shareMeta(entry.name);
    if (!meta) continue;
    const created = Date.parse(meta.createdAt || '') || 0;
    const source = sharePath(entry.name, 'source.webm');
    const gif = sharePath(entry.name, 'moment.gif');
    records.push({ id: entry.name, meta, created, sourceBytes: existsSync(source) ? statSync(source).size : 0, hasGif: existsSync(gif) });
  }

  // Full-race sources are private review scratch space, not an archive. Expire
  // abandoned or declined reviews and bound both count and total bytes.
  for (const record of records) {
    if (!record.meta.rendered && (record.meta.reviewed || !record.sourceBytes || now - record.created > SHARE_PENDING_TTL_MS)) {
      removeShare(record.id, record.meta.reviewed ? 'review complete' : 'pending review expired');
      record.removed = true;
    }
  }
  const pending = records.filter((r) => !r.removed && !r.meta.rendered && r.sourceBytes).sort((a, b) => a.created - b.created);
  let pendingBytes = pending.reduce((sum, r) => sum + r.sourceBytes, 0);
  while (pending.length > SHARE_MAX_PENDING || pendingBytes > SHARE_MAX_PENDING_BYTES) {
    const record = pending.shift();
    if (!record) break;
    if (removeShare(record.id, 'pending review quota')) pendingBytes -= record.sourceBytes;
  }

  // Public cards are intentionally durable, but a runaway agent cannot fill
  // the host forever. Only the oldest cards past the generous cap are removed.
  const rendered = records.filter((r) => !r.removed && r.meta.rendered && r.hasGif).sort((a, b) => b.created - a.created);
  for (const record of rendered.slice(SHARE_MAX_RENDERED)) removeShare(record.id, 'rendered card quota');
}
function safeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function runFfmpeg(args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => { if (err.length < 24_000) err += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-2000)}`));
    });
  });
}

async function renderShareGif(id, start, end) {
  const input = sharePath(id, 'source.webm');
  const output = sharePath(id, 'moment.gif');
  const title = sharePath(id, 'title.ppm');
  writeShareTitle(title);
  // Ten frames per second still reads as fluid for the deliberately chunky
  // arcade art while avoiding a large amount of redundant GIF data. A
  // 64-colour adaptive palette preserves the source game's constrained colour
  // language and was materially smaller than the previous 96-colour encode.
  const graph = `[0:v]fps=10[title];[1:v]fps=10,scale=480:400:force_original_aspect_ratio=decrease,pad=480:400:(ow-iw)/2:(oh-ih)/2:black[clip];[title][clip]concat=n=2:v=1:a=0,split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3[out]`;
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-framerate', '10', '-t', '0.9', '-i', title,
    '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', input,
    '-filter_complex', graph, '-map', '[out]', '-loop', '0', output,
  ]);
  return output;
}

pruneShares();
setInterval(() => {
  try { pruneShares(); } catch (error) { console.warn('[share prune]', error instanceof Error ? error.message : error); }
}, 60 * 60 * 1000).unref();

const SHARE_FONT = {
  A:'01110/10001/10001/11111/10001/10001/10001', B:'11110/10001/10001/11110/10001/10001/11110',
  C:'01111/10000/10000/10000/10000/10000/01111', D:'11110/10001/10001/10001/10001/10001/11110',
  E:'11111/10000/10000/11110/10000/10000/11111', G:'01111/10000/10000/10111/10001/10001/01110',
  H:'10001/10001/10001/11111/10001/10001/10001', I:'11111/00100/00100/00100/00100/00100/11111',
  L:'10000/10000/10000/10000/10000/10000/11111', M:'10001/11011/10101/10101/10001/10001/10001',
  N:'10001/11001/11001/10101/10011/10011/10001', R:'11110/10001/10001/11110/10100/10010/10001',
  S:'01111/10000/10000/01110/00001/00001/11110', T:'11111/00100/00100/00100/00100/00100/00100',
  U:'10001/10001/10001/10001/10001/10001/01110', V:'10001/10001/10001/10001/10001/01010/00100',
  '.':'00000/00000/00000/00000/00000/00110/00110', ' ':'00000/00000/00000/00000/00000/00000/00000',
};
function writeShareTitle(file) {
  const width = 480, height = 400, pixels = Buffer.alloc(width * height * 3);
  const rect = (x, y, w, h, color) => {
    for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
      const i = (yy * width + xx) * 3; pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2];
    }
  };
  rect(24, 74, 432, 160, [4, 8, 20]);
  rect(24, 74, 432, 5, [85, 221, 255]); rect(24, 229, 432, 5, [30, 70, 170]);
  const text = (value, y, scale, color) => {
    const advance = 6 * scale; const x0 = Math.round((width - (value.length * advance - scale)) / 2);
    for (let n = 0; n < value.length; n++) {
      const rows = (SHARE_FONT[value[n].toUpperCase()] || SHARE_FONT[' ']).split('/');
      rows.forEach((row, ry) => [...row].forEach((bit, rx) => { if (bit === '1') rect(x0 + n * advance + rx * scale, y + ry * scale, scale, scale, color); }));
    }
  };
  text('MARBLE MADNESS', 104, 5, [85, 221, 255]);
  text('HUMANS VS AGENTS', 164, 4, [255, 217, 35]);
  text('MARBLES.SECURE.BUILD', 330, 3, [255, 255, 255]);
  writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]), { mode: 0o640 });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  try {
    if (p === '/api/shares/candidate' && req.method === 'POST') {
      try { pruneShares(); } catch (error) { console.warn('[share prune]', error instanceof Error ? error.message : error); }
      const cookies = parseCookies(req);
      if (!cookies.mm_lobby || !/^[0-9a-f-]{36}$/i.test(cookies.mm_lobby)) return sendJson(res, 403, { error: 'active lobby required' });
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
      if (!telemetryAllowed('share:' + ip, 8)) return sendJson(res, 429, { error: 'slow down' });
      let bytes;
      try { bytes = await readBinary(req, 16 * 1024 * 1024); } catch { return sendJson(res, 413, { error: 'recording too large' }); }
      if (bytes.length < 64 || !/^video\/webm(?:;|$)/i.test(String(req.headers['content-type'] || ''))) return sendJson(res, 400, { error: 'video/webm required' });
      const raceId = String(url.searchParams.get('race') || '').slice(0, 64);
      const duration = Math.max(0, Math.min(900, Number(url.searchParams.get('duration')) || 0));
      if (!raceId) return sendJson(res, 400, { error: 'race id required' });
      const id = crypto.randomBytes(16).toString('hex');
      mkdirSync(sharePath(id, ''), { recursive: true });
      writeFileSync(sharePath(id, 'source.webm'), bytes, { mode: 0o640 });
      const meta = {
        id, raceId, lobby: cookies.mm_lobby.toLowerCase(), duration,
        reason: String(url.searchParams.get('reason') || '2P race complete').slice(0, 180),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SHARE_PENDING_TTL_MS).toISOString(),
        rendered: false,
      };
      writeFileSync(sharePath(id, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o640 });
      // Include the newly written candidate in the quota calculation. Pruning
      // only before upload permits the store to sit one item over its cap.
      try { pruneShares(); } catch (error) { console.warn('[share prune]', error instanceof Error ? error.message : error); }
      const origin = PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      return sendJson(res, 201, {
        ok: true, id, duration, reason: meta.reason, expiresAt: meta.expiresAt,
        previewUrl: `${origin}/media/shares/${id}/source.webm`,
        cardUrl: `${origin}/share/${id}`,
      });
    }
    const shareApi = p.match(/^\/api\/shares\/([0-9a-f]{32})(?:\/render)?$/);
    if (shareApi) {
      const id = shareApi[1]; const meta = shareMeta(id);
      if (!meta) return sendJson(res, 404, { error: 'unknown share' });
      const cookies = parseCookies(req);
      if (cookies.mm_lobby?.toLowerCase() !== meta.lobby) return sendJson(res, 403, { error: 'lobby mismatch' });
      if (p.endsWith('/render') && req.method === 'POST') {
        let input;
        try { input = JSON.parse((await readBody(req, 4096)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
        if (input.worthSharing !== true) {
          meta.reviewed = true; meta.worthSharing = false; meta.reviewedAt = new Date().toISOString();
          try { unlinkSync(sharePath(id, 'source.webm')); } catch { /* already gone */ }
          writeFileSync(sharePath(id, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o640 });
          return sendJson(res, 200, { ok: true, shared: false, note: 'candidate declined; full-race recording deleted' });
        }
        if (meta.rendered && existsSync(sharePath(id, 'moment.gif'))) {
          const origin = PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
          return sendJson(res, 200, {
            ok: true, shared: true, reused: true, where: meta.where,
            gifUrl: `${origin}/media/shares/${id}/moment.gif`, cardUrl: `${origin}/share/${id}`,
            note: 'Share card was already rendered; returning the same durable URLs.',
          });
        }
        if (meta.reviewed && meta.worthSharing === false) return sendJson(res, 409, { error: 'candidate was already declined' });
        const start = Number(input.start);
        const end = Number(input.end);
        const duration = Number(meta.duration);
        const where = String(input.where || '').trim();
        if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration)
          || start < 0 || end > duration || end - start < 0.5 || end - start > 8 || !where) {
          return sendJson(res, 400, { error: 'clip requires finite in-range start/end (0.5 to 8 seconds) and destination' });
        }
        try { await renderShareGif(id, start, end); }
        catch (error) { console.error('[share render]', error); return sendJson(res, 500, { error: 'GIF render failed' }); }
        Object.assign(meta, {
          reviewed: true, worthSharing: true, rendered: true, start, end,
          where: where.slice(0, 40),
          caption: String(input.caption || '').slice(0, 240), renderedAt: new Date().toISOString(),
        });
        try { unlinkSync(sharePath(id, 'source.webm')); } catch { /* already gone */ }
        try { unlinkSync(sharePath(id, 'title.ppm')); } catch { /* already gone */ }
        writeFileSync(sharePath(id, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o640 });
        const origin = PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        return sendJson(res, 200, {
          ok: true, shared: true, where: meta.where,
          gifUrl: `${origin}/media/shares/${id}/moment.gif`, cardUrl: `${origin}/share/${id}`,
          note: 'Share card is ready. Open the card URL to review it before posting externally.',
        });
      }
      if (req.method === 'GET') return sendJson(res, 200, meta);
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const shareMedia = p.match(/^\/media\/shares\/([0-9a-f]{32})\/(source\.webm|moment\.gif)$/);
    if (shareMedia) {
      if (shareMedia[2] === 'source.webm') {
        const meta = shareMeta(shareMedia[1]); const cookies = parseCookies(req);
        if (!meta || cookies.mm_lobby?.toLowerCase() !== meta.lobby) return sendJson(res, 403, { error: 'lobby mismatch' });
      }
      const f = sharePath(shareMedia[1], shareMedia[2]);
      if (!existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
      return serveFile(req, res, f);
    }
    const shareCard = p.match(/^\/share\/([0-9a-f]{32})\/?$/);
    if (shareCard) {
      const id = shareCard[1]; const meta = shareMeta(id);
      if (!meta) { res.writeHead(404); res.end('not found'); return; }
      const media = meta.rendered
        ? `<img src="/media/shares/${id}/moment.gif" alt="Marble Madness Humans vs Agents magic moment">`
        : `<video src="/media/shares/${id}/source.webm" autoplay muted loop controls playsinline></video>`;
      const caption = meta.caption ? `<p class="caption">${safeHtml(meta.caption)}</p>` : '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
      const origin = PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const image = meta.rendered ? `<meta property="og:image" content="${safeHtml(`${origin}/media/shares/${id}/moment.gif`)}"><meta name="twitter:card" content="summary_large_image">` : '';
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" type="image/png" href="/favicon.png"><title>Marble Madness: Humans vs Agents</title><meta property="og:title" content="Marble Madness: Humans vs Agents"><meta property="og:description" content="A human and an AI settle it with trackballs.">${image}<style>html,body{margin:0;background:#000;color:#fff;font-family:monospace}body{min-height:100vh;min-height:100dvh;display:grid;place-items:center;overflow-x:hidden}.card{box-sizing:border-box;width:min(92vw,540px);text-align:center;border:3px solid #55ddff;background:#050814;padding:18px;box-shadow:8px 8px 0 #162866;transform:translateZ(0)}h1{color:#ffd923;font-size:clamp(18px,5vw,28px);margin:0 0 14px;text-transform:uppercase}img,video{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain;background:#000;image-rendering:pixelated}.caption{color:#cfd2ff}.url{display:block;margin-top:14px;color:#55ddff;font-weight:bold;font-size:clamp(14px,4vw,20px);text-decoration:none}</style></head><body><main class="card"><h1>Humans vs Agents</h1>${media}${caption}<a class="url" href="https://marbles.secure.build/">marbles.secure.build</a></main></body></html>`);
      return;
    }
    if (p === '/' || p === '/index.html') return serveIndex(req, res, null);
    const m = p.match(UUID_RE);
    if (m) return serveIndex(req, res, m[1].toLowerCase());
    if (p === '/api/session') {
      const cookies = parseCookies(req);
      return sendJson(res, 200, { lobbyId: cookies.mm_lobby || null, publicOrigin: PUBLIC_ORIGIN || `http://${req.headers.host}` });
    }
    if (p === '/api/user') {
      const cookies = parseCookies(req);
      return sendJson(res, 200, {
        user: cookies.mm_user && !bogusHandle(cookies.mm_user) ? cookies.mm_user : null,
        twitterConfigured: !!TWITTER_CLIENT_ID,
        githubConfigured: !!GITHUB_CLIENT_ID,
        twitterCallback: TWITTER_CALLBACK,
        githubCallback: GITHUB_CALLBACK,
      });
    }
    if (p === '/auth/twitter' || p === '/login/twitter' || p === '/auth/x' || p === '/login/x') {
      if (!TWITTER_CLIENT_ID) {
        const cookies = parseCookies(req);
        const currentUser = cookies.mm_user ? decodeURIComponent(cookies.mm_user) : '@MACEIP';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Import Twitter / X Username</title>
  <style>
    body { background: #000; color: #cfd2ff; font-family: "Courier New", monospace; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #070918; border: 3px double #79a8ff; padding: 32px 36px; max-width: 460px; text-align: center; box-shadow: 0 0 30px rgba(0,0,0,0.9); }
    h1 { font-size: 22px; color: #ffe019; margin-top: 0; letter-spacing: 1px; }
    p { font-size: 14px; color: #8d95b8; line-height: 1.5; }
    .callback-box { background: #02030a; border: 1px solid #283066; padding: 8px 12px; font-size: 12px; color: #79a8ff; word-break: break-all; margin: 12px 0 20px; }
    input { width: 90%; padding: 12px; font: inherit; font-size: 18px; font-weight: bold; background: #05061a; color: #ffe019; border: 2px solid #79a8ff; border-radius: 4px; text-align: center; margin-bottom: 20px; box-sizing: border-box; }
    button { width: 90%; padding: 14px; font: inherit; font-size: 16px; font-weight: bold; text-transform: uppercase; background: #ffe019; color: #000; border: none; border-radius: 4px; cursor: pointer; transition: background .15s; }
    button:hover { background: #fff176; }
    .cancel { display: inline-block; margin-top: 16px; font-size: 13px; color: #6272a4; text-decoration: none; }
    .cancel:hover { color: #fff; }
    .note { font-size: 11px; color: #505c8a; margin-top: 20px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <h1>𝕏 IMPORT USERNAME</h1>
    <p>Callback URL configured for Twitter OAuth 2.0:</p>
    <div class="callback-box">${TWITTER_CALLBACK}</div>
    <form method="POST" action="/auth/twitter/manual">
      <input type="text" name="handle" value="${currentUser}" placeholder="@username" maxlength="16" autofocus required />
      <button type="submit">SAVE HANDLE & RETURN</button>
    </form>
    <a href="/" class="cancel">&larr; Back to Game</a>
    <div class="note">When TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET are provided, this endpoint automatically redirects through the live Twitter OAuth 2.0 PKCE consent screen.</div>
  </div>
</body>
</html>`);
        return;
      }

      // Live Twitter OAuth 2.0 PKCE Flow
      const state = crypto.randomBytes(16).toString('hex');
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', TWITTER_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', TWITTER_CALLBACK);
      authUrl.searchParams.set('scope', 'users.read tweet.read');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      const app = appNonce(url);
      res.writeHead(302, {
        'Location': authUrl.toString(),
        'Set-Cookie': `mm_oauth_tw=${encodeURIComponent(`${state}:${codeVerifier}${app ? '|' + app : ''}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      });
      res.end();
      return;
    }

    if (p === '/auth/twitter/manual' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2048) req.destroy(); });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        let handle = (params.get('handle') || '').trim();
        if (handle && !handle.startsWith('@')) handle = '@' + handle;
        handle = handle.slice(0, 16) || '@PLAYER';
        res.writeHead(302, {
          'Location': `/?user=${encodeURIComponent(handle)}`,
          'Set-Cookie': `mm_user=${encodeURIComponent(handle)}; Path=/; Max-Age=2592000; SameSite=Lax`,
        });
        res.end();
      });
      return;
    }

    if (p === '/callback/twitter') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const cookies = parseCookies(req);
      const oauthCookie = cookies.mm_oauth_tw ? decodeURIComponent(cookies.mm_oauth_tw) : '';
      const [oauthMain, app = ''] = oauthCookie.split('|');       // "<state>:<verifier>[|<app nonce>]"
      const [savedState, codeVerifier] = oauthMain.split(':');
      if (error || !code) {
        console.warn('[serve] Twitter OAuth callback error or missing code:', error);
        return authExit(res, { app, provider: 'twitter', error: error || 'missing_code', clear: 'mm_oauth_tw' });
      }

      if (!savedState || savedState !== state) {
        console.warn('[serve] Twitter OAuth state mismatch');
        return authExit(res, { app, provider: 'twitter', error: 'state_mismatch', clear: 'mm_oauth_tw' });
      }

      try {
        const tokenParams = new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: TWITTER_CLIENT_ID,
          redirect_uri: TWITTER_CALLBACK,
          code_verifier: codeVerifier,
        });
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (TWITTER_CLIENT_SECRET) {
          headers['Authorization'] = 'Basic ' + Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');
        }
        const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers,
          body: tokenParams.toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
          console.warn('[serve] Twitter token exchange failed:', tokenData);
          return authExit(res, { app, provider: 'twitter', error: 'token_failed', clear: 'mm_oauth_tw' });
        }

        const profile = await fetchProfile('twitter', 'https://api.twitter.com/2/users/me', { 'Authorization': `Bearer ${tokenData.access_token}` });
        if (profile.error) return authExit(res, { app, provider: 'twitter', error: profile.error, clear: 'mm_oauth_tw' });
        const handle = `@${profile.username}`;
        console.log(`[serve] twitter login ok: ${handle}`);

        return authExit(res, { app, provider: 'twitter', handle, clear: 'mm_oauth_tw' });
      } catch (err) {
        console.error('[serve] Twitter callback error:', err);
        return authExit(res, { app, provider: 'twitter', error: 'server_error', clear: 'mm_oauth_tw' });
      }
    }

    if (p === '/auth/github' || p === '/login/github') {
      const state = crypto.randomBytes(16).toString('hex');
      const authUrl = new URL('https://github.com/login/oauth/authorize');
      authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', GITHUB_CALLBACK);
      authUrl.searchParams.set('scope', 'read:user');
      authUrl.searchParams.set('state', state);

      const app = appNonce(url);
      res.writeHead(302, {
        'Location': authUrl.toString(),
        'Set-Cookie': `mm_oauth_gh=${state}${app ? '|' + app : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      });
      res.end();
      return;
    }

    if (p === '/callback/github') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const cookies = parseCookies(req);
      const [savedState = '', app = ''] = (cookies.mm_oauth_gh || '').split('|');   // "<state>[|<app nonce>]"
      if (error || !code) {
        console.warn('[serve] GitHub OAuth callback error or missing code:', error);
        return authExit(res, { app, provider: 'github', error: error || 'missing_code', clear: 'mm_oauth_gh' });
      }

      if (!savedState || savedState !== state) {
        console.warn('[serve] GitHub OAuth state mismatch');
        return authExit(res, { app, provider: 'github', error: 'state_mismatch', clear: 'mm_oauth_gh' });
      }

      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: GITHUB_CALLBACK,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
          console.warn('[serve] GitHub token exchange failed:', tokenData);
          return authExit(res, { app, provider: 'github', error: 'token_failed', clear: 'mm_oauth_gh' });
        }

        const profile = await fetchProfile('github', 'https://api.github.com/user', {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'User-Agent': 'MarbleMadness-Game',
          'Accept': 'application/vnd.github+json',
        });
        if (profile.error) return authExit(res, { app, provider: 'github', error: profile.error, clear: 'mm_oauth_gh' });
        const handle = `@${profile.username}`;
        console.log(`[serve] github login ok: ${handle}`);

        return authExit(res, { app, provider: 'github', handle, clear: 'mm_oauth_gh' });
      } catch (err) {
        console.error('[serve] GitHub callback error:', err);
        return authExit(res, { app, provider: 'github', error: 'server_error', clear: 'mm_oauth_gh' });
      }
    }

    if (p === '/api/user/logout') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `mm_user=; Path=/; Max-Age=0; SameSite=Lax`,
      });
      return res.end(JSON.stringify({ status: 'ok' }));
    }

    // ---- telemetry: only from established page sessions (cookie), never from bare requests
    if (p === '/api/trace' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
      if (!telemetryAllowed('trace:' + ip, 240)) return sendJson(res, 429, { error: 'slow down' });
      let payload; try { payload = JSON.parse((await readBody(req, 16384)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad body' }); }
      const sid = String(payload.sid || '?').slice(0, 12);
      for (const line of (Array.isArray(payload.lines) ? payload.lines : []).slice(0, 80)) console.log(`[trace ${sid}] ${String(line).slice(0, 300)}`);
      return sendJson(res, 200, { ok: true });
    }
    if (p.startsWith('/api/telemetry/')) {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
      if (p === '/api/telemetry/summary' && req.method === 'GET') {
        const sum = { installs: 0, crashes: 0, events: {}, platforms: {}, since: null };
        try {
          for (const line of readFileSync(TELEMETRY_FILE, 'utf8').split('\n')) {
            if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; }
            sum.since = sum.since || r.ts;
            if (r.type === 'install') sum.installs++;
            else if (r.type === 'crash') sum.crashes++;
            else if (r.type === 'event') { sum.events[r.event] = (sum.events[r.event] || 0) + 1; sum.platforms[r.platform] = (sum.platforms[r.platform] || 0) + 1; }
          }
        } catch { /* no file yet */ }
        return sendJson(res, 200, sum);
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const cookies = parseCookies(req);
      if (!cookies.mm_lobby) return sendJson(res, 403, { error: 'no session' });
      if (!telemetryAllowed(ip, p.endsWith('/event') ? 120 : 6)) return sendJson(res, 429, { error: 'slow down' });
      let payload;
      try { payload = JSON.parse((await readBody(req, p.endsWith('/crash') ? 32768 : 4096)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad body' }); }
      if (p === '/api/telemetry/install') {
        const { nonce, proof, device } = payload;
        const exp = installNonces.get(nonce);
        if (!exp || exp < Date.now()) return sendJson(res, 403, { error: 'nonce invalid or expired' });
        installNonces.delete(nonce);
        const ok = APK_CERT_SHA256.some((fp) => crypto.createHash('sha256').update(`${nonce}:${fp}`).digest('hex') === String(proof).toLowerCase());
        if (!ok) { telemetryAppend({ type: 'install_rejected', ip }); return sendJson(res, 403, { error: 'proof rejected' }); }
        telemetryAppend({ type: 'install', platform: 'android_apk', device });
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/telemetry/crash') {
        telemetryAppend({ type: 'crash', platform: 'android_apk', stack: String(payload.stack || '').slice(0, 16000), device: payload.device });
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/telemetry/event') {
        const event = String(payload.event || '').slice(0, 40); if (!/^[a-z_]+$/.test(event)) return sendJson(res, 400, { error: 'bad event' });
        const platform = ['web', 'pwa', 'android_apk'].includes(payload.platform) ? payload.platform : 'web';
        telemetryAppend({ type: 'event', event, platform, meta: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {} });
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: 'unknown telemetry route' });
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
    const f = path.join(www, rel);
    // Public files live under www/. Never fall back to the repository root:
    // that exposed archived pages, TypeScript, tooling, and other build inputs
    // at guessable URLs even though none were referenced by the app.
    if (f.startsWith(www + path.sep) && existsSync(f) && statSync(f).isFile()) return serveFile(req, res, f);
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
    state: { stage: 1, u: 0, v: 0, z: 0, vu: 0, vv: 0, phase: 'alive', score: 0, time: 0, progress: 0, fin: 0, deaths: 0 },
    lastSeen: Date.now(), tokens: 60,
  };
  const lobby = lobbyOf(lobbyId);
  // A challenge is strictly one human and one agent. Replace a stale/reconnecting socket for the same role
  // instead of leaving duplicate marbles that can each start or end the run.
  if (role !== 'multi') {
    for (const [id, existing] of lobby) {
      if (existing.role !== role) continue;
      lobby.delete(id);
      try { existing.ws.close(4001, 'replaced by newer connection'); } catch { /* already gone */ }
    }
  }
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
        for (const k of ['stage', 'u', 'v', 'z', 'vu', 'vv', 'score', 'time', 'progress', 'fin', 'deaths']) if (typeof msg[k] === 'number' && Number.isFinite(msg[k])) s[k] = msg[k];
        if (typeof msg.phase === 'string') s.phase = msg.phase.slice(0, 12);
        break;
      }
      case 'bump': {
        const t = lobby.get(msg.targetId);
        if (t) send(t.ws, { type: 'bump', from: client.id, iu: +msg.iu || 0, iv: +msg.iv || 0 });
        break;
      }
      case 'start':
        if (client.role !== 'human') break;
        broadcast(lobby, {
          type: 'start', stage: Math.max(1, Math.min(6, Math.floor(+msg.stage || 1))),
          raceId: typeof msg.raceId === 'string' ? msg.raceId.slice(0, 64) : '', by: client.id,
        }, client);
        break;
      case 'race_end':
        if (msg.result !== 'finish' && msg.result !== 'timeup') break;
        broadcast(lobby, {
          type: 'race_end',
          raceId: typeof msg.raceId === 'string' ? msg.raceId.slice(0, 64) : '',
          result: msg.result,
          stage: Math.max(1, Math.min(6, Math.floor(+msg.stage || 1))),
          score: Math.max(0, Math.min(999999999, Math.floor(+msg.score || 0))),
          deaths: Math.max(0, Math.min(999, Math.floor(+msg.deaths || 0))),
          by: client.id,
        }, client);
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
