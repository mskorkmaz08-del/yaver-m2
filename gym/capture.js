// 3D skeleton captures: compact recordings of the body (no video).
//
// A capture holds, per frame (up to ~25 fps):
//   world: 33 joints x (x, y, z) in millimetres, MediaPipe world convention
//          (hip-centred, x right, y down, z away from the camera)  -> Int16
//   root:  where the hip centre moved in the room since the first frame
//          (x, y, z mm; from the image, so z is 0)                  -> Int16
//   vis:   landmark visibility 0..100                                -> Uint8
//   t:     seconds since the capture started                         -> Float32
// About 0.3 KB per frame, ~100 KB for a 30 s set (less once gzipped).

export const FORMAT = "calicoach-capture-1";
export const JOINT_NAMES = [
  "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
  "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
  "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
  "left_heel", "right_heel", "left_foot_index", "right_foot_index",
];

/** Keeps the last few minutes of frames; slices them into captures per set. */
export class Recorder {
  constructor({ maxSec = 360, minDt = 0.04 } = {}) {
    this.frames = [];
    this.maxSec = maxSec;
    this.minDt = minDt;
    this.scale = null; // metres per image pixel (from torso length)
    this.hip0 = null;
  }
  /**
   * t: seconds; world: 33 [x,y,z] metres; lm: 33 [x,y,vis] normalised image
   * coordinates (or null); frameW/H: image size in pixels.
   */
  push(t, world, lm, frameW, frameH) {
    const last = this.frames[this.frames.length - 1];
    if (last && t - last.t < this.minDt) return;
    const w = new Int16Array(99);
    for (let j = 0; j < 33; j++) for (let k = 0; k < 3; k++) w[j * 3 + k] = clampI16(world[j][k] * 1000);
    const v = new Uint8Array(33);
    let root = [0, 0];
    if (lm) {
      for (let j = 0; j < 33; j++) v[j] = Math.round(100 * Math.max(0, Math.min(1, lm[j][2] ?? 1)));
      // root motion: hip centre in the image, scaled to metres by the torso length
      const px = (p) => [p[0] * frameW, p[1] * frameH];
      const [lhx, lhy] = px(lm[23]), [rhx, rhy] = px(lm[24]), [lsx, lsy] = px(lm[11]), [rsx, rsy] = px(lm[12]);
      const hip = [(lhx + rhx) / 2, (lhy + rhy) / 2];
      const torsoPx = Math.hypot((lsx + rsx) / 2 - hip[0], (lsy + rsy) / 2 - hip[1]);
      const sw = world;
      const torsoM = Math.hypot((sw[11][0] + sw[12][0]) / 2 - (sw[23][0] + sw[24][0]) / 2, (sw[11][1] + sw[12][1]) / 2 - (sw[23][1] + sw[24][1]) / 2);
      if (torsoPx > 20 && torsoM > 0.15) {
        const s = torsoM / torsoPx;
        this.scale = this.scale == null ? s : this.scale + 0.05 * (s - this.scale);
      }
      if (this.hip0 == null) this.hip0 = hip;
      if (this.scale) root = [(hip[0] - this.hip0[0]) * this.scale, (hip[1] - this.hip0[1]) * this.scale];
    } else v.fill(100);
    this.frames.push({ t, w, v, r: [clampI16(root[0] * 1000), clampI16(root[1] * 1000)] });
    while (this.frames.length && this.frames[0].t < t - this.maxSec) this.frames.shift();
  }
  /** Build a capture from the frames between t0 and t1 (seconds). */
  slice(t0, t1, meta = {}) {
    const fr = this.frames.filter((f) => f.t >= t0 && f.t <= t1);
    if (fr.length < 5) return null;
    const T = fr.length;
    const cap = {
      format: FORMAT, id: meta.id || `c${Date.now()}${Math.floor(Math.random() * 1e4)}`,
      exercise: meta.exercise, sessionId: meta.sessionId || null, setIndex: meta.setIndex ?? null,
      recordedAt: meta.recordedAt || Date.now(), source: meta.source || "camera",
      frames: T, fps: +(T / Math.max(0.001, fr[T - 1].t - fr[0].t)).toFixed(1),
      t: new Float32Array(T), world: new Int16Array(T * 99), root: new Int16Array(T * 3), vis: new Uint8Array(T * 33),
      reps: [], summary: meta.summary || null,
    };
    const r0 = fr[0].r;
    fr.forEach((f, i) => {
      cap.t[i] = f.t - fr[0].t;
      cap.world.set(f.w, i * 99);
      cap.root[i * 3] = f.r[0] - r0[0]; cap.root[i * 3 + 1] = f.r[1] - r0[1];
      cap.vis.set(f.v, i * 33);
    });
    cap.t0 = fr[0].t; // session clock at the first frame (not stored)
    return cap;
  }
  reset() { this.frames = []; this.hip0 = null; this.scale = null; }
}

