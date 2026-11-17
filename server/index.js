import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import multer from "multer";
import { WebSocketServer } from "ws";
import * as store from "./store.js";
import { enqueue, buildCard } from "./pipeline.js";
import { recapMatch, hasClaude, provider } from "./agent.js";
import { AholoClient } from "./aholo.js";

const PORT = Number(process.env.PORT) || 8787;
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
app.use(express.json({ limit: "1mb" }));

const hasLux = () => Boolean(process.env.AHOLO_API_KEY);

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  // Prefer common home network ranges first.
  return out.sort((a, b) => Number(!/^192\.168\./.test(a)) - Number(!/^192\.168\./.test(b)));
}

app.get("/api/status", async (_req, res) => {
  let credits = null;
  if (hasLux()) {
    try {
      credits = (await new AholoClient().balance()).credits;
    } catch {
      credits = null;
    }
  }
  res.json({ lux3d: hasLux(), claude: hasClaude(), agent: provider(), credits, lanIps: lanIps(), split: process.env.LUX3D_PART_SPLIT !== "0" });
});

app.get("/api/fighters", (_req, res) => res.json(store.list()));

app.post("/api/fighters", upload.single("photo"), async (req, res) => {
  const label = String(req.body?.label ?? "").trim().slice(0, 80);
  const player = String(req.body?.player ?? "").trim().slice(0, 24) || "Player";
  if (!req.file && !label) return res.status(400).json({ error: "Send a photo or describe the object." });
  const f = store.create({ label, player, hasPhoto: Boolean(req.file) });
  if (req.file) fs.writeFileSync(path.join(store.dirFor(f.id), "photo.jpg"), req.file.buffer);
  else store.dirFor(f.id);
  if (req.file) store.update(f.id, { photo: `/files/${f.id}/photo.jpg` });

  buildCard(f.id); // runs at once, no Lux3D needed
  if (hasLux()) enqueue(f.id);
  else {
    store.update(f.id, { stage: "No Lux3D key: placeholder shape", progress: 1 });
    // wait for the card, then mark ready
    (async () => {
      for (let i = 0; i < 120 && !store.get(f.id)?.card; i++) await new Promise((r) => setTimeout(r, 500));
      store.update(f.id, { status: "ready", stage: "Ready (placeholder shape)" });
    })();
  }
  res.json(store.get(f.id));
});

app.post("/api/fighters/:id/retry", (req, res) => {
  const f = store.get(req.params.id);
  if (!f) return res.status(404).json({ error: "Not found" });
  if (!f.card) buildCard(f.id);
  if (hasLux()) enqueue(f.id);
  res.json(store.get(f.id));
});

app.delete("/api/fighters/:id", (req, res) => {
  store.remove(req.params.id);
  res.json({ ok: true });
});

app.post("/api/recap", async (req, res) => {
  const { fighters = [], events = [], winner = null } = req.body ?? {};
  res.json({ text: await recapMatch({ fighters, events, winner }) });
});

app.use("/files", express.static(path.join(store.DATA_DIR, "fighters"), { maxAge: "1h" }));

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
} else {
  app.get("/", (_req, res) =>
    res.type("text").send("Client not built. Run `npm run play` for one port, or `npm run dev` and open http://localhost:5173"),
  );
}

const server = http.createServer(app);

// WebSocket relay: phones send actions, the arena host sends match state.
const wss = new WebSocketServer({ server, path: "/ws" });
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (msg, filter = () => true) => {
  for (const c of wss.clients) if (filter(c)) send(c, msg);
};

wss.on("connection", (ws) => {
  ws.role = "phone";
  send(ws, { type: "roster", fighters: store.list() });
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "host") ws.role = "host";
    else if (msg.type === "hello") ws.fighterId = msg.fighterId;
    else if (msg.type === "action") broadcast({ type: "action", fighterId: msg.fighterId, action: msg.action }, (c) => c.role === "host");
    else if (msg.type === "match" && ws.role === "host") broadcast(msg, (c) => c.role === "phone");
  });
});

store.onChange((fighters) => broadcast({ type: "roster", fighters }));

server.listen(PORT, "0.0.0.0", () => {
  const ip = lanIps()[0];
  console.log(`\n  Junk Drawer Arena server on http://localhost:${PORT}`);
  if (ip) console.log(`  Phones on the same Wi-Fi: http://${ip}:${PORT}/join.html`);
  console.log(`  Lux3D: ${hasLux() ? "on" : "OFF (set AHOLO_API_KEY)"}   AI agent: ${provider() ?? "off (rules builder)"}\n`);
});
