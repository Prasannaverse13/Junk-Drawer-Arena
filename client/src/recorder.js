// Records each match as a shareable clip: the 3D view plus HP bars and captions drawn on top.
export class ClipRecorder {
  constructor(sourceCanvas) {
    this.src = sourceCanvas;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.g = this.canvas.getContext("2d");
    this.rec = null;
    this.chunks = [];
    this.url = null;
    this.hud = { bars: [], caption: "", title: "" };
  }

  get supported() {
    return typeof MediaRecorder !== "undefined" && !!this.canvas.captureStream;
  }

  start() {
    if (!this.supported) return false;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.chunks = [];
    const stream = this.canvas.captureStream(30);
    const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
    this.mime = mimeType || "video/webm";
    this.rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(500);
    return true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === "inactive") return resolve(this.url);
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime });
        this.url = URL.createObjectURL(blob);
        this.ext = this.mime.includes("mp4") ? "mp4" : "webm";
        resolve(this.url);
      };
      this.rec.stop();
    });
  }

  get recording() {
    return this.rec?.state === "recording";
  }

  // call right after the 3D render each frame
  frame() {
    if (!this.recording) return;
    const g = this.g;
    const W = 1280;
    const H = 720;
    const sw = this.src.width;
    const sh = this.src.height;
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    g.drawImage(this.src, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // HP bars
    const bars = this.hud.bars;
    const bw = Math.min(280, (W - 40) / Math.max(1, bars.length) - 16);
    bars.forEach((b, i) => {
      const x = 20 + i * (bw + 16);
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(x, 18, bw, 46);
      g.fillStyle = b.color;
      g.fillRect(x + 6, 46, (bw - 12) * b.hp, 10);
      g.fillStyle = "#fff";
      g.font = "bold 18px system-ui, sans-serif";
      g.fillText(b.name.slice(0, 22), x + 8, 38);
      if (!b.alive) {
        g.fillStyle = "#ff4d4d";
        g.fillText("KO", x + bw - 36, 38);
      }
    });

    // caption
    if (this.hud.caption) {
      g.font = "bold 30px system-ui, sans-serif";
      const text = this.hud.caption.slice(0, 80);
      const tw = g.measureText(text).width;
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect((W - tw) / 2 - 18, H - 92, tw + 36, 52);
      g.fillStyle = "#ffd36b";
      g.fillText(text, (W - tw) / 2, H - 56);
    }
    g.font = "bold 16px system-ui, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillText("JUNK DRAWER ARENA  |  3D by Aholo Lux3D", W - 340, H - 16);
  }
}
