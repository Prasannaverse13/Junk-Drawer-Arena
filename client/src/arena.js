// three.js view of the arena. Reads poses from the Sim each frame.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ARENA } from "./sim.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { VFX } from "./vfx.js";
import { ELEMENTS, elementFor } from "./elements.js";

function floorTexture() {
  // cartoon tiled grass board with a center emblem
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  const T = 64;
  for (let y = 0; y < 1024; y += T)
    for (let x = 0; x < 1024; x += T) {
      const even = ((x + y) / T) % 2 === 0;
      g.fillStyle = even ? "#7ccf4d" : "#6cc044";
      g.fillRect(x, y, T, T);
      // small blades
      g.fillStyle = "rgba(255,255,255,0.08)";
      for (let k = 0; k < 4; k++) g.fillRect(x + ((k * 17 + y) % T), y + ((k * 29 + x) % T), 3, 7);
    }
  // dirt path cross
  g.fillStyle = "#d9b36c";
  g.fillRect(0, 480, 1024, 64);
  g.fillRect(480, 0, 64, 1024);
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(0, 540, 1024, 4);
  g.fillRect(540, 0, 4, 1024);
  // center stone circle
  g.beginPath();
  g.arc(512, 512, 120, 0, Math.PI * 2);
  g.fillStyle = "#c9c2b2";
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = "#8f8676";
  g.stroke();
  g.beginPath();
  g.arc(512, 512, 78, 0, Math.PI * 2);
  g.fillStyle = "#e7dfcc";
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = "#a59b88";
  g.stroke();
  // star emblem
  g.save();
  g.translate(512, 512);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 22 : 52;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = "#ffd23f";
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = "#7a4a00";
  g.stroke();
  g.restore();
  // dark rim shade at the edge
  const grd = g.createRadialGradient(512, 512, 380, 512, 512, 512);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,40,0,0.35)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 1024);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class ArenaView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#5fb4f2");
    this.scene.fog = new THREE.Fog("#5fb4f2", 34, 80);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 13, 17);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.5, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 40;
    this.autoCam = true;
    this.cam = { dist: 17, height: 12.5, speed: 0.06, offsetX: 0 };
    this.controls.addEventListener("start", () => (this.autoCam = false));

    const hemi = new THREE.HemisphereLight("#ffffff", "#6b8f4a", 1.5);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff6e0", 2.8);
    sun.position.set(8, 18, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -14;
    sc.right = sc.top = 14;
    sc.near = 1;
    sc.far = 50;
    this.scene.add(sun);
    const rim = new THREE.PointLight("#ffd9a0", 20, 40);
    rim.position.set(-10, 6, -8);
    this.scene.add(rim);
    const rim2 = new THREE.PointLight("#bfe6ff", 15, 40);
    rim2.position.set(10, 6, -8);
    this.scene.add(rim2);

    // arena platform
    this.platform = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 96),
      [
        new THREE.MeshStandardMaterial({ color: "#9b8a6e", roughness: 0.95 }),
        new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: "#6f6250" }),
      ],
    );
    top.receiveShadow = true;
    top.position.y = -0.5;
    this.platform.add(top);
    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.06, 10, 128),
      new THREE.MeshStandardMaterial({ color: "#c9c2b2", emissive: "#000000", roughness: 0.9 }),
    );
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.01;
    this.edge = edge;
    this.platform.add(edge);
    this.scene.add(this.platform);
    this.setRadius(ARENA.radius);

    // void glow under the arena
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshBasicMaterial({ color: "#2f7fd0", transparent: true, opacity: 0.9 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -12;
    this.scene.add(pit);

    this.fighterViews = [];
    this.particles = [];
    this.vfx = new VFX(this.scene);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.35, 0.96);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.paused = false;
    this.shake = 0;
    this.clock = new THREE.Clock();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setRadius(r) {
    this.radius = r;
    this.platform.children[0].scale.set(r, 1, r);
    this.edge.scale.set(r, r, 1);
    this.edge.material.emissive.set(r < ARENA.radius - 0.1 ? "#ff3b3b" : "#000000");
    this.edge.material.color.set(r < ARENA.radius - 0.1 ? "#ff3b3b" : "#c9c2b2");
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clearFighters() {
    for (const fv of this.fighterViews) if (fv.aura) this.scene.remove(fv.aura);
    this.vfx?.clear();
    for (const fv of this.fighterViews) {
      for (const g of fv.parts) this.scene.remove(g);
      this.scene.remove(fv.ring);
    }
    this.fighterViews = [];
  }

  addFighter(fighter, built) {
    const parts = built.visual.map((g) => {
      this.scene.add(g);
      return g;
    });
    const color = new THREE.Color(built.card?.color || "#ffb000");
    const element = elementFor(built.card);
    const E = ELEMENTS[element];
    const aura = new THREE.PointLight(E.color, 0, 6, 1.6);
    this.scene.add(aura);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(fighter.size * 0.55, fighter.size * 0.68, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    ring.material.color.set(E.color);
    this.fighterViews.push({ fighter, parts, ring, color, element, aura });
  }

  burst(x, y, z, color = "#ffd36b", n = 26, power = 1) {
    n = Math.max(4, Math.floor(n));
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 7 + 1, (Math.random() - 0.5) * 9).multiplyScalar(power));
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color, size: 0.16, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(pts);
    this.particles.push({ pts, vel, life: 0.8 });
  }

  setCamera(mode) {
    this.autoCam = true;
    if (mode === "title") this.cam = { dist: 15, height: 8.5, speed: 0.05 };
    else if (mode === "garage") this.cam = { dist: 12.5, height: 7.5, speed: 0.07 };
    else this.cam = { dist: 13.5, height: 9.5, speed: 0.06 };
  }

  // world point to screen pixels (for floating numbers)
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, behind: v.z > 1 };
  }

  addShake(a) {
    this.shake = Math.min(0.6, this.shake + a);
  }

  update(sim) {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.paused) this.vfx.update(dt * (this.slowmo ?? 1));
    if (sim) {
      if (Math.abs(sim.radius - this.radius) > 0.01) this.setRadius(sim.radius);
      const center = new THREE.Vector3();
      let count = 0;
      for (const fv of this.fighterViews) {
        const f = fv.fighter;
        f.parts.forEach((p, i) => {
          const g = fv.parts[i];
          const pose = sim.partPose(f, p);
          if (!pose) {
            g.visible = false;
            return;
          }
          g.position.set(pose.t.x, pose.t.y, pose.t.z);
          g.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
        });
        const t = f.body.translation();
        fv.ring.visible = f.alive && t.y > -1;
        fv.ring.position.set(t.x, 0.02, t.z);
        const special = (f.specialUntil ?? 0) > sim.time;
        if (f.alive && !this.paused && sim.fighters.length && sim.time > 0) {
          const v = f.body.linvel();
          const w = f.body.angvel();
          const sp = Math.hypot(v.x, v.z) + Math.abs(w.y) * 0.4;
          if (sp > 1.5 || special) this.vfx.trail(fv.element, t.x, t.y, t.z, Math.max(sp, special ? 8 : 0), f.size, special);
          if (f.burn && Math.random() < 0.6) this.vfx.trail("fire", t.x, t.y, t.z, 6, f.size * 0.8, false);
        }
        fv.aura.position.set(t.x, t.y + 0.5, t.z);
        fv.aura.intensity += ((f.alive ? (special ? 12 : 0) : 0) - fv.aura.intensity) * 0.15;
        if (f.alive) {
          center.add(new THREE.Vector3(t.x, Math.max(0, t.y), t.z));
          count++;
        }
      }
      if (count && this.autoCam) {
        center.divideScalar(count);
        this.controls.target.lerp(center, 0.04);
      }
    }
    // particles
    for (const p of this.particles) {
      p.life -= dt;
      const a = p.pts.geometry.attributes.position;
      for (let i = 0; i < p.vel.length; i++) {
        p.vel[i].y -= 18 * dt;
        a.setXYZ(i, a.getX(i) + p.vel[i].x * dt, a.getY(i) + p.vel[i].y * dt, a.getZ(i) + p.vel[i].z * dt);
      }
      a.needsUpdate = true;
      p.pts.material.opacity = Math.max(0, p.life / 0.8);
    }
    this.particles = this.particles.filter((p) => {
      if (p.life > 0) return true;
      this.scene.remove(p.pts);
      p.pts.geometry.dispose();
      return false;
    });
    if (this.autoCam) {
      const t = performance.now() / 1000;
      const ang = t * this.cam.speed;
      const want = new THREE.Vector3(Math.sin(ang) * this.cam.dist, this.cam.height, Math.cos(ang) * this.cam.dist).add(new THREE.Vector3(this.controls.target.x, 0, this.controls.target.z));
      this.camera.position.lerp(want, 0.02);
    }
    this.controls.update();
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    this.composer.render();
  }
}
