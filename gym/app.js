// CaliCoach controller. Flow: Home → (framing check → countdown) → hands-free
// training → automatic report with analytics. Plus Analytics/history, Guide and
// Settings. The camera picture stays hidden by default: only the skeleton shows.
import { Coach, PersonalModel, EXERCISES, FAULTS, cueFor, frameVector, SIGNAL_LABELS } from "./engine.js";
import { PoseSource, drawPose, FAULT_JOINTS } from "./pose.js";
import { store, settings } from "./store.js";
import { INFO, ORDER, DRILLS, SOURCES } from "./guide.js";
import { exerciseHistory, overview, recommend, generalAdvice, chart } from "./insights.js";
import { setChart, traceChart, explainFault, ReplayPlayer, faultJoints, scoreColor, nearestRep } from "./replay.js";
import { Recorder, subCapture, frameAt } from "./capture.js";
import { Viewer3D, compareKeyFrames } from "./viewer3d.js";
import { getReference, keyFrame, setMyReference, clearMyReference } from "./refs.js";
import { sync } from "./sync.js";
import { analyse, timelineSVG, rhythmSVG, totals, exColor, scoreHue, fmtDur, fmtSec } from "./analytics.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const exName = (k) => (k === "idle" ? "Not exercising" : EXERCISES[k]?.name ?? k);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtClock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const RING = 578; // circumference of the HUD ring (r = 92)
const REST_AFTER = 4; // seconds without a rep before the HUD switches to the rest timer
const AUTO_END = 30; // seconds out of view (after at least one set) before the workout finishes itself

const app = {
  model: null, personal: null, pose: null, poseModel: null,
  cfg: settings.get(),
  run: null, // the running workout
  report: null, // { session, fresh, saved, windows }
};

// ------------------------------------------------------------ boot
async function boot() {
  bindHome();
  bindTrain();
  bindSettings();
  bindServer();
  sync.takeFromHash();
  window.addEventListener("hashchange", routeFromHash);
  routeFromHash();
  try {
    app.model = await (await fetch("model.json")).json();
  } catch (e) {
    $("#loadStatus").textContent = "Couldn't load the exercise model. Check your connection and reload.";
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
    ? `Your examples: ${Object.entries(counts).map(([k, v]) => `${exName(k)} ${v}`).join(", ")}`
    : "No personal examples yet.";
}

// ------------------------------------------------------------ routing
function routeFromHash() {
  const h = (location.hash || "#home").slice(1);
  const [v, arg] = h.split("/");
  if (app.run) { show("train"); return; }
  if (v === "report" && arg) { openReport(decodeURIComponent(arg)); return; }
  show(["home", "history", "guide", "settings"].includes(v) ? v : "home");
}
function show(v) {
  if (v !== "report") closeSheet();
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${v}`));
  window.scrollTo(0, 0);
  if (v === "home") renderHome();
  if (v === "history") renderHistory();
  if (v === "guide") renderGuide();
  if (v === "settings") renderStorage();
}

// ------------------------------------------------------------ home
function bindHome() {
  const chips = [["auto", "Auto-detect"], ...ORDER.map((k) => [k, exName(k)])];
  $("#exChips").innerHTML = chips.map(([k, n]) => `<button class="chip" role="radio" data-k="${k}">${esc(n)}</button>`).join("");
  const syncChips = () => $$("#exChips .chip").forEach((b) => {
    const on = b.dataset.k === app.cfg.startEx;
    b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on));
  });
  syncChips();
  $$("#exChips .chip").forEach((b) => b.addEventListener("click", () => { app.cfg = settings.set({ startEx: b.dataset.k }); syncChips(); }));
  const syncOpts = () => {
    $("#facingLabel").textContent = app.cfg.facing === "user" ? "Front camera" : "Back camera";
    $("#voiceState").textContent = app.cfg.voice ? "On" : "Off";
    $("#voiceState").classList.toggle("off", !app.cfg.voice);
    $("#optVoice").classList.toggle("on", app.cfg.voice);
  };
  syncOpts();
  app.syncOpts = syncOpts;
  $("#optFacing").addEventListener("click", () => { app.cfg = settings.set({ facing: app.cfg.facing === "user" ? "environment" : "user" }); syncOpts(); });
  $("#optVoice").addEventListener("click", () => {
    const on = !app.cfg.voice;
    app.cfg = settings.set({ voice: on, voiceCues: on });
    $("#setVoice").checked = on; $("#setVoiceCues").checked = on;
    syncOpts();
  });
  $("#btnStart").addEventListener("click", () => startWorkout({ src: "camera" }));
  $("#optDemo").addEventListener("click", () => startWorkout({ src: "demo" }));
  $("#fileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) startWorkout({ src: "file", file: f });
  });
}

async function renderHome() {
  const sessions = await store.sessions();
  const t = totals(sessions);
  const w = t.thisWeek;
  const last = sessions[0];
  let html = `<div class="stats" style="margin-bottom:12px">
    <div class="stat"><b>${w.workouts}</b><span>workouts</span></div>
    <div class="stat"><b>${w.reps}</b><span>reps</span></div>
    <div class="stat"><b>${Math.round(w.time / 60)}</b><span>minutes</span></div>
  </div>`;
  if (last) {
    const a = analyse(last);
    html += `<p class="section-label">Last workout</p>${sessionItem(last, a)}`;
  } else {
    html += `<div class="card"><h2>How it works</h2>
      <p class="hint">1. Lean the phone against something at hip height, 2–3 m away, so your whole body is in view.</p>
      <p class="hint">2. Tap Start and step back. Yaver checks the framing, counts down and you just train: it recognises the exercise, counts every rep out loud and calls out form faults.</p>
      <p class="hint">3. Rest as long as you like between sets. When you're done, walk away (or tap stop): the report with your reps, sets and the time between reps is ready.</p>
      <p class="hint">Want to see it first? Tap <b>Demo</b>.</p></div>`;
  }
  $("#homeWeek").innerHTML = html;
  $$("#homeWeek .item").forEach((it) => it.addEventListener("click", () => { location.hash = `report/${it.dataset.id}`; }));
}

function sessionItem(s, a = analyse(s)) {
  const d = new Date(s.start);
  const exs = a.exercises.map((e) => `<span class="tag"><i class="dot" style="background:${exColor(e.ex)};width:7px;height:7px;margin-right:5px"></i>${esc(exName(e.ex))} ${e.kind === "hold" ? `${e.hold}s` : `×${e.reps}`}</span>`).join("");
  return `<div class="item" data-id="${esc(s.id)}">
    <div class="when"><b>${d.getDate()}</b><span>${d.toLocaleDateString(undefined, { month: "short" })}</span></div>
    <div class="what"><div><b>${a.reps} reps</b> · ${a.sets} set${a.sets === 1 ? "" : "s"} · ${fmtDur(a.duration)}${a.score != null ? ` · form <span style="color:${scoreHue(a.score)}">${a.score}</span>` : ""}</div>
      <p>${fmtClock(s.start)}${s.source === "demo" ? " · demo" : s.source === "file" ? " · video" : ""}</p><div style="margin-top:6px">${exs}</div></div>
    <div class="go">›</div></div>`;
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
  cue(key, text, gap = 9000) {
    const now = performance.now();
    if (now - (this.lastCue[key] || 0) < gap) return;
    this.lastCue[key] = now;
    this.say(text);
  },
};
const speak = (text, opts) => { if (app.cfg.voice) voice.say(text, opts); };
const speakCue = (key, text, gap) => { if (app.cfg.voiceCues) voice.cue(key, text, gap); };

// ------------------------------------------------------------ workout
function bindTrain() {
  $("#btnPause").addEventListener("click", togglePause);
  $("#btnFinish").addEventListener("click", () => finishWorkout());
  $("#btnFlip").addEventListener("click", flipCamera);
  $("#btnCam").addEventListener("click", () => setShowCamera(!app.cfg.showCamera));
  $("#exPill").addEventListener("click", pickExercise);
  $("#fcSkip").addEventListener("click", () => app.run && goLive(app.run));
  $("#fcCancel").addEventListener("click", () => stopWorkout(false));
  $("#sheetBack").addEventListener("click", closeSheet);
}

async function startWorkout({ src = "camera", file = null, teach = null }) {
  if (app.run) return;
  if (!app.model) { $("#loadStatus").textContent = "The exercise model is still loading…"; return; }
  voice.unlock();
  $("#btnStart").disabled = true;
  try {
    if (src !== "demo") await ensurePose();
  } catch (e) {
    $("#loadStatus").textContent = `Pose tracking failed to start: ${e.message || e}. Check your connection (the model downloads on first use).`;
    $("#btnStart").disabled = false;
    return;
  }
  const forced = teach || (app.cfg.startEx !== "auto" ? app.cfg.startEx : null);
  const run = {
    src, teach, paused: false, t: 0, t0: performance.now(), lastMs: 0, frames: 0, fpsT: performance.now(), fps: 0,
    phase: "framing", liveT0: 0, lastSeenT: 0, lastRepT: null, restSpoken: 0, restShown: false,
    session: { id: `w${Date.now()}`, start: Date.now(), end: null, source: src, sets: [], _captures: [] },
    windows: [], recorder: new Recorder(),
    lastLm: null, frameW: 720, frameH: 1280, highlight: [], cueUntil: 0, teachData: null,
    frame: { okSince: null, torsoSince: null, msg: "", spokeAt: 0, center: null, count: null },
  };
  run.coach = new Coach({
    model: app.model, personal: teach ? null : app.personal, forced: forced === "idle" ? null : forced,
    onEvent: (e) => onCoachEvent(run, e),
  });
  app.run = run;
  document.body.classList.add("training");
  show("train");
  $("#hud").hidden = true;
  $("#frameCheck").hidden = false;
  setFrameMsg(run, "Starting the camera…", "");
  $("#btnFlip").hidden = src !== "camera";
  try {
    if (src === "camera") await startCamera(app.cfg.facing);
    else if (src === "file") await startFile(file);
    else await startDemo(run);
  } catch (e) {
    const blocked = e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "NotFoundError");
    await stopWorkout(false);
    toast(blocked
      ? "Camera unavailable. Open CaliCoach from its https address in Safari or Chrome and allow camera access."
      : `Couldn't start: ${esc(e.message || e)}`, 7000);
    return;
  } finally {
    $("#btnStart").disabled = false;
  }
  syncCamButton();
  requestWakeLock();
  if (src === "file") goLive(run); // a recorded video starts straight away
  else {
    setFrameMsg(run, "Step into view", "Your whole body, head to feet, needs to be in the picture.");
    speak(teach ? `Teaching ${exName(teach)}. Step back so I can see all of you.` : "Step back so I can see all of you.");
  }
  loop();
}

