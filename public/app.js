import { SpaceGame } from './game.js';

const $ = id => document.getElementById(id);
const storage = {
  get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(`orbital.${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`orbital.${key}`, JSON.stringify(value)); } catch {} },
  remove(key) { try { localStorage.removeItem(`orbital.${key}`); } catch {} },
};
const settings = { quality: 'medium', sensitivity: 1, volume: 0.45, invert: false, ...storage.get('settings', {}) };
let game, socket, room = null, playerId = null, session = storage.get('session'), reconnectAttempts = 0;
let busy = false, busyTimer, toastTimer, resultSettings = false, resuming = false;
let invitation = new URLSearchParams(location.search).get('room');

function toast(message) {
  $('toast').textContent = message; $('toast').classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(data)); return true; } return false; }
function setBusy(value) {
  busy = value;
  ['solo-button','create-button','join-open'].forEach(id => $(id).disabled = value);
  clearTimeout(busyTimer);
  if (value) busyTimer = setTimeout(() => { setBusy(false); toast('El servidor tarda en responder. Comprueba la conexión y vuelve a intentarlo.'); }, 9000);
}
function pilotName() {
  const name = $('pilot-name').value.trim();
  if (!name) { toast('Escribe tu nombre de piloto.'); $('pilot-name').focus(); return null; }
  storage.set('name', name); return name;
}
function enter(type, solo = false, code) {
  if (busy) return;
  const name = pilotName(); if (!name) return;
  game?.audio.unlock();
  if (!send({ type, name, solo, code })) return toast('Esperando conexión con el servidor. Inténtalo en un momento.');
  setBusy(true);
}
function setView(view) {
  ['menu','lobby','hud','results'].forEach(id => $(id).classList.toggle('hidden', id !== view));
}
function updateRoom(next) {
  room = next;
  if (room.phase === 'playing') {
    resultSettings = false;
    setView('hud');
    if (!game?.active) game?.begin(playerId);
    $('hud-room').textContent = room.solo ? 'ENTRENAMIENTO / SECTOR 07' : `SALA ${room.code} / SECTOR 07`;
  } else {
    if (game?.active) game.end();
    if (room.phase === 'results' && !resultSettings) { setView('results'); renderResults(); }
    else { setView('lobby'); renderLobby(); }
  }
}
function renderLobby() {
  const host = room.host === playerId;
  $('lobby-title').textContent = room.solo ? 'Antes del despegue.' : 'Tu escuadrón.';
  $('lobby-subtitle').textContent = room.solo ? 'Elige la duración y los rivales de tu entrenamiento.' : 'Comparte el código. El vacío os espera.';
  $('room-code').textContent = room.code;
  $('copy-code').classList.toggle('hidden', room.solo);
  const humans = room.players.filter(p => !p.bot);
  $('player-count').textContent = `${humans.filter(p => p.connected).length} / ${room.solo ? 1 : 8}`;
  $('lobby-players').replaceChildren();
  for (const p of humans) {
    const row = document.createElement('div'); row.className = 'lobby-player';
    const avatar = document.createElement('span'); avatar.className = 'pilot-avatar'; avatar.style.color = p.color; avatar.textContent = '◈';
    const name = document.createElement('span'); name.textContent = p.name + (p.id === playerId ? ' (tú)' : '');
    const role = document.createElement('small'); role.textContent = !p.connected ? 'RECONECTANDO' : p.id === room.host ? 'ANFITRIÓN' : 'LISTO';
    row.append(avatar, name, role); $('lobby-players').append(row);
  }
  $('match-minutes').value = room.minutes;
  $('match-bots').value = room.botCount;
  $('match-minutes').disabled = $('match-bots').disabled = !host;
  $('start-button').disabled = !host;
  $('start-button').innerHTML = host ? 'INICIAR COMBATE <span>→</span>' : 'ESPERANDO AL ANFITRIÓN';
  $('host-note').textContent = host ? `Eres el anfitrión. ${room.botCount ? `Se añadirán hasta ${room.botCount} pilotos IA.` : 'Inicia cuando estéis listos.'}` : 'El anfitrión configura e inicia la partida.';
}
function ranking(container, players) {
  const sorted = [...players].sort((a,b) => b.kills - a.kills || a.deaths - b.deaths);
  const table = document.createElement('table'); table.className = 'ranking-table';
  const head = document.createElement('thead'); head.innerHTML = '<tr><th>#</th><th>PILOTO</th><th>BAJAS</th><th>MUERTES</th></tr>'; table.append(head);
  const body = document.createElement('tbody');
  sorted.forEach((p, i) => {
    const tr = document.createElement('tr'); if (p.id === playerId) tr.className = 'self';
    const place = document.createElement('td'); place.textContent = String(i + 1).padStart(2,'0');
    const nameCell = document.createElement('td'); const name = document.createElement('span'); name.className = 'rank-name';
    const color = document.createElement('i'); color.className = 'rank-color'; color.style.background = p.color;
    name.append(color, document.createTextNode(p.name));
    if (p.bot || p.id === playerId) { const tag = document.createElement('small'); tag.className = 'rank-you'; tag.textContent = p.bot ? 'IA' : 'TÚ'; name.append(tag); }
    nameCell.append(name);
    const kills = document.createElement('td'); kills.textContent = p.kills;
    const deaths = document.createElement('td'); deaths.textContent = p.deaths;
    tr.append(place, nameCell, kills, deaths); body.append(tr);
  });
  table.append(body); $(container).replaceChildren(table); return sorted;
}
function renderResults() {
  const sorted = ranking('final-ranking', room.players);
  const winner = sorted[0];
  const ties = sorted.filter(p => p.kills === winner?.kills && p.deaths === winner?.deaths);
  $('winner-title').textContent = ties.length > 1 ? 'Un sector disputado.' : winner?.id === playerId ? 'El sector es tuyo.' : 'Combate finalizado.';
  $('winner-subtitle').textContent = ties.length > 1 ? `Empate en cabeza · ${winner.kills} bajas / ${winner.deaths} muertes` : `${winner?.name || 'Sin pilotos'} domina la clasificación · ${winner?.kills || 0} bajas`;
  $('rematch-button').disabled = room.host !== playerId;
  $('rematch-note').textContent = room.host === playerId ? 'Tu escuadrón sigue aquí. ¿Otra ronda?' : 'Sigues en la sala. Esperando a que el anfitrión inicie otra ronda.';
}
function leave() {
  send({ type: 'leave' }); storage.remove('session'); session = null; room = null; playerId = null; resultSettings = false;
  game?.end(); setView('menu'); setBusy(false);
  history.replaceState({}, '', location.pathname);
}

function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    $('status-dot').classList.add('online'); $('connection-label').textContent = 'SERVIDOR EN LÍNEA'; $('reconnecting').classList.add('hidden');
    if (session) { resuming = true; send({ type: 'resume', code: session.code, token: session.token }); }
  });
  socket.addEventListener('message', event => {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'welcome') {
      setBusy(false); resuming = false; playerId = data.id;
      session = { token: data.token, code: data.room.code }; storage.set('session', session);
      $('join-dialog').close(); resultSettings = false; updateRoom(data.room);
      if (data.resumed) toast('Enlace recuperado. Sigues en tu sala.');
    } else if (data.type === 'room' && playerId) updateRoom(data.room);
    else if (data.type === 'state') {
      game?.receive(data);
      if (!$('scoreboard').classList.contains('hidden')) ranking('live-ranking', data.players);
    } else if (data.type === 'error') {
      setBusy(false); toast(data.message);
      if (resuming) { resuming = false; storage.remove('session'); session = null; room = null; playerId = null; game?.end(); setView('menu'); }
    } else if (data.type === 'pong' && game) game.ping = Math.max(0, Math.round(performance.now() - data.at));
  });
  socket.addEventListener('close', () => {
    $('status-dot').classList.remove('online'); $('connection-label').textContent = 'SIN CONEXIÓN';
    setBusy(false);
    if (session) { $('reconnecting').classList.remove('hidden'); game?.clearInput(); if (game?.locked) document.exitPointerLock(); }
    setTimeout(connect, Math.min(6000, 700 * Math.pow(1.5, reconnectAttempts++)));
  });
  socket.addEventListener('error', () => {});
}

try {
  game = new SpaceGame(settings, { send, toast, ranking: () => ranking('live-ranking', game.snapshot?.players || room?.players || []) });
} catch (error) {
  console.error('No se pudo iniciar el motor 3D:', error);
  $('webgl-error').classList.remove('hidden');
}

$('pilot-name').value = storage.get('name', `Piloto-${Math.floor(100 + Math.random() * 900)}`);
$('pilot-name').addEventListener('change', () => storage.set('name', $('pilot-name').value.trim()));
$('solo-button').onclick = () => enter('create', true);
$('create-button').onclick = () => enter('create', false);
$('join-open').onclick = () => { if (pilotName()) { $('join-dialog').showModal(); $('join-code').focus(); } };
$('join-form').onsubmit = e => { e.preventDefault(); enter('join', false, $('join-code').value.trim()); };
$('join-code').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0,5); });
$('controls-open').onclick = () => $('controls-dialog').showModal();
for (const id of ['settings-open','pause-settings']) $(id).onclick = () => $('settings-dialog').showModal();
document.querySelectorAll('.close-dialog').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }));
for (const id of ['leave-lobby','leave-game','leave-results']) $(id).onclick = leave;
for (const id of ['start-button','rematch-button']) $(id).onclick = () => { game?.audio.unlock(); send({ type: 'start' }); };
$('back-lobby').onclick = () => { resultSettings = true; setView('lobby'); renderLobby(); };
for (const id of ['engage-button','resume-button']) $(id).onclick = () => game?.engage();
function applyMatchSettings() { send({ type: 'settings', minutes: Number($('match-minutes').value), bots: Number($('match-bots').value) }); }
$('match-minutes').onchange = $('match-bots').onchange = applyMatchSettings;
$('copy-code').onclick = async () => {
  const url = new URL(location.href); url.search = ''; url.searchParams.set('room', room.code);
  try { await navigator.clipboard.writeText(url.href); toast('Invitación copiada. Comparte el enlace con tu escuadrón.'); }
  catch { toast(`Código de sala: ${room.code} · Comparte también la dirección de esta web.`); }
};
for (const id of ['quality','sensitivity','volume','invert']) {
  const input = $(id);
  if (id === 'invert') input.checked = settings.invert; else input.value = settings[id];
  input.addEventListener('input', () => {
    settings[id] = id === 'invert' ? input.checked : id === 'quality' ? input.value : Number(input.value);
    storage.set('settings', settings);
    if (id === 'quality') game?.setQuality(settings.quality);
    if (id === 'volume') { game?.audio.unlock(); game?.audio.setVolume(settings.volume); }
  });
}
setInterval(() => send({ type: 'ping', at: performance.now() }), 2000);
connect();
if (invitation && /^\d{5}$/.test(invitation) && !session) { $('join-code').value = invitation; $('join-dialog').showModal(); }
if (window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  gsap.from('.hero > *', { y: 20, opacity: 0, duration: 0.85, stagger: 0.1, ease: 'power2.out' });
  gsap.from('.mode-card', { y: 25, opacity: 0, duration: 0.65, stagger: 0.1, delay: 0.3, ease: 'power2.out', clearProps: 'transform,opacity' });
}
