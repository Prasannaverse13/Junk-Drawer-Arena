// Tiny JSON store. Fighters live in data/fighters.json, files in data/fighters/<id>/.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB = path.join(DATA_DIR, "fighters.json");

fs.mkdirSync(path.join(DATA_DIR, "fighters"), { recursive: true });

let fighters = [];
try {
  fighters = JSON.parse(fs.readFileSync(DB, "utf8"));
} catch {
  fighters = [];
}

// Jobs that were mid flight when the server stopped get marked for retry.
for (const f of fighters) {
  if (f.status !== "ready" && f.status !== "failed") {
    f.status = "failed";
    f.error = "Server restarted during the build. Press retry.";
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB + ".tmp", JSON.stringify(fighters, null, 2));
    fs.renameSync(DB + ".tmp", DB);
  }, 100);
}

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn(fighters);
}

export function dirFor(id) {
  const d = path.join(DATA_DIR, "fighters", id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function list() {
  return fighters;
}

export function get(id) {
  return fighters.find((f) => f.id === id);
}

export function create(data) {
  const id = randomBytes(5).toString("hex");
  const f = { id, createdAt: Date.now(), status: "queued", stage: "Waiting in line", progress: 0, ...data };
  fighters.push(f);
  save();
  emit();
  return f;
}

export function update(id, patch) {
  const f = get(id);
  if (!f) return null;
  Object.assign(f, patch);
  save();
  emit();
  return f;
}

export function remove(id) {
  fighters = fighters.filter((f) => f.id !== id);
  save();
  emit();
}

export function filePath(id, name) {
  return path.join(DATA_DIR, "fighters", id, name);
}
