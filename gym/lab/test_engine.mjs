// Runs the phone app's engine over synthetic workouts with known reps/faults.
//   node test_engine.mjs tests.json model.json [--forced]
import fs from "node:fs";
import { Coach, RepTracker, HoldTracker, EXERCISES, frameMetrics } from "../engine.js";

const [,, testsPath, modelPath, flag] = process.argv;
const tests = JSON.parse(fs.readFileSync(testsPath, "utf8"));
const model = modelPath && modelPath !== "-" ? JSON.parse(fs.readFileSync(modelPath, "utf8")) : null;
const forced = flag === "--forced";

// ---- parity with lab/features.py
let worst = 0, worstKey = "";
for (const s of tests.sequences) {
  const idx = [0, Math.floor(s.world.length / 2)];
  idx.forEach((fi, j) => {
    const m = frameMetrics(s.world[fi]);
    for (const [k, v] of Object.entries(s.parity[j])) {
      const d = Math.abs(m[k] - v);
      if (d > worst) { worst = d; worstKey = k; }
    }
  });
}
console.log(`parity: max |js - py| = ${worst.toExponential(2)} (${worstKey})`);

const byEx = {};
const faultStats = {}; // key -> {tp, fp, fn}
for (const s of tests.sequences) {
  const ex = s.exercise;
  const st = (byEx[ex] ??= { n: 0, recog: 0, repsTrue: 0, repsFound: 0, exact: 0, offBy: [], cleanFlag: 0, faultySeq: 0, faultDetected: 0 });
  st.n++;
  const events = [];
  const coach = new Coach({ model, forced: forced && ex !== "idle" ? ex : null, onEvent: (e) => events.push(e) });
  s.world.forEach((w, i) => coach.push(i / s.fps, w));
  coach.endSet(s.world.length / s.fps);
  const sets = coach.sets;
  if (ex === "idle") { st.recog += sets.length === 0 ? 1 : 0; continue; }
  const mine = sets.filter((x) => x.exercise === ex);
  const reps = mine.reduce((a, x) => a + x.reps, 0);
  const recognised = mine.length > 0;
  st.recog += recognised ? 1 : 0;
  if (EXERCISES[ex].kind === "reps") {
    st.repsTrue += s.reps; st.repsFound += reps;
    if (reps === s.reps) st.exact++; else st.offBy.push(reps - s.reps);
  }
  // fault detection (per sequence: was the injected fault reported in >= half the reps?)
  const counts = {};
  for (const x of mine) for (const [k, v] of Object.entries(x.faults)) counts[k] = (counts[k] || 0) + v;
  const nreps = Math.max(1, reps);
  const reported = new Set(Object.entries(counts).filter(([k, v]) => (EXERCISES[ex].kind === "hold" ? v > 0 : v >= nreps * 0.5)).map(([k]) => k));
  const truth = new Set(s.faults);
  const keys = new Set([...reported, ...truth]);
  for (const k of keys) {
    if (k === "very_deep") continue;
    const fs_ = (faultStats[`${ex}:${k}`] ??= { tp: 0, fp: 0, fn: 0 });
    if (truth.has(k) && reported.has(k)) fs_.tp++;
    else if (reported.has(k)) fs_.fp++;
    else fs_.fn++;
  }
}
// false reps: every rep tracker run over idle sequences (person not exercising)
{
  const idle = tests.sequences.filter((s) => s.exercise === "idle");
  const fr = {};
  for (const key of Object.keys(EXERCISES)) {
    if (EXERCISES[key].kind !== "reps") continue;
    let n = 0;
    for (const s of idle) { const tr = new RepTracker(key); s.world.forEach((w, i) => tr.push(i / s.fps, frameMetrics(w))); n += tr.reps.length; }
    fr[key] = n;
  }
  console.log("false reps on", idle.length, "idle clips (forced trackers):", JSON.stringify(fr));
}
console.log(`\n${forced ? "FORCED exercise (manual mode)" : "AUTO recognition"}`);
console.log("exercise            recog   reps true/found  exact-seq  off-by");
for (const [ex, st] of Object.entries(byEx)) {
  console.log(`${ex.padEnd(19)} ${st.recog}/${st.n}`.padEnd(28) + `${st.repsTrue}/${st.repsFound}`.padEnd(17) + `${st.exact}/${st.n}`.padEnd(11) + st.offBy.join(","));
}
console.log("\nfault detection per sequence (tp / fp / fn):");
for (const [k, v] of Object.entries(faultStats).sort()) console.log(`  ${k.padEnd(34)} ${v.tp} / ${v.fp} / ${v.fn}`);
