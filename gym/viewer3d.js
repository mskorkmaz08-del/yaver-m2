// 3D viewer for skeleton captures: a lit mannequin in plain WebGL (no
// libraries, works offline), with floor shadows, equipment, orbit/pinch
// camera, angle labels, movement trails and a "perfect form" ghost that is
// rebuilt with the user's own bone lengths.
import { EXERCISES, frameMetrics } from "./engine.js";
import { framePoints } from "./capture.js";

// ------------------------------------------------------------ small maths
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
function perpTo(axis, hint) {
  let p = V.sub(hint, V.mul(axis, V.dot(hint, axis)));
  if (V.len(p) < 1e-4) p = V.sub([1, 0, 0], V.mul(axis, axis[0]));
  if (V.len(p) < 1e-4) p = V.sub([0, 0, 1], V.mul(axis, axis[2]));
  return V.norm(p);
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye, at, up) {
  const z = V.norm(V.sub(eye, at)), x = V.norm(V.cross(up, z)), y = V.cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]);
}
function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const toRender = (p) => [p[0], -p[1], -p[2]]; // MediaPipe (y down, z away) -> y up
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ------------------------------------------------------------ shaders
const LIGHT_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vN; varying vec3 vW;
uniform vec3 uColor; uniform float uAlpha; uniform vec3 uEye; uniform float uRim;
void main() {
  vec3 N = normalize(vN);
  vec3 Vd = normalize(uEye - vW);
  if (dot(N, Vd) < 0.0) N = -N;
  vec3 L1 = normalize(vec3(-0.45, 0.85, 0.55));
  vec3 L2 = normalize(vec3(0.7, 0.35, -0.4));
  float d1 = max(dot(N, L1), 0.0), d2 = max(dot(N, L2), 0.0);
  float hemi = 0.5 + 0.5 * N.y;
  vec3 amb = mix(vec3(0.16, 0.15, 0.14), vec3(0.42, 0.46, 0.52), hemi);
  vec3 H = normalize(L1 + Vd);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * 0.35;
  float rim = pow(1.0 - max(dot(N, Vd), 0.0), 3.0) * uRim;
  vec3 col = uColor * (amb + d1 * vec3(1.0, 0.97, 0.92) * 0.95 + d2 * vec3(0.55, 0.65, 0.8) * 0.35) + spec + rim * vec3(0.7, 0.85, 1.0);
  col = pow(col, vec3(1.0 / 1.15));
  gl_FragColor = vec4(col, uAlpha);
}`;
const ELLIP_VS = `
attribute vec3 aPos;
uniform mat4 uVP; uniform vec3 uC; uniform mat3 uB; uniform mat3 uBN;
varying vec3 vN; varying vec3 vW;
void main() { vec3 w = uC + uB * aPos; vW = w; vN = uBN * aPos; gl_Position = uVP * vec4(w, 1.0); }`;
const FRUS_VS = `
attribute vec2 aTC;
uniform mat4 uVP; uniform vec3 uP0; uniform vec3 uP1; uniform vec3 uLat; uniform vec3 uDep; uniform vec2 uR0; uniform vec2 uR1;
varying vec3 vN; varying vec3 vW;
void main() {
  float t = aTC.x, th = aTC.y;
  vec2 r = mix(uR0, uR1, t);
  vec3 ax = uP1 - uP0; float L = max(length(ax), 1e-4); ax /= L;
  vec3 w = mix(uP0, uP1, t) + cos(th) * uLat * r.x + sin(th) * uDep * r.y;
  float slope = ((uR0.x + uR0.y) - (uR1.x + uR1.y)) * 0.5 / L;
  vN = normalize(cos(th) * uLat / r.x + sin(th) * uDep / r.y) + ax * slope;
  vW = w; gl_Position = uVP * vec4(w, 1.0);
}`;
const FLOOR_VS = `
attribute vec2 aXZ; uniform mat4 uVP; uniform float uY; uniform vec2 uC; varying vec2 vP;
void main() { vec2 p = uC + aXZ * 6.0; vP = p; gl_Position = uVP * vec4(p.x, uY, p.y, 1.0); }`;
const FLOOR_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vP; uniform vec2 uC; uniform vec4 uSh[28];
void main() {
  float r = length(vP - uC);
  float fade = smoothstep(5.5, 1.0, r);
  vec2 g = abs(fract(vP * 2.0 - 0.5) - 0.5) / fwidthSafe(vP * 2.0);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float sh = 0.0;
  for (int i = 0; i < 28; i++) {
    vec4 s = uSh[i];
    if (s.z <= 0.0) continue;
    float d = length(vP - s.xy) / (s.z * (1.0 + s.w * 1.6));
    sh += exp(-d * d * 2.2) * 0.55 / (1.0 + s.w * 3.0);
  }
  sh = min(sh, 0.75);
  vec3 base = vec3(0.085, 0.1, 0.115) + line * 0.05;
  vec3 col = base * (1.0 - sh);
  gl_FragColor = vec4(col, fade);
}`.replace("fwidthSafe(vP * 2.0)", "vec2(0.02)");

