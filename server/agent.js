import { ELEMENTS, elementFor } from "../client/src/elements.js";
// The fighter builder agent. It looks at the photo (or the text) and decides who this object is
// as a fighter: name, material, real size and mass, stats, signature move and lines.
// Uses Claude when ANTHROPIC_API_KEY is set. Otherwise a rules based builder keeps the game playable.

const provider = () => (process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "claude" : null);
const hasClaude = () => provider() !== null; // true when any AI provider key is set
const OPENAI_MODEL = () => process.env.OPENAI_MODEL || "gpt-6-luna";
const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const STAT_KEYS = ["power", "speed", "armor", "stability"];
const STYLES = ["brawler", "tank", "speedster", "trickster"];
const MOVES = ["charge", "spin", "slam"];

const SYSTEM = `You are the fighter builder for Junk Drawer Arena, a physics battle game.
Players photograph real objects from their home. Each object becomes a fighter. Its 3D model is made by Aholo Lux3D and split into its real parts. In battle, parts break off when hit hard.

Look at the object and design a fun, fair fighter that matches what the object really is.
- Physical facts must be realistic: material, real size in cm, real mass in kg.
- Stats follow physics. Heavy and dense objects get power and armor. Light objects get speed. Wide flat bases get stability. Tall thin things tip over.
- Stats are integers 1 to 10 and must add up to exactly 24.
- Pick one signature move: "charge" (a straight ram), "spin" (a spinning sweep), or "slam" (jump and crush).
- Pick one element that fits the object: "fire" (wood, candles, spicy, hot things), "water" (glass, rubber, bottles, bath toys), "lightning" (metal, batteries, electronics), "air" (light fabric, foam, paper, shoes), "earth" (ceramic, stone, clay, plants, heavy dense things).
- Lines are short, punchy, family friendly, and in character. No more than 10 words each.

Reply with only a JSON object, no markdown:
{"object":"what it is in 1 to 3 words","name":"fighter name, 1 to 3 words, a pun is welcome","title":"an epithet like The Ceramic Menace","material":"main material","realSizeCm":number,"realMassKg":number,"style":"brawler|tank|speedster|trickster","stats":{"power":n,"speed":n,"armor":n,"stability":n},"signature":{"name":"move name","kind":"charge|spin|slam"},"element":"fire|water|lightning|air|earth","entrance":"line","taunts":["line","line","line"],"hurt":"line when a part breaks off","koLine":"line when it loses","winLine":"line when it wins","color":"#rrggbb accent color that fits the object"}`;

// content: array of { type: "text", text } or { type: "image", source: { media_type, data } }
async function callClaude({ system, content, maxTokens = 700 }) {
  if (provider() === "openai") {
    const parts = content.map((c) =>
      c.type === "image"
        ? { type: "image_url", image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } }
        : { type: "text", text: c.text },
    );
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL(),
        max_completion_tokens: Math.max(maxTokens, 1500), // reasoning models spend tokens thinking
        reasoning_effort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: parts },
        ],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return j.choices?.[0]?.message?.content ?? "";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: CLAUDE_MODEL(), max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

function extractJson(text) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("No JSON in reply");
  return JSON.parse(text.slice(s, e + 1));
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Make stats fair: integers 1..10 that add up to 24.
export function balanceStats(stats) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = clamp(Math.round(Number(stats?.[k]) || 5), 1, 10);
  let guard = 0;
  let sum = STAT_KEYS.reduce((a, k) => a + out[k], 0);
  while (sum !== 24 && guard++ < 100) {
    const keys = [...STAT_KEYS].sort((a, b) => (sum > 24 ? out[b] - out[a] : out[a] - out[b]));
    const k = keys[0];
    out[k] += sum > 24 ? -1 : 1;
    out[k] = clamp(out[k], 1, 10);
    sum = STAT_KEYS.reduce((a, kk) => a + out[kk], 0);
  }
  return out;
}

function sanitize(card, fallbackObject) {
  const str = (v, d, n = 60) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : d);
  const taunts = Array.isArray(card.taunts) ? card.taunts.map((t) => str(t, "", 80)).filter(Boolean).slice(0, 3) : [];
  const kind = MOVES.includes(card?.signature?.kind) ? card.signature.kind : "charge";
  return {
    object: str(card.object, fallbackObject || "Thing", 40),
    name: str(card.name, "Mystery Object", 30),
    title: str(card.title, "The Unknown", 40),
    material: str(card.material, "plastic", 30),
    realSizeCm: clamp(Number(card.realSizeCm) || 20, 2, 300),
    realMassKg: clamp(Number(card.realMassKg) || 0.5, 0.01, 150),
    style: STYLES.includes(card.style) ? card.style : "brawler",
    stats: balanceStats(card.stats),
    signature: { name: str(card?.signature?.name, "Big Hit", 30), kind },
    entrance: str(card.entrance, "Let's do this.", 80),
    taunts: taunts.length ? taunts : ["Is that all?", "Come closer.", "I have been waiting."],
    hurt: str(card.hurt, "That was a good part!", 80),
    koLine: str(card.koLine, "I will be back.", 80),
    winLine: str(card.winLine, "Too easy.", 80),
    color: /^#[0-9a-f]{6}$/i.test(card.color ?? "") ? card.color : "#ffb000",
    element: ELEMENTS[card.element] ? card.element : elementFor({ material: card.material, object: card.object ?? fallbackObject, name: card.name }),
    builtBy: card.builtBy || "ai",
  };
}

