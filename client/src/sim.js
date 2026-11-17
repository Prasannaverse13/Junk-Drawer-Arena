// Physics battle simulation. Pure logic on top of Rapier, no rendering,
// so it runs in the browser and in Node tests.
//
// A fighter is one rigid body made of several colliders, one per real part from Lux3D part split.
// Hard hits drain a part's HP. When a part runs out it breaks off and becomes its own body (debris).
// When the core part breaks the whole fighter falls apart. Falling off the arena is a ring out.

// Energy: every move costs energy. It refills over time, faster for quick fighters.
export const ENERGY = { max: 10, start: 4, costs: { attack: 4, jump: 2, dodge: 3 } };
export const energyRegen = (speed) => 0.55 + (speed / 10) * 0.5; // per second

export const ARENA = {
  radius: 9,
  shrinkStart: 45,
  shrinkEnd: 80,
  minRadius: 4.2,
  timeLimit: 95,
  floorY: 0,
};

const V = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  norm: (a) => {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
};

function rotate(q, v) {
  // v' = q v q^-1
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

const s01 = (v) => v / 10;
export let DMG = 0.6;
export const setDamage = (k) => (DMG = k); // stat 1..10 -> 0.1..1

export class Sim {
  constructor(R, { seed = 1 } = {}) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81 * 1.6, z: 0 });
    this.world.timestep = 1 / 60;
    this.queue = new R.EventQueue(true);
    this.time = 0;
    this.fighters = [];
    this.handles = new Map();
    this.pairCooldown = new Map();
    this.radius = ARENA.radius;
    this.floorRadius = -1;
    this.over = false;
    this.winner = null;
    this.rand = mulberry32(seed);
    this.humans = new Map(); // fighterId -> last time a phone acted
    this.setFloor(ARENA.radius);
  }

  setFloor(r) {
    const R = this.R;
    if (this.floor) this.world.removeRigidBody(this.floor);
    this.floor = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, ARENA.floorY - 0.5, 0));
    this.world.createCollider(R.ColliderDesc.cylinder(0.5, r).setFriction(0.9).setRestitution(0.1), this.floor);
    this.floorRadius = r;
  }

  // spec: { id, name, stats, mass, size, parts: [{ points: Float32Array, mass, core, bbox:{min,max} }] }
  addFighter(spec, slot, total) {
    const R = this.R;
    const ang = (slot / total) * Math.PI * 2 + Math.PI / 4;
    const ring = total > 2 ? 5.2 : 4.6;
    const halfH = spec.halfHeight ?? spec.size / 2;
    const pos = { x: Math.cos(ang) * ring, y: ARENA.floorY + halfH + 0.25, z: Math.sin(ang) * ring };
    const yaw = this.rand() * Math.PI * 2;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.25)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    const idx = this.fighters.length;
    const st = spec.stats;
    const lvlMul = 1 + 0.05 * ((spec.level ?? 1) - 1);
    const totalHp = 100 * lvlMul;
    const nonCore = spec.parts.filter((p) => !p.core);
    const nonCoreMass = nonCore.reduce((a, p) => a + p.mass, 0) || 1;
    const parts = spec.parts.map((p, i) => {
      const maxHp = lvlMul * (p.core ? (nonCore.length ? 40 : 100) : (60 * p.mass) / nonCoreMass);
      const collider = this.world.createCollider(this.colliderDesc(p).setMass(p.mass), body);
      this.handles.set(collider.handle, { f: idx, p: i });
      return { index: i, core: !!p.core, label: p.label || (p.core ? "core" : `part ${i + 1}`), points: p.points, bbox: p.bbox, mass: p.mass, hp: Math.max(4, maxHp), maxHp: Math.max(4, maxHp), collider, debris: null, attached: true };
    });
    const f = {
      id: spec.id,
      idx,
      spec,
      name: spec.name,
      stats: st,
      size: spec.size,
      halfH,
      body,
      parts,
      totalHp,
      alive: true,
      koReason: null,
      cd: { sig: 0, dodge: 0, jump: 0 },
      energy: ENERGY.start,
      element: spec.element ?? "earth",
      burn: null,
      tipped: 0,
      stuck: 0,
      stun: 0,
      slamPending: false,
      lastHitBy: null,
      damageDealt: 0,
      inertia: (spec.mass * spec.size * spec.size) / 6,
    };
    this.fighters.push(f);
    return f;
  }

  colliderDesc(p) {
    const R = this.R;
    let d = null;
    try {
      d = R.ColliderDesc.convexHull(p.points);
    } catch {
      d = null;
    }
    if (!d) {
      const b = p.bbox;
      const hx = Math.max(0.03, (b.max.x - b.min.x) / 2);
      const hy = Math.max(0.03, (b.max.y - b.min.y) / 2);
      const hz = Math.max(0.03, (b.max.z - b.min.z) / 2);
      d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation((b.max.x + b.min.x) / 2, (b.max.y + b.min.y) / 2, (b.max.z + b.min.z) / 2);
    }
    return d
      .setFriction(0.85)
      .setRestitution(0.2)
      .setActiveEvents(this.R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(1);
  }

  hp(f) {
    return Math.max(0, f.parts.reduce((a, p) => a + (p.attached ? p.hp : 0), 0));
  }

  hpFrac(f) {
    return f.alive ? Math.min(1, this.hp(f) / f.totalHp) : 0;
  }

  // Phone or keyboard input for a fighter.
  act(fighterId, action) {
    const f = this.fighters.find((x) => x.id === fighterId);
    if (!f || !f.alive || this.over) return [];
    this.humans.set(fighterId, this.time);
    const ev = [];
    let cost = ENERGY.costs[action];
    if (action === "dodge" && f.element === "air") cost = 2;
    if (cost == null) return ev;
    if (f.energy < cost) {
      ev.push({ type: "noenergy", id: f.id, action });
      return ev;
    }
    if (action === "attack" && f.cd.sig <= 0) this.signature(f, ev);
    else if (action === "jump" && f.cd.jump <= 0) this.jump(f, ev);
    else if (action === "dodge" && f.cd.dodge <= 0) this.dodge(f, ev, 1);
    else return ev;
    f.energy -= cost;
    return ev;
  }

  target(f) {
    const p = f.body.translation();
    let best = null;
    let bd = Infinity;
    for (const o of this.fighters) {
      if (o === f || !o.alive) continue;
      const d = V.len(V.sub(o.body.translation(), p));
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best ? { o: best, d: bd } : null;
  }

  dirTo(f, o) {
    const a = f.body.translation();
    const b = o.body.translation();
    return V.norm({ x: b.x - a.x, y: 0, z: b.z - a.z });
  }

  mass(f) {
    return Math.max(0.2, f.body.mass());
  }

  signature(f, ev) {
    const t = this.target(f);
    if (!t) return;
    const m = this.mass(f);
    const dir = this.dirTo(f, t.o);
    const pw = s01(f.stats.power);
    const kind = f.spec.signature?.kind || "charge";
    const boost = f.element === "lightning" ? 1.25 : 1;
    f.specialUntil = this.time + 1.2;
    f.cd.sig = 0.9;
    f.stun = 0;
    if (kind === "spin") {
      f.body.applyTorqueImpulse({ x: 0, y: f.inertia * (16 + pw * 14) * boost * (this.rand() < 0.5 ? -1 : 1), z: 0 }, true);
      f.body.applyImpulse(V.scale({ x: dir.x, y: 0.25, z: dir.z }, m * (5 + pw * 3)), true);
    } else if (kind === "slam") {
      const vy = (8 + pw * 2) * (boost > 1 ? 1.1 : 1);
      const flight = (2 * vy) / (9.81 * 1.6);
      const vh = Math.min(5, Math.max(0, t.d - (f.size + t.o.size) * 0.3) / flight);
      f.body.applyImpulse({ x: dir.x * m * vh, y: m * vy, z: dir.z * m * vh }, true);
      f.slamPending = true;
    } else {
      f.body.applyImpulse({ x: dir.x * m * (9 + pw * 7) * boost, y: m * 1.6, z: dir.z * m * (9 + pw * 7) * boost }, true);
    }
    ev.push({ type: "move", id: f.id, kind, element: f.element, name: f.spec.signature?.name || "Big Hit" });
  }

  jump(f, ev) {
    const m = this.mass(f);
    f.cd.jump = 0.6;
    f.body.applyImpulse({ x: 0, y: m * (f.element === "air" ? 10.5 : 8.5), z: 0 }, true);
    ev.push({ type: "jump", id: f.id });
  }

  dodge(f, ev, side) {
    const t = this.target(f);
    const m = this.mass(f);
    f.cd.dodge = 0.7;
    let dir = { x: 1, z: 0 };
    if (t) dir = this.dirTo(f, t.o);
    const s = side ?? (this.rand() < 0.5 ? -1 : 1);
    // sidestep, biased toward the arena center
    const p = f.body.translation();
    let px = -dir.z * s;
    let pz = dir.x * s;
    if (px * p.x + pz * p.z > 0) {
      px = -px;
      pz = -pz;
    }
    f.body.applyImpulse({ x: px * m * 7, y: m * 2.5, z: pz * m * 7 }, true);
    ev.push({ type: "dodge", id: f.id });
  }

  // AI and control forces for one fighter.
  drive(f, dt, ev) {
    const body = f.body;
    const m = this.mass(f);
    const st = f.stats;
    const p = body.translation();
    const v = body.linvel();
    const q = body.rotation();
    const up = rotate(q, { x: 0, y: 1, z: 0 });
    for (const k of Object.keys(f.cd)) f.cd[k] -= dt;
    f.energy = Math.min(ENERGY.max, f.energy + energyRegen(st.speed) * dt);
    f.stun = Math.max(0, f.stun - dt);

    const r = Math.hypot(p.x, p.z);
    const grounded = p.y < ARENA.floorY + f.halfH + 0.9 && r < this.radius + 0.3;

    // slam: crash down once we are falling
    if (f.slamPending && v.y < -0.5) {
      body.applyImpulse({ x: 0, y: -m * (14 + s01(st.power) * 6), z: 0 }, true);
      f.slamPending = false;
    }

    const t = this.target(f);
    if (!t) return;
    let dir = this.dirTo(f, t.o);

    // edge awareness: steer back to the middle near the rim
    const edge = r / this.radius;
    if (edge > 0.68) {
      const w = Math.min(1, (edge - 0.68) / 0.27) * 0.85;
      const c = V.norm({ x: -p.x, y: 0, z: -p.z });
      dir = V.norm({ x: dir.x * (1 - w) + c.x * w, y: 0, z: dir.z * (1 - w) + c.z * w });
    }

    // drive toward the target
    if (grounded && f.stun <= 0) {
      const maxV = 2.6 + s01(st.speed) * 4.2;
      const along = v.x * dir.x + v.z * dir.z;
      if (along < maxV || edge > 0.8) {
        const accel = Math.max(7 + s01(st.speed) * 12, edge > 0.8 ? 16 : 0);
        body.applyImpulse({ x: dir.x * m * accel * dt, y: 0, z: dir.z * m * accel * dt }, true);
      }
    }

    // stay upright like a weeble; stability decides how hard
    if (f.stun <= 0) {
      const kp = 10 + s01(st.stability) * 26;
      const kd = 3.5;
      const w = body.angvel();
      const ax = -up.z;
      const az = up.x;
      const I = f.inertia;
      body.applyTorqueImpulse({ x: I * (kp * ax - kd * w.x) * dt, y: 0, z: I * (kp * az - kd * w.z) * dt }, true);
    }

    // tipped over for too long: hop back up
    f.tipped = up.y < 0.35 ? f.tipped + dt : 0;
    if (f.tipped > 1.1 && grounded) {
      f.tipped = 0;
      body.applyImpulse({ x: -p.x * 0.08 * m, y: m * 7, z: -p.z * 0.08 * m }, true);
      body.applyTorqueImpulse({ x: -up.z * f.inertia * 10, y: 0, z: up.x * f.inertia * 10 }, true);
      f.stun = 0;
    }

    // stuck: far away and not moving
    const speed = Math.hypot(v.x, v.z);
    f.stuck = speed < 0.4 && t.d > f.size + t.o.size ? f.stuck + dt : 0;
    if (f.stuck > 2 && f.cd.jump <= 0) {
      f.stuck = 0;
      this.jump(f, ev);
    }

    // AI moves, unless a phone is driving this fighter
    const human = this.time - (this.humans.get(f.id) ?? -99) < 8;
    if (!human) {
      const reach = (f.size + t.o.size) * 0.9 + 1.8;
      const aggression = 0.6 + s01(st.power) * 0.4;
      if (f.cd.sig <= 0 && f.energy >= ENERGY.costs.attack && t.d < reach && grounded && this.rand() < aggression * dt * 6) {
        f.energy -= ENERGY.costs.attack;
        this.signature(f, ev);
      }
      const ov = t.o.body.linvel();
      const toMe = -(ov.x * dir.x + ov.z * dir.z);
      if (f.cd.dodge <= 0 && f.energy >= ENERGY.costs.dodge + 1 && toMe > 6 && t.d < 4 && this.rand() < s01(st.speed) * dt * 8) {
        f.energy -= ENERGY.costs.dodge;
        this.dodge(f, ev);
      }
    }
  }

  impactSpeed(f, n) {
    // approach speed along n plus a share of the spin
    const v = f.body.linvel();
    const w = f.body.angvel();
    return Math.max(0, v.x * n.x + v.y * n.y + v.z * n.z) + Math.abs(w.y) * f.size * 0.3;
  }

  damage(victim, partIdx, amount, attacker, ev, opts = {}) {
    if (!victim.alive || amount <= 0) return;
    let part = victim.parts[partIdx];
    if (!part || !part.attached) part = victim.parts.find((p) => p.core && p.attached) ?? victim.parts.find((p) => p.attached);
    if (!part) return;
    const before = this.hp(victim);
    if (victim.element === "earth") amount *= 0.85;
    if (victim.element === "water" && amount > 2) victim.energy = Math.min(ENERGY.max, victim.energy + 1);
    if (attacker && attacker.element === "fire" && (attacker.specialUntil ?? 0) > this.time && amount > 4 && !opts.burn) {
      victim.burn = { until: this.time + 2, next: this.time + 0.4, by: attacker };
      ev.push({ type: "burn", id: victim.id, by: attacker.id });
    }
    // the core is shielded while other parts still hang on it
    if (part.core && victim.parts.some((p) => !p.core && p.attached)) amount *= 0.45;
    part.hp -= amount;
    victim.lastHitBy = attacker?.id ?? victim.lastHitBy;
    if (attacker) attacker.damageDealt += amount;
    if (amount > 7) victim.stun = Math.min(0.7, amount / 30);
    if (part.hp <= 0) {
      if (part.core) {
        this.shatter(victim, ev);
        ev.push({ type: "ko", id: victim.id, reason: "shattered", by: attacker?.id });
        return;
      }
      const overflow = -part.hp;
      this.detach(victim, part, ev, attacker);
      const core = victim.parts.find((p) => p.core && p.attached);
      if (core && overflow > 0) {
        core.hp -= overflow * 0.5;
        if (core.hp <= 0) {
          this.shatter(victim, ev);
          ev.push({ type: "ko", id: victim.id, reason: "shattered", by: attacker?.id });
          return;
        }
      }
    }
    ev.push({ type: "hit", id: victim.id, by: attacker?.id, amount, burn: !!opts.burn, element: attacker?.element, special: (attacker?.specialUntil ?? 0) > this.time, hpBefore: before, hpAfter: this.hp(victim) });
  }

  detach(f, part, ev, attacker) {
    const R = this.R;
    if (!part.attached) return;
    const body = f.body;
    const t = body.translation();
    const q = body.rotation();
    const v = body.linvel();
    const w = body.angvel();
    this.handles.delete(part.collider.handle);
    this.world.removeCollider(part.collider, true);
    const db = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setRotation(q).setLinvel(v.x, v.y, v.z).setAngvel(w).setLinearDamping(0.1).setAngularDamping(0.3),
    );
    const c = this.world.createCollider(this.colliderDesc(part).setMass(Math.max(0.05, part.mass)), db);
    this.handles.set(c.handle, { f: f.idx, p: part.index, debris: true });
    // fling it away from the body
    const b = part.bbox;
    const local = { x: (b.max.x + b.min.x) / 2, y: (b.max.y + b.min.y) / 2, z: (b.max.z + b.min.z) / 2 };
    const out = V.norm(rotate(q, local.x || local.z ? local : { x: this.rand() - 0.5, y: 0.3, z: this.rand() - 0.5 }));
    const km = Math.max(0.05, part.mass);
    db.applyImpulse({ x: out.x * km * 5, y: km * 5 + Math.abs(out.y) * km * 2, z: out.z * km * 5 }, true);
    db.applyTorqueImpulse({ x: (this.rand() - 0.5) * km, y: (this.rand() - 0.5) * km, z: (this.rand() - 0.5) * km }, true);
    part.attached = false;
    part.collider = c;
    part.debris = db;
    part.hp = 0;
    ev.push({ type: "part", id: f.id, part: part.label, by: attacker?.id, left: f.parts.filter((p) => p.attached).length });
  }

  shatter(f, ev) {
    for (const p of f.parts) if (p.attached) this.detach(f, p, [], null);
    f.alive = false;
    f.koReason = "shattered";
    ev.push({ type: "shatter", id: f.id });
  }

  handleContacts(ev) {
    this.queue.drainContactForceEvents((e) => {
      const a = this.handles.get(e.collider1());
      const b = this.handles.get(e.collider2());
      if (!a || !b || a.f === b.f) return;
      if (a.debris && b.debris) return;
      const key = `${Math.min(e.collider1(), e.collider2())}:${Math.max(e.collider1(), e.collider2())}`;
      if ((this.pairCooldown.get(key) ?? -1) > this.time) return;
      this.pairCooldown.set(key, this.time + 0.35);
      const A = this.fighters[a.f];
      const B = this.fighters[b.f];
      if (a.debris || b.debris) {
        // flying debris hurts a little
        const [deb, hit, hitInfo] = a.debris ? [a, B, b] : [b, A, a];
        const part = this.fighters[deb.f].parts[deb.p];
        const sp = V.len(part.debris.linvel());
        if (sp > 4 && hit.alive) this.damage(hit, hitInfo.p, (sp - 4) * Math.sqrt(part.mass) * 0.9, this.fighters[deb.f], ev);
        return;
      }
      if (!A.alive || !B.alive) return;
      const pa = A.body.translation();
      const pb = B.body.translation();
      const n = V.norm(V.sub(pb, pa));
      const sA = this.impactSpeed(A, n);
      const sB = this.impactSpeed(B, V.scale(n, -1));
      const hit = (att, vic, s, vicPart) => {
        if (s < 1.4) return;
        const pw = 0.55 + s01(att.stats.power) * 0.9;
        const ar = 0.55 + s01(vic.stats.armor) * 0.9;
        const mass = Math.sqrt(this.mass(att));
        const dmg = DMG * Math.pow(s - 1.4, 1.25) * mass * (pw / ar);
        this.damage(vic, vicPart, dmg, att, ev);
        ev.push({ type: "impact", a: att.id, b: vic.id, element: att.element, special: (att.specialUntil ?? 0) > this.time, dmg, speed: s, x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 });
      };
      hit(A, B, sA, b.p);
      hit(B, A, sB, a.p);
    });
  }

  step(dt = 1 / 60) {
    const ev = [];
    if (this.over) {
      this.world.step(this.queue);
      this.queue.drainContactForceEvents(() => {});
      this.time += dt;
      return ev;
    }
    this.time += dt;

    // shrinking arena for sudden death
    if (this.time > ARENA.shrinkStart) {
      const k = Math.min(1, (this.time - ARENA.shrinkStart) / (ARENA.shrinkEnd - ARENA.shrinkStart));
      const r = ARENA.radius + (ARENA.minRadius - ARENA.radius) * k;
      if (this.floorRadius - r > 0.25) {
        if (this.floorRadius === ARENA.radius) ev.push({ type: "shrink" });
        this.setFloor(r);
      }
      this.radius = r;
    }

    for (const f of this.fighters) if (f.alive) this.drive(f, dt, ev);
    this.world.step(this.queue);
    this.handleContacts(ev);

    for (const f of this.fighters) {
      if (f.alive && f.burn) {
        if (this.time > f.burn.until) f.burn = null;
        else if (this.time >= f.burn.next) {
          f.burn.next += 0.4;
          this.damage(f, -1, 1.6, f.burn.by, ev, { burn: true });
        }
      }
    }
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const p = f.body.translation();
      if (p.y < ARENA.floorY - 3) {
        f.alive = false;
        f.koReason = "ringout";
        ev.push({ type: "ko", id: f.id, reason: "ringout", by: f.lastHitBy });
      }
    }
    // clean up far away debris
    for (const f of this.fighters)
      for (const p of f.parts)
        if (p.debris && p.debris.translation().y < -25 && !p.gone) {
          p.gone = true;
          this.handles.delete(p.collider.handle);
          this.world.removeRigidBody(p.debris);
          p.debris = null;
        }

    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length <= 1) {
      this.over = true;
      this.winner = alive[0]?.id ?? null;
      ev.push({ type: "end", winner: this.winner, reason: "ko" });
    } else if (this.time >= ARENA.timeLimit) {
      alive.sort((a, b) => this.hpFrac(b) - this.hpFrac(a));
      this.over = true;
      this.winner = alive[0].id;
      ev.push({ type: "end", winner: this.winner, reason: "time" });
    }
    return ev;
  }

  // Where to draw each part this frame.
  partPose(f, part) {
    if (part.gone) return null;
    const b = part.attached ? f.body : part.debris;
    return b ? { t: b.translation(), q: b.rotation() } : null;
  }

  dispose() {
    this.world.free();
    this.queue.free();
  }
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Game scale from real world facts.
export function gameMassFromKg(kg) {
  return Math.min(16, Math.max(2.5, 2 + 4 * Math.cbrt(Math.max(0.01, kg))));
}
export function gameSizeFromCm(cm) {
  const k = Math.min(1, Math.max(0, Math.log10(Math.max(1, cm) / 8) / Math.log10(100 / 8)));
  return 1.3 + 1.0 * k;
}
