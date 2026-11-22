// CaliCoach engine: pose features, exercise recognition, rep counting and
// form analysis. Pure JavaScript with no DOM, so it runs in the browser, in a
// worker and in Node (the tests in lab/ run it against synthetic workouts).
//
// Input per frame: MediaPipe *world* landmarks (33 x {x,y,z}, metres,
// hip-centred, y down) and their visibility. Everything here mirrors
// lab/features.py; keep the two in step (lab/test_parity.mjs checks them).

export const FRAME_FEATURES = [
  "elbow", "shoulder", "hip", "knee", "knee_min", "knee_max", "torso_incl",
  "chest_up", "wrist_sh", "wrist_hip", "ankle_hip", "body_line", "nose_wrist",
  "wrist_ankle", "legs_incl", "stride", "wrist_sep", "knee_diff",
];
export const VEL_FEATURES = ["elbow", "knee", "hip", "torso_incl", "body_line"];
export const WINDOW_SEC = 2.0;
export const WINDOW_N = 24;

// ------------------------------------------------------------ vector maths
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const DEG = 180 / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const UP = [0, -1, 0];

function angAt(a, b, c) {
  const ba = sub(a, b), bc = sub(c, b);
  const cos = dot(ba, bc) / (norm(ba) * norm(bc) + 1e-9);
  return Math.acos(clamp(cos, -1, 1)) * DEG;
}
function angVec(u, v) {
  const cos = dot(u, v) / (norm(u) * norm(v) + 1e-9);
  return Math.acos(clamp(cos, -1, 1)) * DEG;
}
const horiz = (d) => sub(d, mul(UP, dot(d, UP)));

/** Per-frame metrics. w: 33 points as [x,y,z]; vis: 33 numbers (optional). */
export function frameMetrics(w, vis) {
  const v = vis || new Array(33).fill(1);
  const [ls, rs, le, re, lw, rw] = [w[11], w[12], w[13], w[14], w[15], w[16]];
  const [lh, rh, lk, rk, la, ra] = [w[23], w[24], w[25], w[26], w[27], w[28]];
  const nose = w[0];
  const avg = (idx) => idx.reduce((s, i) => s + v[i], 0) / idx.length;
  const vl = avg([11, 13, 15, 23, 25, 27]) + 0.05;
  const vr = avg([12, 14, 16, 24, 26, 28]) + 0.05;
  const mix = (a, b) => (a * vl + b * vr) / (vl + vr);
  const sc = mid(ls, rs), hc = mid(lh, rh), wc = mid(lw, rw), ac = mid(la, ra);
  const torso = sub(sc, hc);
  const tl = norm(torso) + 1e-6;
  const m = {};
  m.elbow_l = angAt(ls, le, lw); m.elbow_r = angAt(rs, re, rw);
  m.shoulder_l = angAt(lh, ls, le); m.shoulder_r = angAt(rh, rs, re);
  m.hip_l = angAt(ls, lh, lk); m.hip_r = angAt(rs, rh, rk);
  m.knee_l = angAt(lh, lk, la); m.knee_r = angAt(rh, rk, ra);
  m.elbow = mix(m.elbow_l, m.elbow_r);
  m.shoulder = mix(m.shoulder_l, m.shoulder_r);
  m.hip = mix(m.hip_l, m.hip_r);
  m.knee = mix(m.knee_l, m.knee_r);
  m.knee_min = Math.min(m.knee_l, m.knee_r);
  m.knee_max = Math.max(m.knee_l, m.knee_r);
  m.knee_diff = Math.abs(m.knee_l - m.knee_r);
  m.torso_incl = angVec(torso, UP);
  const chest = cross(sub(ls, rs), torso);
  m.chest_up = dot(chest, UP) / (norm(chest) + 1e-9);
  m.wrist_sh = dot(sub(wc, sc), UP) / tl;
  m.wrist_hip = dot(sub(wc, hc), UP) / tl;
  m.ankle_hip = dot(sub(ac, hc), UP) / tl;
  m.body_line = angAt(sc, hc, ac);
  m.nose_wrist = dot(sub(nose, wc), UP) / tl;
  m.wrist_ankle = dot(sub(wc, ac), UP) / tl;
  m.legs_incl = angVec(sub(ac, hc), mul(UP, -1));
  m.stride = norm(horiz(sub(la, ra))) / tl;
  m.wrist_sep = norm(sub(lw, rw)) / tl;
  // extra metrics for the form checks
  m.torso_len = tl;
  const line = sub(ac, sc);
  const t = dot(sub(hc, sc), line) / (dot(line, line) + 1e-9);
  const off = sub(hc, add(sc, mul(line, t)));
  m.hip_dev = dot(off, UP) / tl;
  m.hip_dev_abs = norm(off) / tl;
  m.nose_up = dot(sub(nose, sc), UP) / tl;
  m.shoulder_vs_elbow = dot(sub(sc, mid(le, re)), UP) / tl;
  m.hip_vs_knee = dot(sub(hc, mid(lk, rk)), UP) / tl;
  const hw = norm(sub(lh, rh)) + 1e-6;
  m.knee_sep = norm(horiz(sub(lk, rk))) / hw;
  m.ankle_sep = norm(horiz(sub(la, ra))) / hw;
  const sv = sub(ls, rs);
  m.frontal = Math.abs(sv[0]) / (Math.hypot(sv[0], sv[2]) + 1e-9);
  const upT = mul(torso, 1 / tl);
  const lat = mul(sv, 1 / (norm(sv) + 1e-9));
  const fl = [[ls, le], [rs, re]].map(([s, e]) => {
    const u = sub(e, s);
    const a = dot(u, mul(upT, -1));
    const b = Math.abs(dot(u, lat));
    return Math.atan2(b, Math.max(a, 1e-6)) * DEG;
  });
  m.flare = mix(fl[0], fl[1]);
  // front leg in a lunge: the knee that is higher (the back knee drops toward the floor)
  m.knee_front = dot(lk, UP) >= dot(rk, UP) ? m.knee_l : m.knee_r;
  return m;
}

