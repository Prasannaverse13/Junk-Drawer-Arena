// Build pipeline for one fighter:
//   photo or text -> OUS upload -> Lux3D image/text to 3D -> download GLB
//   -> OUS upload GLB -> Lux3D part split -> download split GLB
// The agent builds the fighter card at the same time.
// Lux3D runs one task per account at a time, so Lux3D work goes through a single queue.
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { AholoClient, AholoError, download, pickGlb } from "./aholo.js";
import { buildFighterCard } from "./agent.js";
import * as store from "./store.js";

const queue = [];
let running = false;

const setStage = (id, stage, progress, extra = {}) => store.update(id, { stage, progress, ...extra });

export function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  store.update(id, { status: "queued", stage: queue.length > 1 ? `In line (#${queue.length})` : "Starting", error: null });
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await buildModel(id);
    } catch (e) {
      console.error(`[pipeline] ${id} failed:`, e.message);
      store.update(id, { status: "failed", error: e.message || "Build failed", stage: "Failed" });
    }
    queue.forEach((qid, i) => store.update(qid, { stage: `In line (#${i + 1})` }));
  }
  running = false;
}

// Card building does not use Lux3D, so it runs right away.
export async function buildCard(id) {
  const f = store.get(id);
  if (!f) return;
  try {
    const photo = f.hasPhoto ? fs.readFileSync(store.filePath(id, "photo.jpg")) : null;
    const card = await buildFighterCard({ photo, text: f.label });
    store.update(id, { card });
  } catch (e) {
    console.error("[agent] card failed:", e.message);
  }
}

async function countMeshes(buf) {
  try {
    const io = new NodeIO();
    const doc = await io.readBinary(new Uint8Array(buf));
    let n = 0;
    for (const node of doc.getRoot().listNodes()) if (node.getMesh()) n++;
    return n;
  } catch {
    return 0;
  }
}

async function buildModel(id) {
  const f = store.get(id);
  if (!f) return;
  const lux = new AholoClient();
  const version = process.env.LUX3D_VERSION || "G1-Turbo";
  const faceCount = Number(process.env.LUX3D_FACE_COUNT) || 20000;
  const wantSplit = process.env.LUX3D_PART_SPLIT !== "0";
  store.update(id, { status: "building" });

  const retryBusy = async (fn) => {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof AholoError && e.kind === "concurrency" && i < 20) {
          setStage(id, "Lux3D is busy, waiting", store.get(id)?.progress ?? 0);
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        throw e;
      }
    }
  };

  // 1. generate
  let taskId;
  if (f.hasPhoto) {
    setStage(id, "Sending photo to Lux3D", 0.05);
    const url = await lux.upload(fs.readFileSync(store.filePath(id, "photo.jpg")), `${id}.jpg`);
    setStage(id, "Lux3D is building the 3D model", 0.1);
    taskId = await retryBusy(() => lux.imgTo3D(url, { version, faceCount }));
  } else {
    setStage(id, "Lux3D is building the 3D model", 0.1);
    const prompt = `${f.label}, a single household object, full view, clean background`;
    taskId = await retryBusy(() => lux.textTo3D(prompt, { version, faceCount }));
  }
  const outputs = await lux.waitTask(taskId, {
    onTick: (_t, ms) => setStage(id, "Lux3D is building the 3D model", Math.min(0.55, 0.1 + ms / 200000)),
  });
  const glbUrl = pickGlb(outputs);
  if (!glbUrl) throw new AholoError("Lux3D returned no model.", "server", false);
  setStage(id, "Downloading the model", 0.58);
  const glb = await download(glbUrl);
  fs.writeFileSync(store.filePath(id, "model.glb"), glb);
  store.update(id, { model: `/files/${id}/model.glb`, lux3dTask: taskId });

  // 2. part split
  if (wantSplit) {
    try {
      setStage(id, "Lux3D is finding the real parts", 0.62);
      const hosted = await lux.upload(glb, `${id}.glb`);
      const splitTask = await retryBusy(() => lux.partSplit(hosted));
      const sOut = await lux.waitTask(splitTask, {
        onTick: (_t, ms) => setStage(id, "Lux3D is finding the real parts", Math.min(0.95, 0.62 + ms / 400000)),
      });
      const sUrl = pickGlb(sOut);
      if (sUrl) {
        const split = await download(sUrl);
        const parts = await countMeshes(split);
        if (parts > 1) {
          fs.writeFileSync(store.filePath(id, "split.glb"), split);
          store.update(id, { split: `/files/${id}/split.glb`, parts });
        } else {
          store.update(id, { parts: 1, splitNote: "Lux3D found one part. The arena will cut chunks." });
        }
      }
    } catch (e) {
      console.warn(`[pipeline] part split skipped for ${id}:`, e.message);
      store.update(id, { splitNote: `Part split skipped: ${e.message}` });
    }
  }

  // wait briefly for the card if the agent is still thinking
  for (let i = 0; i < 40 && !store.get(id)?.card; i++) await new Promise((r) => setTimeout(r, 500));
  setStage(id, "Ready to fight", 1, { status: "ready" });
}
