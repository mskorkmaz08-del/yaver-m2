// Plays a lesson: builds its scene, walks through its steps with camera
// moves and animations, and gives each step its labels, highlights and
// controls. A lesson is { id, title, setup(ctx) → state, steps: [{ title,
// text, camera, enter(ctx, state) }] }. Each step's enter() sets the scene up
// from scratch, so steps can be visited in any order.
import * as THREE from "three";
import { tween, wait, ease, stopTweens } from "./anim.js?v=18";
import * as parts from "./parts.js?v=18";

const PULSE = new THREE.Color("#4cc9ff");

export class LessonContext {
  constructor(stage, ui) {
    this.stage = stage;
    this.ui = ui; // { controls, code, scope } DOM areas from academy.js
    this.THREE = THREE;
    this.parts = parts;
    this.tween = tween;
    this.wait = wait;
    this.ease = ease;
    this.frames = [];     // the lesson's per-frame callbacks
    this.stepFrames = []; // this step's
    this.stepLabels = [];
    this.focused = [];
    this.time = 0;
    this.stepToken = 0;
  }

  // ---- Scene ------------------------------------------------------------------

  // Adds an object to the scene, dropping it gently into place.
  add(obj, { at = null, rot = null, drop = true, delay = 0, parent = this.stage.root } = {}) {
    if (at) obj.position.set(...at);
    if (rot) obj.rotation.set(...rot);
    parent.add(obj);
    if (drop) {
      const y = obj.position.y;
      const s = obj.scale.x;
      obj.position.y = y + 5;
      obj.scale.setScalar(s * 0.001);
      tween(obj.scale, { x: s, y: s, z: s }, { ms: 650, delay, curve: ease.back });
      tween(obj.position, { y }, { ms: 900, delay, curve: ease.out });
    }
    return obj;
  }

  remove(obj) {
    stopTweens(obj.position);
    stopTweens(obj.scale);
    obj.parent?.remove(obj);
  }

  camera(pose, ms = 1400) {
    return this.stage.flyTo(pose, ms);
  }

  // Sets an object's final place before it's added, so wires can be routed
  // to its pins while it is still dropping in.
  place(obj, at, rot = null) {
    obj.position.set(...at);
    if (rot) obj.rotation.set(...rot);
    obj.updateMatrixWorld(true);
    return obj;
  }

  // For this step: `fn(hit, h)` is called when something in the scene is
  // pinched (or clicked); it can return { move(h), end(h) } to hold it.
  onGrab(fn) { this.grabHandler = fn; }

