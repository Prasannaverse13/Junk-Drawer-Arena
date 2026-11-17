import RAPIER from "@dimforge/rapier3d-compat";
import QRCode from "qrcode";
import { ArenaView } from "./arena.js";
import { Sim, ARENA } from "./sim.js";
import { buildFighter } from "./fighter.js";
import { Commentator } from "./commentary.js";
import { ClipRecorder } from "./recorder.js";
import { DEMO_FIGHTERS } from "./procedural.js";
import { connect } from "./net.js";
import { sfx } from "./sfx.js";
import { ENERGY } from "./sim.js";
import { ELEMENTS, elementFor } from "./elements.js";
import { profile, trophies, arenaFor, levelOf, xpOf, addXp, addWin, winsOf, rarityOf, weightOf, ratingOf, XP_PER_LEVEL, MAX_LEVEL } from "./meta.js";

if (!profile.get()) location.replace("/?signin=1");

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SLOT_COLORS = ["#ff6a1f", "#5fb8ff", "#b6e35a", "#ff6fae"];

const view = new ArenaView($("#view"));
window.__jda = { view };
const recorder = new ClipRecorder($("#view"));
const commentator = new Commentator($("#caption"), {
  onLine: (t) => {
    recorder.hud.caption = t;
  },
});
// the commentator writes plain text into #caption; wrap it so the tape style applies
const capEl = $("#caption");
const capSpan = document.createElement("span");
capEl.appendChild(capSpan);
commentator.el = capSpan;

let serverFighters = [];
let status = {};
const selected = [];
let focusId = null;
let match = null;
let lastPicks = [];
const phones = new Map();
let preview = null;
let previewToken = 0;
let screen = "title";

await RAPIER.init();

// ---------- screens ----------

