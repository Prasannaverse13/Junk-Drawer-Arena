// The five elements. Shared by the sim, the renderer and the UI.
export const ELEMENTS = {
  fire: {
    name: "Fire",
    color: "#ff6a1a",
    glow: "#ffd23f",
    icon: "🔥",
    perk: "Special move sets the target on fire for 2 seconds.",
  },
  water: {
    name: "Water",
    color: "#1f8bff",
    glow: "#8fd6ff",
    icon: "💧",
    perk: "Gets 1 energy back every time it is hit.",
  },
  lightning: {
    name: "Lightning",
    color: "#ffd000",
    glow: "#7ae2ff",
    icon: "⚡",
    perk: "Special move hits 25 percent harder and faster.",
  },
  air: {
    name: "Air",
    color: "#2fd1b8",
    glow: "#c8fff6",
    icon: "🌪️",
    perk: "Dodge costs 2 energy and jumps go higher.",
  },
  earth: {
    name: "Earth",
    color: "#b07a3c",
    glow: "#ffcf8a",
    icon: "🪨",
    perk: "Takes 15 percent less damage.",
  },
};

export const ELEMENT_KEYS = Object.keys(ELEMENTS);

// Pick an element from the material when the card does not have one.
export function elementFor(card = {}) {
  if (card.element && ELEMENTS[card.element]) return card.element;
  const m = `${card.material ?? ""} ${card.object ?? ""}`.toLowerCase();
  if (/iron|steel|metal|alumin|copper|battery|electr|phone|remote|lamp|wire/.test(m)) return "lightning";
  if (/glass|water|bottle|rubber|duck|jelly|gel|ice/.test(m)) return "water";
  if (/ceramic|stone|clay|concrete|brick|soil|rock|plant|pot/.test(m)) return "earth";
  if (/foam|fabric|cloth|feather|paper|balloon|tissue|sneaker|shoe/.test(m)) return "air";
  if (/wood|candle|wax|coal|chili|pepper|match/.test(m)) return "fire";
  let h = 0;
  for (const c of String(card.name ?? m)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ELEMENT_KEYS[h % ELEMENT_KEYS.length];
}
