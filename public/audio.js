// audio.js — SoundWorld Audio System v3
// - Resonance Audio binaural/ambisonic spatial rendering
// - 8 synthesis profiles (one per player index)
// - Sustained remote notes with proper noteoff
// - Anti-click exponential release

class AudioSystem {
  constructor() {
    this.ctx          = null;
    this.resonance    = null;   // ResonanceAudio scene
    this.localBus     = null;   // GainNode for non-spatial local notes
    this.initialized  = false;

    this.playerDrones = new Map(); // playerId -> { index, source, x, y, z }
    this.localNotes   = new Map(); // key      -> { synth, gainEnv, safetyId }
    this.remoteNotes  = new Map(); // `${id}:${key}` -> { synth, gainEnv, safetyId }

    // Harmonic series starting from A2 (110 Hz)
    this.baseFreqs = [110, 165, 220, 330, 440, 660, 880, 1100];

    // A minor pentatonic, 2 octaves — keys 1–0
    this.scale = [220.00, 261.63, 293.66, 349.23, 392.00,
                  440.00, 523.25, 587.33, 698.46, 783.99];

    this.keyMap = { '1':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'0':9 };

    // Names shown in UI
    this.synthNames = ['SENO','CAMPANA','SOPLO','ÓRGANO',
                       'METAL','FUZZ','CUERDA','PULSO'];

    // ── Randomizable playback parameters (R key) ──
    this.attackTime       = 0.03;   // seconds
    this.sustainGain      = 0.28;   // peak amplitude
    this.releaseTime      = 0.35;   // seconds
    this.localSynthOverride = null; // null = use assigned synthIndex
    this.currentScaleName = 'Pentatónica menor';
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init() {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      try { await this.ctx.resume(); } catch(e) {}

      // ── Local notes bus: always present, no external deps ──
      const lRev = this._makeReverb(1.2);
      const lDry = this.ctx.createGain(); lDry.gain.value = 0.62;
      const lWet = this.ctx.createGain(); lWet.gain.value = 0.38;
      this.localBus = this.ctx.createGain(); this.localBus.gain.value = 0.70;
      this.localBus.connect(lDry); lDry.connect(this.ctx.destination);
      this.localBus.connect(lRev); lRev.connect(lWet); lWet.connect(this.ctx.destination);

      // ── Spatial bus for remote notes (HRTF fallback always available) ──
      const rev = this._makeReverb(3.5);
      const dry = this.ctx.createGain(); dry.gain.value = 0.55;
      const wet = this.ctx.createGain(); wet.gain.value = 0.45;
      this.notesBus = this.ctx.createGain(); this.notesBus.gain.value = 0.72;
      this.notesBus.connect(dry); dry.connect(this.ctx.destination);
      this.notesBus.connect(rev); rev.connect(wet); wet.connect(this.ctx.destination);

      // ── Resonance Audio (optional enhancement — doesn't block init) ──
      try {
        if (typeof ResonanceAudio !== 'undefined') {
          this.resonance = new ResonanceAudio(this.ctx, { ambisonicOrder: 1 });
          this.resonance.output.connect(this.ctx.destination);
          this.setWorldType(0);
          console.log('[audio] Resonance Audio OK');
        } else {
          console.warn('[audio] ResonanceAudio not loaded, using HRTF PannerNode');
        }
      } catch(e) {
        console.warn('[audio] ResonanceAudio failed, using HRTF PannerNode:', e);
        this.resonance = null;
      }
    } catch(e) {
      console.error('[audio] init failed:', e);
    }
    this.initialized = true; // always set — notes must work even if spatial fails
  }

  // ── Room acoustics per world type ─────────────────────────────────────────
  // Called once after the world seed is received (game.js)