export const frameVector = (m) => FRAME_FEATURES.map((k) => m[k]);

/** Resample rows (taken at `times`) onto n points covering the last `sec` seconds before tEnd. */
export function resample(times, rows, tEnd, sec = WINDOW_SEC, n = WINDOW_N) {
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tg = tEnd - sec + (sec * i) / (n - 1);
    while (j < times.length - 2 && times[j + 1] < tg) j++;
    let r;
    if (tg <= times[0]) r = rows[0];
    else if (tg >= times[times.length - 1]) r = rows[rows.length - 1];
    else {
      const t0 = times[j], t1 = times[j + 1];
      const a = t1 > t0 ? (tg - t0) / (t1 - t0) : 0;
      r = rows[j].map((x, k) => x + (rows[j + 1][k] - x) * a);
    }
    out.push(r);
  }
  return out;
}

export function windowFeatures(R, sec = WINDOW_SEC) {
  const n = R.length, d = R[0].length;
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0);
  const mn = new Array(d).fill(Infinity), mx = new Array(d).fill(-Infinity);
  for (const r of R) for (let k = 0; k < d; k++) { mean[k] += r[k] / n; mn[k] = Math.min(mn[k], r[k]); mx[k] = Math.max(mx[k], r[k]); }
  for (const r of R) for (let k = 0; k < d; k++) sd[k] += (r[k] - mean[k]) ** 2 / n;
  for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k]);
  const dt = sec / (n - 1);
  const vel = VEL_FEATURES.map((name) => {
    const j = FRAME_FEATURES.indexOf(name);
    let s = 0;
    for (let i = 1; i < n; i++) s += Math.abs(R[i][j] - R[i - 1][j]);
    return s / (n - 1) / dt / 100;
  });
  return [...mean, ...sd, ...mn, ...mx, ...vel];
}

// ------------------------------------------------------------ classifier
export class Classifier {
  constructor(model) {
    this.model = model;
    this.classes = model.classes;
  }
  /** Returns class probabilities for one window feature vector. */
  predict(x) {
    const { mean, scale, layers } = this.model;
    let h = x.map((v, i) => (v - mean[i]) / scale[i]);
    layers.forEach((L, li) => {
      const out = L.b.slice();
      for (let i = 0; i < h.length; i++) {
        const hi = h[i];
        if (hi === 0) continue;
        const row = L.W[i];
        for (let j = 0; j < out.length; j++) out[j] += hi * row[j];
      }
      h = li < layers.length - 1 ? out.map((v) => (v > 0 ? v : 0)) : out;
    });
    const mxv = Math.max(...h);
    const e = h.map((v) => Math.exp(v - mxv));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  }
}

/** Personal examples recorded in the app ("Teach"): nearest-neighbour vote. */
export class PersonalModel {
  constructor(examples = [], model) {
    this.model = model;
    this.examples = []; // { label, x (standardised) }
    for (const e of examples) this.add(e.label, e.x, true);
  }
  standardise(x) {
    const { mean, scale } = this.model;
    return x.map((v, i) => (v - mean[i]) / scale[i]);
  }
  add(label, x, already = false) {
    this.examples.push({ label, x: already ? x : this.standardise(x) });
  }
  get size() { return this.examples.length; }
  /** Returns {probs, dist} or null when there are no examples. */
  predict(x, classes, k = 7) {
    if (this.examples.length < 5) return null;
    const z = this.standardise(x);
    const d = this.examples.map((e) => {
      let s = 0;
      for (let i = 0; i < z.length; i++) s += (z[i] - e.x[i]) ** 2;
      return [Math.sqrt(s / z.length), e.label];
    }).sort((a, b) => a[0] - b[0]).slice(0, k);
    const probs = classes.map(() => 0);
    let tot = 0;
    for (const [dist, label] of d) {
      const i = classes.indexOf(label);
      if (i < 0) continue;
      const wgt = 1 / (0.05 + dist);
      probs[i] += wgt; tot += wgt;
    }
    return { probs: probs.map((p) => p / (tot || 1)), dist: d[0][0] };
  }
}

