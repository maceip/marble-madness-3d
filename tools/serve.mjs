import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

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

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(root, reqPath);

  // Fallback to www/ folder if not found directly under root
  if (!fs.existsSync(filePath)) {
    const wwwPath = path.join(root, 'www', reqPath);
    if (fs.existsSync(wwwPath)) {
      filePath = wwwPath;
    }
  }

  // Security check: ensure within root
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
// HOSTED MULTIPLAYER SERVER (Shared Level, Real-Time Collisions & Bumping)
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

// 25Hz Server World Tick Loop (Consolidates updates for 100+ simultaneous marbles)
const SERVER_TICK_RATE = 25; // 25 times per second
const TICK_INTERVAL = 1000 / SERVER_TICK_RATE;

setInterval(() => {
  if (players.size === 0) return;

  const now = Date.now();
  const activePlayersList = [];

  for (const [id, client] of players.entries()) {
    // Prune inactive clients after 15 seconds
    if (now - client.data.lastSeen > 15000 || client.ws.readyState !== WebSocket.OPEN) {
      console.log(`[Multiplayer] Pruning inactive player: ${client.data.name} (${id})`);
      client.ws.terminate();
      players.delete(id);
      broadcast({ type: 'player_left', id });
      continue;
    }

    activePlayersList.push({
      id: client.data.id,
      name: client.data.name,
      color: client.data.color,
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

  const tickMsg = JSON.stringify({
    type: 'world_tick',
    t: now,
    count: activePlayersList.length,
    players: activePlayersList,
  });

  for (const client of players.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(tickMsg);
    }
  }
}, TICK_INTERVAL);

wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).slice(2, 9);
  const nameIdx = (nextPlayerNum - 1) % MARBLE_NAMES.length;
  const colorIdx = (nextPlayerNum - 1) % MARBLE_COLORS.length;
  const name = `${MARBLE_NAMES[nameIdx]} #${nextPlayerNum++}`;
  const color = MARBLE_COLORS[colorIdx];

  const playerData = {
    id: playerId,
    name,
    color,
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
    lastSeen: Date.now(),
  };

  players.set(playerId, { ws, data: playerData });
  console.log(`[Multiplayer] Player joined: ${name} (${playerId}), total players: ${players.size}`);

  // Send initial welcome with player ID and list of all active players
  const otherPlayers = Array.from(players.values())
    .filter((p) => p.data.id !== playerId)
    .map((p) => p.data);

  ws.send(
    JSON.stringify({
      type: 'welcome',
      id: playerId,
      name,
      color,
      players: otherPlayers,
    }),
  );

  // Notify everyone else immediately
  broadcast(
    {
      type: 'player_joined',
      player: playerData,
    },
    playerId,
  );

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      playerData.lastSeen = Date.now();

      switch (msg.type) {
        case 'update': {
          playerData.stage = msg.stage ?? playerData.stage;
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
          // State updated in memory; world_tick loop batches broadcast for high scalability
          break;
        }

        case 'bump': {
          // Attacker hit a target player!
          const targetId = msg.targetId;
          const target = players.get(targetId);
          playerData.bumps++;
          playerData.score += 250;

          console.log(`[Multiplayer] Bump! ${playerData.name} -> ${target?.data.name ?? targetId} (+250 pts)`);

          // Broadcast bump event to everyone
          broadcast({
            type: 'player_bumped',
            attackerId: playerId,
            attackerName: playerData.name,
            targetId,
            targetName: target?.data.name || 'Marble',
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
    console.log(`[Multiplayer] Player left: ${name} (${playerId}), remaining: ${players.size}`);
    broadcast({
      type: 'player_left',
      id: playerId,
    });
  });

  ws.on('error', (err) => {
    console.warn(`[Multiplayer] Socket error for ${playerId}:`, err);
  });
});

server.listen(PORT, () => {
  console.log(`[serve] Marble Madness hosted server running at http://localhost:${PORT}/`);
  console.log(`[serve] Multiplayer WebSocket active at ws://localhost:${PORT}/ws`);
});
