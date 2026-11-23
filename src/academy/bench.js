// How a project is really built on the bench. The breadboard lies in front of
// the board; every part with legs or header pins is plugged into its holes,
// placed so that legs that should be joined share a column of five holes; the
// rest (motors, the keypad's ribbon) sit on the bench. Jumper wires go from
// the board's header to free holes, rails and module pins, and lie over
// whatever is under them instead of looping through the air.
import * as THREE from "three";
import { arduinoUno, esp32, pinWorld, MAT } from "./parts.js?v=27";
import { buildPart } from "./project-parts.js?v=27";
import { dispose } from "./stage.js?v=27";

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
  // A board pin that feeds two or more wires (D13 to both the 595 and the
  // RFID reader): a header socket holds one jumper, so the pin goes to a free
  // breadboard column first and those wires start from that column.
  const hubs = new Map(); // pin → { c, rows, at, boardRow }
  if (g) {
    const uses = new Map();
    plan.wires.forEach((w, i) => {
      if (ends[i].skip) return;
      for (const e of [w.from, w.to]) if (e.part === "BOARD" && e.pin !== "GND" && e.pin !== "5V") { if (!uses.has(e.pin)) uses.set(e.pin, []); uses.get(e.pin).push(i); }
    });
    for (const [pin, list] of uses) {
      if (list.length < 2) continue;
      const at = pinWorld(board, pin);
      let best = null;
      for (let c = 0; c < g.cols; c++) for (const half of [0, 1]) {
        const rows = half === 0 ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
        if (rows.some((r) => cells.has(cellKey(...holeXZ(c, r))))) continue;
        // Near the pin, and away from columns in use on either side.
        const crowd = [-1, 1].reduce((n, dc) => n + rows.filter((r) => c + dc >= 0 && c + dc < g.cols && cells.has(cellKey(...holeXZ(c + dc, r)))).length, 0);
        const d = Math.abs(g.colX(c) - at.x) + Math.abs(g.rowZ(rows[2]) - at.z) * 0.5 + crowd * 0.4;
        if (!best || d < best.d) best = { c, rows, d };
      }
      if (!best) continue;
      best.rows.forEach((r) => cells.set(cellKey(...holeXZ(best.c, r)), { owner: "wire" }));
      const rows = [...best.rows].sort((r1, r2) => Math.abs(g.rowZ(r1) - at.z) - Math.abs(g.rowZ(r2) - at.z));
      hubs.set(pin, { c: best.c, boardRow: rows.shift(), rows, at: list[0] });
    }
  }

  // Board pins, module pins and holes first; rails last, near the other end.
  plan.wires.forEach((w, i) => {
    if (ends[i].skip) return;
    const one = (e, other) => {
      if (e.part === "BOARD" && hubs.has(e.pin)) { const hb = hubs.get(e.pin); return { ...holeEnd(hb.c, hb.rows.shift()), hub: e.pin }; }
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

  for (const [pin, hb] of hubs) {
    bridges.push({ at: hb.at, hub: pin, color: plan.wires[hb.at].color, a: { kind: "board", pos: pinWorld(board, pin).toArray(), dir: UP, name: pin, pin }, b: { ...holeEnd(hb.c, hb.boardRow), hub: pin } });
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

// ---- A wiring harness: every wire on its own path -------------------------------------
//
// Used where many wires leave one Uno (Mini Yaver). A wire rises straight out
// of each plug to a height of its own, runs along z to a lane, along x, along
// z again and straight down, like a line on a chart. Wires that would come
// near each other get different heights, and a wire that passes over another
// wire's plug runs above it, so its rising leg never pokes through. Short hops
// between breadboard holes stay as draped jumpers when nothing is in their way.
const CLEAR = 0.24; // height between levels: a 0.14 wire plus a gap
const NEAR = 0.2; // closer than this in plan view, two wires need different heights

// Shortest distance between two segments in the ground plane (axis-aligned or not).
function segDist(a, b, c, d) {
  const pt = (p, s, e) => {
    const dx = e[0] - s[0], dz = e[1] - s[1], l = dx * dx + dz * dz;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dz) / l)) : 0;
    return Math.hypot(p[0] - s[0] - t * dx, p[1] - s[1] - t * dz);
  };
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = cross(a, b, c), o2 = cross(a, b, d), o3 = cross(c, d, a), o4 = cross(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
  return Math.min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b));
}
const pathDist = (p, q) => {
  let m = Infinity;
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) m = Math.min(m, segDist(p[i - 1], p[i], q[j - 1], q[j]));
  return m;
};
const nearPath = (pt, path) => pathDist([pt, pt], path);

