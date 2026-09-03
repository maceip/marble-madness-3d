import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const BUNDLED_LEADERBOARD_FILE = path.join(root, 'data', 'leaderboard.json');
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || BUNDLED_LEADERBOARD_FILE;
const SERVER_SECRET = crypto.randomBytes(32).toString('hex');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/typescript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// =========================================================================
// LEADERBOARD STORE (Top 50 with AI vs Natural Intelligence)
// =========================================================================

let leaderboardCache = [];

function loadLeaderboard() {
  try {
    const sourceFile = fs.existsSync(LEADERBOARD_FILE)
      ? LEADERBOARD_FILE
      : BUNDLED_LEADERBOARD_FILE;
    if (fs.existsSync(sourceFile)) {
      const data = fs.readFileSync(sourceFile, 'utf-8');
      leaderboardCache = JSON.parse(data);
    } else {
      leaderboardCache = [];
    }
  } catch (err) {
    console.warn('[Leaderboard] Failed to load data:', err);
    leaderboardCache = [];
  }
}

function saveLeaderboard() {
  try {
    const dir = path.dirname(LEADERBOARD_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboardCache, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Leaderboard] Failed to save data:', err);
  }
}

loadLeaderboard();

function addLeaderboardEntry(entry) {
  // Sanitize and normalize entry
  const sanitized = {
    name: String(entry.name || 'ANON').slice(0, 16).replace(/[<>&"]/g, ''),
    score: Math.max(0, Math.min(9999999, Math.floor(Number(entry.score) || 0))),
    intelligence: entry.intelligence === 'AI' ? 'AI' : 'NI',
    stage: Math.max(1, Math.min(8, Math.floor(Number(entry.stage) || 1))),
    timeRemaining: Math.max(0, Math.min(500, Math.floor(Number(entry.timeRemaining) || 0))),
    knockouts: Math.max(0, Math.min(100, Math.floor(Number(entry.knockouts) || 0))),
    date: new Date().toISOString().split('T')[0],
  };

  leaderboardCache.push(sanitized);
  // Sort descending by score, then knockouts, then timeRemaining
  leaderboardCache.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.knockouts !== a.knockouts) return b.knockouts - a.knockouts;
    return b.timeRemaining - a.timeRemaining;
  });

  // Keep top 50
  leaderboardCache = leaderboardCache.slice(0, 50).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));

  saveLeaderboard();
  return leaderboardCache;
}

// =========================================================================
// FLOOD PROTECTION & RATE LIMITING
// =========================================================================

const ipConnectionCounts = new Map(); // IP -> { count, resetTime }
const ipSubmissionTimes = new Map(); // IP -> last POST timestamp

function checkIpRateLimit(ip, maxPerMinute = 30) {
  const now = Date.now();
  let record = ipConnectionCounts.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + 60000 };
    ipConnectionCounts.set(ip, record);
    return true;
  }
  record.count++;
  return record.count <= maxPerMinute;
}

function generateSessionToken(ip) {
  const t = Date.now();
  const raw = `${ip}:${t}:${SERVER_SECRET}`;
  const sig = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return `${t}.${sig}`;
}

function verifySessionToken(token, ip) {
  if (!token || typeof token !== 'string') return true; // graceful fallback
  const [tStr, sig] = token.split('.');
  const t = parseInt(tStr, 10);
  if (isNaN(t) || Date.now() - t > 3600000) return false; // 1 hour max age
  const expected = crypto
    .createHash('sha256')
    .update(`${ip}:${t}:${SERVER_SECRET}`)
    .digest('hex')
    .slice(0, 24);
  return sig === expected;
}

// =========================================================================
// HTTP SERVER WITH REST API & ASSET STREAMING
// =========================================================================

const server = http.createServer((req, res) => {
  const clientIp = getClientIp(req);
  let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');

  // 1. Session Token Challenge Endpoint
  if (reqPath === '/api/session-token' && req.method === 'GET') {
    const token = generateSessionToken(clientIp);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ status: 'ok', token }));
    return;
  }

  // 2. Leaderboard GET Endpoint
  if (reqPath === '/api/leaderboard' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({ status: 'ok', top50: leaderboardCache }));
    return;
  }

  // 3. Leaderboard POST Endpoint (With Anti-Cheat Validation)
  if (reqPath === '/api/leaderboard' && req.method === 'POST') {
    // Rate limit submissions per IP (max 1 per 5 seconds)
    const now = Date.now();
    const lastSubmit = ipSubmissionTimes.get(clientIp) || 0;
    if (now - lastSubmit < 5000) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Rate limit exceeded. Please wait.' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8192) req.destroy(); // Flood protection
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        // Anti-cheat verification
        if (!verifySessionToken(payload.token, clientIp)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Invalid session token' }));
          return;
        }

        const score = Number(payload.score) || 0;
        const stage = Number(payload.stage) || 1;

        // Sanity bound checks
        if (score > stage * 45000 + 20000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Score outside realistic bounds' }));
          return;
        }

        ipSubmissionTimes.set(clientIp, now);
        const updated = addLeaderboardEntry(payload);

        // Broadcast leaderboard update to all live players
        broadcast({ type: 'leaderboard_update', leaderboard: updated });

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ status: 'ok', top50: updated }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Malformed JSON payload' }));
      }
    });
    return;
  }

  // 4. Static Files
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(root, reqPath);
  if (!fs.existsSync(filePath)) {
    const wwwPath = path.join(root, 'www', reqPath);
    if (fs.existsSync(wwwPath)) {
      filePath = wwwPath;
    }
  }

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// =========================================================================
// HOSTED MULTIPLAYER SERVER (Shared Level, Real-Time Collisions & Knockouts)
// =========================================================================

