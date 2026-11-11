// The Robotics Academy: a course of interactive 3D lessons on electronics,
// Arduino and the ESP32, ending in a robot simulator. Loaded the first time
// it is opened from Yaver's home screen. Hands (through the webcam) or the
// mouse drive everything: pinch to press buttons and grab parts, move to
// turn the view, both hands to zoom, and an open-hand swipe to change step.
import { Stage } from "./stage.js?v=22";
import { stepTweens } from "./anim.js?v=22";
import { LessonContext } from "./course.js?v=22";
import { ELECTRONICS } from "./lessons-electronics.js?v=22";
import { ARDUINO } from "./lessons-arduino.js?v=22";
import { ESP32 } from "./lessons-esp32.js?v=22";
import { Simulator, buildRobot } from "./sim.js?v=22";
import { HandInput } from "../handinput.js?v=22";
import { projectLesson } from "./project.js?v=22";
import { planProject, checkPlan, savedProjects, saveProject, deleteProject, saveClaudeKey } from "./planner.js?v=22";
import { saveKey as saveGeminiKey } from "../assistant/keys.js?v=22";
import { PIANO } from "./project-examples.js?v=22";
import { KIT, kitPlan } from "./kit.js?v=22";
import { isOn, onSwitch } from "../switches.js?v=22";

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
let view = "menu";   // "menu" | "lesson" | "sim" (a project plays as a lesson)
let planning = null; // { request, status, error, needKey } while the project tutor works
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

const EXAMPLES = ["A piano from an Arduino", "A night light that turns on in the dark", "A parking sensor that beeps faster as you get close", "A traffic light with a crossing button", "A servo that follows a knob"];

function projectBlock() {
  const saved = savedProjects();
  const p = planning;
  const busy = p && !p.error && !p.needKey;
  return `
    <div class="pj-make">
      <h1>Make your own project</h1>
      <p class="ac-lead">Say or type what you want to build. Yaver's AI designs it: the parts, where every wire goes, and the code, explained step by step in 3D. Then run it in the simulator.</p>
      <form class="pj-form">
        <textarea name="what" rows="2" placeholder="I want to make a piano from an Arduino…" aria-label="What do you want to build?" ${busy ? "disabled" : ""}>${esc(p?.request ?? "")}</textarea>
        <button class="ac-btn primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "Designing…" : "Design it ▶"}</button>
      </form>
      ${busy ? `<p class="pj-status"><i class="pj-spin"></i>${esc(p.status || "Thinking…")} <small>(about half a minute)</small></p>` : ""}
      ${p?.error ? `<p class="pj-status pj-err">${esc(p.error)}</p>` : ""}
      ${p?.needKey ? keyForm() : ""}
      <div class="pj-chips">${EXAMPLES.map((e) => `<button type="button" class="pj-chip" data-example="${esc(e)}">${esc(e)}</button>`).join("")}</div>
      <div class="ac-cards pj-saved">
        <button class="ac-card" data-project="example"><b class="ac-num">🎹</b><span><strong>${esc(PIANO.title)}</strong><small>A ready-made example: try it now, no key needed.</small></span></button>
        ${saved.map((pl, i) => `<div class="pj-saved-row"><button class="ac-card" data-project="${i}"><b class="ac-num">🛠</b><span><strong>${esc(pl.title)}</strong><small>${esc(pl.request || pl.summary || "")}</small></span></button><button class="ac-x pj-del" data-del="${i}" title="Delete" aria-label="Delete ${esc(pl.title)}">×</button></div>`).join("")}
      </div>
    </div>`;
}

function keyForm() {
  return `
    <form class="pj-key">
      <p><b>One-time setup.</b> Yaver designs projects with Google's free Gemini AI, the same key its voice uses. Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>, paste it here, and it stays in this browser.</p>
      <div class="pj-key-row"><input type="password" name="gemini" placeholder="Paste the Gemini key (AIza…)" autocomplete="off"><button class="ac-btn primary" type="submit">Save</button></div>
      <details><summary>Or use Claude instead</summary>
        <p>Claude (Anthropic) also works, with a paid API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Each project costs a few cents.</p>
        <div class="pj-key-row"><input type="password" name="claude" placeholder="Paste the Claude key (sk-ant-…)" autocomplete="off"><button class="ac-btn" type="submit">Save</button></div>
      </details>
    </form>`;
}

