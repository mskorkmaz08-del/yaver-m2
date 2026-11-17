// How a project is really built on the bench. The breadboard lies in front of
// the board; every part with legs or header pins is plugged into its holes,
// placed so that legs that should be joined share a column of five holes; the
// rest (motors, the keypad's ribbon) sit on the bench. Jumper wires go from
// the board's header to free holes, rails and module pins, and lie over
// whatever is under them instead of looping through the air.
import * as THREE from "three";
import { arduinoUno, esp32, pinWorld, MAT } from "./parts.js?v=23";
import { buildPart } from "./project-parts.js?v=23";
import { dispose } from "./stage.js?v=23";

const P = 0.254; // 0.1 inch between holes
const Z0 = P / 2; // the cell grid sits half a pitch off centre in z, like the holes
const ROWS = "abcdefghij";
const UNO_GND = ["GND_D", "GND", "GND_2"];
const ESP_GND = ["GND1", "GND2", "GND3"];
const GAP = 1.0; // cm between the board and the breadboard

// Parts that stay on the bench, joined by jumper wires: motors and their
// driver boards, the keypad on its ribbon, batteries, and modules you hold
// or dip (RFID reader, water sensor) or whose body covers every hole (matrix).
export const OFF_BOARD = new Set(["servo", "stepper", "keypad", "motor_driver", "dc_motor", "battery_9v", "water", "rfid", "matrix"]);
const mountable = (p) => p.type !== "breadboard" && !OFF_BOARD.has(p.type);

// A plan whose parts plug in gets a breadboard if it has none, in its first
// build step.
const withBB = new WeakMap();
export function withBreadboard(plan) {
  if (withBB.has(plan)) return withBB.get(plan);
  let out = plan;
  if (plan.parts.some(mountable) && !plan.parts.some((p) => p.type === "breadboard")) {
    let id = "BB";
    while (plan.parts.some((p) => p.id === id)) id += "_";
    const bb = { id, type: "breadboard", label: "Breadboard", value: "", why: "Holds the parts. The 5 holes in each short column are joined inside, so legs in the same column are connected.", pins: ["+", "-"] };
    const first = plan.steps.findIndex((s) => !s.code_lines.length);
    out = { ...plan, parts: [bb, ...plan.parts], steps: plan.steps.map((s, i) => (i === first ? { ...s, parts: [id, ...s.parts] } : s)) };
  }
  withBB.set(plan, out);
  withBB.set(out, out);
  return out;
}

// ---- Measuring a part ------------------------------------------------------------------

// Its pins and the boxes of its pieces, in its own space.
function measure(obj, type) {
  obj.updateMatrixWorld(true);
  const pins = [...obj.userData.part.pins.values()].map((q) => ({ name: q.name, x: q.pos.x, y: q.pos.y, z: q.pos.z }));
  const boxes = [];
  let bottom = Infinity;
  obj.traverse((m) => {
    if (!m.isMesh || m.userData.pin !== undefined) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    const thin = b.max.x - b.min.x < 0.1 && b.max.z - b.min.z < 0.1; // a leg or a pin
    if (!thin) bottom = Math.min(bottom, b.min.y);
    boxes.push(b);
  });
  return { pins, boxes, bottom, type };
}

// Turning by a multiple of 90° about y, as three.js does.
const turn = (x, z, a) => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
function turnBox(b, a) {
  const pts = [turn(b.min.x, b.min.z, a), turn(b.max.x, b.max.z, a), turn(b.min.x, b.max.z, a), turn(b.max.x, b.min.z, a)];
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])), y0: b.min.y, y1: b.max.y };
}

// Groups numbers that are within `tol` of each other.
function clusters(values, tol) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1].at(-1) > tol) out.push([v]); else out[out.length - 1].push(v);
  return out.map((c) => c.reduce((s, v) => s + v, 0) / c.length);
}

