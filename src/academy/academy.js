// The Robotics Academy: a course of interactive 3D lessons on electronics,
// Arduino and the ESP32, ending in a robot simulator. Loaded the first time
// it is opened from Yaver's home screen. Hands (through the webcam) or the
// mouse drive everything: pinch to press buttons and grab parts, move to
// turn the view, both hands to zoom, and an open-hand swipe to change step.
import { Stage } from "./stage.js?v=17";
import { stepTweens } from "./anim.js?v=17";
import { LessonContext } from "./course.js?v=17";
import { ELECTRONICS } from "./lessons-electronics.js?v=17";
import { ARDUINO } from "./lessons-arduino.js?v=17";
import { ESP32 } from "./lessons-esp32.js?v=17";
import { Simulator, buildRobot } from "./sim.js?v=17";
import { HandInput } from "../handinput.js?v=17";

const VERSION = new URL(import.meta.url).searchParams.get("v") ?? "dev";
export const MODULES = [ELECTRONICS, ARDUINO, ESP32];
const LESSONS = MODULES.flatMap((m, mi) => m.lessons.map((l) => ({ ...l, module: m, moduleIndex: mi })));

const root = document.getElementById("academy");
root.innerHTML = `
  <div class="ac-stage"></div>
  <div class="ac-labels"><canvas></canvas></div>
  <header class="hud ac-top">
    <button class="go-home" data-act="home" title="Back to Yaver (Esc)" aria-label="Back to Yaver">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <div class="brand">ROBOTICS ACADEMY <span class="version">v${VERSION}</span></div>
    <nav class="ac-crumbs"></nav>
    <div class="status ac-status"></div>
  </header>
  <section class="hud ac-panel ac-menu" data-hand-scroll></section>
  <section class="hud ac-panel ac-lesson" hidden>
    <div class="ac-lesson-top"><button class="ac-btn ghost" data-act="menu">☰ All lessons</button><span class="ac-lesson-module"></span></div>
    <h2 class="ac-lesson-title"></h2>
    <div class="ac-dots"></div>
    <h3 class="ac-step-title"></h3>
    <div class="ac-text" data-hand-scroll></div>
    <div class="ac-controls"></div>
    <nav class="ac-nav"><button class="ac-btn" data-act="prev">◀ Back</button><span class="ac-count"></span><button class="ac-btn primary" data-act="next">Next ▶</button></nav>
  </section>
  <aside class="hud ac-panel ac-code" hidden data-hand-scroll></aside>
  <aside class="hud ac-panel ac-scope" hidden></aside>
  <aside class="hud ac-panel ac-info" hidden><button class="ac-x" data-act="close-info" aria-label="Close">×</button><h3></h3><p></p></aside>
  <div class="ac-hint">✋ Pinch to press or grab · pinch and move to turn · two hands to zoom · swipe an open hand to change step</div>
  <canvas class="ac-hands"></canvas>`;

const $ = (sel) => root.querySelector(sel);
const ui = {
  menu: $(".ac-menu"), lesson: $(".ac-lesson"), code: $(".ac-code"), scope: $(".ac-scope"), info: $(".ac-info"),
  controls: $(".ac-controls"), text: $(".ac-text"), crumbs: $(".ac-crumbs"), status: $(".ac-status"),
};
const stage = new Stage($(".ac-stage"));
const canvas = stage.renderer.domElement;
const sim = new Simulator(stage, root);

let ctx = null;      // the running lesson's context
let lesson = null;
let state = null;
let stepIndex = 0;
let view = "menu";   // "menu" | "lesson" | "sim"
let showcase = null; // the robot turning on the menu
let active = false;
let onHome = () => {};

// ---- Progress --------------------------------------------------------------------

function loadDone() { try { return new Set(JSON.parse(localStorage.getItem("yaver-academy-done") || "[]")); } catch { return new Set(); } }
const done = loadDone();
function markDone(id) {
  done.add(id);
  try { localStorage.setItem("yaver-academy-done", JSON.stringify([...done])); } catch {}
}

// ---- Menu ---------------------------------------------------------------------------