function wireMesh(pts, ends, color, under) {
  // Straight runs with small rounded corners.
  const path = new THREE.CurvePath();
  const V = (p) => new THREE.Vector3(...p);
  let from = V(pts[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = V(pts[i]), a = V(pts[i - 1]), b = V(pts[i + 1]);
    const r = Math.min(0.14, p.distanceTo(a) / 2, p.distanceTo(b) / 2);
    const s = p.clone().addScaledVector(a.clone().sub(p).normalize(), r), e = p.clone().addScaledVector(b.clone().sub(p).normalize(), r);
    if (from.distanceTo(s) > 1e-4) path.add(new THREE.LineCurve3(from, s));
    path.add(new THREE.QuadraticBezierCurve3(s, p, e));
    from = e;
  }
  path.add(new THREE.LineCurve3(from, V(pts[pts.length - 1])));
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: color, emissiveIntensity: 0 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.min(900, Math.ceil(path.getLength() / 0.05)), 0.07, 7), mat);
  tube.castShadow = tube.receiveShadow = true;
  group.add(tube);
  for (const e of ends) {
    const p = V(e.pos), d = V(e.dir);
    const plug = new THREE.Mesh(new THREE.BoxGeometry(0.24, HOUSING, 0.24), MAT.blackPlastic);
    plug.position.copy(p).addScaledVector(d, HOUSING / 2);
    plug.quaternion.setFromUnitVectors(UPV, d);
    plug.castShadow = true;
    group.add(plug);
  }
  group.updateMatrixWorld(true);
  group.traverse((m) => { if (m.isMesh) under.push(m); });
  group.userData.curve = path;
  group.userData.mat = mat;
  group.userData.points = pts;
  return group;
}

