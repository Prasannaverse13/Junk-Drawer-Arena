// Client for the Aholo Open API (Lux3D generation + OUS asset upload).
// Docs: https://labs.aholo.ai/api-docs/en
// Notes:
//  - The raw key goes in the Authorization header. No "Bearer".
//  - Every file input must be uploaded through OUS first. Outside URLs fail.
//  - Output URLs expire after about 2 hours, so we download them at once.
//  - One generation task runs per account at a time, so the pipeline queues jobs.
import { createHash } from "node:crypto";

export const AHOLO_BASE = "https://api.aholo.ai/global";
const LUX = `${AHOLO_BASE}/lux3d/v1`;

export class AholoError extends Error {
  constructor(message, kind = "unknown", retryable = false) {
    super(message);
    this.kind = kind;
    this.retryable = retryable;
  }
}

function mapBusinessError(code, message) {
  const m = `${code} ${message ?? ""}`.toUpperCase();
  if (m.includes("CONCURRENCY")) return new AholoError("Lux3D is busy with another task.", "concurrency", true);
  if (m.includes("CREDIT") || m.includes("BALANCE") || m.includes("INSUFFICIENT"))
    return new AholoError("The Lux3D account is out of credits.", "credits", false);
  if (m.includes("AUTH") || m.includes("TOKEN") || m.includes("PERMISSION") || m.includes("FORBIDDEN"))
    return new AholoError("Lux3D refused the key. Check AHOLO_API_KEY.", "auth", false);
  if (m.includes("PARAM") || m.includes("INVALID") || m.includes("ILLEGAL") || m.includes("SENSITIVE") || m.includes("AUDIT"))
    return new AholoError("Lux3D could not use that input. Try a clearer photo.", "input", false);
  return new AholoError(`Lux3D error ${code}.`, "unknown", false);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AholoClient {
  constructor(apiKey = process.env.AHOLO_API_KEY) {
    if (!apiKey) throw new AholoError("AHOLO_API_KEY is not set.", "auth", false);
    this.key = apiKey.trim();
  }

  async http(url, { retry = false, ousToken, ...init } = {}) {
    const tries = retry ? 3 : 1;
    let last = null;
    for (let i = 0; i < tries; i++) {
      if (i > 0) await sleep(700 * 2 ** i);
      let res;
      try {
        const headers = { ...(init.headers || {}) };
        if (ousToken) headers["ous-token-v2"] = ousToken;
        else headers["Authorization"] = this.key;
        res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30000) });
      } catch (e) {
        last = new AholoError("Could not reach Lux3D.", "network", true);
        continue;
      }
      const text = await res.text();
      if (res.status >= 500) {
        last = new AholoError("Lux3D server error.", "server", true);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new AholoError("Lux3D refused the key. Check AHOLO_API_KEY.", "auth", false);
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AholoError(`Lux3D sent an unreadable answer (HTTP ${res.status}).`, "server", false);
      }
      if (json && typeof json === "object" && "c" in json) {
        if (String(json.c) !== "0") throw mapBusinessError(String(json.c), String(json.m ?? "").split(this.key).join("[key]"));
        return json.d;
      }
      if (!res.ok) throw new AholoError(`Lux3D HTTP ${res.status}.`, res.status === 429 ? "concurrency" : "unknown", res.status === 429);
      return json;
    }
    throw last ?? new AholoError("Lux3D request failed.");
  }

  postJSON(path, body) {
    return this.http(LUX + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async create(path, body) {
    const d = await this.postJSON(path, body);
    const id = d && typeof d === "object" ? d.taskId ?? d.taskid : d;
    if (id === undefined || id === null || id === "") throw new AholoError("Lux3D gave no task id.", "server", false);
    return String(id);
  }

  imgTo3D(img, { version = "G1-Turbo", faceCount = 20000 } = {}) {
    return this.create("/generate/img-to-3d/task/create", { img, version, outputFormat: ["glb"], enablePbr: true, faceCount });
  }

  textTo3D(prompt, { version = "G1-Turbo", style = "photorealistic", faceCount = 20000 } = {}) {
    return this.create("/generate/text-to-3d/task/create", { prompt, style, version, outputFormat: ["glb"], enablePbr: true, faceCount });
  }

  partSplit(glbUrl) {
    return this.create("/part-split/task/create", { glbUrl });
  }

  async getTask(taskId) {
    const d = await this.http(`${LUX}/generate/task/get?taskid=${encodeURIComponent(taskId)}`, { retry: true });
    const raw = Number(d?.status ?? -1);
    const status = raw === 3 ? "done" : raw === 4 || raw === 5 ? "failed" : raw === 6 ? "cancelled" : "running";
    const outputs = (d?.outputs ?? []).map((o) => String(o?.content ?? "")).filter(Boolean);
    return { taskId, status, raw, outputs, message: d?.errorMsg ?? d?.message };
  }

  // Poll until done. Returns the output URLs.
  async waitTask(taskId, { timeoutMs = 10 * 60 * 1000, everyMs = 3000, onTick } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const t = await this.getTask(taskId);
      onTick?.(t, Date.now() - t0);
      if (t.status === "done") return t.outputs;
      if (t.status === "failed" || t.status === "cancelled")
        throw new AholoError(t.message ? `Lux3D task failed: ${t.message}` : "Lux3D task failed.", "input", false);
      await sleep(everyMs);
    }
    throw new AholoError("Lux3D took too long.", "network", true);
  }

  async balance() {
    const d = await this.http(`${LUX}/account/balance?source=100&agentName=junk-drawer-arena`, { retry: true });
    return { credits: Number(d?.availableCredits ?? 0) };
  }

  // Upload bytes through OUS. Returns the hosted URL that Lux3D accepts.
  async upload(data, filename) {
    const md5 = createHash("md5").update(data).digest("hex");
    const tok = await this.http(`${AHOLO_BASE}/asset/v1/token`, { retry: true });
    if (!tok?.ousToken || !tok.globalDomain) throw new AholoError("Upload service gave no token.", "server", true);
    const token = tok.ousToken;
    const dom = String(tok.globalDomain).replace(/\/+$/, "");
    const blockSize = Number(tok.blockSize) || 4 * 1024 * 1024;
    const blob = (b) => new Blob([new Uint8Array(b)], { type: "application/octet-stream" });
    const post = (p, body, headers = {}) => this.http(dom + p, { method: "POST", body, headers, ousToken: token });

    if (data.length <= blockSize) {
      const fd = new FormData();
      fd.append("md5", md5);
      fd.append("file", blob(data), filename);
      await post("/ous/api/v2/single/upload", fd);
    } else {
      const blocks = Math.ceil(data.length / blockSize);
      const form = new URLSearchParams({ md5, blocks: String(blocks), size: String(data.length), name: filename });
      const init = (await post("/ous/api/v2/block/upload/init", form.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
      })) ?? {};
      if (!init.deduplicated) {
        for (let i = 0; i < blocks; i++) {
          const fd = new FormData();
          fd.append("block", String(i + 1));
          fd.append("file", blob(data.subarray(i * blockSize, (i + 1) * blockSize)), filename);
          await post("/ous/api/v2/block/upload/part", fd);
        }
      }
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const st = (await this.http(dom + "/ous/api/v2/upload/status", { ousToken: token, retry: true })) ?? {};
      if (st.status === 5 && /^https?:\/\//.test(String(st.url ?? ""))) return String(st.url);
      if (st.status === 6 || st.status === 8) throw new AholoError("Upload to Lux3D failed.", "server", true);
      await sleep(800);
    }
    throw new AholoError("Upload to Lux3D timed out.", "network", true);
  }
}

export async function download(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if ([403, 404, 410].includes(r.status)) throw new AholoError("The Lux3D result link expired.", "expired", false);
      if (!r.ok) throw new AholoError(`Download failed (HTTP ${r.status}).`, "network", true);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (e instanceof AholoError && !e.retryable) throw e;
      if (i === 2) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// Pick the GLB url from a task's outputs.
export function pickGlb(outputs) {
  return outputs.find((u) => /\.glb(\?|$)/i.test(u)) ?? outputs.find((u) => /^https?:\/\//.test(u)) ?? null;
}