function renderMenu() {
  let n = 0;
  ui.menu.innerHTML = `
    <h1>Robotics course</h1>
    <p class="ac-lead">From your first LED to a robot that finds its own way: ${LESSONS.length} short 3D lessons, then build, wire and program your own robot in the simulator.</p>
    ${MODULES.map((m, mi) => `
      <h2><span>Module ${mi + 1}</span>${m.title}</h2>
      <div class="ac-cards">${m.lessons.map((l) => { n++; return `
        <button class="ac-card ${done.has(l.id) ? "done" : ""}" data-lesson="${l.id}">
          <b class="ac-num">${done.has(l.id) ? "✓" : n}</b>
          <span><strong>${l.title}</strong><small>${l.summary}</small></span>
          <i>${l.minutes} min</i>
        </button>`; }).join("")}</div>`).join("")}
    <h2><span>Final project</span>Robot simulator</h2>
    <button class="ac-card ac-sim-card" data-sim="1">
      <b class="ac-num">🤖</b>
      <span><strong>Build your own robot</strong><small>Fit the motors, wheels, ESP32, motor driver and distance sensor by hand, wire every pin, write the code, and watch it drive.</small></span>
    </button>`;
}

ui.menu.addEventListener("click", (e) => {
  const card = e.target.closest("[data-lesson], [data-sim]");
  if (!card) return;
  if (card.dataset.sim) go("sim");
  else go(card.dataset.lesson);
});

// ---- Views ------------------------------------------------------------------------

function teardown() {
  ctx?.dispose();
  ctx = lesson = state = null;
  if (sim.active) sim.close();
  showcase = null;
  hideInfo();
  stage.clear();
  ui.lesson.hidden = ui.menu.hidden = true;
  ui.code.hidden = ui.scope.hidden = true;
}

// Opens a view: "menu", "sim" or a lesson id. Updates the address so Back
// works and a link can open a lesson directly.
export function go(where, { push = true } = {}) {
  const hash = where === "menu" ? "#academy" : `#academy/${where}`;
  if (push && location.hash !== hash) history.pushState(null, "", hash);
  teardown();
  if (where === "sim") openSim();
  else if (LESSONS.some((l) => l.id === where)) openLesson(where);
  else openMenu();
}

function openMenu() {
  view = "menu";
  ui.menu.hidden = false;
  renderMenu();
  ui.crumbs.textContent = "";
  const { robot } = buildRobot({ wired: true });
  showcase = robot;
  stage.root.add(robot);
  stage.flyTo({ target: [0, 3.5, 0], theta: 0.6, phi: 1.05, radius: 50 }, 1200);
}

function openSim() {
  view = "sim";
  ui.crumbs.innerHTML = `<button class="ac-link" data-act="menu">Course</button> › Robot simulator`;
  sim.open();
}

function openLesson(id) {
  view = "lesson";
  lesson = LESSONS.find((l) => l.id === id);
  ctx = new LessonContext(stage, ui);
  state = lesson.setup(ctx);
  ui.lesson.hidden = false;
  $(".ac-lesson-title").textContent = lesson.title;
  $(".ac-lesson-module").textContent = `Module ${lesson.moduleIndex + 1} · ${lesson.module.title}`;
  ui.crumbs.innerHTML = `<button class="ac-link" data-act="menu">Course</button> › ${lesson.title}`;
  $(".ac-dots").innerHTML = lesson.steps.map((s, i) => `<button class="ac-dot" data-step="${i}" title="${s.title}"></button>`).join("");
  goStep(0);
}

function goStep(i) {
  if (!lesson) return;
  stepIndex = Math.max(0, Math.min(i, lesson.steps.length - 1));
  const step = lesson.steps[stepIndex];
  ctx.clearStep();
  hideInfo();
  $(".ac-step-title").textContent = step.title;
  ui.text.innerHTML = step.text;
  ui.text.scrollTop = 0;
  $(".ac-count").textContent = `${stepIndex + 1} / ${lesson.steps.length}`;
  root.querySelectorAll(".ac-dot").forEach((d, k) => { d.classList.toggle("on", k === stepIndex); d.classList.toggle("seen", k < stepIndex); });
  $("[data-act=prev]").disabled = stepIndex === 0;
  const last = stepIndex === lesson.steps.length - 1;
  const nextLesson = LESSONS[LESSONS.indexOf(lesson) + 1];
  $("[data-act=next]").innerHTML = last ? (nextLesson ? "Next lesson ▶" : "To the simulator ▶") : "Next ▶";
  if (step.camera) stage.flyTo(step.camera);
  step.enter(ctx, state);
  if (last) markDone(lesson.id);
}

