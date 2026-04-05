// world.js — SoundWorld Procedural World Generator

const WORLD_NAMES = [
  'ARCHIPIÉLAGO FLOTANTE',
  'BOSQUE DE CRISTAL',
  'VACÍO NEBULOSO',
  'ABISMO PROFUNDO',
  'GEOMETRÍA SAGRADA',
  'RUINAS ANTIGUAS'
];

// 8 dreamlike color palettes: { bg, fog, primary, secondary }
const PALETTES = [
  { bg: 0x02000d, fog: 0x130030, primary: 0x7b2fff, secondary: 0x00ffcc },
  { bg: 0x00080a, fog: 0x001520, primary: 0x00eeff, secondary: 0xff00aa },
  { bg: 0x060003, fog: 0x120010, primary: 0xff00ff, secondary: 0xffaa00 },
  { bg: 0x010800, fog: 0x041500, primary: 0x00ff77, secondary: 0xaaff00 },
  { bg: 0x000008, fog: 0x000018, primary: 0x4488ff, secondary: 0xffcc00 },
  { bg: 0x070000, fog: 0x120000, primary: 0xff4400, secondary: 0xff00cc },
  { bg: 0x000000, fog: 0x080808, primary: 0xffffff, secondary: 0x6688aa },
  { bg: 0x000508, fog: 0x001510, primary: 0x00ffaa, secondary: 0x0088ff }
];

class WorldGenerator {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.animObjects = []; // objects updated each frame
    this.rng = this._createRNG(seed.seed);
    this.pal = PALETTES[seed.palette % PALETTES.length];
    this.worldType = seed.worldType % WORLD_NAMES.length;
    this.sz = seed.size;

    // All world objects live in this group — one remove() cleans everything
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // Helper: add to group (not directly to scene)
  _add(obj) { this.group.add(obj); return obj; }

