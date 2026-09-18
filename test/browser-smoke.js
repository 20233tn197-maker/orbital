import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../server/index.js';

const game = createGameServer();
await new Promise(resolve => game.server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${game.server.address().port}`;
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await ctx1.newPage(), b = await ctx2.newPage();
  for (const page of [a,b]) {
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  }
  await a.goto(base); await a.waitForFunction(() => document.getElementById('connection-label').textContent === 'SERVIDOR EN LÍNEA');
  await a.waitForTimeout(1500);
  assert.equal(await a.locator('#webgl-error').isVisible(), false);
  await a.screenshot({ path: new URL('../test-results/menu.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  await a.locator('#pilot-name').fill('Comandante'); await a.locator('#create-button').click();
  await a.locator('#lobby').waitFor({ state: 'visible' });
  const code = await a.locator('#room-code').innerText(); assert.match(code, /^\d{5}$/);
  await a.locator('#match-minutes').selectOption('1'); await a.locator('#match-bots').selectOption('2');
  await b.goto(base); await b.waitForFunction(() => document.getElementById('connection-label').textContent === 'SERVIDOR EN LÍNEA');
  await b.locator('#pilot-name').fill('Wingman'); await b.locator('#join-open').click(); await b.locator('#join-code').fill(code); await b.locator('#join-form button[type=submit]').click();
  await b.locator('#lobby').waitFor({ state: 'visible' });
  assert.equal(await b.locator('#start-button').isDisabled(), true);
  await a.waitForFunction(() => document.getElementById('player-count').textContent === '2 / 8');
  await a.screenshot({ path: new URL('../test-results/lobby.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  await a.locator('#start-button').click(); await b.locator('#hud').waitFor({ state: 'visible' });
  await a.locator('#engage-button').click();
  await a.waitForFunction(() => document.pointerLockElement?.id === 'universe');
  await a.keyboard.down('w'); await a.keyboard.down('r'); await a.waitForTimeout(1400);
  const speed = Number(await a.locator('#speed').innerText()); assert.ok(speed > 30, `Expected moving ship, speed ${speed}`);
  await a.keyboard.up('r'); await a.keyboard.up('w');
  await a.keyboard.press('c'); assert.match(await a.locator('#camera-label').innerText(), /PRIMERA/);
  await a.keyboard.press('c');
  await a.mouse.down(); await a.waitForTimeout(400); await a.mouse.up();
  await a.screenshot({ path: new URL('../test-results/combat.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  const room = game.rooms.get(code);
  const host = [...room.players.values()].find(p => p.name === 'Comandante');
  host.shield = 0; room.damage(host, 200, null, 'asteroid');
  await a.locator('#death').waitFor({ state: 'visible' }); await a.locator('#death').waitFor({ state: 'hidden', timeout: 6000 });
  assert.equal(host.alive, true);
  room.remaining = 0.02;
  await a.locator('#results').waitFor({ state: 'visible' }); await b.locator('#results').waitFor({ state: 'visible' });
  await a.screenshot({ path: new URL('../test-results/results.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  await a.locator('#rematch-button').click(); await b.locator('#hud').waitFor({ state: 'visible' }); assert.equal(room.phase,'playing'); assert.equal(game.rooms.size,1);
  await a.reload(); await a.locator('#hud').waitFor({ state: 'visible' }); assert.equal(room.players.size,4);
  assert.deepEqual(errors, []);
  console.log('PASS: WebGL menu, private room, two clients, host settings, flight + turbo, camera, shooting, death + respawn, results, rematch, reconnect. No browser errors.');
  console.log('Screenshots: test-results/menu.png, lobby.png, combat.png, results.png');
} finally { await browser.close(); await game.close(); }
