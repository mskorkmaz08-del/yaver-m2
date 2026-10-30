// Runs the MediaPipe hand model off the main thread, so the screen never
// waits for it. A classic worker (not a module): MediaPipe loads its wasm
// with importScripts, which module workers don't have. Its CommonJS build
// only needs an `exports` object to land in.
//
// Messages in:  { type: "init", wasm, model }   { type: "frame", bitmap, t }
// Messages out: { type: "ready", delegate }      { type: "error", message }
//               { type: "result", t, ms, hands: [{ id, landmarks }] }
self.exports = {};
importScripts("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.cjs");
const { FilesetResolver, HandLandmarker } = self.exports;

let landmarker = null;
let lastT = -1;

async function init({ wasm, model }) {
  const vision = await FilesetResolver.forVisionTasks(wasm);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  let delegate = "GPU";
  try {
    landmarker = await HandLandmarker.createFromOptions(vision, options("GPU"));
  } catch {
    delegate = "CPU";
    landmarker = await HandLandmarker.createFromOptions(vision, options("CPU"));
  }
  self.postMessage({ type: "ready", delegate });
}

function detect({ bitmap, t }) {
  try {
    if (!landmarker || t <= lastT) return self.postMessage({ type: "result", t, ms: 0, hands: null });
    lastT = t;
    const start = performance.now();
    const result = landmarker.detectForVideo(bitmap, t);
    const ms = performance.now() - start;
    const hands = result.landmarks.map((lm, i) => ({
      id: result.handedness[i]?.[0]?.categoryName ?? `hand${i}`,
      landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    }));
    self.postMessage({ type: "result", t, ms, hands });
  } catch (err) {
    self.postMessage({ type: "result", t, ms: 0, hands: null, error: String(err?.message ?? err) });
  } finally {
    bitmap.close();
  }
}

self.onmessage = ({ data }) => {
  if (data.type === "init") init(data).catch((err) => self.postMessage({ type: "error", message: String(err?.message ?? err) }));
  else if (data.type === "frame") detect(data);
};
