// Turns stored workouts into progress numbers, charts and recommendations.
import { EXERCISES, FAULTS } from "./engine.js";
import { INFO, DRILLS } from "./guide.js";

const DAY = 86400000;
const PUSH = ["push_up", "pike_push_up", "dip"];
const PULL = ["pull_up", "inverted_row"];

/** One row per session that contains the exercise (oldest first). */
export function exerciseHistory(sessions, ex) {
  const rows = [];
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    const sets = s.sets.filter((x) => x.exercise === ex);
    if (!sets.length) continue;
    const reps = sets.reduce((a, x) => a + x.reps, 0);
    const clean = sets.reduce((a, x) => a + x.clean, 0);
    const faults = {};
    for (const x of sets) for (const [k, v] of Object.entries(x.faults || {})) faults[k] = (faults[k] || 0) + v;
    const allReps = sets.flatMap((x) => x.repList || []);
    const ecc = allReps.length ? allReps.reduce((a, r) => a + r.ecc, 0) / allReps.length : null;
    const scoreW = EXERCISES[ex]?.kind === "hold"
      ? Math.round(sets.reduce((a, x) => a + x.score * x.hold, 0) / Math.max(1, sets.reduce((a, x) => a + x.hold, 0)))
      : Math.round(sets.reduce((a, x) => a + x.score * x.reps, 0) / Math.max(1, reps));
    rows.push({
      date: s.start, sets: sets.length, reps, clean, score: scoreW,
      bestSet: Math.max(...sets.map((x) => x.clean)),
      hold: sets.reduce((a, x) => a + (x.hold || 0), 0), best: Math.max(...sets.map((x) => x.best || 0)),
      faults, ecc,
    });
  }
  return rows;
}

export function overview(sessions) {
  const now = Date.now();
  const last7 = sessions.filter((s) => now - s.start < 7 * DAY);
  const last28 = sessions.filter((s) => now - s.start < 28 * DAY);
  const reps7 = last7.reduce((a, s) => a + s.sets.reduce((b, x) => b + x.reps, 0), 0);
  const scored = last7.flatMap((s) => s.sets.filter((x) => x.reps > 0));
  const avgScore = scored.length ? Math.round(scored.reduce((a, x) => a + x.score * x.reps, 0) / Math.max(1, scored.reduce((a, x) => a + x.reps, 0))) : null;
  // weekly streak: consecutive weeks (ending this week) with at least one workout
  let streak = 0;
  for (let w = 0; w < 52; w++) {
    const from = now - (w + 1) * 7 * DAY, to = now - w * 7 * DAY;
    if (sessions.some((s) => s.start >= from && s.start < to)) streak++; else break;
  }
  const vol = (keys, list) => list.reduce((a, s) => a + s.sets.filter((x) => keys.includes(x.exercise)).reduce((b, x) => b + x.reps, 0), 0);
  return { workouts7: last7.length, reps7, avgScore, streak, push28: vol(PUSH, last28), pull28: vol(PULL, last28), sessions28: last28.length };
}

