// Webcam + MediaPipe hand tracking. The video element stays hidden; we only
// read landmarks from it.
//
// Keeping the laptop cool: the hand model runs in a worker (hand-worker.js)
// so the screen never waits for it, it only looks at new camera frames, at
// most 30 times a second (fewer while no hand is in view, and fewer still if
// the machine is struggling), and never has more than one frame queued.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
// Your hand rarely reaches the very edge of the camera frame, so the middle
// part of the frame is stretched to fill the screen. This keeps the corners
// (and the trash bin) reachable.
const EDGE_MARGIN = 0.12;
const stretch = (v) => (v - EDGE_MARGIN) / (1 - 2 * EDGE_MARGIN);

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const TRACK_HZ = 30;     // looks per second while a hand is in view
const SEARCH_HZ = 12;    // while none is: enough to notice one arriving
const SEARCH_AFTER_MS = 1500; // no hand for this long switches to searching
const HEADROOM = 1.3;    // leave the processor idle at least this share of the time

const OPTIONS = (delegate) => ({
  baseOptions: { modelAssetPath: MODEL_URL, delegate },
  runningMode: "VIDEO",
  numHands: 2,
  minHandDetectionConfidence: 0.6,
  minHandPresenceConfidence: 0.6,
  minTrackingConfidence: 0.5,
});

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.worker = null;      // the hand model in its worker…
    this.landmarker = null;  // …or on this thread, if workers can't run it
    this.loading = null;
    this.running = false;
    this.generation = 0;     // a stop() and start() leaves only the newest pump going
    this.busy = false;       // a frame is being looked at
    this.lastSent = -Infinity;
    this.lastHandAt = -Infinity;
    this.avgMs = 0;          // how long the model takes per frame
    this.fresh = null;       // the newest result not yet handed out by detect()
    this.stats = { frames: 0, delegate: null, thread: null };
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.loading ??= this.load();
    await this.loading;
    if (this.running) return;
    this.running = true;
    this.lastHandAt = performance.now(); // start out quick
    this.pump(++this.generation);
  }

  async load() {
    try {
      await new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./hand-worker.js?v=18", import.meta.url));
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") { this.stats.delegate = data.delegate; resolve(); }
          else if (data.type === "error") reject(new Error(data.message));
          else if (data.type === "result") this.onResult(data);
        };
        worker.onerror = (e) => reject(e.error ?? new Error(e.message || "hand worker failed"));
        worker.postMessage({ type: "init", wasm: WASM_URL, model: MODEL_URL });
        this.worker = worker;
      });
      this.stats.thread = "worker";
    } catch (err) {
      console.warn("Hand tracking worker unavailable, using the main thread:", err);
      this.worker?.terminate();
      this.worker = null;
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, OPTIONS("GPU"));
        this.stats.delegate = "GPU";
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(vision, OPTIONS("CPU"));
        this.stats.delegate = "CPU";
      }
      this.stats.thread = "main";
    }
  }

  // Waits for each new camera frame and passes it on when it's time.
  pump(generation) {
    const v = this.video;
    const live = () => this.running && this.generation === generation;
    if (v.requestVideoFrameCallback) {
      const onFrame = (now) => {
        if (!live()) return;
        this.offer(now);
        v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    } else {
      let lastTime = -1;
      const tick = () => {
        if (!live()) return;
        if (v.currentTime !== lastTime) { lastTime = v.currentTime; this.offer(performance.now()); }
        setTimeout(tick, 1000 / TRACK_HZ / 2);
      };
      tick();
    }
  }

  // How long to wait between looks right now.
  interval(now) {
    const hz = now - this.lastHandAt > SEARCH_AFTER_MS ? SEARCH_HZ : TRACK_HZ;
    return Math.max(1000 / hz, this.avgMs * HEADROOM);
  }

  async offer(now) {
    if (this.busy || this.video.readyState < 2 || now - this.lastSent < this.interval(now)) return;
    this.busy = true;
    this.lastSent = now;
    if (this.worker) {
      try {
        const bitmap = await createImageBitmap(this.video);
        this.worker.postMessage({ type: "frame", bitmap, t: now }, [bitmap]);
      } catch {
        this.busy = false; // the camera stopped between frames
      }
      return;
    }
    const start = performance.now();
    const result = this.landmarker.detectForVideo(this.video, now);
    this.onResult({
      t: now,
      ms: performance.now() - start,
      hands: result.landmarks.map((lm, i) => ({ id: result.handedness[i]?.[0]?.categoryName ?? `hand${i}`, landmarks: lm })),
    });
  }

  onResult({ t, ms, hands }) {
    this.busy = false;
    if (ms) this.avgMs = this.avgMs ? this.avgMs * 0.9 + ms * 0.1 : ms;
    if (!hands || !this.running) return;
    this.stats.frames++;
    if (hands.length) this.lastHandAt = t;
    const used = new Set();
    this.fresh = {
      t,
      hands: hands.map(({ id, landmarks }, i) => {
        if (used.has(id)) id = `${id}${i}`;
        used.add(id);
        return { id, landmarks: landmarks.map((p) => ({ x: stretch(1 - p.x), y: stretch(p.y), z: p.z })) };
      }),
    };
  }

  // Turns the camera off (the light goes out). start() turns it back on.
  stop() {
    this.running = false;
    this.fresh = null;
    this.video.srcObject?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }

  // The hands from the newest camera frame, once: [{ id: "Left" | "Right",
  // landmarks: [{x, y, z}...21] }], or null if nothing new has arrived.
  // `this.lastTime` is when that frame was taken (performance.now() time).
  // Coordinates are mirrored so moving your right hand right moves the cursor
  // right, and stretched so the screen edges are reachable.
  detect() {
    const fresh = this.fresh;
    if (!fresh) return null;
    this.fresh = null;
    this.lastTime = fresh.t;
    return fresh.hands;
  }
}

// One tracker (and one copy of the hand model) for the whole app: the Studio
// and the Academy take turns with the camera.
let shared = null;
export function sharedTracker(video) {
  shared ??= new HandTracker(video);
  return shared;
}
