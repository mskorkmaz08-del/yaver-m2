// Workout analytics: turns a saved session into the numbers and pictures the
// report shows (time under work vs rest, time between reps, per-exercise totals),
// plus all-time totals for the Analytics page. Pure functions, no DOM.
import { EXERCISES } from "./engine.js";

export const PATTERN = {
  push_up: "push", pike_push_up: "push", dip: "push",
  pull_up: "pull", inverted_row: "pull",
  squat: "legs", lunge: "legs",
  plank: "core", hanging_leg_raise: "core",
};
export const PATTERN_COLOR = { push: "#4cc9ff", pull: "#a78bfa", legs: "#34d399", core: "#fbbf24", other: "#7f93ab" };
export const exColor = (ex) => PATTERN_COLOR[PATTERN[ex] || "other"];
export const scoreHue = (s) => (s >= 85 ? "#34d399" : s >= 60 ? "#fbbf24" : "#f87171");

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
export const fmtDur = (s) => {
  if (s == null || !isFinite(s)) return "–";
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(ss).padStart(2, "0")}`;
};
export const fmtSec = (s) => (s == null ? "–" : s < 10 ? `${s.toFixed(1)}s` : fmtDur(s));

// When the set was actually being worked: first rep start to last rep end
// (the coach closes a set ~12 s after the last movement, which is rest).
export function workBounds(set) {
  const reps = set.repList || [];
  if (reps.length) return [reps[0].t0, reps[reps.length - 1].t1];
  return [set.start, set.kind === "hold" && set.hold ? Math.min(set.end, set.start + set.hold + 1) : set.end];
}

export function analyse(session) {
  const sets = session.sets || [];
  const bounds = sets.map(workBounds);
  const t0 = session.t0 ?? (bounds.length ? Math.min(...bounds.map((b) => b[0])) : 0);
  const lastEnd = bounds.length ? Math.max(...bounds.map((b) => b[1])) : t0;
  const duration = Math.max(session.duration ?? ((session.end || session.start) - session.start) / 1000, lastEnd - t0, 0);
  const rows = sets.map((s, i) => {
    const [a, b] = bounds[i];
    const reps = s.repList || [];
    const gaps = reps.slice(1).map((r, k) => Math.max(0, r.t0 - reps[k].t1));
    const prevEnd = i > 0 ? bounds[i - 1][1] : null;
    return {
      set: s, i, ex: s.exercise, kind: s.kind, offset: a - t0, work: Math.max(0, b - a),
      restBefore: prevEnd != null ? Math.max(0, a - prevEnd) : null,
      gaps, avgGap: avg(gaps), avgRep: avg(reps.map((r) => r.duration ?? r.t1 - r.t0)),
    };
  });
  const active = rows.reduce((x, r) => x + r.work, 0);
  const restsBetween = rows.map((r) => r.restBefore).filter((x) => x != null);
  const byEx = {};
  for (const r of rows) {
    const s = r.set;
    const e = (byEx[r.ex] ||= { first: r.i, ex: r.ex, kind: s.kind, sets: 0, reps: 0, clean: 0, hold: 0, bestHold: 0, bestSet: 0, scoreW: 0, scoreN: 0, repTimes: [], gaps: [], work: 0 });
    e.sets++; e.work += r.work;
    e.reps += s.reps || 0; e.clean += s.clean || 0;
    e.bestSet = Math.max(e.bestSet, s.reps || 0);
    if (s.kind === "hold") { e.hold += s.hold || 0; e.bestHold = Math.max(e.bestHold, s.best || s.hold || 0); }
    const w = s.kind === "hold" ? s.hold || 0 : s.reps || 0;
    if (s.score != null && w) { e.scoreW += s.score * w; e.scoreN += w; }
    for (const rep of s.repList || []) e.repTimes.push(rep.duration ?? rep.t1 - rep.t0);
    e.gaps.push(...r.gaps);
  }
  const exercises = Object.values(byEx).map((e) => ({
    first: e.first, ex: e.ex, kind: e.kind, sets: e.sets, reps: e.reps, clean: e.clean, hold: e.hold, bestHold: e.bestHold, bestSet: e.bestSet, work: e.work,
    cleanPct: e.reps ? Math.round((100 * e.clean) / e.reps) : null,
    score: e.scoreN ? Math.round(e.scoreW / e.scoreN) : null,
    avgRep: r1(avg(e.repTimes)), avgGap: r1(avg(e.gaps)),
  })).sort((a, b) => a.first - b.first);
  const reps = sets.reduce((a, s) => a + (s.reps || 0), 0);
  // rep-weighted over rep sets, the same way the Analytics page averages it
  const scored = sets.filter((s) => s.score != null && s.reps);
  const wsum = scored.reduce((a, s) => a + s.reps, 0);
  const allGaps = rows.flatMap((r) => r.gaps);
  return {
    t0, duration, active, rest: Math.max(0, duration - active), reps,
    clean: sets.reduce((a, s) => a + (s.clean || 0), 0),
    sets: sets.length, rows, exercises,
    score: wsum ? Math.round(scored.reduce((a, s) => a + s.score * s.reps, 0) / wsum) : null,
    avgRestBetweenSets: avg(restsBetween), avgGap: avg(allGaps),
  };
}

// ---------- SVG: the whole workout on one time line
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function timelineSVG(a, { names = (k) => k } = {}) {
  const W = 340, H = 92, pl = 6, pr = 6, top = 20, bh = 34;
  const D = Math.max(a.duration, 1);
  const x = (t) => pl + (Math.max(0, Math.min(D, t)) / D) * (W - pl - pr);
  let g = `<rect x="${pl}" y="${top}" width="${W - pl - pr}" height="${bh}" rx="6" fill="rgba(120,200,255,0.05)" stroke="rgba(120,200,255,0.12)"/>`;
  for (const r of a.rows) {
    const x0 = x(r.offset), x1 = Math.max(x0 + 3, x(r.offset + r.work));
    const c = exColor(r.ex);
    g += `<rect class="tl-set" data-set="${r.i}" x="${x0}" y="${top}" width="${x1 - x0}" height="${bh}" rx="4" fill="${c}" fill-opacity="0.28" stroke="${c}" stroke-opacity="0.8"><title>Set ${r.i + 1}: ${esc(names(r.ex))}</title></rect>`;
    for (const rep of r.set.repList || []) {
      const xt = x(rep.t1 - a.t0);
      g += `<line x1="${xt}" x2="${xt}" y1="${top + 6}" y2="${top + bh - 6}" stroke="${c}" stroke-width="1.4"/>`;
    }
    if (x1 - x0 > 16) g += `<text x="${(x0 + x1) / 2}" y="${top - 6}" text-anchor="middle" style="fill:${c}">${r.set.kind === "hold" ? `${r.set.hold}s` : r.set.reps}</text>`;
    if (r.restBefore != null && r.restBefore >= 15) {
      const xa = x(r.offset - r.restBefore), xb = x0;
      if (xb - xa > 26) g += `<text x="${(xa + xb) / 2}" y="${top + bh / 2 + 3}" text-anchor="middle">${fmtDur(r.restBefore)}</text>`;
    }
  }
  // time axis
  const step = [30, 60, 120, 300, 600, 900, 1800].find((s) => D / s <= 6) || 3600;
  for (let t = 0; t <= D + 0.01; t += step) {
    g += `<line x1="${x(t)}" x2="${x(t)}" y1="${top + bh + 2}" y2="${top + bh + 6}" stroke="rgba(120,200,255,0.3)"/>`;
    g += `<text x="${x(t)}" y="${top + bh + 18}" text-anchor="${t === 0 ? "start" : "middle"}">${t ? fmtDur(t) : "0"}</text>`;
  }
  return `<svg class="chart timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Workout timeline">${g}</svg>`;
}

// ---------- SVG: rhythm of one set (each rep as a block, gaps between them)
export function rhythmSVG(row) {
  const reps = row.set.repList || [];
  if (!reps.length) return "";
  const W = 340, H = 58, pl = 4, pr = 4, top = 8, bh = 22;
  const a = reps[0].t0, b = reps[reps.length - 1].t1;
  const D = Math.max(0.5, b - a);
  const x = (t) => pl + ((t - a) / D) * (W - pl - pr);
  let g = "";
  reps.forEach((r, k) => {
    const x0 = x(r.t0), x1 = Math.max(x0 + 2, x(r.t1));
    g += `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bh}" rx="3" fill="${scoreHue(r.score)}" fill-opacity="0.75"/>`;
    if (x1 - x0 > 14) g += `<text x="${(x0 + x1) / 2}" y="${top + bh / 2 + 3.5}" text-anchor="middle" style="fill:#06121b;stroke:none">${r.n}</text>`;
    if (k > 0) {
      const gap = Math.max(0, r.t0 - reps[k - 1].t1);
      const gx = (x(reps[k - 1].t1) + x0) / 2;
      if (reps.length <= 14 || gap >= 1) g += `<text x="${gx}" y="${top + bh + 16}" text-anchor="middle">${gap.toFixed(1)}</text>`;
    }
  });
  return `<svg class="chart rhythm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rep rhythm">${g}</svg>`;
}