const clampI16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v)));

/** Joint positions of frame i in metres: 33 x [x,y,z], MediaPipe world convention, plus the root offset when withRoot. */
export function framePoints(cap, i, withRoot = false) {
  const o = i * 99, out = new Array(33);
  const rx = withRoot ? cap.root[i * 3] : 0, ry = withRoot ? cap.root[i * 3 + 1] : 0, rz = withRoot ? cap.root[i * 3 + 2] : 0;
  for (let j = 0; j < 33; j++) out[j] = [(cap.world[o + j * 3] + rx) / 1000, (cap.world[o + j * 3 + 1] + ry) / 1000, (cap.world[o + j * 3 + 2] + rz) / 1000];
  return out;
}

/** Frame index at time t (seconds since capture start). */
export function frameAt(cap, t) {
  let lo = 0, hi = cap.frames - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cap.t[m] <= t) lo = m; else hi = m - 1; }
  return lo;
}

/** Sub-capture covering [t0, t1] seconds (e.g. one rep). */
export function subCapture(cap, t0, t1) {
  const a = frameAt(cap, t0), b = Math.max(a + 1, frameAt(cap, t1));
  const T = b - a + 1;
  const ra = [cap.root[a * 3], cap.root[a * 3 + 1], cap.root[a * 3 + 2]];
  const out = { ...cap, frames: T, t: new Float32Array(T), world: cap.world.slice(a * 99, (b + 1) * 99), vis: cap.vis.slice(a * 33, (b + 1) * 33), root: new Int16Array(T * 3) };
  for (let i = 0; i < T; i++) {
    out.t[i] = cap.t[a + i] - cap.t[a];
    for (let k = 0; k < 3; k++) out.root[i * 3 + k] = cap.root[(a + i) * 3 + k] - ra[k];
  }
  return out;
}

// ---------- portable JSON (for upload / export / references)
const b64 = (buf) => {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (str, Type) => {
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
};

export function toJSON(cap) {
  const { t, world, root, vis, t0, ...meta } = cap;
  return {
    ...meta, format: FORMAT, joints: JOINT_NAMES,
    encoding: { world: "int16 little-endian, mm, [frame][joint][xyz], MediaPipe world (x right, y down, z away)", root: "int16 mm [frame][xyz]", vis: "uint8 0-100", t: "float32 seconds" },
    t_b64: b64(t), world_b64: b64(world), root_b64: b64(root), vis_b64: b64(vis),
  };
}
export function fromJSON(j) {
  const { t_b64, world_b64, root_b64, vis_b64, encoding, joints, ...meta } = j;
  return { ...meta, t: unb64(t_b64, Float32Array), world: unb64(world_b64, Int16Array), root: unb64(root_b64, Int16Array), vis: unb64(vis_b64, Uint8Array) };
}

/** gzip a string to a Blob (falls back to plain JSON where CompressionStream is missing). */
export async function gzipBlob(text) {
  if (typeof CompressionStream === "undefined") return { blob: new Blob([text], { type: "application/json" }), gz: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return { blob: await new Response(stream).blob(), gz: true };
}
export async function gunzipText(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return blob.text();
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
