// CaliCoach main: camera / video / demo loop, HUD, voice, history, progress,
// guide and settings.
import { Coach, PersonalModel, EXERCISES, FAULTS, cueFor, frameVector } from "./engine.js";
import { PoseSource, drawPose, FAULT_JOINTS } from "./pose.js";
import { store, settings } from "./store.js";
import { INFO, ORDER, DRILLS, SOURCES } from "./guide.js";
import { exerciseHistory, overview, recommend, generalAdvice, chart } from "./insights.js";
import { setChart, traceChart, explainFault, ReplayPlayer, faultJoints, scoreColor, nearestRep } from "./replay.js";
import { SIGNAL_LABELS } from "./engine.js";
import { Recorder, subCapture, frameAt } from "./capture.js";
import { Viewer3D, compareKeyFrames } from "./viewer3d.js";
import { getReference, keyFrame, setMyReference, clearMyReference } from "./refs.js";
import { sync } from "./sync.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const exName = (k) => (k === "idle" ? "Not exercising" : EXERCISES[k]?.name ?? k);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtClock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const app = {
  model: null, personal: null, pose: null, poseModel: null,
  cfg: settings.get(),
  src: "camera", file: null,
  run: null, // the running workout
};

// ------------------------------------------------------------ boot
async function boot() {
  buildSelects();
  bindTabs();
  bindSetup();
  bindSettings();
  bindServer();
  sync.takeFromHash();
  routeFromHash();
  window.addEventListener("hashchange", routeFromHash);
  try {
    app.model = await (await fetch("model.json")).json();
  } catch (e) {
    $("#loadStatus").textContent = "Could not load the exercise model.";
  }
  await refreshPersonal();
  renderAbout();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  store.persist();
}

async function refreshPersonal() {
  const ex = await store.examples();
  app.personal = app.model ? new PersonalModel(ex.map((e) => ({ label: e.label, x: e.x })), app.model) : null;
  const counts = {};
  for (const e of ex) counts[e.label] = (counts[e.label] || 0) + 1;
  $("#teachInfo").textContent = ex.length
    ? `Personal examples: ${Object.entries(counts).map(([k, v]) => `${exName(k)} ${v}`).join(", ")}`
    : "No personal examples yet.";
}

function buildSelects() {
  const opts = ORDER.map((k) => `<option value="${k}">${exName(k)}</option>`).join("");
  $("#startEx").innerHTML = `<option value="auto">Auto-detect</option>${opts}`;
  $("#startEx").value = app.cfg.startEx;
  $("#teachEx").innerHTML = `${opts}<option value="idle">Not exercising (rest, walking…)</option>`;
  $("#progEx").innerHTML = opts;
}

