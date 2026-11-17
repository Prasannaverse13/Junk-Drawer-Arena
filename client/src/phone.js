import { connect } from "./net.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let fighters = [];
let mineIds = JSON.parse(localStorage.getItem("jda-mine") || "[]");
let activeId = localStorage.getItem("jda-active") || null;
let matchState = null;
let photoFile = null;

$("#player").value = localStorage.getItem("jda-player") || "";

async function shrink(file, max = 1024) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.88));
}

$("#photo").addEventListener("change", () => {
  photoFile = $("#photo").files[0] || null;
  const snap = $("#snap");
  if (photoFile) {
    snap.style.backgroundImage = `url(${URL.createObjectURL(photoFile)})`;
    snap.classList.add("has");
  }
});

$("#go").addEventListener("click", async () => {
  const label = $("#label").value.trim();
  const player = $("#player").value.trim() || "Player";
  $("#err").textContent = "";
  if (!photoFile && !label) {
    $("#err").textContent = "Take a photo or describe the object.";
    return;
  }
  localStorage.setItem("jda-player", player);
  $("#go").disabled = true;
  $("#go").innerHTML = `<span class="o">Sending…</span>`;
  try {
    const fd = new FormData();
    if (photoFile) fd.append("photo", await shrink(photoFile), "photo.jpg");
    fd.append("label", label);
    fd.append("player", player);
    const r = await fetch("/api/fighters", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Upload failed");
    mineIds.push(j.id);
    activeId = j.id;
    localStorage.setItem("jda-mine", JSON.stringify(mineIds));
    localStorage.setItem("jda-active", activeId);
    photoFile = null;
    $("#photo").value = "";
    $("#snap").classList.remove("has");
    $("#snap").style.backgroundImage = "";
    $("#label").value = "";
  } catch (e) {
    $("#err").textContent = e.message;
  }
  $("#go").disabled = false;
  $("#go").innerHTML = `<span class="o">Build another</span>`;
  render();
});

function mine() {
  return fighters.filter((f) => mineIds.includes(f.id));
}

function render() {
  const list = mine();
  $("#view-mine").hidden = !list.length;
  $("#mine").innerHTML = list
    .slice()
    .reverse()
    .map((f) => {
      const c = f.card;
      const ready = f.status === "ready";
      const img = f.photo ? `<img src="${f.photo}" alt="" />` : `<div class="ph-img">📦</div>`;
      const sub = ready
        ? `${esc(c?.title ?? "")}`
        : f.status === "failed"
          ? `<span class="err">${esc(f.error ?? "Failed")}</span>`
          : `${esc(f.stage ?? "Building")}<div class="progress"><i style="width:${Math.round((f.progress ?? 0) * 100)}%"></i></div>`;
      return `<div class="mine ${f.id === activeId ? "active" : ""}" data-id="${f.id}">${img}<div class="t"><b>${esc(c?.name ?? f.label ?? "New fighter")}</b><small>${sub}</small></div></div>`;
    })
    .join("");

  const a = fighters.find((f) => f.id === activeId);
  $("#view-pad").hidden = !(a && a.status === "ready");
  if (a?.status === "ready" && a.card) {
    $("#pad-name").textContent = `${a.card.name}`;
    $("#pad-quote").textContent = `"${a.card.taunts?.[0] ?? ""}"`;
  }
  updateMatch();
}

function updateMatch() {
  const pad = $("#pad-state");
  const m = matchState;
  const me = m?.fighters?.find((f) => f.id === activeId);
  if (!m || m.state === "idle" || !me) {
    pad.textContent = m && m.state !== "idle" ? "Your fighter is not in this match" : "Waiting for the big screen to start a match";
    $("#pad-hp").style.width = "100%";
    return;
  }
  $("#pad-hp").style.width = `${Math.round(me.hp * 100)}%`;
  $("#pad-hp").style.background = me.hp > 0.5 ? "var(--ok)" : me.hp > 0.25 ? "var(--hot)" : "var(--bad)";
  if (m.state === "countdown") pad.textContent = "Get ready…";
  else if (m.state === "paused") pad.textContent = "Paused";
  else if (m.state === "over") pad.textContent = m.winner === activeId ? "You won!" : "Match over";
  else pad.textContent = me.alive ? "Fight! Use the buttons" : "Knocked out";
  if (me.energy != null) {
    $("#pad-en").style.width = `${(me.energy / (me.max || 10)) * 100}%`;
    for (const b of document.querySelectorAll(".pad button")) b.classList.toggle("short", me.energy < (me.costs?.[b.dataset.a] ?? 0));
  }
}

$("#mine").addEventListener("click", (e) => {
  const el = e.target.closest(".mine");
  if (!el) return;
  activeId = el.dataset.id;
  localStorage.setItem("jda-active", activeId);
  render();
});

for (const b of document.querySelectorAll(".pad button")) {
  const fire = (ev) => {
    ev.preventDefault();
    if (!activeId) return;
    net.send({ type: "action", fighterId: activeId, action: b.dataset.a });
    navigator.vibrate?.(20);
  };
  b.addEventListener("touchstart", fire, { passive: false });
  b.addEventListener("mousedown", fire);
}

const net = connect({
  hello: () => ({ type: "hello", fighterId: activeId }),
  onMessage(msg) {
    if (msg.type === "roster") {
      fighters = msg.fighters;
      render();
    } else if (msg.type === "match") {
      matchState = msg;
      updateMatch();
    }
  },
});
