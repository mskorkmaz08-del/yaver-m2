// MediaPipe Pose Landmarker off the main thread (same approach as Yaver's
// hand worker). A classic worker: MediaPipe loads its wasm with importScripts.
//
// In:  { type: "init", wasm, model }   { type: "frame", bitmap, t }
// Out: { type: "ready", delegate }  { type: "error", message }
//      { type: "result", t, ms, pose: { lm: [[x,y,vis]...33], world: [[x,y,z]...33] } | null }
self.exports = {};
importScripts("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.cjs");
const { FilesetResolver, PoseLandmarker } = self.exports;

let landmarker = null;
let lastT = -1;

async function init({ wasm, model }) {
  const vision = await FilesetResolver.forVisionTasks(wasm);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let delegate = "GPU";
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, options("GPU"));
  } catch {
    delegate = "CPU";
    landmarker = await PoseLandmarker.createFromOptions(vision, options("CPU"));
  }
  self.postMessage({ type: "ready", delegate });
}

function detect({ bitmap, t }) {
  try {
    if (!landmarker || t <= lastT) return self.postMessage({ type: "result", t, ms: 0, pose: null });
    lastT = t;
    const start = performance.now();
    const r = landmarker.detectForVideo(bitmap, t);
    const ms = performance.now() - start;
    let pose = null;
    if (r.landmarks && r.landmarks.length && r.worldLandmarks && r.worldLandmarks.length) {
      pose = {
        lm: r.landmarks[0].map((p) => [p.x, p.y, p.visibility ?? 1]),
        world: r.worldLandmarks[0].map((p) => [p.x, p.y, p.z]),
      };
    }
    self.postMessage({ type: "result", t, ms, pose });
  } catch (err) {
    self.postMessage({ type: "result", t, ms: 0, pose: null, error: String(err?.message ?? err) });
  } finally {
    bitmap.close();
  }
}

self.onmessage = ({ data }) => {
  if (data.type === "init") init(data).catch((err) => self.postMessage({ type: "error", message: String(err?.message ?? err) }));
  else if (data.type === "frame") detect(data);
};
