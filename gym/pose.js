// Pose source: runs MediaPipe Pose Landmarker on a <video>, in a worker when
// the browser allows it, otherwise on the main thread.
const VERSION = "0.10.14";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
export const MODEL_URLS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
};

export class PoseSource {
  constructor(modelName = "full") {
    this.modelUrl = MODEL_URLS[modelName] || MODEL_URLS.full;
    this.worker = null;
    this.landmarker = null;
    this.busy = false;
    this.stats = { delegate: null, thread: null, ms: 0 };
    this.pending = null;
  }

  async init() {
    if (typeof Worker !== "undefined" && typeof createImageBitmap === "function" && typeof OffscreenCanvas !== "undefined") {
      try {
        await this.initWorker();
        return;
      } catch (e) {
        console.warn("pose worker failed, using main thread", e);
        this.worker?.terminate();
        this.worker = null;
      }
    }
    await this.initMain();
  }

  initWorker() {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL("./pose-worker.js", import.meta.url));
      const timer = setTimeout(() => reject(new Error("worker init timeout")), 45000);
      w.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timer);
          this.stats.delegate = data.delegate;
          this.stats.thread = "worker";
          this.worker = w;
          w.onmessage = ({ data: d }) => this.onWorkerResult(d);
          resolve();
        } else if (data.type === "error") {
          clearTimeout(timer);
          reject(new Error(data.message));
        }
      };
      w.onerror = (e) => { clearTimeout(timer); reject(e); };
      w.postMessage({ type: "init", wasm: WASM_URL, model: this.modelUrl });
    });
  }

  async initMain() {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: this.modelUrl, delegate },
      runningMode: "VIDEO", numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, opts("GPU"));
      this.stats.delegate = "GPU";
    } catch {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, opts("CPU"));
      this.stats.delegate = "CPU";
    }
    this.stats.thread = "main";
  }

  onWorkerResult(d) {
    this.busy = false;
    if (d.ms) this.stats.ms = d.ms;
    const cb = this.pending;
    this.pending = null;
    if (cb) cb(d.pose);
  }

  /**
   * Detect the pose in the current video frame. MediaPipe needs strictly
   * increasing timestamps for the whole life of the model (across workouts),
   * so it gets its own clock. Calls cb(pose|null) when done; returns false if
   * still busy.
   */
  detect(video, cb) {
    if (this.busy) return false;
    this.busy = true;
    const tMs = (this.clock = Math.max((this.clock || 0) + 1, Math.round(performance.now())));
    if (this.worker) {
      this.pending = cb;
      createImageBitmap(video).then(
        (bitmap) => this.worker.postMessage({ type: "frame", bitmap, t: tMs }, [bitmap]),
        () => { this.busy = false; this.pending = null; },
      );
      return true;
    }
    try {
      const start = performance.now();
      const r = this.landmarker.detectForVideo(video, tMs);
      this.stats.ms = performance.now() - start;
      let pose = null;
      if (r.landmarks?.length && r.worldLandmarks?.length) {
        pose = {
          lm: r.landmarks[0].map((p) => [p.x, p.y, p.visibility ?? 1]),
          world: r.worldLandmarks[0].map((p) => [p.x, p.y, p.z]),
        };
      }
      cb(pose);
    } catch (e) {
      cb(null);
    } finally {
      this.busy = false;
    }
    return true;
  }

  close() {
    this.worker?.terminate();
    this.landmarker?.close?.();
  }
}

// ---------- drawing
export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
  [15, 19], [16, 20],
];
// joints to highlight for each fault
export const FAULT_JOINTS = {
  hip_sag: [23, 24], hip_pike: [23, 24], hips_low: [23, 24], partial_depth: [13, 14, 25, 26],
  no_lockout: [13, 14, 25, 26], elbow_flare: [13, 14], chin_below_bar: [0], kipping: [23, 24, 25, 26],
  excess_lean: [11, 12], swinging: [27, 28], knee_valgus: [25, 26], bent_knees: [25, 26], rushed: [],
};

/**
 * Draw the skeleton. lm: 33 x [x, y, vis] normalised to the frame.
 * Maps the frame (fw x fh) into the canvas with "contain" fitting.
 */
export function drawPose(ctx, lm, fw, fh, { highlight = [], color = "#4cc9ff", glow = true } = {}) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const s = Math.min(cw / fw, ch / fh);
  const ox = (cw - fw * s) / 2, oy = (ch - fh * s) / 2;
  const P = (i) => [ox + lm[i][0] * fw * s, oy + lm[i][1] * fh * s];
  const hl = new Set(highlight);
  const lw = Math.max(3, Math.min(cw, ch) / 110);
  ctx.lineCap = "round";
  ctx.save();
  if (glow) { ctx.shadowColor = "rgba(76,201,255,0.85)"; ctx.shadowBlur = lw * 3; }
  for (const [a, b] of CONNECTIONS) {
    if (lm[a][2] < 0.3 || lm[b][2] < 0.3) continue;
    const [x1, y1] = P(a), [x2, y2] = P(b);
    ctx.strokeStyle = hl.has(a) || hl.has(b) ? "#f87171" : color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 33; i++) {
    if (i > 0 && i < 11) continue;
    if (lm[i][2] < 0.3) continue;
    const [x, y] = P(i);
    ctx.fillStyle = hl.has(i) ? "#f87171" : "#e8f7ff";
    ctx.beginPath(); ctx.arc(x, y, hl.has(i) ? lw * 1.6 : lw * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
