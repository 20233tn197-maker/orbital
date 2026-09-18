import { Vector3, Quaternion, Matrix4 } from 'three';
import { randomUUID } from 'node:crypto';
import { COLORS, WORLD_RADIUS, SHIP_RADIUS, WEAPONS, RESPAWN_SECONDS, emptyInput, fly, segmentSphere } from '../shared/flight.js';

const random = (min, max) => min + Math.random() * (max - min);
const point = (radius = 220) => new Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * radius);
const round = n => Math.round(n * 100) / 100;
const vec = v => v.toArray().map(round);

const _delta = new Vector3();
const _normal = new Vector3();
const _lead = new Vector3();
const _look = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _end = new Vector3();
const _shotDir = new Vector3();

export class Room {
  constructor(code, solo = false) {
    this.code = code;
    this.solo = solo;
    this.players = new Map();
    this.host = null;
    this.phase = 'lobby';
    this.minutes = 5;
    this.botCount = solo ? 4 : 0;
    this.remaining = 0;
    this.asteroids = [];
    this.bullets = [];
    this.events = [];
    this.time = 0;
    this.serial = 0;
    this.createdAt = Date.now();
    this.lastOccupiedAt = Date.now();
  }

  addPlayer(name, bot = false) {
    const id = randomUUID();
    const p = { id, name, bot, color: COLORS[this.players.size % COLORS.length], p: new Vector3(), v: new Vector3(), q: new Quaternion(), hp: 100, energy: 100, energyDelay: 0, boostLocked: false, boosting: false, kills: 0, deaths: 0, alive: true, respawn: 0, shield: 2.5, machine: 0, cannon: 0, collisionCooldown: 0, input: emptyInput(), lastInput: 0, connected: true, disconnectedAt: null, ws: null, token: randomUUID() };
    this.players.set(id, p);
    if (!this.host && !bot) this.host = id;
    this.spawn(p);
    return p;
  }

  spawn(p) {
    let spawn = point(175);
    for (let i = 0; i < 70; i++) {
      spawn = point(175);
      const clearRocks = this.asteroids.every(a => a.p.distanceTo(spawn) > a.r + 12);
      const clearShips = [...this.players.values()].every(other => other.id === p.id || !other.alive || other.p.distanceTo(spawn) > 35);
      if (clearRocks && clearShips) break;
    }
    p.p.copy(spawn);
    p.v.set(0, 0, 0);
    p.q.setFromRotationMatrix(new Matrix4().lookAt(spawn, new Vector3(), new Vector3(0, 1, 0)));
    Object.assign(p, { hp: 100, energy: 100, energyDelay: 0, boostLocked: false, alive: true, respawn: 0, shield: 2.5, collisionCooldown: 0, machine: 0, cannon: 0, input: { ...emptyInput(), q: p.q.toArray() } });
  }

  rock(radius, position) {
    return { id: ++this.serial, p: position || point(235), v: new Vector3().randomDirection().multiplyScalar(random(1, 4)), r: radius, hp: radius * 9, seed: Math.random() * 10000 | 0 };
  }