// The ways a part's pins can go into the holes: one row of holes, or two rows
// either side of the centre channel. Columns follow the pin spacing.
function footprints(m) {
  const out = [];
  for (const [k, a] of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].entries()) {
    const pins = m.pins.map((p) => { const [x, z] = turn(p.x, p.z, a); return { ...p, x, z }; });
    const rows = clusters(pins.map((p) => p.z), 0.12);
    if (rows.length > 2) continue;
    // Only parts made to straddle the channel do: chips, displays, a button.
    if (rows.length === 2 && m.type !== "button" && !rows.every((r) => pins.filter((p) => Math.abs(p.z - r) < 0.12).length >= 2)) continue;
    const xs = clusters(pins.map((p) => p.x), 0.05);
    const colOf = [0];
    for (let i = 1; i < xs.length; i++) colOf.push(colOf[i - 1] + Math.max(1, Math.round((xs[i] - xs[i - 1]) / P)));
    const col = (x) => colOf[xs.reduce((best, v, i) => (Math.abs(v - x) < Math.abs(xs[best] - x) ? i : best), 0)];
    const side = (z) => (rows.length === 1 ? 0 : Math.abs(z - rows[0]) < Math.abs(z - rows[1]) ? 0 : 1);
    const placed = pins.map((p) => ({ name: p.name, col: col(p.x), side: side(p.z), x: p.x, z: p.z }));
    const seen = new Set();
    if (placed.some((p) => { const key = `${p.col}:${p.side}`; if (seen.has(key)) return true; seen.add(key); return false; })) continue;
    out.push({ rot: a, k, pins: placed, rows: rows.length, spread: rows.length === 2 ? rows[1] - rows[0] : 0, boxes: m.boxes.map((b) => turnBox(b, a)) });
  }
  return out;
}

// ---- Planning the bench ----------------------------------------------------------------

const plans = new WeakMap();

// Where everything goes, and every wire's two ends. Computed once per plan.
export function benchPlan(plan) {
  if (!plans.has(plan)) plans.set(plan, makeBench(plan));
  return plans.get(plan);
}

function makeBench(plan) {
  const temp = [];
  const keep = (o) => { temp.push(o); return o; };
  try { return planIt(plan, keep); } finally { for (const o of temp) dispose(o); }
}