function next() {
  if (view !== "lesson") return;
  if (stepIndex < lesson.steps.length - 1) return goStep(stepIndex + 1);
  const nextLesson = LESSONS[LESSONS.indexOf(lesson) + 1];
  go(nextLesson ? nextLesson.id : "sim");
}
function prev() { if (view === "lesson" && stepIndex > 0) goStep(stepIndex - 1); }

root.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  const dot = e.target.closest("[data-step]");
  if (dot) goStep(Number(dot.dataset.step));
  if (act === "next") next();
  else if (act === "prev") prev();
  else if (act === "menu") go("menu");
  else if (act === "home") onHome();
  else if (act === "close-info") hideInfo();
});

// ---- Part notes ------------------------------------------------------------------------

function infoOf(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData.info) return o.userData.info;
  return null;
}

function showInfo(info) {
  if (!info) return hideInfo();
  ui.info.querySelector("h3").textContent = info.title;
  ui.info.querySelector("p").textContent = info.text;
  ui.info.hidden = false;
  ui.info.classList.remove("pop");
  void ui.info.offsetWidth;
  ui.info.classList.add("pop");
}
function hideInfo() { ui.info.hidden = true; }

// ---- Mouse ---------------------------------------------------------------------------

let mouse = null;
canvas.addEventListener("pointerdown", (e) => {
  const x = e.clientX, y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  const pan = e.button === 2 || e.shiftKey;
  if (!pan && view === "sim") {
    const d = sim.grabAt(x, y, canvas);
    if (d) { mouse = { drag: d }; return; }
  }
  const hit = !pan && view !== "sim" ? stage.pick(x, y) : null;
  if (hit && ctx?.grabHandler) {
    const d = ctx.grabHandler(hit, { x, y });
    if (d) { mouse = { drag: { move: (mx, my) => d.move?.({ x: mx, y: my }), end: (mx, my) => d.end?.({ x: mx, y: my }) } }; return; }
  }
  mouse = { x, y, sx: x, sy: y, pan, hit };
});
canvas.addEventListener("pointermove", (e) => {
  const x = e.clientX, y = e.clientY;
  if (!mouse) { if (view === "sim") sim.hover(x, y); return; }
  if (mouse.drag) { mouse.drag.move(x, y); if (view === "sim") sim.hover(x, y); return; }
  if (mouse.pan) stage.panBy(x - mouse.x, y - mouse.y);
  else stage.orbitBy(-(x - mouse.x) * 0.006, -(y - mouse.y) * 0.006);
  mouse.x = x; mouse.y = y;
});
canvas.addEventListener("pointerup", (e) => {
  if (mouse?.drag) mouse.drag.end(e.clientX, e.clientY);
  else if (mouse && Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) < 5) showInfo(mouse.hit ? infoOf(mouse.hit.object) : null);
  mouse = null;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => { e.preventDefault(); stage.zoomBy(Math.exp(e.deltaY * 0.001)); }, { passive: false });

window.addEventListener("keydown", (e) => {
  if (!active || e.target.closest?.("input, textarea")) return;
  if (e.key === "ArrowRight") next();
  else if (e.key === "ArrowLeft") prev();
});

// ---- Hands ----------------------------------------------------------------------------

