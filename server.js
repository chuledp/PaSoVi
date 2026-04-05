const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

function getLocalIPs() {
  const results = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push(iface.address);
      }
    }
  }
  return results;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 8;
const rooms = new Map();

const WORLD_TYPES = 6;
const PALETTES = 8;

// Returns array [0..7] in a random order — used as synth pick pool per room
function shuffledSynths() {
  const a = [0,1,2,3,4,5,6,7];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateWorldSeed() {
  return {
    seed: Math.floor(Math.random() * 99999),
    worldType: Math.floor(Math.random() * WORLD_TYPES),
    size: 0.6 + Math.random() * 2.2,
    palette: Math.floor(Math.random() * PALETTES),
    hasGround: Math.random() > 0.4,
    fogDensity: 0.008 + Math.random() * 0.035,
    elementCount: 40 + Math.floor(Math.random() * 120)
  };
}

io.on('connection', (socket) => {
  console.log('[+] Connected:', socket.id);

  // Find room with space, or create new one
  let roomId = null;
  for (const [id, room] of rooms) {
    if (room.players.size < MAX_PLAYERS) {
      roomId = id;
      break;
    }
  }

  if (!roomId) {
    roomId = Math.random().toString(36).substr(2, 9);
    rooms.set(roomId, {
      id: roomId,
      players: new Map(),
      worldSeed: null,               // generated lazily when first player arrives
      colorPool: [0,1,2,3,4,5,6,7],
      synthPool: shuffledSynths()
    });
    console.log('[+] New room:', roomId);
  }

  const room = rooms.get(roomId);

  // Fresh world seed when room is empty (first arrival)
  if (room.players.size === 0) room.worldSeed = generateWorldSeed();

  // Draw color and synth slots from their respective pools
  const playerIndex = room.colorPool.length > 0
    ? room.colorPool.shift()         // shift keeps order: 0,1,2,3...
    : room.players.size % 8;         // fallback edge case
  const synthIndex = room.synthPool.length > 0
    ? room.synthPool.pop()
    : Math.floor(Math.random() * 8);

  const playerData = {
    id: socket.id,
    index: playerIndex,   // visual index → color
    synthIndex,           // audio synthesis profile (random, non-repeating)
    x: (Math.random() - 0.5) * 30,
    y: 3,
    z: (Math.random() - 0.5) * 30,
    rotY: 0
  };

  room.players.set(socket.id, playerData);
  socket.join(roomId);
  socket.roomId = roomId;

  // Send world state and existing players
  socket.emit('init', {
    playerId: socket.id,
    playerIndex,       // visual color slot
    playerSynthIndex: synthIndex,  // audio synthesis profile
    worldSeed: room.worldSeed,
    players: Array.from(room.players.values())
  });

  // Notify others
  socket.to(roomId).emit('playerJoined', playerData);

  // After 800 ms: if this player is still the only one, guarantee a fresh world.
  // This covers the race where a refresh re-connects before the old socket disconnects.
  setTimeout(() => {
    const r = rooms.get(roomId);
    if (r && r.players.size === 1 && r.players.has(socket.id)) {
      r.worldSeed = generateWorldSeed();
      socket.emit('newWorld', { worldSeed: r.worldSeed });
      console.log(`[~] Solo refresh → new world type ${r.worldSeed.worldType}`);
    }
  }, 800);

  socket.on('move', (data) => {
    const player = room.players.get(socket.id);
    if (!player) return;
    player.x = data.x;
    player.y = data.y;
    player.z = data.z;
    player.rotY = data.rotY;
    socket.to(roomId).emit('playerMoved', { id: socket.id, ...data });
  });

  socket.on('sound', (data) => {
    socket.to(roomId).emit('playerSound', { id: socket.id, ...data });
  });

  socket.on('requestNewWorld', () => {
    room.worldSeed = generateWorldSeed();
    io.to(roomId).emit('newWorld', { worldSeed: room.worldSeed });
    console.log(`[~] New world for room ${roomId}: type ${room.worldSeed.worldType}`);
  });

  socket.on('disconnect', () => {
    console.log('[-] Disconnected:', socket.id);
    const r = rooms.get(socket.roomId);
    if (!r) return;
    const leaving = r.players.get(socket.id);
    r.players.delete(socket.id);
    if (leaving) {
      if (leaving.synthIndex !== undefined && r.synthPool.length < 8)
        r.synthPool.push(leaving.synthIndex);
      if (leaving.index !== undefined && r.colorPool.length < 8)
        r.colorPool.push(leaving.index);
    }
    io.to(socket.roomId).emit('playerLeft', socket.id);

    if (r.players.size === 0) {
      rooms.delete(socket.roomId);
      console.log('[-] Room closed:', socket.roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;

// Bind to all interfaces so other machines on the LAN can connect
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log(`  ║  SoundWorld  →  http://localhost:${PORT}    ║`);
  console.log('  ╠══════════════════════════════════════════╣');
  if (ips.length > 0) {
    ips.forEach(ip => {
      const url = `http://${ip}:${PORT}`;
      const pad = ' '.repeat(Math.max(0, 41 - url.length));
      console.log(`  ║  Red local  →  ${url}${pad}║`);
    });
    console.log('  ║                                          ║');
    console.log('  ║  Comparte la URL de red con otros        ║');
    console.log('  ║  jugadores conectados al mismo WiFi      ║');
  } else {
    console.log('  ║  (no se detectó IP de red local)         ║');
  }
  console.log('  ╚══════════════════════════════════════════╝\n');
});