async function ensurePose() {
  if (app.pose && app.poseModel === app.cfg.model) return;
  app.pose?.close();
  $("#loadStatus").textContent = "Loading pose tracking (the first time takes a moment)…";
  const p = new PoseSource(app.cfg.model);
  await p.init();
  app.pose = p; app.poseModel = app.cfg.model;
  $("#loadStatus").textContent = "";
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
  app.syncOpts?.();
  try { await startCamera(app.cfg.facing); } catch (e) { toast("Couldn't switch camera"); }
}
async function startFile(file) {
  const v = $("#video");
  stopStream();
  v.srcObject = null;
  v.src = URL.createObjectURL(file);
  v.classList.remove("mirror"); $("#overlay").classList.remove("mirror");
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
}

let raf = 0;
function loop() {
  cancelAnimationFrame(raf);
  const step = () => {
    const run = app.run;
    if (!run) return;
    raf = requestAnimationFrame(step);
    resizeCanvas();
    if (run.paused) { draw(run); return; }
    if (run.demo) return demoStep(run);
    const v = $("#video");
    if (v.readyState < 2 || !v.videoWidth) return;
    run.frameW = v.videoWidth; run.frameH = v.videoHeight;
    let tMs;
    if (run.src === "file") { tMs = Math.round(v.currentTime * 1000); if (v.paused || v.ended) return; }
    else tMs = Math.round(performance.now() - run.t0);
    if (tMs <= run.lastMs) { draw(run); return; }
    const sent = app.pose.detect(v, (pose) => onPose(run, pose, tMs / 1000));
    if (sent) run.lastMs = tMs;
    draw(run);
  };
  raf = requestAnimationFrame(step);
}

function demoStep(run) {
  const d = run.demo;
  const now = performance.now();
  const dt = Math.min(0.1, (now - d.last) / 1000) * (window.__demoSpeed || 1);
  d.last = now;
  run.frameW = 720; run.frameH = 1280;
  if (run.phase !== "live") {
    // stand still in the first frame while the framing check and countdown run
    const seq = d.seqs[0];
    run.t += dt;
    onPose(run, { lm: seq.image[0].map(([x, y]) => [x, y, 1]), world: seq.world[0] }, run.t);
    draw(run);
    return;
  }
  d.acc += dt;
  while (d.acc >= 1 / d.fps) {
    d.acc -= 1 / d.fps;
    const seq = d.seqs[d.si];
    if (!seq) { finishWorkout(); return; }
    const f = d.fi++;
    if (f >= seq.world.length) { d.si++; d.fi = 0; continue; }
    const lm = seq.image[f].map(([x, y]) => [x, y, 1]);
    run.t += 1 / d.fps;
    onPose(run, { lm, world: seq.world[f] }, run.t);
    if (app.run !== run) return;
  }
  draw(run);
}

