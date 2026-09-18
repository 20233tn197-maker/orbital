import * as THREE from 'three';
import { fly, emptyInput, WEAPONS, WORLD_RADIUS } from '/shared/flight.js';
import { SpaceAudio } from './audio.js';

const $ = id => document.getElementById(id);
const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const dummy = new THREE.Object3D();
const clamp = THREE.MathUtils.clamp;

function prism(outline, height, material) {
  const shape = new THREE.Shape();
  outline.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return new THREE.Mesh(geometry, material);
}

function makeShip(color = '#7fe2e4') {
  const group = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color: '#83949c', roughness: 0.37, metalness: 0.72, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#192631', roughness: 0.5, metalness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: '#112e3d', emissive: '#277e96', emissiveIntensity: 0.35, roughness: 0.12, metalness: 0.95 });
  const body = prism([[0, -4.2], [0.85, -1.1], [1.1, 2.2], [0, 2.7], [-1.1, 2.2], [-0.85, -1.1]], 0.75, armor);
  group.add(body);
  const cockpit = prism([[0, -2.65], [0.48, -1.3], [0.42, 0.5], [-0.42, 0.5], [-0.48, -1.3]], 0.46, glass);
  cockpit.position.y = 0.47;
  group.add(cockpit);
  for (const sign of [-1, 1]) {
    const wing = prism([[sign * 0.7, -0.7], [sign * 4.2, 2.7], [sign * 2, 2.2], [sign * 0.8, 1.55]], 0.2, armor);
    wing.position.y = -0.17;
    group.add(wing);
    const inset = prism([[sign * 1.3, 0.2], [sign * 3.45, 2.2], [sign * 2.7, 2], [sign * 1.2, 0.65]], 0.08, dark);
    group.add(inset);
    const strip = prism([[sign * 1.4, 0.2], [sign * 3.1, 1.78], [sign * 2.94, 1.78], [sign * 1.3, 0.4]], 0.025, trim);
    strip.position.y = 0.075;
    group.add(strip);
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 2.25, 8), dark);
    engine.rotation.x = Math.PI / 2; engine.position.set(sign * 1.05, -0.1, 1.4); group.add(engine);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.085, 6, 12), trim);
    ring.position.set(sign * 1.05, -0.1, 2.56); group.add(ring);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.4, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    flame.rotation.x = Math.PI / 2; flame.position.set(sign * 1.05, -0.1, 3.5); flame.name = 'flame'; group.add(flame);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.15, 1.75, 6), dark);
    gun.rotation.x = Math.PI / 2; gun.position.set(sign * 1.6, 0, -0.3); group.add(gun);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.3), armor);
    fin.position.set(sign * 0.7, 0.8, 1.65); fin.rotation.z = sign * -0.25; group.add(fin);
  }
  const light = new THREE.PointLight(color, 3, 9, 2); light.position.set(0, 0, 3); group.add(light);
  group.userData.flames = group.children.filter(c => c.name === 'flame');
  const shield = new THREE.Mesh(new THREE.SphereGeometry(4.3, 16, 10), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.07, depthWrite: false }));
  shield.visible = false; group.add(shield); group.userData.shield = shield;
  return group;
}

function freeShip(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}

