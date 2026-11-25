// Rep graphs and skeleton replay for the workout summary.
import { EXERCISES, FAULTS, SIGNAL_LABELS, REPLAY_JOINTS } from "./engine.js";
import { FAULT_JOINTS } from "./pose.js";

const COLORS = { good: "#34d399", warn: "#fbbf24", bad: "#f87171", accent: "#4cc9ff", grid: "rgba(120,200,255,0.12)", muted: "#7f93ab", blue: "#a78bfa" };
export const scoreColor = (s) => (s >= 85 ? COLORS.good : s >= 60 ? COLORS.warn : COLORS.bad);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------ charts
function axes(W, H, pad, yMin, yMax, ticks, unit = "°") {
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  let g = "";
  for (const v of ticks) {
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${COLORS.grid}"/>`;
    g += `<text x="${pad.l - 4}" y="${y(v) + 3}" text-anchor="end">${v}${unit}</text>`;
  }
  return { y, g };
}

function niceRange(values, extra = []) {
  const all = values.concat(extra).filter((v) => v != null && isFinite(v));
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(1e-6, hi - lo);
  lo -= span * 0.08; hi += span * 0.08;
  return [lo, hi];
}

function ticksFor(lo, hi, n = 4, angle = true) {
  const step = angle ? Math.max(10, Math.ceil((hi - lo) / n / 10) * 10) : +((hi - lo) / n).toPrecision(1);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(3));
  return out;
}

function limitLine(W, pad, y, v, label, color) {
  return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="${W - pad.r - 2}" y="${y(v) - 4}" text-anchor="end" style="fill:${color}">${esc(label)}</text>`;
}

/** All reps of a set on one chart (time scaled to 0..100% of each rep). Tap a curve to open that rep. */
export function setChart(set, setIndex) {
  const spec = EXERCISES[set.exercise];
  const reps = (set.repList || []).filter((r) => r.trace?.t?.length > 2);
  if (!reps.length || !spec?.chart) return "";
  const W = 340, H = 170, pad = { l: 34, r: 8, t: 12, b: 20 };
  const vals = reps.flatMap((r) => r.trace.s);
  const lims = [spec.chart.depth, spec.chart.lock].filter((v) => v != null);
  const [lo0, hi0] = niceRange(vals, lims);
  const lo = Math.max(0, lo0), hi = Math.min(185, hi0);
  const { y, g } = axes(W, H, pad, lo, hi, ticksFor(lo, hi));
  const x = (f) => pad.l + f * (W - pad.l - pad.r);
  let body = g;
  if (spec.chart.depth != null) {
    body += `<rect x="${pad.l}" y="${y(spec.chart.depth)}" width="${W - pad.l - pad.r}" height="${Math.max(0, y(lo) - y(spec.chart.depth))}" fill="${COLORS.good}" opacity="0.08"/>`;
    body += limitLine(W, pad, y, spec.chart.depth, `depth ≤ ${spec.chart.depth}°`, COLORS.good);
  }
  if (spec.chart.lock != null) body += limitLine(W, pad, y, spec.chart.lock, `lockout ≥ ${spec.chart.lock}°`, COLORS.blue);
  reps.forEach((r) => {
    const T = r.trace.t[r.trace.t.length - 1] || 1;
    const pts = r.trace.t.map((t, i) => `${x(t / T).toFixed(1)},${y(r.trace.s[i]).toFixed(1)}`).join(" ");
    const ri = set.repList.indexOf(r);
    body += `<polyline class="repline" data-set="${setIndex}" data-rep="${ri}" points="${pts}" fill="none" stroke="${scoreColor(r.score)}" stroke-width="2.2" stroke-linejoin="round" opacity="0.85"/>`;
  });
  body += `<text x="${pad.l}" y="${H - 5}">start</text><text x="${(pad.l + W - pad.r) / 2}" y="${H - 5}" text-anchor="middle">${esc(SIGNAL_LABELS[spec.signal] || spec.signal)} through each rep</text><text x="${W - pad.r}" y="${H - 5}" text-anchor="end">end</text>`;
  return `<svg class="chart repchart" data-set="${setIndex}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rep curves">${body}</svg>
    <div class="legend"><span><i style="background:${COLORS.good}"></i>85+</span><span><i style="background:${COLORS.warn}"></i>60–84</span><span><i style="background:${COLORS.bad}"></i>&lt;60</span><span>tap a line to replay</span></div>`;
}

/** One metric over the rep's time, with limit lines and a cursor. */
export function traceChart(trace, values, { limits = [], unit = "°", label = "", id = "", height = 140, angle = true } = {}) {
  const W = 340, H = height, pad = { l: 38, r: 8, t: 14, b: 20 };
  const [lo0, hi0] = niceRange(values, limits.map((l) => l.v));
  const lo = angle ? Math.max(0, lo0) : lo0, hi = angle ? Math.min(185, hi0) : hi0;
  const { y, g } = axes(W, H, pad, lo, hi, ticksFor(lo, hi, 4, angle), unit);
  const T = trace.t[trace.t.length - 1] || 1;
  const x = (t) => pad.l + (t / T) * (W - pad.l - pad.r);
  let body = g;
  for (const l of limits) body += limitLine(W, pad, y, l.v, l.label, l.color);
  const pts = trace.t.map((t, i) => `${x(t).toFixed(1)},${y(values[i]).toFixed(1)}`).join(" ");
  body += `<polyline points="${pts}" fill="none" stroke="${COLORS.accent}" stroke-width="2.5" stroke-linejoin="round"/>`;
  body += `<line id="${id}-cur" x1="${x(0)}" x2="${x(0)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#fff" stroke-width="1.5"/>`;
  body += `<circle id="${id}-dot" cx="${x(0)}" cy="${y(values[0])}" r="4.5" fill="#fff"/>`;
  body += `<text x="${pad.l}" y="${H - 5}">0 s</text><text x="${W - pad.r}" y="${H - 5}" text-anchor="end">${T.toFixed(1)} s</text>`;
  return {
    html: `<div class="hint" style="margin:10px 0 2px">${esc(label)}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${body}</svg>`,
    move(svgRoot, i) {
      const cur = svgRoot.querySelector(`#${id}-cur`), dot = svgRoot.querySelector(`#${id}-dot`);
      if (!cur) return;
      const xi = x(trace.t[i]);
      cur.setAttribute("x1", xi); cur.setAttribute("x2", xi);
      dot.setAttribute("cx", xi); dot.setAttribute("cy", y(values[i]));
    },
  };
}