// ------------------------------------------------------------ meshes
function sphereMesh(n = 28, m = 20) {
  const pos = [], idx = [];
  for (let i = 0; i <= m; i++) {
    const v = (i / m) * Math.PI;
    for (let j = 0; j <= n; j++) {
      const u = (j / n) * Math.PI * 2;
      pos.push(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    }
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
    const a = i * (n + 1) + j, b = a + n + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
}
function tubeMesh(n = 28, rings = 6) {
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= n; j++) pos.push(i / rings, (j / n) * Math.PI * 2);
  for (let i = 0; i < rings; i++) for (let j = 0; j < n; j++) {
    const a = i * (n + 1) + j, b = a + n + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
}

// ------------------------------------------------------------ body model
const SUPPORT = { push_up: "feet", pike_push_up: "feet", plank: "feet", squat: "feet", lunge: "feet", inverted_row: "feet", pull_up: "hands", hanging_leg_raise: "hands", dip: "hands" };
const BAR = { pull_up: "bar", hanging_leg_raise: "bar", inverted_row: "bar", dip: "dip" };
// skeleton tree used to rebuild the reference with the user's bone lengths
const TREE = [
  ["hc", 23], ["hc", 24], [23, 25], [25, 27], [27, 29], [27, 31], [24, 26], [26, 28], [28, 30], [28, 32],
  ["hc", "sc"], ["sc", 11], ["sc", 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  ["sc", 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [0, 10],
];
const getP = (P, k) => (k === "hc" ? V.mid(P[23], P[24]) : k === "sc" ? V.mid(P[11], P[12]) : P[k]);

export class Viewer3D {
  constructor(canvas, { onFrame = () => {}, labelEl = null } = {}) {
    this.c = canvas;
    this.onFrame = onFrame;
    this.labelEl = labelEl;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL not available");
    this.gl = gl;
    gl.getExtension("OES_standard_derivatives");
    this.progE = this.program(ELLIP_VS, LIGHT_FS);
    this.progF = this.program(FRUS_VS, LIGHT_FS);
    this.progG = this.program(FLOOR_VS, FLOOR_FS);
    this.sphere = this.mesh(sphereMesh(), 3);
    this.tube = this.mesh(tubeMesh(), 2);
    this.quad = this.mesh({ pos: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), idx: new Uint16Array([0, 1, 2, 0, 2, 3]) }, 2);
    this.cam = { yaw: -Math.PI / 2, pitch: 0.18, dist: 3.2, target: [0, 0.2, 0] };
    this.i = 0; this.playing = false; this.speed = 0.5; this.loop = true;
    this.showGhost = true; this.showTrail = true;
    this.bindControls();
    this.resize();
    this._ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { this.resize(); this.draw(); }) : null;
    this._ro?.observe(canvas);
  }

  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace("[0]", ""); u[name] = gl.getUniformLocation(p, name); }
    return { p, u, a: gl.getAttribLocation(p, gl.getActiveAttrib(p, 0).name) };
  }
  mesh(m, size) {
    const gl = this.gl;
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    return { vb, ib, n: m.idx.length, size };
  }
  use(prog, mesh) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
    gl.enableVertexAttribArray(prog.a); gl.vertexAttribPointer(prog.a, mesh.size, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(prog.u.uVP, false, this.vp);
  }

  // ---------------------------------------------------------- data
  /**
   * cap: capture (one rep or a set). opts: { exercise, highlight: joint ids,
   * reference: capture of a perfect rep, keyUser / keyRef: index of the key
   * frame (deepest point) in each }.
   */
  setCapture(cap, opts = {}) {
    this.cap = cap;
    this.ex = opts.exercise || cap.exercise;
    this.hl = new Set(opts.highlight || []);
    this.frames = [];
    for (let i = 0; i < cap.frames; i++) this.frames.push(framePoints(cap, i, true).map(toRender));
    // body size from the median torso length
    const torsos = this.frames.map((P) => V.len(V.sub(V.mid(P[11], P[12]), V.mid(P[23], P[24])))).sort((a, b) => a - b);
    this.L = torsos[Math.floor(torsos.length / 2)] || 0.5;
    this.boneLen = this.measureBones(this.frames);
    // floor = lowest point over the capture (feet, or hands/knees for floor work)
    let minY = Infinity, cx = 0, cz = 0;
    for (const P of this.frames) for (const j of [27, 28, 29, 30, 31, 32, 15, 16, 25, 26]) minY = Math.min(minY, P[j][1]);
    for (const P of this.frames) { const h = V.mid(P[23], P[24]); cx += h[0]; cz += h[2]; }
    this.floorY = SUPPORT[this.ex] === "hands" ? minY - 0.05 : minY - 0.03;
    this.center = [cx / this.frames.length, 0, cz / this.frames.length];
    let maxY = -Infinity;
    for (const P of this.frames) for (const p of P) maxY = Math.max(maxY, p[1]);
    this.cam.target = [this.center[0], (this.floorY + maxY) / 2, this.center[2]];
    let span = 0;
    for (const P of this.frames) for (const p of P) span = Math.max(span, Math.hypot(p[0] - this.center[0], p[2] - this.center[2]));
    this.cam.dist = Math.max(1.6, Math.max(maxY - this.floorY, span * 1.6) * 1.35 + 0.35);
    this.equipment = this.makeEquipment();
    this.keyUser = opts.keyUser ?? 0;
    this.ref = opts.reference ? this.retarget(opts.reference, opts.keyRef ?? 0) : null;
    this.i = 0;
    this.draw();
  }

  measureBones(frames) {
    const lens = {};
    for (const [a, b] of TREE) {
      const vals = frames.map((P) => V.len(V.sub(getP(P, b), getP(P, a)))).sort((x, y) => x - y);
      lens[`${a}-${b}`] = vals[Math.floor(vals.length / 2)];
    }
    return lens;
  }

  /** Rebuild the reference rep with the user's bone lengths, face the same way, share the support point and timing. */
  retarget(refCap, keyRef) {
    const raw = [];
    for (let i = 0; i < refCap.frames; i++) raw.push(framePoints(refCap, i, true).map(toRender));
    const yawOf = (P) => { const d = V.sub(P[23], P[24]); return Math.atan2(d[2], d[0]); };
    const rot = yawOf(this.frames[0]) - yawOf(raw[0]);
    const c = Math.cos(rot), s = Math.sin(rot);
    const out = raw.map((P) => {
      const R = P.map((p) => [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c]); // rotate about vertical by +rot (angles measured as atan2(z, x))
      const N = new Array(33);
      const hc = V.mid(R[23], R[24]);
      const pts = { hc };
      for (const [a, b] of TREE) {
        const pa = a === "hc" ? pts.hc : a === "sc" ? pts.sc : N[a];
        const dir = V.norm(V.sub(getP(R, b), getP(R, a)));
        const q = V.add(pa, V.mul(dir, this.boneLen[`${a}-${b}`]));
        if (b === "sc") pts.sc = q; else N[b] = q;
      }
      // keep the hip points symmetric around the rebuilt centre
      return N;
    });
    // fix rotation sign if the reference ended up facing away
    const facing = (P) => V.norm(V.cross(V.sub(P[11], P[12]), V.sub(V.mid(P[11], P[12]), V.mid(P[23], P[24]))));
    const f0 = facing(this.frames[0]), f1 = facing(out[0]);
    if (V.dot([f0[0], 0, f0[2]], [f1[0], 0, f1[2]]) < 0 && Math.abs(f0[1]) < 0.8) {
      for (const P of out) for (let j = 0; j < 33; j++) { const h = V.mid(P[23], P[24]); const d = V.sub(P[j], h); P[j] = [h[0] - d[0], P[j][1], h[2] - d[2]]; }
    }
    // shared support point (feet or hands) frame by frame
    const support = (P) => (SUPPORT[this.ex] === "hands" ? V.mid(P[15], P[16]) : V.mid(P[27], P[28]));
    const T = this.frames.length, Tr = out.length, ku = this.keyUser, kr = keyRef;
    const map = (i) => { // piecewise-linear time alignment through the key frames
      if (i <= ku) return ku ? (i / ku) * kr : 0;
      return kr + ((i - ku) / Math.max(1, T - 1 - ku)) * (Tr - 1 - kr);
    };
    const aligned = [];
    const anchorU = support(this.frames[0]);
    const anchorR = support(out[0]);
    for (let i = 0; i < T; i++) {
      const f = map(i), a = Math.floor(f), b = Math.min(Tr - 1, a + 1), w = f - a;
      const P = out[a].map((p, j) => V.lerp(p, out[b][j], w));
      const shift = V.sub(anchorU, anchorR);
      aligned.push(P.map((p) => V.add(p, shift)));
    }
    return aligned;
  }

  makeEquipment() {
    const kind = BAR[this.ex];
    if (!kind) return [];
    let lw = [0, 0, 0], rw = [0, 0, 0];
    for (const P of this.frames) { lw = V.add(lw, P[15]); rw = V.add(rw, P[16]); }
    lw = V.mul(lw, 1 / this.frames.length); rw = V.mul(rw, 1 / this.frames.length);
    const r = 0.017;
    if (kind === "bar") {
      const d = V.norm(V.sub(lw, rw));
      const y = (lw[1] + rw[1]) / 2 + 0.025;
      const a = V.add([lw[0], y, lw[2]], V.mul(d, 0.35)), b = V.sub([rw[0], y, rw[2]], V.mul(d, 0.35));
      return [{ p0: a, p1: b, r }];
    }
    // dip bars: two parallel bars along the facing direction
    const P = this.frames[0];
    const fwd = V.norm(V.cross([0, 1, 0], V.sub(P[11], P[12])));
    return [lw, rw].map((w) => ({ p0: V.add(V.add(w, [0, -0.02, 0]), V.mul(fwd, 0.4)), p1: V.sub(V.add(w, [0, -0.02, 0]), V.mul(fwd, 0.35)), r: 0.02 }));
  }

  // ---------------------------------------------------------- drawing
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.c.clientWidth * dpr)), h = Math.max(1, Math.round(this.c.clientHeight * dpr));
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
  }
  eye() {
    const { yaw, pitch, dist, target } = this.cam;
    return [target[0] + dist * Math.cos(pitch) * Math.cos(yaw), target[1] + dist * Math.sin(pitch), target[2] + dist * Math.cos(pitch) * Math.sin(yaw)];
  }
  setView(name) {
    const P = this.frames?.[0];
    let side = 0;
    if (P) { const d = V.sub(P[11], P[12]); side = Math.atan2(d[2], d[0]); }
    const v = { side: [side, 0.12], front: [side + Math.PI / 2, 0.1], three: [side + Math.PI / 4, 0.32], top: [side, 1.35] }[name];
    if (!v) return;
    // "front" must look at the chest: flip if we're behind the person
    let yaw = v[0];
    if (name === "front" && P) {
      const chest = V.norm(V.cross(V.sub(P[11], P[12]), V.sub(V.mid(P[11], P[12]), V.mid(P[23], P[24]))));
      if (Math.cos(yaw) * chest[0] + Math.sin(yaw) * chest[2] < 0) yaw += Math.PI;
    }
    this.cam.yaw = yaw; this.cam.pitch = v[1];
    this.draw();
  }

  ellip(center, basis, radii, color, alpha) {
    const gl = this.gl, u = this.progE.u;
    const B = new Float32Array(9), BN = new Float32Array(9);
    for (let k = 0; k < 3; k++) for (let r = 0; r < 3; r++) { B[k * 3 + r] = basis[k][r] * radii[k]; BN[k * 3 + r] = basis[k][r] / radii[k]; }
    gl.uniform3fv(u.uC, center); gl.uniformMatrix3fv(u.uB, false, B); gl.uniformMatrix3fv(u.uBN, false, BN);
    gl.uniform3fv(u.uColor, color); gl.uniform1f(u.uAlpha, alpha);
    gl.drawElements(gl.TRIANGLES, this.sphere.n, gl.UNSIGNED_SHORT, 0);
  }
  sph(center, r, color, alpha) { this.ellip(center, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [r, r, r], color, alpha); }
  frus(p0, p1, r0, r1, color, alpha, latHint = null) {
    const gl = this.gl, u = this.progF.u;
    const ax = V.norm(V.sub(p1, p0));
    const lat = perpTo(ax, latHint || [0.3, 0.9, 0.2]);
    const dep = V.cross(ax, lat);
    const R0 = Array.isArray(r0) ? r0 : [r0, r0], R1 = Array.isArray(r1) ? r1 : [r1, r1];
    gl.uniform3fv(u.uP0, p0); gl.uniform3fv(u.uP1, p1); gl.uniform3fv(u.uLat, lat); gl.uniform3fv(u.uDep, dep);
    gl.uniform2fv(u.uR0, R0); gl.uniform2fv(u.uR1, R1);
    gl.uniform3fv(u.uColor, color); gl.uniform1f(u.uAlpha, alpha);
    gl.drawElements(gl.TRIANGLES, this.tube.n, gl.UNSIGNED_SHORT, 0);
  }

  /** Body parts for one frame: [{type, ...geometry, joints}] */
  parts(P) {
    const L = this.L;
    const sc = V.mid(P[11], P[12]), hc = V.mid(P[23], P[24]);
    const spine = V.norm(V.sub(sc, hc));
    const lat = perpTo(spine, V.sub(P[11], P[12]));
    const dep = V.cross(spine, lat);
    const sw = V.len(V.sub(P[11], P[12])), hw = V.len(V.sub(P[23], P[24]));
    const head = V.mid(P[7], P[8]);
    const neckTop = V.lerp(sc, head, 0.55);
    const hand = (w, a, b) => V.lerp(w, V.mid(P[a], P[b]), 0.9);
    const out = [
      // torso: elliptical tapered body from pelvis to chest
      { f: [V.add(hc, V.mul(spine, -0.08 * L)), V.add(sc, V.mul(spine, -0.02 * L)), [hw / 2 + 0.07 * L, 0.17 * L], [sw / 2 + 0.02 * L, 0.19 * L], lat], j: [11, 12, 23, 24] },
      { e: [V.add(hc, V.mul(spine, -0.04 * L)), [lat, spine, dep], [hw / 2 + 0.085 * L, 0.16 * L, 0.18 * L]], j: [23, 24] },
      { e: [V.add(sc, V.mul(spine, -0.08 * L)), [lat, spine, dep], [sw / 2 + 0.01 * L, 0.15 * L, 0.2 * L]], j: [11, 12] },
      { f: [sc, neckTop, 0.085 * L, 0.075 * L], j: [] },
      // head: ellipsoid oriented by the face (nose) direction
      { head: [head, P[0]], j: [0] },
      // shoulders
      { s: [P[11], 0.105 * L], j: [11] }, { s: [P[12], 0.105 * L], j: [12] },
    ];
    for (const [s, e, w, a, b, side] of [[11, 13, 15, 19, 17, "l"], [12, 14, 16, 20, 18, "r"]]) {
      out.push({ f: [P[s], P[e], 0.09 * L, 0.07 * L], j: [s, e], side });
      out.push({ s: [P[e], 0.068 * L], j: [e], side });
      out.push({ f: [P[e], P[w], 0.068 * L, 0.048 * L], j: [e, w], side });
      out.push({ s: [P[w], 0.048 * L], j: [w], side });
      out.push({ f: [P[w], hand(P[w], a, b), [0.05 * L, 0.028 * L], [0.055 * L, 0.024 * L], null, V.sub(P[a], P[b])], j: [w], side });
    }
    for (const [h, k, a, heel, toe, side] of [[23, 25, 27, 29, 31, "l"], [24, 26, 28, 30, 32, "r"]]) {
      out.push({ s: [P[h], 0.12 * L], j: [h], side });
      out.push({ f: [P[h], P[k], 0.125 * L, 0.082 * L], j: [h, k], side });
      out.push({ s: [P[k], 0.08 * L], j: [k], side });
      out.push({ f: [P[k], P[a], 0.08 * L, 0.052 * L], j: [k, a], side });
      out.push({ s: [P[a], 0.052 * L], j: [a], side });
      out.push({ f: [P[heel], P[toe], [0.045 * L, 0.035 * L], [0.05 * L, 0.022 * L], null, [0, 1, 0]], j: [a], side });
    }
    return out;
  }

  drawBody(P, { ghost = false } = {}) {
    const alpha = ghost ? 0.32 : 1;
    const base = ghost ? hexRGB("#5fb4ff") : hexRGB("#e6e9ee");
    const left = ghost ? hexRGB("#7cc4ff") : hexRGB("#cfe98f");
    const bad = hexRGB("#ff5a5a");
    const parts = this.parts(P);
    const color = (pt) => (!ghost && pt.j.some((j) => this.hl.has(j)) ? bad : pt.side === "l" ? left : base);
    const gl = this.gl;
    this.use(this.progE, this.sphere);
    gl.uniform3fv(this.progE.u.uEye, this.eyeP); gl.uniform1f(this.progE.u.uRim, ghost ? 0.6 : 0.25);
    for (const pt of parts) {
      if (pt.s) this.sph(pt.s[0], pt.s[1], color(pt), alpha);
      else if (pt.e) this.ellip(pt.e[0], pt.e[1], pt.e[2], color(pt), alpha);
      else if (pt.head) {
        const [c, nose] = pt.head;
        const sc = V.mid(P[11], P[12]);
        const up = V.norm(V.sub(c, sc));
        const face = perpTo(up, V.sub(nose, c));
        const side = V.cross(up, face);
        const L = this.L;
        this.ellip(V.add(c, V.mul(up, 0.04 * L)), [side, up, face], [0.15 * L, 0.2 * L, 0.17 * L], color(pt), alpha);
        if (!ghost) this.ellip(V.add(V.add(c, V.mul(face, 0.13 * L)), V.mul(up, 0.05 * L)), [side, up, face], [0.1 * L, 0.045 * L, 0.05 * L], hexRGB("#2a3138"), 1);
      }
    }
    this.use(this.progF, this.tube);
    gl.uniform3fv(this.progF.u.uEye, this.eyeP); gl.uniform1f(this.progF.u.uRim, ghost ? 0.6 : 0.25);
    for (const pt of parts) if (pt.f) this.frus(pt.f[0], pt.f[1], pt.f[2], pt.f[3], color(pt), alpha, pt.f[4] || pt.f[5] || null);
  }

  drawFloor(P) {
    const gl = this.gl, u = this.progG.u;
    this.use(this.progG, this.quad);
    gl.uniform1f(u.uY, this.floorY);
    gl.uniform2fv(u.uC, [this.center[0], this.center[2]]);
    const sh = new Float32Array(28 * 4);
    const js = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
    js.forEach((j, k) => {
      const p = P[j];
      sh.set([p[0], p[2], j >= 27 ? 0.07 : 0.1, Math.max(0, p[1] - this.floorY)], k * 4);
    });
    const hc = V.mid(P[23], P[24]), sc = V.mid(P[11], P[12]);
    sh.set([hc[0], hc[2], 0.16, Math.max(0, hc[1] - this.floorY)], js.length * 4);
    sh.set([sc[0], sc[2], 0.16, Math.max(0, sc[1] - this.floorY)], (js.length + 1) * 4);
    gl.uniform4fv(u.uSh, sh);
    gl.drawElements(gl.TRIANGLES, this.quad.n, gl.UNSIGNED_SHORT, 0);
  }

  drawTrail() {
    if (!this.showTrail) return;
    const key = { pull_up: 0, hanging_leg_raise: 27, squat: "hc", lunge: "hc", dip: "sc", push_up: "sc", pike_push_up: 0, inverted_row: "sc" }[this.ex];
    if (key === undefined) return;
    const gl = this.gl;
    this.use(this.progE, this.sphere);
    gl.uniform3fv(this.progE.u.uEye, this.eyeP); gl.uniform1f(this.progE.u.uRim, 0);
    const step = Math.max(1, Math.floor(this.frames.length / 45));
    for (let i = 0; i <= this.i; i += step) {
      const p = getP(this.frames[i], key);
      const age = (this.i - i) / Math.max(1, this.frames.length);
      this.sph(p, 0.012, hexRGB("#c8f560"), Math.max(0.15, 0.9 - age * 1.2));
    }
  }

  draw() {
    if (!this.frames?.length) return;
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.c.width, this.c.height);
    gl.clearColor(0.055, 0.07, 0.085, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.eyeP = this.eye();
    const proj = perspective(0.75, this.c.width / this.c.height, 0.05, 50);
    this.vp = mat4mul(proj, lookAt(this.eyeP, this.cam.target, [0, 1, 0]));
    const P = this.frames[this.i];
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    this.drawFloor(P);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    // equipment
    if (this.equipment.length) {
      this.use(this.progF, this.tube);
      gl.uniform3fv(this.progF.u.uEye, this.eyeP); gl.uniform1f(this.progF.u.uRim, 0.2);
      for (const b of this.equipment) this.frus(b.p0, b.p1, b.r, b.r, hexRGB("#8b96a5"), 1);
    }
    this.drawBody(P);
    this.drawTrail();
    if (this.ref && this.showGhost) {
      gl.depthMask(false);
      this.drawBody(this.ref[this.i], { ghost: true });
      gl.depthMask(true);
    }
    this.updateLabels(P);
    this.onFrame(this.i);
  }

  /** Project a 3D point to CSS pixels of the canvas. */
  project(p) {
    const m = this.vp;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [((x / w) * 0.5 + 0.5) * this.c.clientWidth, (1 - ((y / w) * 0.5 + 0.5)) * this.c.clientHeight];
  }
  updateLabels(P) {
    if (!this.labelEl) return;
    const spec = EXERCISES[this.ex];
    if (!spec?.signal) { this.labelEl.innerHTML = ""; return; }
    const joint = { elbow: [13, 14], knee: [25, 26], knee_front: [25, 26], hip: [23, 24] }[spec.signal];
    // angles from the frame (metres, any convention: angles are the same)
    const m = frameMetrics(P.map((p) => [p[0], -p[1], -p[2]]));
    const val = m[spec.signal];
    const near = V.dot(V.sub(P[joint[0]], this.eyeP), V.sub(P[joint[0]], this.eyeP)) < V.dot(V.sub(P[joint[1]], this.eyeP), V.sub(P[joint[1]], this.eyeP)) ? joint[0] : joint[1];
    const [x, y] = this.project(P[near]);
    let html = `<span class="lbl" style="left:${x}px;top:${y}px">${Math.round(val)}°</span>`;
    if (this.ref && this.showGhost) {
      const R = this.ref[this.i];
      const mr = frameMetrics(R.map((p) => [p[0], -p[1], -p[2]]));
      const [x2, y2] = this.project(R[near]);
      html += `<span class="lbl ref" style="left:${x2}px;top:${y2}px">${Math.round(mr[spec.signal])}°</span>`;
    }
    this.labelEl.innerHTML = html;
  }

  // ---------------------------------------------------------- playback
  seek(i) { this.i = Math.max(0, Math.min(this.frames.length - 1, i)); this.draw(); }
  play() {
    if (this.playing || !this.frames?.length) return;
    this.playing = true;
    if (this.i >= this.frames.length - 1) this.i = 0;
    let tp = this.cap.t[this.i], last = performance.now();
    const step = (now) => {
      if (!this.playing) return;
      tp += ((now - last) / 1000) * this.speed; last = now;
      while (this.i < this.frames.length - 1 && this.cap.t[this.i + 1] <= tp) this.i++;
      this.draw();
      if (this.i >= this.frames.length - 1) {
        if (this.loop) { this.i = 0; tp = 0; this.raf = requestAnimationFrame(step); return; }
        this.playing = false; this.onEnd?.(); return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); }

  bindControls() {
    const c = this.c;
    const pts = new Map();
    let pinch = null;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); });
    c.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        this.cam.yaw += (e.clientX - prev[0]) * 0.01;
        this.cam.pitch = Math.max(-0.2, Math.min(1.45, this.cam.pitch + (e.clientY - prev[1]) * 0.008));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.cam.dist = Math.max(0.8, Math.min(12, this.cam.dist * (pinch / d)));
        pinch = d;
      }
      if (!this.playing) this.draw();
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => { e.preventDefault(); this.cam.dist = Math.max(0.8, Math.min(12, this.cam.dist * (1 + e.deltaY * 0.001))); if (!this.playing) this.draw(); }, { passive: false });
  }
  destroy() { this.pause(); this._ro?.disconnect(); }
}

/** Biggest differences between the user's key frame and the reference's. */
export function compareKeyFrames(userP, refP, exercise) {
  const back = (P) => P.map((p) => [p[0], -p[1], -p[2]]);
  const mu = frameMetrics(back(userP)), mr = frameMetrics(back(refP));
  const rows = [];
  const add = (key, label, unit = "°", digits = 0) => {
    const a = mu[key], b = mr[key];
    if (a == null || b == null) return;
    rows.push({ key, label, you: +a.toFixed(digits), ref: +b.toFixed(digits), diff: +(a - b).toFixed(digits), unit });
  };
  add("elbow", "Elbow angle"); add("knee", "Knee angle"); add("hip", "Hip angle"); add("shoulder", "Shoulder angle");
  add("torso_incl", "Torso tilt from vertical"); add("body_line", "Shoulder–hip–ankle line");
  const spec = EXERCISES[exercise];
  const main = spec?.signal;
  return rows.sort((x, y) => (x.key === main ? -1 : y.key === main ? 1 : Math.abs(y.diff) - Math.abs(x.diff)));
}