// ------------------------------------------------------------ exercises
// Standards (see lab/FORM_STANDARDS.md for sources):
//  push-up: straight line head-to-heels, chest down until elbows ~90 deg,
//           elbows ~45 deg from the body (not flared to 90), full lockout.
//  pull-up: start from a dead hang (arms straight), chin clears the bar,
//           no kipping/leg drive, controlled lowering.
//  dip:     lower until elbows ~90 deg / upper arms parallel, lock out on top,
//           torso slightly forward, no swinging.
//  squat:   thighs at least parallel (knees ~90 deg), knees track over the toes
//           (no caving in), chest up / limited forward lean, stand tall on top.
//  lunge:   front knee ~90 deg, back knee toward the floor, torso upright.
//  hanging leg raise: legs at least to horizontal, legs straight, no swinging.
//  plank:   straight line, no sagging or piked hips.

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const maxOf = (a) => Math.max(...a);
const minOf = (a) => Math.min(...a);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// Each check: (rep) => null | { key, penalty, major }. rep = { ms (metrics),
// sig (signal), iMin (index of the deepest point), ecc, con, top0, top1 }.
const C = {
  depthMax: (sigName, limit, key = "partial_depth") => (r) => (minOf(r.sig) > limit ? { key, penalty: 30, major: true, value: Math.round(minOf(r.sig)) } : null),
  lockout: (limit) => (r) => (Math.max(r.top0, r.top1) < limit ? { key: "no_lockout", penalty: 15, major: true, value: Math.round(Math.max(r.top0, r.top1)) } : null),
  rushed: (minSec, which = "ecc") => (r) => (r[which] < minSec ? { key: "rushed", penalty: 5, major: false, value: +r[which].toFixed(2) } : null),
};
const around = (r, sec = 0.35) => r.ms.filter((m, i) => Math.abs(r.ts[i] - r.ts[r.iMin]) <= sec);

