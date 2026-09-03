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
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
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
function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const st = statSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': (ext === '.html' || ext === '.js') ? 'no-cache' : 'public, max-age=300' });
  createReadStream(filePath).pipe(res);
}
function serveIndex(req, res, lobbyFromPath) {
  const cookies = parseCookies(req);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let lobby = lobbyFromPath || cookies.mm_lobby;
  const user = url.searchParams.get('user') || cookies.mm_user || null;
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (!lobby || !/^[0-9a-f-]{36}$/i.test(lobby)) {
    lobby = crypto.randomUUID();
  }
  const setCookies = [];
  if (!lobbyFromPath) setCookies.push(`mm_lobby=${lobby}; Path=/; Max-Age=86400; SameSite=Lax`);
  if (url.searchParams.get('user')) setCookies.push(`mm_user=${encodeURIComponent(user)}; Path=/; Max-Age=2592000; SameSite=Lax`);
  if (setCookies.length) headers['Set-Cookie'] = setCookies;
  let html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const origin = PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const mm = JSON.stringify({ lobby, fromPath: !!lobbyFromPath, publicOrigin: origin, user, nonce: mintInstallNonce() });
  // inline script for the fast path, plus a <meta> copy: a Content-Security-Policy at the edge can block the inline
  // script (production did), and then the client must still learn its lobby / agent role
  html = html.replace('</head>', `<meta name="mm-config" content="${mm.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"><script>window.__MM__=${mm};</script></head>`);
  res.writeHead(200, headers);
  res.end(html);
}

const server = http.createServer(async (req, res) => {
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
    if (p === '/api/user') {
      const cookies = parseCookies(req);
      return sendJson(res, 200, {
        user: cookies.mm_user ? decodeURIComponent(cookies.mm_user) : null,
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

        const userRes = await fetch('https://api.twitter.com/2/users/me', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
        });
        const userData = await userRes.json();
        const username = userData.data?.username || 'PLAYER';
        const handle = `@${username}`;

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

        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'User-Agent': 'MarbleMadness-Game',
          },
        });
        const userData = await userRes.json();
        const username = userData.login || 'PLAYER';
        const handle = `@${username}`;

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
    state: { stage: 1, u: 0, v: 0, z: 0, vu: 0, vv: 0, phase: 'alive', score: 0, time: 0, progress: 0, fin: 0, deaths: 0 },
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
