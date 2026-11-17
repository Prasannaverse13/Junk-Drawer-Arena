// Headless balance test: runs many matches with box built fighters and prints results.
// npm run simtest
import RAPIER from "@dimforge/rapier3d-compat";
import { Sim, gameMassFromKg, gameSizeFromCm } from "../client/src/sim.js";

await RAPIER.init();
import * as SIM from "../client/src/sim.js";
if (process.argv[3]) SIM.setDamage(Number(process.argv[3]));

function boxPoints(cx, cy, cz, hx, hy, hz) {
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(cx + sx * hx, cy + sy * hy, cz + sz * hz);
  return { points: new Float32Array(pts), bbox: { min: { x: cx - hx, y: cy - hy, z: cz - hz }, max: { x: cx + hx, y: cy + hy, z: cz + hz } } };
}

function makeSpec(id, name, kg, cm, stats, kind) {
  const size = gameSizeFromCm(cm);
  const mass = gameMassFromKg(kg);
  const h = size / 2;
  const defs = [
    [0, 0, 0, h * 0.5, h * 0.6, h * 0.5, true],
    [h * 0.75, 0.1, 0, h * 0.22, h * 0.3, h * 0.1],
    [-h * 0.7, 0, 0, h * 0.2, h * 0.4, h * 0.2],
    [0, h * 0.8, 0, h * 0.35, h * 0.2, h * 0.35],
    [0, -h * 0.8, 0, h * 0.5, h * 0.18, h * 0.5],
  ];
  const vol = defs.map((d) => d[3] * d[4] * d[5]);
  const tv = vol.reduce((a, b) => a + b, 0);
  const parts = defs.map((d, i) => ({ ...boxPoints(d[0], d[1], d[2], d[3], d[4], d[5]), mass: (mass * vol[i]) / tv, core: !!d[6] }));
  return { id, name, stats, mass, size, halfHeight: h, parts, signature: { kind, name: kind }, element: { mug: "earth", duck: "water", pan: "fire", shoe: "air" }[id] };
}

const roster = [
  makeSpec("mug", "Mug", 0.35, 12, { power: 7, speed: 5, armor: 7, stability: 5 }, "charge"),
  makeSpec("duck", "Duck", 0.08, 10, { power: 4, speed: 9, armor: 4, stability: 7 }, "spin"),
  makeSpec("pan", "Pan", 1.4, 30, { power: 9, speed: 3, armor: 8, stability: 4 }, "slam"),
  makeSpec("shoe", "Shoe", 0.4, 28, { power: 6, speed: 7, armor: 5, stability: 6 }, "charge"),
];

const wins = {};
let totalTime = 0;
let parts = 0;
let reasons = {};
const N = Number(process.argv[2]) || 40;
for (let m = 0; m < N; m++) {
  const pick = m % 3 === 0 ? roster : [roster[m % 4], roster[(m + 1 + (m % 3)) % 4]];
  const sim = new Sim(RAPIER, { seed: m + 1 });
  pick.forEach((s, i) => sim.addFighter(s, i, pick.length));
  let end = null;
  for (let i = 0; i < 60 * 120 && !end; i++) {
    const ev = sim.step(1 / 60);
    for (const e of ev) {
      if (e.type === "part") parts++;
      if (e.type === "ko") { reasons[e.reason] = (reasons[e.reason] || 0) + 1; reasons[e.id + ":" + e.reason] = (reasons[e.id + ":" + e.reason] || 0) + 1; }
      if (e.type === "end") end = e;
    }
  }
  totalTime += sim.time;
  if (end) {
    wins[end.winner ?? "none"] = (wins[end.winner ?? "none"] || 0) + 1;
    reasons["end:" + end.reason] = (reasons["end:" + end.reason] || 0) + 1;
  }
  sim.dispose();
}
console.log({ matches: N, avgSeconds: +(totalTime / N).toFixed(1), partsPerMatch: +(parts / N).toFixed(1), wins, reasons });