/** Recommendations for one exercise. Returns [{title, text, kind}]. */
export function recommend(sessions, ex) {
  const info = INFO[ex];
  const rows = exerciseHistory(sessions, ex);
  const out = [];
  if (!rows.length) {
    out.push({ kind: "start", title: "No data yet", text: `Record a set of ${EXERCISES[ex].name.toLowerCase()}s. ${info.camera}` });
    return out;
  }
  const recent = rows.slice(-3);
  const isHold = EXERCISES[ex].kind === "hold";

  // 1) Form first: the most common fault over the last sessions
  const faults = {};
  let reps = 0;
  for (const r of recent) { reps += r.reps; for (const [k, v] of Object.entries(r.faults)) faults[k] = (faults[k] || 0) + v; }
  const top = Object.entries(faults).filter(([k]) => k !== "very_deep").sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const share = isHold ? null : top[1] / Math.max(1, reps);
    if (isHold || share >= 0.25) {
      out.push({
        kind: "form", title: `Fix first: ${FAULTS[top[0]]?.label ?? top[0]}`,
        text: `${isHold ? `${top[1]} s with this fault in recent planks.` : `${Math.round(share * 100)}% of your recent reps.`} ${DRILLS[top[0]] ?? ""}`,
      });
    }
  }

  // 2) Progression (double progression on the best clean set)
  const last = rows[rows.length - 1];
  if (isHold) {
    const best = Math.max(...recent.map((r) => r.best));
    if (best >= info.target && last.score >= 80) out.push({ kind: "up", title: "Ready for a harder plank", text: `You held ${best} s with good form. Try: ${info.harder}.` });
    else if (best < 20) out.push({ kind: "down", title: "Build up the hold", text: `Do several 15–20 s holds with perfect form, or use: ${info.easier}.` });
    else out.push({ kind: "next", title: `Next goal: ${Math.min(info.target, best + 10)} s`, text: "Add 5–10 s to your best hold each week, 3 sets." });
  } else {
    const hits = recent.filter((r) => r.bestSet >= info.target).length;
    const best = last.bestSet;
    if (hits >= 2 && last.score >= 80) {
      out.push({ kind: "up", title: "Time to progress", text: `${info.target}+ clean reps in a set with a ${last.score} form score. Move on to: ${info.harder}, and work it in the 5–12 rep range.` });
    } else if (best < Math.max(3, Math.round(info.target * 0.2)) || last.score < 60) {
      out.push({ kind: "down", title: "Use an easier variation", text: `Your best set had ${best} clean rep${best === 1 ? "" : "s"}. ${info.easier} lets you train full-range reps with good form; come back when you reach 8–12.` });
    } else {
      out.push({ kind: "next", title: `Next goal: ${best + 1}–${best + 2} clean reps`, text: `Beat your best clean set (${best}) by 1–2 reps; do 3–4 sets. At ${info.target} clean reps, move to: ${info.harder.split(",")[0]}.` });
    }
    // tempo
    const ecc = recent.map((r) => r.ecc).filter((v) => v != null);
    if (ecc.length && ecc.reduce((a, b) => a + b, 0) / ecc.length < 0.8) {
      out.push({ kind: "tempo", title: "Slow down the lowering", text: "Your lowering phase averages under 1 s. A 2 s lowering builds more strength and control." });
    }
  }

  // 3) Trend
  if (rows.length >= 3) {
    const a = rows.slice(-3).map((r) => r.score), b = rows.slice(-6, -3).map((r) => r.score);
    if (b.length) {
      const d = a.reduce((x, y) => x + y, 0) / a.length - b.reduce((x, y) => x + y, 0) / b.length;
      if (d >= 5) out.push({ kind: "trend", title: "Form is improving", text: `Form score up ${Math.round(d)} points over your last sessions.` });
      else if (d <= -5) out.push({ kind: "trend", title: "Form is slipping", text: `Form score down ${Math.round(-d)} points. Reduce reps per set and focus on the cues.` });
    }
  }
  return out;
}

export function generalAdvice(sessions) {
  const o = overview(sessions);
  const out = [];
  if (o.sessions28 && o.sessions28 < 6) out.push({ title: "Train more consistently", text: "Two to three sessions a week per movement gives steady progress." });
  if (o.push28 > 30 && o.pull28 < o.push28 * 0.6) out.push({ title: "Balance pushing with pulling", text: `Last 4 weeks: ${o.push28} pushing reps vs ${o.pull28} pulling reps. Add rows or pull-ups to keep the shoulders healthy.` });
  return out;
}

// ---------- tiny SVG charts
export function chart(values, { labels = [], type = "line", max = null, color = "#4cc9ff", height = 130, suffix = "" } = {}) {
  const W = 340, H = height, pl = 28, pr = 8, pt = 10, pb = 20;
  const n = values.length;
  if (!n) return "";
  const mx = max ?? Math.max(1, ...values.filter((v) => v != null));
  const x = (i) => pl + (n === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (n - 1));
  const y = (v) => pt + (1 - v / mx) * (H - pt - pb);
  let g = "";
  for (const f of [0, 0.5, 1]) {
    const v = mx * f;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(120,200,255,0.12)" stroke-width="1"/>`;
    g += `<text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}${suffix}</text>`;
  }
  if (type === "bar") {
    const bw = Math.max(4, Math.min(22, ((W - pl - pr) / n) * 0.6));
    values.forEach((v, i) => {
      const cx = n === 1 ? x(0) : pl + ((i + 0.5) * (W - pl - pr)) / n;
      g += `<rect x="${cx - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, H - pb - y(v))}" rx="3" fill="${color}"/>`;
    });
  } else {
    const pts = values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
    g += `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.join(" ")}"/>`;
    values.forEach((v, i) => { if (v != null) g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.2" fill="${color}"/>`; });
  }
  if (labels.length) {
    const step = Math.ceil(n / 6);
    labels.forEach((l, i) => {
      if (i % step && i !== n - 1) return;
      const cx = type === "bar" ? (n === 1 ? x(0) : pl + ((i + 0.5) * (W - pl - pr)) / n) : x(i);
      g += `<text x="${cx}" y="${H - 5}" text-anchor="middle">${l}</text>`;
    });
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