const MARBLE_NAMES = [
  'Turbo Roller',
  'Neon Sphere',
  'Cosmic Orb',
  'Frost Marble',
  'Thunder Ball',
  'Emerald Roller',
  'Crimson Runner',
  'Vortex Sphere',
  'Solar Flare',
  'Quantum Marble',
  'Cyber Roller',
  'Apex Marble',
];

const MARBLE_COLORS = [
  '#ff3b5c', // Hot Crimson
  '#33e0ff', // Cool Cyan
  '#ffd23f', // Golden Yellow
  '#b55fe6', // Electric Purple
  '#3bf589', // Neon Mint
  '#ff8833', // Vivid Orange
  '#ff4488', // Magenta
  '#00e5ff', // Aqua Blue
];

const players = new Map();
let nextPlayerNum = 1;

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg, excludeId) {
  const json = JSON.stringify(msg);
  for (const [id, client] of players.entries()) {
    if (id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(json);
    }
  }
}

// 25Hz Server World Tick Loop
const SERVER_TICK_RATE = 25;
const TICK_INTERVAL = 1000 / SERVER_TICK_RATE;

setInterval(() => {
  if (players.size === 0) return;

  const now = Date.now();
  const activePlayersList = [];

  for (const [id, client] of players.entries()) {
    if (now - client.data.lastSeen > 15000 || client.ws.readyState !== WebSocket.OPEN) {
      client.ws.terminate();
      players.delete(id);
      broadcast({ type: 'player_left', id });
      continue;
    }

    activePlayersList.push({
      id: client.data.id,
      name: client.data.name,
      color: client.data.color,
      intelligence: client.data.intelligence,
      stage: client.data.stage,
      x: client.data.x,
      y: client.data.y,
      z: client.data.z,
      vx: client.data.vx,
      vy: client.data.vy,
      vz: client.data.vz,
      rotX: client.data.rotX,
      rotZ: client.data.rotZ,
      speed: client.data.speed,
      score: client.data.score,
    });
  }

  if (activePlayersList.length === 0) return;

  // Stage-partitioned broadcasts: clients only receive coordinates for players on their stage,
  // while receiving global player count. Caches JSON per stage to minimize serialization.
  const stageMap = new Map();
  for (const p of activePlayersList) {
    let list = stageMap.get(p.stage);
    if (!list) {
      list = [];
      stageMap.set(p.stage, list);
    }
    list.push(p);
  }

  const stagePayloadCache = new Map();

  for (const client of players.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      const clientStage = client.data.stage || 1;
      let tickMsg = stagePayloadCache.get(clientStage);
      if (!tickMsg) {
        const stagePlayers = stageMap.get(clientStage) || [];
        tickMsg = JSON.stringify({
          type: 'world_tick',
          t: now,
          stage: clientStage,
          count: activePlayersList.length,
          players: stagePlayers,
        });
        stagePayloadCache.set(clientStage, tickMsg);
      }
      client.ws.send(tickMsg);
    }
  }
}, TICK_INTERVAL);

