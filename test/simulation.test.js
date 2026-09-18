import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { Room } from '../server/game.js';
import { emptyInput, fly, sanitizeInput, segmentSphere, WORLD_RADIUS } from '../shared/flight.js';

function ship() { return { p: new Vector3(), v: new Vector3(), q: new Quaternion(), energy: 100, energyDelay: 0, boostLocked: false }; }
function arena() {
  const room = new Room('12345');
  const a = room.addPlayer('Alpha'), b = room.addPlayer('Beta');
  room.start(); room.asteroids = [];
  a.p.set(0,0,0); b.p.set(0,0,-25); a.q.identity(); b.q.identity(); a.shield = b.shield = 0;
  a.input = b.input = emptyInput();
  return { room, a, b };
}

test('inputs reject invalid quaternions and clamp axes', () => {
  assert.equal(sanitizeInput({ q: [0,0,0,0] }), null);
  assert.equal(sanitizeInput({ q: [NaN,0,0,1] }), null);
  assert.equal(sanitizeInput({ q: [0,0,0,1], x: 100 }).x, 1);
  assert.equal(sanitizeInput({ q: [0,0,0,1], boost: 'yes' }).boost, false);
});

test('flight is oriented in local space and boost is faster', () => {
  const normal = ship(), boost = ship();
  for (let i = 0; i < 60; i++) { fly(normal, { ...emptyInput(), z: 1 }, 1/60); fly(boost, { ...emptyInput(), z: 1, boost: true }, 1/60); }
  assert.ok(normal.p.z < -20); assert.ok(Math.abs(boost.p.z) > Math.abs(normal.p.z) * 2);
  const rotated = ship(); rotated.q.setFromAxisAngle(new Vector3(0,1,0), Math.PI/2);
  for (let i=0;i<30;i++) fly(rotated, { ...emptyInput(), z: 1, q: rotated.q.toArray() }, 1/60);
  assert.ok(rotated.p.x < -8); assert.ok(Math.abs(rotated.p.z) < 0.1);
});

test('turbo depletes, locks, then regenerates without going negative', () => {
  const p = ship();
  for (let i=0;i<200;i++) fly(p, { ...emptyInput(), z: 1, boost: true }, 1/60);
  assert.ok(p.boostLocked); assert.ok(p.energy < 2); assert.ok(p.energy >= 0);
  for (let i=0;i<420;i++) fly(p, emptyInput(), 1/60);
  assert.equal(p.energy, 100); assert.equal(p.boostLocked, false);
});

test('arena boundary confines ships and swept collision catches thin targets', () => {
  const p = ship(); p.p.set(0,0,-WORLD_RADIUS + 1); p.v.set(0,0,-100);
  fly(p, { ...emptyInput(), z: 1, boost: true }, 0.1);
  assert.ok(p.p.length() <= WORLD_RADIUS + 0.001);
  assert.ok(segmentSphere(new Vector3(0,0,0), new Vector3(0,0,-50), new Vector3(0,0,-25), 2) < 0.5);
  assert.equal(segmentSphere(new Vector3(), new Vector3(0,0,-50), new Vector3(20,0,-25), 2), null);
});

test('kills are counted once and destroyed ships respawn after three seconds', () => {
  const { room, a, b } = arena();
  room.damage(b, 110, a.id); room.damage(b, 110, a.id);
  assert.equal(a.kills, 1); assert.equal(b.deaths, 1); assert.equal(b.alive, false);
  room.update(2.9); assert.equal(b.alive, false);
  room.update(0.11); assert.equal(b.alive, true); assert.equal(b.hp, 100); assert.equal(b.shield, 2.5);
  room.damage(b, 1000, a.id); assert.equal(b.hp, 100);
  room.shoot(b, 'machine'); assert.equal(b.shield, 0);
});

test('machine projectiles damage ships and cannon emits nine pellets on cooldown', () => {
  const { room, a, b } = arena();
  room.shoot(a, 'machine');
  for (let i=0;i<6;i++) room.update(1/30);
  assert.equal(b.hp, 90);
  room.bullets = []; room.shoot(a, 'cannon'); assert.equal(room.bullets.length, 9);
  room.shoot(a, 'cannon'); assert.equal(room.bullets.length, 9);
});

test('asteroids block projectiles, take damage and fragment when destroyed', () => {
  const { room, a, b } = arena();
  const rock = room.rock(6, new Vector3(0,0,-14)); rock.hp = 10; rock.v.set(0,0,0); room.asteroids = [rock];
  room.shoot(a, 'machine');
  for (let i=0;i<6;i++) room.update(1/30);
  assert.equal(b.hp, 100); assert.ok(!room.asteroids.some(r => r.id === rock.id));
  assert.ok(room.asteroids.length >= 2); assert.ok(room.events.some(e => e.type === 'rock'));
});

test('asteroid collision can kill without awarding another pilot a kill', () => {
  const { room, a, b } = arena();
  room.asteroids = [room.rock(10, new Vector3(0,0,-11))]; room.asteroids[0].v.set(0,0,0);
  a.v.set(0,0,-100); room.update(1/30);
  assert.equal(a.alive, false); assert.equal(a.deaths, 1); assert.equal(b.kills, 0);
});

test('six bots are created, the round ends, and rematch resets scores in same room', () => {
  const room = new Room('00009', true), host = room.addPlayer('Human');
  room.botCount = 6; room.start(); assert.equal(room.players.size, 7);
  host.kills = 8; room.remaining = 0.01; room.update(0.02);
  assert.equal(room.phase, 'results'); assert.equal(host.kills, 8);
  room.start(); assert.equal(room.phase, 'playing'); assert.equal(host.kills, 0);
  assert.equal(room.code, '00009'); assert.equal(room.host, host.id); assert.equal(room.players.size, 7);
});
