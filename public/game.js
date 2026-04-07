// game.js — SoundWorld Main Engine

const PLAYER_COLORS = [
  0xff4466, // rojo
  0xff8844, // naranja
  0xffee00, // amarillo
  0x44ff88, // verde
  0x00ffee, // cian
  0x4488ff, // azul
  0xaa44ff, // violeta
  0xff44aa  // rosa
];

const PLAYER_COLOR_NAMES = [
  'ROJO', 'NARANJA', 'AMARILLO', 'VERDE',
  'CIAN', 'AZUL', 'VIOLETA', 'ROSA'
];

// ─── Globals ──────────────────────────────────────────────────────────────────

let scene, camera, renderer;
let worldGen = null;
let socket = null;
let localPlayer = null;       // { id, index }
let playerMeshes = new Map(); // id -> THREE.Mesh
let isAdmin = false;

const audio = new AudioSystem();
const keys = {};
let yaw = 0, pitch = 0;
let isPointerLocked = false;
let lastNetSend = 0;

// ─── Entry point ──────────────────────────────────────────────────────────────

function startGame() {
  const aliasInput = document.getElementById('alias-input');
  const alias = (aliasInput ? aliasInput.value.trim() : '') || 'ANÓNIMO';
  const adminKey = new URLSearchParams(window.location.search).get('admin') || '';
  document.getElementById('overlay').style.display = 'none';
  _initThree();
  _initInput();
  _initNetwork(alias, adminKey);
  _initReverbPanel();
  _animate();
}

// ─── Three.js setup ───────────────────────────────────────────────────────────

function _initThree() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1200);
  camera.position.set(0, 3, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ─── Input ────────────────────────────────────────────────────────────────────

function _initInput() {
  // Pointer lock
  renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPointerLocked) return;
    yaw   -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    // Prevent scroll on space/arrows
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }

    const k = e.key.toLowerCase();
    keys[k] = true;

    // R — randomize local sound parameters
    if (k === 'r' && localPlayer && audio.initialized && !e.repeat) {
      const params = audio.randomize();
      _showRandomizeToast(params);
    }

    // N — request new world (admin only)
    if (k === 'n' && isAdmin && socket && !e.repeat) {
      socket.emit('requestNewWorld');
    }

    // Musical notes
    if (localPlayer && audio.initialized && !e.repeat) {
      if (audio.keyMap[k] !== undefined) {
        audio.playLocalNote(k, localPlayer.synthIndex);
        if (socket) {
          socket.emit('sound', {
            key: k,
            action: 'start',
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z
          });
        }
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = false;

    if (localPlayer && audio.initialized) {
      if (audio.keyMap[k] !== undefined) {
        audio.stopLocalNote(k);
        if (socket) socket.emit('sound', { key: k, action: 'stop' });
      }
    }
  });

  // Release all notes when the window loses focus (tab switch, alt-tab, etc.)
  // This is the main cause of stuck notes — keyup never fires outside the window
  window.addEventListener('blur', () => {
    if (!audio.initialized) return;
    // Stop and notify server for every active local note
    for (const key of [...audio.localNotes.keys()]) {
      audio.stopLocalNote(key);
      if (socket) socket.emit('sound', { key, action: 'stop' });
    }
    // Also clear all movement keys
    for (const k of Object.keys(keys)) keys[k] = false;
  });
}

// ─── Network ──────────────────────────────────────────────────────────────────