function setScreen(name) {
  screen = name;
  document.body.dataset.screen = name;
  document.querySelectorAll("#tabs .tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  if (name !== "garage") $("#spec").hidden = true;
  if (name === "title") view.setCamera("title");
  else if (name === "garage") view.setCamera("garage");
  else view.setCamera("fight");
}

// ---------- data helpers ----------

const allFighters = () => [...serverFighters, ...DEMO_FIGHTERS];
const findFighter = (id) => allFighters().find((f) => f.id === id);
const isDemo = (f) => f.id.startsWith("demo-");
const slotColor = (id) => SLOT_COLORS[selected.indexOf(id)] ?? SLOT_COLORS[0];

// ---------- 3D preview (title + garage) ----------

async function showPreview(ids) {
  const token = ++previewToken;
  const built = [];
  for (const id of ids) {
    const f = findFighter(id);
    if (f && f.status === "ready") built.push(await buildFighter(f));
  }
  if (token !== previewToken || match) return;
  if (preview) preview.sim.dispose();
  view.clearFighters();
  if (!built.length) {
    preview = null;
    return;
  }
  const sim = new Sim(RAPIER, { seed: 7 });
  built.forEach((b, i) => {
    const f = sim.addFighter(b.spec, i, built.length);
    view.addFighter(f, b);
  });
  preview = { sim, built };
}

function previewForScreen() {
  if (screen === "title") showPreview(DEMO_FIGHTERS.slice(0, 3).map((f) => f.id));
  else if (screen === "garage") showPreview(selected.length ? selected : focusId ? [focusId] : DEMO_FIGHTERS.slice(0, 2).map((f) => f.id));
}

// ---------- garage ----------

const STAT_ROWS = [
  ["power", "Power"],
  ["speed", "Speed"],
  ["armor", "Armor"],
  ["stability", "Balance"],
];
const EMOJI = { "demo-mug": "☕", "demo-duck": "🦆", "demo-pan": "🍳", "demo-shoe": "👟", "demo-battery": "🔋" };

function rarity(f) {
  return `r-${rarityOf(f).key}`;
}

function miniCard(f, { num = -1, extra = "" } = {}) {
  const c = f.card;
  const ready = f.status === "ready";
  const art = f.photo ? `<div class="art photo" style="background-image:url('${f.photo}')"></div>` : `<div class="art">${isDemo(f) ? EMOJI[f.id] : "📦"}</div>`;
  const lv = !ready
    ? f.status === "failed"
      ? `<div class="fail">${esc(f.error ?? "Build failed")}<br><button data-retry="${f.id}">Retry</button></div>`
      : `<div class="build">${esc(f.stage ?? "Waiting")}<div class="pb"><i style="width:${Math.round((f.progress ?? 0) * 100)}%"></i></div></div>`
    : `<div class="lv o">${weightOf(c).name}</div>`;
  return `<div class="card ${rarity(f)} ${num >= 0 ? "sel" : ""} ${ready ? "" : "waiting"} ${extra}" data-id="${f.id}" tabindex="0" role="button" aria-label="${esc(c?.name ?? f.label)}">
    ${c ? `<span class="cost o" title="Card level">${levelOf(f.id)}</span>` : ""}
    ${num >= 0 ? `<span class="num o">${num + 1}</span>` : ""}
    ${isDemo(f) ? "" : `<button class="del" data-del="${f.id}" aria-label="Remove">✕</button>`}
    ${art}
    ${c ? `<span class="elem" style="--ec:${ELEMENTS[elementFor(c)].color}" title="${ELEMENTS[elementFor(c)].name}">${ELEMENTS[elementFor(c)].icon}</span>` : ""}
    <div class="nm o">${esc(c?.name ?? f.label ?? "New fighter")}</div>
    ${lv}
  </div>`;
}

function renderSlots() {
  $("#slots").innerHTML = [0, 1, 2, 3]
    .map((i) => {
      const f = selected[i] && findFighter(selected[i]);
      return `<div class="dslot">${f ? miniCard(f, { num: i, extra: "in-deck" }) : `<span class="o">${i < 2 ? "Empty" : "Optional"}</span>`}</div>`;
    })
    .join("");
  const picks = selected.map(findFighter).filter(Boolean);
  const avg = picks.length ? picks.reduce((a, f) => a + levelOf(f.id), 0) / picks.length : 0;
  $("#deck-avg").innerHTML = `<i class="ic bolt"></i><span class="o">Average level ${avg.toFixed(1)}</span><small class="lead">${picks[0] ? `${esc(picks[0].card?.name)} is your leader` : ""}</small>`;
  $("#btn-fight").disabled = selected.length < 2 || !!match;
  $("#tray-hint").textContent = selected.length < 2 ? `Pick ${2 - selected.length} more to battle. Slot 1 is your leader` : selected.length < 4 ? "Ready. Add more or battle." : "Four fighters. Free for all.";
}

function renderSpec() {
  const f = focusId && findFighter(focusId);
  const el = $("#spec");
  if (!f || !f.card || screen !== "garage") {
    el.hidden = true;
    return;
  }
  const c = f.card;
  const inDeck = selected.includes(f.id);
  const lv = levelOf(f.id);
  const xp = xpOf(f.id);
  const r = rarityOf(f);
  const w = weightOf(c);
  const mass = c.realMassKg >= 1 ? c.realMassKg.toFixed(1) + " kg" : Math.round(c.realMassKg * 1000) + " g";
  el.hidden = false;
  el.innerHTML = `
    <div class="panel-head o">${esc(c.name)}<button type="button" class="x" data-spec-close aria-label="Close">✕</button></div>
    <div class="body">
      <div class="tags"><span class="tag el" style="background:${ELEMENTS[elementFor(c)].color}">${ELEMENTS[elementFor(c)].icon} ${ELEMENTS[elementFor(c)].name}</span><span class="tag ${r.key}">${r.name}</span><span class="tag">${w.name} weight</span><span class="tag">Level ${lv}</span></div>
      <div class="facts">${esc(c.title)}. A real ${esc(c.object)} made of ${esc(c.material)}, about ${Math.round(c.realSizeCm)} cm and ${mass}. ${f.parts > 1 ? `Lux3D split it into ${f.parts} real parts. Each part can break off.` : isDemo(f) ? "A starter card." : "Built as one piece cut into chunks."}</div>
      ${STAT_ROWS.map(([k, l]) => `<div class="stat o"><span>${l}</span><div class="meter"><i style="width:${(c.stats[k] ?? 0) * 10}%"></i></div><b>${c.stats[k]}</b></div>`).join("")}
      <div class="move o">${esc(c.signature?.name ?? "Big hit")}<small>${{ charge: "Rams straight ahead.", spin: "Spins and sweeps.", slam: "Jumps and crushes." }[c.signature?.kind] ?? ""} Costs ${ENERGY.costs.attack} energy.</small></div>
      <div class="perk"><b class="o">${ELEMENTS[elementFor(c)].name} perk</b>${ELEMENTS[elementFor(c)].perk}</div>
      <div class="xp"><span>XP ${xp % XP_PER_LEVEL}/${XP_PER_LEVEL}</span><div class="meter"><i style="width:${lv >= MAX_LEVEL ? 100 : ((xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100}%"></i></div><span>${winsOf(f.id)} wins</span></div>
      <div class="quote">“${esc(c.taunts?.[0] ?? "")}”</div>
      <div class="acts"><button class="cr-btn ${inDeck ? "red" : "green"}" data-use="${f.id}"><span class="o">${inDeck ? "Remove" : "Use"}</span></button></div>
    </div>`;
}

function renderRoster() {
  const list = allFighters();
  const grid = $("#roster");
  const scroll = grid.scrollTop;
  grid.innerHTML =
    `<div class="card add" id="card-add" tabindex="0" role="button" aria-label="Add your thing"><div><div class="plus o">+</div><div class="nm o">Add yours</div></div></div>` +
    list.map((f) => miniCard(f, { num: selected.indexOf(f.id) })).join("");
  grid.scrollTop = scroll;
  $("#coll-count").textContent = `Found ${list.filter((f) => f.status === "ready").length}`;
  renderSlots();
  renderTop();
}

function toggleSelect(id) {
  const f = findFighter(id);
  if (!f || f.status !== "ready") return;
  const i = selected.indexOf(id);
  if (i >= 0) selected.splice(i, 1);
  else {
    if (selected.length >= 4) selected.shift();
    selected.push(id);
    sfx.pick();
  }
  renderRoster();
  renderSpec();
  previewForScreen();
}

async function cardsClick(e) {
  sfx.unlock();
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    await fetch(`/api/fighters/${del.dataset.del}`, { method: "DELETE" });
    const i = selected.indexOf(del.dataset.del);
    if (i >= 0) selected.splice(i, 1);
    return;
  }
  const retry = e.target.closest("[data-retry]");
  if (retry) {
    e.stopPropagation();
    await fetch(`/api/fighters/${retry.dataset.retry}/retry`, { method: "POST" });
    return;
  }
  if (e.target.closest("#card-add")) return openForge();
  const card = e.target.closest(".card");
  if (!card) return;
  const f = findFighter(card.dataset.id);
  if (!f || f.status !== "ready") return;
  if (card.classList.contains("in-deck")) return toggleSelect(f.id);
  sfx.click();
  focusId = f.id;
  renderSpec();
  if (!selected.length) showPreview([f.id]);
}
$("#roster").addEventListener("click", cardsClick);
$("#slots").addEventListener("click", cardsClick);
$("#roster").addEventListener("dblclick", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (card) toggleSelect(card.dataset.id);
});
$("#spec").addEventListener("click", (e) => {
  if (e.target.closest("[data-spec-close]")) {
    focusId = null;
    $("#spec").hidden = true;
  }
  const use = e.target.closest("[data-use]");
  if (use) toggleSelect(use.dataset.use);
});