export const EXERCISES = {
  push_up: {
    name: "Push-up", kind: "reps", signal: "elbow", target: 90, minExc: 20, view: "side",
    chart: { depth: 100, lock: 145 }, secondary: { key: "hip_dev", label: "Hip line (+ piked, − sagging)", lo: -0.12, hi: 0.14 },
    detects: ["partial_depth", "no_lockout", "hip_sag", "hip_pike", "elbow_flare", "rushed"],
    gate: (m) => m.torso_incl > 45 && m.torso_incl < 135 && m.chest_up < 0.1 && Math.abs(m.wrist_ankle) < 1.4,
    checks: [
      C.depthMax("elbow", 100),
      C.lockout(145),
      (r) => { const v = median(r.ms.map((m) => m.hip_dev)); return v < -0.12 ? { key: "hip_sag", penalty: 20, major: false, value: +v.toFixed(2) } : null; },
      (r) => { const v = median(r.ms.map((m) => m.hip_dev)); return v > 0.14 ? { key: "hip_pike", penalty: 15, major: false, value: +v.toFixed(2) } : null; },
      (r) => { const v = median(around(r).map((m) => m.flare)); return v > 63 ? { key: "elbow_flare", penalty: 10, major: false, value: Math.round(v) } : null; },
      C.rushed(0.55),
    ],
    live: (m) => (m.hip_dev < -0.14 ? "hip_sag" : m.hip_dev > 0.17 ? "hip_pike" : null),
  },
  pike_push_up: {
    name: "Pike push-up", kind: "reps", signal: "elbow", target: 90, minExc: 22, view: "side",
    chart: { depth: 105, lock: 155 }, secondary: { key: "hip", label: "Hip angle", unit: "°", hi: 112 },
    detects: ["partial_depth", "no_lockout", "hips_low", "rushed"],
    gate: (m) => m.hip < 140 && m.torso_incl > 70 && m.wrist_sh < 0,
    checks: [
      C.depthMax("elbow", 105),
      C.lockout(155),
      (r) => { const v = pct(r.ms.map((m) => m.hip), 0.5); return v > 112 ? { key: "hips_low", penalty: 15, major: false, value: Math.round(v) } : null; },
      C.rushed(0.55),
    ],
  },
  plank: {
    name: "Plank", kind: "hold", view: "side",
    detects: ["hip_sag", "hip_pike"],
    holdOk: (m) => m.torso_incl > 50 && m.torso_incl < 120 && m.chest_up < -0.2,
    holdFault: (m) => (m.hip_dev < -0.12 ? "hip_sag" : m.hip_dev > 0.15 ? "hip_pike" : null),
    live: (m) => (m.hip_dev < -0.12 ? "hip_sag" : m.hip_dev > 0.15 ? "hip_pike" : null),
  },
  pull_up: {
    name: "Pull-up", kind: "reps", signal: "elbow", target: 75, minExc: 35, view: "front",
    chart: { lock: 143 }, secondary: { key: "nose_wrist", label: "Chin vs bar (above 0 = over)", lo: -0.02 },
    detects: ["chin_below_bar", "no_lockout", "kipping", "rushed"],
    gate: (m) => m.wrist_sh > 0.25 && m.torso_incl < 50,
    checks: [
      (r) => { const v = maxOf(r.ms.map((m) => m.nose_wrist)); return v < -0.02 ? { key: "chin_below_bar", penalty: 30, major: true, value: +v.toFixed(2) } : null; },
      C.lockout(143),
      (r) => { const a = r.ms.map((m) => m.legs_incl); const b = r.ms.map((m) => m.torso_incl); const v = Math.max(maxOf(a) - minOf(a), (maxOf(b) - minOf(b)) * 1.2); return v > 30 ? { key: "kipping", penalty: 15, major: false, value: Math.round(v) } : null; },
      C.rushed(0.45, "con"),
    ],
  },
  inverted_row: {
    name: "Inverted row", kind: "reps", signal: "elbow", target: 80, minExc: 22, view: "side",
    chart: { depth: 105, lock: 150 }, secondary: { key: "hip_dev", label: "Hip line (− sagging)", lo: -0.11 },
    detects: ["partial_depth", "no_lockout", "hip_sag", "rushed"],
    gate: (m) => m.chest_up > 0.1 && m.torso_incl > 35 && m.torso_incl < 120 && m.wrist_sh > -0.2,
    checks: [
      C.depthMax("elbow", 105),
      C.lockout(150),
      (r) => { const v = median(r.ms.map((m) => m.hip_dev)); return v < -0.11 ? { key: "hip_sag", penalty: 15, major: false, value: +v.toFixed(2) } : null; },
      C.rushed(0.4, "con"),
    ],
  },
  dip: {
    name: "Dip", kind: "reps", signal: "elbow", target: 90, minExc: 22, view: "side",
    chart: { depth: 105, lock: 150 }, secondary: { key: "torso_incl", label: "Forward lean", unit: "°", hi: 45 },
    detects: ["partial_depth", "no_lockout", "excess_lean", "swinging", "rushed"],
    gate: (m) => m.wrist_sh < -0.1 && m.torso_incl < 75 && m.ankle_hip < 0.25,
    checks: [
      C.depthMax("elbow", 105),
      C.lockout(150),
      (r) => { const v = median(around(r).map((m) => m.torso_incl)); return v > 45 ? { key: "excess_lean", penalty: 10, major: false, value: Math.round(v) } : null; },
      (r) => { const a = r.ms.map((m) => m.hip); const v = maxOf(a) - minOf(a); return v > 28 ? { key: "swinging", penalty: 10, major: false, value: Math.round(v) } : null; },
      (r) => (minOf(r.sig) < 65 ? { key: "very_deep", penalty: 0, major: false, value: Math.round(minOf(r.sig)) } : null),
      C.rushed(0.55),
    ],
  },
  squat: {
    name: "Squat", kind: "reps", signal: "knee", target: 90, minExc: 22, view: "side",
    chart: { depth: 105, lock: 158 }, secondary: { key: "torso_incl", label: "Forward lean", unit: "°", hi: 50 },
    detects: ["partial_depth", "no_lockout", "excess_lean", "knee_valgus", "rushed"],
    gate: (m) => m.torso_incl < 80 && m.ankle_hip < -0.3 && m.knee_diff < 45 && m.stride < 1.1,
    checks: [
      (r) => { const k = minOf(r.sig); const h = minOf(r.ms.map((m) => m.hip_vs_knee)); return k > 105 && h > 0.1 ? { key: "partial_depth", penalty: 30, major: true, value: Math.round(k) } : null; },
      C.lockout(158),
      (r) => { const v = median(around(r).map((m) => m.torso_incl)); return v > 50 ? { key: "excess_lean", penalty: 15, major: false, value: Math.round(v) } : null; },
      (r) => {
        const b = around(r).filter((m) => m.frontal > 0.6 && m.ankle_sep > 0.8);
        if (b.length < 3) return null; // only judged when the camera sees you from the front
        const v = median(b.map((m) => m.knee_sep / m.ankle_sep));
        return v < 0.82 ? { key: "knee_valgus", penalty: 20, major: false, value: +v.toFixed(2) } : null;
      },
      C.rushed(0.55),
    ],
  },
  lunge: {
    name: "Lunge", kind: "reps", signal: "knee_front", target: 90, minExc: 22, view: "side",
    chart: { depth: 108 }, secondary: { key: "torso_incl", label: "Torso lean", unit: "°", hi: 26 },
    detects: ["partial_depth", "excess_lean", "rushed"],
    gate: (m) => m.stride > 0.55 && m.torso_incl < 55 && m.ankle_hip < -0.3 && m.knee_max < 150,
    checks: [
      C.depthMax("knee_front", 108),
      (r) => { const v = median(around(r).map((m) => m.torso_incl)); return v > 26 ? { key: "excess_lean", penalty: 15, major: false, value: Math.round(v) } : null; },
      C.rushed(0.55),
    ],
  },
  hanging_leg_raise: {
    name: "Hanging leg raise", kind: "reps", signal: "hip", target: 90, minExc: 25, view: "side",
    chart: { depth: 108 }, secondary: { key: "knee", label: "Knee angle (straight legs = 180°)", unit: "°", lo: 135 },
    detects: ["partial_depth", "bent_knees", "swinging", "rushed"],
    gate: (m) => m.wrist_sh > 0.25 && m.torso_incl < 50,
    checks: [
      C.depthMax("hip", 108),
      (r) => { const v = pct(around(r).map((m) => m.knee), 0.5); return v < 135 ? { key: "bent_knees", penalty: 10, major: false, value: Math.round(v) } : null; },
      (r) => { const a = r.ms.map((m) => m.torso_incl); const v = maxOf(a) - minOf(a); return v > 22 ? { key: "swinging", penalty: 15, major: false, value: Math.round(v) } : null; },
      C.rushed(0.5, "con"),
    ],
  },
};