function _initNetwork(alias, adminKey) {
  socket = io({ query: { alias, adminKey } });

  // Botón nuevo mundo — solo para admin
  const newWorldBtn = document.getElementById('new-world-btn');
  if (newWorldBtn) {
    newWorldBtn.addEventListener('click', () => {
      if (!isAdmin) return;
      socket.emit('requestNewWorld');
    });
  }

  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('init', async (data) => {
    console.log('World seed:', data.worldSeed, '| You are player', data.playerIndex);

    // AudioContext must start after user gesture — the click on ENTRAR qualifies
    await audio.init();

    // Build the world
    worldGen = new WorldGenerator(scene, data.worldSeed);
    worldGen.generate();

    // Configure Resonance Audio room acoustics to match world type
    audio.setWorldType(data.worldSeed.worldType);

    // Set local player (index = visual color slot, synthIndex = audio profile)
    localPlayer = { id: data.playerId, index: data.playerIndex, synthIndex: data.playerSynthIndex };
    isAdmin = !!data.isAdmin;
    _applyAdminUI();

    // Spawn somewhere random
    camera.position.set(
      (Math.random() - 0.5) * 25,
      3,
      (Math.random() - 0.5) * 25
    );

    // Add a local player point-light (your light in the world)
    const localLight = new THREE.PointLight(
      PLAYER_COLORS[localPlayer.index % PLAYER_COLORS.length],
      2.0, 25
    );
    camera.add(localLight);
    scene.add(camera); // camera must be in scene for attached lights

    // Add all existing players
    for (const p of data.players) {
      if (p.id !== data.playerId) _spawnPlayer(p);
    }

    _updateHUD();
  });

  socket.on('playerJoined', (p) => {
    _spawnPlayer(p);
    _updateHUD();
  });

  socket.on('playerMoved', (data) => {
    const mesh = playerMeshes.get(data.id);
    if (mesh) {
      // Smooth lerp is handled in game loop; set target
      mesh.userData.targetX = data.x;
      mesh.userData.targetY = data.y;
      mesh.userData.targetZ = data.z;
    }
    audio.updatePlayerPosition(data.id, data.x, data.y, data.z);
  });

  socket.on('playerLeft', (id) => {
    _despawnPlayer(id);
    _updateHUD();
  });

  socket.on('newWorld', (data) => {
    console.log('[game] newWorld received, type:', data.worldSeed.worldType);
    try {
      if (worldGen) { worldGen.cleanup(); worldGen = null; }
      worldGen = new WorldGenerator(scene, data.worldSeed);
      worldGen.generate();
      audio.setWorldType(data.worldSeed.worldType);
      console.log('[game] world rebuilt OK');
    } catch(e) {
      console.error('[newWorld] rebuild failed:', e);
    }
  });

  // Admin-broadcast reverb changes — apply on all non-admin clients
  const _reverbApply = {
    lDecay:    v => audio.setLocalReverbDecay(v),
    lWet:      v => audio.setLocalReverbWet(v),
    lDry:      v => audio.setLocalReverbDry(v),
    sDecay:    v => audio.setSpatialReverbDecay(v),
    sWet:      v => audio.setSpatialReverbWet(v),
    sDry:      v => audio.setSpatialReverbDry(v),
    masterGain:v => audio.setMasterGain(v),
  };
  socket.on('applyReverb', ({ param, value }) => {
    if (_reverbApply[param]) _reverbApply[param](value);
  });

  socket.on('playerSound', (data) => {
    // noteoff — no need for mesh, just kill by id+key
    if (data.action === 'stop') {
      audio.stopRemoteNote(data.key, data.id);
      return;
    }
    // noteon — need position and synthesis profile
    const mesh = playerMeshes.get(data.id);
    if (!mesh) return;
    audio.playRemoteNote(
      data.key, data.id, mesh.userData.synthIndex,
      mesh.position.x, mesh.position.y, mesh.position.z
    );
  });
}

// ─── Alias sprite ─────────────────────────────────────────────────────────────

function _createAliasSprite(alias, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 80;
  const ctx = canvas.getContext('2d');

  // Measure text first to size background
  ctx.font = 'bold 32px monospace';
  const textW = ctx.measureText(alias).width;
  const pad = 24;

  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const rx = (512 - textW - pad * 2) / 2;
  ctx.beginPath();
  ctx.roundRect(rx, 16, textW + pad * 2, 48, 10);
  ctx.fill();

  // Text in player color
  const hex = '#' + color.toString(16).padStart(6, '0');
  ctx.fillStyle = hex;
  ctx.textAlign = 'center';
  ctx.fillText(alias, 256, 52);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.2, 0.5, 1);
  sprite.position.set(0, 1.4, 0); // above the sphere
  return sprite;
}

// ─── Player management ────────────────────────────────────────────────────────