// ---------- home: top bar + build slots ----------

function renderTop() {
  const mine = serverFighters.filter((f) => f.status === "ready");
  const t = trophies.get();
  const ar = arenaFor(t);
  const p = profile.get();
  $("#tb-name").textContent = p?.name ?? "Player";
  $("#tb-level").textContent = String(ar.index);
  $("#tb-wins").textContent = String(t);
  $("#tb-credits").textContent = status.credits != null ? status.credits : status.lux3d === false ? "off" : "…";
  $("#tb-fighters").textContent = String(mine.length);
  $(".arena-tag").textContent = `Arena ${ar.index}: ${ar.name}${ar.next ? ` · next at ${ar.next}` : ""}`;
  $("#set-name").textContent = p?.name ?? "Player";
  $("#set-trophies").textContent = `${t} trophies`;
  const building = serverFighters.filter((f) => f.status !== "ready" && f.status !== "failed").length;
  $("#tab-badge").hidden = !building;
  $("#tab-badge").textContent = building;
  renderBuildSlots();
}

function renderBuildSlots() {
  const recent = serverFighters.slice(0, 4);
  const html = [];
  for (let i = 0; i < 4; i++) {
    const f = recent[i];
    if (!f) {
      html.push(`<button class="bslot empty" data-slot-add><span class="o">+</span><small>Add a thing</small></button>`);
      continue;
    }
    const art = `<div class="thumb" ${f.photo ? `style="background-image:url('${f.photo}')"` : ""}>${f.photo ? "" : "📦"}</div>`;
    if (f.status === "ready") html.push(`<button class="bslot ready" data-slot-open="${f.id}">${art}<span class="o">${esc(f.card?.name ?? "Ready")}</span></button>`);
    else if (f.status === "failed") html.push(`<button class="bslot failed" data-slot-open="${f.id}">${art}<span class="o">Failed</span><small>Tap to see</small></button>`);
    else html.push(`<div class="bslot">${art}<div class="pbar"><i style="width:${Math.round((f.progress ?? 0) * 100)}%"></i></div><small>${esc(f.stage ?? "Building")}</small></div>`);
  }
  $("#build-slots").innerHTML = html.join("");
}

$("#build-slots").addEventListener("click", (e) => {
  sfx.unlock();
  if (e.target.closest("[data-slot-add]")) return openForge();
  const open = e.target.closest("[data-slot-open]");
  if (open) {
    focusId = open.dataset.slotOpen;
    goGarage();
  }
});