export const FAULTS = {
  partial_depth: { label: "Partial range", cue: "Go deeper: use the full range" },
  no_lockout: { label: "No lockout", cue: "Straighten fully at the start of each rep" },
  hip_sag: { label: "Hips sagging", cue: "Squeeze glutes and abs: straight line" },
  hip_pike: { label: "Hips too high", cue: "Lower your hips into a straight line" },
  elbow_flare: { label: "Elbows flared", cue: "Tuck elbows to about 45 degrees" },
  rushed: { label: "Too fast", cue: "Slow down and control the lowering" },
  hips_low: { label: "Hips too low", cue: "Hips higher: make an upside-down V" },
  chin_below_bar: { label: "Chin below bar", cue: "Pull until your chin clears the bar" },
  kipping: { label: "Kipping / swinging", cue: "Stay tight, no leg drive" },
  excess_lean: { label: "Too much lean", cue: "Keep your chest up" },
  swinging: { label: "Swinging", cue: "Stay still, control the body" },
  very_deep: { label: "Very deep", cue: "Deep dip: only if your shoulders feel good" },
  knee_valgus: { label: "Knees caving in", cue: "Push your knees out over your toes" },
  bent_knees: { label: "Bent knees", cue: "Straighten your legs (bent = knee raise)" },
};
// For dips "partial_depth"/pull-up "no_lockout" etc. the generic cue is fine;
// these override it per exercise.
export const CUE_OVERRIDES = {
  push_up: { partial_depth: "Lower your chest until elbows reach 90 degrees", no_lockout: "Lock your arms out at the top" },
  pike_push_up: { partial_depth: "Lower your head toward the floor" },
  pull_up: { no_lockout: "Start every rep from a dead hang" },
  inverted_row: { partial_depth: "Pull your chest all the way to the bar" },
  dip: { partial_depth: "Lower until your upper arms are parallel" },
  squat: { partial_depth: "Squat until your thighs are at least parallel", no_lockout: "Stand all the way up" },
  lunge: { partial_depth: "Drop the back knee toward the floor" },
  hanging_leg_raise: { partial_depth: "Raise your legs to at least horizontal" },
};
export const SIGNAL_LABELS = { elbow: "Elbow angle", knee: "Knee angle", knee_front: "Front knee angle", hip: "Hip angle" };
// Joints kept in the rep recording (enough to redraw the body): nose, shoulders,
// elbows, wrists, hips, knees, ankles, toes.
export const REPLAY_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
export const cueFor = (ex, key) => CUE_OVERRIDES[ex]?.[key] ?? FAULTS[key]?.cue ?? key;

