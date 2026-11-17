// Small synthesized sound effects. No audio files needed.
let ctx = null;
let master = null;
let on = localStorage.getItem("jda-sfx") !== "0";

function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone({ f = 200, to = f, t = 0.12, type = "sine", v = 0.4, delay = 0 }) {
  const c = ac();
  if (!c || !on) return;
  const o = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + t);
  g.gain.setValueAtTime(v, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + t + 0.02);
}

function noise({ t = 0.15, v = 0.3, hp = 800, delay = 0 }) {
  const c = ac();
  if (!c || !on) return;
  const len = Math.floor(c.sampleRate * t);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = v;
  s.connect(f).connect(g).connect(master);
  s.start(c.currentTime + delay);
}

export const sfx = {
  get on() {
    return on;
  },
  set(v) {
    on = v;
    localStorage.setItem("jda-sfx", v ? "1" : "0");
  },
  unlock: () => ac(),
  click: () => tone({ f: 520, to: 700, t: 0.06, type: "square", v: 0.12 }),
  pick: () => {
    tone({ f: 420, to: 640, t: 0.08, type: "triangle", v: 0.25 });
    tone({ f: 640, to: 900, t: 0.1, type: "triangle", v: 0.2, delay: 0.07 });
  },
  hit: (power = 1) => {
    tone({ f: 150 + power * 20, to: 50, t: 0.14, type: "sine", v: Math.min(0.8, 0.3 + power * 0.08) });
    noise({ t: 0.08, v: Math.min(0.35, 0.1 + power * 0.04), hp: 1200 });
  },
  crack: () => {
    noise({ t: 0.22, v: 0.4, hp: 2200 });
    tone({ f: 900, to: 200, t: 0.18, type: "sawtooth", v: 0.15 });
  },
  whoosh: () => noise({ t: 0.25, v: 0.12, hp: 300 }),
  ko: () => {
    tone({ f: 300, to: 40, t: 0.7, type: "sawtooth", v: 0.3 });
    noise({ t: 0.5, v: 0.3, hp: 400 });
  },
  tick: () => tone({ f: 660, t: 0.09, type: "square", v: 0.18 }),
  go: () => {
    tone({ f: 440, to: 880, t: 0.25, type: "square", v: 0.25 });
    tone({ f: 880, to: 1320, t: 0.3, type: "square", v: 0.2, delay: 0.1 });
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: 0.22, type: "triangle", v: 0.28, delay: i * 0.12 }));
  },
  vs: () => {
    tone({ f: 90, to: 40, t: 0.5, type: "sawtooth", v: 0.4 });
    noise({ t: 0.35, v: 0.3, hp: 200 });
  },
};
