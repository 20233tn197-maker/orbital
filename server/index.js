import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomInt } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Room } from './game.js';
import { sanitizeInput } from '../shared/flight.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function createGameServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
  const rooms = new Map();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok', rooms: rooms.size }));
  app.use('/vendor/three', express.static(path.join(root, 'node_modules/three/build')));
  app.use('/vendor/gsap', express.static(path.join(root, 'node_modules/gsap/dist')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use(express.static(path.join(root, 'public')));
  const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify(data)); };
  const broadcast = (room, data) => { for (const p of room.players.values()) if (!p.bot) send(p.ws, data); };
  const announce = room => broadcast(room, { type: 'room', room: room.info() });
  const error = (ws, message) => send(ws, { type: 'error', message });
  function depart(ws, explicit = false) {
    const room = ws.room, player = room?.players.get(ws.playerId);
    if (!player || player.ws !== ws) return;
    player.ws = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    if (explicit) room.players.delete(player.id);
    if (room.host === player.id) room.host = [...room.players.values()].find(p => !p.bot && p.connected)?.id || null;
    ws.room = null;
    ws.playerId = null;
    announce(room);
  }

  wss.on('connection', (ws, request) => {
    // Browser WebSocket connections must originate from this host.
    const origin = request.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== request.headers.host) { ws.close(1008, 'Origen no permitido'); return; } }
      catch { ws.close(1008); return; }
    }
    ws.isAlive = true;
    ws.rateAt = Date.now();
    ws.messages = 0;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.on('close', () => depart(ws));
    send(ws, { type: 'hello' });
    ws.on('message', bytes => {
      if (Date.now() - ws.rateAt > 1000) { ws.messages = 0; ws.rateAt = Date.now(); }
      if (++ws.messages > 100) { ws.close(1008, 'Demasiados mensajes'); return; }
      let data;
      try { data = JSON.parse(bytes.toString()); } catch { return error(ws, 'Mensaje inválido.'); }
      if (!data || typeof data !== 'object') return;
      const room = ws.room, player = room?.players.get(ws.playerId);
      if (data.type === 'ping') return send(ws, { type: 'pong', at: data.at });
      if (data.type === 'create' || data.type === 'join') {
        if (room) return error(ws, 'Ya estás en una sala.');
        const name = typeof data.name === 'string' ? data.name.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 18) : '';
        if (!name) return error(ws, 'Escribe tu nombre de piloto.');
        let target;
        if (data.type === 'create') {
          if (rooms.size >= 150) return error(ws, 'El servidor está lleno. Inténtalo más tarde.');
          let code;
          do { code = String(randomInt(0, 100000)).padStart(5, '0'); } while (rooms.has(code));
          target = new Room(code, data.solo === true);
          rooms.set(code, target);
        } else {
          if (typeof data.code !== 'string' || !/^\d{5}$/.test(data.code)) return error(ws, 'El código debe tener 5 dígitos.');
          target = rooms.get(data.code);
          if (!target || target.solo) return error(ws, 'No encontramos esa sala privada.');
          if ([...target.players.values()].filter(p => !p.bot).length >= 8) return error(ws, 'La sala está llena (8 pilotos).');
          if (target.players.size >= 8) {
            const bot = [...target.players.values()].find(p => p.bot);
            if (bot) target.players.delete(bot.id);
          }
        }
        const p = target.addPlayer(name);
        p.ws = ws;
        ws.room = target;
        ws.playerId = p.id;
        target.sentBullets = new Set();
        send(ws, { type: 'welcome', id: p.id, token: p.token, room: target.info() });
        announce(target);
      } else if (data.type === 'resume') {
        if (room) return;
        const target = rooms.get(data.code);
        const p = typeof data.token === 'string' && target && [...target.players.values()].find(p => !p.bot && p.token === data.token);
        if (!p) return error(ws, 'La sesión ha caducado. Vuelve a entrar a la sala.');
        if (p.ws) { p.ws.room = null; p.ws.close(1000, 'Sesión recuperada'); }
        Object.assign(p, { ws, connected: true, disconnectedAt: null, lastInput: -1 });
        p.input.fire = p.input.cannon = false;
        ws.room = target;
        ws.playerId = p.id;
        if (!target.host) target.host = p.id;
        target.sentBullets = new Set();
        send(ws, { type: 'welcome', id: p.id, token: p.token, room: target.info(), resumed: true });
        announce(target);
      } else if (data.type === 'leave') {
        depart(ws, true);
        send(ws, { type: 'left' });
      } else if (data.type === 'input' && player && room.phase === 'playing') {
        const input = sanitizeInput(data.input);
        if (input) { player.input = input; player.lastInput = room.time; }
      } else if (data.type === 'settings' && player && room.host === player.id && room.phase !== 'playing') {
        if (Number.isInteger(data.minutes) && data.minutes >= 1 && data.minutes <= 30) room.minutes = data.minutes;
        if (Number.isInteger(data.bots) && data.bots >= 0 && data.bots <= 6) room.botCount = data.bots;
        announce(room);
      } else if (data.type === 'start' && player && room.host === player.id) {
        if (room.start()) announce(room);
      }
    });
  });

  let last = performance.now(), accumulator = 0, ticks = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min((now - last) / 1000, 0.2);
    last = now;
    while (accumulator >= 1 / 30) {
      for (const room of rooms.values()) {
        const before = room.phase;
        room.update(1 / 30);
        if (before !== room.phase) announce(room);
      }
      accumulator -= 1 / 30;
      if (++ticks % 2 === 0) for (const room of rooms.values()) if (room.phase === 'playing') broadcast(room, room.snapshot());
    }
  }, 8);
  const cleanup = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    for (const [code, room] of rooms) {
      for (const [id, p] of room.players) if (!p.bot && !p.connected && Date.now() - p.disconnectedAt > 30000) room.players.delete(id);
      if ([...room.players.values()].some(p => !p.bot && p.connected)) room.lastOccupiedAt = Date.now();
      else if (Date.now() - room.lastOccupiedAt > 60000) rooms.delete(code);
    }
  }, 15000);
  function close() {
    clearInterval(loop);
    clearInterval(cleanup);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    return new Promise(resolve => server.close(resolve));
  }
  return { app, server, rooms, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const game = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  game.server.listen(port, '0.0.0.0', () => console.log(`\n  ORBITAL / ARENA\n  Abre http://localhost:${port}\n  Servidor multijugador listo.\n`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await game.close(); process.exit(0); });
}