// ------------------------------------------------------------ fault explanations
export function explainFault(ex, f) {
  const spec = EXERCISES[ex];
  const v = f.value;
  const sig = (SIGNAL_LABELS[spec.signal] || "angle").toLowerCase();
  const sec = spec.secondary || {};
  switch (f.key) {
    case "partial_depth": return `Lowest ${sig} was ${v}°; the target is ${spec.chart?.depth ?? 100}° or less.`;
    case "no_lockout": return `Highest ${sig} was ${v}°; straighten to ${spec.chart?.lock ?? 150}° or more.`;
    case "hip_sag": return `Hips were ${Math.abs(v).toFixed(2)} torso-lengths below the shoulder-to-ankle line (limit ${Math.abs(sec.lo ?? 0.12)}).`;
    case "hip_pike": return `Hips were ${v.toFixed(2)} torso-lengths above the line (limit ${sec.hi ?? 0.14}).`;
    case "elbow_flare": return `Upper arms were ${v}° out from the body at the bottom; aim for about 45° (flagged above 63°).`;
    case "rushed": return `That phase took only ${v} s; aim for 1–2 s.`;
    case "hips_low": return `Hip angle was ${v}°; keep it under ${sec.hi ?? 112}° for a high pike.`;
    case "chin_below_bar": return `Your nose stayed ${Math.abs(v).toFixed(2)} torso-lengths below your hands: the chin didn't clear the bar.`;
    case "kipping": return `Your body swung through ${v}° (flagged above 30°).`;
    case "excess_lean": return `Your torso leaned ${v}° from vertical (limit ${sec.hi ?? 45}°).`;
    case "swinging": return `Swing range was ${v}°.`;
    case "knee_valgus": return `The knee gap was only ${Math.round(v * 100)}% of the ankle gap at the bottom (flagged under 82%).`;
    case "bent_knees": return `Knees were bent to ${v}° at the top.`;
    case "very_deep": return `Elbows closed to ${v}°. Fine if your shoulders feel good.`;
    default: return "";
  }
}

// ------------------------------------------------------------ skeleton replay
const IDX = Object.fromEntries(REPLAY_JOINTS.map((j, i) => [j, i]));
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
const LEFT = new Set([11, 13, 15, 23, 25, 27, 31]);