function planIt(plan, keep) {
  const uno = plan.board === "uno";
  const board = keep(uno ? arduinoUno() : esp32());
  const bbSpec = plan.parts.find((p) => p.type === "breadboard");
  const bb = bbSpec ? keep(buildPart(bbSpec)) : null;
  const g = bb?.userData.grid;
  const place = new Map();

  // The board: behind the breadboard, its digital header facing it.
  const boardRot = uno ? Math.PI : 0;
  board.rotation.y = boardRot;
  board.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(board);
  const boardPos = [-(bbox.min.x + bbox.max.x) / 2, uno ? 0 : board.userData.size?.base ?? 0.51, (g ? -g.D / 2 - GAP : 0) - bbox.max.z];
  board.position.set(...boardPos);
  board.updateMatrixWorld(true);
  if (bb) place.set(bbSpec.id, { pos: [0, 0, 0], rot: 0, kind: "breadboard" });

  // Nets, from the plan's wires.
  const parent = new Map();
  const find = (a) => { if (!parent.has(a)) parent.set(a, a); let r = a; while (parent.get(r) !== r) r = parent.get(r); parent.set(a, r); return r; };
  for (const w of plan.wires) parent.set(find(`${w.from.part}.${w.from.pin}`), find(`${w.to.part}.${w.to.pin}`));
  const netOf = (part, pin) => find(`${part}.${pin}`);

  // Board pins by name (GND is shared out over the board's GND pins).
  // GND: the board's GND pin nearest the other end, each used once while they last.
  const gndUse = new Map();
  const boardPin = (pin, near) => {
    if (pin !== "GND") return pin;
    const list = uno ? UNO_GND : ESP_GND;
    const cost = (n) => (gndUse.get(n) ?? 0) * 100 + (near ? pinWorld(board, n).distanceTo(near) : 0);
    const name = list.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    gndUse.set(name, (gndUse.get(name) ?? 0) + 1);
    return name;
  };
  const boardX = (pin) => pinWorld(board, pin === "GND" ? (uno ? "GND" : "GND1") : pin).x;

  // ---- Into the breadboard -------------------------------------------------------------
  const cells = new Map(); // "ix,iz" → { owner, pin? }
  const solid = []; // [x0, x1, z0, z1] of each mounted part's body above the breadboard
  const cellKey = (x, z) => `${Math.round(x / P)},${Math.round((z - Z0) / P)}`;
  const halfNet = new Map(); // "c:half" → net
  const holeOf = new Map(); // "PART.pin" → { c, r }
  const measured = new Map();
  const objs = new Map();
  for (const p of plan.parts) {
    if (p.type === "breadboard") continue;
    const o = keep(buildPart(p));
    objs.set(p.id, o);
    measured.set(p.id, measure(o, p.type));
  }
  // Nothing may hang over the board itself.
  {
    const bb2 = new THREE.Box3().setFromObject(board);
    for (let ix = Math.floor((bb2.min.x - 0.3) / P); ix * P <= bb2.max.x + 0.3; ix++)
      for (let iz = Math.floor((bb2.min.z - Z0) / P); iz * P + Z0 <= bb2.max.z + 0.4; iz++) cells.set(`${ix},${iz}`, { owner: "BOARD" });
  }
  const holeXZ = (c, r) => [g.colX(c), g.rowZ(r)];
  const halfOf = (r) => (r < 5 ? 0 : 1);
  const halfFree = (c, half, extra) => {
    let n = 0;
    for (let r = half * 5; r < half * 5 + 5; r++) {
      const key = cellKey(...holeXZ(c, r));
      if (!cells.has(key) && !extra.has(key)) n++;
    }
    return n;
  };
  const off = [];
  let cursor = null;
  for (const p of plan.parts) {
    if (!mountable(p)) { if (p.type !== "breadboard") off.push(p); continue; }
    if (!g) { off.push(p); continue; }
    const m = measured.get(p.id);
    const pinTop = Math.max(...m.pins.map((q) => q.y));
    const sink = Math.max(0, Math.min(m.bottom - pinTop, 0.8));
    const y = g.H - pinTop - sink;
    // Where this part would like to be: near the board pins and holes it joins.
    const xs = [];
    for (const q of m.pins) {
      const n = netOf(p.id, q.name);
      for (const [node] of parent) {
        if (find(node) !== n) continue;
        const [part, pin] = [node.slice(0, node.indexOf(".")), node.slice(node.indexOf(".") + 1)];
        if (part === "BOARD") xs.push(boardX(pin));
        else if (holeOf.has(node)) xs.push(g.colX(holeOf.get(node).c));
      }
    }
    const target = xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : cursor ?? 0;
    let best = null;
    for (const fp of footprints(m)) {
      const width = Math.max(...fp.pins.map((q) => q.col));
      const rowSets = [];
      if (fp.rows === 1) for (let r = 0; r < 10; r++) rowSets.push([r, r]);
      else for (let a = 0; a < 5; a++) for (let b = 5; b < 10; b++) {
        const err = Math.abs(g.rowZ(b) - g.rowZ(a) - fp.spread);
        if (err < 0.2) rowSets.push([a, b, err]);
      }
      for (const [r0, r1, err = 0] of rowSets) for (let c0 = 0; c0 + width < g.cols; c0++) {
        const holes = fp.pins.map((q) => ({ name: q.name, c: c0 + q.col, r: q.side ? r1 : r0, x: q.x, z: q.z }));
        // Every hole free, and its column empty or already this net's.
        let ok = true, shared = 0;
        const mine = new Set();
        for (const h of holes) {
          const key = cellKey(...holeXZ(h.c, h.r));
          if (cells.has(key)) { ok = false; break; }
          mine.add(key);
          const net = halfNet.get(`${h.c}:${halfOf(h.r)}`);
          if (net !== undefined && net !== netOf(p.id, h.name)) { ok = false; break; }
          if (net !== undefined) {
            shared++;
            // More if a wire in the plan joins this pin to one already in that column: it won't be needed.
            const here = `${h.c}:${halfOf(h.r)}`;
            if (plan.wires.some((w) => [[w.from, w.to], [w.to, w.from]].some(([x, y]) => x.part === p.id && x.pin === h.name && holeOf.get(`${y.part}.${y.pin}`) && `${holeOf.get(`${y.part}.${y.pin}`).c}:${halfOf(holeOf.get(`${y.part}.${y.pin}`).r)}` === here))) shared++;
          }
        }
        if (!ok) continue;
        // The part's body: the cells under it (above the breadboard).
        const hx = holes.reduce((s, h) => s + g.colX(h.c), 0) / holes.length, hz = holes.reduce((s, h) => s + g.rowZ(h.r), 0) / holes.length;
        const px = holes.reduce((s, h) => s + h.x, 0) / holes.length, pz = holes.reduce((s, h) => s + h.z, 0) / holes.length;
        const tx = hx - px, tz = hz - pz;
        const body = new Set();
        for (const b of fp.boxes) {
          if (b.y1 + y < g.H + 0.02) continue; // inside the breadboard
          for (let ix = Math.ceil((b.x0 + tx + 0.03) / P); ix * P <= b.x1 + tx - 0.03; ix++)
            for (let iz = Math.ceil((b.z0 + tz - Z0 + 0.03) / P); iz * P + Z0 <= b.z1 + tz - 0.03; iz++) body.add(`${ix},${iz}`);
        }
        for (const key of body) if (cells.has(key)) { ok = false; break; }
        if (!ok) continue;
        // Bodies wider than the holes they cover (a buzzer) must not overlap
        // between holes either.
        const rects = fp.boxes.filter((b) => b.y1 + y >= g.H + 0.02).map((b) => [b.x0 + tx, b.x1 + tx, b.z0 + tz, b.z1 + tz]);
        // and nothing hangs over the breadboard's edge into the air.
        if (rects.some((r) => r[0] < -g.W / 2 || r[1] > g.W / 2 || r[2] < -g.D / 2 || r[3] > g.D / 2)) continue;
        if (rects.some((r) => solid.some((o) => r[0] < o[1] + 0.1 && o[0] < r[1] + 0.1 && r[2] < o[3] + 0.1 && o[2] < r[3] + 0.1))) continue;
        const all = new Set([...mine, ...body]);
        // Each column it uses (and each it covers) keeps a hole for a wire.
        const halves = new Set(holes.map((h) => `${h.c}:${halfOf(h.r)}`));
        for (const key of halfNet.keys()) halves.add(key);
        for (const hk of halves) {
          const [c, half] = hk.split(":").map(Number);
          if (!halfNet.has(hk) && !holes.some((h) => h.c === c && halfOf(h.r) === half)) continue;
          if (halfFree(c, half, all) < 1) { ok = false; break; }
        }
        if (!ok) continue;
        // Room to work: no other part's legs right next to these.
        let crowd = 0;
        for (const h of holes) for (const dc of [-2, -1, 1, 2]) for (let r = halfOf(h.r) * 5; r < halfOf(h.r) * 5 + 5; r++) {
          const o = cells.get(cellKey(...holeXZ(h.c + dc, r)));
          if (o?.pin && o.owner !== p.id && halfNet.get(`${h.c + dc}:${halfOf(h.r)}`) !== netOf(p.id, h.name)) crowd += Math.abs(dc) === 1 ? 3 : 1;
        }
        const rowCost = fp.rows === 2 ? err * 4 : r0 < 5 ? [4, 2.5, 0.6, 0, 0.3][r0] : 6 + [0.3, 0, 0.6, 2.5, 4][r0 - 5];
        const score = shared * 100 - Math.abs(hx - target) - rowCost - crowd - fp.k * 0.05;
        if (!best || score > best.score) best = { score, holes, body, rects, mine, pos: [tx, y, tz], rot: fp.rot };
      }
    }
    if (!best) { off.push(p); continue; }
    for (const key of best.mine) cells.set(key, { owner: p.id, pin: true });
    for (const key of best.body) if (!cells.has(key)) cells.set(key, { owner: p.id });
    solid.push(...best.rects);
    for (const h of best.holes) {
      holeOf.set(`${p.id}.${h.name}`, { c: h.c, r: h.r });
      halfNet.set(`${h.c}:${halfOf(h.r)}`, netOf(p.id, h.name));
    }
    place.set(p.id, { pos: best.pos, rot: best.rot, kind: "mounted", holes: best.holes });
    cursor = Math.max(...best.holes.map((h) => g.colX(h.c))) + 1.2;
  }

  // ---- On the bench ------------------------------------------------------------------------
  // In a row in front of the breadboard (or the board), pins facing it.
  // (past anything plugged in that reaches beyond the breadboard)
  let reach = g ? g.D / 2 : 0;
  for (const [key, o] of cells) if (o.owner !== "BOARD" && o.owner !== "wire") reach = Math.max(reach, Number(key.split(",")[1]) * P + Z0);
  const frontZ = g ? reach + 1.4 : 2.5;
  const row = [];
  for (const p of off) {
    const m = measured.get(p.id);
    const all = m.boxes.reduce((b, x) => b.union(x), new THREE.Box3());
    const cx = (all.min.x + all.max.x) / 2, cz = (all.min.z + all.max.z) / 2;
    const px = m.pins.reduce((s, q) => s + q.x, 0) / (m.pins.length || 1) - cx;
    const pz = m.pins.reduce((s, q) => s + q.z, 0) / (m.pins.length || 1) - cz;
    // Pins toward the breadboard; pins on two sides (a display) go left and
    // right, so their wires don't cross its face.
    const rot = Math.abs(px) + Math.abs(pz) < 0.3 ? (m.pins.some((q) => Math.abs(q.z - cz) > 0.5) ? Math.PI / 2 : 0) : Math.PI - Math.atan2(px, pz);
    const rb = m.boxes.map((b) => turnBox(b, rot));
    const x0 = Math.min(...rb.map((b) => b.x0)), x1 = Math.max(...rb.map((b) => b.x1)), z0 = Math.min(...rb.map((b) => b.z0));
    const xs = [];
    for (const q of m.pins) {
      const n = netOf(p.id, q.name);
      for (const [node] of parent) {
        if (find(node) !== n || node.startsWith(`${p.id}.`)) continue;
        const part = node.slice(0, node.indexOf(".")), pin = node.slice(node.indexOf(".") + 1);
        if (part === "BOARD") xs.push(boardX(pin));
        else if (holeOf.has(node)) xs.push(g.colX(holeOf.get(node).c));
      }
    }
    const target = xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
    row.push({ p, rot, x0, x1, z0, y: m.bottom === Infinity ? 0 : -m.bottom, target });
  }
  row.sort((a, b) => a.target - b.target);
  let right = -Infinity;
  for (const it of row) {
    const w = it.x1 - it.x0;
    let x = Math.max(it.target - w / 2, right + 1.2);
    right = x + w;
    place.set(it.p.id, { pos: [x - it.x0, it.y, frontZ - it.z0], rot: it.rot, kind: "bench" });
  }
  // Centre the row on the bench if it all went one way.
  if (row.length) {
    const xs = row.map((it) => place.get(it.p.id).pos[0]);
    const span = [Math.min(...row.map((it) => place.get(it.p.id).pos[0] + it.x0)), Math.max(...row.map((it) => place.get(it.p.id).pos[0] + it.x1))];
    const limit = g ? g.W / 2 + 6 : 20;
    const shift = span[1] > limit ? limit - span[1] : span[0] < -limit ? -limit - span[0] : 0;
    if (shift) row.forEach((it, i) => { place.get(it.p.id).pos[0] = xs[i] + shift; });
  }
  for (const [id, pl] of place) {
    const o = objs.get(id);
    if (!o) continue;
    o.position.set(...pl.pos);
    o.rotation.y = pl.rot;
    o.updateMatrixWorld(true);
  }

  // ---- Wires ----------------------------------------------------------------------------------
  const isRail = (e) => bbSpec && e.part === bbSpec.id;
  const UP = [0, 1, 0];
  const holeEnd = (c, r) => ({ kind: "hole", pos: [g.colX(c), g.H, g.rowZ(r)], dir: UP, name: `${ROWS[r]}${c + 1}`, c, r });
  const takeHole = (c, half, towardRails) => {
    const order = half === 0 ? [0, 1, 2, 3, 4] : [9, 8, 7, 6, 5];
    if (!towardRails) order.reverse();
    for (const r of order) {
      const key = cellKey(...holeXZ(c, r));
      if (!cells.has(key)) { cells.set(key, { owner: "wire" }); return holeEnd(c, r); }
    }
    return null;
  };
  const sideEnd = (id, pin) => {
    const o = objs.get(id);
    const at = pinWorld(o, pin);
    const centre = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const out = new THREE.Vector3(at.x - centre.x, 0, at.z - centre.z);
    if (out.lengthSq() < 1e-4) out.set(0, 0, -1);
    out.normalize();
    // A plug sits at the board's edge; one under the board pokes out of it.
    const edge = at.clone().addScaledVector(out, 0.15);
    edge.y = Math.max(edge.y, 0.15);
    return { kind: "pin", pos: edge.toArray(), dir: out.toArray(), part: id, pin };
  };
  const used = { top: { "+": false, "-": false }, bottom: { "+": false, "-": false } };
  const railTaken = new Set();
  const railEnd = (pin, line, nearX) => {
    used[line][pin] = true;
    const which = `${line}${pin}`;
    const z = g.railZ[["top-", "top+", "bottom+", "bottom-"].indexOf(which)];
    let best = null;
    for (let i = 0; i < g.rail; i++) {
      const key = `${which}:${i}`;
      if (railTaken.has(key) || cells.has(cellKey(g.railX(i), z))) continue;
      const d = Math.abs(g.railX(i) - nearX);
      if (!best || d < best.d) best = { i, d, key };
    }
    const i = best?.i ?? 0;
    if (best) railTaken.add(best.key);
    return { kind: "rail", pos: [g.railX(i), g.H, z], dir: UP, name: `${line} ${pin === "-" ? "−" : "+"} rail`, line, pin };
  };
  // A wire is only laid if its two ends aren't joined already: by a column of
  // the breadboard, or by wires laid before it.
  const phys = new Map();
  const pfind = (a) => { if (!phys.has(a)) phys.set(a, a); let r = a; while (phys.get(r) !== r) r = phys.get(r); phys.set(a, r); return r; };
  const physNode = (e) => {
    if (e.part === "BOARD") return `B:${e.pin}`;
    if (isRail(e)) return `R:${e.pin}`;
    const h = holeOf.get(`${e.part}.${e.pin}`);
    return h ? `H:${h.c}:${halfOf(h.r)}` : `P:${e.part}.${e.pin}`;
  };
  const roughEnd = (e) => {
    if (e.part === "BOARD") return { kind: "board", pos: pinWorld(board, e.pin === "GND" ? (uno ? "GND" : "GND1") : e.pin).toArray(), dir: UP };
    if (isRail(e)) return { kind: "rail", pos: [g.railX(0), g.H, g.railZ[e.pin === "+" ? 1 : 0]], dir: UP };
    const h = holeOf.get(`${e.part}.${e.pin}`);
    return h ? holeEnd(h.c, h.r) : sideEnd(e.part, e.pin);
  };
  const ends = plan.wires.map((w) => {
    const a = physNode(w.from), b = physNode(w.to);
    if (pfind(a) === pfind(b)) return { skip: true, sameColumn: a === b, a: roughEnd(w.from), b: roughEnd(w.to) };
    phys.set(pfind(a), pfind(b));
    return { skip: false };
  });
  // Board pins, module pins and holes first; rails last, near the other end.
  plan.wires.forEach((w, i) => {
    if (ends[i].skip) return;
    const one = (e, other) => {
      if (e.part === "BOARD") { const name = boardPin(e.pin, new THREE.Vector3(...roughEnd(other).pos)); return { kind: "board", pos: pinWorld(board, name).toArray(), dir: UP, name: e.pin, pin: name }; }
      if (isRail(e)) return null;
      const h = holeOf.get(`${e.part}.${e.pin}`);
      if (h) {
        const towardRails = !(other.part !== "BOARD" && !isRail(other) && !holeOf.has(`${other.part}.${other.pin}`)); // a module in front: use the front holes
        return takeHole(h.c, halfOf(h.r), halfOf(h.r) === 0 ? towardRails : !towardRails) ?? holeEnd(h.c, h.r);
      }
      return sideEnd(e.part, e.pin);
    };
    ends[i].a = one(w.from, w.to);
    ends[i].b = one(w.to, w.from);
  });
  plan.wires.forEach((w, i) => {
    const e = ends[i];
    if (e.skip) return;
    for (const [k, spec, other] of [["a", w.from, "b"], ["b", w.to, "a"]]) {
      if (e[k]) continue;
      const o = e[other];
      const line = !o || o.kind === "board" ? "top" : o.kind === "hole" ? (o.r < 5 ? "top" : "bottom") : o.kind === "pin" ? "bottom" : "top";
      e[k] = railEnd(spec.pin === "+" ? "+" : "-", line, o ? o.pos[0] : 0);
    }
  });
  // Joining the top and bottom rails, when both are used.
  const bridges = [];
  for (const pin of ["-", "+"]) {
    if (!(used.top[pin] && used.bottom[pin])) continue;
    const at = plan.wires.findIndex((w, i) => !ends[i].skip && [ends[i].a, ends[i].b].some((x) => x.kind === "rail" && x.pin === pin && x.line === "bottom"));
    const x = -g.W / 2 + 0.6 + (pin === "+" ? 0.25 : 0);
    bridges.push({ at, color: pin === "-" ? "black" : "red", a: railEnd(pin, "top", x), b: railEnd(pin, "bottom", x) });
  }

  return {
    board: { pos: boardPos, rot: boardRot },
    place,
    wires: ends,
    bridges,
    jumpers: ends.filter((e) => !e.skip).length + bridges.length,
    holes: holeOf,
    grid: g ? { cols: g.cols } : null,
  };
}