function onPose(run, pose, t) {
  if (app.run !== run) return;
  run.t = t;
  run.frames++;
  const now = performance.now();
  if (now - run.fpsT > 1000) { run.fps = (run.frames * 1000) / (now - run.fpsT); run.frames = 0; run.fpsT = now; }
  if (run.phase !== "live") { run.lastLm = pose?.lm || null; checkFraming(run, pose?.lm || null, t); return; }
  if (!pose) { run.lastLm = null; run.coach.pushEmpty(t); return; }
  run.lastLm = pose.lm;
  run.lastSeenT = t;
  run.recorder.push(t, pose.world, pose.lm, run.frameW, run.frameH);
  const vis = pose.lm.map((p) => p[2]);
  const m = run.coach.push(t, pose.world, vis);
  const x = run.coach.lastWindow;
  if (x && run.coach.windowLog == null && (!run.windows.length || t - run.windows[run.windows.length - 1].t >= 0.5)) run.windows.push({ t, x });
  if (run.teachData && run.teachData.recording) {
    run.teachData.t.push(t);
    run.teachData.frames.push(frameVector(m).map((v) => +v.toFixed(4)));
    if (x && t - run.teachData.lastWin >= 0.25 && run.coach.times.length && t - run.coach.times[0] > 2) {
      run.teachData.lastWin = t;
      run.teachData.windows.push(x);
    }
  }
}

// ---- framing check: is the whole body in view, and is the person ready?
const VIS = 0.5;
function checkFraming(run, lm, t) {
  const f = run.frame;
  if (run.phase === "countdown") return;
  const seen = (i) => lm && lm[i][2] > VIS && lm[i][0] > 0.01 && lm[i][0] < 0.99 && lm[i][1] > 0.01 && lm[i][1] < 0.99;
  const body = lm && seen(11) && seen(12) && (seen(23) || seen(24));
  const head = body && seen(0);
  const feet = body && (seen(27) || seen(28));
  let still = false;
  if (body) {
    const cx = (lm[11][0] + lm[12][0]) / 2, cy = (lm[11][1] + lm[12][1]) / 2;
    if (f.center) {
      const dist = Math.hypot(cx - f.center[0], cy - f.center[1]);
      f.center = [f.center[0] * 0.85 + cx * 0.15, f.center[1] * 0.85 + cy * 0.15];
      still = dist < 0.03;
    } else f.center = [cx, cy];
  } else f.center = null;
  const pts = body ? [0, 11, 12, 23, 24, 27, 28].filter((i) => lm[i][2] > VIS).map((i) => lm[i]) : [];
  const span = (k) => (pts.length ? Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])) : 0);
  const tall = Math.max(span(0), span(1)); // standing or lying (push-up position) both count
  $$("#fcChecks span").forEach((s) => s.classList.toggle("ok", { body, head, feet, still }[s.dataset.k]));
  let msg, msg2 = "", key;
  if (!body) { key = "none"; msg = "Step into view"; msg2 = "Prop the phone up 2–3 m away. Your whole body, head to feet, needs to be in the picture."; }
  else if (!head) { key = "head"; msg = "I can't see your head"; msg2 = "Step back a little, or tilt the phone up."; }
  else if (!feet) { key = "feet"; msg = "I can't see your feet"; msg2 = "Step back, or tilt the phone down a bit."; }
  else if (tall < 0.3) { key = "far"; msg = "Come a little closer"; msg2 = "You're quite small in the picture; tracking works best when you fill about half of it."; }
  else { key = "ok"; msg = "Looking good. Hold still"; msg2 = "Starting in a moment."; }
  setFrameMsg(run, msg, msg2);
  const spoken = { none: "Step into view.", head: "I can't see your head. Step back a little.", feet: "I can't see your feet. Step back a little.", far: "Come a little closer." }[key];
  if (spoken && key !== f.msg && t - f.spokeAt > 4) { speak(spoken, { interrupt: true }); f.spokeAt = t; }
  f.msg = key;
  // whole body framed and roughly still for ~1.2 s, or at least the torso for 6 s (e.g. feet cut off under a bar)
  f.okSince = key === "ok" && (still || f.okSince != null) ? f.okSince ?? t : null;
  f.torsoSince = head ? f.torsoSince ?? t : null;
  if ((f.okSince != null && t - f.okSince > 1.2) || (f.torsoSince != null && t - f.torsoSince > 6)) startCountdown(run);
}
function setFrameMsg(run, msg, msg2) {
  if ($("#fcMsg").textContent !== msg) $("#fcMsg").textContent = msg;
  if ($("#fcMsg2").textContent !== msg2) $("#fcMsg2").textContent = msg2;
}
function startCountdown(run) {
  if (run.phase !== "framing") return;
  run.phase = "countdown";
  let n = 3;
  $("#fcCount").hidden = false; $("#fcChecks").hidden = true;
  setFrameMsg(run, run.teach ? `Get ready: ${exName(run.teach)}` : app.cfg.startEx === "auto" ? "Start whenever you're ready" : `Get ready: ${exName(app.cfg.startEx)}`, "");
  const tick = () => {
    if (app.run !== run || run.phase !== "countdown") return;
    if (n === 0) { goLive(run); return; }
    $("#fcCount").textContent = String(n);
    speak(String(n), { interrupt: n === 3 });
    n--;
    run.countTimer = setTimeout(tick, 900);
  };
  tick();
}
function goLive(run) {
  if (app.run !== run || run.phase === "live") return;
  clearTimeout(run.countTimer);
  run.phase = "live";
  run.liveT0 = run.t;
  run.lastSeenT = run.t;
  run.session.start = Date.now();
  run.session.t0 = run.t;
  if (run.demo) run.demo.last = performance.now();
  $("#frameCheck").hidden = true; $("#fcCount").hidden = true; $("#fcChecks").hidden = false;
  $("#hud").hidden = false;
  setRing(0, false);
  $("#repCount").textContent = "0"; $("#repCount").classList.remove("timer");
  $("#repSub").innerHTML = run.teach ? "teaching" : "Start moving";
  updatePill();
  if (run.src !== "file") speak("Go!", { interrupt: true });
  if (run.teach) beginTeach(run, run.teach);
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
  if (run.lastLm) {
    const hl = performance.now() < run.cueUntil ? run.highlight : [];
    const color = run.phase === "live" ? "#4cc9ff" : run.frame.msg === "ok" ? "#34d399" : "#7fb6d6";
    drawPose(ctx, run.lastLm, run.frameW, run.frameH, { highlight: hl, color });
  }
  if (run.phase === "live") updateHud(run);
}