// ------------------------------------------------------------ rep tracking
/** Counts reps of one exercise from its signal and judges each rep. */
export class RepTracker {
  constructor(key) {
    this.key = key;
    this.spec = EXERCISES[key];
    this.reps = [];
    this.state = "up";
    this.ref = null;       // level of the start position (running max, slowly decaying)
    this.sm = null;        // smoothed signal
    this.buf = [];         // recent frames: { t, m, s }
    this.repStart = 0;     // index into buf where the current rep began
    this.minIdx = 0;
    this.lastT = null;
    this.liveCue = null;
    this.liveSince = 0;
    this.progress = 0;
  }
  push(t, m, w = null) {
    // median of the last 5 raw values removes single-frame glitches, then a light EMA
    this.rawHist = this.rawHist || [];
    this.rawHist.push(m[this.spec.signal]);
    if (this.rawHist.length > 5) this.rawHist.shift();
    const raw = median(this.rawHist);
    const dt = this.lastT == null ? 1 / 30 : Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const a = 1 - Math.exp(-dt / 0.07);
    this.sm = this.sm == null ? raw : this.sm + a * (raw - this.sm);
    const s = this.sm;
    this.buf.push({ t, m, s, w });
    if (this.buf.length > 900) { // ~30 s cap
      const cut = this.buf.length - 900;
      this.buf.splice(0, cut);
      this.repStart = Math.max(0, this.repStart - cut);
      this.minIdx = Math.max(0, this.minIdx - cut);
    }
    const { minExc, target } = this.spec;
    if (this.ref == null) this.ref = s;
    let event = null;
    if (this.state === "up") {
      if (s >= this.ref - 3) { this.ref = Math.max(this.ref, s); this.repStart = this.buf.length - 1; }
      else this.ref -= 4 * dt; // slow decay so a consistently shorter top is accepted
      if (s < this.ref - minExc) { this.state = "down"; this.minIdx = this.buf.length - 1; }
    } else {
      if (s < this.buf[this.minIdx].s) this.minIdx = this.buf.length - 1;
      const lo = this.buf[this.minIdx].s;
      if (s >= lo + 0.7 * (this.ref - lo) && s - lo >= 0.8 * minExc) {
        event = this.finishRep();
        this.state = "up";
        this.ref = s;
        this.repStart = this.buf.length - 1;
      }
    }
    const span = Math.max(10, this.ref - target);
    this.progress = clamp((this.ref - s) / span, 0, 1.2);
    // live cue (shown while it lasts at least 0.5 s)
    const lc = this.spec.live ? this.spec.live(m) : null;
    if (lc !== this.liveCue) { this.liveCue = lc; this.liveSince = t; }
    return event;
  }
  get activeLiveCue() {
    return this.liveCue && this.lastT - this.liveSince > 0.5 ? this.liveCue : null;
  }
  finishRep() {
    const seg = this.buf.slice(this.repStart);
    const iMin = this.minIdx - this.repStart;
    const ts = seg.map((f) => f.t);
    const rep = {
      ms: seg.map((f) => f.m), ts, sig: seg.map((f) => f.m[this.spec.signal]), iMin,
      ecc: ts[iMin] - ts[0], con: ts[ts.length - 1] - ts[iMin],
      top0: Math.max(...seg.slice(0, Math.max(1, iMin)).map((f) => f.s)),
      top1: seg[seg.length - 1].s,
    };
    // posture gate: the bottom of the rep must look like this exercise
    if (this.spec.gate) {
      const near = around(rep);
      const ok = near.filter((m) => this.spec.gate(m)).length;
      if (ok < near.length * 0.5) { this.rejected = (this.rejected || 0) + 1; return null; }
    }
    const faults = [];
    for (const chk of this.spec.checks) {
      const f = chk(rep);
      if (f) faults.push(f);
    }
    const score = Math.max(0, 100 - faults.reduce((s, f) => s + f.penalty, 0));
    const result = {
      n: this.reps.length + 1, t0: ts[0], t1: ts[ts.length - 1],
      duration: +(ts[ts.length - 1] - ts[0]).toFixed(2), ecc: +rep.ecc.toFixed(2), con: +rep.con.toFixed(2),
      bottom: Math.round(Math.min(...rep.sig)), top: Math.round(Math.max(rep.top0, rep.top1)),
      score, clean: !faults.some((f) => f.major), faults: faults.map((f) => ({ key: f.key, value: f.value })),
    };
    result.trace = this.recordTrace(seg);
    if (this.key === "lunge") {
      const b = rep.ms[iMin];
      result.side = b.knee_front === b.knee_l ? "left" : "right";
    }
    this.reps.push(result);
    return { type: "rep", rep: result };
  }
  /**
   * Compact recording of one rep for graphs and replay, ~20 samples/s:
   * t (s from rep start), s (smoothed key angle), x (secondary metric) and
   * k (skeleton: REPLAY_JOINTS world x,y in cm, flattened).
   */
  recordTrace(seg) {
    const sec = this.spec.secondary?.key;
    const out = { t: [], s: [], x: [], k: [] };
    let last = -1;
    const t0 = seg[0].t;
    seg.forEach((f, i) => {
      if (i !== seg.length - 1 && f.t - last < 0.05) return;
      last = f.t;
      out.t.push(+(f.t - t0).toFixed(3));
      out.s.push(+f.s.toFixed(1));
      out.x.push(sec ? +f.m[sec].toFixed(3) : 0);
      if (f.w) out.k.push(REPLAY_JOINTS.flatMap((j) => [Math.round(f.w[j][0] * 100), Math.round(f.w[j][1] * 100)]));
    });
    if (!out.k.length) delete out.k;
    return out;
  }
  summary() {
    const n = this.reps.length;
    const clean = this.reps.filter((r) => r.clean).length;
    const faults = {};
    for (const r of this.reps) for (const f of r.faults) faults[f.key] = (faults[f.key] || 0) + 1;
    const avg = (k) => (n ? this.reps.reduce((s, r) => s + r[k], 0) / n : 0);
    return { exercise: this.key, kind: "reps", reps: n, clean, score: Math.round(avg("score")), tempo: +avg("duration").toFixed(2), faults, repList: this.reps };
  }
}