$("#roster").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.target.click?.();
  }
});

// ---------- forge (add fighter) ----------

let forgeFile = null;
function openForge() {
  $("#forge").hidden = false;
  $("#add-label").focus();
}
function closeForge() {
  $("#forge").hidden = true;
  $("#add-form").reset();
  $("#drop-img").hidden = true;
  $("#drop-text").hidden = false;
  forgeFile = null;
}
$("#forge-cancel").addEventListener("click", closeForge);
$("#forge").addEventListener("click", (e) => e.target.id === "forge" && closeForge());
$("#add-player").value = profile.get()?.name || localStorage.getItem("jda-player") || "";
$("#add-photo").addEventListener("change", () => {
  forgeFile = $("#add-photo").files[0] || null;
  if (forgeFile) {
    $("#drop-img").src = URL.createObjectURL(forgeFile);
    $("#drop-img").hidden = false;
    $("#drop-text").hidden = true;
  }
});
$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const label = $("#add-label").value.trim();
  const player = $("#add-player").value.trim() || "Player";
  if (!forgeFile && !label) return;
  localStorage.setItem("jda-player", player);
  renderTop();
  const fd = new FormData();
  if (forgeFile) fd.append("photo", await shrinkImage(forgeFile), "photo.jpg");
  fd.append("label", label);
  fd.append("player", player);
  closeForge();
  sfx.pick();
  const r = await fetch("/api/fighters", { method: "POST", body: fd });
  if (!r.ok) alert((await r.json()).error ?? "Could not add");
});

async function shrinkImage(file, max = 1024) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.88));
}

// ---------- status + QR ----------

async function loadStatus() {
  try {
    status = await (await fetch("/api/status")).json();
  } catch {
    status = {};
  }
  const pill = (on, a, b) => `<span class="pill ${on ? "on" : "off"}">${on ? a : b}</span>`;
  $("#pills").innerHTML =
    pill(status.lux3d, "Lux3D on", "Lux3D key missing") +
    pill(status.claude, `AI: ${status.agent}`, "AI off") +
    (status.credits != null ? `<span class="pill">${status.credits} credits</span>` : "");
  renderTop();
  let host = location.hostname;
  if ((host === "localhost" || host === "127.0.0.1") && status.lanIps?.length) host = status.lanIps[0];
  const url = `${location.protocol}//${host}${location.port ? ":" + location.port : ""}/join.html`;
  $("#join-url").textContent = url;
  $("#qr").src = await QRCode.toDataURL(url, { margin: 1, width: 240 });
}

// ---------- HUD ----------

let hudEls = [];
const TEAM = ["#ff4f6e", "#4fb6ff", "#8ee25a", "#ffd23f"];
function buildHud() {
  const { built, fighters } = match;
  $("#hud").innerHTML = fighters
    .map((f, i) => {
      const entry = findFighter(f.id);
      const c = built[i].card;
      const face = entry?.photo ? `style="background-image:url('${entry.photo}')"` : "";
      return `<div class="plate" style="--c:${TEAM[i]}">
        <div class="face" ${face}>${entry?.photo ? "" : EMOJI[f.id] ?? "📦"}</div>
        <div class="info">
          <div class="nm">${ELEMENTS[elementFor(c)].icon} ${esc(c.name)}</div>
          <div class="hp"><i></i></div>
          <div class="meta"><div class="pips">${f.parts.map(() => "<b></b>").join("")}</div><span class="move"></span></div>
          <div class="en"><i></i><span></span></div>
        </div>
      </div>`;
    })
    .join("");
  hudEls = [...$("#hud").children].map((el) => ({ el, hp: el.querySelector(".hp"), bar: el.querySelector(".hp i"), pips: [...el.querySelectorAll(".pips b")], move: el.querySelector(".move"), en: el.querySelector(".en i"), enN: el.querySelector(".en span") }));
}

function updateHud() {
  if (!match) return;
  const { sim, fighters, built } = match;
  fighters.forEach((f, i) => {
    const h = hudEls[i];
    if (!h) return;
    const hp = sim.hpFrac(f);
    h.bar.style.width = `${hp * 100}%`;
    h.hp.classList.toggle("low", hp < 0.25 && f.alive);
    f.parts.forEach((p, k) => h.pips[k]?.classList.toggle("gone", !p.attached));
    h.el.classList.toggle("ko", !f.alive);
    h.el.classList.toggle("phone", Date.now() - (phones.get(f.id) ?? 0) < 8000);
    h.en.style.width = `${(f.energy / ENERGY.max) * 100}%`;
    h.enN.textContent = Math.floor(f.energy);
    const ready = f.energy >= ENERGY.costs.attack && f.alive;
    h.move.classList.toggle("ready", ready);
    h.move.textContent = ready ? `${built[i].card.signature?.name ?? "Special"} ready` : built[i].card.signature?.name ?? "";
  });
  const left = Math.max(0, ARENA.timeLimit - sim.time);
  const secs = Math.ceil(left);
  $("#timer").textContent = match.phase === "countdown" ? "1:35" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  document.querySelector(".time-box").classList.toggle("danger", sim.time > ARENA.shrinkStart);
  recorder.hud.bars = fighters.map((f, i) => ({ name: built[i].card.name, color: TEAM[i], hp: sim.hpFrac(f), alive: f.alive }));
}