export class ReplayPlayer {
  constructor(canvas, trace, { highlight = [], iMin = 0, onFrame = () => {} } = {}) {
    this.c = canvas; this.tr = trace; this.onFrame = onFrame;
    this.hl = new Set(highlight);
    this.i = 0; this.playing = false; this.speed = 0.5; this.raf = 0;
    this.iMin = iMin;
    const xs = [], ys = [];
    for (const f of trace.k) for (let j = 0; j < f.length; j += 2) { xs.push(f[j]); ys.push(f[j + 1]); }
    this.box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  pt(f, joint) {
    const W = this.c.width, H = this.c.height, b = this.box;
    const s = Math.min((W * 0.86) / Math.max(1, b.x1 - b.x0), (H * 0.86) / Math.max(1, b.y1 - b.y0));
    const ox = (W - (b.x1 - b.x0) * s) / 2, oy = (H - (b.y1 - b.y0) * s) / 2;
    const k = IDX[joint];
    return [ox + (f[2 * k] - b.x0) * s, oy + (f[2 * k + 1] - b.y0) * s];
  }
  drawBody(ctx, f, alpha, ghost) {
    const lw = Math.max(3, this.c.width / 75);
    ctx.globalAlpha = alpha; ctx.lineCap = "round"; ctx.lineWidth = ghost ? lw * 0.8 : lw;
    for (const [a, b] of BONES) {
      const [x1, y1] = this.pt(f, a), [x2, y2] = this.pt(f, b);
      ctx.strokeStyle = ghost ? "#8b96a5" : this.hl.has(a) || this.hl.has(b) ? COLORS.bad : LEFT.has(a) && LEFT.has(b) ? COLORS.accent : "#e9f7c2";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    const [nx, ny] = this.pt(f, 0);
    ctx.fillStyle = ghost ? "#8b96a5" : "#fff";
    ctx.beginPath(); ctx.arc(nx, ny, lw * 2.2, 0, Math.PI * 2); ctx.fill();
    if (!ghost) for (const j of REPLAY_JOINTS.slice(1)) {
      const [x, y] = this.pt(f, j);
      ctx.fillStyle = this.hl.has(j) ? COLORS.bad : "#fff";
      ctx.beginPath(); ctx.arc(x, y, this.hl.has(j) ? lw * 1.4 : lw * 0.75, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  draw() {
    const ctx = this.c.getContext("2d");
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    // the deepest point of the rep stays visible as a ghost
    if (this.i !== this.iMin) this.drawBody(ctx, this.tr.k[this.iMin], 0.28, true);
    this.drawBody(ctx, this.tr.k[this.i], 1, false);
    this.onFrame(this.i);
  }
  seek(i) { this.i = Math.max(0, Math.min(this.tr.k.length - 1, i)); this.draw(); }
  play() {
    if (this.playing) return;
    this.playing = true;
    if (this.i >= this.tr.k.length - 1) this.i = 0;
    let tPlay = this.tr.t[this.i], last = performance.now();
    const step = (now) => {
      if (!this.playing) return;
      tPlay += ((now - last) / 1000) * this.speed; last = now;
      while (this.i < this.tr.t.length - 1 && this.tr.t[this.i + 1] <= tPlay) this.i++;
      this.draw();
      if (this.i >= this.tr.t.length - 1) { this.playing = false; this.onEnd?.(); return; }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); }
  destroy() { this.pause(); }
}

/** Highlighted joints for a rep's faults. */
const SIGNAL_JOINTS = { elbow: [13, 14], knee: [25, 26], knee_front: [25, 26], hip: [23, 24] };
export const faultJoints = (rep, ex) => rep.faults.flatMap((f) =>
  ["partial_depth", "no_lockout"].includes(f.key) ? SIGNAL_JOINTS[EXERCISES[ex]?.signal] || [] : FAULT_JOINTS[f.key] || []);

/** Rep index whose curve passes closest to a tap on a set chart (null if none near). */
export function nearestRep(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  let best = null, bestD = 30;
  for (const line of svg.querySelectorAll(".repline")) {
    for (const xy of line.getAttribute("points").split(" ")) {
      const [x, y] = xy.split(",").map(Number);
      const d = Math.hypot(x - p.x, (y - p.y) * 1.2);
      if (d < bestD) { bestD = d; best = +line.dataset.rep; }
    }
  }
  return best;
}
export { FAULTS };