/** Timed holds (plank). */
export class HoldTracker {
  constructor(key) {
    this.key = key; this.spec = EXERCISES[key];
    this.hold = 0; this.good = 0; this.lastT = null; this.faultTime = {}; this.liveCue = null; this.liveSince = 0;
    this.reps = []; this.progress = 0; this.best = 0; this.cur = 0;
  }
  push(t, m, w = null) {
    const dt = this.lastT == null ? 0 : Math.min(0.25, t - this.lastT);
    this.lastT = t;
    if (this.spec.holdOk(m)) {
      this.hold += dt; this.cur += dt; this.best = Math.max(this.best, this.cur);
      const f = this.spec.holdFault(m);
      if (f) this.faultTime[f] = (this.faultTime[f] || 0) + dt; else this.good += dt;
    } else this.cur = 0;
    const lc = this.spec.live ? this.spec.live(m) : null;
    if (lc !== this.liveCue) { this.liveCue = lc; this.liveSince = t; }
    this.progress = 0;
    return null;
  }
  get activeLiveCue() { return this.liveCue && this.lastT - this.liveSince > 0.6 ? this.liveCue : null; }
  summary() {
    const faults = {};
    for (const [k, v] of Object.entries(this.faultTime)) if (v > 1.5) faults[k] = Math.round(v);
    const score = this.hold > 0 ? Math.round((100 * this.good) / this.hold) : 0;
    return { exercise: this.key, kind: "hold", reps: 0, clean: 0, hold: Math.round(this.hold), best: Math.round(this.best), score, faults, repList: [] };
  }
}

// ------------------------------------------------------------ the coach
/**
 * Coach: feed frames with push(t, world, vis). It recognises the exercise,
 * counts reps, scores them and groups them into sets.
 * Events (via onEvent): {type:"exercise", key}, {type:"rep", exercise, rep},
 * {type:"set", set}, {type:"cue", key, text}.
 */
