import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';

async function client(url) {
  const ws = new WebSocket(url);
  const inbox = [], waiters = [];
  ws.on('message', bytes => {
    const data = JSON.parse(bytes.toString());
    const index = waiters.findIndex(w => w.predicate(data));
    if (index >= 0) { const w = waiters.splice(index,1)[0]; clearTimeout(w.timer); w.resolve(data); }
    else if (data.type !== 'state') inbox.push(data);
  });
  await new Promise((resolve,reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return {
    ws,
    send: data => ws.send(JSON.stringify(data)),
    wait(predicate) {
      const index = inbox.findIndex(predicate);
      if (index >= 0) return Promise.resolve(inbox.splice(index,1)[0]);
      return new Promise((resolve,reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index,1); reject(new Error('WebSocket message timeout')); }, 4000);
        waiters.push(waiter);
      });
    },
  };
}

test('real WebSockets: private room, host permissions, playing, reconnect and rematch', { timeout: 20000 }, async () => {
  const game = createGameServer();
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const address = game.server.address();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const clients = [];
  try {
    const health = await fetch(`http://127.0.0.1:${address.port}/health`); assert.equal(health.status, 200);
    const host = await client(url); clients.push(host);
    host.send({ type: 'create', name: 'Anfitrión' });
    const welcome = await host.wait(m => m.type === 'welcome'); assert.match(welcome.room.code, /^\d{5}$/);
    const room = game.rooms.get(welcome.room.code);
    const guest = await client(url); clients.push(guest);
    guest.send({ type: 'join', name: 'Invitado', code: welcome.room.code });
    const joined = await guest.wait(m => m.type === 'welcome'); assert.equal(joined.room.players.length, 2);
    guest.send({ type: 'settings', minutes: 30, bots: 6 }); guest.send({ type: 'start' });
    await new Promise(resolve => setTimeout(resolve,100)); assert.equal(room.phase, 'lobby'); assert.equal(room.minutes, 5);
    host.send({ type: 'settings', minutes: 1, bots: 2 });
    await host.wait(m => m.type === 'room' && m.room.minutes === 1);
    host.send({ type: 'start' });
    const state = await guest.wait(m => m.type === 'state'); assert.equal(state.players.length, 4); assert.equal(state.asteroids.length, 32);
    assert.equal(room.phase, 'playing');
    guest.ws.close(); await new Promise(resolve => guest.ws.once('close',resolve));
    const resumed = await client(url); clients.push(resumed);
    resumed.send({ type: 'resume', code: room.code, token: joined.token });
    const restored = await resumed.wait(m => m.type === 'welcome'); assert.equal(restored.id, joined.id); assert.equal(restored.resumed, true);
    room.players.get(welcome.id).kills = 3; room.remaining = 0.01;
    const results = await resumed.wait(m => m.type === 'room' && m.room.phase === 'results');
    assert.equal(results.room.players.find(p => p.id === welcome.id).kills, 3);
    host.send({ type: 'start' });
    const restarted = await resumed.wait(m => m.type === 'state');
    assert.equal(restarted.players.find(p => p.id === welcome.id).kills, 0); assert.equal(game.rooms.size, 1);
    host.send({ type: 'leave' });
    await resumed.wait(m => m.type === 'room' && m.room.host === joined.id);
    assert.equal(room.host, joined.id);
  } finally { clients.forEach(c => c.ws.terminate()); await game.close(); }
});

test('malformed codes, full rooms, solo privacy and hostile origins are rejected', { timeout: 15000 }, async () => {
  const game = createGameServer(); await new Promise(resolve => game.server.listen(0,'127.0.0.1',resolve));
  const url = `ws://127.0.0.1:${game.server.address().port}/ws`;
  const clients = [];
  try {
    const host = await client(url), guest = await client(url); clients.push(host,guest);
    host.send({ type: 'create', name: 'Solo', solo: true }); const solo = await host.wait(m => m.type === 'welcome');
    guest.send({ type: 'join', name: 'Intruso', code: solo.room.code });
    assert.match((await guest.wait(m => m.type === 'error')).message, /No encontramos/);
    guest.send({ type: 'join', name: 'Intruso', code: 'abc' });
    assert.match((await guest.wait(m => m.type === 'error')).message, /5 dígitos/);
    const bad = new WebSocket(url, { origin: 'https://untrusted.example' });
    const closeCode = await new Promise(resolve => bad.on('close', resolve)); assert.equal(closeCode, 1008);
    host.send({ type: 'leave' }); await host.wait(m => m.type === 'left');
    host.send({ type: 'create', name: 'Host' }); const welcome = await host.wait(m => m.type === 'welcome');
    const room = game.rooms.get(welcome.room.code);
    for (let i=0;i<7;i++) room.addPlayer(`Pilot ${i}`);
    guest.send({ type: 'join', name: 'Ninth', code: room.code });
    assert.match((await guest.wait(m => m.type === 'error')).message, /llena/);
  } finally { clients.forEach(c => c.ws.terminate()); await game.close(); }
});