// ---------- floating numbers and stamps ----------

function floatAt(x, y, z, html, cls, color) {
  const p = view.project(x, y, z);
  if (p.behind) return;
  const el = document.createElement("div");
  el.className = cls;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  if (color) el.style.setProperty("--c", color);
  el.innerHTML = html;
  $("#floaters").appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function centerMsg(text, pulse = false) {
  const el = $("#center-msg");
  el.textContent = text;
  el.classList.remove("pulse");
  if (pulse) {
    void el.offsetWidth;
    el.classList.add("pulse");
  }
}

// ---------- anime impact flash ----------

let hitStop = 0;
const impactCanvas = $("#impact");
const ictx = impactCanvas.getContext("2d");
let flash = null;
function sizeImpact() {
  impactCanvas.width = innerWidth;
  impactCanvas.height = innerHeight;
}
sizeImpact();
addEventListener("resize", sizeImpact);
function animeFlash(el, x, y, z, power = 1) {
  const p = view.project(x, y, z);
  if (p.behind) return;
  const E = ELEMENTS[el] ?? ELEMENTS.earth;
  const lines = [];
  for (let i = 0; i < 46; i++) lines.push({ a: Math.random() * Math.PI * 2, w: 2 + Math.random() * 7, r0: 60 + Math.random() * 120 });
  flash = { x: p.x, y: p.y, t: 0, life: 0.32, color: E.color, glow: E.glow, power, lines };
}
function drawFlash(dt) {
  ictx.clearRect(0, 0, impactCanvas.width, impactCanvas.height);
  if (!flash) return;
  flash.t += dt;
  const k = flash.t / flash.life;
  if (k >= 1) {
    flash = null;
    return;
  }
  const a = 1 - k;
  const W = impactCanvas.width;
  const H = impactCanvas.height;
  const R = Math.hypot(W, H);
  ictx.save();
  // speed lines toward the hit
  for (const l of flash.lines) {
    const r0 = l.r0 * (1 + k * 2) * flash.power;
    ictx.beginPath();
    ictx.moveTo(flash.x + Math.cos(l.a - 0.012) * r0, flash.y + Math.sin(l.a - 0.012) * r0);
    ictx.lineTo(flash.x + Math.cos(l.a) * R, flash.y + Math.sin(l.a) * R);
    ictx.lineTo(flash.x + Math.cos(l.a + 0.012 * l.w) * R, flash.y + Math.sin(l.a + 0.012 * l.w) * R);
    ictx.closePath();
    ictx.fillStyle = l.w > 6 ? flash.glow : flash.color;
    ictx.globalAlpha = a * 0.4;
    ictx.fill();
  }
  // core glow
  const g = ictx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, 110 * flash.power * (0.6 + k));
  g.addColorStop(0, "rgba(255,255,255,0.8)");
  g.addColorStop(0.35, flash.color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ictx.globalAlpha = a * 0.6;
  ictx.fillStyle = g;
  ictx.fillRect(0, 0, W, H);
  ictx.restore();
}

// ---------- pause ----------

function pauseMatch() {
  if (!match || match.phase !== "fight" || match.paused) return;
  match.paused = true;
  view.paused = true;
  if (recorder.rec?.state === "recording") recorder.rec.pause();
  try {
    speechSynthesis.pause();
  } catch {}
  $("#pause").hidden = false;
  sfx.click();
}
function resumeMatch() {
  if (!match?.paused) return;
  match.paused = false;
  view.paused = false;
  if (recorder.rec?.state === "paused") recorder.rec.resume();
  try {
    speechSynthesis.resume();
  } catch {}
  $("#pause").hidden = true;
  lastT = performance.now();
  sfx.click();
}
async function exitMatch(restart = false) {
  $("#pause").hidden = true;
  if (recorder.recording || recorder.rec?.state === "paused") await recorder.stop();
  try {
    speechSynthesis.cancel();
  } catch {}
  view.paused = false;
  const ids = lastPicks;
  if (restart) {
    if (match) match.sim.dispose();
    match = null;
    view.clearFighters();
    startMatch(ids);
  } else leaveMatch("title");
}
$("#btn-pause").addEventListener("click", pauseMatch);
$("#pz-resume").addEventListener("click", resumeMatch);
$("#pz-restart").addEventListener("click", () => exitMatch(true));
$("#pz-exit").addEventListener("click", () => exitMatch(false));

// ---------- match flow ----------

async function startMatch(ids) {
  if (match || ids.length < 2) return;
  sfx.unlock();
  lastPicks = [...ids];
  previewToken++;
  if (preview) {
    preview.sim.dispose();
    preview = null;
  }
  const built = [];
  for (const id of ids) built.push(await buildFighter(findFighter(id)));
  commentator.setCards(built.map((b) => ({ id: b.spec.id, ...b.card })));

  // versus splash
  $("#vs-wrap").innerHTML = `<div class="vs-row">${built
    .map((b, i) => {
      const entry = findFighter(b.spec.id);
      return `${i > 0 ? '<div class="vs-x o">VS</div>' : ""}<div class="vs-fighter">${miniCard(entry)}<div class="vn o">${esc(b.card.name)}</div><div class="vp">${esc(entry?.player ?? "")}</div></div>`;
    })
    .join("")}</div>`;
  setScreen("versus");
  sfx.vs();
  await wait(2300);

  const sim = new Sim(RAPIER, { seed: (Math.random() * 1e9) | 0 });
  view.clearFighters();
  view.setRadius(ARENA.radius);
  const fighters = built.map((b, i) => {
    const f = sim.addFighter(b.spec, i, built.length);
    view.addFighter(f, b);
    return f;
  });
  match = { sim, built, fighters, events: [], phase: "countdown" };
  buildHud();
  updateHud();
  setScreen("fight");
  $("#keys").hidden = false;
  if ($("#opt-rec").checked) recorder.start();
  commentator.intro(ids);
  for (const n of ["3", "2", "1"]) {
    centerMsg(n, true);
    sfx.tick();
    await wait(800);
  }
  centerMsg("Fight!", true);
  sfx.go();
  match.phase = "fight";
  setTimeout(() => centerMsg(""), 800);
  setTimeout(() => ($("#keys").hidden = true), 6000);
}

function handleEvents(evs) {
  const { sim, fighters, built } = match;
  for (const e of evs) {
    if (e.type !== "impact") match.events.push({ t: +sim.time.toFixed(1), ...e, x: undefined, y: undefined, z: undefined });
    commentator.event(e);
    if (e.type === "impact") {
      if (e.speed > 2.5) sfx.hit(e.speed / 3);
      if (e.speed > 2.2) {
        view.vfx.impact(e.element, e.x, e.y, e.z, Math.max(0.6, e.speed / 6), e.special);
        view.addShake(Math.min(0.4, e.speed * 0.03));
      }
      if (e.dmg > 10 || (e.special && e.dmg > 5)) {
        animeFlash(e.element, e.x, e.y, e.z, Math.min(1.5, e.dmg / 14));
        hitStop = Math.min(0.12, 0.04 + e.dmg / 300);
      }
    } else if (e.type === "hit") {
      const f = fighters.find((x) => x.id === e.id);
      if (f && (e.amount > 2.5 || e.burn)) {
        const t = f.body.translation();
        floatAt(t.x, t.y + f.halfH + 0.8, t.z, Math.round(e.amount), `dmg ${e.amount > 14 ? "big" : ""}`, built[f.idx].card.color);
      }
    } else if (e.type === "part") {
      const f = fighters.find((x) => x.id === e.id);
      const t = f.body.translation();
      view.burst(t.x, t.y, t.z, built[f.idx].card.color, 50, 1.4);
      view.addShake(0.3);
      sfx.crack();
      floatAt(t.x, t.y + f.halfH + 1.6, t.z, `${esc(e.part)} lost`, "stamp-pop");
    } else if (e.type === "shatter") {
      const f = fighters.find((x) => x.id === e.id);
      const t = f.body.translation();
      view.burst(t.x, t.y, t.z, built[f.idx].card.color, 60, 1.6);
      sfx.crack();
    } else if (e.type === "move") {
      sfx.whoosh();
      const f = fighters.find((x) => x.id === e.id);
      if (f) {
        const t = f.body.translation();
        view.vfx.special(e.element, t.x, t.y, t.z, f.size);
      }
    } else if (e.type === "burn") {
      const f = fighters.find((x) => x.id === e.id);
      const t = f.body.translation();
      floatAt(t.x, t.y + f.halfH + 1.4, t.z, "Burning!", "dmg big");
    } else if (e.type === "noenergy") {
      const f = fighters.find((x) => x.id === e.id);
      const t = f.body.translation();
      floatAt(t.x, t.y + f.halfH + 1.2, t.z, "Need energy", "dmg");
    } else if (e.type === "ko") {
      view.addShake(0.5);
      sfx.ko();
      const f = fighters.find((x) => x.id === e.id);
      const t = f.body.translation();
      floatAt(t.x, Math.max(t.y, 1) + 1.5, t.z, e.reason === "ringout" ? "Ring out" : "KO", "stamp-pop");
    } else if (e.type === "end") {
      endMatch(e);
    }
  }
}

async function endMatch(e) {
  match.phase = "over";
  localStorage.setItem("jda-matches", String(Number(localStorage.getItem("jda-matches") || 0) + 1));
  const { sim, built, fighters, events } = match;
  const w = built.find((b) => b.spec.id === e.winner);
  // progress: every fighter gets XP, the winner gets more. Trophies follow your leader (slot 1).
  const leader = fighters[0]?.id;
  const ups = [];
  for (const f of fighters) {
    const r = addXp(f.id, f.id === e.winner ? 2 : 1);
    if (r.after > r.before) ups.push(`${built[f.idx].card.name} reached level ${r.after}`);
  }
  if (e.winner) addWin(e.winner);
  const delta = e.winner === leader ? 30 : -12;
  const tBefore = trophies.get();
  const tAfter = trophies.add(delta);
  match.reward = { delta: tAfter - tBefore, total: tAfter, ups, leaderWon: e.winner === leader };
  centerMsg(w ? `${w.card.name} wins!` : "Draw!", true);
  sfx.win();
  document.querySelector("#center-msg").style.fontSize = "clamp(40px, 6vw, 90px)";
  await wait(3400);
  document.querySelector("#center-msg").style.fontSize = "";
  const url = $("#opt-rec").checked ? await recorder.stop() : null;
  centerMsg("");
  $("#res-name").textContent = w ? w.card.name : "Nobody";
  $("#res-title").textContent = w ? w.card.title : "Everyone fell apart";
  $("#res-recap").textContent = "The commentator is thinking…";
  const parts = events.filter((x) => x.type === "part").length;
  const rw = match.reward;
  $("#res-reward").innerHTML = `<span class="rw ${rw.leaderWon ? "up" : "down"}"><i class="ic trophy"></i><b class="o">${rw.leaderWon ? "+" : "−"}${Math.abs(rw.delta)}</b></span><span class="o">${rw.leaderWon ? "Your leader won" : "Your leader lost"}</span>${rw.ups.map((u) => `<span class="lvup o">${esc(u)}</span>`).join("")}`;
  $("#res-stats").innerHTML = `<div><b>${Math.round(sim.time)}s</b>match</div><div><b>${parts}</b>parts lost</div><div><b>${fighters.filter((f) => f.koReason === "ringout").length}</b>ring outs</div>`;
  const clip = $("#res-clip");
  if (url) {
    clip.href = url;
    clip.download = `junk-drawer-arena-${Date.now()}.${recorder.ext ?? "webm"}`;
    clip.hidden = false;
  } else clip.hidden = true;
  setScreen("result");
  try {
    const r = await fetch("/api/recap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        winner: e.winner,
        fighters: built.map((b) => ({ id: b.spec.id, name: b.card.name, object: b.card.object, winLine: b.card.winLine })),
        events,
      }),
    });
    const j = await r.json();
    $("#res-recap").textContent = j.text;
    commentator.say(j.text, { priority: true });
  } catch {
    $("#res-recap").textContent = w ? `${w.card.name} wins.` : "What a mess.";
  }
}