// Rules based builder used without a Claude key.
const MATERIALS = [
  { re: /mug|cup|plate|bowl|vase|ceramic|teapot/i, material: "ceramic", density: 2.3, sizeCm: 12, massKg: 0.35 },
  { re: /shoe|boot|sneaker|slipper/i, material: "rubber and fabric", density: 0.6, sizeCm: 28, massKg: 0.4 },
  { re: /duck|toy|figure|doll|lego|block/i, material: "plastic", density: 0.9, sizeCm: 10, massKg: 0.08 },
  { re: /bottle|jar|glass/i, material: "glass", density: 2.5, sizeCm: 25, massKg: 0.5 },
  { re: /chair|stool|table|desk/i, material: "wood", density: 0.7, sizeCm: 85, massKg: 6 },
  { re: /hammer|wrench|pan|pot|iron|kettle|tool|scissor/i, material: "steel", density: 7.8, sizeCm: 30, massKg: 1.2 },
  { re: /book|box|notebook/i, material: "paper", density: 0.8, sizeCm: 24, massKg: 0.6 },
  { re: /plant|cactus|flower/i, material: "soil and leaves", density: 1.1, sizeCm: 30, massKg: 1.5 },
  { re: /lamp|clock|speaker|phone|remote|controller/i, material: "plastic and metal", density: 1.3, sizeCm: 20, massKg: 0.5 },
];

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function ruleBuilder(label) {
  const text = String(label || "mystery object").trim();
  const m = MATERIALS.find((x) => x.re.test(text)) ?? { material: "plastic", density: 1, sizeCm: 20, massKg: 0.5 };
  const h = hash(text);
  const heavy = m.density > 2;
  const stats = balanceStats({
    power: heavy ? 8 : 5 + (h % 3),
    speed: heavy ? 4 : 7 - (h % 2),
    armor: heavy ? 7 : 4 + ((h >> 3) % 3),
    stability: 5 + ((h >> 5) % 3),
  });
  const word = text.split(/\s+/).slice(-1)[0].replace(/[^a-z]/gi, "") || "Thing";
  const cap = word[0].toUpperCase() + word.slice(1).toLowerCase();
  const prefixes = ["Captain", "Sir", "Mega", "Lil", "Doctor", "Grand", "Turbo", "Iron"];
  const titles = ["The Unbreakable", "The Shelf Lord", "The Drawer Dweller", "The Couch Crusher", "The Counter King"];
  const colors = ["#ff5a36", "#3fa7ff", "#ffcc00", "#8ce04a", "#c86bff", "#ff6fae"];
  return sanitize(
    {
      object: text.slice(0, 40),
      name: `${prefixes[h % prefixes.length]} ${cap}`,
      title: titles[(h >> 4) % titles.length],
      material: m.material,
      realSizeCm: m.sizeCm,
      realMassKg: m.massKg,
      style: heavy ? "tank" : stats.speed >= 7 ? "speedster" : "brawler",
      stats,
      signature: { name: ["Full Send", "Drawer Slam", "Spin Cycle"][h % 3], kind: MOVES[h % 3] },
      entrance: `${cap} has entered the arena.`,
      taunts: ["You belong in the recycling.", "I survived the dishwasher.", "Nice parts. I will take them."],
      hurt: "Hey, I needed that!",
      koLine: "Put me back in the drawer.",
      winLine: "Clean house.",
      color: colors[h % colors.length],
      builtBy: "rules",
    },
    text,
  );
}

export async function buildFighterCard({ photo, photoType = "image/jpeg", text }) {
  if (!hasClaude()) return ruleBuilder(text || "mystery object");
  const content = [];
  if (photo) {
    content.push({ type: "image", source: { media_type: photoType, data: photo.toString("base64") } });
    content.push({ type: "text", text: text ? `The player says this is: ${text}. Build the fighter.` : "Build the fighter for this object." });
  } else {
    content.push({ type: "text", text: `The object: ${text}. Build the fighter.` });
  }
  try {
    const reply = await callClaude({ system: SYSTEM, content });
    return sanitize(extractJson(reply), text);
  } catch (e) {
    console.warn("[agent] AI failed, using rules builder:", e.message);
    return ruleBuilder(text || "mystery object");
  }
}

// After a match: a short play by play recap from the event log.
export async function recapMatch({ fighters, events, winner }) {
  const fallback = () => {
    const lost = events.filter((e) => e.type === "part").length;
    const w = fighters.find((f) => f.id === winner);
    return w
      ? `${w.name} takes it! ${lost} parts went flying. ${w.winLine || ""}`.trim()
      : `Nobody survived. ${lost} parts on the floor.`;
  };
  if (!hasClaude()) return fallback();
  try {
    const text = await callClaude({
      system:
        "You are a hype sports commentator for Junk Drawer Arena, where household objects fight with real physics. Write a 2 to 3 sentence recap of the match from the event log. Be funny, specific, and family friendly. Mention real parts that broke off. Plain text only.",
      content: [{ type: "text", text: JSON.stringify({ fighters, winner, events: events.slice(-40) }) }],
      maxTokens: 220,
    });
    return text.trim().slice(0, 600) || fallback();
  } catch (e) {
    console.warn("[agent] recap failed:", e.message);
    return fallback();
  }
}

export { hasClaude, provider };
