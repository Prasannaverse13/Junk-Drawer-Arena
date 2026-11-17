// Element visual effects: glowing particle trails, impact bursts, shock rings,
// lightning bolts, rock chunks, water splashes and wind swirls.
import * as THREE from "three";
import { ELEMENTS } from "./elements.js";

const MAX = 4000;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float core = smoothstep(0.5, 0.0, r);
    float edge = smoothstep(0.5, 0.15, r);
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * core * 0.35), vAlpha * edge * 0.95);
  }
`;

const rnd = (a, b) => a + Math.random() * (b - a);

export class VFX {
  constructor(scene) {
    this.scene = scene;
    // particle pool
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.NormalBlending }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.objs = []; // rings, bolts, rocks
    this.tmp = new THREE.Color();
  }

  emit(x, y, z, { vx = 0, vy = 0, vz = 0, color = "#fff", size = 0.3, life = 0.6, grav = 0, drag = 1.5, grow = 0 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.tmp.set(color);
    this.col[i * 3] = this.tmp.r;
    this.col[i * 3 + 1] = this.tmp.g;
    this.col[i * 3 + 2] = this.tmp.b;
    this.size[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  // ---------- trails while moving ----------
  trail(el, x, y, z, speed, size, special) {
    const E = ELEMENTS[el] ?? ELEMENTS.earth;
    const n = Math.min(4, Math.floor(speed * (special ? 0.6 : 0.22)));
    for (let k = 0; k < n; k++) {
      const ox = rnd(-0.5, 0.5) * size;
      const oz = rnd(-0.5, 0.5) * size;
      if (el === "fire") this.emit(x + ox, y + rnd(-0.3, 0.3) * size, z + oz, { vy: rnd(1, 3), color: Math.random() < 0.5 ? E.color : E.glow, size: rnd(0.25, 0.55), life: rnd(0.3, 0.6), grav: -2, grow: -0.4 });
      else if (el === "water") this.emit(x + ox, y - size * 0.3, z + oz, { vx: rnd(-1, 1), vy: rnd(1.5, 3), vz: rnd(-1, 1), color: Math.random() < 0.6 ? E.color : E.glow, size: rnd(0.15, 0.32), life: rnd(0.4, 0.7), grav: 12 });
      else if (el === "lightning") this.emit(x + ox * 1.4, y + rnd(-0.4, 0.4) * size, z + oz * 1.4, { vx: rnd(-3, 3), vy: rnd(-1, 2), vz: rnd(-3, 3), color: Math.random() < 0.5 ? E.color : "#9fe8ff", size: rnd(0.12, 0.25), life: rnd(0.1, 0.25), drag: 6 });
      else if (el === "air") {
        const a = Math.random() * Math.PI * 2;
        this.emit(x + Math.cos(a) * size * 0.7, y + rnd(-0.3, 0.4) * size, z + Math.sin(a) * size * 0.7, { vx: -Math.sin(a) * 4, vy: rnd(0.5, 1.5), vz: Math.cos(a) * 4, color: Math.random() < 0.5 ? E.color : E.glow, size: rnd(0.15, 0.3), life: rnd(0.3, 0.5), drag: 2 });
      } else this.emit(x + ox, 0.08, z + oz, { vx: rnd(-1, 1), vy: rnd(0.5, 2), vz: rnd(-1, 1), color: Math.random() < 0.5 ? "#c9a06a" : "#8a6338", size: rnd(0.25, 0.5), life: rnd(0.4, 0.8), grav: 4, grow: 0.6 });
    }
  }

  // ---------- big effects ----------
  ring(x, y, z, color, { from = 0.3, to = 3, life = 0.45, flat = true, thick = 0.12 } = {}) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(1, thick, 8, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, toneMapped: false }),
    );
    m.position.set(x, y, z);
    if (flat) m.rotation.x = Math.PI / 2;
    else m.lookAt(x + rnd(-1, 1), y + rnd(-1, 1), z + rnd(-1, 1));
    m.scale.setScalar(from);
    this.scene.add(m);
    this.objs.push({ m, t: 0, life, from, to, kind: "ring" });
  }

  bolt(x, y, z, color = "#fff7a8") {
    const pts = [];
    let px = x + rnd(-1.5, 1.5);
    let pz = z + rnd(-1.5, 1.5);
    const top = 14;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector3(px + (x - px) * t + rnd(-0.6, 0.6) * (1 - t * 0.7), top + (y - top) * t, pz + (z - pz) * t + rnd(-0.6, 0.6) * (1 - t * 0.7)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const m = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.07, 5, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.22, 5, false),
      new THREE.MeshBasicMaterial({ color: "#3fb4ff", transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
    );
    this.scene.add(m, halo);
    this.objs.push({ m, t: 0, life: 0.32, kind: "flash" }, { m: halo, t: 0, life: 0.32, kind: "flash" });
  }

  rocks(x, y, z, n = 8, power = 1) {
    for (let i = 0; i < n; i++) {
      const s = rnd(0.12, 0.3) * power;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? "#8a6338" : "#a77d4b", roughness: 1, flatShading: true }));
      m.position.set(x, Math.max(0.1, y), z);
      m.castShadow = true;
      this.scene.add(m);
      this.objs.push({ m, t: 0, life: 1.1, kind: "rock", v: new THREE.Vector3(rnd(-5, 5), rnd(4, 9), rnd(-5, 5)).multiplyScalar(power), r: new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)) });
    }
  }

  swirl(x, y, z, color) {
    for (let k = 0; k < 3; k++) this.ring(x, y + k * 0.5, z, color, { from: 0.6 + k * 0.3, to: 2.4 + k * 0.6, life: 0.5 + k * 0.1, flat: true, thick: 0.05 });
  }

  // curved swoosh arcs like anime slash lines
  slash(x, y, z, color, power = 1) {
    for (let k = 0; k < 3; k++) {
      const r = rnd(0.8, 1.6) * power;
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.05 + k * 0.02, 6, 40, rnd(1.6, 2.6)),
        new THREE.MeshBasicMaterial({ color: k === 0 ? "#ffffff" : color, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      );
      m.position.set(x, y, z);
      m.rotation.set(rnd(-1.2, 1.2), rnd(0, Math.PI * 2), rnd(-1.2, 1.2));
      this.scene.add(m);
      this.objs.push({ m, t: 0, life: 0.28 + k * 0.05, from: 0.7, to: 1.4, kind: "ring", spin: rnd(6, 12) });
    }
  }

  // impact effect by the attacker's element
  impact(el, x, y, z, power = 1, special = false) {
    const E = ELEMENTS[el] ?? ELEMENTS.earth;
    const p = Math.min(2.2, power);
    if (power > 0.9 || special) this.slash(x, y, z, E.color, Math.min(1.6, p));
    const n = Math.floor((special ? 45 : 18) * p);
    // universal white core flash
    for (let i = 0; i < 2; i++) this.emit(x, y, z, { color: "#ffffff", size: rnd(0.6, 0.9) * p, life: 0.08, drag: 0, grow: 3 });
    if (el === "fire") {
      for (let i = 0; i < n; i++) this.emit(x, y, z, { vx: rnd(-7, 7) * p, vy: rnd(0, 8) * p, vz: rnd(-7, 7) * p, color: [E.color, E.glow, "#ff2a00"][i % 3], size: rnd(0.5, 1.2), life: rnd(0.4, 0.9), grav: -4, drag: 3, grow: -0.6 });
      this.ring(x, 0.05, z, E.color, { to: 3 * p, life: 0.45 });
    } else if (el === "water") {
      for (let i = 0; i < n; i++) this.emit(x, y, z, { vx: rnd(-6, 6) * p, vy: rnd(3, 10) * p, vz: rnd(-6, 6) * p, color: i % 3 ? E.color : E.glow, size: rnd(0.3, 0.7), life: rnd(0.5, 0.9), grav: 16, drag: 0.6 });
      this.ring(x, 0.05, z, E.color, { to: 2.5 * p, life: 0.6, thick: 0.08 });
      this.ring(x, 0.05, z, "#1d6fd1", { from: 0.1, to: 1.6 * p, life: 0.7, thick: 0.08 });
    } else if (el === "lightning") {
      for (let i = 0; i < n; i++) this.emit(x, y, z, { vx: rnd(-14, 14) * p, vy: rnd(-4, 10) * p, vz: rnd(-14, 14) * p, color: i % 2 ? E.color : "#9fe8ff", size: rnd(0.2, 0.45), life: rnd(0.15, 0.35), drag: 7 });
      this.ring(x, y, z, E.color, { to: 2 * p, life: 0.2, flat: false, thick: 0.06 });
      if (special || power > 1.2) this.bolt(x, y, z);
    } else if (el === "air") {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rnd(5, 11) * p;
        this.emit(x, y, z, { vx: Math.cos(a) * sp, vy: rnd(0, 3), vz: Math.sin(a) * sp, color: i % 2 ? E.color : "#ffffff", size: rnd(0.3, 0.6), life: rnd(0.35, 0.6), drag: 3 });
      }
      this.swirl(x, 0.2, z, E.color);
    } else {
      for (let i = 0; i < n; i++) this.emit(x, 0.15, z, { vx: rnd(-5, 5) * p, vy: rnd(1, 4), vz: rnd(-5, 5) * p, color: i % 2 ? "#c9a06a" : "#7a5630", size: rnd(0.6, 1.2), life: rnd(0.5, 1), grav: 3, drag: 2, grow: 0.9 });
      this.rocks(x, y, z, special ? 10 : 5, Math.min(1.4, p));
      this.ring(x, 0.05, z, "#8a6338", { to: 3.2 * p, life: 0.5, thick: 0.16 });
    }
  }

  // special move start: element burst around the fighter
  special(el, x, y, z, size) {
    const E = ELEMENTS[el] ?? ELEMENTS.earth;
    this.ring(x, 0.06, z, E.color, { from: size * 0.4, to: size * 2.2, life: 0.5, thick: 0.1 });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      this.emit(x + Math.cos(a) * size * 0.6, y, z + Math.sin(a) * size * 0.6, { vx: Math.cos(a) * 3, vy: rnd(2, 6), vz: Math.sin(a) * 3, color: i % 2 ? E.color : E.glow, size: rnd(0.25, 0.5), life: 0.6, drag: 2, grav: el === "water" ? 10 : el === "fire" ? -2 : 0 });
    }
    if (el === "lightning") this.bolt(x, y, z);
    if (el === "air") this.swirl(x, 0.2, z, E.color);
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
      this.alpha[i] = Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;

    for (const o of this.objs) {
      o.t += dt;
      const k = Math.min(1, o.t / o.life);
      if (o.kind === "ring") {
        o.m.scale.setScalar(o.from + (o.to - o.from) * (1 - (1 - k) * (1 - k)));
        o.m.material.opacity = 1 - k;
        if (o.spin) o.m.rotation.z += o.spin * dt;
      } else if (o.kind === "flash") {
        o.m.material.opacity = (1 - k) * (Math.random() < 0.7 ? 1 : 0.3);
      } else if (o.kind === "rock") {
        o.v.y -= 22 * dt;
        o.m.position.addScaledVector(o.v, dt);
        if (o.m.position.y < 0.1) {
          o.m.position.y = 0.1;
          o.v.multiplyScalar(0.4);
          o.v.y = Math.abs(o.v.y) * 0.5;
        }
        o.m.rotation.x += o.r.x * dt;
        o.m.rotation.y += o.r.y * dt;
        if (k > 0.75) o.m.scale.setScalar((1 - k) * 4);
      }
    }
    this.objs = this.objs.filter((o) => {
      if (o.t < o.life) return true;
      this.scene.remove(o.m);
      o.m.geometry.dispose();
      o.m.material.dispose();
      return false;
    });
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    for (const o of this.objs) {
      this.scene.remove(o.m);
      o.m.geometry.dispose();
      o.m.material.dispose();
    }
    this.objs = [];
  }
}