function leaveMatch(to = "garage") {
  $("#pause").hidden = true;
  view.paused = false;
  if (match) match.sim.dispose();
  match = null;
  hudEls = [];
  speechSynthesis?.cancel?.();
  view.clearFighters();
  view.setRadius(ARENA.radius);
  setScreen(to);
  renderRoster();
  renderSpec();
  renderTop();
  previewForScreen();
}

// ---------- navigation ----------

function goGarage() {
  sfx.click();
  setScreen("garage");
  renderRoster();
  renderSpec();
  previewForScreen();
}
function goHome() {
  sfx.click();
  setScreen("title");
  renderTop();
  previewForScreen();
}
function openModal(id) {
  sfx.click();
  $(`#${id}`).hidden = false;
}
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => ($(`#${b.dataset.close}`).hidden = true)));
document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => e.target === m && (m.hidden = true)));

$("#tabs").addEventListener("click", (e) => {
  sfx.unlock();
  const t = e.target.closest(".tab");
  if (!t) return;
  const tab = t.dataset.tab;
  if (tab === "garage") goGarage();
  else if (tab === "title") goHome();
  else if (tab === "add") openForge();
  else if (tab === "join") openModal("join");
  else if (tab === "settings") openModal("settings");
});
$("#btn-logout").addEventListener("click", () => {
  profile.signOut();
  location.href = "/";
});
$("#side-join").addEventListener("click", () => openModal("join"));
$("#side-add").addEventListener("click", () => openForge());

