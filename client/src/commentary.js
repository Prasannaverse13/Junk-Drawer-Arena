// Live commentary from sim events. Shows a caption and can speak it out loud.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Commentator {
  constructor(el, { onLine } = {}) {
    this.el = el;
    this.onLine = onLine;
    this.voice = localStorage.getItem("jda-voice") !== "0";
    this.last = 0;
    this.current = "";
    this.cards = new Map();
    this.lastTaunt = new Map();
  }

  setVoice(on) {
    this.voice = on;
    localStorage.setItem("jda-voice", on ? "1" : "0");
    if (!on) speechSynthesis?.cancel();
  }

  setCards(list) {
    this.cards = new Map(list.map((c) => [c.id, c]));
  }

  name(id) {
    return this.cards.get(id)?.name ?? "Someone";
  }

  say(text, { priority = false } = {}) {
    const now = performance.now();
    if (!priority && now - this.last < 1400) return;
    this.last = now;
    this.current = text;
    this.el.textContent = text;
    this.el.classList.remove("pop");
    void this.el.offsetWidth;
    this.el.classList.add("pop");
    this.onLine?.(text);
    if (this.voice && "speechSynthesis" in window) {
      if (priority) speechSynthesis.cancel();
      if (speechSynthesis.speaking && !priority) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.12;
      u.pitch = 1.05;
      speechSynthesis.speak(u);
    }
  }

  intro(ids) {
    const names = ids.map((id) => this.name(id));
    this.say(names.length === 2 ? `${names[0]} versus ${names[1]}!` : `${names.length} way brawl! ${names.join(", ")}!`, { priority: true });
    ids.forEach((id, i) => {
      const c = this.cards.get(id);
      if (c?.entrance) setTimeout(() => this.say(`${c.name}: ${c.entrance}`, { priority: true }), 1700 + i * 1900);
    });
  }

  event(e) {
    const c = this.cards.get(e.id);
    switch (e.type) {
      case "move": {
        if (Math.random() < 0.6) this.say(`${this.name(e.id)} uses ${e.name}!`);
        break;
      }
      case "hit": {
        if (e.amount > 14) this.say(pick([`Huge hit on ${this.name(e.id)}!`, `${this.name(e.by)} lands a monster blow!`, `Oof! ${this.name(e.id)} felt that one.`]));
        else if (e.amount > 6 && Math.random() < 0.25) {
          const by = this.cards.get(e.by);
          const t = this.lastTaunt.get(e.by) ?? 0;
          if (by?.taunts?.length && performance.now() - t > 6000) {
            this.lastTaunt.set(e.by, performance.now());
            this.say(`${by.name}: ${pick(by.taunts)}`);
          }
        }
        break;
      }
      case "part": {
        const line = pick([`${this.name(e.id)} loses its ${e.part}!`, `There goes the ${e.part} of ${this.name(e.id)}!`, `The ${e.part} flies off ${this.name(e.id)}!`]);
        this.say(c?.hurt && Math.random() < 0.5 ? `${line} ${c.hurt}` : line, { priority: true });
        break;
      }
      case "ko": {
        const how = e.reason === "ringout" ? pick(["is out of the ring!", "falls into the void!", "takes the long drop!"]) : pick(["falls to pieces!", "is shattered!", "is scrap now!"]);
        this.say(`${this.name(e.id)} ${how}${c?.koLine ? ` ${c.koLine}` : ""}`, { priority: true });
        break;
      }
      case "shrink":
        this.say("Sudden death! The arena is shrinking!", { priority: true });
        break;
      case "end": {
        const w = this.cards.get(e.winner);
        setTimeout(
          () => this.say(w ? `${w.name} wins${e.reason === "time" ? " on points" : ""}! ${w.winLine ?? ""}` : "Nobody is left standing!", { priority: true }),
          900,
        );
        break;
      }
    }
  }
}