function _spawnPlayer(player) {
  const color = PLAYER_COLORS[player.index % PLAYER_COLORS.length];

  // Orb body
  const geo = new THREE.SphereGeometry(0.55, 20, 20);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.92,
    roughness: 0.1,
    metalness: 0.6
  });
  const orb = new THREE.Mesh(geo, mat);
  orb.position.set(player.x, player.y, player.z);
  orb.userData.playerIndex = player.index;
  orb.userData.synthIndex  = player.synthIndex !== undefined ? player.synthIndex : player.index;

  // Alias label floating above the orb
  const aliasText = (player.alias || 'ANÓNIMO').toUpperCase();
  const sprite = _createAliasSprite(aliasText, color);
  orb.add(sprite);
  orb.userData.targetX = player.x;
  orb.userData.targetY = player.y;
  orb.userData.targetZ = player.z;

  // Wireframe halo (rotates independently)
  const haloGeo = new THREE.IcosahedronGeometry(1.1, 1);
  const haloMat = new THREE.MeshBasicMaterial({
    color, wireframe: true, transparent: true, opacity: 0.18
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  orb.add(halo);
  orb.userData.halo = halo;

  // Point light — they illuminate the world around them
  const light = new THREE.PointLight(color, 1.8, 22);
  orb.add(light);

  scene.add(orb);
  playerMeshes.set(player.id, orb);

  // Spatial audio — use synthIndex for sound profile
  const pSynth = player.synthIndex !== undefined ? player.synthIndex : player.index;
  audio.addPlayer(player.id, pSynth);
  audio.updatePlayerPosition(player.id, player.x, player.y, player.z);
}

function _despawnPlayer(id) {
  // Kill any stuck notes before removing the player
  audio.stopAllNotesForPlayer(id);
  audio.removePlayer(id);
  const mesh = playerMeshes.get(id);
  if (mesh) {
    scene.remove(mesh);
    playerMeshes.delete(id);
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

function _updateHUD() {
  const countEl = document.getElementById('player-count');
  const nameEl = document.getElementById('local-player-name');
  if (!countEl || !nameEl) return;

  const total = playerMeshes.size + (localPlayer ? 1 : 0);
  countEl.textContent = `${total} / 8 JUGADORES`;

  if (localPlayer) {
    const colorIdx  = localPlayer.index % PLAYER_COLORS.length;
    const baseSynth = localPlayer.synthIndex !== undefined ? localPlayer.synthIndex : colorIdx;
    const synthIdx  = (audio.localSynthOverride !== null && audio.localSynthOverride !== undefined)
      ? audio.localSynthOverride : baseSynth;
    const hex   = '#' + PLAYER_COLORS[colorIdx].toString(16).padStart(6, '0');
    const color = PLAYER_COLOR_NAMES[colorIdx];
    const synth = audio.synthNames ? audio.synthNames[synthIdx % 8] : '';
    const scale = audio.currentScaleName ? ` · ${audio.currentScaleName}` : '';
    nameEl.innerHTML = `<span style="color:${hex}">● ${color} · ${synth}${scale}</span>`;
  }
}

// ─── Admin UI ────────────────────────────────────────────────────────────────

function _applyAdminUI() {
  const btn = document.getElementById('new-world-btn');
  if (btn) btn.style.display = isAdmin ? 'block' : 'none';
  if (isAdmin) console.log('[★] Admin mode active');
}

// ─── Reverb panel ────────────────────────────────────────────────────────────

function _initReverbPanel() {
  if (!isAdmin) return; // Only admin can control reverb

  const panel = document.getElementById('reverb-panel');
  if (!panel) return;

  // TAB toggles panel visibility
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      panel.classList.toggle('visible');
    }
  });

  function wire(id, valId, fn, suffix = '') {
    const el = document.getElementById(id);
    const vl = document.getElementById(valId);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      vl.textContent = v.toFixed(2) + suffix;
      fn(v);
      // Broadcast to all other players in the room
      if (socket) socket.emit('adminSetReverb', { param: id, value: v });
    });
  }

  wire('lDecay',    'lDecayVal',  v => audio.setLocalReverbDecay(v),   's');
  wire('lWet',      'lWetVal',    v => audio.setLocalReverbWet(v));
  wire('lDry',      'lDryVal',    v => audio.setLocalReverbDry(v));
  wire('sDecay',    'sDecayVal',  v => audio.setSpatialReverbDecay(v), 's');
  wire('sWet',      'sWetVal',    v => audio.setSpatialReverbWet(v));
  wire('sDry',      'sDryVal',    v => audio.setSpatialReverbDry(v));
  wire('masterGain','masterVal',  v => audio.setMasterGain(v));
}