// items: [{ a, b, color }] (ends as benchPlan gives them). Returns one group per item.
export function harness(items, under) {
  // A module's pins point out from its centre, so the pins of one header fan
  // out and their plugs can cross. Give a header's pins one shared direction.
  const mean = new Map();
  for (const it of items) for (const e of [it.a, it.b]) if (e.kind === "pin") {
    const m = mean.get(e.part) ?? [0, 0];
    mean.set(e.part, [m[0] + e.dir[0], m[1] + e.dir[2]]);
  }
  const square = (e) => {
    const m = mean.get(e.part);
    if (!m) return e;
    let [x, z] = m;
    const l = Math.hypot(x, z) || 1;
    [x, z] = [x / l, z / l];
    if (Math.abs(x) > 0.9) [x, z] = [Math.sign(x), 0];
    else if (Math.abs(z) > 0.9) [x, z] = [0, Math.sign(z)];
    return e.dir[0] * x + e.dir[2] * z > 0.5 ? { ...e, dir: [x, 0, z] } : e;
  };
  items = items.map((it) => ({ ...it, a: square(it.a), b: square(it.b) }));
  const onBB = (e) => e.kind === "hole" || e.kind === "rail";
  const exit = (e) => {
    const p = new THREE.Vector3(...e.pos).addScaledVector(new THREE.Vector3(...e.dir), HOUSING + (e.kind === "pin" ? 0.3 : 0));
    return [p.x, p.y, p.z];
  };
  const W = items.map((it, i) => ({ i, it, ra: exit(it.a), rb: exit(it.b) }));
  const all = W.flatMap((w) => [w.it.a, w.it.b]);
  const zs = (f) => all.filter(f).map((e) => e.pos[2]);
  const boardZ = Math.max(...zs((e) => e.kind === "board"));
  const bbZ = zs(onBB);
  const exitsFront = W.flatMap((w) => [[w.it.a, w.ra], [w.it.b, w.rb]]).filter(([e, r]) => e.kind === "pin" && r[2] > Math.max(...bbZ)).map(([, r]) => r[2]);
  const back = [boardZ + 0.3, Math.min(...bbZ) - 0.3];
  const front = [Math.max(...bbZ) + 0.3, Math.max(Math.max(...bbZ) + 0.3, Math.min(...exitsFront, 99) - 0.15)];

  // Short breadboard hops stay draped unless another wire's plug or path is in the way.
  const flat = (w) => [[w.ra[0], w.ra[2]], [w.rb[0], w.rb[2]]];
  for (const w of W) w.short = onBB(w.it.a) && onBB(w.it.b) && Math.hypot(w.ra[0] - w.rb[0], w.ra[2] - w.rb[2]) < 6;
  const plugs = W.flatMap((w) => [{ w, p: [w.ra[0], w.ra[2]] }, { w, p: [w.rb[0], w.rb[2]] }]);
  for (const w of W.filter((x) => x.short)) {
    if (plugs.some(({ w: o, p }) => o !== w && Math.hypot(p[0] - w.ra[0], p[1] - w.ra[2]) > 0.05 && Math.hypot(p[0] - w.rb[0], p[1] - w.rb[2]) > 0.05 && nearPath(p, flat(w)) < 0.6)) w.short = false;
  }

  // Lanes: board wires in the channel between the Uno and the breadboard,
  // module wires in front of the breadboard, spread so their x-runs overlap least.
  const routed = W.filter((w) => !w.short);
  const lanes = (list, [z0, z1]) => {
    const n = Math.max(1, Math.floor((z1 - z0) / CLEAR) + 1);
    const used = Array.from({ length: n }, () => []);
    const span = (w) => [Math.min(w.ra[0], w.rb[0]) - CLEAR, Math.max(w.ra[0], w.rb[0]) + CLEAR];
    for (const w of list.sort((a, b) => (span(b)[1] - span(b)[0]) - (span(a)[1] - span(a)[0]))) {
      const [s0, s1] = span(w);
      const cost = used.map((u) => u.filter(([a, b]) => a < s1 && s0 < b).length);
      const k = cost.indexOf(Math.min(...cost));
      used[k].push([s0, s1]);
      w.lane = n === 1 ? (z0 + z1) / 2 : z0 + (k * (z1 - z0)) / (n - 1);
    }
  };
  lanes(routed.filter((w) => w.it.a.kind === "board" || w.it.b.kind === "board"), back);
  lanes(routed.filter((w) => w.it.a.kind !== "board" && w.it.b.kind !== "board" && (w.it.a.kind === "pin" || w.it.b.kind === "pin")), front);
  for (const w of routed) {
    if (w.lane === undefined) w.lane = w.ra[2];
    w.path = [[w.it.a.pos[0], w.it.a.pos[2]], [w.ra[0], w.ra[2]], [w.ra[0], w.lane], [w.rb[0], w.lane], [w.rb[0], w.rb[2]], [w.it.b.pos[0], w.it.b.pos[2]]];
  }

  // Two wires that each pass over the other's plug can't both run on top:
  // try the other wire shapes (x-run first, or last) until no pair does.
  const ends2 = (o) => [[o.ra[0], o.ra[2]], [o.rb[0], o.rb[2]]];
  const over = (w, o) => ends2(o).some((p) => nearPath(p, w.path) < NEAR);
  const clashes = (w) => routed.filter((o) => o !== w && over(w, o) && over(o, w));
  const setLane = (w, lane) => {
    w.lane = lane;
    w.path = [[w.it.a.pos[0], w.it.a.pos[2]], [w.ra[0], w.ra[2]], [w.ra[0], lane], [w.rb[0], lane], [w.rb[0], w.rb[2]], [w.it.b.pos[0], w.it.b.pos[2]]];
  };
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const w of routed) {
      if (!clashes(w).length) continue;
      const was = w.lane;
      const best = [w.lane, w.ra[2], w.rb[2]].map((lane) => { setLane(w, lane); return [lane, clashes(w).length]; }).sort((a, b) => a[1] - b[1])[0];
      changed ||= best[0] !== was;
      setLane(w, best[0]);
    }
    if (!changed) break;
  }

  // Heights: a wire whose path passes over another's plug must run above it;
  // wires whose paths come close can't share a height.
  const below = new Map(routed.map((w) => [w, new Set()]));
  for (const w of routed) for (const o of routed) {
    if (o === w) continue;
    if ([[o.ra[0], o.ra[2]], [o.rb[0], o.rb[2]]].some((p) => nearPath(p, w.path) < NEAR)) below.get(w).add(o);
  }
  // Break any cycle (two wires over each other's plugs) by dropping one edge.
  const state = new Map();
  const visit = (w) => {
    state.set(w, 1);
    for (const o of [...below.get(w)]) {
      if (state.get(o) === 1) below.get(w).delete(o);
      else if (!state.get(o)) visit(o);
    }
    state.set(w, 2);
  };
  routed.forEach((w) => state.get(w) || visit(w));
  const order = [], done = new Set();
  const place = (w) => { if (done.has(w)) return; done.add(w); below.get(w).forEach(place); order.push(w); };
  routed.forEach(place);
  const byLevel = [];
  for (const w of order) {
    let L = Math.max(-1, ...[...below.get(w)].map((o) => o.level)) + 1;
    while ((byLevel[L] ?? []).some((o) => pathDist(o.path, w.path) < NEAR)) L++;
    (byLevel[L] ??= []).push(w);
    w.level = L;
  }

  // The lowest height clears everything on the Uno and the breadboard.
  const xs = routed.flatMap((w) => w.path.map((p) => p[0])), zz = routed.flatMap((w) => w.path.map((p) => p[1]));
  const ray = new THREE.Raycaster();
  let top = 0;
  const shortMeshes = new Map();
  for (const w of W.filter((x) => x.short)) shortMeshes.set(w, benchWire(w.it.a, w.it.b, w.it.color, under));
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2) for (let z = Math.min(...zz, boardZ - 5); z <= Math.max(...zz); z += 0.2) {
    if (!routed.some((w) => nearPath([x, z], w.path) < 0.3)) continue;
    ray.set(new THREE.Vector3(x, 40, z), DOWN);
    const hit = ray.intersectObjects(under, false)[0];
    if (hit) top = Math.max(top, hit.point.y);
  }
  const base = Math.max(top + 0.35, ...routed.flatMap((w) => [w.ra[1], w.rb[1]]).map((y) => y + 0.3));
  for (const w of routed) {
    const h = base + w.level * CLEAR;
    const pts = [w.it.a.pos, w.ra, [w.ra[0], h, w.ra[2]], [w.ra[0], h, w.lane], [w.rb[0], h, w.lane], [w.rb[0], h, w.rb[2]], w.rb, w.it.b.pos]
      .filter((p, k, arr) => k === 0 || Math.hypot(p[0] - arr[k - 1][0], p[1] - arr[k - 1][1], p[2] - arr[k - 1][2]) > 1e-3);
    // Drop points in the middle of a straight run.
    const clean = pts.filter((p, k) => {
      if (k === 0 || k === pts.length - 1) return true;
      const a = pts[k - 1], b = pts[k + 1];
      const u = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], v = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
      const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      return Math.hypot(...c) > 1e-6;
    });
    w.mesh = wireMesh(clean, [w.it.a, w.it.b], w.it.color, under);
  }
  return W.map((w) => w.mesh ?? shortMeshes.get(w));
}