  // Remove every object, dispose GPU memory
  cleanup() {
    this.animObjects = [];
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => m.dispose());
      }
    });
    this.scene.remove(this.group);
  }

  _createRNG(s) {
    let state = s;
    return () => {
      state = (state * 1664525 + 1013904223) & 0xffffffff;
      return (state >>> 0) / 0xffffffff;
    };
  }

  r() { return this.rng(); }
  rr(a, b) { return a + this.r() * (b - a); }
  ri(a, b) { return Math.floor(this.rr(a, b + 1)); }
  rc(a, b) {
    return new THREE.Color(a).lerp(new THREE.Color(b), this.r());
  }

  generate() {
    const name = WORLD_NAMES[this.worldType];
    const el = document.getElementById('world-label');
    if (el) el.textContent = name;

    // Scene base
    this.scene.background = new THREE.Color(this.pal.bg);
    this.scene.fog = new THREE.FogExp2(this.pal.fog, this.seed.fogDensity);

    // Lighting
    const ambient = new THREE.AmbientLight(this.pal.primary, 0.4);
    this._add(ambient);

    const sun = new THREE.PointLight(this.pal.primary, 3, 300);
    sun.position.set(0, 60, 0);
    this._add(sun);

    const fill = new THREE.PointLight(this.pal.secondary, 1.8, 250);
    fill.position.set(-60, 20, -60);
    this._add(fill);

    const rim = new THREE.PointLight(this.pal.secondary, 1.2, 200);
    rim.position.set(80, -10, 80);
    this._add(rim);

    // Build world
    switch (this.worldType) {
      case 0: this._buildFloatingIslands(); break;
      case 1: this._buildCrystalForest(); break;
      case 2: this._buildNebulaVoid(); break;
      case 3: this._buildDeepAbyss(); break;
      case 4: this._buildSacredGeometry(); break;
      case 5: this._buildAncientRuins(); break;
    }

    this._addParticleAtmosphere();
    return name;
  }

  // ─── Materials ──────────────────────────────────────────────────────────────

  _matGlow(color, opacity = 0.85) {
    return new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.4,
      transparent: opacity < 1,
      opacity,
      roughness: 0.2,
      metalness: 0.8
    });
  }

  _matWire(color, opacity = 0.25) {
    return new THREE.MeshBasicMaterial({
      color, wireframe: true,
      transparent: true, opacity
    });
  }

  _matBasic(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({
      color, transparent: opacity < 1, opacity
    });
  }

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  _addFloatAnim(obj, baseY, speed, offset) {
    obj.userData.floatBase = baseY;
    obj.userData.floatSpeed = speed;
    obj.userData.floatOff = offset;
    this.animObjects.push(obj);
  }

  _addRotAnim(obj, rx = 0, ry = 0, rz = 0) {
    obj.userData.rotX = rx;
    obj.userData.rotY = ry;
    obj.userData.rotZ = rz;
    if (!this.animObjects.includes(obj)) this.animObjects.push(obj);
  }

  _addGlowAnim(obj, base, speed, amp) {
    obj.userData.glowBase = base;
    obj.userData.glowSpeed = speed;
    obj.userData.glowAmp = amp;
    obj.userData.glowOff = this.r() * Math.PI * 2;
    if (!this.animObjects.includes(obj)) this.animObjects.push(obj);
  }

  _crystal(size) {
    const geo = new THREE.ConeGeometry(
      size * this.rr(0.08, 0.2),
      size,
      this.ri(4, 6)
    );
    const color = this.rc(this.pal.primary, this.pal.secondary);
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.5,
      transparent: true, opacity: this.rr(0.6, 0.95),
      roughness: 0.05, metalness: 0.95
    });
    const m = new THREE.Mesh(geo, mat);
    m.userData.glowBase = 0.4;
    m.userData.glowSpeed = this.rr(0.5, 2.0);
    m.userData.glowAmp = 0.25;
    m.userData.glowOff = this.r() * Math.PI * 2;
    this.animObjects.push(m);
    return m;
  }

  // ─── WORLD 0: Floating Islands ───────────────────────────────────────────────

  _buildFloatingIslands() {
    const count = Math.floor(this.rr(18, 45) * this.sz);

    for (let i = 0; i < count; i++) {
      const scale = this.rr(1.5, 9) * this.sz;
      const x = this.rr(-90, 90) * this.sz;
      const y = this.rr(-15, 45);
      const z = this.rr(-90, 90) * this.sz;

      const geo = new THREE.CylinderGeometry(
        scale * this.rr(0.3, 0.9),
        scale * this.rr(0.6, 1.4),
        scale * this.rr(0.15, 0.55),
        this.ri(5, 9)
      );
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const mat = this._matGlow(color, this.rr(0.75, 0.95));
      const island = new THREE.Mesh(geo, mat);
      island.position.set(x, y, z);
      island.rotation.y = this.r() * Math.PI * 2;

      if (this.r() > 0.45) {
        const wire = new THREE.Mesh(geo.clone(), this._matWire(this.pal.secondary, 0.2));
        island.add(wire);
      }

      // Crystals on top
      const nc = this.ri(0, 6);
      for (let j = 0; j < nc; j++) {
        const c = this._crystal(this.rr(0.5, scale * 0.4));
        c.position.set(
          this.rr(-scale * 0.35, scale * 0.35),
          scale * 0.3 + c.geometry.parameters.height * 0.5,
          this.rr(-scale * 0.35, scale * 0.35)
        );
        island.add(c);
      }

      this._add(island);
      this._addFloatAnim(island, y, this.rr(0.2, 0.8), this.r() * Math.PI * 2);
      this._addRotAnim(island, 0, (this.r() - 0.5) * 0.002, 0);
      this._addGlowAnim(island, 0.3, this.rr(0.3, 1.0), 0.2);
    }

    // Misty ground
    if (this.seed.hasGround) {
      const gGeo = new THREE.PlaneGeometry(600, 600);
      const gMat = new THREE.MeshStandardMaterial({
        color: this.pal.bg, transparent: true, opacity: 0.7,
        roughness: 1, metalness: 0
      });
      const ground = new THREE.Mesh(gGeo, gMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -35;
      this._add(ground);
    }
  }

  // ─── WORLD 1: Crystal Forest ─────────────────────────────────────────────────

  _buildCrystalForest() {
    // Ground
    const gGeo = new THREE.PlaneGeometry(400, 400, 40, 40);
    const gMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.pal.bg).addScalar(0.015),
      roughness: 0.95, metalness: 0.1
    });
    const ground = new THREE.Mesh(gGeo, gMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    this._add(ground);

    // Ground crystals
    const count = Math.floor(this.rr(50, 100) * this.sz);
    for (let i = 0; i < count; i++) {
      const h = this.rr(1.5, 22) * this.sz;
      const c = this._crystal(h);
      c.position.set(
        this.rr(-110, 110) * this.sz,
        h * 0.5 - 1.5,
        this.rr(-110, 110) * this.sz
      );
      c.rotation.z = this.rr(-0.08, 0.08);
      this._add(c);
    }

    // Floating clusters
    for (let i = 0; i < Math.floor(12 * this.sz); i++) {
      const group = new THREE.Group();
      const clSz = this.rr(3, 12);
      const np = this.ri(3, 9);

      for (let j = 0; j < np; j++) {
        const c = this._crystal(clSz * this.rr(0.4, 1.5));
        c.position.set(
          this.rr(-clSz * 0.5, clSz * 0.5),
          this.rr(-clSz * 0.4, clSz * 0.4),
          this.rr(-clSz * 0.5, clSz * 0.5)
        );
        c.rotation.set(this.r() * Math.PI * 2, this.r() * Math.PI * 2, this.r() * Math.PI * 2);
        group.add(c);
      }

      const y = this.rr(8, 45);
      group.position.set(this.rr(-60, 60) * this.sz, y, this.rr(-60, 60) * this.sz);
      this._add(group);
      this._addFloatAnim(group, y, this.rr(0.15, 0.5), this.r() * Math.PI * 2);
      this._addRotAnim(group, 0, (this.r() - 0.5) * 0.006, 0);
    }
  }

  // ─── WORLD 2: Nebula Void ────────────────────────────────────────────────────

  _buildNebulaVoid() {
    // Gaseous spheres
    for (let i = 0; i < Math.floor(this.rr(25, 55)); i++) {
      const sz = this.rr(8, 50) * this.sz;
      const geo = new THREE.SphereGeometry(sz, 8, 8);
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const mat = this._matBasic(color, this.rr(0.025, 0.07));
      mat.side = THREE.BackSide;
      const sph = new THREE.Mesh(geo, mat);
      const y = this.rr(-40, 40);
      sph.position.set(this.rr(-120, 120) * this.sz, y, this.rr(-120, 120) * this.sz);
      this._add(sph);
      this._addFloatAnim(sph, y, this.rr(0.05, 0.2), this.r() * Math.PI * 2);
      this._addRotAnim(sph, 0, (this.r() - 0.5) * 0.0008, 0);
    }

    // Particle nebula clusters
    for (let i = 0; i < 18; i++) {
      this._nebulaCluster(
        this.rr(-80, 80) * this.sz,
        this.rr(-30, 30),
        this.rr(-80, 80) * this.sz,
        this.rr(4, 18) * this.sz
      );
    }

    // Light paths / tendrils
    const pathCount = this.ri(4, 10);
    for (let p = 0; p < pathCount; p++) {
      const pts = [];
      let x = this.rr(-50, 50) * this.sz;
      let y = this.rr(-15, 15);
      let z = this.rr(-50, 50) * this.sz;
      for (let i = 0; i < 16; i++) {
        pts.push(new THREE.Vector3(x, y, z));
        x += this.rr(-18, 18) * this.sz;
        y += this.rr(-6, 6);
        z += this.rr(-18, 18) * this.sz;
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 40, this.rr(0.08, 0.35), 5, false);
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const mat = this._matBasic(color, this.rr(0.3, 0.7));
      const tube = new THREE.Mesh(geo, mat);
      tube.userData.glowBase = 0.3;
      tube.userData.glowSpeed = this.rr(0.3, 1.2);
      tube.userData.glowAmp = 0.3;
      tube.userData.glowOff = this.r() * Math.PI * 2;
      tube.userData.isTube = true;
      this._add(tube);
      this.animObjects.push(tube);
    }
  }

  _nebulaCluster(cx, cy, cz, radius) {
    const count = 250;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = this.r() * radius;
      const th = this.r() * Math.PI * 2;
      const ph = this.r() * Math.PI;
      pos[i * 3] = cx + r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = cy + r * Math.cos(ph) * 0.35;
      pos[i * 3 + 2] = cz + r * Math.sin(ph) * Math.sin(th);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: this.rc(this.pal.primary, this.pal.secondary),
      size: this.rr(0.2, 0.6),
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._add(new THREE.Points(geo, mat));
  }

  // ─── WORLD 3: Deep Abyss ─────────────────────────────────────────────────────

  _buildDeepAbyss() {
    // Bioluminescent columns rising from below
    const count = Math.floor(this.rr(35, 70) * this.sz);
    for (let i = 0; i < count; i++) {
      const h = this.rr(20, 90) * this.sz;
      const x = this.rr(-70, 70) * this.sz;
      const z = this.rr(-70, 70) * this.sz;
      const baseY = this.rr(-100, -15);

      const geo = new THREE.CylinderGeometry(
        this.rr(0.05, 1.2),
        this.rr(0.3, 2.8),
        h,
        this.ri(4, 7)
      );
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color,
        emissiveIntensity: this.rr(0.3, 0.7),
        roughness: 0.3, metalness: 0.7,
        transparent: true, opacity: this.rr(0.6, 0.95)
      });
      const col = new THREE.Mesh(geo, mat);
      col.position.set(x, baseY + h * 0.5, z);
      this._add(col);
      this._addGlowAnim(col, 0.3, this.rr(0.4, 2.0), 0.35);
    }

    // Jellyfish-like drifting forms
    const jellies = Math.floor(this.rr(12, 25));
    for (let i = 0; i < jellies; i++) {
      const jelly = this._jellyfish();
      const y = this.rr(-45, 25);
      jelly.position.set(this.rr(-60, 60) * this.sz, y, this.rr(-60, 60) * this.sz);
      this._add(jelly);
      this._addFloatAnim(jelly, y, this.rr(0.2, 0.6), this.r() * Math.PI * 2);
      this._addRotAnim(jelly, 0, (this.r() - 0.5) * 0.008, 0);
    }
  }

  _jellyfish() {
    const g = new THREE.Group();
    const color = this.rc(this.pal.primary, this.pal.secondary);
    const bellR = this.rr(1, 4.5);

    const bellGeo = new THREE.SphereGeometry(bellR, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const bellMat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.4,
      transparent: true, opacity: 0.45, side: THREE.DoubleSide
    });
    g.add(new THREE.Mesh(bellGeo, bellMat));

    const nt = this.ri(5, 12);
    for (let i = 0; i < nt; i++) {
      const angle = (i / nt) * Math.PI * 2;
      const rr = this.rr(0.2, bellR * 0.9);
      const len = this.rr(4, 16);
      const pts = [];
      for (let j = 0; j <= 10; j++) {
        const t = j / 10;
        pts.push(new THREE.Vector3(
          Math.sin(angle) * rr * (1 - t * 0.4) + Math.sin(t * 5 + angle) * 0.4,
          -t * len,
          Math.cos(angle) * rr * (1 - t * 0.4) + Math.cos(t * 5 + angle) * 0.4
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 10, this.rr(0.03, 0.1), 4, false);
      const mat = this._matBasic(color, this.rr(0.3, 0.6));
      g.add(new THREE.Mesh(geo, mat));
    }
    return g;
  }

  // ─── WORLD 4: Sacred Geometry ────────────────────────────────────────────────

  _buildSacredGeometry() {
    const geoFns = [
      () => new THREE.TetrahedronGeometry(1),
      () => new THREE.OctahedronGeometry(1),
      () => new THREE.IcosahedronGeometry(1),
      () => new THREE.DodecahedronGeometry(1),
      () => new THREE.TorusGeometry(1, 0.32, 6, 8),
      () => new THREE.TorusKnotGeometry(1, 0.28, 50, 8)
    ];

    const count = Math.floor(this.rr(25, 55) * this.sz);
    for (let i = 0; i < count; i++) {
      const geo = geoFns[Math.floor(this.r() * geoFns.length)]();
      const scale = this.rr(0.8, 9) * this.sz;
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const useWire = this.r() > 0.45;
      const mat = useWire
        ? this._matWire(color, this.rr(0.25, 0.55))
        : this._matGlow(color, this.rr(0.5, 0.9));

      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(scale);
      const y = this.rr(-35, 55);
      mesh.position.set(this.rr(-90, 90) * this.sz, y, this.rr(-90, 90) * this.sz);
      mesh.rotation.set(this.r() * Math.PI * 2, this.r() * Math.PI * 2, this.r() * Math.PI * 2);

      if (!useWire && this.r() > 0.5) {
        const wm = new THREE.Mesh(geo.clone(), this._matWire(this.pal.secondary, 0.12));
        wm.scale.setScalar(1.12);
        mesh.add(wm);
      }

      this._add(mesh);
      this._addFloatAnim(mesh, y, this.rr(0.15, 0.5), this.r() * Math.PI * 2);
      this._addRotAnim(mesh,
        (this.r() - 0.5) * 0.004,
        (this.r() - 0.5) * 0.007,
        (this.r() - 0.5) * 0.003
      );
      if (!useWire) this._addGlowAnim(mesh, 0.3, this.rr(0.3, 1.0), 0.2);
    }

    // Central mandala
    this._mandala(geoFns);
  }

  _mandala(geoFns) {
    const group = new THREE.Group();
    group.position.y = 5;
    const rings = 5;

    for (let r = 0; r < rings; r++) {
      const count = (r + 1) * 6;
      const radius = (r + 1) * 7 * this.sz;

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const geo = geoFns[Math.floor(this.r() * geoFns.length)]();
        const sz = this.rr(0.4, 1.8) * this.sz;
        const color = this.rc(this.pal.primary, this.pal.secondary);
        const mat = this._matGlow(color, 0.75);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.setScalar(sz);
        mesh.position.set(
          Math.cos(angle) * radius,
          Math.sin(i * 0.7) * 4,
          Math.sin(angle) * radius
        );
        mesh.rotation.set(this.r() * Math.PI * 2, this.r() * Math.PI * 2, 0);
        group.add(mesh);
        this._addGlowAnim(mesh, 0.35, 0.6 + r * 0.15, 0.2);
      }
    }

    this._add(group);
    this._addRotAnim(group, 0, 0.002, 0);
  }

  // ─── WORLD 5: Ancient Ruins ───────────────────────────────────────────────────

  _buildAncientRuins() {
    const s = this.sz;

    // Ground
    const gMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.pal.primary).multiplyScalar(0.08),
      roughness: 0.95
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), gMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    this._add(ground);

    // Columns
    const colCount = Math.floor(this.rr(20, 45) * s);
    for (let i = 0; i < colCount; i++) {
      const h = this.rr(4, 28) * s;
      const r = this.rr(0.4, 2.0);
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.3 });
      const geo = new THREE.CylinderGeometry(r * 0.85, r, h, 7);
      const col = new THREE.Mesh(geo, mat);
      const x = this.rr(-90, 90) * s;
      const z = this.rr(-90, 90) * s;
      const broken = this.r() > 0.45 ? this.rr(0.2, 0.7) : 1.0;
      col.scale.y = broken;
      col.position.set(x, (h * broken) / 2 - 3, z);
      col.rotation.z = this.rr(-0.04, 0.04);
      this._add(col);

      // Floating fragments above broken columns
      if (broken < 0.9 && this.r() > 0.4) {
        this._addFloatingDebris(x, (h * broken) - 3, z, r, this.pal);
      }
    }

    // Arches
    for (let i = 0; i < Math.floor(6 * s); i++) {
      const arch = this._arch(s);
      arch.position.set(this.rr(-70, 70) * s, 0, this.rr(-70, 70) * s);
      arch.rotation.y = this.r() * Math.PI * 2;
      this._add(arch);
    }

    // Large drifting blocks
    for (let i = 0; i < Math.floor(20 * s); i++) {
      const bw = this.rr(2, 9);
      const bh = this.rr(1, 5);
      const bd = this.rr(2, 9);
      const geo = new THREE.BoxGeometry(bw, bh, bd);
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.15, roughness: 0.7
      });
      const block = new THREE.Mesh(geo, mat);
      const y = this.rr(4, 35);
      block.position.set(this.rr(-80, 80) * s, y, this.rr(-80, 80) * s);
      block.rotation.set(this.r() * 0.4, this.r() * Math.PI * 2, this.r() * 0.4);
      this._add(block);
      this._addFloatAnim(block, y, this.rr(0.15, 0.45), this.r() * Math.PI * 2);
      this._addRotAnim(block, 0, (this.r() - 0.5) * 0.004, 0);
    }
  }

  _addFloatingDebris(baseX, baseY, baseZ, radius, pal) {
    const count = this.ri(2, 5);
    for (let i = 0; i < count; i++) {
      const geo = new THREE.CylinderGeometry(radius * 0.5, radius * 0.7, this.rr(0.8, 3), 6);
      const color = this.rc(this.pal.primary, this.pal.secondary);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      const piece = new THREE.Mesh(geo, mat);
      const y = baseY + this.rr(4, 18);
      piece.position.set(
        baseX + this.rr(-3, 3),
        y,
        baseZ + this.rr(-3, 3)
      );
      piece.rotation.set(this.r() * 0.5, this.r() * Math.PI * 2, this.r() * 0.5);
      this._add(piece);
      this._addFloatAnim(piece, y, this.rr(0.25, 0.6), this.r() * Math.PI * 2);
    }
  }

  _arch(s) {
    const g = new THREE.Group();
    const h = this.rr(6, 16) * s;
    const w = h * this.rr(0.8, 1.3);
    const color = this.rc(this.pal.primary, this.pal.secondary);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.3 });
    const cGeo = new THREE.CylinderGeometry(0.9, 1.0, h, 7);

    const c1 = new THREE.Mesh(cGeo, mat);
    c1.position.set(-w / 2, h / 2 - 3, 0);
    g.add(c1);

    const c2 = new THREE.Mesh(cGeo, mat.clone());
    c2.position.set(w / 2, h / 2 - 3, 0);
    g.add(c2);

    const aGeo = new THREE.TorusGeometry(w / 2, 0.9, 4, 14, Math.PI);
    const arch = new THREE.Mesh(aGeo, mat.clone());
    arch.position.set(0, h - 3, 0);
    arch.rotation.z = Math.PI;
    g.add(arch);

    return g;
  }

  // ─── Atmosphere ──────────────────────────────────────────────────────────────

  _addParticleAtmosphere() {
    const count = 4000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c1 = new THREE.Color(this.pal.primary);
    const c2 = new THREE.Color(this.pal.secondary);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (this.r() - 0.5) * 350 * this.sz;
      pos[i * 3 + 1] = (this.r() - 0.5) * 180;
      pos[i * 3 + 2] = (this.r() - 0.5) * 350 * this.sz;
      const c = c1.clone().lerp(c2, this.r());
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const pts = new THREE.Points(geo, mat);
    this._add(pts);
    this._addRotAnim(pts, 0, 0.00004, 0);
  }

  // ─── Animation loop ──────────────────────────────────────────────────────────

  update(t) {
    for (const obj of this.animObjects) {
      const d = obj.userData;

      // Float
      if (d.floatBase !== undefined) {
        obj.position.y = d.floatBase + Math.sin(t * d.floatSpeed + d.floatOff) * 1.6;
      }

      // Rotation
      if (d.rotX) obj.rotation.x += d.rotX;
      if (d.rotY) obj.rotation.y += d.rotY;
      if (d.rotZ) obj.rotation.z += d.rotZ;

      // Emissive glow pulse
      if (d.glowBase !== undefined) {
        const mat = obj.material;
        if (mat && mat.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = d.glowBase + Math.sin(t * d.glowSpeed + d.glowOff) * d.glowAmp;
        } else if (d.isTube && mat && mat.opacity !== undefined) {
          mat.opacity = d.glowBase + Math.sin(t * d.glowSpeed + d.glowOff) * d.glowAmp;
        }
      }
    }
  }
}