function setRing(p, rest) {
  $("#ringFill").style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, p))));
  $("#ring").classList.toggle("rest", !!rest);
}

function updateHud(run) {
  const st = run.coach.state();
  const t = run.t;
  $("#timer").textContent = fmtTime(t - run.liveT0);
  const done = run.session.sets.filter((s) => s.exercise !== "idle");
  const totalReps = done.reduce((a, s) => a + s.reps, 0) + (st.reps || 0);
  $("#hudSets").textContent = `${totalReps} reps · set ${done.length + 1}`;
  updatePill(st);
  const isHold = st.exercise && EXERCISES[st.exercise]?.kind === "hold";
  const holding = isHold && st.holdCur > 0.3;
  if (holding) run.lastRepT = t;
  const resting = !run.teach && run.lastRepT != null && t - run.lastRepT > REST_AFTER && !holding;
  const big = $("#repCount");
  if (resting) {
    const r = t - run.lastRepT;
    if (!run.restShown) {
      run.restShown = true;
      big.classList.add("timer");
    }
    big.textContent = fmtTime(r);
    const last = st.reps ? `${st.reps} reps so far` : done.length ? lastSetLine(done[done.length - 1]) : "";
    $("#repSub").innerHTML = `rest${last ? ` · <b>${esc(last)}</b>` : ""}`;
    setRing(Math.min(1, r / 120), true);
    if (r > 60 && run.restSpoken < 1) { run.restSpoken = 1; speakCue("rest60", "One minute rest.", 0); }
    if (r > 120 && run.restSpoken < 2) { run.restSpoken = 2; speakCue("rest120", "Two minutes. Go again when you're ready.", 0); }
  } else {
    if (run.restShown) { run.restShown = false; big.classList.remove("timer"); }
    if (isHold) {
      big.textContent = `${Math.floor(st.holdCur || 0)}s`;
      $("#repSub").innerHTML = `hold · <b>${Math.floor(st.hold || 0)}s</b> total`;
    } else {
      if (big.textContent !== String(st.reps)) big.textContent = String(st.reps);
      $("#repSub").innerHTML = run.lastRepT == null && !run.teach ? "Start moving" : `<b>${st.clean}</b> clean`;
    }
    setRing(Math.min(1, (st.progress || 0) * 1.0), false);
  }
  if (st.liveCue && FAULTS[st.liveCue]) {
    showCue(cueFor(st.exercise, st.liveCue), "bad", 700);
    run.highlight = FAULT_JOINTS[st.liveCue] || []; run.cueUntil = performance.now() + 700;
  }
  // walked away: finish the workout by itself
  if (app.cfg.autoEnd && run.src === "camera" && !run.teach && done.length && t - run.lastSeenT > AUTO_END) {
    speak("Workout saved. Nice work.");
    finishWorkout();
  }
}
const lastSetLine = (s) => (s.kind === "hold" ? `last set ${s.hold}s` : `last set ${s.reps} reps`);

function updatePill(st) {
  const run = app.run;
  st = st || run?.coach.state();
  if (!st || !run) return;
  if (run.teach) { $("#exName").textContent = exName(run.teach); $("#exSub").innerHTML = `<span class="lock">●</span> recording example`; return; }
  if (st.exercise) {
    $("#exName").textContent = exName(st.exercise);
    $("#exSub").innerHTML = st.forced ? `<span class="lock">●</span> locked · tap to change` : "auto-detected · tap to change";
  } else {
    $("#exName").textContent = st.guess && st.guess !== "idle" && st.confidence > 0.35 ? `${exName(st.guess)}?` : "Detecting";
    $("#exSub").textContent = "auto · tap to choose";
  }
}

let cueTimer = 0;
function showCue(text, kind = "bad", ms = 2600) {
  const el = $("#cue");
  el.textContent = text;
  el.className = `cue ${kind === "bad" ? "" : kind}`;
  el.hidden = false;
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
    run.lastRepT = run.t; run.restSpoken = 0;
    if (run.restShown) { run.restShown = false; el.classList.remove("timer"); }
    el.textContent = String(e.rep.n);
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    const r = e.rep;
    if (!e.replay) speak(String(r.n));
    if (!r.faults.length) showCue(r.n % 5 === 0 ? "Great form, keep going" : "Good rep", "ok", 1000);
  } else if (e.type === "cue") {
    showCue(e.text);
    run.highlight = FAULT_JOINTS[e.key] || []; run.cueUntil = performance.now() + 2600;
    speakCue(e.key, e.text);
  } else if (e.type === "exercise") {
    updatePill();
    if (!e.manual) speak(exName(e.key));
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
    s.windows = (run.coach.windowLog || run.windows).filter((w) => w.t >= s.start - 0.5 && w.t <= s.end).map((w) => w.x);
    run.session.sets.push(s);
    if (!s.reps && !s.hold) return;
    const what = s.kind === "hold" ? `${s.hold} s hold` : `${s.reps} reps, ${s.clean} clean`;
    toast(`<b>Set ${run.session.sets.length} · ${esc(exName(s.exercise))}</b><br>${what} · form ${s.score}`);
    speak(s.kind === "hold" ? `Set done. ${s.hold} seconds.` : `Set done. ${s.reps} reps.`);
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
  b.setAttribute("aria-label", on ? "Hide camera picture" : "Show camera picture");
  b.style.color = on ? "var(--accent)" : "";
  b.hidden = !!app.run?.demo;
  $("#video").classList.toggle("unseen", !on);
  const s = $("#setCam");
  if (s) s.checked = on;
}

const ICON_PAUSE = `<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>`;
const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
function togglePause() {
  const run = app.run;
  if (!run) return;
  run.paused = !run.paused;
  $("#btnPause").innerHTML = run.paused ? ICON_PLAY : ICON_PAUSE;
  $("#btnPause").setAttribute("aria-label", run.paused ? "Resume" : "Pause");
  if (run.paused) showCue("Paused", "info", 1e9); else $("#cue").hidden = true;
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
    <h2 style="margin:0 0 6px">Exercise</h2>
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
  if (run.phase === "live") run.coach.endSet(run.t);
  if (run.teach) { await stopWorkout(false); return; }
  run.session.end = Date.now();
  run.session.duration = +(Math.max(0, run.t - run.liveT0)).toFixed(1);
  await stopWorkout(run.phase === "live");
}