$("#btn-play").addEventListener("click", () => {
  sfx.unlock();
  if (selected.filter((id) => findFighter(id)?.status === "ready").length >= 2) startMatch([...selected]);
  else goGarage();
});
$("#btn-quick").addEventListener("click", () => {
  sfx.unlock();
  const ready = allFighters().filter((f) => f.status === "ready");
  const mine = ready.filter((f) => !isDemo(f));
  const pool = [...mine, ...DEMO_FIGHTERS].filter((f, i, a) => a.indexOf(f) === i);
  const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 3).map((f) => f.id);
  selected.splice(0, selected.length, ...picks);
  startMatch(picks);
});
$("#btn-fight").addEventListener("click", () => startMatch([...selected]));
$("#res-rematch").addEventListener("click", () => {
  const ids = lastPicks;
  if (match) match.sim.dispose();
  match = null;
  startMatch(ids);
});
$("#res-lobby").addEventListener("click", () => leaveMatch("title"));

$("#opt-voice").checked = commentator.voice;
$("#opt-voice").addEventListener("change", (e) => commentator.setVoice(e.target.checked));
$("#opt-sfx").checked = sfx.on;
$("#opt-sfx").addEventListener("change", (e) => sfx.set(e.target.checked));

const KEYS = { q: [0, "attack"], w: [0, "jump"], e: [0, "dodge"], i: [1, "attack"], o: [1, "jump"], p: [1, "dodge"] };
window.addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT") return;
  const k = KEYS[ev.key.toLowerCase()];
  if (k && match?.phase === "fight" && !match.paused) {
    const f = match.fighters[k[0]];
    if (f) handleEvents(match.sim.act(f.id, k[1]));
  }
  if ((ev.key === "p" || ev.key === "P" || ev.key === "Escape") && match?.phase === "fight") {
    ev.preventDefault();
    return match.paused ? resumeMatch() : pauseMatch();
  }
  if (ev.key === "Escape") {
    if (!$("#forge").hidden) closeForge();
    else if (screen === "result") leaveMatch("garage");
    else if (screen === "garage") goHome();
    document.querySelectorAll(".modal").forEach((m) => (m.hidden = true));
  }
});