// ------------------------------------------------------------ tabs
function bindTabs() {
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.view; }));
}
function routeFromHash() {
  const v = (location.hash || "#train").slice(1);
  show(["train", "history", "progress", "guide", "settings"].includes(v) ? v : "train");
}
function show(v) {
  if (!app.run) closeSheet();
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${v}`));
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  if (v === "history") renderHistory();
  if (v === "progress") renderProgress();
  if (v === "guide") renderGuide();
  if (v === "settings") renderStorage();
}

// ------------------------------------------------------------ setup screen
function bindSetup() {
  $$(".seg[role=radiogroup] button").forEach((b) => b.addEventListener("click", () => {
    $$(".seg[role=radiogroup] button").forEach((x) => x.classList.toggle("on", x === b));
    app.src = b.dataset.src;
    $("#srcCamera").hidden = app.src !== "camera";
    $("#srcFile").hidden = app.src !== "file";
    $("#srcDemo").hidden = app.src !== "demo";
  }));
  $$("#facingSeg button").forEach((b) => {
    b.classList.toggle("on", b.dataset.facing === app.cfg.facing);
    b.addEventListener("click", () => {
      $$("#facingSeg button").forEach((x) => x.classList.toggle("on", x === b));
      app.cfg = settings.set({ facing: b.dataset.facing });
    });
  });
  $("#fileInput").addEventListener("change", (e) => { app.file = e.target.files[0] || null; });
  $("#startEx").addEventListener("change", (e) => { app.cfg = settings.set({ startEx: e.target.value }); });
  $("#btnStart").addEventListener("click", () => startWorkout({}));
  $("#btnPause").addEventListener("click", togglePause);
  $("#btnEndSet").addEventListener("click", () => { if (app.run) app.run.coach.endSet(app.run.t); });
  $("#btnFinish").addEventListener("click", () => finishWorkout());
  $("#btnFlip").addEventListener("click", flipCamera);
  $("#btnCam").addEventListener("click", () => setShowCamera(!app.cfg.showCamera));
  syncCamButton();
  $("#exPill").addEventListener("click", pickExercise);
  $("#sheetBack").addEventListener("click", closeSheet);
}

// ------------------------------------------------------------ voice
const voice = {
  lastCue: {}, unlocked: false,
  unlock() {
    if (this.unlocked || !("speechSynthesis" in window)) return;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); this.unlocked = true; } catch {}
  },
  say(text, { interrupt = false } = {}) {
    if (!("speechSynthesis" in window)) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.08; u.lang = "en-US";
      speechSynthesis.speak(u);
    } catch {}
  },
  cue(key, text) {
    const now = performance.now();
    if (now - (this.lastCue[key] || 0) < 9000) return;
    this.lastCue[key] = now;
    this.say(text);
  },
};

// ------------------------------------------------------------ workout
async function startWorkout({ teach = null }) {
  if (!app.model) { $("#loadStatus").textContent = "The exercise model is still loading…"; return; }
  voice.unlock();
  const src = teach ? "camera" : app.src;
  if (src === "file" && !app.file) { $("#loadStatus").textContent = "Choose a video file first."; return; }
  $("#btnStart").disabled = true;
  try {
    if (src !== "demo") await ensurePose();
  } catch (e) {
    $("#loadStatus").textContent = `Pose tracking failed to start: ${e.message || e}. Check your connection (the model downloads on first use).`;
    $("#btnStart").disabled = false;
    return;
  }
  const forced = teach ? teach : app.cfg.startEx !== "auto" ? app.cfg.startEx : null;
  const run = {
    src, teach, paused: false, t: 0, t0: performance.now(), lastMs: 0, frames: 0, fpsT: performance.now(), fps: 0,
    session: { id: `w${Date.now()}`, start: Date.now(), end: null, source: src, sets: [], _captures: [] },
    recorder: new Recorder(),
    lastLm: null, frameW: 720, frameH: 1280, highlight: [], cueUntil: 0, teachData: null,
  };
  run.coach = new Coach({
    model: app.model, personal: teach ? null : app.personal, forced: forced === "idle" ? null : forced,
    onEvent: (e) => onCoachEvent(run, e),
  });
  app.run = run;
  document.body.classList.add("training");
  $("#setup").hidden = true;
  $("#hud").hidden = false;
  $("#btnFlip").hidden = src !== "camera";
  updatePill();
  $("#repCount").textContent = "0"; $("#cleanCount").textContent = "0";
  try {
    if (src === "camera") await startCamera(app.cfg.facing);
    else if (src === "file") await startFile(app.file);
    else await startDemo(run);
  } catch (e) {
    const blocked = e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "NotFoundError");
    toast(blocked
      ? "Camera unavailable. Open CaliCoach from its own https address (e.g. GitHub Pages) in Safari or Chrome and allow camera access."
      : `Could not start: ${esc(e.message || e)}`, 7000);
    await stopWorkout(false);
    return;
  } finally {
    $("#btnStart").disabled = false;
  }
  syncCamButton();
  if (teach) beginTeach(run, teach);
  requestWakeLock();
  loop();
}

async function ensurePose() {
  if (app.pose && app.poseModel === app.cfg.model) return;
  app.pose?.close();
  $("#loadStatus").textContent = "Loading pose model (first time can take a moment)…";
  const p = new PoseSource(app.cfg.model);
  await p.init();
  app.pose = p; app.poseModel = app.cfg.model;
  $("#loadStatus").textContent = `Pose model ready (${p.stats.delegate}, ${p.stats.thread}).`;
}

async function startCamera(facing) {
  const v = $("#video");
  stopStream();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  v.srcObject = stream; v.src = "";
  v.muted = true;
  await v.play();
  const mirror = facing === "user" && app.cfg.mirror;
  v.classList.toggle("mirror", mirror); $("#overlay").classList.toggle("mirror", mirror);
  v.hidden = false;
}
function stopStream() {
  const v = $("#video");
  if (v.srcObject) { v.srcObject.getTracks().forEach((t) => t.stop()); v.srcObject = null; }
}
async function flipCamera() {
  if (!app.run || app.run.src !== "camera") return;
  app.cfg = settings.set({ facing: app.cfg.facing === "user" ? "environment" : "user" });
  try { await startCamera(app.cfg.facing); } catch (e) { toast("Could not switch camera"); }
}
async function startFile(file) {
  const v = $("#video");
  stopStream();
  v.srcObject = null;
  v.src = URL.createObjectURL(file);
  v.classList.remove("mirror"); $("#overlay").classList.remove("mirror");
  v.playbackRate = 0.5;
  v.hidden = false;
  v.onended = () => finishWorkout();
  await v.play();
  v.playbackRate = 0.5;
}

// ---- demo: generated workouts (lab/make_demo.py) played through the same pipeline
async function startDemo(run) {
  const d = await (await fetch("demo.json")).json();
  const uw = d.units?.world ?? 1, ui = d.units?.image ?? 1;
  for (const s of d.sequences) {
    s.world = s.world.map((f) => f.map((p) => [p[0] * uw, p[1] * uw, p[2] * uw]));
    s.image = s.image.map((f) => f.map((p) => [p[0] * ui, p[1] * ui]));
  }
  $("#video").hidden = true;
  $("#overlay").classList.remove("mirror");
  run.demo = { seqs: d.sequences, si: 0, fi: 0, acc: 0, fps: d.fps || 30, last: performance.now() };
  toast("Demo: generated athletes doing calisthenics. Watch recognition, reps and form cues.");
}

let raf = 0;
function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    const run = app.run;
    if (!run) return;
    raf = requestAnimationFrame(step);
    resizeCanvas();
    if (run.paused) return;
    if (run.demo) return demoStep(run);
    const v = $("#video");
    if (v.readyState < 2 || !v.videoWidth) return;
    run.frameW = v.videoWidth; run.frameH = v.videoHeight;
    let tMs;
    if (run.src === "file") { tMs = Math.round(v.currentTime * 1000); if (v.paused || v.ended) return; }
    else tMs = Math.round(performance.now() - run.t0);
    if (tMs <= run.lastMs) return;
    const sent = app.pose.detect(v, (pose) => onPose(run, pose, tMs / 1000));
    if (sent) run.lastMs = tMs;
    draw(run);
  };
  raf = requestAnimationFrame(step);
}

function demoStep(run) {
  const d = run.demo;
  const now = performance.now();
  d.acc += Math.min(0.1, (now - d.last) / 1000) * (window.__demoSpeed || 1);
  d.last = now;
  while (d.acc >= 1 / d.fps) {
    d.acc -= 1 / d.fps;
    const seq = d.seqs[d.si];
    if (!seq) { finishWorkout(); return; }
    const f = d.fi++;
    if (f >= seq.world.length) { d.si++; d.fi = 0; continue; }
    const lm = seq.image[f].map(([x, y]) => [x, y, 1]);
    run.t += 1 / d.fps;
    onPose(run, { lm, world: seq.world[f] }, run.t);
  }
  run.frameW = 720; run.frameH = 1280;
  draw(run);
}

function onPose(run, pose, t) {
  if (app.run !== run) return;
  run.t = t;
  run.frames++;
  const now = performance.now();
  if (now - run.fpsT > 1000) { run.fps = (run.frames * 1000) / (now - run.fpsT); run.frames = 0; run.fpsT = now; }
  if (!pose) { run.lastLm = null; run.coach.pushEmpty(t); return; }
  run.lastLm = pose.lm;
  run.recorder.push(t, pose.world, pose.lm, run.frameW, run.frameH);
  const vis = pose.lm.map((p) => p[2]);
  const m = run.coach.push(t, pose.world, vis);
  if (run.teachData && run.teachData.recording) {
    run.teachData.t.push(t);
    run.teachData.frames.push(frameVector(m).map((v) => +v.toFixed(4)));
    const x = run.coach.lastWindow;
    if (x && t - run.teachData.lastWin >= 0.25 && run.coach.times.length && t - run.coach.times[0] > 2) {
      run.teachData.lastWin = t;
      run.teachData.windows.push(x);
    }
  }
}

function resizeCanvas() {
  const c = $("#overlay");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}

function draw(run) {
  const c = $("#overlay");
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  // By default the camera picture stays hidden: a calm dark screen with just the skeleton.
  if (run.demo || !app.cfg.showCamera) { ctx.fillStyle = "#0e1216"; ctx.fillRect(0, 0, c.width, c.height); }
  if (run.lastLm) drawPose(ctx, run.lastLm, run.frameW, run.frameH, { highlight: performance.now() < run.cueUntil ? run.highlight : [] });
  updateHud(run);
}

function updateHud(run) {
  const st = run.coach.state();
  const isHold = st.exercise && EXERCISES[st.exercise]?.kind === "hold";
  $("#timer").textContent = fmtTime((Date.now() - run.session.start) / 1000);
  $("#fps").textContent = run.fps ? `${Math.round(run.fps)} fps` : "";
  if (isHold) {
    $("#repCount").textContent = `${Math.floor(st.holdCur || 0)}s`;
    $("#cleanCount").textContent = `${Math.floor(st.hold || 0)}s total,`;
  } else if ($("#repCount").textContent !== String(st.reps)) {
    $("#repCount").textContent = String(st.reps);
    $("#cleanCount").textContent = String(st.clean);
  }
  $("#depthFill").style.height = `${Math.min(100, (st.progress || 0) * 83)}%`;
  updatePill(st);
  if (st.liveCue && FAULTS[st.liveCue]) {
    showCue(cueFor(st.exercise, st.liveCue), false, 700);
    run.highlight = FAULT_JOINTS[st.liveCue] || []; run.cueUntil = performance.now() + 700;
  }
}

function updatePill(st) {
  const run = app.run;
  st = st || run?.coach.state();
  if (!st) return;
  const dot = $("#exDot");
  if (run?.teach) { $("#exName").textContent = `Teaching: ${exName(run.teach)}`; dot.className = "dot lock"; return; }
  if (st.exercise) {
    $("#exName").textContent = exName(st.exercise);
    dot.className = `dot ${st.forced ? "lock" : "live"}`;
  } else {
    $("#exName").textContent = st.guess && st.guess !== "idle" && st.confidence > 0.35 ? `${exName(st.guess)}?` : "Detecting…";
    dot.className = "dot";
  }
}

let cueTimer = 0;
function showCue(text, ok = false, ms = 2600) {
  const el = $("#cue");
  el.textContent = text; el.classList.toggle("ok", ok); el.hidden = false;
  clearTimeout(cueTimer);
  cueTimer = setTimeout(() => { el.hidden = true; }, ms);
}
let toastTimer = 0;
function toast(html, ms = 4200) {
  const el = $("#toast");
  el.innerHTML = html; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function onCoachEvent(run, e) {
  if (app.run !== run) return;
  if (e.type === "rep") {
    const el = $("#repCount");
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    const r = e.rep;
    if (app.cfg.voice && !e.replay) voice.say(String(r.n));
    const lr = $("#lastRep");
    lr.hidden = false;
    lr.innerHTML = `Rep ${r.n}: <span style="color:${r.score >= 85 ? "var(--good)" : r.score >= 60 ? "var(--warn)" : "var(--bad)"}">${r.score}</span>`;
    if (!r.faults.length) showCue(r.n % 5 === 0 ? "Great form, keep going" : "Good rep", true, 1100);
  } else if (e.type === "cue") {
    showCue(e.text);
    run.highlight = FAULT_JOINTS[e.key] || []; run.cueUntil = performance.now() + 2600;
    if (app.cfg.voiceCues) voice.cue(e.key, e.text);
  } else if (e.type === "exercise") {
    updatePill();
    if (!e.manual && app.cfg.voice) voice.say(exName(e.key));
  } else if (e.type === "set") {
    const s = e.set;
    // 3D skeleton capture of the whole set (no video is kept)
    const cap = run.recorder.slice(s.start - 1, s.end + 0.5, {
      exercise: s.exercise, sessionId: run.session.id, setIndex: run.session.sets.length, source: run.src, recordedAt: Date.now(),
      summary: { reps: s.reps, clean: s.clean, score: s.score, hold: s.hold ?? null, faults: s.faults },
    });
    if (cap) {
      cap.reps = (s.repList || []).map((r) => ({ n: r.n, t0: +(r.t0 - cap.t0).toFixed(3), t1: +(r.t1 - cap.t0).toFixed(3), score: r.score, clean: r.clean, faults: r.faults.map((f) => f.key) }));
      run.session._captures.push(cap);
      s.captureId = cap.id;
    }
    s.windows = run.coach.windowLog?.filter((w) => w.t >= s.start - 0.5 && w.t <= s.end).map((w) => w.x) || [];
    run.session.sets.push(s);
    const what = s.kind === "hold" ? `${s.hold}s hold` : `${s.reps} reps (${s.clean} clean)`;
    toast(`<b>Set ${run.session.sets.length} · ${exName(s.exercise)}</b><br>${what} · form ${s.score}`);
    if (app.cfg.voice) voice.say(s.kind === "hold" ? `Set done. ${s.hold} seconds.` : `Set done. ${s.reps} reps, ${s.clean} clean.`);
    $("#repCount").textContent = "0"; $("#cleanCount").textContent = "0";
    $("#lastRep").hidden = true;
  }
}

// The camera keeps running for pose tracking either way; this only shows or hides its picture.
function setShowCamera(on) {
  app.cfg = settings.set({ showCamera: on });
  syncCamButton();
}
function syncCamButton() {
  const on = !!app.cfg.showCamera;
  const b = $("#btnCam");
  b.setAttribute("aria-pressed", String(on));
  b.classList.toggle("on", on);
  b.hidden = !!app.run?.demo;
  $("#video").classList.toggle("unseen", !on);
  const s = $("#setCam");
  if (s) s.checked = on;
}

function togglePause() {
  const run = app.run;
  if (!run) return;
  run.paused = !run.paused;
  $("#btnPause").textContent = run.paused ? "▶" : "❚❚";
  const v = $("#video");
  if (run.src === "file") { if (run.paused) v.pause(); else v.play(); }
  if (run.demo) run.demo.last = performance.now();
}

function pickExercise() {
  const run = app.run;
  if (!run || run.teach) return;
  const cur = run.coach.forced;
  const probs = run.coach.probs;
  const pctOf = (k) => (probs ? Math.round(100 * probs[run.coach.classes.indexOf(k)]) : null);
  openSheet(`
    <h2>Exercise</h2>
    <button class="opt ${!cur ? "on" : ""}" data-k="">Auto-detect <small>recognises what you do</small></button>
    ${ORDER.map((k) => `<button class="opt ${cur === k ? "on" : ""}" data-k="${k}">${exName(k)} <small>${pctOf(k) != null ? `${pctOf(k)}%` : ""}</small></button>`).join("")}
  `);
  $$("#sheetBody .opt").forEach((b) => b.addEventListener("click", () => {
    run.coach.setForced(b.dataset.k || null);
    closeSheet(); updatePill();
  }));
}

async function finishWorkout() {
  const run = app.run;
  if (!run) return;
  run.coach.endSet(run.t);
  if (run.teach) { await stopWorkout(false); return; }
  run.session.end = Date.now();
  await stopWorkout(true);
}

async function stopWorkout(save) {
  const run = app.run;
  app.run = null;
  cancelAnimationFrame(raf);
  stopStream();
  const v = $("#video");
  try { v.pause(); } catch {}
  if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute("src"); v.load(); }
  v.onended = null;
  releaseWakeLock();
  document.body.classList.remove("training");
  $("#hud").hidden = true; $("#setup").hidden = false; $("#cue").hidden = true; $("#toast").hidden = true;
  $("#btnPause").textContent = "❚❚";
  const ctx = $("#overlay").getContext("2d"); ctx.clearRect(0, 0, 9999, 9999);
  if (save && run && run.session.sets.length) showSummary(run.session, true);
  else if (save) toast("No sets recorded.", 2500);
}

// ---- end-of-workout summary, with corrections that teach the model
function showSummary(session, fresh, scrollTo = 0) {
  app.summary = { session, fresh };
  const sets = session.sets;
  const totalReps = sets.reduce((a, s) => a + s.reps, 0);
  openSheet(`
    <h2>${fresh ? "Workout done" : fmtDate(session.start)}</h2>
    <div class="stats">
      <div class="stat"><b>${sets.length}</b><span>sets</span></div>
      <div class="stat"><b>${totalReps}</b><span>reps</span></div>
      <div class="stat"><b>${fmtTime(((session.end || Date.now()) - session.start) / 1000)}</b><span>time</span></div>
    </div>
    ${sets.map((s, i) => setCard(s, i, fresh)).join("")}
    ${fresh && session.source === "demo" && !window.__allowDemoSave ? `<p class="hint">Demo workouts are not saved to your history.</p><button class="primary" id="btnDiscard">Close</button>`
      : fresh ? `<button class="primary" id="btnSave">Save workout</button><button class="link danger" id="btnDiscard">Discard</button>`
      : `<button class="link danger" id="btnDelete">Delete this workout</button>`}
  `);
  $("#sheet").scrollTop = scrollTo;
  $$("#sheetBody svg.repchart").forEach((svg) => svg.addEventListener("click", (ev) => {
    const ri = nearestRep(svg, ev.clientX, ev.clientY);
    if (ri != null) openRep(+svg.dataset.set, ri, $("#sheet").scrollTop);
  }));
  $$("#sheetBody tr.reprow, #sheetBody .btnWorst").forEach((el) => el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openRep(+el.dataset.set, +el.dataset.rep, $("#sheet").scrollTop);
  }));
  if (fresh) {
    $$("#sheetBody select.relabel").forEach((sel) => sel.addEventListener("change", () => {
      const s = sets[+sel.dataset.i];
      s.relabelFrom = s.relabelFrom || s.exercise;
      s.exercise = sel.value;
    }));
    $("#btnSave")?.addEventListener("click", async () => {
      const learn = [];
      for (const s of sets) {
        if (s.relabelFrom && s.windows?.length) for (const x of s.windows) learn.push({ label: s.exercise, x, t: Date.now(), from: "correction" });
        delete s.windows;
      }
      const keep = sets.filter((s) => s.exercise !== "idle");
      session.sets = keep;
      if (learn.length) { await store.addExamples(learn); await refreshPersonal(); }
      const caps = (session._captures || []).filter((c) => keep.some((s) => s.captureId === c.id));
      for (const c of caps) { const s = keep.find((x) => x.captureId === c.id); c.exercise = s.exercise; c.setIndex = keep.indexOf(s); await store.saveCapture(c); }
      const { _captures, ...plain } = session;
      if (keep.length) await store.saveSession(plain);
      if (keep.length) sync.queueAfterSave();
      closeSheet();
      toast(learn.length ? `Saved. Learned from ${learn.length} corrected samples.` : "Workout saved.", 2500);
    });
    $("#btnDiscard").addEventListener("click", closeSheet);
  } else {
    $("#btnDelete").addEventListener("click", async () => {
      if ($("#btnDelete").dataset.armed) { await store.deleteSession(session.id); await store.deleteCapturesOf(session.id); closeSheet(); renderHistory(); }
      else { $("#btnDelete").dataset.armed = "1"; $("#btnDelete").textContent = "Tap again to delete"; }
    });
  }
}

const tracked = (s) => (s.repList || []).filter((r) => r.trace?.k?.length > 1);
function worstButton(s, i) {
  const t = tracked(s);
  if (!t.length) return "";
  const worst = t.reduce((a, b) => (b.score < a.score ? b : a));
  const ri = s.repList.indexOf(worst);
  const label = worst.score >= 85 ? `Replay rep ${worst.n}` : `Replay worst rep (#${worst.n}, ${worst.score})`;
  return `<button class="secondary btnWorst" data-set="${i}" data-rep="${ri}" style="width:100%;margin-top:6px">▶ ${label}</button>`;
}

// ---- one rep: replay + angle graphs + what went wrong
let player = null, viewer = null;
async function openRep(si, ri, backScroll) {
  const { session, fresh } = app.summary;
  const set = session.sets[si];
  const ex = set.relabelFrom || set.exercise;
  const spec = EXERCISES[ex];
  const r = set.repList[ri];
  const tr = r.trace;
  player?.destroy(); viewer?.destroy(); player = viewer = null;
  // the 3D capture of this rep, and the perfect-form reference
  const cap = session._captures?.find((c) => c.id === set.captureId) || (set.captureId ? await store.capture(set.captureId) : null);
  const cr = cap?.reps?.find((x) => x.n === r.n);
  let sub = null, subStart = 0, keyUser = 0, ref = null, keyRef = 0;
  if (cap && cr) {
    const a0 = Math.max(0, cr.t0 - 0.15);
    subStart = cap.t[frameAt(cap, a0)];
    sub = subCapture(cap, a0, cr.t1 + 0.15);
    sub.exercise = ex;
    keyUser = keyFrame(sub, ex);
    ref = await getReference(ex, sub);
    if (ref) keyRef = keyFrame(ref.cap, ex);
  }
  const iMin = tr.s.indexOf(Math.min(...tr.s));
  const main = traceChart(tr, tr.s, {
    id: "tcMain", label: SIGNAL_LABELS[spec.signal] || spec.signal,
    limits: [
      spec.chart?.depth != null && { v: spec.chart.depth, label: `target ≤ ${spec.chart.depth}°`, color: "#49d17d" },
      spec.chart?.lock != null && { v: spec.chart.lock, label: `lockout ≥ ${spec.chart.lock}°`, color: "#5fb4ff" },
    ].filter(Boolean),
  });
  const sec = spec.secondary;
  const isAngle = sec?.unit === "°";
  const second = sec ? traceChart(tr, tr.x, {
    id: "tcSec", label: sec.label, unit: sec.unit || "", angle: isAngle, height: 120,
    limits: [
      sec.lo != null && { v: sec.lo, label: `limit ${sec.lo}${sec.unit || ""}`, color: "#ff5f5f" },
      sec.hi != null && { v: sec.hi, label: `limit ${sec.hi}${sec.unit || ""}`, color: "#ff5f5f" },
    ].filter(Boolean),
  }) : null;
  const faults = r.faults.filter((f) => FAULTS[f.key]);
  const prev = ri > 0 && set.repList[ri - 1].trace ? ri - 1 : null;
  const next = ri < set.repList.length - 1 && set.repList[ri + 1].trace ? ri + 1 : null;
  const frames = sub ? sub.frames : tr.k?.length || 1;
  const view3d = sub ? `
    <div class="v3d"><canvas id="v3dCanvas"></canvas><div id="v3dLabels" class="v3dlabels"></div>
      <div class="v3dviews">${["side", "front", "three", "top"].map((v) => `<button data-view="${v}">${{ side: "Side", front: "Front", three: "3/4", top: "Top" }[v]}</button>`).join("")}</div>
    </div>
    <div class="legend" style="margin-top:6px"><span><i style="background:#e6e9ee"></i>You</span><span><i style="background:#cfe98f"></i>your left side</span>${ref ? `<span><i style="background:#5fb4ff"></i>perfect form</span>` : ""}<span><i style="background:#ff5a5a"></i>fault</span></div>
    <div class="toggles">
      ${ref ? `<label class="toggle"><input type="checkbox" id="tgGhost" checked><span>Perfect-form ghost</span></label>` : ""}
      <label class="toggle"><input type="checkbox" id="tgTrail" checked><span>Movement path</span></label>
    </div>` : `<div class="replay"><canvas id="replayCanvas"></canvas></div>`;
  openSheet(`
    <button class="link" id="repBack">‹ Back to ${fresh ? "workout" : "summary"}</button>
    <div class="row" style="margin:4px 0 8px"><h2 style="margin:0">${exName(ex)} · rep ${r.n}${r.side ? ` (${r.side} leg)` : ""}</h2>
      <span class="chip" style="color:${scoreColor(r.score)}">score ${r.score}</span></div>
    ${view3d}
    <div class="playbar">
      <button class="round" id="rpPlay" aria-label="Play">▶</button>
      <input type="range" id="rpSeek" min="0" max="${frames - 1}" value="0" aria-label="Position">
      <button class="secondary" id="rpSpeed">0.5×</button>
    </div>
    <p class="hint" style="margin-top:2px">${sub ? "Drag to rotate, pinch to zoom." : "Grey ghost = deepest point of the rep."} ${faults.length ? "Red = where the fault is." : ""}</p>
    ${sub && ref ? `<div class="card" id="cmpCard"></div>` : ""}
    ${main.html}${second ? second.html : ""}
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${r.bottom}°</b><span>bottom</span></div>
      <div class="stat"><b>${r.top}°</b><span>top</span></div>
      <div class="stat"><b>${r.ecc}/${r.con}s</b><span>down / up</span></div>
    </div>
    <div class="card">
      <h2>${faults.length ? "What to fix" : "Clean rep ✓"}</h2>
      ${faults.length ? faults.map((f) => `<div class="rec"><b>${FAULTS[f.key].label}</b><p>${explainFault(ex, f)}</p><p>${cueFor(ex, f.key)}. ${DRILLS[f.key] || ""}</p></div>`).join("")
        : `<p class="hint">Full range, locked out, good body line and controlled tempo.</p>`}
    </div>
    ${sub ? `<button class="secondary" id="btnMakeRef" style="width:100%">☆ Use this rep as my perfect-form reference</button>
      ${ref?.source === "yours" ? `<button class="link" id="btnClearRef">Go back to the standard reference</button>` : ""}
      ${ref ? `<p class="hint">Reference: ${esc(ref.source === "yours" ? "your own rep" : ref.source === "generated" ? "generated textbook rep (until real videos are added)" : "from video")}.</p>` : ""}` : ""}
    <div class="btns">
      <button class="secondary" id="repPrev" ${prev == null ? "disabled" : ""}>${prev != null ? `‹ Rep ${set.repList[prev].n}` : "First rep"}</button>
      <button class="secondary" id="repNext" ${next == null ? "disabled" : ""}>${next != null ? `Rep ${set.repList[next].n} ›` : "Last rep"}</button>
    </div>
  `);
  const leave = () => { player?.destroy(); viewer?.destroy(); player = viewer = null; };
  $("#repBack").addEventListener("click", () => { leave(); showSummary(session, fresh, backScroll); });
  $("#repPrev").addEventListener("click", () => prev != null && openRep(si, prev, backScroll));
  $("#repNext").addEventListener("click", () => next != null && openRep(si, next, backScroll));
  const sheet = $("#sheetBody");
  const seek = $("#rpSeek");
  // map a 3D frame to the nearest sample of the 2D traces
  const traceIdx = (i) => {
    if (!sub) return i;
    const tRep = sub.t[i] + subStart - cr.t0;
    let best = 0;
    tr.t.forEach((t, k) => { if (Math.abs(t - tRep) < Math.abs(tr.t[best] - tRep)) best = k; });
    return best;
  };
  const onFrame = (i) => { const k = traceIdx(i); main.move(sheet, k); second?.move(sheet, k); seek.value = i; };
  let ctl;
  if (sub) {
    try {
      viewer = new Viewer3D($("#v3dCanvas"), { onFrame, labelEl: $("#v3dLabels") });
      viewer.setCapture(sub, { exercise: ex, highlight: faultJoints(r, ex), reference: ref?.cap, keyUser, keyRef });
      viewer.setView(spec.view === "front" ? "three" : "side");
      ctl = viewer;
      $$(".v3dviews button").forEach((b) => b.addEventListener("click", () => viewer.setView(b.dataset.view)));
      $("#tgGhost")?.addEventListener("change", (e) => { viewer.showGhost = e.target.checked; viewer.draw(); });
      $("#tgTrail").addEventListener("change", (e) => { viewer.showTrail = e.target.checked; viewer.draw(); });
      if (ref) {
        const rows = compareKeyFrames(viewer.frames[keyUser], viewer.ref[keyUser], ex).slice(0, 4);
        $("#cmpCard").innerHTML = `<h2>You vs perfect form <small class="hint">(deepest point)</small></h2>
          <table class="reps"><tr><th></th><th>You</th><th>Perfect</th><th>Diff</th></tr>
          ${rows.map((x) => `<tr><td>${x.label}</td><td>${x.you}${x.unit}</td><td>${x.ref}${x.unit}</td><td style="color:${Math.abs(x.diff) > 15 ? "var(--bad)" : Math.abs(x.diff) > 7 ? "var(--warn)" : "var(--good)"}">${x.diff > 0 ? "+" : ""}${x.diff}${x.unit}</td></tr>`).join("")}</table>
          <button class="link" id="btnKey">Jump to the deepest point</button>`;
        $("#btnKey").addEventListener("click", () => { viewer.pause(); $("#rpPlay").textContent = "▶"; viewer.seek(keyUser); });
      }
    } catch (e) {
      console.warn("3D view unavailable", e);
      $(".v3d").outerHTML = `<p class="hint">3D view isn't available on this device.</p>`;
    }
    $("#btnMakeRef").addEventListener("click", async () => {
      const { t0, ...clean } = sub;
      await setMyReference(ex, { ...clean, reps: [] }, `Your rep ${r.n} from ${fmtDate(session.start)} (score ${r.score})`);
      toast("Saved as your perfect-form reference for this exercise.", 2500);
      openRep(si, ri, backScroll);
    });
    $("#btnClearRef")?.addEventListener("click", async () => { await clearMyReference(ex); openRep(si, ri, backScroll); });
  }
  if (!ctl && tr.k?.length > 1) {
    const canvas = $("#replayCanvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
    player = new ReplayPlayer(canvas, tr, { highlight: faultJoints(r, ex), iMin, onFrame });
    ctl = player;
    ctl.seek(0);
  }
  if (!ctl) return;
  ctl.onEnd = () => { $("#rpPlay").textContent = "▶"; };
  $("#rpPlay").addEventListener("click", () => {
    if (ctl.playing) { ctl.pause(); $("#rpPlay").textContent = "▶"; }
    else { ctl.play(); $("#rpPlay").textContent = "❚❚"; }
  });
  seek.addEventListener("input", () => { ctl.pause(); $("#rpPlay").textContent = "▶"; ctl.seek(+seek.value); });
  $("#rpSpeed").addEventListener("click", (e) => {
    ctl.speed = ctl.speed === 0.5 ? 1 : ctl.speed === 1 ? 0.25 : 0.5;
    e.target.textContent = `${ctl.speed}×`;
  });
  ctl.play(); $("#rpPlay").textContent = "❚❚";
}

function setCard(s, i, editable) {
  const faults = Object.entries(s.faults || {}).filter(([k]) => FAULTS[k]).sort((a, b) => b[1] - a[1]);
  const head = s.kind === "hold" ? `${s.hold}s hold (best ${s.best}s)` : `${s.reps} reps · ${s.clean} clean`;
  const reps = (s.repList || []).map((r, ri) => `<tr class="${r.trace?.k ? "reprow" : ""}" data-set="${i}" data-rep="${ri}"><td>${r.n}${r.side ? ` <small>${r.side[0].toUpperCase()}</small>` : ""}</td><td>${r.score}</td><td>${r.bottom}°</td><td>${r.ecc}/${r.con}s</td><td>${r.faults.filter((f) => FAULTS[f.key]).map((f) => FAULTS[f.key].label).join(", ") || "✓"}</td></tr>`).join("");
  return `<div class="card">
    <div class="row" style="margin:0 0 6px"><b>${i + 1}. ${exName(s.exercise)}</b><span class="chip ${s.score >= 85 ? "good" : s.score >= 60 ? "warn" : "bad"}">form ${s.score}</span></div>
    <div class="hint" style="margin:0">${head}${s.tempo ? ` · ${s.tempo}s per rep` : ""}</div>
    ${faults.length ? `<div class="m" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${faults.map(([k, v]) => `<span class="chip warn">${FAULTS[k].label} ×${v}</span>`).join("")}</div>` : ""}
    ${tracked(s).length ? `${setChart({ ...s, exercise: s.relabelFrom || s.exercise }, i)}${worstButton(s, i)}` : ""}
    ${reps ? `<details><summary class="hint">Rep details${tracked(s).length ? " (tap a rep to replay)" : ""}</summary><table class="reps"><tr><th>#</th><th>Score</th><th>Bottom</th><th>Down/up</th><th>Notes</th></tr>${reps}</table></details>` : ""}
    ${editable ? `<div class="row" style="margin-bottom:0"><label>Wrong exercise?</label><select class="relabel" data-i="${i}">${ORDER.concat("idle").map((k) => `<option value="${k}" ${k === s.exercise ? "selected" : ""}>${exName(k)}</option>`).join("")}</select></div>` : ""}
  </div>`;
}

// ---- teaching: record labelled examples
function beginTeach(run, label) {
  run.teachData = { label, recording: false, t: [], frames: [], windows: [], lastWin: 0 };
  let n = 5;
  const tick = () => {
    if (app.run !== run) return;
    if (n > 0) { showCue(`Get in position… ${n}`, true, 1100); if (app.cfg.voice) voice.say(String(n)); n--; setTimeout(tick, 1000); return; }
    run.teachData.recording = true;
    showCue(label === "idle" ? "Recording: move around normally" : `Recording: do ${exName(label).toLowerCase()}s`, true, 3000);
    if (app.cfg.voice) voice.say("Go");
    setTimeout(async () => {
      if (app.run !== run) return;
      const td = run.teachData;
      td.recording = false;
      const ex = td.windows.map((x) => ({ label, x, t: Date.now(), from: "teach" }));
      if (ex.length) {
        await store.addExamples(ex);
        await store.addClip({ label, t: td.t, frames: td.frames, date: Date.now() });
      }
      if (app.cfg.voice) voice.say("Done");
      await stopWorkout(false);
      await refreshPersonal();
      location.hash = "settings";
      toast(ex.length ? `Saved ${ex.length} examples of ${exName(label)}.` : "Nobody was detected. Try again with your whole body in view.", 3500);
    }, 20000);
  };
  tick();
}

// ---- wake lock
let wakeLock = null;
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {} }
function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && app.run) requestWakeLock(); });

// ------------------------------------------------------------ sheet
function openSheet(html) {
  $("#sheetBody").innerHTML = html;
  $("#sheet").hidden = false; $("#sheetBack").hidden = false;
  $("#sheet").scrollTop = 0;
}
function closeSheet() { player?.destroy(); viewer?.destroy(); player = viewer = null; $("#sheet").hidden = true; $("#sheetBack").hidden = true; }

// ------------------------------------------------------------ history
async function renderHistory() {
  const sessions = await store.sessions();
  const el = $("#historyList");
  if (!sessions.length) { el.innerHTML = `<div class="empty">No workouts yet.<br>Start one from the Train tab.</div>`; return; }
  el.innerHTML = sessions.map((s, i) => {
    const reps = s.sets.reduce((a, x) => a + x.reps, 0);
    const byEx = {};
    for (const x of s.sets) byEx[x.exercise] = (byEx[x.exercise] || 0) + (x.kind === "hold" ? x.hold : x.reps);
    const scored = s.sets.filter((x) => x.reps);
    const score = scored.length ? Math.round(scored.reduce((a, x) => a + x.score * x.reps, 0) / Math.max(1, reps)) : null;
    return `<div class="item" data-i="${i}">
      <div class="t"><span>${fmtDate(s.start)} · ${fmtClock(s.start)}</span><span>${s.sets.length} sets${score != null ? ` · form ${score}` : ""}${s.source === "demo" ? " · demo" : ""}</span></div>
      <div class="m">${Object.entries(byEx).map(([k, v]) => `<span class="chip">${exName(k)} ${EXERCISES[k]?.kind === "hold" ? `${v}s` : `×${v}`}</span>`).join("")}</div>
    </div>`;
  }).join("");
  $$("#historyList .item").forEach((it) => it.addEventListener("click", () => showSummary(sessions[+it.dataset.i], false)));
}

// ------------------------------------------------------------ progress
$("#progEx")?.addEventListener("change", () => renderProgress());
async function renderProgress() {
  const sessions = await store.sessions();
  const o = overview(sessions);
  const gen = generalAdvice(sessions);
  $("#overview").innerHTML = `
    <div class="stats">
      <div class="stat"><b>${o.workouts7}</b><span>workouts, 7 days</span></div>
      <div class="stat"><b>${o.reps7}</b><span>reps, 7 days</span></div>
      <div class="stat"><b>${o.avgScore ?? "–"}</b><span>avg form, 7 days</span></div>
    </div>
    ${o.streak ? `<p class="hint">🔥 ${o.streak}-week streak</p>` : ""}
    ${gen.map((r) => `<div class="rec"><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join("")}`;
  const sel = $("#progEx");
  if (!sel.dataset.init) {
    const counts = {};
    for (const s of sessions) for (const x of s.sets) counts[x.exercise] = (counts[x.exercise] || 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) sel.value = best[0];
    sel.dataset.init = "1";
  }
  const ex = sel.value;
  const rows = exerciseHistory(sessions, ex);
  const recs = recommend(sessions, ex);
  const isHold = EXERCISES[ex].kind === "hold";
  const labels = rows.map((r) => new Date(r.date).toLocaleDateString(undefined, { day: "numeric", month: "numeric" }));
  let html = `<div class="card"><h2>What to do next</h2>${recs.map((r) => `<div class="rec"><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join("")}</div>`;
  if (rows.length) {
    html += `<div class="card"><h2>${isHold ? "Best hold (s)" : "Best clean set"}</h2>${chart(rows.map((r) => (isHold ? r.best : r.bestSet)), { labels })}</div>`;
    html += `<div class="card"><h2>Form score</h2>${chart(rows.map((r) => r.score), { labels, max: 100, color: "#5fb4ff" })}</div>`;
    html += `<div class="card"><h2>${isHold ? "Total hold time (s)" : "Total reps"}</h2>${chart(rows.map((r) => (isHold ? r.hold : r.reps)), { labels, type: "bar", color: "#8b96a5" })}</div>`;
    const faults = {};
    let n = 0;
    for (const r of rows.slice(-5)) { n += isHold ? r.hold : r.reps; for (const [k, v] of Object.entries(r.faults)) faults[k] = (faults[k] || 0) + v; }
    const fl = Object.entries(faults).filter(([k]) => FAULTS[k]).sort((a, b) => b[1] - a[1]);
    html += `<div class="card"><h2>Common faults <small class="hint">(last 5 sessions)</small></h2>${fl.length ? fl.map(([k, v]) => `
      <div class="row" style="margin:4px 0"><span>${FAULTS[k].label}</span><span class="hint">${isHold ? `${v}s` : `${Math.round((100 * v) / Math.max(1, n))}% of reps`}</span></div>
      <div class="bar-h"><i style="width:${Math.min(100, (100 * v) / Math.max(1, n))}%"></i></div>`).join("") : `<p class="hint">No faults recorded. Nice.</p>`}</div>`;
  }
  $("#progress").innerHTML = html;
}

// ------------------------------------------------------------ guide
function renderGuide() {
  const el = $("#guide");
  if (el.dataset.done) return;
  el.dataset.done = "1";
  el.innerHTML = ORDER.map((k) => {
    const g = INFO[k], spec = EXERCISES[k];
    const checks = spec.detects || [];
    return `<details class="card guide-ex"><summary>${exName(k)}</summary>
      <h3>Camera</h3><p class="hint">${esc(g.camera)}</p>
      <h3>Good form</h3><ul>${g.standards.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <h3>What the app checks</h3><ul>${checks.filter((c) => FAULTS[c]).map((c) => `<li><b>${FAULTS[c].label}</b> – ${esc(DRILLS[c] || FAULTS[c].cue)}</li>`).join("")}</ul>
      <h3>Progression</h3><ul><li>Goal: ${g.target} ${g.unit}</li><li>Easier: ${esc(g.easier)}</li><li>Harder: ${esc(g.harder)}</li></ul>
    </details>`;
  }).join("") + `<div class="card sources"><h2>Sources</h2>${SOURCES.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join("")}</div>`;
}

// ------------------------------------------------------------ settings
function bindSettings() {
  const c = app.cfg;
  $("#setVoice").checked = c.voice; $("#setVoiceCues").checked = c.voiceCues; $("#setMirror").checked = c.mirror; $("#setModel").value = c.model;
  $("#setVoice").addEventListener("change", (e) => { app.cfg = settings.set({ voice: e.target.checked }); });
  $("#setVoiceCues").addEventListener("change", (e) => { app.cfg = settings.set({ voiceCues: e.target.checked }); });
  $("#setMirror").addEventListener("change", (e) => { app.cfg = settings.set({ mirror: e.target.checked }); });
  $("#setCam").addEventListener("change", (e) => setShowCamera(e.target.checked));
  $("#setModel").addEventListener("change", (e) => { app.cfg = settings.set({ model: e.target.value }); });
  $("#btnTeach").addEventListener("click", () => { location.hash = "train"; startWorkout({ teach: $("#teachEx").value }); });
  $("#btnClearTeach").addEventListener("click", async (e) => {
    if (!e.target.dataset.armed) { e.target.dataset.armed = "1"; e.target.textContent = "Tap again to forget"; return; }
    await store.clearExamples(); await refreshPersonal();
    e.target.dataset.armed = ""; e.target.textContent = "Forget my examples";
  });
  $("#btnExport").addEventListener("click", async () => {
    const data = { app: "calicoach", version: 1, exported: new Date().toISOString(), sessions: await store.sessions(), examples: await store.examples() };
    download(`calicoach-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), "application/json");
  });
  $("#btnExportCsv").addEventListener("click", async () => {
    const lines = ["date,exercise,set,rep,score,clean,bottom_deg,top_deg,down_s,up_s,faults"];
    for (const s of await store.sessions()) s.sets.forEach((x, si) => (x.repList || []).forEach((r) => {
      lines.push([new Date(s.start).toISOString(), x.exercise, si + 1, r.n, r.score, r.clean, r.bottom, r.top, r.ecc, r.con, `"${r.faults.map((f) => f.key).join(" ")}"`].join(","));
    }));
    download(`calicoach-reps-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"), "text/csv");
  });
  $("#btnExportTrain").addEventListener("click", async () => {
    const clips = await store.clips();
    if (!clips.length) { $("#storageInfo").textContent = "No training clips yet: record some with “Teach it your form”."; return; }
    download(`calicoach-training-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: "calicoach-clips-1", frame_features: app.model?.frame_features, clips }), "application/json");
  });
  $("#importInput").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "calicoach") throw new Error("not a CaliCoach backup");
      for (const s of d.sessions || []) await store.saveSession(s);
      if (d.examples?.length) await store.addExamples(d.examples.map(({ id, ...rest }) => rest));
      await refreshPersonal();
      $("#storageInfo").textContent = `Imported ${d.sessions?.length || 0} workouts.`;
    } catch (err) { $("#storageInfo").textContent = `Import failed: ${err.message}`; }
    e.target.value = "";
  });
  $("#btnWipe").addEventListener("click", async (e) => {
    if (!e.target.dataset.armed) { e.target.dataset.armed = "1"; e.target.textContent = "Tap again to delete everything"; return; }
    await store.clearSessions();
    e.target.dataset.armed = ""; e.target.textContent = "Delete all workouts";
    renderStorage();
  });
}

