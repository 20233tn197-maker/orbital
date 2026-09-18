import { Vector3, Quaternion } from 'three';

export const WORLD_RADIUS = 260;
export const SHIP_RADIUS = 2;
export const MAX_HEALTH = 100;
export const RESPAWN_SECONDS = 3;
export const COLORS = ['#59e9ff', '#ffac68', '#c7a0ff', '#80f9ba', '#ff779f', '#fff092', '#829bff', '#ff8bf3'];
export const WEAPONS = {
  machine: { interval: 0.105, speed: 190, damage: 10, life: 1.8, pellets: 1, spread: 0.008 },
  cannon: { interval: 0.9, speed: 155, damage: 13, life: 0.72, pellets: 9, spread: 0.105 },
};
const forward = new Vector3();
const right = new Vector3();
const up = new Vector3();
const acceleration = new Vector3();
const identity = new Quaternion();

export function emptyInput() {
  return { x: 0, z: 0, y: 0, boost: false, fire: false, cannon: false, q: [0, 0, 0, 1] };
}

export function sanitizeInput(raw) {
  if (!raw || !Array.isArray(raw.q) || raw.q.length !== 4 || !raw.q.every(Number.isFinite)) return null;
  const q = new Quaternion(...raw.q);
  if (q.lengthSq() < 0.5 || q.lengthSq() > 1.5) return null;
  q.normalize();
  const axis = v => Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  return { x: axis(raw.x), z: axis(raw.z), y: axis(raw.y), boost: raw.boost === true, fire: raw.fire === true, cannon: raw.cannon === true, q: q.toArray() };
}

// The same flight model runs on the server and on the predicting client.
export function fly(ship, input, dt) {
  identity.fromArray(input.q);
  ship.q.rotateTowards(identity, 5.5 * dt);
  const boosting = input.boost && ship.energy > 0 && !ship.boostLocked && input.z > 0;
  if (boosting) {
    ship.energy = Math.max(0, ship.energy - dt * 31);
    ship.energyDelay = 0.9;
    if (ship.energy === 0) ship.boostLocked = true;
  } else {
    ship.energyDelay = Math.max(0, (ship.energyDelay || 0) - dt);
    if (!ship.energyDelay) ship.energy = Math.min(100, ship.energy + dt * 20);
    if (ship.energy >= 25) ship.boostLocked = false;
  }
  ship.boosting = boosting;
  forward.set(0, 0, -1).applyQuaternion(ship.q);
  right.set(1, 0, 0).applyQuaternion(ship.q);
  up.set(0, 1, 0).applyQuaternion(ship.q);
  acceleration.copy(forward).multiplyScalar(input.z).addScaledVector(right, input.x * 0.8).addScaledVector(up, input.y * 0.8);
  if (acceleration.lengthSq() > 1) acceleration.normalize();
  const speed = boosting ? 100 : 43;
  ship.v.addScaledVector(acceleration, speed * 3.2 * dt);
  ship.v.multiplyScalar(Math.exp(-3.2 * dt));
  ship.p.addScaledVector(ship.v, dt);
  const dist = ship.p.length();
  if (dist > WORLD_RADIUS) {
    ship.p.multiplyScalar(WORLD_RADIUS / dist);
    const outwardSpeed = ship.v.dot(ship.p) / WORLD_RADIUS;
    if (outwardSpeed > 0) ship.v.addScaledVector(ship.p, -outwardSpeed / WORLD_RADIUS);
  }
}

export function segmentSphere(start, end, center, radius) {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const ax = start.x - center.x, ay = start.y - center.y, az = start.z - center.z;
  const a = dx * dx + dy * dy + dz * dz;
  const c = ax * ax + ay * ay + az * az - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-10) return null;
  const b = ax * dx + ay * dy + az * dz;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}