  setWorldType(worldType) {
    if (!this.resonance) return;
    const configs = [
      // 0 — Floating Islands: open air, large transparent canopy
      {
        dimensions: { width: 80, height: 40, depth: 80 },
        materials: {
          left: 'transparent', right: 'transparent',
          front: 'transparent', back: 'transparent',
          down: 'grass', up: 'transparent'
        }
      },
      // 1 — Crystal Forest: glass walls, marble floor — very bright reverb
      {
        dimensions: { width: 30, height: 20, depth: 30 },
        materials: {
          left: 'glass-thick', right: 'glass-thick',
          front: 'glass-thick', back: 'glass-thick',
          down: 'marble', up: 'glass-thin'
        }
      },
      // 2 — Nebula Void: effectively infinite, all transparent
      {
        dimensions: { width: 300, height: 200, depth: 300 },
        materials: {
          left: 'transparent', right: 'transparent',
          front: 'transparent', back: 'transparent',
          down: 'transparent', up: 'transparent'
        }
      },
      // 3 — Deep Abyss: enclosed cave, rough concrete — dense reverb
      {
        dimensions: { width: 20, height: 15, depth: 20 },
        materials: {
          left: 'concrete-block-coarse', right: 'concrete-block-coarse',
          front: 'concrete-block-coarse', back: 'concrete-block-coarse',
          down: 'concrete-block-coarse', up: 'concrete-block-coarse'
        }
      },
      // 4 — Sacred Geometry: marble hall, very long, warm reverb
      {
        dimensions: { width: 40, height: 20, depth: 40 },
        materials: {
          left: 'marble', right: 'marble',
          front: 'marble', back: 'marble',
          down: 'marble', up: 'marble'
        }
      },
      // 5 — Ancient Ruins: brick walls, open sky — medium reverb
      {
        dimensions: { width: 50, height: 10, depth: 50 },
        materials: {
          left: 'brick-bare', right: 'brick-bare',
          front: 'brick-bare', back: 'brick-bare',
          down: 'concrete-block-coarse', up: 'transparent'
        }
      }
    ];
    const cfg = configs[worldType % configs.length];
    this.resonance.setRoomProperties(cfg.dimensions, cfg.materials);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  // ── R key: randomize all sound generation parameters ─────────────────────

  randomize() {
    // OCTAVE: shift base pitch −2 to +2 octaves
    const octaveShift = Math.floor(Math.random() * 5) - 2;

    // SCALE: pick from musical scale library
    const SCALES = {
      'Pentatónica menor': [0,3,5,7,10],
      'Pentatónica mayor': [0,2,4,7,9],
      'Mayor':             [0,2,4,5,7,9,11],
      'Menor natural':     [0,2,3,5,7,8,10],
      'Dórica':            [0,2,3,5,7,9,10],
      'Frigia':            [0,1,3,5,7,8,10],
      'Lidia':             [0,2,4,6,7,9,11],
      'Tono entero':       [0,2,4,6,8,10],
      'Blues':             [0,3,5,6,7,10],
    };
    const names  = Object.keys(SCALES);
    const picked = names[Math.floor(Math.random() * names.length)];
    const intervals = SCALES[picked];

    // Build up to 10 notes across two octaves of the chosen scale
    const baseFreq = 110 * Math.pow(2, octaveShift); // A2 shifted
    const freqs = [];
    for (let oct = 0; freqs.length < 10; oct++) {
      for (const st of intervals) {
        freqs.push(baseFreq * Math.pow(2, oct + st / 12));
        if (freqs.length >= 10) break;
      }
    }
    this.scale = freqs;
    this.currentScaleName = picked;

    // WAVEFORM / SYNTH: random profile for local player
    this.localSynthOverride = Math.floor(Math.random() * 8);

    // ADSR
    this.attackTime  = 0.002 + Math.random() * 0.45;   // 2ms – 450ms
    this.sustainGain = 0.07  + Math.random() * 0.55;   // quiet – loud
    this.releaseTime = 0.04  + Math.random() * 2.2;    // snappy – long fade

    return {
      octave:  octaveShift >= 0 ? `+${octaveShift}` : `${octaveShift}`,
      escala:  picked,
      timbre:  this.synthNames[this.localSynthOverride],
      ataque:  (this.attackTime  * 1000).toFixed(0) + ' ms',
      release: (this.releaseTime * 1000).toFixed(0) + ' ms',
    };
  }

  _makeReverb(dur) {
    const sr  = this.ctx.sampleRate;
    const len = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // Smooth anti-click release — exponential decay, never cuts to zero abruptly
  _releaseGain(gainParam, decaySeconds) {
    const t = this.ctx.currentTime;
    if (gainParam.cancelAndHoldAtTime) {
      gainParam.cancelAndHoldAtTime(t);
    } else {
      gainParam.cancelScheduledValues(t);
      gainParam.setValueAtTime(gainParam.value || 0.001, t);
    }
    // setTargetAtTime approaches 0 asymptotically — smooth, click-free
    gainParam.setTargetAtTime(0, t, decaySeconds / 5);
  }

  // ── 8 Synthesis Profiles — each uses a fundamentally different method ──────
  // Returns { gain: GainNode, stop: Function }

  // 0 — SENO: pure sine + very slow vibrato — the cleanest possible sound
  _s0(freq) {
    const osc  = this.ctx.createOscillator();
    osc.type   = 'sine'; osc.frequency.value = freq;
    const lfo  = this.ctx.createOscillator();
    lfo.type   = 'sine'; lfo.frequency.value = 0.28;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = freq * 0.004;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    const g = this.ctx.createGain();
    osc.connect(g); osc.start(); lfo.start();
    return { gain: g, stop() { try { osc.stop(); lfo.stop(); } catch(e){} } };
  }

  // 1 — CAMPANA: FM with inharmonic ratio 1:2.756 + decaying modulator index
  // The modulator sweep on attack gives the metallic "clang" of a bell.
  _s1(freq) {
    const car  = this.ctx.createOscillator();
    car.type   = 'sine'; car.frequency.value = freq;
    const mod  = this.ctx.createOscillator();
    mod.type   = 'sine'; mod.frequency.value = freq * 2.756; // inharmonic
    const modG = this.ctx.createGain();
    const t = this.ctx.currentTime;
    modG.gain.setValueAtTime(freq * 4, t);
    modG.gain.exponentialRampToValueAtTime(freq * 0.4, t + 0.4);
    mod.connect(modG); modG.connect(car.frequency);
    const g = this.ctx.createGain();
    car.connect(g); car.start(); mod.start();
    return { gain: g, stop() { try { car.stop(); mod.stop(); } catch(e){} } };
  }

  // 2 — SOPLO: white noise through a single narrow bandpass — breath / flute air
  // Single filter at freq, high Q=50 for tonal focus, compensated output gain.
  _s2(freq) {
    const sr  = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * 2, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 50;
    const g = this.ctx.createGain();
    g.gain.value = 20; // compensate narrow bandpass power reduction
    noise.connect(bp); bp.connect(g); noise.start();
    return { gain: g, stop() { try { noise.stop(); } catch(e){} } };
  }

  // 3 — ÓRGANO: 8 sine harmonics, organ-style amplitude weighting
  // Output gain normalised (×2.0) so RMS matches single-oscillator profiles.
  _s3(freq) {
    const spec = [[1,0.40],[2,0.25],[3,0.14],[4,0.09],[5,0.05],[6,0.04],[7,0.02],[8,0.01]];
    const g    = this.ctx.createGain();
    g.gain.value = 2.0; // RMS of additive stack ≈ 0.357; ×2 → ~0.71 ≈ single sine
    const oscs = spec.map(([m, a]) => {
      const o = this.ctx.createOscillator();
      o.type  = 'sine'; o.frequency.value = freq * m;
      const ag = this.ctx.createGain(); ag.gain.value = a;
      o.connect(ag); ag.connect(g); o.start(); return o;
    });
    return { gain: g, stop() { oscs.forEach(o => { try { o.stop(); } catch(e){} }); } };
  }

  // 4 — METAL: ring modulation with √2 frequency ratio
  // True multiplication: carrier × modulator → only sidebands, no fundamental.
  _s4(freq) {
    const carrier   = this.ctx.createOscillator();
    carrier.type    = 'sine'; carrier.frequency.value = freq;
    const modulator = this.ctx.createOscillator();
    modulator.type  = 'sine'; modulator.frequency.value = freq * 1.4142; // √2
    const ringGain  = this.ctx.createGain();
    ringGain.gain.value = 0;          // intrinsic = 0
    modulator.connect(ringGain.gain); // effective gain = modulator signal (−1…+1)
    carrier.connect(ringGain);        // output = carrier × modulator = ring mod
    const g = this.ctx.createGain();
    ringGain.connect(g); carrier.start(); modulator.start();
    return { gain: g, stop() { try { carrier.stop(); modulator.stop(); } catch(e){} } };
  }

  // 5 — FUZZ: sawtooth into tanh waveshaper with heavy overdrive
  // Creates dense odd+even harmonics, aggressive, buzzy, saturated.
  _s5(freq) {
    const osc = this.ctx.createOscillator();
    osc.type  = 'sawtooth'; osc.frequency.value = freq;
    const N = 512;
    const curve = new Float32Array(N);
    const drive = 8;
    for (let i = 0; i < N; i++) {
      const x = (i * 2) / N - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive); // normalised
    }
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = curve; shaper.oversample = '4x';
    const preG = this.ctx.createGain(); preG.gain.value = 1.5;
    const g    = this.ctx.createGain();
    osc.connect(preG); preG.connect(shaper); shaper.connect(g); osc.start();
    return { gain: g, stop() { try { osc.stop(); } catch(e){} } };
  }

  // 6 — CUERDA: Karplus-Strong plucked string (pre-computed offline)
  // Generates the full KS buffer in JS, plays it once as a sample.
  _s6(freq) {
    const sr     = this.ctx.sampleRate;
    const period = Math.round(sr / freq);
    const len    = sr * 3; // 3 s max
    const data   = new Float32Array(len);
    for (let i = 0; i < period; i++) data[i] = Math.random() * 2 - 1;
    const loss = 0.996;
    for (let i = period; i < len; i++)
      data[i] = loss * 0.5 * (data[i - period] + data[i - period + 1 < len ? i - period + 1 : i - period]);
    const buf = this.ctx.createBuffer(1, len, sr);
    buf.copyToChannel(data, 0);
    const ks = this.ctx.createBufferSource();
    ks.buffer = buf; ks.loop = false;
    const sine  = this.ctx.createOscillator();
    sine.type   = 'sine'; sine.frequency.value = freq;
    const sineG = this.ctx.createGain(); sineG.gain.value = 0.06;
    const g = this.ctx.createGain();
    ks.connect(g); sine.connect(sineG); sineG.connect(g);
    ks.start(); sine.start();
    return { gain: g, stop() { try { ks.stop(); sine.stop(); } catch(e){} } };
  }

  // 7 — PULSO: triangle carrier with deep AM tremolo at 6 Hz
  // Creates strong pulsating / heartbeat quality.
  _s7(freq) {
    const osc  = this.ctx.createOscillator();
    osc.type   = 'triangle'; osc.frequency.value = freq;
    const ampG = this.ctx.createGain(); ampG.gain.value = 0.5;
    const lfo  = this.ctx.createOscillator();
    lfo.type   = 'sine'; lfo.frequency.value = 6.0;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.48; // near-full AM depth
    lfo.connect(lfoG); lfoG.connect(ampG.gain); // gain oscillates 0.02 → 0.98
    const sub  = this.ctx.createOscillator();
    sub.type   = 'sine'; sub.frequency.value = freq * 0.5;
    const subG = this.ctx.createGain(); subG.gain.value = 0.18;
    const g = this.ctx.createGain();
    osc.connect(ampG); ampG.connect(g);
    sub.connect(subG); subG.connect(g);
    osc.start(); lfo.start(); sub.start();
    return { gain: g, stop() { try { osc.stop(); lfo.stop(); sub.stop(); } catch(e){} } };
  }

  _buildSynth(playerIndex, freq) {
    const builders = [
      f => this._s0(f), f => this._s1(f), f => this._s2(f), f => this._s3(f),
      f => this._s4(f), f => this._s5(f), f => this._s6(f), f => this._s7(f)
    ];
    const idx = (typeof playerIndex === 'number' && isFinite(playerIndex))
      ? ((playerIndex % 8) + 8) % 8
      : 0;
    return builders[idx](freq);
  }

  // ── Player registry — one Resonance Audio source per remote player ────────

  addPlayer(playerId, playerIndex) {
    let source = null;
    if (this.resonance) {
      try {
        source = this.resonance.createSource({
          minDistance: 10,
          maxDistance: 200,
          rolloff: 'logarithmic',
          gain: 1.0
        });
      } catch(e) {
        console.warn('[audio] createSource failed:', e);
      }
    }
    this.playerDrones.set(playerId, { index: playerIndex, source, x: 0, y: 0, z: 0 });
  }

  removePlayer(playerId) {
    this.stopAllNotesForPlayer(playerId);
    this.playerDrones.delete(playerId);
  }

  updatePlayerPosition(playerId, x, y, z) {
    const d = this.playerDrones.get(playerId);
    if (!d) return;
    d.x = x; d.y = y; d.z = z;
    if (d.source) d.source.setPosition(x, y, z);
  }

  // ── Listener (camera) update — feeds Resonance Audio listener ────────────

  updateListenerFromCamera(position, yaw, pitch) {
    if (!this.initialized) return;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy =  Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    this.resonance.setListenerPosition(position.x, position.y, position.z);
    this.resonance.setListenerOrientation(fx, fy, fz, 0, 1, 0);
  }

  // ── Local notes (keyboard, non-spatial) ──────────────────────────────────

  static MAX_POLY = 5;
  static NOTE_TIMEOUT_MS = 8000;

  playLocalNote(key, playerIndex) {
    if (!this.initialized || this.localNotes.has(key)) return;
    const idx = this.keyMap[key];
    if (idx === undefined) return;

    // Polyphony limit — evict the oldest note before adding a new one
    if (this.localNotes.size >= AudioSystem.MAX_POLY) {
      const oldest = this.localNotes.keys().next().value;
      this.stopLocalNote(oldest);
    }

    // Use randomized synth override if set, otherwise use assigned profile
    const synthIdx = (this.localSynthOverride !== null) ? this.localSynthOverride : playerIndex;
    const synth   = this._buildSynth(synthIdx, this.scale[idx]);
    const gainEnv = this.ctx.createGain();
    synth.gain.connect(gainEnv);
    gainEnv.connect(this.localBus); // non-spatial — always centered

    gainEnv.gain.setValueAtTime(0, this.ctx.currentTime);
    gainEnv.gain.linearRampToValueAtTime(this.sustainGain, this.ctx.currentTime + this.attackTime);

    const safetyId = setTimeout(() => this.stopLocalNote(key), AudioSystem.NOTE_TIMEOUT_MS);
    this.localNotes.set(key, { synth, gainEnv, safetyId });

    const btn = document.getElementById(`kbtn-${key}`);
    if (btn) btn.classList.add('active');
  }

  stopLocalNote(key) {
    if (!this.initialized) return;
    const note = this.localNotes.get(key);
    if (note) {
      clearTimeout(note.safetyId);
      this.localNotes.delete(key); // delete immediately so re-press works

      const DECAY = this.releaseTime;
      this._releaseGain(note.gainEnv.gain, DECAY);
      setTimeout(() => {
        note.synth.stop();
        try { note.gainEnv.disconnect(); } catch(e) {}
      }, DECAY * 1000 + 80);
    }
    const btn = document.getElementById(`kbtn-${key}`);
    if (btn) btn.classList.remove('active');
  }

  stopAllLocalNotes() {
    for (const key of [...this.localNotes.keys()]) this.stopLocalNote(key);
  }

  // ── Remote notes (sustained, binaural via Resonance Audio source) ─────────

  static REMOTE_NOTE_TIMEOUT_MS = 12000;

  playRemoteNote(key, playerId, playerIndex, x, y, z) {
    if (!this.initialized) return;
    const idx = this.keyMap[key];
    if (idx === undefined) return;
    const noteKey = `${playerId}:${key}`;
    if (this.remoteNotes.has(noteKey)) return;

    const playerData = this.playerDrones.get(playerId);
    if (!playerData) return;

    const synth   = this._buildSynth(playerIndex, this.scale[idx]);
    const gainEnv = this.ctx.createGain();
    synth.gain.connect(gainEnv);

    let panner = null;
    if (playerData.source) {
      // Resonance Audio path
      gainEnv.connect(playerData.source.input);
    } else {
      // Fallback: HRTF PannerNode
      panner = this.ctx.createPanner();
      panner.panningModel  = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance   = 10;
      panner.maxDistance   = 200;
      panner.rolloffFactor = 1.5;
      if (panner.positionX) {
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;
      } else {
        panner.setPosition(x, y, z);
      }
      gainEnv.connect(panner);
      panner.connect(this.notesBus);
    }

    gainEnv.gain.setValueAtTime(0, this.ctx.currentTime);
    gainEnv.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + 0.03);

    const safetyId = setTimeout(() => this.stopRemoteNote(key, playerId), AudioSystem.REMOTE_NOTE_TIMEOUT_MS);
    this.remoteNotes.set(noteKey, { synth, gainEnv, panner, safetyId });
  }

  stopRemoteNote(key, playerId) {
    if (!this.initialized) return;
    const noteKey = `${playerId}:${key}`;
    const note = this.remoteNotes.get(noteKey);
    if (!note) return;

    clearTimeout(note.safetyId);
    this.remoteNotes.delete(noteKey);

    const DECAY = 0.35;
    this._releaseGain(note.gainEnv.gain, DECAY);
    setTimeout(() => {
      note.synth.stop();
      try { note.gainEnv.disconnect(); } catch(e) {}
      try { if (note.panner) note.panner.disconnect(); } catch(e) {}
    }, DECAY * 1000 + 80);
  }

  stopAllNotesForPlayer(playerId) {
    for (const noteKey of [...this.remoteNotes.keys()]) {
      if (noteKey.startsWith(`${playerId}:`)) {
        const key = noteKey.split(':')[1];
        this.stopRemoteNote(key, playerId);
      }
    }
  }
}