// ---------- network ----------

const net = connect({
  hello: { type: "host" },
  onMessage(msg) {
    if (msg.type === "roster") {
      serverFighters = msg.fighters.slice().reverse();
      for (let i = selected.length - 1; i >= 0; i--) if (!findFighter(selected[i])) selected.splice(i, 1);
      if (screen === "garage") {
        renderRoster();
        renderSpec();
      }
      renderTop();
    } else if (msg.type === "action" && match?.phase === "fight" && !match.paused) {
      phones.set(msg.fighterId, Date.now());
      handleEvents(match.sim.act(msg.fighterId, msg.action));
    }
  },
});

setInterval(() => {
  if (!match) return net.send({ type: "match", state: "idle" });
  const { sim, fighters, built } = match;
  net.send({
    type: "match",
    state: match.paused ? "paused" : match.phase,
    winner: sim.winner,
    fighters: fighters.map((f, i) => ({ id: f.id, name: built[i].card.name, hp: sim.hpFrac(f), alive: f.alive, energy: f.energy, max: ENERGY.max, costs: ENERGY.costs })),
  });
}, 300);

// ---------- loop ----------

let acc = 0;
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  drawFlash(dt);
  if (match && match.paused) {
    // frozen
  } else if (hitStop > 0) {
    hitStop -= dt;
  } else if (match && match.phase !== "countdown") {
    acc += dt;
    let steps = 0;
    while (acc >= 1 / 60 && steps < 5) {
      const evs = match.sim.step(1 / 60);
      if (evs.length) handleEvents(evs);
      acc -= 1 / 60;
      steps++;
      if (!match) break;
    }
    if (match) updateHud();
  } else if (preview && !match) {
    preview.sim.world.step();
    for (const f of preview.sim.fighters) f.body.setAngvel({ x: 0, y: 0.6, z: 0 }, true);
  }
  view.update(match?.sim ?? preview?.sim ?? null);
  recorder.frame();
  requestAnimationFrame(frame);
}

setScreen("title");
renderRoster();
renderTop();
previewForScreen();
loadStatus();
setInterval(loadStatus, 60000);
requestAnimationFrame(frame);
