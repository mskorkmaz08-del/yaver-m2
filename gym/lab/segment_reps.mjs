// Segment and score reps with the app's own engine.
//   node segment_reps.mjs < {"exercise": "...", "t": [...], "world": [[[x,y,z]x33]...]}  > {"reps": [...]}
import { RepTracker, HoldTracker, EXERCISES, frameMetrics } from "../engine.js";
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const { exercise, t, world } = JSON.parse(input);
  const spec = EXERCISES[exercise];
  const tr = spec.kind === "hold" ? new HoldTracker(exercise) : new RepTracker(exercise);
  world.forEach((w, i) => { if (w) tr.push(t[i], frameMetrics(w)); });
  const reps = (tr.reps || []).map(({ trace, ...r }) => r);
  process.stdout.write(JSON.stringify({ reps, summary: tr.summary ? { ...tr.summary(), repList: undefined } : null }));
});