wss.on('connection', (ws, req) => {
  const clientIp = getClientIp(req);

  // Flood protection: IP rate limiting
  if (!checkIpRateLimit(clientIp, 40)) {
    console.warn(`[Multiplayer] Rate limit exceeded for IP ${clientIp}. Closing connection.`);
    ws.close(1008, 'Rate limit exceeded');
    return;
  }

  const playerId = 'p_' + Math.random().toString(36).slice(2, 9);
  const nameIdx = (nextPlayerNum - 1) % MARBLE_NAMES.length;
  const colorIdx = (nextPlayerNum - 1) % MARBLE_COLORS.length;
  const name = `${MARBLE_NAMES[nameIdx]} #${nextPlayerNum++}`;
  const color = MARBLE_COLORS[colorIdx];

  // Token bucket for WS message flood protection
  let msgTokens = 60;
  let lastTokenRefill = Date.now();

  const playerData = {
    id: playerId,
    name,
    color,
    intelligence: 'NI',
    stage: 1,
    x: 3.4,
    y: 6.5,
    z: 2.0,
    vx: 0,
    vy: 0,
    vz: 0,
    rotX: 0,
    rotZ: 0,
    speed: 0,
    score: 0,
    bumps: 0,
    knockouts: 0,
    lastBumpedBy: null,
    lastBumpTime: 0,
    lastSeen: Date.now(),
  };

  players.set(playerId, { ws, data: playerData, ip: clientIp });
  console.log(`[Multiplayer] Player connected: ${name} (${playerId}) [NI] from ${clientIp}`);

  const otherPlayers = Array.from(players.values())
    .filter((p) => p.data.id !== playerId)
    .map((p) => p.data);

  ws.send(
    JSON.stringify({
      type: 'welcome',
      id: playerId,
      name,
      color,
      leaderboard: leaderboardCache,
      players: otherPlayers,
    }),
  );

  broadcast(
    {
      type: 'player_joined',
      player: playerData,
    },
    playerId,
  );

  ws.on('message', (raw) => {
    // Token-bucket message rate limiter
    const now = Date.now();
    const elapsed = (now - lastTokenRefill) / 1000;
    msgTokens = Math.min(60, msgTokens + elapsed * 30);
    lastTokenRefill = now;

    if (msgTokens < 1) {
      return; // Drop flooded packet
    }
    msgTokens -= 1;

    try {
      const msg = JSON.parse(raw.toString());
      playerData.lastSeen = now;

      switch (msg.type) {
        case 'update': {
          playerData.stage = msg.stage ?? playerData.stage;
          if (typeof msg.name === 'string' && msg.name) {
            playerData.name = msg.name;
          }
          if (typeof msg.color === 'string' && msg.color) {
            playerData.color = msg.color;
          }
          if (msg.intelligence === 'AI' || msg.intelligence === 'NI') {
            playerData.intelligence = msg.intelligence;
          }
          playerData.x = msg.x ?? playerData.x;
          playerData.y = msg.y ?? playerData.y;
          playerData.z = msg.z ?? playerData.z;
          playerData.vx = msg.vx ?? playerData.vx;
          playerData.vy = msg.vy ?? playerData.vy;
          playerData.vz = msg.vz ?? playerData.vz;
          playerData.rotX = msg.rotX ?? playerData.rotX;
          playerData.rotZ = msg.rotZ ?? playerData.rotZ;
          playerData.speed = msg.speed ?? playerData.speed;
          playerData.score = msg.score ?? playerData.score;

          // Check if player fell into void after being recently bumped
          if (playerData.y < -12 && playerData.lastBumpedBy && now - playerData.lastBumpTime < 3500) {
            const attacker = players.get(playerData.lastBumpedBy);
            if (attacker) {
              const isOpposing = attacker.data.intelligence !== playerData.intelligence;
              const points = isOpposing ? 2500 : 1500;
              attacker.data.score += points;
              attacker.data.knockouts++;

              broadcast({
                type: 'player_knockout',
                attackerId: attacker.data.id,
                attackerName: attacker.data.name,
                attackerIntelligence: attacker.data.intelligence,
                targetId: playerId,
                targetName: playerData.name,
                targetIntelligence: playerData.intelligence,
                points,
              });

              console.log(
                `[Multiplayer] KNOCKOUT! ${attacker.data.name} [${attacker.data.intelligence}] knocked out ${playerData.name} [${playerData.intelligence}] (+${points} pts)`,
              );
            }
            playerData.lastBumpedBy = null;
          }
          break;
        }

        case 'bump': {
          const targetId = msg.targetId;
          const target = players.get(targetId);
          playerData.bumps++;
          playerData.score += 250;

          if (target) {
            target.data.lastBumpedBy = playerId;
            target.data.lastBumpTime = now;
          }

          broadcast({
            type: 'player_bumped',
            attackerId: playerId,
            attackerName: playerData.name,
            attackerIntelligence: playerData.intelligence,
            targetId,
            targetName: target?.data.name || 'Marble',
            targetIntelligence: target?.data.intelligence || 'NI',
            points: 250,
            impulseX: msg.impulseX ?? 0,
            impulseY: msg.impulseY ?? 0.25,
            impulseZ: msg.impulseZ ?? 0,
            x: msg.x ?? playerData.x,
            y: msg.y ?? playerData.y,
            z: msg.z ?? playerData.z,
          });
          break;
        }
      }
    } catch (e) {
      console.warn('[Multiplayer] Invalid message:', e);
    }
  });

  ws.on('close', () => {
    players.delete(playerId);
    broadcast({
      type: 'player_left',
      id: playerId,
    });
  });

  ws.on('error', (err) => {
    console.warn(`[Multiplayer] Socket error for ${playerId}:`, err);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] Marble Madness hosted server running at http://${HOST}:${PORT}/`);
  console.log(`[serve] Multiplayer WebSocket active at ws://${HOST}:${PORT}/ws`);
  console.log(`[serve] Top 50 Leaderboard loaded (${leaderboardCache.length} records)`);
});
