// Perfect-form references: one ideal rep per exercise as a 3D capture.
// Priority: the user's own chosen reference (IndexedDB) > the bundled one
// (reference/<exercise>.json: generated now, from real videos later).
import { fromJSON, framePoints } from "./capture.js";
import { EXERCISES, frameMetrics } from "./engine.js";
import { store } from "./store.js";

const cache = {};

/** userCap (optional) picks the matching variant, e.g. forearm vs straight-arm plank. */
export async function getReference(ex, userCap = null) {
  const mine = await store.reference(ex);
  if (mine) return { cap: mine.cap, source: "yours", note: mine.note || "A rep you picked as your reference" };
  let file = ex;
  if (ex === "plank" && userCap) {
    const m = frameMetrics(framePoints(userCap, Math.floor(userCap.frames / 2)));
    if (m.elbow > 130) file = "plank_high";
  }
  if (cache[file] !== undefined) return cache[file];
  const key = file;
  ex = file;
  try {
    const r = await fetch(`reference/${ex}.json`);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const cap = fromJSON(j);
    cache[key] = { cap, source: j.source || "bundled", note: j.note || "" };
  } catch { cache[key] = null; }
  return cache[key];
}

/** Index of the key frame (deepest point of the key angle) in a capture. */
export function keyFrame(cap, ex) {
  const sig = EXERCISES[ex]?.signal;
  if (!sig) return Math.floor(cap.frames / 2);
  let best = 0, bv = Infinity;
  for (let i = 0; i < cap.frames; i++) {
    const v = frameMetrics(framePoints(cap, i))[sig];
    if (v < bv) { bv = v; best = i; }
  }
  return best;
}

export async function setMyReference(ex, cap, note) { await store.saveReference({ exercise: ex, cap, note, saved: Date.now() }); }
export async function clearMyReference(ex) { await store.deleteReference(ex); }