// ---- server (Supabase)
function bindServer() {
  const c = app.cfg;
  $("#sbUrl").value = c.sbUrl; $("#sbKey").value = c.sbKey; $("#sbEmail").value = c.sbEmail; $("#setAutoUpload").checked = c.autoUpload;
  const save = () => { app.cfg = settings.set({ sbUrl: $("#sbUrl").value.trim(), sbKey: $("#sbKey").value.trim(), sbEmail: $("#sbEmail").value.trim() }); };
  ["#sbUrl", "#sbKey", "#sbEmail"].forEach((s) => $(s).addEventListener("change", save));
  $("#setAutoUpload").addEventListener("change", (e) => { app.cfg = settings.set({ autoUpload: e.target.checked }); });
  const status = (t) => { $("#sbStatus").textContent = t; };
  $("#btnSbCode").addEventListener("click", async () => {
    save();
    if (!sync.configured()) return status("Enter the project URL and anon key first.");
    if (!app.cfg.sbEmail) return status("Enter your email.");
    try { await sync.sendCode(app.cfg.sbEmail); $("#sbCodeRow").hidden = false; status("Code sent. Check your email (also spam)."); }
    catch (e) { status(`Could not send the code: ${e.message}`); }
  });
  $("#btnSbVerify").addEventListener("click", async () => {
    try { await sync.verify(app.cfg.sbEmail, $("#sbCode").value); status("Signed in."); renderServer(); sync.queueAfterSave(); }
    catch (e) { status(`Sign-in failed: ${e.message}`); }
  });
  $("#btnSbOut").addEventListener("click", () => { sync.signOut(); renderServer(); });
  $("#btnSbUpload").addEventListener("click", async () => {
    status("Uploading…");
    try {
      const r = await sync.uploadPending((p) => status(`Uploading… ${p.sessions + p.captures}/${p.total}`));
      status(r.captures + r.sessions ? `Uploaded ${r.sessions} workouts and ${r.captures} 3D captures (${(r.bytes / 1024).toFixed(0)} KB).` : "Everything is already uploaded.");
    } catch (e) { status(`Upload failed: ${e.message}`); }
  });
  sync.onChange((s) => {
    renderServer();
    if (s.error) status(`Background upload failed: ${s.error}`);
    else if (s.last && s.last.captures + s.last.sessions) status(`Uploaded ${s.last.sessions} workouts and ${s.last.captures} 3D captures.`);
  });
  renderServer();
}
async function renderServer() {
  const inn = sync.signedIn();
  $("#sbSignedOut").hidden = inn; $("#sbSignedIn").hidden = !inn;
  $("#sbWho").textContent = sync.user()?.email || "…";
  if (inn) {
    const p = await sync.pending();
    if (!$("#sbStatus").textContent || $("#sbStatus").textContent.startsWith("Waiting")) $("#sbStatus").textContent = p.caps.length + p.sessions.length ? `Waiting to upload: ${p.sessions.length} workouts, ${p.caps.length} 3D captures.` : "";
  }
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function renderStorage() {
  const n = (await store.sessions()).length;
  const est = await store.estimate();
  $("#storageInfo").textContent = `${n} workout${n === 1 ? "" : "s"} stored${est?.usage ? ` · ${(est.usage / 1048576).toFixed(1)} MB used` : ""}.`;
}

function renderAbout() {
  const m = app.model?.meta;
  $("#about").innerHTML = `CaliCoach recognises ${ORDER.length} calisthenics exercises from MediaPipe Pose landmarks.
  The recognition model is a small neural network trained on biomechanically generated calisthenics motion
  ${m ? `(test accuracy ${(m.test_accuracy * 100).toFixed(1)}% on generated data, trained ${m.trained})` : ""};
  your own recorded examples adapt it to you. Form checks follow published coaching standards (see Guide).
  It is a training aid, not medical advice.`;
}

boot();
