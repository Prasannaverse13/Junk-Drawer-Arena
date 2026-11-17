// Progress and card rules. Kept in the browser (localStorage) for now.

const get = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const set = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

// ---------- profile ----------
export const profile = {
  get() {
    return get("jda-profile", null);
  },
  signIn(name) {
    const p = { name: String(name).trim().slice(0, 24) || "Player", since: Date.now() };
    set("jda-profile", p);
    localStorage.setItem("jda-player", JSON.stringify(p.name).slice(1, -1));
    return p;
  },
  signOut() {
    for (const k of ["jda-profile", "jda-player", "jda-trophies", "jda-matches", "jda-xp", "jda-wins"]) localStorage.removeItem(k);
  },
};

// ---------- trophies and arenas ----------
export const ARENAS = [
  { at: 0, name: "The Kitchen Counter" },
  { at: 200, name: "The Garage Workbench" },
  { at: 500, name: "The Dusty Attic" },
  { at: 900, name: "The Junkyard" },
  { at: 1400, name: "The Big Drawer" },
];
export const trophies = {
  get: () => get("jda-trophies", 0),
  add(n) {
    const v = Math.max(0, trophies.get() + n);
    set("jda-trophies", v);
    return v;
  },
};
export function arenaFor(t) {
  let i = 0;
  ARENAS.forEach((a, k) => t >= a.at && (i = k));
  const next = ARENAS[i + 1];
  return { index: i + 1, name: ARENAS[i].name, next: next ? next.at : null };
}

// ---------- card level from XP ----------
// every match gives XP. Winning gives more. Each level adds 5% HP.
export const XP_PER_LEVEL = 3;
export const MAX_LEVEL = 10;
export function xpOf(id) {
  return get("jda-xp", {})[id] ?? 0;
}
export function levelOf(id) {
  return Math.min(MAX_LEVEL, 1 + Math.floor(xpOf(id) / XP_PER_LEVEL));
}
export function addXp(id, n) {
  const all = get("jda-xp", {});
  const before = Math.min(MAX_LEVEL, 1 + Math.floor((all[id] ?? 0) / XP_PER_LEVEL));
  all[id] = (all[id] ?? 0) + n;
  set("jda-xp", all);
  const after = Math.min(MAX_LEVEL, 1 + Math.floor(all[id] / XP_PER_LEVEL));
  return { before, after };
}
export function winsOf(id) {
  return get("jda-wins", {})[id] ?? 0;
}
export function addWin(id) {
  const all = get("jda-wins", {});
  all[id] = (all[id] ?? 0) + 1;
  set("jda-wins", all);
}

// ---------- card facts ----------
export function rarityOf(f) {
  if (f.id?.startsWith("demo-")) return { key: "starter", name: "Starter" };
  if (f.split && f.parts >= 5) return { key: "legendary", name: "Legendary" };
  if (f.split) return { key: "epic", name: "Epic" };
  if (f.model) return { key: "rare", name: "Rare" };
  return { key: "common", name: "Common" };
}

export function weightOf(card) {
  const kg = card?.realMassKg ?? 0.5;
  if (kg < 0.2) return { key: "light", name: "Light", note: "fast but easy to knock out" };
  if (kg < 1.2) return { key: "middle", name: "Middle", note: "balanced" };
  return { key: "heavy", name: "Heavy", note: "slow but hard to push" };
}

// One number for the card corner: overall strength 1 to 10.
export function ratingOf(card, level = 1) {
  const s = card?.stats ?? {};
  const base = (s.power * 1.2 + s.armor + s.speed * 0.9 + s.stability * 0.7) / 3.8;
  return Math.max(1, Math.min(10, Math.round(base + (level - 1) * 0.3)));
}