// ---------- all-time numbers for the Analytics page
const DAY = 86400000;
export function weekStart(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}
export function totals(sessions) {
  const out = { workouts: sessions.length, reps: 0, time: 0, holds: 0, byEx: {}, weeks: [] };
  const now = Date.now();
  const w0 = weekStart(now);
  const weeks = Array.from({ length: 8 }, (_, k) => ({ start: w0 - (7 - k) * 7 * DAY, reps: 0, workouts: 0, time: 0 }));
  for (const s of sessions) {
    const a = analyse(s);
    out.reps += a.reps; out.time += a.duration;
    const wk = weeks.find((w) => s.start >= w.start && s.start < w.start + 7 * DAY);
    if (wk) { wk.reps += a.reps; wk.workouts++; wk.time += a.duration; }
    for (const e of a.exercises) {
      const t = (out.byEx[e.ex] ||= { ex: e.ex, kind: e.kind, reps: 0, sets: 0, hold: 0, bestSet: 0, bestHold: 0, last: 0, workouts: 0, scoreW: 0, scoreN: 0, gaps: [] });
      t.reps += e.reps; t.sets += e.sets; t.hold += e.hold; t.workouts++;
      t.bestSet = Math.max(t.bestSet, e.bestSet); t.bestHold = Math.max(t.bestHold, e.bestHold);
      t.last = Math.max(t.last, s.start);
      const w = e.kind === "hold" ? e.hold : e.reps;
      if (e.score != null && w) { t.scoreW += e.score * w; t.scoreN += w; }
      if (e.avgGap != null) t.gaps.push(e.avgGap);
    }
  }
  out.weeks = weeks;
  out.exercises = Object.values(out.byEx).map((t) => ({ ...t, score: t.scoreN ? Math.round(t.scoreW / t.scoreN) : null, avgGap: r1(avg(t.gaps)) }))
    .sort((a, b) => b.last - a.last);
  out.thisWeek = weeks[weeks.length - 1];
  return out;
}

export const isRepEx = (ex) => EXERCISES[ex]?.kind !== "hold";