async function stopWorkout(save) {
  const run = app.run;
  app.run = null;
  cancelAnimationFrame(raf);
  if (run) clearTimeout(run.countTimer);
  stopStream();
  const v = $("#video");
  try { v.pause(); } catch {}
  if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute("src"); v.load(); }
  v.onended = null;
  releaseWakeLock();
  document.body.classList.remove("training");
  $("#hud").hidden = true; $("#frameCheck").hidden = true; $("#cue").hidden = true; $("#toast").hidden = true;
  $("#fcCount").hidden = true; $("#fcChecks").hidden = false;
  $("#btnPause").innerHTML = ICON_PAUSE;
  const ctx = $("#overlay").getContext("2d"); ctx.clearRect(0, 0, 9999, 9999);
  const sets = run?.session.sets.filter((s) => s.reps || s.hold) || [];
  if (save && run && sets.length) {
    run.session.sets = sets;
    await saveFresh(run.session);
    location.hash = `report/${run.session.id}`;
    if (location.hash === `#report/${run.session.id}`) routeFromHash();
  } else {
    if (save) toast("No sets were recorded, so there's nothing to save.", 3000);
    if (!run?.teach) { location.hash = "home"; routeFromHash(); }
  }
}

// Finished workouts are saved straight away; the report can still fix an exercise or discard it.
async function saveFresh(session) {
  const windows = session.sets.map((s) => s.windows || []);
  session.sets.forEach((s) => delete s.windows);
  const caps = session._captures || [];
  delete session._captures;
  const demo = session.source === "demo" && !window.__allowDemoSave;
  app.report = { session, fresh: true, saved: !demo, windows, caps };
  if (demo) return;
  for (const c of caps) if (session.sets.some((s) => s.captureId === c.id)) await store.saveCapture(c);
  await store.saveSession(session);
  sync.queueAfterSave();
}
async function persistReport() {
  const r = app.report;
  if (!r?.saved) return;
  for (const c of r.caps || []) {
    const s = r.session.sets.find((x) => x.captureId === c.id);
    if (s) { c.exercise = s.exercise; c.setIndex = r.session.sets.indexOf(s); await store.saveCapture(c); }
  }
  await store.saveSession(r.session);
  sync.queueAfterSave();
}

// ------------------------------------------------------------ report
async function openReport(id) {
  let r = app.report?.session.id === id ? app.report : null;
  if (!r) {
    const s = (await store.sessions()).find((x) => x.id === id);
    if (!s) { location.hash = "history"; return; }
    r = app.report = { session: s, fresh: false, saved: true, windows: [], caps: null };
  }
  show("report");
  $("#reportBack").textContent = r.fresh ? "‹ Home" : "‹ Analytics";
  $("#reportBack").setAttribute("href", r.fresh ? "#home" : "#history");
  renderReport();
}

function renderReport() {
  const { session, fresh, saved } = app.report;
  const a = analyse(session);
  const exs = a.exercises;
  const restPct = a.duration ? Math.round((100 * a.rest) / a.duration) : 0;
  const legend = [...new Set(a.rows.map((r) => r.ex))].map((k) => `<span><i style="background:${exColor(k)}"></i>${esc(exName(k))}</span>`).join("");
  let html = `
    <div class="report-hero">
      <p class="title">${fresh ? "Workout complete" : esc(fmtDate(session.start))}</p>
      <h1>${fresh ? "Nice work." : `${fmtClock(session.start)}${session.source === "demo" ? " · demo" : ""}`}</h1>
    </div>
    <div class="stats four">
      <div class="stat hero"><b>${a.reps}</b><span>reps</span></div>
      <div class="stat"><b>${a.sets}</b><span>sets</span></div>
      <div class="stat"><b>${exs.length}</b><span>exercise${exs.length === 1 ? "" : "s"}</span></div>
      <div class="stat"><b>${fmtDur(a.duration)}</b><span>total time</span></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h2>Your workout, start to finish</h2>
      ${timelineSVG(a, { names: exName })}
      <div class="legend">${legend}</div>
      <div class="kv"><span>Working</span><b>${fmtDur(a.active)}</b></div>
      <div class="kv"><span>Resting</span><b>${fmtDur(a.rest)} <span class="muted">(${restPct}%)</span></b></div>
      <div class="kv"><span>Average rest between sets</span><b>${fmtDur(a.avgRestBetweenSets)}</b></div>
      <div class="kv"><span>Average time between reps</span><b>${fmtSec(a.avgGap)}</b></div>
      <div class="kv"><span>Form score</span><b style="color:${a.score != null ? scoreHue(a.score) : "inherit"}">${a.score ?? "–"}</b></div>
      <div class="kv"><span>Clean reps</span><b>${a.clean} of ${a.reps}</b></div>
    </div>
    <p class="section-label" style="margin-top:18px">By exercise</p>
    ${exs.map((e) => exerciseCard(e)).join("")}
    <p class="section-label" style="margin-top:18px">Set by set <span class="dim" style="letter-spacing:0;text-transform:none">· tap a rep for the 3D replay</span></p>
    ${a.rows.map((row) => setCard(row)).join("")}
    ${!saved ? `<p class="hint" style="text-align:center">Demo workouts aren't saved to your history.</p>` : ""}
    <div class="btns" style="margin-top:16px">
      <a class="btn primary" href="#home">Done</a>
      ${saved ? `<button class="btn danger" id="btnDelete">${fresh ? "Discard workout" : "Delete workout"}</button>` : ""}
    </div>`;
  $("#report").innerHTML = html;
  $$("#report svg.repchart").forEach((svg) => svg.addEventListener("click", (ev) => {
    const ri = nearestRep(svg, ev.clientX, ev.clientY);
    if (ri != null) openRep(+svg.dataset.set, ri);
  }));
  $$("#report tr.reprow, #report .btnWorst").forEach((el) => el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openRep(+el.dataset.set, +el.dataset.rep);
  }));
  $$("#report .tl-set").forEach((el) => el.addEventListener("click", () => $(`#set-${el.dataset.set}`)?.scrollIntoView({ behavior: "smooth", block: "start" })));
  $$("#report select.relabel").forEach((sel) => sel.addEventListener("change", () => relabel(+sel.dataset.i, sel.value)));
  $("#btnDelete")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; return; }
    await store.deleteSession(session.id); await store.deleteCapturesOf(session.id);
    app.report = null;
    toast("Workout deleted.", 2000);
    location.hash = fresh ? "home" : "history";
  });
}