const input = new HandInput({
  video: document.getElementById("camera"),
  canvas: $(".ac-hands"),
  handlers: {
    status: (t) => { ui.status.textContent = t; },
    orbit: (dx, dy) => stage.orbitBy(-dx * 0.006, -dy * 0.006),
    zoom: (f) => stage.zoomBy(f),
    swipe: (dir) => (dir > 0 ? next() : prev()),
    grab(h, el) {
      if (view === "sim") {
        const d = sim.grabAt(h.x, h.y, el);
        return d && { move: (hh) => d.move(hh.x, hh.y), end: (hh) => d.end(hh.x, hh.y) };
      }
      if (el !== canvas) return null;
      const hit = stage.pick(h.x, h.y);
      if (!hit) return null;
      if (ctx?.grabHandler) {
        const d = ctx.grabHandler(hit, h);
        if (d) return d;
      }
      const info = infoOf(hit.object);
      if (!info) return null;
      // Pinch and let go on a part: its note. Pinch and move: turn the view.
      let last = { x: h.x, y: h.y }, moved = 0;
      return {
        move(hh) { stage.orbitBy(-(hh.x - last.x) * 0.006, -(hh.y - last.y) * 0.006); moved += Math.hypot(hh.x - last.x, hh.y - last.y); last = { x: hh.x, y: hh.y }; },
        end() { if (moved < 24) showInfo(info); },
      };
    },
  },
});

// ---- Main loop -----------------------------------------------------------------------

// Keeps the view centred in the space the panels leave free.
function updateInsets() {
  const W = window.innerWidth;
  if (W < 760) return stage.setInsets(0, 0);
  const edge = (el, side) => {
    if (!el || el.hidden || el.closest("[hidden]")) return 0;
    const r = el.getBoundingClientRect();
    return side === "left" ? r.right : W - r.left;
  };
  const left = Math.max(edge(ui.menu, "left"), edge(ui.lesson, "left"), edge(root.querySelector(".sim-bin"), "left"));
  const right = Math.max(edge(ui.code, "right"), edge(root.querySelector(".sim-side"), "right"));
  stage.setInsets(left, right);
}

let lastTime = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (!active) return;
  stepTweens(dt * 1000);
  input.update(now);
  if (view === "sim") {
    const first = [...input.hands.values()][0];
    if (first) sim.hover(first.x, first.y);
    sim.frame(dt);
  }
  ctx?.tick(dt);
  if (showcase) showcase.rotation.y += dt * 0.3;
  updateInsets();
  stage.render();
}
requestAnimationFrame(loop);

// ---- Opening and closing ------------------------------------------------------------

export function pause() {
  active = false;
  input.stop();
  sim.stopSketch();
}

export function resume() {
  if (active) return;
  active = true;
  stage.resize();
  input.start();
}

export function setHome(fn) { onHome = fn; }

// What Yaver's voice uses while the Academy is open. Returns what to say, or
// null if the sentence isn't for the Academy.
export function command(raw) {
  const text = raw.toLowerCase();
  if (/\b(next|continue|go on|carry on|forward)\b/.test(text) && view === "lesson") { next(); return "Next."; }
  if (/\b(back|previous|last step)\b/.test(text) && !/\bhome\b/.test(text) && view === "lesson") { prev(); return "Going back."; }
  if (/\b(repeat|again|replay)\b/.test(text) && view === "lesson") { goStep(stepIndex); return "Once more."; }
  if (/\b(menu|all lessons|course map|lesson list)\b/.test(text)) { go("menu"); return "Here's the course."; }
  if (/\b(simulator|build (a|my|the|our) robot)\b/.test(text)) { go("sim"); return "Opening the robot simulator."; }
  const m = text.match(/\blesson (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (m) {
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const n = Number(m[1]) || words[m[1]];
    const l = LESSONS[n - 1];
    if (l) { go(l.id); return `Lesson ${n}: ${l.title}.`; }
  }
  if (view === "sim" && /\b(upload|run (it|the code)|start (it|the robot))\b/.test(text)) { sim.upload(); return "Uploading the sketch."; }
  if (view === "sim" && /\b(assemble|put it together)\b/.test(text)) { sim.setMode("build"); sim.assembleAll(); return "Assembling it for you."; }
  if (view === "sim" && /\bwire it\b/.test(text)) { sim.setMode("wire"); sim.autoWire(); return "Wiring it up."; }
  return null;
}

// One line describing where he is, for the language model.
export function describe() {
  if (view === "lesson") return `He is in the Robotics Academy, lesson "${lesson.title}", step ${stepIndex + 1} of ${lesson.steps.length}: "${lesson.steps[stepIndex].title}".`;
  if (view === "sim") return `He is in the Robotics Academy's robot simulator, on the ${sim.mode} tab.`;
  return "He is on the Robotics Academy's course map.";
}

export function route(sub) { go(sub || "menu", { push: false }); }