export class SpaceGame {
  constructor(settings, hooks) {
    this.hooks = hooks;
    this.settings = settings;
    this.audio = new SpaceAudio(settings.volume);
    this.canvas = $('universe');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor('#070c13');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#070c13', 0.0014);
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.08, 4500);
    this.scene.add(new THREE.HemisphereLight('#b1daf2', '#162133', 2.0));
    const key = new THREE.DirectionalLight('#d0e7ff', 3.4); key.position.set(-30, 45, -15); this.scene.add(key);
    const rim = new THREE.DirectionalLight('#efaa78', 3.6); rim.position.set(20, 7, 20); this.scene.add(rim);
    const blue = new THREE.DirectionalLight('#3b8fa7', 2); blue.position.set(-20, -10, 10); this.scene.add(blue);
    this.ships = new Map(); this.rocks = new Map(); this.indicators = new Map();
    this.active = false; this.engaged = false; this.firstPerson = false;
    this.keys = new Set(); this.mouse = { left: false, right: false };
    this.aim = new THREE.Quaternion();
    this.local = null; this.id = null; this.snapshot = null;
    this.lastSnapshotAt = 0; this.sendAt = 0; this.uiAt = 0; this.frames = 0; this.fps = 60; this.fpsTime = 0; this.ping = 0;
    this.shake = 0; this.cannonCooldown = 0; this.machineCooldown = 0; this.lastAlive = false;
    this.menuShip = makeShip('#8bd9e0'); this.menuShip.scale.setScalar(2.1); this.scene.add(this.menuShip);
    this.menuShip.position.set(7, 0, 0);
    this.makeEnvironment(); this.makeParticles(); this.makeBullets();
    this.setQuality(settings.quality); this.bindControls(); this.resize();
    this.lastTime = performance.now();
    this.animate = this.animate.bind(this); requestAnimationFrame(this.animate);
  }

  makeEnvironment() {
    const positions = [], colors = [];
    for (let i = 0; i < 3800; i++) {
      v.randomDirection().multiplyScalar(1100 + Math.random() * 1700); positions.push(...v.toArray());
      const c = new THREE.Color().setHSL(0.52 + Math.random() * 0.15, 0.15 + Math.random() * 0.25, 0.35 + Math.random() * 0.6); colors.push(c.r, c.g, c.b);
    }
    const starsGeometry = new THREE.BufferGeometry(); starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.stars = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.85 })); this.scene.add(this.stars);
    const dustPositions = new Float32Array(1600 * 3);
    for (let i = 0; i < dustPositions.length; i++) dustPositions[i] = (Math.random() - 0.5) * 600;
    const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#80aebf', size: 0.18, transparent: true, opacity: 0.45, depthWrite: false })); this.scene.add(this.dust);
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(440, 48, 32), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 n; varying vec3 pos; void main(){ n=normalize(normalMatrix*normal); pos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 n; varying vec3 pos; void main(){ float bands=sin(pos.y*.025+sin(pos.x*.013)*2.)*.025; float light=max(0.,dot(normalize(n),normalize(vec3(-.8,.6,.4)))); float rim=pow(1.-max(0.,n.z),3.); vec3 col=mix(vec3(.013,.022,.033),vec3(.105,.15,.18),light)+bands*light; col+=vec3(.13,.23,.26)*rim*light; gl_FragColor=vec4(col,1.); }',
    }));
    this.planet.position.set(700, 160, -1650); this.scene.add(this.planet);
    const ringGeometry = new THREE.RingGeometry(560, 700, 100);
    this.planetRing = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: '#8a929b', transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.planetRing.position.copy(this.planet.position); this.planetRing.rotation.set(1.2, 0.4, -0.35); this.scene.add(this.planetRing);
    this.rockGeometries = [];
    for (let seed = 0; seed < 6; seed++) {
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const noise = 0.83 + 0.15 * Math.sin(v.x * 6 + seed * 13) * Math.cos(v.z * 7 + seed) + 0.08 * Math.cos(v.y * 11 + seed * 3);
        v.multiplyScalar(noise); pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals(); this.rockGeometries.push(geo);
    }
    this.rockMaterial = new THREE.MeshStandardMaterial({ color: '#4a505c', roughness: 0.95, metalness: 0.18, flatShading: true });
    this.menuRocks = new THREE.Group();
    [[-18, 9, -25, 3], [22, -7, -25, 5], [27, 15, -42, 4], [-7, -11, -25, 2], [13, 9, -30, 1.2], [5, 4, -40, 1]].forEach(([x,y,z,r],i) => { const rock = new THREE.Mesh(this.rockGeometries[i], this.rockMaterial); rock.position.set(x,y,z); rock.scale.setScalar(r); this.menuRocks.add(rock); });
    this.scene.add(this.menuRocks);
  }

  makeParticles() {
    this.particleCount = 1400; this.particleCursor = 0;
    this.particlePositions = new Float32Array(this.particleCount * 3);
    this.particleColors = new Float32Array(this.particleCount * 3);
    this.particleVelocity = new Float32Array(this.particleCount * 3);
    this.particleLife = new Float32Array(this.particleCount);
    this.particleMaxLife = new Float32Array(this.particleCount);
    this.particleSize = new Float32Array(this.particleCount);
    this.particlePositions.fill(99999);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.particleSize, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float size; varying vec3 c; void main(){c=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*300./max(1.,-p.z),0.,70.);}',
      fragmentShader: 'varying vec3 c; void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(c,pow(1.-d,1.8));}',
    });
    this.particles = new THREE.Points(geo, material); this.particles.frustumCulled = false; this.scene.add(this.particles);
  }

  emit(position, count, color, scale = 1) {
    const c = new THREE.Color(color);
    const amount = this.settings.quality === 'low' ? Math.ceil(count * 0.45) : count;
    for (let n = 0; n < amount; n++) {
      const i = this.particleCursor++ % this.particleCount, offset = i * 3;
      this.particlePositions.set(position, offset);
      v.randomDirection().multiplyScalar((2 + Math.random() * 13) * scale);
      this.particleVelocity.set(v.toArray(), offset);
      this.particleColors.set([c.r, c.g * (0.6 + Math.random() * 0.4), c.b], offset);
      this.particleMaxLife[i] = this.particleLife[i] = 0.3 + Math.random() * 1.2;
      this.particleSize[i] = scale;
    }
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  makeBullets() {
    this.bulletMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 2.8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 750);
    this.bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.bulletMesh.count = 0; this.bulletMesh.frustumCulled = false; this.scene.add(this.bulletMesh);
    this.muzzleLight = new THREE.PointLight('#ffd0a0', 0, 16); this.scene.add(this.muzzleLight);
    this.machineColor = new THREE.Color('#8fffff'); this.cannonColor = new THREE.Color('#ffac68');
  }

  setQuality(quality) {
    this.settings.quality = quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.35 : 1));
    this.stars.geometry.setDrawRange(0, quality === 'low' ? 1600 : 3800);
    this.dust.geometry.setDrawRange(0, quality === 'low' ? 500 : 1600);
    this.resize();
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }

  bindControls() {
    addEventListener('resize', () => this.resize());
    addEventListener('keydown', e => {
      if (!this.active || document.querySelector('dialog[open]')) return;
      if (['Tab','Space','ShiftLeft','ShiftRight','KeyW','KeyA','KeyS','KeyD','KeyR','KeyQ','KeyE'].includes(e.code)) e.preventDefault();
      if (e.code === 'Tab') { $('scoreboard').classList.remove('hidden'); this.hooks.ranking(); }
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC' && !e.repeat) { this.firstPerson = !this.firstPerson; $('camera-label').innerHTML = `${this.firstPerson ? 'PRIMERA' : 'TERCERA'} PERSONA <b>[C]</b>`; }
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'Tab') $('scoreboard').classList.add('hidden'); });
    addEventListener('mousemove', e => {
      if (!this.locked || !this.local?.alive) return;
      const sensitivity = 0.0017 * this.settings.sensitivity;
      this.aim.multiply(q.setFromAxisAngle(Y, -clamp(e.movementX, -200, 200) * sensitivity));
      this.aim.multiply(q.setFromAxisAngle(X, -clamp(e.movementY, -200, 200) * sensitivity * (this.settings.invert ? -1 : 1)));
      this.aim.normalize();
    });
    addEventListener('mousedown', e => { if (this.locked) { if (e.button === 0) this.mouse.left = true; if (e.button === 2) this.mouse.right = true; } });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) { this.engaged = true; $('flight-gate').classList.add('hidden'); $('pause').classList.add('hidden'); }
      else { this.clearInput(); if (this.active && this.engaged) $('pause').classList.remove('hidden'); }
    });
    document.addEventListener('pointerlockerror', () => this.hooks.toast('No se pudo capturar el mouse. Haz clic en Entrar en cabina para reintentar.'));
    addEventListener('blur', () => { this.clearInput(); if (this.locked) document.exitPointerLock(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clearInput(); });
    this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.clearInput(); this.hooks.toast('Se perdió el contexto gráfico. Recarga para recuperar tu sesión.'); });
  }

  get locked() { return document.pointerLockElement === this.canvas; }
  clearInput() { this.keys.clear(); this.mouse.left = this.mouse.right = false; if (this.active && this.local) this.hooks.send({ type: 'input', input: { ...emptyInput(), q: this.aim.toArray() } }); }
  engage() {
    this.audio.unlock();
    try { const result = this.canvas.requestPointerLock(); result?.catch(() => this.hooks.toast('Haz clic de nuevo para activar el mouse.')); }
    catch { this.hooks.toast('Este navegador no permite capturar el mouse. Usa Chrome, Edge o Firefox en un ordenador.'); }
  }

  begin(id) {
    this.clearWorld(); this.id = id; this.active = true; this.engaged = false; this.local = null; this.snapshot = null; this.lastAlive = false;
    this.menuShip.visible = this.menuRocks.visible = false;
    this.machineCooldown = this.cannonCooldown = 0; this.shake = 0;
    $('flight-gate').classList.remove('hidden'); $('kill-feed').replaceChildren();
  }

  end() {
    this.active = false; this.clearInput(); if (this.locked) document.exitPointerLock();
    this.menuShip.visible = this.menuRocks.visible = true;
    this.clearWorld(); this.audio.flight(0, false, false);
    ['flight-gate','pause','death','scoreboard','kill-banner'].forEach(id => $(id).classList.add('hidden'));
  }

  clearWorld() {
    for (const o of this.ships.values()) { this.scene.remove(o.mesh); freeShip(o.mesh); }
    this.ships.clear();
    for (const o of this.rocks.values()) this.scene.remove(o.mesh);
    this.rocks.clear();
    for (const o of this.indicators.values()) o.remove();
    this.indicators.clear(); this.bulletMesh.count = 0; this.particleLife.fill(0); this.particleSize.fill(0);
    this.snapshot = null; this.local = null;
  }

  receive(state) {
    if (!this.active) return;
    this.snapshot = state; this.lastSnapshotAt = performance.now();
    const me = state.players.find(p => p.id === this.id);
    if (me) {
      const respawned = me.alive && !this.lastAlive;
      if (!this.local || respawned) {
        this.local = { ...me, p: new THREE.Vector3().fromArray(me.p), v: new THREE.Vector3().fromArray(me.v), q: new THREE.Quaternion().fromArray(me.q) };
        this.aim.copy(this.local.q); this.camera.position.copy(this.local.p);
      } else {
        const distance = this.local.p.distanceTo(v.fromArray(me.p));
        this.local.p.lerp(v, distance > 18 ? 1 : 0.23);
        this.local.v.lerp(v.fromArray(me.v), 0.25);
        for (const key of ['hp','energy','energyDelay','boostLocked','alive','shield','respawn','kills','deaths']) this.local[key] = me[key];
      }
      if (!me.alive) { $('death').classList.remove('hidden'); $('respawn-count').textContent = Math.max(1, Math.ceil(me.respawn)); }
      else $('death').classList.add('hidden');
      this.lastAlive = me.alive;
    }
    const playerIds = new Set();
    for (const p of state.players) {
      playerIds.add(p.id);
      if (!this.ships.has(p.id)) {
        const mesh = makeShip(p.color); mesh.position.fromArray(p.p); mesh.quaternion.fromArray(p.q); mesh.scale.setScalar(0.62); this.scene.add(mesh);
        this.ships.set(p.id, { mesh, state: p, targetP: new THREE.Vector3(), targetQ: new THREE.Quaternion() });
      }
      const o = this.ships.get(p.id); o.state = p; o.targetP.fromArray(p.p); o.targetQ.fromArray(p.q);
      if (o.mesh.position.distanceTo(o.targetP) > 35) o.mesh.position.copy(o.targetP);
      if (p.id !== this.id && !this.indicators.has(p.id)) {
        const label = document.createElement('div'); label.className = 'enemy-label';
        const diamond = document.createElement('span'); diamond.className = 'diamond'; diamond.textContent = '◇';
        const name = document.createElement('span'); name.textContent = p.name;
        const distance = document.createElement('small'); label.append(diamond, name, distance); $('enemy-indicators').append(label); this.indicators.set(p.id, label);
      }
    }
    for (const [id, o] of this.ships) if (!playerIds.has(id)) { this.scene.remove(o.mesh); freeShip(o.mesh); this.ships.delete(id); this.indicators.get(id)?.remove(); this.indicators.delete(id); }
    const rockIds = new Set();
    for (const a of state.asteroids) {
      rockIds.add(a.id);
      if (!this.rocks.has(a.id)) {
        const mesh = new THREE.Mesh(this.rockGeometries[a.seed % 6], this.rockMaterial); mesh.scale.setScalar(a.r); mesh.position.fromArray(a.p); this.scene.add(mesh); this.rocks.set(a.id, { mesh, state: a });
      }
      this.rocks.get(a.id).state = a;
    }
    for (const [id, o] of this.rocks) if (!rockIds.has(id)) { this.scene.remove(o.mesh); this.rocks.delete(id); }
    for (const e of state.events) this.event(e);
  }

  event(e) {
    if (e.type === 'rock') { this.emit(e.p, Math.min(110, e.r * 10), '#ffb583', e.r * 0.3); this.audio.explosion(this.local ? this.local.p.distanceTo(v.fromArray(e.p)) : 200); }
    if (e.type === 'spark') this.emit(e.p, 5, '#ffc591', 0.45);
    if (e.type === 'hit') {
      this.emit(e.p, 8, '#8be8ff', 0.7);
      if (e.owner === this.id) { this.audio.hit(); window.gsap?.fromTo('#hit-marker', { opacity: 1, scale: 1.2 }, { opacity: 0, scale: 0.7, duration: 0.22, overwrite: true }); }
      if (e.target === this.id) { this.shake = Math.min(0.7, this.shake + 0.3); window.gsap?.fromTo('#damage-flash', { opacity: 1 }, { opacity: 0, duration: 0.5, overwrite: true }); this.audio.burst(0.15, 0.16, 400); }
    }
    if (e.type === 'death') {
      this.emit(e.p, 150, '#ffbd87', 3); this.emit(e.p, 50, e.color, 1.8);
      this.audio.explosion(this.local ? this.local.p.distanceTo(v.fromArray(e.p)) : 200);
      const entry = document.createElement('div'), killer = document.createElement('b'); killer.textContent = e.killer;
      entry.append(killer, document.createTextNode(`  ›  ${e.victim}`)); $('kill-feed').prepend(entry);
      while ($('kill-feed').children.length > 5) $('kill-feed').lastChild.remove();
      setTimeout(() => entry.remove(), 6500);
      if (e.owner === this.id) {
        this.audio.kill(); $('kill-banner').classList.remove('hidden');
        window.gsap?.fromTo('#kill-banner', { opacity: 1, y: 12 }, { y: 0, duration: 0.25, overwrite: true });
        clearTimeout(this.bannerTimeout); this.bannerTimeout = setTimeout(() => $('kill-banner').classList.add('hidden'), 1800);
      }
    }
  }

  input(dt) {
    if (this.locked && this.local?.alive) {
      const roll = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
      this.aim.multiply(q.setFromAxisAngle(Z, roll * dt * 1.9)).normalize();
      return { x: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')), z: Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')), y: Number(this.keys.has('Space')) - Number(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')), boost: this.keys.has('KeyR'), fire: this.mouse.left, cannon: this.mouse.right, q: this.aim.toArray() };
    }
    return { ...emptyInput(), q: this.aim.toArray() };
  }

  updatePlaying(dt, now) {
    if (!this.local || !this.snapshot) return;
    const input = this.input(dt);
    if (this.local.alive) fly(this.local, input, dt);
    if (now - this.sendAt > 32) { this.hooks.send({ type: 'input', input }); this.sendAt = now; }
    this.machineCooldown = Math.max(0, this.machineCooldown - dt); this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);
    if (this.local.alive) {
      if (input.fire && !this.machineCooldown) { this.audio.shot('machine'); this.machineCooldown = WEAPONS.machine.interval; this.muzzleLight.intensity = 6; this.shake = Math.max(this.shake, 0.025); }
      if (input.cannon && !this.cannonCooldown) { this.audio.shot('cannon'); this.cannonCooldown = WEAPONS.cannon.interval; this.muzzleLight.intensity = 18; this.shake = Math.max(this.shake, 0.16); }
    }
    const alpha = 1 - Math.exp(-14 * dt), age = Math.min(0.13, (now - this.lastSnapshotAt) / 1000);
    for (const [id, o] of this.ships) {
      const self = id === this.id;
      o.mesh.visible = o.state.alive && !(self && this.firstPerson);
      if (self) { o.mesh.position.copy(this.local.p); o.mesh.quaternion.copy(this.local.q); }
      else {
        v.copy(o.targetP).addScaledVector(v2.fromArray(o.state.v), age);
        o.mesh.position.lerp(v, alpha); o.mesh.quaternion.slerp(o.targetQ, alpha);
      }
      o.mesh.userData.shield.visible = o.state.shield > 0;
      for (const flame of o.mesh.userData.flames) { flame.scale.y = (o.state.boosting ? 2.6 : 0.8) * (0.9 + Math.random() * 0.2); flame.material.opacity = o.state.boosting ? 0.9 : 0.5; }
    }
    for (const o of this.rocks.values()) {
      v.fromArray(o.state.p).addScaledVector(v2.fromArray(o.state.v), age); o.mesh.position.lerp(v, alpha);
      const t = this.snapshot.time + age;
      o.mesh.rotation.set(o.state.seed + t * 0.025, o.state.seed * 0.3 + t * 0.018, t * 0.01);
    }
    this.bulletMesh.count = Math.min(this.snapshot.bullets.length, 750);
    this.snapshot.bullets.slice(0, 750).forEach((b, i) => {
      dummy.position.fromArray(b.p).addScaledVector(v.fromArray(b.v), age);
      dummy.quaternion.setFromUnitVectors(Z, v.normalize()); dummy.scale.setScalar(b.kind === 'cannon' ? 1.4 : 1);
      dummy.updateMatrix(); this.bulletMesh.setMatrixAt(i, dummy.matrix); this.bulletMesh.setColorAt(i, b.kind === 'cannon' ? this.cannonColor : this.machineColor);
    });
    this.bulletMesh.instanceMatrix.needsUpdate = true; if (this.bulletMesh.instanceColor) this.bulletMesh.instanceColor.needsUpdate = true;
    const offset = this.firstPerson ? v.set(0, 0.48, -1.45) : v.set(0, 2.5, this.local.boosting ? 12.5 : 10.5);
    offset.applyQuaternion(this.local.q).add(this.local.p);
    if (this.firstPerson) this.camera.position.copy(offset); else this.camera.position.lerp(offset, 1 - Math.exp(-11 * dt));
    this.camera.quaternion.copy(this.local.q);
    if (!this.firstPerson) this.camera.quaternion.multiply(q.setFromAxisAngle(X, -0.012));
    this.shake *= Math.exp(-10 * dt);
    if (this.local.alive && this.shake > 0.005) this.camera.position.add(v.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0).applyQuaternion(this.local.q));
    const fov = this.local.boosting ? 82 : this.firstPerson ? 76 : 65;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-5 * dt)); this.camera.updateProjectionMatrix(); }
    this.muzzleLight.position.copy(this.local.p); this.muzzleLight.intensity *= Math.exp(-20 * dt);
    this.audio.flight(this.local.v.length(), this.local.boosting, this.local.alive && this.locked);
    this.camera.updateMatrixWorld();
    if (now - this.uiAt > 80) { this.updateHUD(age); this.uiAt = now; }
  }

  updateHUD(age) {
    const p = this.local;
    const time = Math.max(0, Math.ceil(this.snapshot.remaining - age));
    $('timer').textContent = `${String(Math.floor(time / 60)).padStart(2,'0')}:${String(time % 60).padStart(2,'0')}`;
    $('timer').parentElement.classList.toggle('urgent', time <= 30);
    $('kills').textContent = String(p.kills).padStart(2,'0');
    const ranked = [...this.snapshot.players].sort((a,b) => b.kills - a.kills || a.deaths - b.deaths);
    $('position-label').textContent = `${ranked.findIndex(s => s.id === this.id) + 1}.º / ${ranked.length}`;
    $('health-number').textContent = Math.ceil(p.hp); $('health-fill').style.width = `${p.hp}%`;
    $('health-fill').style.background = p.hp < 30 ? '#ff8979' : 'var(--cyan)';
    $('shield-label').textContent = p.shield > 0 ? 'ESCUDO DE REAPARICIÓN ACTIVO' : p.hp < 30 ? 'INTEGRIDAD CRÍTICA · EVITA IMPACTOS' : 'WRAITH 01 · SISTEMAS NOMINALES';
    $('boost-number').textContent = Math.round(p.energy); $('boost-fill').style.height = `${p.energy}%`; $('boost-fill').style.background = p.boostLocked ? 'var(--accent)' : 'var(--cyan)';
    $('speed').textContent = Math.round(p.v.length());
    $('cannon-status').textContent = this.cannonCooldown > 0.05 ? `${this.cannonCooldown.toFixed(1)} S` : 'LISTO';
    $('boundary-warning').classList.toggle('hidden', p.p.length() < WORLD_RADIUS - 22);
    $('network-stats').textContent = `${this.ping} MS · ${this.fps} FPS`;
    let aimed = null;
    for (const [id, label] of this.indicators) {
      const o = this.ships.get(id);
      if (!o || !o.state.alive || !p.alive) { label.hidden = true; continue; }
      const distance = o.mesh.position.distanceTo(p.p);
      v.copy(o.mesh.position).project(this.camera);
      const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.78;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; label.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight - 25}px`;
        label.lastChild.textContent = `${Math.round(distance)} M`; label.style.opacity = distance > 230 ? '0.4' : '0.85';
        if (Math.abs(v.x) < 0.07 && Math.abs(v.y) < 0.07) aimed = o.state.name;
      }
    }
    $('target-label').textContent = aimed || '';
    $('crosshair').style.opacity = p.alive ? '0.85' : '0';
  }

  animate(now) {
    requestAnimationFrame(this.animate);
    const dt = Math.min((now - this.lastTime) / 1000, 0.05); this.lastTime = now;
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime >= 0.7) { this.fps = Math.round(this.frames / this.fpsTime); this.frames = 0; this.fpsTime = 0; }
    if (this.active) this.updatePlaying(dt, now);
    else {
      const t = now * 0.001;
      this.camera.position.set(0, 5, 29); this.camera.lookAt(0, 0, 0);
      if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
      this.menuShip.position.y = Math.sin(t * 0.4) * 0.55 + 0.8;
      this.menuShip.rotation.set(0.13 + Math.sin(t * 0.2) * 0.06, -0.48 + Math.sin(t * 0.12) * 0.2, -0.22);
      this.menuRocks.children.forEach((rock,i) => { rock.rotation.x = t * 0.025 + i; rock.rotation.y = t * 0.018 + i; });
      for (const flame of this.menuShip.userData.flames) flame.scale.y = 0.65 + Math.sin(t * 16) * 0.06;
    }
    for (let i = 0; i < this.particleCount; i++) {
      if (this.particleLife[i] <= 0) { this.particleSize[i] = 0; continue; }
      this.particleLife[i] -= dt; const offset = i * 3;
      for (let j = 0; j < 3; j++) this.particlePositions[offset+j] += this.particleVelocity[offset+j] * dt;
      this.particleSize[i] = Math.max(0, this.particleLife[i] / this.particleMaxLife[i]) * 1.8;
    }
    this.particles.geometry.attributes.position.needsUpdate = true; this.particles.geometry.attributes.size.needsUpdate = true;
    this.stars.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