function exerciseCard(e) {
  const hold = e.kind === "hold";
  return `<div class="card ex-card" style="border-left:3px solid ${exColor(e.ex)}">
    <div class="head"><h2>${esc(exName(e.ex))}</h2>${e.score != null ? `<span class="score" style="color:${scoreHue(e.score)}">form ${e.score}</span>` : ""}</div>
    <div class="stats">
      ${hold ? `<div class="stat"><b>${e.hold}s</b><span>held</span></div><div class="stat"><b>${e.bestHold}s</b><span>best hold</span></div>`
        : `<div class="stat"><b>${e.reps}</b><span>reps</span></div><div class="stat"><b>${e.cleanPct ?? "–"}%</b><span>clean</span></div>`}
      <div class="stat"><b>${e.sets}</b><span>set${e.sets === 1 ? "" : "s"}</span></div>
    </div>
    ${hold ? "" : `
    <div class="kv" style="margin-top:8px"><span>Average time per rep</span><b>${fmtSec(e.avgRep)}</b></div>
    <div class="kv"><span>Average time between reps</span><b>${fmtSec(e.avgGap)}</b></div>
    <div class="kv"><span>Best set</span><b>${e.bestSet} reps</b></div>`}
  </div>`;
}

const tracked = (s) => (s.repList || []).filter((r) => r.trace?.k?.length > 1);
function setCard(row) {
  const s = row.set, i = row.i;
  const ex = s.relabelFrom || s.exercise;
  const faults = Object.entries(s.faults || {}).filter(([k]) => FAULTS[k]).sort((a, b) => b[1] - a[1]);
  const reps = s.repList || [];
  const head = s.kind === "hold" ? `${s.hold}s hold${s.best ? ` (best ${s.best}s)` : ""}` : `${s.reps} reps · ${s.clean} clean`;
  const worst = tracked(s).reduce((a, b) => (!a || b.score < a.score ? b : a), null);
  const rows = reps.map((r, ri) => {
    const gap = ri > 0 ? Math.max(0, r.t0 - reps[ri - 1].t1) : null;
    const notes = r.faults.filter((f) => FAULTS[f.key]).map((f) => FAULTS[f.key].label).join(", ");
    return `<tr class="${r.trace?.k ? "reprow tap" : ""}" data-set="${i}" data-rep="${ri}">
      <td>${r.n}${r.side ? ` <small class="muted">${r.side[0].toUpperCase()}</small>` : ""}</td>
      <td class="score" style="color:${scoreHue(r.score)}">${r.score}</td>
      <td>${fmtSec(r.duration ?? r.t1 - r.t0)}</td>
      <td class="muted">${gap == null ? "–" : `${gap.toFixed(1)}s`}</td>
      <td>${notes ? `<span class="muted">${esc(notes)}</span>` : `<span style="color:var(--good)">✓</span>`}</td></tr>`;
  }).join("");
  return `<div class="card set-card" id="set-${i}" style="border-left-color:${exColor(s.exercise)}">
    <div class="row" style="margin-bottom:4px"><h2 style="margin:0">Set ${i + 1} · ${esc(exName(s.exercise))}</h2>
      <span class="score" style="color:${scoreHue(s.score)}">${s.score}</span></div>
    <p class="hint" style="margin:0">${head}${row.restBefore != null ? ` · after ${fmtDur(row.restBefore)} rest` : ""}</p>
    ${reps.length > 1 ? `<div class="kv" style="margin-top:8px"><span>Time per rep</span><b>${fmtSec(row.avgRep)}</b></div>
      <div class="kv"><span>Time between reps</span><b>${fmtSec(row.avgGap)}</b></div>` : ""}
    ${reps.length ? `<div class="hint" style="margin:10px 0 0">Rhythm <span class="dim">· blocks are reps (colour = form), numbers are seconds between them</span></div>${rhythmSVG(row)}` : ""}
    ${faults.length ? `<div style="margin-top:6px">${faults.map(([k, v]) => `<span class="tag warn">${esc(FAULTS[k].label)} ×${v}</span>`).join("")}</div>` : ""}
    ${tracked(s).length ? `<details class="more"><summary>Movement graph</summary>${setChart({ ...s, exercise: ex }, i)}</details>` : ""}
    ${reps.length ? `<table class="reps"><tr><th>#</th><th>Form</th><th>Time</th><th>Gap</th><th>Notes</th></tr>${rows}</table>` : ""}
    ${worst ? `<button class="btn wide btnWorst" style="margin-top:10px" data-set="${i}" data-rep="${reps.indexOf(worst)}">▶ ${worst.score >= 85 ? `Replay rep ${worst.n} in 3D` : `Replay the weakest rep (#${worst.n}) in 3D`}</button>` : ""}
    ${app.report.saved ? `<label class="field" style="margin-bottom:0"><span>Wrong exercise? Fix it and Yaver learns from it</span><select class="relabel" data-i="${i}">${ORDER.concat("idle").map((k) => `<option value="${k}" ${k === s.exercise ? "selected" : ""}>${exName(k)}</option>`).join("")}</select></label>` : ""}
  </div>`;
}

async function relabel(i, value) {
  const r = app.report;
  const s = r.session.sets[i];
  if (!s || s.exercise === value) return;
  s.relabelFrom = s.relabelFrom || s.exercise;
  s.exercise = value;
  const win = r.windows?.[i] || [];
  if (win.length) { await store.addExamples(win.map((x) => ({ label: value, x, t: Date.now(), from: "correction" }))); await refreshPersonal(); }
  if (value === "idle") {
    r.session.sets.splice(i, 1);
    r.windows?.splice(i, 1);
    if (s.captureId) await store.deleteCapture(s.captureId);
    if (!r.session.sets.length) {
      await store.deleteSession(r.session.id);
      app.report = null;
      toast("Removed. Nothing left in this workout.", 2500);
      location.hash = "home";
      return;
    }
  }
  await persistReport();
  toast(win.length ? `Changed to ${esc(exName(value))}. Yaver learned from ${win.length} samples.` : `Changed to ${esc(exName(value))}.`, 2500);
  renderReport();
}

// ---- one rep: 3D replay + angle graphs + what went wrong
let player = null, viewer = null;
async function openRep(si, ri) {
  const { session } = app.report;
  const set = session.sets[si];
  const ex = set.relabelFrom || set.exercise;
  const spec = EXERCISES[ex];
  const r = set.repList[ri];
  const tr = r.trace;
  player?.destroy(); viewer?.destroy(); player = viewer = null;
  const cap = app.report.caps?.find((c) => c.id === set.captureId) || (set.captureId ? await store.capture(set.captureId) : null);
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
      spec.chart?.depth != null && { v: spec.chart.depth, label: `target ≤ ${spec.chart.depth}°`, color: "#34d399" },
      spec.chart?.lock != null && { v: spec.chart.lock, label: `lockout ≥ ${spec.chart.lock}°`, color: "#a78bfa" },
    ].filter(Boolean),
  });
  const sec = spec.secondary;
  const isAngle = sec?.unit === "°";
  const second = sec ? traceChart(tr, tr.x, {
    id: "tcSec", label: sec.label, unit: sec.unit || "", angle: isAngle, height: 120,
    limits: [
      sec.lo != null && { v: sec.lo, label: `limit ${sec.lo}${sec.unit || ""}`, color: "#f87171" },
      sec.hi != null && { v: sec.hi, label: `limit ${sec.hi}${sec.unit || ""}`, color: "#f87171" },
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
    <div class="legend"><span><i style="background:#d8e6f5"></i>You</span><span><i style="background:#7fd8ff"></i>your left side</span>${ref ? `<span><i style="background:#34d399"></i>perfect form</span>` : ""}<span><i style="background:#f87171"></i>fault</span></div>
    <div class="toggles">
      ${ref ? `<label class="toggle"><input type="checkbox" id="tgGhost" checked><span>Perfect-form ghost</span></label>` : ""}
      <label class="toggle"><input type="checkbox" id="tgTrail" checked><span>Movement path</span></label>
    </div>` : `<div class="replay"><canvas id="replayCanvas"></canvas></div>`;
  openSheet(`
    <div class="row" style="margin:0 0 10px"><button class="link" id="repBack">‹ Back to the report</button>
      <span class="score" style="color:${scoreColor(r.score)}">form ${r.score}</span></div>
    <h2 style="margin:0 0 10px">${esc(exName(ex))} · rep ${r.n}${r.side ? ` (${r.side} leg)` : ""}</h2>
    ${view3d}
    <div class="playbar">
      <button class="round" id="rpPlay" aria-label="Play">▶</button>
      <input type="range" id="rpSeek" min="0" max="${frames - 1}" value="0" aria-label="Position">
      <button class="btn" id="rpSpeed">0.5×</button>
    </div>
    <p class="hint">${sub ? "Drag to rotate, pinch to zoom." : "Faint figure = deepest point of the rep."} ${faults.length ? "Red = where the fault is." : ""}</p>
    ${sub && ref ? `<div class="card" id="cmpCard"></div>` : ""}
    ${main.html}${second ? second.html : ""}
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${r.bottom}°</b><span>bottom</span></div>
      <div class="stat"><b>${r.top}°</b><span>top</span></div>
      <div class="stat"><b>${r.ecc}/${r.con}s</b><span>down / up</span></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h2>${faults.length ? "What to fix" : "Clean rep ✓"}</h2>
      ${faults.length ? faults.map((f) => `<div class="rec"><b>${FAULTS[f.key].label}</b><p>${explainFault(ex, f)}</p><p>${cueFor(ex, f.key)}. ${DRILLS[f.key] || ""}</p></div>`).join("")
        : `<p class="hint">Full range, locked out, good body line and controlled tempo.</p>`}
    </div>
    ${sub ? `<button class="btn wide" id="btnMakeRef">☆ Use this rep as my perfect-form reference</button>
      ${ref?.source === "yours" ? `<button class="link" id="btnClearRef">Go back to the standard reference</button>` : ""}
      ${ref ? `<p class="hint">Reference: ${esc(ref.source === "yours" ? "your own rep" : ref.source === "generated" ? "generated textbook rep (until real videos are added)" : "from video")}.</p>` : ""}` : ""}
    <div class="btns">
      <button class="btn" id="repPrev" ${prev == null ? "disabled" : ""}>${prev != null ? `‹ Rep ${set.repList[prev].n}` : "First rep"}</button>
      <button class="btn" id="repNext" ${next == null ? "disabled" : ""}>${next != null ? `Rep ${set.repList[next].n} ›` : "Last rep"}</button>
    </div>
  `);
  $("#repBack").addEventListener("click", closeSheet);
  $("#repPrev").addEventListener("click", () => prev != null && openRep(si, prev));
  $("#repNext").addEventListener("click", () => next != null && openRep(si, next));
  const sheet = $("#sheetBody");
  const seek = $("#rpSeek");
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
        $("#cmpCard").innerHTML = `<h2>You vs perfect form <small>(deepest point)</small></h2>
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
      openRep(si, ri);
    });
    $("#btnClearRef")?.addEventListener("click", async () => { await clearMyReference(ex); openRep(si, ri); });
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

// ---- teaching: record labelled examples
function beginTeach(run, label) {
  run.teachData = { label, recording: true, t: [], frames: [], windows: [], lastWin: 0 };
  showCue(label === "idle" ? "Recording: move around normally" : `Recording: do ${exName(label).toLowerCase()}s`, "ok", 3000);
  setTimeout(async () => {
    if (app.run !== run) return;
    const td = run.teachData;
    td.recording = false;
    const ex = td.windows.map((x) => ({ label, x, t: Date.now(), from: "teach" }));
    if (ex.length) {
      await store.addExamples(ex);
      await store.addClip({ label, t: td.t, frames: td.frames, date: Date.now() });
    }
    speak("Done");
    await stopWorkout(false);
    await refreshPersonal();
    location.hash = "settings";
    toast(ex.length ? `Saved ${ex.length} examples of ${esc(exName(label))}.` : "Nobody was detected. Try again with your whole body in view.", 3500);
  }, 20000);
}

// ---- wake lock: the screen stays on while you train
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

// ------------------------------------------------------------ analytics (all time)
async function renderHistory() {
  const sessions = await store.sessions();
  const el = $("#history");
  if (!sessions.length) {
    el.innerHTML = `<div class="empty">No workouts yet.<br><br><a class="btn primary" href="#home">Start your first one</a></div>`;
    return;
  }
  const t = totals(sessions);
  const o = overview(sessions);
  const gen = generalAdvice(sessions);
  const wkLabels = t.weeks.map((w) => new Date(w.start).toLocaleDateString(undefined, { day: "numeric", month: "numeric" }));
  let html = `
    <div class="stats four">
      <div class="stat hero"><b>${t.reps}</b><span>reps, all time</span></div>
      <div class="stat"><b>${t.workouts}</b><span>workouts</span></div>
      <div class="stat"><b>${fmtDur(t.time)}</b><span>trained</span></div>
      <div class="stat"><b>${o.streak || 0}</b><span>week streak</span></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h2>Reps per week</h2>
      ${chart(t.weeks.map((w) => w.reps), { labels: wkLabels, type: "bar", color: "#4cc9ff" })}
      <div class="kv"><span>This week</span><b>${t.thisWeek.reps} reps · ${t.thisWeek.workouts} workout${t.thisWeek.workouts === 1 ? "" : "s"}</b></div>
      <div class="kv"><span>Average form, last 7 days</span><b>${o.avgScore ?? "–"}</b></div>
      ${gen.map((r) => `<div class="rec"><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join("")}
    </div>
    <p class="section-label" style="margin-top:18px">Exercises</p>
    ${t.exercises.map((e) => exerciseRecord(e, sessions)).join("")}
    <p class="section-label" style="margin-top:18px">Workouts</p>
    ${sessions.map((s) => sessionItem(s)).join("")}`;
  el.innerHTML = html;
  $$("#history .item").forEach((it) => it.addEventListener("click", () => { location.hash = `report/${it.dataset.id}`; }));
}

function exerciseRecord(e, sessions) {
  const hold = e.kind === "hold";
  const rows = exerciseHistory(sessions, e.ex);
  const recs = recommend(sessions, e.ex);
  const labels = rows.map((r) => new Date(r.date).toLocaleDateString(undefined, { day: "numeric", month: "numeric" }));
  const faults = {};
  let n = 0;
  for (const r of rows.slice(-5)) { n += hold ? r.hold : r.reps; for (const [k, v] of Object.entries(r.faults)) faults[k] = (faults[k] || 0) + v; }
  const fl = Object.entries(faults).filter(([k]) => FAULTS[k]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return `<details class="card guide-ex" style="border-left:3px solid ${exColor(e.ex)}">
    <summary><span>${esc(exName(e.ex))} <span class="muted" style="font-weight:400;font-size:13.5px">· ${hold ? `${e.hold}s total` : `${e.reps} reps`} · best ${hold ? `${e.bestHold}s` : `set ${e.bestSet}`}</span></span></summary>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${e.workouts}</b><span>workouts</span></div>
      <div class="stat"><b>${e.score ?? "–"}</b><span>avg form</span></div>
      <div class="stat"><b>${hold ? `${e.sets}` : fmtSec(e.avgGap)}</b><span>${hold ? "sets" : "between reps"}</span></div>
    </div>
    <h3>What to do next</h3>
    ${recs.map((r) => `<div class="rec"><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join("")}
    ${rows.length > 1 ? `<h3>${hold ? "Best hold (s)" : "Best clean set"}</h3>${chart(rows.map((r) => (hold ? r.best : r.bestSet)), { labels })}
      <h3>Form score</h3>${chart(rows.map((r) => r.score), { labels, max: 100, color: "#34d399" })}` : ""}
    ${fl.length ? `<h3>Common faults (last 5 workouts)</h3>${fl.map(([k, v]) => `
      <div class="row" style="font-size:14px"><span>${esc(FAULTS[k].label)}</span><span class="muted">${hold ? `${v}s` : `${Math.round((100 * v) / Math.max(1, n))}% of reps`}</span></div>
      <div class="bar-h"><i style="width:${Math.min(100, (100 * v) / Math.max(1, n))}%"></i></div>`).join("")}` : ""}
  </details>`;
}

// ------------------------------------------------------------ guide
function renderGuide() {
  const el = $("#guide");
  if (el.dataset.done) return;
  el.dataset.done = "1";
  el.innerHTML = `<div class="card"><h2>Setting up</h2>
      <p class="hint">Lean the phone at about hip height, 2–3 m away, so your head and feet are both in the picture. Side-on works best for push-ups, dips, pikes and rows; front-on for squats and lunges. The screen stays on and the camera picture stays hidden while you train.</p></div>` +
    ORDER.map((k) => {
      const g = INFO[k], spec = EXERCISES[k];
      const checks = spec.detects || [];
      return `<details class="card guide-ex" style="border-left:3px solid ${exColor(k)}"><summary>${exName(k)}</summary>
        <h3>Camera</h3><p class="hint">${esc(g.camera)}</p>
        <h3>Good form</h3><ul>${g.standards.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        <h3>What Yaver checks</h3><ul>${checks.filter((c) => FAULTS[c]).map((c) => `<li><b>${FAULTS[c].label}</b>: ${esc(DRILLS[c] || FAULTS[c].cue)}</li>`).join("")}</ul>
        <h3>Progression</h3><ul><li>Goal: ${g.target} ${g.unit}</li><li>Easier: ${esc(g.easier)}</li><li>Harder: ${esc(g.harder)}</li></ul>
      </details>`;
    }).join("") + `<div class="card sources"><h2>Sources</h2>${SOURCES.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join("")}</div>`;
}

// ------------------------------------------------------------ settings
function bindSettings() {
  const c = app.cfg;
  $("#teachEx").innerHTML = ORDER.map((k) => `<option value="${k}">${exName(k)}</option>`).join("") + `<option value="idle">Not exercising (rest, walking…)</option>`;
  $("#setVoice").checked = c.voice; $("#setVoiceCues").checked = c.voiceCues; $("#setMirror").checked = c.mirror; $("#setModel").value = c.model;
  $("#setAutoEnd").checked = c.autoEnd !== false;
  $("#setVoice").addEventListener("change", (e) => { app.cfg = settings.set({ voice: e.target.checked }); app.syncOpts?.(); });
  $("#setVoiceCues").addEventListener("change", (e) => { app.cfg = settings.set({ voiceCues: e.target.checked }); });
  $("#setMirror").addEventListener("change", (e) => { app.cfg = settings.set({ mirror: e.target.checked }); });
  $("#setAutoEnd").addEventListener("change", (e) => { app.cfg = settings.set({ autoEnd: e.target.checked }); });
  $("#setCam").addEventListener("change", (e) => setShowCamera(e.target.checked));
  $("#setCam").checked = !!c.showCamera;
  $("#setModel").addEventListener("change", (e) => { app.cfg = settings.set({ model: e.target.value }); });
  $("#btnTeach").addEventListener("click", () => startWorkout({ src: "camera", teach: $("#teachEx").value }));
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
    const lines = ["date,exercise,set,rep,score,clean,bottom_deg,top_deg,down_s,up_s,rep_s,gap_s,faults"];
    for (const s of await store.sessions()) s.sets.forEach((x, si) => (x.repList || []).forEach((r, ri, all) => {
      const gap = ri > 0 ? Math.max(0, r.t0 - all[ri - 1].t1).toFixed(2) : "";
      lines.push([new Date(s.start).toISOString(), x.exercise, si + 1, r.n, r.score, r.clean, r.bottom, r.top, r.ecc, r.con, (r.duration ?? r.t1 - r.t0).toFixed(2), gap, `"${r.faults.map((f) => f.key).join(" ")}"`].join(","));
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
    await store.clearSessions(); await store.clearCaptures();
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
    catch (e) { status(`Couldn't send the code: ${e.message}`); }
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
  $("#about").innerHTML = `CaliCoach recognises ${ORDER.length} calisthenics exercises from MediaPipe Pose landmarks, counts reps and checks form against published coaching standards (see Guide).
  The recognition model is a small neural network trained on biomechanically generated motion${m ? ` (test accuracy ${(m.test_accuracy * 100).toFixed(1)}%, trained ${m.trained})` : ""}; your own examples and corrections adapt it to you.
  Only skeleton points are stored, never video. It's a training aid, not medical advice.`;
}

// test hooks
window.__calicoach = { app, analyse };

boot();
