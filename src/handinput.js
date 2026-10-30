// Hand control for screens other than the Studio (the Robotics Academy):
// the webcam's hands become pointers that can press any button, drag
// sliders, scroll panels, grab things in the 3D scene, orbit and zoom the
// view, and swipe between steps. The same gestures as the Studio: pinch to
// press or grab, open the hand to let go, both hands to zoom.
import { sharedTracker } from "./hands.js?v=18";
import { classify } from "./gestures.js?v=18";
import { OneEuro, Glide } from "./filters.js?v=18";

const SMOOTHING = 0.35;
const RELEASE_GRACE_MS = 140;
const LOST_HAND_MS = 300;
const POINTER_FILTER = [1.0, 0.007];
const GLIDE_MS = 55; // pointers glide between camera reports (see filters.js)
const CLICK_SLOP = 26; // px a pinch may wander and still count as a press
const SWIPE_MS = 380;
const SWIPE_FRACTION = 0.28; // of the screen width
const CLICKABLE = "button, a, summary, label, select, [data-hand-click], input[type=checkbox], input[type=radio]";

export class HandInput {
  // `handlers` (all optional):
  //   grab(h, el) → { move(h), end(h) } to take a pinch that started on `el`
  //     (usually the 3D canvas), or null to let it orbit the view;
  //   orbit(dx, dy), zoom(factor), swipe(+1 | -1), status(text).
  constructor({ video, canvas, handlers = {} }) {
    this.tracker = sharedTracker(video);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.handlers = handlers;
    this.hands = new Map();
    this.ready = false;
    this.active = false;
    this.hovered = new Set();
    this.zoomLast = null;
    this.drawn = false;
    this.lastUpdate = 0;
  }

  async start() {
    this.active = true;
    this.statusText = null;
    this.handlers.status?.("Starting camera…");
    try {
      await this.tracker.start();
      if (!this.active) { this.tracker.stop(); return; }
      this.ready = true;
      this.handlers.status?.("Show your hands to the camera");
    } catch (err) {
      console.warn(err);
      this.handlers.status?.("No camera: mouse and keyboard work too");
    }
  }

  stop() {
    this.active = false;
    this.ready = false;
    this.tracker.stop();
    for (const h of this.hands.values()) this.release(h);
    this.hands.clear();
    this.setHovered([]);
    this.draw();
  }

  // Call once a frame. Gestures are read when the camera reports (12 to 30
  // times a second); pointers glide, and drags follow them, every frame.
  update(now = performance.now()) {
    const dt = Math.min(now - this.lastUpdate, 100);
    this.lastUpdate = now;
    if (this.ready) {
      const detected = this.tracker.detect();
      if (detected) this.process(detected, this.tracker.lastTime);
      const text = this.hands.size ? `Hands: ${[...this.hands.values()].map((h) => h.gesture).join(" · ")}` : "Show your hands to the camera";
      if (text !== this.statusText) this.handlers.status?.((this.statusText = text));
    }
    for (const h of this.hands.values()) {
      h.x = h.gx.step(h.tx, dt);
      h.y = h.gy.step(h.ty, dt);
      if (h.grab && h.gesture === "pinch") this.drag(h);
    }
    this.zoom();
    this.draw();
  }

  process(detected, now) {
    const W = window.innerWidth, H = window.innerHeight;
    const seen = new Set();
    for (const { id, landmarks } of detected) {
      seen.add(id);
      let h = this.hands.get(id);
      if (!h) {
        h = { id, lm: landmarks, gesture: "point", grab: null, fx: new OneEuro(...POINTER_FILTER), fy: new OneEuro(...POINTER_FILTER), gx: new Glide(GLIDE_MS), gy: new Glide(GLIDE_MS), trail: [] };
        this.hands.set(id, h);
      }
      h.lastSeen = now;
      h.lm = landmarks.map((p, i) => ({ x: h.lm[i].x * SMOOTHING + p.x * (1 - SMOOTHING), y: h.lm[i].y * SMOOTHING + p.y * (1 - SMOOTHING), z: p.z }));
      const { gesture, cursor, size } = classify(h.lm, h.gesture === "pinch");
      h.gesture = gesture;
      h.size = size;
      h.tx = h.fx.filter(cursor.x * W, now);
      h.ty = h.fy.filter(cursor.y * H, now);
      if (h.x === undefined) { h.x = h.gx.step(h.tx, 0); h.y = h.gy.step(h.ty, 0); }
      this.trackSwipe(h, now);
    }
    for (const [id, h] of this.hands) {
      if (now - h.lastSeen > LOST_HAND_MS) { this.release(h); this.hands.delete(id); }
    }

    for (const h of this.hands.values()) {
      if (!seen.has(h.id)) continue;
      if (h.gesture === "pinch") {
        h.openSince = null;
        if (!h.grab) this.press(h);
      } else if (h.grab) {
        h.openSince ??= now;
        if (now - h.openSince >= RELEASE_GRACE_MS) this.release(h);
      }
    }

    const hover = [];
    for (const h of this.hands.values()) {
      h.over = !h.grab || h.grab.kind === "click" ? this.targetAt(h.tx, h.ty)?.clickable ?? null : null;
      hover.push(h.over);
    }
    this.setHovered(hover.filter(Boolean));
  }

  // Two hands pinching empty space: spread to zoom in, bring together to
  // zoom out.
  zoom() {
    const orbiting = [...this.hands.values()].filter((h) => h.grab?.kind === "orbit");
    if (orbiting.length >= 2) {
      const [a, b] = orbiting;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      if (this.zoomLast) this.handlers.zoom?.(this.zoomLast / d);
      this.zoomLast = d;
    } else this.zoomLast = null;
  }

  targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const range = el.closest("input[type=range]");
    return { el, range, clickable: range || el.closest(CLICKABLE), scroller: el.closest("[data-hand-scroll]") };
  }

  press(h) {
    // A pinch acts where the hand is now, not where the gliding pointer has
    // got to, so the pointer catches up first.
    h.x = h.gx.snap(h.tx);
    h.y = h.gy.snap(h.ty);
    const t = this.targetAt(h.x, h.y);
    const at = { x: h.x, y: h.y };
    if (t?.range && !t.range.disabled) {
      h.grab = { kind: "range", el: t.range };
      this.setRange(t.range, h.x);
      return;
    }
    if (t?.clickable && !t.clickable.disabled) {
      t.clickable.classList.add("hand-press");
      h.grab = { kind: "click", el: t.clickable, start: at, scroller: t.scroller, last: at };
      return;
    }
    if (t?.scroller) {
      h.grab = { kind: "scroll", el: t.scroller, last: at };
      return;
    }
    const custom = t ? this.handlers.grab?.(h, t.el) : null;
    if (custom) { h.grab = { kind: "custom", drag: custom }; return; }
    // Pinching over a panel with nothing to press does nothing; over the
    // scene it turns the view.
    h.grab = t && t.el.closest(".ac-panel, .hud") ? { kind: "none" } : { kind: "orbit", last: at };
  }

  drag(h) {
    const g = h.grab;
    if (g.kind === "range") this.setRange(g.el, h.x);
    else if (g.kind === "custom") g.drag.move?.(h);
    else if (g.kind === "orbit") {
      if (this.zoomLast === null) this.handlers.orbit?.(h.x - g.last.x, h.y - g.last.y);
      g.last = { x: h.x, y: h.y };
    } else if (g.kind === "scroll") {
      g.el.scrollTop -= h.y - g.last.y;
      g.last = { x: h.x, y: h.y };
    } else if (g.kind === "click") {
      // Moving a press too far turns it into a scroll (inside a scrolling
      // panel) or cancels it.
      if (Math.hypot(h.x - g.start.x, h.y - g.start.y) > CLICK_SLOP) {
        g.el.classList.remove("hand-press");
        h.grab = g.scroller ? { kind: "scroll", el: g.scroller, last: { x: h.x, y: h.y } } : { kind: "none" };
      } else g.last = { x: h.x, y: h.y };
    }
  }

  release(h) {
    const g = h.grab;
    h.grab = null;
    if (!g) return;
    if (g.kind === "click") {
      g.el.classList.remove("hand-press");
      // Opening the fingers moves the cursor, so judge where the pinch was.
      const t = this.targetAt(g.last.x, g.last.y);
      if (t?.clickable === g.el) g.el.click();
    } else if (g.kind === "custom") g.drag.end?.(h);
    else if (g.kind === "range") g.el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  setRange(el, x) {
    const r = el.getBoundingClientRect();
    const t = Math.min(Math.max((x - r.left) / r.width, 0), 1);
    const min = Number(el.min || 0), max = Number(el.max || 100), step = Number(el.step || 1);
    const v = Math.round((min + t * (max - min)) / step) * step;
    if (Number(el.value) !== v) {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // A quick sideways sweep of an open hand turns the page.
  trackSwipe(h, now) {
    if (h.gesture !== "open" || h.grab) { h.trail = []; return; }
    h.trail.push({ x: h.x, t: now });
    while (h.trail.length && now - h.trail[0].t > SWIPE_MS) h.trail.shift();
    if (now < (this.swipeQuiet ?? 0) || h.trail.length < 4) return;
    const dx = h.x - h.trail[0].x;
    if (Math.abs(dx) > window.innerWidth * SWIPE_FRACTION) {
      this.swipeQuiet = now + 900;
      h.trail = [];
      this.handlers.swipe?.(dx < 0 ? 1 : -1); // sweeping left goes forward, like turning a page
    }
  }

  setHovered(els) {
    const next = new Set(els);
    for (const el of this.hovered) if (!next.has(el)) el.classList.remove("hand-hover");
    for (const el of next) el.classList.add("hand-hover");
    this.hovered = next;
  }

  // The pointers: a ring and a dot, filled while pinching, bigger over
  // something pressable.
  draw() {
    const c = this.canvas;
    const r = Math.min(window.devicePixelRatio, 2);
    const w = c.clientWidth, hgt = c.clientHeight;
    if (c.width !== Math.round(w * r) || c.height !== Math.round(hgt * r)) {
      c.width = Math.round(w * r);
      c.height = Math.round(hgt * r);
    }
    const ctx = this.ctx;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    if (!this.drawn && !this.hands.size) return; // already blank
    ctx.clearRect(0, 0, w, hgt);
    this.drawn = this.hands.size > 0;
    for (const h of this.hands.values()) {
      const pinching = h.gesture === "pinch";
      const over = h.over;
      const color = h.gesture === "fist" ? "255,107,107" : "76,201,255";
      const radius = over ? 22 : 16;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(${color},0.95)`;
      ctx.shadowColor = `rgba(${color},0.8)`;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(h.x, h.y, pinching ? radius * 0.75 : radius, 0, Math.PI * 2);
      ctx.stroke();
      if (pinching) {
        ctx.fillStyle = `rgba(${color},0.3)`;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#e8f8ff";
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