export class Coach {
  constructor({ model, personal = null, onEvent = () => {}, forced = null } = {}) {
    this.clf = model ? new Classifier(model) : null;
    this.classes = model ? model.classes : Object.keys(EXERCISES).concat("idle");
    this.personal = personal;
    this.onEvent = onEvent;
    this.forced = forced;
    this.times = []; this.rows = []; this.metrics = []; this.worlds = [];
    this.ema = null; this.probs = null;
    this.active = null; this.tracker = null;
    this.candidate = null; this.candSince = 0;
    this.lastClassT = -1; this.lastActivity = 0; this.setStart = 0;
    this.sets = [];
    this.lastT = 0;
    this.noPoseSince = null;
  }
  setForced(key) {
    if (key === this.forced) return;
    this.forced = key;
    if (key && key !== this.active) this.activate(key, this.lastT, true);
  }
  /** Call when no person is visible in a frame. */
  pushEmpty(t) {
    this.lastT = t;
    if (this.noPoseSince == null) this.noPoseSince = t;
    if (this.active && t - this.noPoseSince > 6) this.endSet(t);
  }
  push(t, world, vis) {
    this.lastT = t;
    this.noPoseSince = null;
    if (this.forced && !this.tracker) this.activate(this.forced, t, true);
    const m = frameMetrics(world, vis);
    this.times.push(t); this.rows.push(frameVector(m)); this.metrics.push(m); this.worlds.push(world);
    while (this.times.length && this.times[0] < t - 6) { this.times.shift(); this.rows.shift(); this.metrics.shift(); this.worlds.shift(); }
    // --- recognition (~7 times a second)
    if (this.clf && t - this.lastClassT >= 0.14 && this.times.length > 8 && t - this.times[0] >= WINDOW_SEC * 0.95) {
      this.lastClassT = t;
      const R = resample(this.times, this.rows, t);
      const x = windowFeatures(R);
      this.lastWindow = x;
      (this.windowLog ??= []).push({ t, x });
      if (this.windowLog.length > 1200) this.windowLog.splice(0, 200);
      let p = this.clf.predict(x);
      if (this.personal) {
        const q = this.personal.predict(x, this.classes);
        if (q) { const w = q.dist < 0.6 ? 0.65 : q.dist < 1.0 ? 0.4 : 0.15; p = p.map((v, i) => (1 - w) * v + w * q.probs[i]); }
      }
      const a = 0.35;
      this.ema = this.ema ? this.ema.map((v, i) => v + a * (p[i] - v)) : p;
      this.probs = this.ema;
      if (!this.forced) this.decide(t);
    }
    let ev = null;
    if (this.tracker) {
      ev = this.tracker.push(t, m, world);
      if (ev) {
        this.lastActivity = t;
        this.onEvent({ type: "rep", exercise: this.active, rep: ev.rep });
        const bad = ev.rep.faults.find((f) => FAULTS[f.key] && f.key !== "very_deep");
        if (bad) this.onEvent({ type: "cue", key: bad.key, text: cueFor(this.active, bad.key), after: "rep" });
      }
      if (this.tracker instanceof HoldTracker && this.tracker.cur > 0) this.lastActivity = t;
      // no reps for a while -> the set is over
      if (!this.forced && this.active && t - this.lastActivity > 12) this.endSet(t);
    }
    return m;
  }
  top() {
    if (!this.probs) return { key: null, p: 0 };
    let bi = 0;
    this.probs.forEach((v, i) => { if (v > this.probs[bi]) bi = i; });
    return { key: this.classes[bi], p: this.probs[bi] };
  }
  decide(t) {
    const { key, p } = this.top();
    if (key !== this.candidate) { this.candidate = key; this.candSince = t; }
    const held = t - this.candSince;
    if (!this.active) {
      if (key && key !== "idle" && p > 0.55 && held > 0.6) this.activate(key, t, false);
    } else if (key !== this.active) {
      const hasWork = this.tracker && (this.tracker.reps.length > 0 || (this.tracker.hold || 0) > 3);
      const need = hasWork ? 2.5 : 1.2;
      if (p > 0.6 && held > need) {
        if (key === "idle") { if (t - this.lastActivity > 4) this.endSet(t); }
        else this.activate(key, t, false);
      }
    }
  }
  activate(key, t, manual) {
    if (this.active && this.active !== key) this.endSet(t);
    if (key === "idle") return;
    this.active = key;
    const spec = EXERCISES[key];
    this.tracker = spec.kind === "hold" ? new HoldTracker(key) : new RepTracker(key);
    this.setStart = t; this.lastActivity = t;
    // replay the last few seconds so the rep that triggered recognition counts
    if (!manual) {
      const from = t - 3.5;
      for (let i = 0; i < this.times.length - 1; i++) {
        if (this.times[i] < from) continue;
        const ev = this.tracker.push(this.times[i], this.metrics[i], this.worlds[i]);
        if (ev) this.onEvent({ type: "rep", exercise: key, rep: ev.rep, replay: true });
      }
    }
    this.onEvent({ type: "exercise", key, manual });
  }
  endSet(t) {
    if (!this.tracker) return null;
    const s = this.tracker.summary();
    const worth = s.kind === "reps" ? s.reps > 0 : s.hold >= 5;
    let set = null;
    if (worth) {
      set = { ...s, start: this.setStart, end: t };
      this.sets.push(set);
      this.onEvent({ type: "set", set });
    }
    this.tracker = null;
    this.active = this.forced || null;
    if (this.forced) this.activate(this.forced, t, true);
    return set;
  }
  /** Live state for the screen. */
  state() {
    const tr = this.tracker;
    const top = this.top();
    return {
      exercise: this.active, forced: !!this.forced, guess: top.key, confidence: top.p, probs: this.probs,
      reps: tr ? tr.reps.length : 0, clean: tr && tr.reps ? tr.reps.filter((r) => r.clean).length : 0,
      lastRep: tr && tr.reps && tr.reps.length ? tr.reps[tr.reps.length - 1] : null,
      progress: tr ? tr.progress : 0, hold: tr && tr.hold != null ? tr.hold : null, holdCur: tr && tr.cur != null ? tr.cur : null,
      liveCue: tr ? tr.activeLiveCue : null, sets: this.sets.length,
    };
  }
}