  // Text floating in the scene, always facing the camera. `size` is its
  // height in centimetres.
  text(str, { size = 1, color = "#e8f4ff", weight = 700 } = {}) {
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    const px = 96;
    g.font = `${weight} ${px}px system-ui, sans-serif`;
    c.width = Math.ceil(g.measureText(str).width + px * 0.4);
    c.height = Math.ceil(px * 1.3);
    g.font = `${weight} ${px}px system-ui, sans-serif`;
    g.fillStyle = color;
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillText(str, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set((size * c.width) / c.height, size, 1);
    sprite.userData.noPick = true;
    return sprite;
  }

  frame(fn) { this.frames.push(fn); }
  stepFrame(fn) { this.stepFrames.push(fn); }

  // A label pinned to a point, for this step only.
  label(anchor, html, opts) {
    const l = this.stage.labels.add(anchor, html, opts);
    this.stepLabels.push(l);
    return l;
  }

  // Makes objects glow softly for this step.
  focus(...objs) {
    this.focused = objs.flat().filter(Boolean);
  }

  // The world position of something inside a part, such as a pin.
  world(obj, local = [0, 0, 0]) {
    return obj.localToWorld(new THREE.Vector3(...local));
  }

  // True while the step that started this is still showing, so an async
  // animation can stop when the learner moves on.
  alive() {
    const token = this.stepToken;
    return () => token === this.stepToken;
  }

  // Charges moving round a path: { setRate(loopsPerSecond), dir(+1|-1),
  // color(hex), visible(bool) }.
  flow(path, { count = 40, color = "#ffe27a", radius = 0.09 } = {}) {
    const geo = new THREE.SphereGeometry(radius, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const dots = new THREE.InstancedMesh(geo, mat, count);
    dots.userData.noPick = true;
    dots.frustumCulled = false;
    this.stage.root.add(dots);
    let rate = 0, dir = 1, offset = 0;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const update = (dt) => {
      offset = (offset + rate * dir * dt + 1) % 1;
      for (let i = 0; i < count; i++) {
        path.getPointAt(((i / count) + offset + 1) % 1, p);
        m.makeTranslation(p.x, p.y, p.z);
        dots.setMatrixAt(i, m);
      }
      dots.instanceMatrix.needsUpdate = true;
    };
    update(0);
    this.frame(update);
    return {
      mesh: dots,
      setRate: (r) => { rate = r; },
      dir: (d) => { dir = d; },
      color: (c) => mat.color.set(c),
      visible: (v) => { dots.visible = v; },
    };
  }

  // ---- Panel controls (cleared on every step) ---------------------------------

  slider({ label, min, max, step = 1, value, format = (v) => v, onInput }) {
    const row = document.createElement("label");
    row.className = "ac-slider";
    row.innerHTML = `<span class="ac-slider-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output></output>`;
    const input = row.querySelector("input");
    const out = row.querySelector("output");
    const update = () => { out.textContent = format(Number(input.value)); onInput?.(Number(input.value)); };
    input.addEventListener("input", update);
    this.ui.controls.appendChild(row);
    update();
    return { input, set: (v) => { input.value = v; update(); } };
  }

  // A row of buttons: [{ label, onClick, active }]. `toggle` keeps one lit.
  buttons(list, { toggle = false } = {}) {
    const row = document.createElement("div");
    row.className = "ac-buttons";
    for (const b of list) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ac-btn" + (b.active ? " active" : "") + (b.cls ? ` ${b.cls}` : "");
      el.innerHTML = b.label;
      el.addEventListener("click", () => {
        if (toggle) for (const other of row.children) other.classList.toggle("active", other === el);
        b.onClick?.(el);
      });
      row.appendChild(el);
    }
    this.ui.controls.appendChild(row);
    return row;
  }

  // Live numbers under the step text.
  readout(html = "") {
    const el = document.createElement("div");
    el.className = "ac-readout";
    el.innerHTML = html;
    this.ui.controls.appendChild(el);
    return { el, set: (h) => { if (el.innerHTML !== h) el.innerHTML = h; } };
  }

  // ---- Code and oscilloscope panels (kept for the whole lesson) ---------------

  code(src, { title = "sketch.ino" } = {}) {
    const panel = this.ui.code;
    const render = (s) => {
      panel.innerHTML = `<div class="ac-code-title">${title}</div><pre>${s.split("\n").map((line, i) => `<div class="ln" data-line="${i + 1}"><i>${i + 1}</i>${highlightC(line) || " "}</div>`).join("")}</pre>`;
    };
    render(src);
    panel.hidden = false;
    let current = 0;
    return {
      set: (s) => { render(s); if (current) this.codeHighlight(current); },
      highlight: (n) => { current = n; this.codeHighlight(n); },
    };
  }

  codeHighlight(lines) {
    const set = new Set([].concat(lines));
    for (const el of this.ui.code.querySelectorAll(".ln")) el.classList.toggle("on", set.has(Number(el.dataset.line)));
    const first = this.ui.code.querySelector(".ln.on");
    first?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // A rolling trace of signals: [{ name, color, read() → 0..1 }].
  scope(channels, { title = "Oscilloscope", seconds = 4, labels = ["0 V", "5 V"] } = {}) {
    const panel = this.ui.scope;
    panel.hidden = false;
    panel.innerHTML = `<div class="ac-code-title">${title}<span>${channels.map((c) => `<b style="color:${c.color}">● ${c.name}</b>`).join(" ")}</span></div><canvas></canvas>`;
    const canvas = panel.querySelector("canvas");
    const g = canvas.getContext("2d");
    const history = channels.map(() => []);
    let span = seconds;
    const draw = () => {
      const r = Math.min(window.devicePixelRatio, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * r) { canvas.width = w * r; canvas.height = h * r; }
      g.setTransform(r, 0, 0, r, 0, 0);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(120,200,255,0.12)";
      g.lineWidth = 1;
      for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo((w / 8) * i, 0); g.lineTo((w / 8) * i, h); g.stroke(); }
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (h / 4) * i); g.lineTo(w, (h / 4) * i); g.stroke(); }
      g.fillStyle = "rgba(160,190,220,0.6)";
      g.font = "10px system-ui";
      g.fillText(labels[1], 4, 11);
      g.fillText(labels[0], 4, h - 4);
      const lane = h / channels.length;
      channels.forEach((c, ci) => {
        const pts = history[ci];
        g.strokeStyle = c.color;
        g.lineWidth = 2;
        g.beginPath();
        pts.forEach(([t, v], i) => {
          const x = w - ((this.time - t) / span) * w;
          const y = ci * lane + lane - 6 - v * (lane - 14);
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.stroke();
      });
    };
    this.frame(() => {
      channels.forEach((c, i) => {
        const pts = history[i];
        pts.push([this.time, c.read()]);
        while (pts.length && this.time - pts[0][0] > span + 0.2) pts.shift();
      });
      draw();
    });
    return { setSpan: (s) => { span = s; } };
  }

  // ---- Internals -----------------------------------------------------------------

  clearStep() {
    this.stepToken++;
    for (const l of this.stepLabels) l.remove();
    this.stepLabels = [];
    this.stepFrames = [];
    this.focused = [];
    this.grabHandler = null;
    this.ui.controls.innerHTML = "";
  }

  tick(dt) {
    this.time += dt;
    for (const f of this.frames) f(dt, this.time);
    for (const f of this.stepFrames) f(dt, this.time);
    // A soft pulse on focused objects.
    const k = 0.18 + 0.14 * Math.sin(this.time * 4);
    for (const obj of this.focused) {
      obj.traverse((m) => {
        if (!m.isMesh || !m.material?.emissive || m.userData.noPick) return;
        if (!m.userData.glow) {
          if (m.material.userData.shared) m.material = m.material.clone(); // don't light every pin in the scene
          m.userData.glow = { color: m.material.emissive.clone(), level: m.material.emissiveIntensity };
        }
        m.material.emissive.copy(PULSE);
        m.material.emissiveIntensity = k;
        m.userData.glowing = true;
      });
    }
    this.stage.root.traverse((m) => {
      if (m.userData.glow && !m.userData.glowing) {
        m.material.emissive.copy(m.userData.glow.color);
        m.material.emissiveIntensity = m.userData.glow.level;
        delete m.userData.glow;
      }
      m.userData.glowing = false;
    });
  }

  dispose() {
    this.clearStep();
    this.frames = [];
    this.ui.code.hidden = true;
    this.ui.scope.hidden = true;
    this.ui.code.innerHTML = this.ui.scope.innerHTML = "";
    stopTweens();
    this.stage.clear();
  }
}

// Minimal C/Arduino syntax colouring for the code panel.
const KEYWORDS = /\b(void|int|long|unsigned|float|double|bool|const|char|byte|if|else|for|while|return|true|false|#define|#include|static|uint8_t|String)\b/g;
const BUILTINS = /\b(pinMode|digitalWrite|digitalRead|analogWrite|analogRead|delay|delayMicroseconds|millis|micros|pulseIn|Serial|ledcAttach|ledcWrite|map|constrain|WiFi|setup|loop|HIGH|LOW|OUTPUT|INPUT_PULLUP|INPUT)\b/g;
export function highlightC(line) {
  const esc = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cut = esc.indexOf("//");
  const code = cut >= 0 ? esc.slice(0, cut) : esc;
  const comment = cut >= 0 ? `<span class="c-com">${esc.slice(cut)}</span>` : "";
  return code
    .replace(/("[^"]*")/g, '<span class="c-str">$1</span>')
    .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="c-num">$1</span>')
    .replace(KEYWORDS, '<span class="c-key">$1</span>')
    .replace(BUILTINS, '<span class="c-fn">$1</span>') + comment;
}