// "My kit": a short lesson for every part of his own Arduino kit.
function kitBlock() {
  return `
    <div class="kit-block">
      <h1>${KIT.title}</h1>
      <p class="ac-lead">${KIT.lead}</p>
      ${KIT.groups.map((g) => `
        <h2><span>${g.label}</span>${g.title}</h2>
        <div class="ac-cards">${g.lessons.map((l) => `
          <button class="ac-card ${done.has(`kit-${l.id}`) ? "done" : ""}" data-kit="${l.id}">
            <b class="ac-num">${done.has(`kit-${l.id}`) ? "✓" : l.emoji}</b>
            <span><strong>${l.n}. ${l.title}</strong><small>${l.summary}</small></span>
            <i>${l.minutes} min</i>
          </button>`).join("")}</div>`).join("")}
    </div>`;
}

function renderMenu() {
  let n = 0;
  ui.menu.innerHTML = `
    ${kitBlock()}
    ${projectBlock()}
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
  const chip = e.target.closest("[data-example]");
  if (chip) { plan(chip.dataset.example); return; }
  const del = e.target.closest("[data-del]");
  if (del) { deleteProject(Number(del.dataset.del)); renderMenu(); return; }
  const card = e.target.closest("[data-lesson], [data-sim], [data-project], [data-kit]");
  if (!card) return;
  if (card.dataset.kit) go(`kit/${card.dataset.kit}`);
  else if (card.dataset.sim) go("sim");
  else if (card.dataset.project) go(`project/${card.dataset.project}`);
  else go(card.dataset.lesson);
});

ui.menu.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.classList.contains("pj-form")) {
    plan(form.querySelector("textarea").value);
  } else if (form.classList.contains("pj-key")) {
    const gemini = form.querySelector("[name=gemini]").value.trim();
    const claude = form.querySelector("[name=claude]").value.trim();
    try {
      if (claude) saveClaudeKey(claude);
      else await saveGeminiKey(gemini);
      const request = planning?.request;
      planning = null;
      if (request) plan(request); else renderMenu();
    } catch (err) {
      planning = { ...planning, error: err.message };
      renderMenu();
    }
  }
});
ui.menu.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && e.target.matches(".pj-form textarea")) { e.preventDefault(); e.target.form.requestSubmit(); }
});

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- The project tutor ---------------------------------------------------------------

// Designs a project from his words and opens it. `previous` is a plan to change.
export async function plan(request, previous = null) {
  request = String(request ?? "").trim();
  if (!request || (planning && !planning.error && !planning.needKey)) return;
  planning = { request, status: "Thinking…" };
  if (view !== "menu") go("menu");
  else renderMenu();
  ui.menu.scrollTop = 0;
  try {
    const result = await planProject(request, {
      previous,
      onStatus: (t) => { planning.status = t; if (view === "menu") renderMenu(); },
    });
    planning = null;
    saveProject(result);
    go("project/0");
  } catch (err) {
    console.warn("Project planning failed", err);
    planning = err.needKey ? { request, needKey: true } : { request, error: `${err.message} ` };
    if (view === "menu") renderMenu();
  }
}

function projectPlan(sub) {
  if (sub === "example") return { ...checkPlan(PIANO), request: "A piano from an Arduino" };
  return savedProjects()[Number(sub)] ?? null;
}

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
  const project = where.startsWith("project/") ? projectPlan(where.slice(8)) : null;
  const kit = where.startsWith("kit/") ? kitPlan(where.slice(4)) : null;
  if (where === "sim") openSim();
  else if (kit) openLesson(projectLesson(kit));
  else if (project) openLesson(projectLesson(project, { change: (text) => plan(text, project) }));
  else if (LESSONS.some((l) => l.id === where)) openLesson(LESSONS.find((l) => l.id === where));
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

function openLesson(l) {
  view = "lesson";
  lesson = l;
  ctx = new LessonContext(stage, ui);
  state = lesson.setup(ctx);
  ui.lesson.hidden = false;
  $(".ac-lesson-title").textContent = lesson.title;
  $(".ac-lesson-module").textContent = lesson.kit ? `My kit · Lesson ${lesson.kit.n} of ${KIT.lessons.length}` : lesson.custom ? "Project tutor" : `Module ${lesson.moduleIndex + 1} · ${lesson.module.title}`;
  ui.crumbs.innerHTML = `<button class="ac-link" data-act="menu">${lesson.kit ? "My kit" : lesson.custom ? "Projects" : "Course"}</button> › ${esc(lesson.title)}`;
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
  const nextKit = lesson.kit ? KIT.lessons[lesson.kit.n] : null;
  $("[data-act=next]").innerHTML = last ? (lesson.kit ? (nextKit ? `Next: ${esc(nextKit.title)} ▶` : "All lessons ▶") : lesson.custom ? "All projects ▶" : nextLesson ? "Next lesson ▶" : "To the simulator ▶") : "Next ▶";
  if (step.camera) stage.flyTo(step.camera);
  step.enter(ctx, state);
  if (last && lesson.kit) markDone(`kit-${lesson.kit.id}`);
  else if (last && !lesson.custom) markDone(lesson.id);
}

function next() {
  if (view !== "lesson") return;
  if (stepIndex < lesson.steps.length - 1) return goStep(stepIndex + 1);
  if (lesson.kit) { const nk = KIT.lessons[lesson.kit.n]; return go(nk ? `kit/${nk.id}` : "menu"); }
  if (lesson.custom) return go("menu");
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

// At most 60 frames a second: a 120 Hz screen gains nothing from twice the
// drawing but heat. The free space for the view is measured a few times a
// second rather than every frame (measuring the page forces a layout).
const MAX_FPS = 60;
let lastTime = performance.now();
let lastInsets = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!active) { lastTime = now; return; }
  if (now - lastTime < 1000 / MAX_FPS - 2) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  stepTweens(dt * 1000);
  input.update(now);
  if (view === "sim") {
    const first = [...input.hands.values()][0];
    if (first) sim.hover(first.x, first.y);
    sim.frame(dt);
  }
  ctx?.tick(dt);
  if (showcase) showcase.rotation.y += dt * 0.3;
  if (now - lastInsets > 250) { lastInsets = now; updateInsets(); }
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
  startHands();
}

// The hand camera runs only while its switch is on.
function startHands() {
  if (isOn("hands")) input.start();
  else ui.status.textContent = "Hand camera off: mouse and keyboard work";
}
onSwitch("hands", (on) => {
  if (!active) return;
  if (on) input.start();
  else { input.stop(); startHands(); }
});

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
  const kitHit = /\b(my kit|kit lesson|arduino kit)\b/.test(text) ? null : KIT.lessons.find((l) => l.say && new RegExp(`\\b(${l.say})\\b`).test(text) && /\b(open|show|lesson|teach|learn|start)\b/.test(text));
  if (kitHit) { go(`kit/${kitHit.id}`); return `Opening the ${kitHit.title} lesson.`; }
  if (/\b(my kit|arduino kit|kit lessons)\b/.test(text)) { go("menu"); return "Here are the lessons for your kit."; }
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
  if (view === "lesson" && (lesson.custom || lesson.kit)) return lesson.describe(stepIndex);
  if (view === "lesson") return `He is in the Robotics Academy, lesson "${lesson.title}", step ${stepIndex + 1} of ${lesson.steps.length}: "${lesson.steps[stepIndex].title}".`;
  if (view === "sim") return `He is in the Robotics Academy's robot simulator, on the ${sim.mode} tab.`;
  if (planning && !planning.error) return `He is in the Robotics Academy; the project tutor is designing "${planning.request}" for him (it takes about half a minute).`;
  return "He is on the Robotics Academy's course map, where he can also describe a project for the AI tutor to design.";
}

export function route(sub) { go(sub || "menu", { push: false }); }

// For automated checks (?debug in the address): the open lesson's state.
if (new URLSearchParams(location.search).has("debug")) window.__academy = { stage, state: () => state, lesson: () => lesson, goStep: (i) => goStep(i), step: () => stepIndex };
