// Placeholder fighters made of primitives. Used when Lux3D is not set up yet,
// and for the built in demo roster, so the arena always works.
import * as THREE from "three";
import { gameSizeFromCm } from "./sim.js";

function mat(color, rough = 0.55, metal = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function mesh(geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  geo.rotateX(rx);
  geo.rotateY(ry);
  geo.rotateZ(rz);
  geo.translate(x, y, z);
  return new THREE.Mesh(geo.index ? geo.toNonIndexed() : geo, material);
}

export function placeholderParts(card = {}) {
  const S = gameSizeFromCm(card.realSizeCm ?? 20);
  const h = S / 2;
  const text = `${card.object ?? ""} ${card.name ?? ""}`.toLowerCase();
  const c = new THREE.Color(card.color || "#ffb000");
  const main = mat(c);
  const dark = mat(c.clone().multiplyScalar(0.55));
  const light = mat(c.clone().lerp(new THREE.Color("#ffffff"), 0.5));

  if (/mug|cup/.test(text)) {
    return [
      mesh(new THREE.CylinderGeometry(h * 0.62, h * 0.55, S * 0.85, 24), main, 0, 0, 0),
      mesh(new THREE.TorusGeometry(h * 0.32, h * 0.09, 10, 20, Math.PI), dark, h * 0.62, 0, 0, 0, 0, -Math.PI / 2),
      mesh(new THREE.CylinderGeometry(h * 0.58, h * 0.58, S * 0.08, 24), light, 0, -h * 0.8, 0),
      mesh(new THREE.TorusGeometry(h * 0.6, h * 0.05, 8, 24), light, 0, h * 0.84, 0, Math.PI / 2),
    ];
  }
  if (/duck|bird/.test(text)) {
    return [
      mesh(new THREE.SphereGeometry(h * 0.65, 20, 14), main, 0, -h * 0.2, 0),
      mesh(new THREE.SphereGeometry(h * 0.4, 18, 12), main, h * 0.25, h * 0.55, 0),
      mesh(new THREE.ConeGeometry(h * 0.14, h * 0.35, 12), mat("#ff7a00"), h * 0.75, h * 0.5, 0, 0, 0, -Math.PI / 2),
      mesh(new THREE.SphereGeometry(h * 0.28, 12, 10), dark, -h * 0.55, -h * 0.05, 0),
      mesh(new THREE.SphereGeometry(h * 0.22, 12, 10), dark, 0, -h * 0.15, h * 0.55),
      mesh(new THREE.SphereGeometry(h * 0.22, 12, 10), dark, 0, -h * 0.15, -h * 0.55),
    ];
  }
  if (/shoe|sneaker|boot/.test(text)) {
    return [
      mesh(new THREE.BoxGeometry(S * 0.55, h * 0.6, h * 0.65), main, -h * 0.1, h * 0.05, 0),
      mesh(new THREE.BoxGeometry(S, h * 0.22, h * 0.72), light, 0, -h * 0.4, 0),
      mesh(new THREE.SphereGeometry(h * 0.38, 14, 10), main, h * 0.58, -h * 0.12, 0),
      mesh(new THREE.BoxGeometry(h * 0.35, h * 0.45, h * 0.6), dark, -h * 0.8, -h * 0.05, 0),
      mesh(new THREE.TorusGeometry(h * 0.18, h * 0.04, 6, 12), light, -h * 0.15, h * 0.45, 0, Math.PI / 2),
    ];
  }
  if (/pan|skillet|wok/.test(text)) {
    return [
      mesh(new THREE.CylinderGeometry(h * 0.62, h * 0.52, h * 0.32, 26), mat("#3a3a3a", 0.4, 0.8), 0, -h * 0.05, 0),
      mesh(new THREE.BoxGeometry(S * 0.5, h * 0.1, h * 0.14), dark, h * 0.95, h * 0.08, 0),
      mesh(new THREE.CylinderGeometry(h * 0.08, h * 0.08, h * 0.12, 10), light, h * 1.18, h * 0.08, 0, 0, 0, Math.PI / 2),
      mesh(new THREE.TorusGeometry(h * 0.6, h * 0.05, 8, 26), mat("#555555", 0.35, 0.9), 0, h * 0.11, 0, Math.PI / 2),
    ];
  }
  if (/battery|cell/.test(text)) {
    return [
      mesh(new THREE.CylinderGeometry(h * 0.42, h * 0.42, S * 0.75, 22), main, 0, -h * 0.05, 0),
      mesh(new THREE.CylinderGeometry(h * 0.43, h * 0.43, S * 0.22, 22), mat("#c9a64a", 0.35, 0.7), 0, h * 0.42, 0),
      mesh(new THREE.CylinderGeometry(h * 0.16, h * 0.16, h * 0.14, 14), mat("#d9d9d9", 0.3, 0.9), 0, h * 0.86, 0),
      mesh(new THREE.CylinderGeometry(h * 0.4, h * 0.4, h * 0.08, 22), mat("#d9d9d9", 0.3, 0.9), 0, -h * 0.82, 0),
    ];
  }
  if (/bottle|jar|vase/.test(text)) {
    return [
      mesh(new THREE.CylinderGeometry(h * 0.4, h * 0.42, S * 0.6, 20), main, 0, -h * 0.25, 0),
      mesh(new THREE.CylinderGeometry(h * 0.16, h * 0.38, h * 0.45, 20), main, 0, h * 0.5, 0),
      mesh(new THREE.CylinderGeometry(h * 0.17, h * 0.17, h * 0.2, 14), dark, 0, h * 0.85, 0),
      mesh(new THREE.CylinderGeometry(h * 0.43, h * 0.43, h * 0.2, 20), light, 0, -h * 0.25, 0),
    ];
  }
  // generic robot of junk
  return [
    mesh(new THREE.BoxGeometry(h * 1.1, h * 1.0, h * 0.9), main, 0, 0, 0),
    mesh(new THREE.SphereGeometry(h * 0.35, 14, 10), light, 0, h * 0.7, 0),
    mesh(new THREE.BoxGeometry(h * 0.3, h * 0.7, h * 0.3), dark, h * 0.72, 0, 0),
    mesh(new THREE.BoxGeometry(h * 0.3, h * 0.7, h * 0.3), dark, -h * 0.72, 0, 0),
    mesh(new THREE.BoxGeometry(h * 1.2, h * 0.25, h * 1.0), dark, 0, -h * 0.62, 0),
  ];
}

// Built in roster for a quick demo without any setup.
export const DEMO_FIGHTERS = [
  {
    id: "demo-mug",
    status: "ready",
    label: "coffee mug",
    player: "Demo",
    card: {
      object: "coffee mug", name: "Mugsy Malone", title: "The Ceramic Menace", material: "ceramic", realSizeCm: 12, realMassKg: 0.35,
      style: "brawler", stats: { power: 7, speed: 5, armor: 7, stability: 5 }, signature: { name: "Hot Coffee Rush", kind: "charge" },
      entrance: "Fresh out of the dishwasher.", taunts: ["You are not my cup of tea.", "I have been dropped before.", "Espresso yourself."],
      hurt: "My handle!", koLine: "Chipped. Again.", winLine: "Grounds for victory.", color: "#e85d3a", element: "earth", builtBy: "demo",
    },
  },
  {
    id: "demo-duck",
    status: "ready",
    label: "rubber duck",
    player: "Demo",
    card: {
      object: "rubber duck", name: "Quackers", title: "The Bathtub Bandit", material: "rubber", realSizeCm: 10, realMassKg: 0.06,
      style: "speedster", stats: { power: 4, speed: 9, armor: 4, stability: 7 }, signature: { name: "Whirlpool", kind: "spin" },
      entrance: "Squeak squeak, coming through.", taunts: ["Float like a duck.", "Sting like a squeak.", "Catch me if you can."],
      hurt: "I am losing my feathers!", koLine: "Back to the bath.", winLine: "Lucky duck!", color: "#ffd21f", element: "water", builtBy: "demo",
    },
  },
  {
    id: "demo-pan",
    status: "ready",
    label: "cast iron pan",
    player: "Demo",
    card: {
      object: "cast iron pan", name: "Iron Skillet", title: "The Kitchen Tank", material: "cast iron", realSizeCm: 30, realMassKg: 1.8,
      style: "tank", stats: { power: 9, speed: 3, armor: 8, stability: 4 }, signature: { name: "Pancake Flip", kind: "slam" },
      entrance: "Seasoned for twenty years.", taunts: ["You are toast.", "I will flatten you.", "Hot stuff coming."],
      hurt: "Watch the handle!", koLine: "Into the sink I go.", winLine: "Well done.", color: "#5b5f66", element: "fire", builtBy: "demo",
    },
  },
  {
    id: "demo-shoe",
    status: "ready",
    label: "red sneaker",
    player: "Demo",
    card: {
      object: "sneaker", name: "Sole Survivor", title: "The Hallway Hustler", material: "rubber and fabric", realSizeCm: 28, realMassKg: 0.4,
      style: "brawler", stats: { power: 6, speed: 7, armor: 5, stability: 6 }, signature: { name: "Lace Lash", kind: "charge" },
      entrance: "Laced up and ready.", taunts: ["Get the boot.", "I kick for a living.", "Smell my victory."],
      hurt: "My laces!", koLine: "Lost my sole.", winLine: "Just did it.", color: "#d6273b", element: "air", builtBy: "demo",
    },
  },
  {
    id: "demo-battery",
    status: "ready",
    label: "AA battery",
    player: "Demo",
    card: {
      object: "AA battery", name: "Volt Vance", title: "The Drawer Dynamo", material: "steel and zinc", realSizeCm: 5, realMassKg: 0.024,
      style: "speedster", stats: { power: 5, speed: 8, armor: 6, stability: 5 }, signature: { name: "Short Circuit", kind: "charge" },
      entrance: "Fully charged and ready.", taunts: ["I am positive you lose.", "Shocking, right?", "Current champion."],
      hurt: "I am leaking!", koLine: "Battery low.", winLine: "Charged up.", color: "#2f3a8f", element: "lightning", builtBy: "demo",
    },
  },
];