  start() {
    if (this.phase === 'playing') return false;
    for (const [id, p] of this.players) if (p.bot) this.players.delete(id);
    const botsToAdd = Math.min(this.botCount, 8 - this.players.size);
    for (let i = 0; i < botsToAdd; i++) this.addPlayer(['VÉRTICE', 'NOVA', 'ECHO', 'SPECTRE', 'ORION', 'PULSAR'][i], true);
    this.asteroids = Array.from({ length: 32 }, (_, i) => this.rock(i < 8 ? random(10, 15) : i < 20 ? random(5, 8) : random(2.5, 4)));
    this.bullets = [];
    this.events = [];
    this.phase = 'playing';
    this.remaining = this.minutes * 60;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      this.spawn(p);
    }
    return true;
  }

  botInput(p, dt) {
    let target = null, nearest = Infinity;
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive || !other.connected) continue;
      const dx = other.p.x - p.p.x, dy = other.p.y - p.p.y, dz = other.p.z - p.p.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < nearest) { nearest = distance; target = other; }
    }
    if (!target) return emptyInput();
    _lead.copy(target.p).addScaledVector(target.v, Math.min(0.6, nearest / 190));
    _look.lookAt(p.p, _lead, _up);
    const q = p.q.clone().rotateTowards(new Quaternion().setFromRotationMatrix(_look), dt * 1.45);
    const aimed = p.q.angleTo(new Quaternion().setFromRotationMatrix(_look)) < 0.14;
    return { q: q.toArray(), z: nearest > 55 ? 1 : nearest < 28 ? -0.6 : 0.2, x: Math.sin(this.time * 0.6 + p.color.length) * 0.6, y: Math.sin(this.time * 0.45) * 0.2, boost: nearest > 140, fire: aimed && nearest < 240, cannon: aimed && nearest < 60 };
  }

  shoot(p, kind) {
    const w = WEAPONS[kind];
    if (p[kind] > 0 || this.bullets.length > 400) return;
    p[kind] = w.interval;
    p.shield = 0;
    for (let i = 0; i < w.pellets; i++) {
      const spreadX = random(-w.spread, w.spread);
      const spreadY = random(-w.spread, w.spread);
      _shotDir.set(spreadX, spreadY, -1).normalize().applyQuaternion(p.q);
      this.bullets.push({ id: ++this.serial, owner: p.id, kind, p: p.p.clone().addScaledVector(_shotDir, 3.6), v: _shotDir.multiplyScalar(w.speed).addScaledVector(p.v, 0.35), life: w.life, damage: w.damage });
    }
  }

  damage(p, amount, attacker = null, reason = 'weapon') {
    if (!p.alive || p.shield > 0) return;
    p.hp = Math.max(0, p.hp - amount);
    this.events.push({ type: 'hit', target: p.id, owner: attacker, p: vec(p.p), amount: round(amount) });
    if (p.hp > 0) return;
    p.alive = false;
    p.deaths++;
    p.respawn = RESPAWN_SECONDS;
    p.v.set(0, 0, 0);
    const killer = this.players.get(attacker);
    if (killer && killer.id !== p.id) killer.kills++;
    this.events.push({ type: 'death', target: p.id, owner: attacker, victim: p.name, killer: killer?.name || (reason === 'asteroid' ? 'ASTEROIDE' : 'ENTORNO'), p: vec(p.p), color: p.color });
  }

  update(dt) {
    this.time += dt;
    if (this.phase !== 'playing') return;
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining <= 0) { this.phase = 'results'; this.bullets = []; return; }
    for (const a of this.asteroids) {
      a.p.addScaledVector(a.v, dt);
      if (a.p.length() > WORLD_RADIUS + 15) { a.p.setLength(WORLD_RADIUS + 14); a.v.reflect(a.p.clone().normalize()); }
    }
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      if (!p.alive) {
        p.respawn -= dt;
        if (p.respawn <= 0) { this.spawn(p); this.events.push({ type: 'spawn', target: p.id }); }
        continue;
      }
      p.shield = Math.max(0, p.shield - dt);
      p.collisionCooldown = Math.max(0, p.collisionCooldown - dt);
      p.machine = Math.max(0, p.machine - dt);
      p.cannon = Math.max(0, p.cannon - dt);
      const input = p.bot ? this.botInput(p, dt) : this.time - p.lastInput > 0.35 ? { ...emptyInput(), q: p.q.toArray() } : p.input;
      fly(p, input, dt);
      for (const a of this.asteroids) {
        _delta.copy(p.p).sub(a.p);
        const distance = _delta.length();
        if (distance >= a.r + SHIP_RADIUS) continue;
        const normal = distance > 0.001 ? _delta.divideScalar(distance) : _normal.set(0, 1, 0);
        const relative = p.v.x * normal.x + p.v.y * normal.y + p.v.z * normal.z - (a.v.x * normal.x + a.v.y * normal.y + a.v.z * normal.z);
        p.p.copy(a.p).addScaledVector(normal, a.r + SHIP_RADIUS + 0.1);
        if (relative < 0) p.v.addScaledVector(normal, -relative * 1.6);
        if (p.collisionCooldown <= 0) { this.damage(p, Math.max(10, Math.abs(relative) * 1.4), null, 'asteroid'); p.collisionCooldown = 0.65; }
      }
      if (!p.alive) continue;
      if (input.fire) this.shoot(p, 'machine');
      if (input.cannon) this.shoot(p, 'cannon');
    }
    const fragments = [];
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      _end.copy(b.p).addScaledVector(b.v, dt);
      let nearest = 2, hit = null, rock = false;
      for (const p of this.players.values()) {
        if (!p.alive || !p.connected || p.id === b.owner || p.shield > 0) continue;
        const t = segmentSphere(b.p, _end, p.p, SHIP_RADIUS + 0.45);
        if (t !== null && t < nearest) { nearest = t; hit = p; rock = false; }
      }
      for (const a of this.asteroids) {
        if (a.hp <= 0) continue;
        const t = segmentSphere(b.p, _end, a.p, a.r);
        if (t !== null && t < nearest) { nearest = t; hit = a; rock = true; }
      }
      if (hit) {
        if (rock) {
          hit.hp -= b.damage;
          if (hit.hp <= 0) {
            this.events.push({ type: 'rock', p: vec(hit.p), r: hit.r });
            if (hit.r > 5 && this.asteroids.length + fragments.length < 65) for (let n = 0; n < 2; n++) fragments.push(this.rock(hit.r * 0.42, hit.p.clone().add(new Vector3().randomDirection().multiplyScalar(hit.r * 0.7))));
          } else this.events.push({ type: 'spark', p: vec(b.p.clone().lerp(_end, nearest)) });
        } else this.damage(hit, b.damage, b.owner);
      }
      b.p.copy(_end);
      b.life -= dt;
      if (hit || b.life <= 0) { this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop(); }
    }
    this.asteroids = this.asteroids.filter(a => a.hp > 0).concat(fragments);
    if (this.asteroids.length < 25 && Math.random() < dt * 0.4) this.asteroids.push(this.rock(random(5, 12), point(250).setLength(240)));
  }

  info() {
    return { code: this.code, solo: this.solo, host: this.host, phase: this.phase, minutes: this.minutes, botCount: this.botCount, remaining: this.remaining, players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, bot: p.bot, color: p.color, kills: p.kills, deaths: p.deaths, connected: p.connected })) };
  }

  snapshot() {
    const players = [...this.players.values()].filter(p => p.connected).map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, p: vec(p.p), v: vec(p.v), q: p.q.toArray().map(n => Math.round(n * 10000) / 10000), hp: round(p.hp), energy: round(p.energy), energyDelay: round(p.energyDelay), boostLocked: p.boostLocked, boosting: p.boosting, alive: p.alive, respawn: round(p.respawn), shield: round(p.shield), kills: p.kills, deaths: p.deaths }));
    const bullets = this.bullets.length > 300 ? this.bullets.slice(-300) : this.bullets;
    return { type: 'state', time: this.time, phase: this.phase, remaining: this.remaining, players, asteroids: this.asteroids.map(a => ({ id: a.id, p: vec(a.p), v: vec(a.v), r: a.r, seed: a.seed })), bullets: bullets.map(b => ({ id: b.id, owner: b.owner, kind: b.kind, p: vec(b.p), v: vec(b.v) })), events: this.events.splice(0) };
  }
}
