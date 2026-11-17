// Turns a roster entry into a fighter: 3D parts for the renderer and a spec for the physics sim.
// Source of parts, best first:
//   1. Lux3D part split GLB (each mesh is a real part)
//   2. Lux3D model GLB cut into chunks here (k-means on triangles)
//   3. A placeholder shape built from primitives (no Lux3D key)
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { gameMassFromKg, gameSizeFromCm } from "./sim.js";
import { placeholderParts } from "./procedural.js";
import { levelOf } from "./meta.js";
import { elementFor } from "./elements.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

async function loadGlb(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  const gltf = await cache.get(url);
  return gltf.scene.clone(true);
}

// Flatten a scene into meshes whose geometry is baked into scene space.
function bakedMeshes(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    out.push(new THREE.Mesh(g, mat));
  });
  return out;
}

// Cut one mesh into k chunks by clustering triangle centers.
function chunkMesh(mesh, k) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const tris = pos.count / 3;
  if (tris < k * 8) return [mesh];
  const cx = new Float32Array(tris);
  const cy = new Float32Array(tris);
  const cz = new Float32Array(tris);
  for (let t = 0; t < tris; t++) {
    const i = t * 3;
    cx[t] = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    cy[t] = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    cz[t] = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
  }
  // farthest point init
  const centers = [[cx[0], cy[0], cz[0]]];
  while (centers.length < k) {
    let best = 0;
    let bd = -1;
    for (let t = 0; t < tris; t += 3) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, (cx[t] - c[0]) ** 2 + (cy[t] - c[1]) ** 2 + (cz[t] - c[2]) ** 2);
      if (d > bd) {
        bd = d;
        best = t;
      }
    }
    centers.push([cx[best], cy[best], cz[best]]);
  }
  const label = new Uint8Array(tris);
  for (let it = 0; it < 8; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let t = 0; t < tris; t++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (cx[t] - centers[c][0]) ** 2 + (cy[t] - centers[c][1]) ** 2 + (cz[t] - centers[c][2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      label[t] = bi;
      const s = sum[bi];
      s[0] += cx[t];
      s[1] += cy[t];
      s[2] += cz[t];
      s[3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3]) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const out = [];
  for (let c = 0; c < k; c++) {
    const idx = [];
    for (let t = 0; t < tris; t++) if (label[t] === c) idx.push(t);
    if (!idx.length) continue;
    const ng = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      const arr = new a.array.constructor(idx.length * 3 * a.itemSize);
      let w = 0;
      for (const t of idx) for (let v = 0; v < 3; v++) for (let j = 0; j < a.itemSize; j++) arr[w++] = a.array[(t * 3 + v) * a.itemSize + j];
      ng.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    out.push(new THREE.Mesh(ng, mesh.material));
  }
  return out;
}

function boxOf(meshes) {
  const b = new THREE.Box3();
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    b.union(m.geometry.boundingBox);
  }
  return b;
}

function samplePoints(meshes, max = 360) {
  let total = 0;
  for (const m of meshes) total += m.geometry.attributes.position.count;
  const stride = Math.max(1, Math.floor(total / max));
  const pts = [];
  for (const m of meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += stride) pts.push(p.getX(i), p.getY(i), p.getZ(i));
  }
  // always include the bbox corners region extremes for a solid hull
  return new Float32Array(pts);
}

function partLabel(c, size) {
  const ax = Math.abs(c.x);
  const ay = Math.abs(c.y);
  const az = Math.abs(c.z);
  if (Math.max(ax, ay, az) < size * 0.08) return "middle piece";
  if (ay >= ax && ay >= az) return c.y > 0 ? "top" : "base";
  if (ax >= az) return c.x > 0 ? "right side" : "left side";
  return c.z > 0 ? "front" : "back";
}

export async function buildFighter(entry) {
  const card = entry.card ?? {};
  const size = gameSizeFromCm(card.realSizeCm ?? 20);
  const mass = gameMassFromKg(card.realMassKg ?? 0.5);
  let meshes = [];
  let source = "placeholder";

  try {
    if (entry.split) {
      meshes = bakedMeshes(await loadGlb(entry.split));
      source = "lux3d-parts";
    }
    if (meshes.length < 2 && entry.model) {
      const m = bakedMeshes(await loadGlb(entry.model));
      if (m.length) {
        meshes = m;
        source = "lux3d-chunks";
      }
    }
  } catch (e) {
    console.warn("Model load failed, using placeholder", e);
    meshes = [];
  }

  let groups; // array of mesh arrays, one per part
  if (!meshes.length) {
    groups = placeholderParts(card).map((m) => [m]);
    source = "placeholder";
  } else {
    // normalize: center and scale to game size
    const b = boxOf(meshes);
    const c = b.getCenter(new THREE.Vector3());
    const d = b.getSize(new THREE.Vector3());
    const s = size / Math.max(d.x, d.y, d.z, 1e-6);
    for (const m of meshes) {
      m.geometry.translate(-c.x, -c.y, -c.z);
      m.geometry.scale(s, s, s);
    }
    if (meshes.length === 1) {
      const tris = meshes[0].geometry.attributes.position.count / 3;
      meshes = chunkMesh(meshes[0], tris > 3000 ? 6 : 5);
    }
    groups = meshes.map((m) => [m]);
  }

  // measure parts
  let parts = groups.map((ms) => {
    const bb = boxOf(ms);
    const d = bb.getSize(new THREE.Vector3());
    return { meshes: ms, bbox: bb, vol: Math.max(1e-5, d.x * d.y * d.z), center: bb.getCenter(new THREE.Vector3()) };
  });
  // core = big part near the middle
  const totalVol = parts.reduce((a, p) => a + p.vol, 0);
  let core = parts[0];
  let bestScore = -Infinity;
  for (const p of parts) {
    const score = p.vol / totalVol - p.center.length() / size;
    if (score > bestScore) {
      bestScore = score;
      core = p;
    }
  }
  // fold tiny parts into the core, and keep at most 9 parts
  parts.sort((a, b) => b.vol - a.vol);
  const keep = [];
  for (const p of parts) {
    if (p === core) continue;
    if (p.vol / totalVol < 0.012 || keep.length >= 8) {
      core.meshes.push(...p.meshes);
      continue;
    }
    keep.push(p);
  }
  core.bbox = boxOf(core.meshes);
  parts = [core, ...keep];

  const box = boxOf(parts.flatMap((p) => p.meshes));
  const halfHeight = (box.max.y - box.min.y) / 2;
  const volSum = parts.reduce((a, p) => a + p.vol, 0);

  const visual = parts.map((p) => {
    const g = new THREE.Group();
    for (const m of p.meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  });

  const spec = {
    id: entry.id,
    level: levelOf(entry.id),
    element: elementFor(card),
    name: card.name ?? entry.label ?? "Fighter",
    stats: card.stats ?? { power: 6, speed: 6, armor: 6, stability: 6 },
    signature: card.signature ?? { kind: "charge", name: "Big Hit" },
    mass,
    size,
    halfHeight,
    parts: parts.map((p, i) => ({
      points: samplePoints(p.meshes),
      bbox: { min: { ...p.bbox.min }, max: { ...p.bbox.max } },
      mass: (mass * p.vol) / volSum,
      core: i === 0,
      label: i === 0 ? "body" : partLabel(p.bbox.getCenter(new THREE.Vector3()), size),
    })),
  };
  return { spec, visual, card, source, entry };
}
