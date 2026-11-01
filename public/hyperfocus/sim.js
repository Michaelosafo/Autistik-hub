/* Hyperfocus GP race rules (also run by the server to check results). Built from the game source. */
/* Hyperfocus GP paid races: the race rules, shared word for word by the game and the server.
   The server replays each player's recorded buttons through this exact code to decide the places, so a faked result
   can't win. Only + - * / and min/max/abs/floor are used (no sin, cos or Math.random), which give the same answer on
   every phone, browser and server. */
const HFSim = (() => {
  const STEP = 1 / 30, SEG = 200, BASE = SEG * 60, RACE_SECS = 300, STEPS = 9000, LEN = 26000, K3 = 0.0032;
  const CARS = {
    street: { speed: 1.0, handle: 1.0, boost: 1.0, off: 1.0 },
    muscle: { speed: 1.06, handle: 0.86, boost: 1.15, off: 1.0 },
    super: { speed: 1.1, handle: 1.08, boost: 0.88, off: 1.25 },
    rally: { speed: 0.95, handle: 1.15, boost: 1.0, off: 0.45 },
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function rng(seed) {
    let s = seed | 0;
    return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** The course for a race: road pieces (for drawing), each segment's bend, and the nitro cans. */
  function track(seed) {
    const r = rng(seed), curve = [], pieces = [];
    let head = 0;
    const add = (e, h, l, c, hill) => {
      pieces.push([e, h, l, c, hill]);
      for (let n = 0; n < e; n++) curve.push(c * (n / e) * (n / e));
      for (let n = 0; n < h; n++) curve.push(c);
      for (let n = 0; n < l; n++) curve.push(c + (0 - c) * (n / l));
      head -= c * K3 * (e / 2 + h + l / 2);
    };
    add(0, 60, 0, 0, 0);
    while (curve.length < LEN) {
      const hill = Math.floor((r() - 0.5) * 70);
      if (r() < 0.22) add(25, 30 + Math.floor(r() * 40), 25, 0, hill);
      else {
        const e = 20 + Math.floor(r() * 40), l = 20 + Math.floor(r() * 40), c = [2, 3, 4, 5, 6][Math.floor(r() * 5)];
        let h = 25 + Math.floor(r() * 70);
        const a = head, q = r(), back = Math.abs(a) > 1.0 || q < 0.5 + Math.min(0.45, Math.abs(a) / 1.4);
        const sg = back ? (a > 0 ? 1 : -1) : (a > 0 ? -1 : 1);
        const maxTurn = Math.max(0.35, 1.25 - (back ? 0 : Math.abs(a)));
        h = Math.max(0, Math.min(h, Math.floor(maxTurn / (c * K3) - (e + l) / 2)));
        add(e, h, l, c * sg, hill);
      }
    }
    const fin = curve.length;
    add(0, 240, 0, 0, 0);
    const cans = new Map();
    for (let n = 120; n < fin; n += 60) cans.set(n, Math.floor((r() - 0.5) * 18) / 10);
    return { seed, curve, pieces, fin, cans };
  }
  /** A fresh car at the start line. */
  function start(car) {
    return { car: CARS[car] ? car : "street", pos: SEG * 20, x: 0, vx: 0, steer: 0, speed: 0, nitro: 60, boosting: false, scrape: 0, finished: false, ft: 0, t: 0, cans: 0 };
  }
  /** One 1/30 s step. bits: 1 left, 2 right, 4 nitro, 8 brake. */
  function step(T, s, bits) {
    s.t++;
    if (s.finished) { s.speed = Math.max(0, s.speed - BASE * 0.6 * STEP); s.pos += s.speed * STEP; return s; }
    const st = CARS[s.car], seg = Math.min(T.curve.length - 1, Math.floor(s.pos / SEG)), cv = T.curve[seg];
    const L = bits & 1, R = bits & 2, G = bits & 4, B = bits & 8;
    s.boosting = !!G && s.nitro > 0;
    if (s.boosting) s.nitro = Math.max(0, s.nitro - 26 * STEP); else s.nitro = Math.min(100, s.nitro + 3 * STEP);
    const maxS = BASE * st.speed * (s.boosting ? 1 + 0.45 * st.boost : 1);
    if (B) s.speed -= BASE * 1.3 * STEP;
    else if (s.speed < maxS) s.speed = Math.min(maxS, s.speed + (BASE / (s.boosting ? 2.4 : 4.2)) * STEP);
    else s.speed = Math.max(maxS, s.speed - (BASE / 3) * STEP);
    const sp = s.speed / BASE, grip = 2.1 * st.handle * Math.max(0.35, Math.min(1, sp));
    const tgt = (L ? -1 : 0) + (R ? 1 : 0);
    s.steer += (tgt - s.steer) * Math.min(1, STEP * (tgt ? 7 : 10));
    const want = s.steer * grip - grip * Math.min(1, sp) * cv * 0.28;
    s.vx += (want - s.vx) * Math.min(1, STEP * 7);
    s.x += s.vx * STEP;
    if (Math.abs(s.x) > 1.06) { s.x = s.x > 0 ? 1.06 : -1.06; s.vx = -s.vx * 0.25; if (s.speed > BASE * 0.35) { s.speed -= BASE * 0.9 * STEP; s.scrape = 6; } }
    if (s.scrape > 0) s.scrape--;
    if (Math.abs(s.x) > 1.0 && s.speed > BASE * 0.3) s.speed -= BASE * 0.6 * st.off * STEP;
    s.speed = clamp(s.speed, 0, BASE * 2.4);
    const prev = Math.floor(s.pos / SEG);
    s.pos += s.speed * STEP;
    const cur = Math.floor(s.pos / SEG);
    for (let n = prev + 1; n <= cur; n++) {
      const off = T.cans.get(n);
      if (off !== undefined && Math.abs(off - s.x) < 0.32) { s.nitro = Math.min(100, s.nitro + 38); s.cans++; }
    }
    if (s.pos >= T.fin * SEG) { s.finished = true; s.ft = s.t; }
    return s;
  }
  /** Buttons recorded as runs: "bits:count,bits:count". */
  function encode(list) {
    const out = []; let i = 0;
    while (i < list.length) { let j = i; while (j < list.length && list[j] === list[i]) j++; out.push(list[i] + ":" + (j - i)); i = j; }
    return out.join(",");
  }
  function decode(str) {
    const list = [];
    if (typeof str !== "string" || str.length > 200000) return null;
    for (const part of str.split(",")) {
      if (!part) continue;
      const m = /^(\d{1,2}):(\d{1,5})$/.exec(part);
      if (!m) return null;
      const b = +m[1], c = +m[2];
      if (b > 15 || list.length + c > STEPS) return null;
      for (let k = 0; k < c; k++) list.push(b);
    }
    return list;
  }
  /** Replays a whole race: the result the server trusts. */
  function replay(T, car, inputs) {
    const list = Array.isArray(inputs) ? inputs : decode(inputs);
    if (!list) return null;
    const s = start(car);
    for (let k = 0; k < STEPS; k++) step(T, s, k < list.length ? list[k] : 0);
    return { pos: s.pos, finished: s.finished, ft: s.ft, cans: s.cans };
  }
  /** Who places where: finishers by time, then everyone else by distance. */
  const better = (a, b) => (a.finished !== b.finished ? (a.finished ? -1 : 1) : a.finished ? a.ft - b.ft : b.pos - a.pos);
  return { STEP, SEG, BASE, RACE_SECS, STEPS, LEN, CARS, track, start, step, encode, decode, replay, better };
})();
window.HFSim=HFSim;