// A hole's name, like "d12".
export const holeName = (h) => `${ROWS[h.r]}${h.c + 1}`;

// ---- Wires that lie on things -------------------------------------------------------------

const HOUSING = 0.62;
const DOWN = new THREE.Vector3(0, -1, 0);
const UPV = new THREE.Vector3(0, 1, 0);

// Meshes a wire can lie on.
export function surfaces(objects) {
  const list = [];
  for (const o of objects) o.traverse((m) => { if (m.isMesh && m.userData.pin === undefined && !m.userData.noRest) list.push(m); });
  return list;
}

// A jumper wire from end a to end b ({ pos, dir }): it leaves each end along
// `dir` through a black plug, then drapes over the meshes in `under`, stiff
// enough to bridge small gaps. Adds its own meshes to `under`.
export function benchWire(a, b, color, under) {
  const pa = new THREE.Vector3(...a.pos), pb = new THREE.Vector3(...b.pos);
  const da = new THREE.Vector3(...a.dir), db = new THREE.Vector3(...b.dir);
  const qa = pa.clone().addScaledVector(da, HOUSING), qb = pb.clone().addScaledVector(db, HOUSING);
  // A wire on a module's side pin runs out a little before it turns.
  const ra = qa.clone().addScaledVector(da, a.kind === "pin" ? 0.8 : 0.22), rb = qb.clone().addScaledVector(db, b.kind === "pin" ? 0.8 : 0.22);
  const len = Math.hypot(rb.x - ra.x, rb.z - ra.z);
  const n = Math.max(2, Math.ceil(len / 0.2));
  const ray = new THREE.Raycaster();
  const ground = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ray.set(new THREE.Vector3(ra.x + (rb.x - ra.x) * t, 40, ra.z + (rb.z - ra.z) * t), DOWN);
    const hit = ray.intersectObjects(under, false)[0];
    ground.push(Math.max(hit ? hit.point.y : 0, 0));
  }
  // Stiff: it spans gaps up to about a centimetre and a half instead of dipping in.
  const w = Math.max(1, Math.round(0.7 / (len / n || 1)));
  const env = ground.map((_, i) => Math.max(...ground.slice(Math.max(0, i - w), i + w + 1)));
  let h = env;
  for (let k = 0; k < 2; k++) h = h.map((_, i) => { const s = h.slice(Math.max(0, i - w), i + w + 1); return s.reduce((x, y) => x + y, 0) / s.length; });
  const pts = [pa, qa];
  for (let i = 0; i <= n; i++) {
    const t = i / n, d0 = t * len, d1 = (1 - t) * len;
    // Up out of each plug, then down onto what's below; a short hop arcs a little.
    const arc = Math.sin(Math.PI * t) * Math.min(len, 3) * 0.12;
    const y = Math.max(h[i], ground[i]) + 0.12;
    const fromEnds = Math.max(ra.y - 0.6 * d0, rb.y - 0.6 * d1, ra.y + (rb.y - ra.y) * t + arc - (len > 4 ? 99 : 0));
    pts.push(new THREE.Vector3(ra.x + (rb.x - ra.x) * t, Math.max(y, fromEnds), ra.z + (rb.z - ra.z) * t));
  }
  pts[2] = ra.clone();
  pts[pts.length - 1] = rb.clone();
  pts.push(qb, pb);
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: color, emissiveIntensity: 0 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, n * 3), 0.07, 7), mat);
  tube.castShadow = tube.receiveShadow = true;
  group.add(tube);
  for (const [p, d] of [[pa, da], [pb, db]]) {
    const plug = new THREE.Mesh(new THREE.BoxGeometry(0.24, HOUSING, 0.24), MAT.blackPlastic);
    plug.position.copy(p).addScaledVector(d, HOUSING / 2);
    plug.quaternion.setFromUnitVectors(UPV, d);
    plug.castShadow = true;
    group.add(plug);
  }
  group.updateMatrixWorld(true);
  group.traverse((m) => { if (m.isMesh) under.push(m); });
  group.userData.curve = curve;
  group.userData.mat = mat;
  return group;
}