// ─── Randomize toast ─────────────────────────────────────────────────────────

function _showRandomizeToast(params) {
  let toast = document.getElementById('rand-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'rand-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.72)', 'color:#fff', 'font-family:monospace',
      'font-size:11px', 'padding:8px 16px', 'border-radius:6px',
      'border:1px solid rgba(255,255,255,0.15)', 'letter-spacing:0.06em',
      'pointer-events:none', 'transition:opacity 0.4s', 'z-index:999'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.innerHTML =
    `OCT ${params.octave} &nbsp;·&nbsp; ${params.escala} &nbsp;·&nbsp; ${params.timbre}` +
    `<br>ATK ${params.ataque} &nbsp;·&nbsp; REL ${params.release}`;
  toast.style.opacity = '1';
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => { toast.style.opacity = '0'; }, 2800);

  // Also update the synth name in the HUD
  _updateHUD();
}

// ─── Game loop ────────────────────────────────────────────────────────────────

let lastTime = 0;

function _animate() {
  requestAnimationFrame(_animate);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
  lastTime = now;

  _update(now, dt);
  renderer.render(scene, camera);
}

function _update(now, dt) {
  if (!localPlayer || !worldGen) return;

  // ── Movement ──
  const speed = 9.0;
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  // Forward vector (horizontal)
  const fwdX = -sinY;
  const fwdZ = -cosY;
  // Right vector
  const rtX = cosY;
  const rtZ = -sinY;

  if (keys['w'] || keys['arrowup']) {
    camera.position.x += fwdX * speed * dt;
    camera.position.z += fwdZ * speed * dt;
  }
  if (keys['s'] || keys['arrowdown']) {
    camera.position.x -= fwdX * speed * dt;
    camera.position.z -= fwdZ * speed * dt;
  }
  if (keys['a'] || keys['arrowleft']) {
    camera.position.x -= rtX * speed * dt;
    camera.position.z -= rtZ * speed * dt;
  }
  if (keys['d'] || keys['arrowright']) {
    camera.position.x += rtX * speed * dt;
    camera.position.z += rtZ * speed * dt;
  }
  if (keys[' '])       camera.position.y += speed * dt;
  if (keys['shift'])   camera.position.y -= speed * dt;

  // Apply rotation
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // ── Audio listener ──
  if (audio.initialized) {
    audio.updateListenerFromCamera(camera.position, yaw, pitch);
  }

  // ── Send position to server (20 fps) ──
  if (socket && now - lastNetSend > 50) {
    socket.emit('move', {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      rotY: yaw
    });
    lastNetSend = now;
  }

  // ── Update remote player orbs ──
  const t = now * 0.001;
  for (const [, mesh] of playerMeshes) {
    // Smooth position interpolation
    mesh.position.x += (mesh.userData.targetX - mesh.position.x) * 0.15;
    mesh.position.y += (mesh.userData.targetY - mesh.position.y) * 0.15;
    mesh.position.z += (mesh.userData.targetZ - mesh.position.z) * 0.15;

    // Pulsing glow
    const pulse = 0.65 + Math.sin(t * 1.8 + mesh.userData.playerIndex * 0.9) * 0.3;
    mesh.material.emissiveIntensity = pulse;

    // Rotate halo
    if (mesh.userData.halo) {
      mesh.userData.halo.rotation.y += 0.012;
      mesh.userData.halo.rotation.x += 0.007;
    }
  }

  // ── World animation ──
  worldGen.update(t);
}
