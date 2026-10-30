// The robot simulator: build a two-wheeled ESP32 robot by hand, wire it like
// the real thing, program it in Arduino C++, and let it drive itself round
// an arena, avoiding obstacles with its ultrasonic sensor.
//
// Four tabs: Build (pull parts off the shelf and fit them to the chassis),
// Wire (pinch a pin, pull a jumper to another pin), Code (the sketch), and
// Run (power it up and watch). The electrics are simulated from the actual
// wiring: no common ground, a motor on the wrong pins or a wire to the wrong
// GPIO behave just as they would on the bench.
import * as THREE from "three";
import { tween, ease } from "./anim.js?v=18";
import * as P from "./parts.js?v=18";
import { SketchRunner } from "./sketch.js?v=18";
import { dispose } from "./stage.js?v=18";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const { DECK_Y, DECK_TOP } = P;
const WHEEL_R = 3.25;
const TRACK = 12.3; // cm between the wheel centres
const DRAG_Y = DECK_TOP + 5;

// Where each part fits on the chassis (robot space: forward is +z, the
// robot's left is +x).
export const SLOTS = {
  motorR: { kind: "motor", title: "Right motor", pos: [-4.65, WHEEL_R, -4.5], mirror: true },
  motorL: { kind: "motor", title: "Left motor", pos: [4.65, WHEEL_R, -4.5] },
  wheelR: { kind: "wheel", title: "Right wheel", pos: [-6.15, WHEEL_R, -4.5], needs: "motorR" },
  wheelL: { kind: "wheel", title: "Left wheel", pos: [6.15, WHEEL_R, -4.5], needs: "motorL" },
  caster: { kind: "caster", title: "Ball caster", pos: [0, DECK_Y, 8] },
  battery: { kind: "battery", title: "Battery pack", pos: [0, DECK_TOP, -6.8], rotY: -Math.PI / 2 },
  driver: { kind: "driver", title: "Motor driver", pos: [0, DECK_TOP, 0.6] },
  esp32: { kind: "esp32", title: "ESP32", pos: [0, DECK_TOP + 0.51, 6.0] },
  sonar: { kind: "sonar", title: "Distance sensor", pos: [0, DECK_TOP + 0.3, 10.85] },
};

export const KINDS = {
  motor: { title: "TT gear motor", count: 2, make: () => P.ttMotor(1) },
  wheel: { title: "65 mm wheel", count: 2, make: () => P.wheel() },
  caster: { title: "Ball caster", count: 1, make: () => P.caster(DECK_Y) },
  battery: { title: "2 × 18650 pack", count: 1, make: () => P.battery2x18650() },
  driver: { title: "L298N driver", count: 1, make: () => P.l298n() },
  esp32: { title: "ESP32 DevKitC", count: 1, make: () => P.esp32() },
  sonar: { title: "HC-SR04 sensor", count: 1, make: () => P.hcsr04() },
};

// The reference wiring: [from, to, colour, why].
export const REFERENCE = [
  ["battery.+", "driver.12V", "red", "Battery + to the driver's power input"],
  ["battery.-", "driver.GND", "black", "Battery − to the driver's ground"],
  ["driver.5V", "esp32.5V", "red", "The driver's 5 V output powers the ESP32"],
  ["driver.GND", "esp32.GND1", "black", "Common ground: without it, no signal gets through"],
  ["driver.OUT1", "motorR.M-", "orange", "Motor A = right motor (mounted mirrored, so its wires swap)"],
  ["driver.OUT2", "motorR.M+", "yellow", ""],
  ["driver.OUT3", "motorL.M+", "orange", "Motor B = left motor"],
  ["driver.OUT4", "motorL.M-", "yellow", ""],
  ["esp32.IO33", "driver.ENA", "purple", "Right motor speed (PWM), jumper removed"],
  ["esp32.IO25", "driver.IN1", "blue", "Right motor direction"],
  ["esp32.IO26", "driver.IN2", "green", ""],
  ["esp32.IO27", "driver.IN3", "blue", "Left motor direction"],
  ["esp32.IO14", "driver.IN4", "green", ""],
  ["esp32.IO13", "driver.ENB", "purple", "Left motor speed (PWM)"],
  ["sonar.VCC", "esp32.5V", "red", "The sensor needs 5 V"],
  ["sonar.GND", "esp32.GND2", "black", ""],
  ["sonar.Trig", "esp32.IO5", "white", "Trigger: a 10 µs pulse starts a measurement"],
  ["sonar.Echo", "esp32.IO18", "grey", "Echo (on a real build, through a 1k/2k divider)"],
];

export const EXAMPLE_SKETCH = `// Yaver robot: drives ahead and turns away from obstacles.
// The pin numbers match the reference wiring (the Wire tab).

// L298N motor driver
const int ENA = 33;   // right motor speed (PWM)
const int IN1 = 25;   // right motor direction
const int IN2 = 26;
const int IN3 = 27;   // left motor direction
const int IN4 = 14;
const int ENB = 13;   // left motor speed (PWM)

// HC-SR04 distance sensor
const int TRIG = 5;
const int ECHO = 18;

void setup() {
  Serial.begin(115200);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  ledcAttach(ENA, 1000, 8);   // 1 kHz PWM, duty 0-255
  ledcAttach(ENB, 1000, 8);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  Serial.println("Yaver robot ready");
}

// Distance to whatever is in front, in cm.
long readDistanceCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);     // a 10 µs pulse starts a measurement
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);  // 0 if no echo within 30 ms
  if (us == 0) return 400;
  return us * 0.0343 / 2;       // sound: 343 m/s, there and back
}

// Each side from -255 (full reverse) to 255 (full ahead).
void drive(int left, int right) {
  digitalWrite(IN1, right >= 0 ? HIGH : LOW);
  digitalWrite(IN2, right >= 0 ? LOW : HIGH);
  digitalWrite(IN3, left >= 0 ? HIGH : LOW);
  digitalWrite(IN4, left >= 0 ? LOW : HIGH);
  ledcWrite(ENA, abs(right));
  ledcWrite(ENB, abs(left));
}

void loop() {
  long cm = readDistanceCm();
  Serial.print("Distance: ");
  Serial.print(cm);
  Serial.println(" cm");

  if (cm < 25) {
    drive(0, 0);          // stop
    delay(150);
    drive(-180, -180);    // back up
    delay(350);
    drive(-200, 200);     // spin left
    delay(380);
  } else {
    drive(210, 210);      // ahead
  }
  delay(40);
}
`;

const GPIO_NAMES = { TX: 1, RX: 3, CLK: 6, SD0: 7, SD1: 8, SD2: 9, SD3: 10, CMD: 11 };
export const gpioOf = (pin) => (pin.startsWith("IO") ? Number(pin.slice(2)) : GPIO_NAMES[pin] ?? null);

// ---- Building a robot (also used for the showcase on the course menu) ---------------

export function mountPart(robot, slotId, part) {
  const slot = SLOTS[slotId];
  part.position.set(...slot.pos);
  part.rotation.set(0, slot.rotY ?? 0, 0);
  part.scale.set(slot.mirror ? -1 : 1, 1, 1);
  part.userData.slot = slotId;
  robot.add(part);
  return part;
}

export function wireMesh(robot, parts, a, b, color) {
  robot.updateMatrixWorld(true);
  const pa = robot.worldToLocal(pinPos(parts, a));
  const pb = robot.worldToLocal(pinPos(parts, b));
  return P.jumperWire(pa, pb, P.WIRE_COLORS[color] ?? color, { radius: 0.065 });
}

function pinPos(parts, id) {
  const [partId, pin] = id.split(".");
  const part = parts[partId];
  part.updateMatrixWorld(true);
  return P.pinWorld(part, pin);
}

export function buildRobot({ wired = true } = {}) {
  const robot = new THREE.Group();
  robot.add(P.chassis());
  const parts = {};
  for (const [id, slot] of Object.entries(SLOTS)) parts[id] = mountPart(robot, id, KINDS[slot.kind].make());
  if (wired) for (const [a, b, color] of REFERENCE) robot.add(wireMesh(robot, parts, a, b, color));
  parts.driver.userData.jumpers.ENA.visible = parts.driver.userData.jumpers.ENB.visible = !wired;
  return { robot, parts };
}

// ---- The arena ------------------------------------------------------------------------

function makeArena() {
  const g = new THREE.Group();
  const floorTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const x = c.getContext("2d");
    x.fillStyle = "#3a3f47"; x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; x.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3); }
    x.strokeStyle = "rgba(255,255,255,0.08)"; x.lineWidth = 2;
    for (let i = 0; i <= 1024; i += 1024 / 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.receiveShadow = true;
  floor.userData.noPick = true;
  g.add(floor);
  // A start box in tape.
  const tape = new THREE.Mesh(new THREE.RingGeometry(14, 15.5, 4, 1), new THREE.MeshBasicMaterial({ color: "#f3c623" }));
  tape.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  tape.position.set(0, 0.03, -110);
  tape.userData.noPick = true;
  g.add(tape);
  const obstacles = [];
  const wallMat = new THREE.MeshStandardMaterial({ color: "#d9d4c7", roughness: 0.8 });
  const block = (w, h, d, x, z, mat, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    obstacles.push(m);
    return m;
  };
  block(304, 20, 4, 0, 152, wallMat);
  block(304, 20, 4, 0, -152, wallMat);
  block(4, 20, 304, 152, 0, wallMat);
  block(4, 20, 304, -152, 0, wallMat);
  const card = new THREE.MeshStandardMaterial({ color: "#b8875a", roughness: 0.9 });
  block(36, 26, 30, -50, -20, card, 0.3);
  block(30, 24, 30, 60, 40, card, -0.2);
  block(60, 18, 20, 20, -50, card, 0);
  block(28, 30, 28, -70, 85, card, 0.6);
  block(26, 22, 40, 95, -90, card, 0.1);
  const binMat = new THREE.MeshStandardMaterial({ color: "#2f6bff", roughness: 0.5 });
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 32, 32), binMat);
  bin.position.set(-10, 16, 70);
  bin.castShadow = bin.receiveShadow = true;
  g.add(bin);
  obstacles.push(bin);
  g.userData.obstacles = obstacles;
  return g;
}

// ---- The simulator -----------------------------------------------------------------

export class Simulator {
  constructor(stage, root) {
    this.stage = stage;
    this.root = root; // the academy's DOM root
    this.mode = "build";
    this.color = "blue";
    this.wires = []; // { a, b, color, mesh }
    this.history = [];
    this.serialLines = [];
    this.powerOn = false;
    this.gpio = new Map();
    this.runner = new SketchRunner(this.hardware());
    this.sketch = EXAMPLE_SKETCH;
    try { this.sketch = localStorage.getItem("yaver-robot-sketch") || EXAMPLE_SKETCH; } catch {}
    this.buildUi();
  }

  // ---- Opening and closing -----------------------------------------------------

  open() {
    this.active = true;
    const { stage } = this;
    this.robot = new THREE.Group();
    this.robot.add(P.chassis());
    stage.root.add(this.robot);
    this.parts = {};
    this.loose = [];
    this.wires = [];
    this.history = [];
    this.wiresGroup = new THREE.Group();
    this.robot.add(this.wiresGroup);
    this.ghosts = new THREE.Group();
    stage.root.add(this.ghosts);
    this.arena = makeArena();
    this.arena.visible = false;
    stage.root.add(this.arena);
    this.pose = { x: 0, z: -110, heading: 0 };
    this.wheel = { L: 0, R: 0 };
    this.preview = null;
    this.ui.root.hidden = false;
    this.setMode("build");
    this.renderThumbs();
    this.refresh();
  }

  close() {
    this.active = false;
    this.stopSketch();
    this.ui.root.hidden = true;
    this.stage.bench.visible = true;
    this.stage.scene.fog.far = 320;
  }

  // ---- UI -----------------------------------------------------------------

  buildUi() {
    const el = document.createElement("div");
    el.className = "sim";
    el.hidden = true;
    el.innerHTML = `
      <nav class="hud ac-panel sim-tabs">
        <button data-mode="build"><b>1</b> Build</button>
        <button data-mode="wire"><b>2</b> Wire</button>
        <button data-mode="code"><b>3</b> Code</button>
        <button data-mode="run"><b>4</b> Run</button>
      </nav>
      <aside class="hud ac-panel sim-bin" aria-label="Parts"></aside>
      <section class="hud ac-panel sim-side" data-hand-scroll></section>
      <div class="sim-tip" hidden></div>`;
    this.root.appendChild(el);
    this.ui = { root: el, tabs: el.querySelector(".sim-tabs"), bin: el.querySelector(".sim-bin"), side: el.querySelector(".sim-side"), tip: el.querySelector(".sim-tip") };
    this.ui.tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (b) this.setMode(b.dataset.mode);
    });
    // Pressing on a shelf tile with the mouse pulls a part out.
    this.ui.bin.addEventListener("pointerdown", (e) => {
      const tile = e.target.closest(".sim-tile");
      if (!tile || e.button !== 0) return;
      e.preventDefault();
      const drag = this.dragFromBin(tile.dataset.kind, e.clientX, e.clientY);
      if (!drag) return;
      const move = (ev) => drag.move(ev.clientX, ev.clientY);
      const up = (ev) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); drag.end(ev.clientX, ev.clientY); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  setMode(mode) {
    if (mode === "run" && this.mode !== "run") this.enterArena();
    if (mode !== "run" && this.mode === "run") this.leaveArena();
    this.mode = mode;
    for (const b of this.ui.tabs.querySelectorAll("button")) b.classList.toggle("active", b.dataset.mode === mode);
    this.ui.bin.hidden = mode !== "build";
    for (const part of Object.values(this.parts ?? {})) if (part.userData.part.pins.size) P.showPins(part, mode === "wire");
    this.ui.root.dataset.mode = mode;
    this.renderSide();
    const views = {
      build: { target: [0, 3, 0], theta: 0.7, phi: 0.95, radius: 58 },
      wire: { target: [0, 4, 1], theta: 0.35, phi: 0.62, radius: 40 },
      code: { target: [0, 4, 2], theta: -0.5, phi: 0.9, radius: 46 },
    };
    if (views[mode]) this.stage.flyTo(views[mode], 1100);
  }

  renderSide() {
    const s = this.ui.side;
    if (this.mode === "build") {
      s.innerHTML = `<h2>Build the robot</h2>
        <p><b>Pinch a part on the shelf</b> (or drag it with the mouse) and bring it to the chassis. Its place lights up green; let go there and it clicks in.</p>
        <p>Wheels go on after their motors. Pinch a fitted part to take it off again.</p>
        <ul class="sim-list">${Object.entries(SLOTS).map(([id, slot]) => `<li class="${this.parts[id] ? "done" : ""}">${this.parts[id] ? "✓" : "○"} ${slot.title}</li>`).join("")}</ul>
        <div class="ac-buttons"><button class="ac-btn" data-act="assemble">Assemble it for me</button><button class="ac-btn" data-act="clear-build">Start over</button></div>
        ${this.isBuilt() ? `<p class="ok">All parts fitted. Next: <button class="ac-btn primary" data-act="next">2 · Wire it →</button></p>` : ""}`;
    } else if (this.mode === "wire") {
      const c = this.circuit;
      const missing = Object.keys(SLOTS).filter((id) => !this.parts[id]);
      s.innerHTML = `<h2>Wire it up</h2>
        ${missing.length ? `<p class="warn">Fit all the parts first (missing: ${missing.map((id) => SLOTS[id].title).join(", ")}).</p>` : ""}
        <p><b>Pinch a pin</b> (the glowing dots) and pull the wire to another pin. Hover a pin to see its name. Pinch a wire to select it.</p>
        <div class="sim-colors">${Object.entries(P.WIRE_COLORS).map(([n, hex]) => `<button class="sim-color ${n === this.color ? "active" : ""}" data-color="${n}" title="${n}" style="background:${hex}"></button>`).join("")}<span>Power wires turn red and ground wires black on their own.</span></div>
        <div class="ac-buttons"><button class="ac-btn" data-act="autowire">Wire it for me</button><button class="ac-btn" data-act="undo" ${this.history.length ? "" : "disabled"}>Undo</button><button class="ac-btn" data-act="delete-wire" ${this.selectedWire ? "" : "disabled"}>Delete selected</button><button class="ac-btn" data-act="clear-wires" ${this.wires.length ? "" : "disabled"}>Remove all</button></div>
        <h3>Wiring diagram <small>${c.refDone}/${REFERENCE.length}</small></h3>
        <table class="sim-ref">${REFERENCE.map(([a, b, color, why], i) => `<tr class="${c.refOk[i] ? "done" : ""}"><td>${c.refOk[i] ? "✓" : "○"}</td><td><i class="wire-dot" style="background:${P.WIRE_COLORS[color]}"></i>${pinLabel(a)} → ${pinLabel(b)}${why ? `<br><small>${why}</small>` : ""}</td></tr>`).join("")}</table>
        <p class="tip">The diagram is one way that works. Wire it differently if you like, as long as the code's pin numbers match.</p>`;
    } else if (this.mode === "code") {
      s.innerHTML = `<h2>Program the ESP32</h2>
        <p>This is real Arduino code for the ESP32. Edit it, then <b>Upload</b>: the pin numbers must match your wiring.</p>
        <div class="sim-editor"><pre class="sim-gutter"></pre><textarea spellcheck="false" autocomplete="off" autocapitalize="off"></textarea></div>
        <p class="sim-error" hidden></p>
        <div class="ac-buttons"><button class="ac-btn primary" data-act="upload">Upload and run →</button><button class="ac-btn" data-act="reset-code">Reset to the example</button></div>`;
      const ta = s.querySelector("textarea");
      const gutter = s.querySelector(".sim-gutter");
      ta.value = this.sketch;
      const lines = () => { gutter.textContent = ta.value.split("\n").map((_, i) => i + 1).join("\n"); };
      ta.addEventListener("input", () => { this.sketch = ta.value; lines(); try { localStorage.setItem("yaver-robot-sketch", ta.value); } catch {} });
      ta.addEventListener("scroll", () => { gutter.scrollTop = ta.scrollTop; });
      ta.addEventListener("keydown", (e) => {
        e.stopPropagation(); // keep Space, Esc and the arrows for typing
        if (e.key === "Tab") { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); }
      });
      lines();
      if (this.lastError) this.showError(this.lastError.msg, this.lastError.line);
    } else {
      s.innerHTML = `<h2>Run it</h2>
        <div class="ac-buttons"><button class="ac-btn ${this.powerOn ? "active" : ""}" data-act="power">${this.powerOn ? "⏻ Power on" : "⏻ Power off"}</button><button class="ac-btn" data-act="restart">Upload again</button><button class="ac-btn" data-act="reset-pos">Back to start</button><button class="ac-btn ${this.follow ? "active" : ""}" data-act="follow">Follow camera</button></div>
        <div class="sim-status"></div>
        <h3>Live</h3><div class="sim-live"></div>
        <h3>Serial monitor <small>115200 baud</small></h3><pre class="sim-serial"></pre>`;
      this.serialEl = s.querySelector(".sim-serial");
      this.serialEl.textContent = this.serialLines.join("\n");
      this.renderStatus();
    }
    s.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => this.act(b.dataset.act)));
    s.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => { this.color = b.dataset.color; this.renderSide(); }));
  }

  act(a) {
    if (a === "assemble") this.assembleAll();
    else if (a === "clear-build") this.clearBuild();
    else if (a === "next") this.setMode("wire");
    else if (a === "autowire") this.autoWire();
    else if (a === "undo") { const w = this.history.pop(); if (w) this.removeWire(w, false); }
    else if (a === "delete-wire") { if (this.selectedWire) this.removeWire(this.selectedWire); }
    else if (a === "clear-wires") { for (const w of [...this.wires]) this.removeWire(w, false); this.history = []; }
    else if (a === "upload") this.upload();
    else if (a === "reset-code") { this.sketch = EXAMPLE_SKETCH; try { localStorage.removeItem("yaver-robot-sketch"); } catch {} this.lastError = null; this.renderSide(); }
    else if (a === "power") { this.setPower(!this.powerOn); }
    else if (a === "restart") this.upload();
    else if (a === "reset-pos") { this.pose = { x: 0, z: -110, heading: 0 }; this.wheel = { L: 0, R: 0 }; }
    else if (a === "follow") { this.follow = !this.follow; this.renderSide(); }
    if (["autowire", "undo", "delete-wire", "clear-wires", "clear-build"].includes(a)) { this.refresh(); }
  }

  renderStatus() {
    const el = this.ui.side.querySelector(".sim-status");
    if (!el) return;
    const c = this.circuit;
    const items = [];
    if (c.fatal) items.push(`<li class="bad">✖ ${c.fatal}</li>`);
    for (const e of c.errors) items.push(`<li class="bad">✖ ${e}</li>`);
    for (const w of c.warnings) items.push(`<li class="warn">! ${w}</li>`);
    if (!items.length) items.push(`<li class="ok">✓ Wiring looks right.</li>`);
    if (this.runError) items.unshift(`<li class="bad">✖ ${this.runError}</li>`);
    el.innerHTML = `<ul class="sim-checks">${items.join("")}</ul>`;
  }

  showError(msg, line) {
    const el = this.ui.side.querySelector(".sim-error");
    if (!el) return;
    el.hidden = false;
    el.textContent = line ? `Line ${line}: ${msg}` : msg;
  }

  // Small pictures of each part for the shelf, rendered once.
  renderThumbs() {
    if (this.thumbs) return this.renderBin();
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(120, 96);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight("#cfe8ff", "#1a1f29", 1.0));
    const sun = new THREE.DirectionalLight("#ffffff", 2.2);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(30, 120 / 96, 0.1, 200);
    this.thumbs = {};
    for (const [kind, k] of Object.entries(KINDS)) {
      const part = k.make();
      const box = new THREE.Box3().setFromObject(part);
      const size = box.getSize(V(0, 0, 0)).length();
      const c = box.getCenter(V(0, 0, 0));
      cam.position.set(c.x + size * 0.9, c.y + size * 0.75, c.z + size * 1.15);
      cam.lookAt(c);
      scene.add(part);
      r.render(scene, cam);
      this.thumbs[kind] = r.domElement.toDataURL();
      scene.remove(part);
      dispose(part);
    }
    scene.environment.dispose();
    pmrem.dispose();
    r.dispose();
    r.forceContextLoss();
    this.renderBin();
  }

  renderBin() {
    const used = {};
    for (const part of [...Object.values(this.parts), ...this.loose]) used[part.userData.part.kind] = (used[part.userData.part.kind] ?? 0) + 1;
    this.ui.bin.innerHTML = `<h3>Parts</h3>` + Object.entries(KINDS).map(([kind, k]) => {
      const left = k.count - (used[kind] ?? 0);
      return `<div class="sim-tile ${left ? "" : "empty"}" data-kind="${kind}" title="${k.title}"><img src="${this.thumbs?.[kind] ?? ""}" alt=""><span>${k.title}</span>${k.count > 1 ? `<b>×${left}</b>` : ""}</div>`;
    }).join("");
  }

  // ---- Building ------------------------------------------------------------------

  isBuilt() { return Object.keys(SLOTS).every((id) => this.parts[id]); }

  freeSlots(kind) {
    return Object.entries(SLOTS).filter(([id, s]) => s.kind === kind && !this.parts[id] && (!s.needs || this.parts[s.needs])).map(([id]) => id);
  }

  dragFromBin(kind, sx, sy) {
    if (this.mode !== "build") return null;
    const k = KINDS[kind];
    const used = [...Object.values(this.parts), ...this.loose].filter((p) => p.userData.part.kind === kind).length;
    if (used >= k.count) return null;
    const part = k.make();
    const p = this.stage.onPlane(sx, sy, DRAG_Y) ?? V(0, DRAG_Y, 0);
    part.position.copy(p);
    this.stage.root.add(part);
    this.loose.push(part);
    this.renderBin();
    return this.dragPart(part);
  }

  // Drags a part across the scene; near a free place that fits it, it is
  // pulled into position; letting go there fits it.
  dragPart(part) {
    const kind = part.userData.part.kind;
    const slots = this.freeSlots(kind);
    this.showGhosts(kind, slots);
    let target = null;
    const move = (sx, sy) => {
      const p = this.stage.onPlane(sx, sy, DRAG_Y);
      if (!p) return;
      target = null;
      let best = 90;
      for (const id of slots) {
        const pos = V(...SLOTS[id].pos);
        const scr = this.stage.project(pos.clone().setY(pos.y + 1));
        const d = Math.hypot(scr.x - sx, scr.y - sy);
        if (d < best) { best = d; target = id; }
      }
      for (const g of this.ghosts.children) g.material.opacity = g.userData.slot === target ? 0.55 : 0.18;
      if (target) {
        const s = SLOTS[target];
        part.position.lerp(V(...s.pos).setY(s.pos[1] + 1.2), 0.35);
        part.rotation.y += ((s.rotY ?? 0) - part.rotation.y) * 0.3;
        part.scale.x = s.mirror ? -1 : 1;
      } else {
        part.position.lerp(p, 0.5);
        part.rotation.y *= 0.8;
        part.scale.x = 1;
      }
    };
    const end = (sx, sy) => {
      this.ghosts.clear();
      const overBin = this.overBin(sx, sy);
      if (target && !overBin) {
        this.loose = this.loose.filter((l) => l !== part);
        const s = SLOTS[target];
        const world = part.position.clone();
        this.stage.root.remove(part);
        mountPart(this.robot, target, part);
        part.position.copy(this.robot.worldToLocal(world));
        tween(part.position, { x: s.pos[0], y: s.pos[1], z: s.pos[2] }, { ms: 380, curve: ease.out });
        this.parts[target] = part;
        if (part.userData.part.kind === "driver") this.updateJumpers();
      } else if (overBin) {
        this.loose = this.loose.filter((l) => l !== part);
        this.stage.root.remove(part);
        dispose(part);
      } else {
        // Set it down on the mat.
        const base = part.userData.size?.base ?? 0;
        tween(part.position, { y: base }, { ms: 400, curve: ease.out });
      }
      this.renderBin();
      this.refresh();
    };
    return { move, end };
  }

  overBin(sx, sy) {
    const r = this.ui.bin.getBoundingClientRect();
    return !this.ui.bin.hidden && sx > r.left && sx < r.right && sy > r.top && sy < r.bottom;
  }

  showGhosts(kind, slots) {
    this.ghosts.clear();
    const sample = KINDS[kind].make();
    const box = new THREE.Box3().setFromObject(sample);
    const size = box.getSize(V(0, 0, 0));
    const center = box.getCenter(V(0, 0, 0));
    for (const id of slots) {
      const s = SLOTS[id];
      const g = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ color: "#06d6a0", transparent: true, opacity: 0.18, depthWrite: false }));
      const off = center.clone();
      if (s.mirror) off.x *= -1;
      off.applyAxisAngle(V(0, 1, 0), s.rotY ?? 0);
      g.position.set(...s.pos).add(off);
      g.rotation.y = s.rotY ?? 0;
      g.userData.slot = id;
      g.userData.noPick = true;
      this.ghosts.add(g);
    }
  }

  // Takes a fitted part off the chassis (and its wires with it).
  unmount(id) {
    const part = this.parts[id];
    for (const w of this.wires.filter((w) => w.a.startsWith(id + ".") || w.b.startsWith(id + "."))) this.removeWire(w, false);
    // A wheel can't stay on without its motor.
    for (const [sid, s] of Object.entries(SLOTS)) if (s.needs === id && this.parts[sid]) this.dropLoose(sid);
    const world = part.getWorldPosition(V(0, 0, 0));
    this.robot.remove(part);
    delete this.parts[id];
    part.position.copy(world);
    part.scale.x = 1;
    P.showPins(part, false);
    this.stage.root.add(part);
    this.loose.push(part);
    return part;
  }

  dropLoose(id) {
    const part = this.unmount(id);
    tween(part.position, { x: part.position.x + (part.position.x < 0 ? -12 : 12), y: part.userData.size?.base ?? 0 }, { ms: 500 });
  }

  async assembleAll() {
    if (this.mode !== "build") return;
    for (const p of this.loose) this.stage.root.remove(p);
    this.loose = [];
    const order = ["motorR", "motorL", "wheelR", "wheelL", "caster", "battery", "driver", "esp32", "sonar"];
    for (const id of order) {
      if (this.parts[id] || !this.active) continue;
      const s = SLOTS[id];
      const part = mountPart(this.robot, id, KINDS[s.kind].make());
      part.position.y += 14;
      this.parts[id] = part;
      tween(part.position, { y: s.pos[1] }, { ms: 520, curve: ease.out });
      this.renderBin();
      await new Promise((r) => setTimeout(r, 170));
    }
    this.updateJumpers();
    this.refresh();
  }

  clearBuild() {
    for (const w of [...this.wires]) this.removeWire(w, false);
    for (const id of Object.keys(this.parts)) { this.robot.remove(this.parts[id]); }
    for (const p of this.loose) this.stage.root.remove(p);
    this.parts = {};
    this.loose = [];
    this.renderBin();
  }

  // ---- Wiring ------------------------------------------------------------------------

  allPins() {
    const out = [];
    for (const [id, part] of Object.entries(this.parts)) for (const pin of part.userData.part.pins.values()) out.push({ id: `${id}.${pin.name}`, part, pin });
    return out;
  }

  pinAt(sx, sy, max = 16) {
    let best = null, bestD = max;
    const w = V(0, 0, 0);
    for (const p of this.allPins()) {
      p.part.localToWorld(w.copy(p.pin.pos));
      const s = this.stage.project(w);
      if (!s.front) continue;
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  autoColor(a, b) {
    const pins = [a, b].map((id) => id.split(".")[1]);
    if (pins.some((p) => /^(GND\d?|-)$/.test(p))) return "black";
    if (pins.some((p) => /^(5V|12V|3V3|VCC|\+)$/.test(p))) return "red";
    return this.color;
  }

  addWire(a, b, color = this.autoColor(a, b), record = true) {
    if (a === b || this.wires.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return null;
    const mesh = wireMesh(this.robot, this.parts, a, b, color);
    mesh.userData.wire = true;
    this.wiresGroup.add(mesh);
    const w = { a, b, color, mesh };
    mesh.userData.wireRef = w;
    this.wires.push(w);
    if (record) this.history.push(w);
    if (a.startsWith("driver.EN") || b.startsWith("driver.EN")) this.updateJumpers();
    return w;
  }

  removeWire(w, refresh = true) {
    this.wiresGroup.remove(w.mesh);
    dispose(w.mesh);
    this.wires = this.wires.filter((x) => x !== w);
    this.history = this.history.filter((x) => x !== w);
    if (this.selectedWire === w) this.selectedWire = null;
    this.updateJumpers();
    if (refresh) this.refresh();
  }

  // The ENA / ENB jumper comes off when a wire goes on that pin.
  updateJumpers() {
    const d = this.parts?.driver;
    if (!d) return;
    for (const en of ["ENA", "ENB"]) d.userData.jumpers[en].visible = !this.wires.some((w) => w.a === `driver.${en}` || w.b === `driver.${en}`);
  }

  async autoWire() {
    if (!this.isBuilt()) return;
    for (const w of [...this.wires]) this.removeWire(w, false);
    for (const [a, b, color] of REFERENCE) {
      if (!this.active || this.mode !== "wire") break;
      const w = this.addWire(a, b, color, false);
      if (w) {
        w.mesh.scale.y = 0.01;
        tween(w.mesh.scale, { y: 1 }, { ms: 260, curve: ease.out });
      }
      this.refresh();
      await new Promise((r) => setTimeout(r, 110));
    }
    this.refresh();
  }

  selectWire(w) {
    if (this.selectedWire) this.selectedWire.mesh.userData.mat.emissiveIntensity = 0;
    this.selectedWire = w;
    if (w) w.mesh.userData.mat.emissiveIntensity = 0.7;
    if (this.mode === "wire") this.renderSide();
  }

  dragWire(start) {
    const from = start.part.localToWorld(start.pin.pos.clone());
    const geo = new THREE.BufferGeometry().setFromPoints([from, from]);
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: "#4cc9ff", dashSize: 0.4, gapSize: 0.25, depthTest: false }));
    line.renderOrder = 20;
    line.userData.noPick = true;
    this.stage.root.add(line);
    let over = null;
    const move = (sx, sy) => {
      over = this.pinAt(sx, sy, 20);
      if (over?.id === start.id) over = null;
      const to = over ? over.part.localToWorld(over.pin.pos.clone()) : this.stage.onPlane(sx, sy, from.y) ?? from;
      geo.setFromPoints([from, to]);
      line.computeLineDistances();
      this.hoverPin = over ?? start;
    };
    const end = () => {
      this.stage.root.remove(line);
      geo.dispose();
      if (over) this.addWire(start.id, over.id);
      this.hoverPin = null;
      this.refresh();
    };
    return { move, end };
  }

  // ---- Grabbing (hands and mouse share this) ---------------------------------------

  // Returns { move(x, y), end(x, y) } or null.
  grabAt(sx, sy, el) {
    if (!this.active) return null;
    const tile = el?.closest?.(".sim-tile");
    if (tile) return this.dragFromBin(tile.dataset.kind, sx, sy);
    if (el && el !== this.stage.renderer.domElement) return null;
    if (this.mode === "wire") {
      const pin = this.pinAt(sx, sy);
      if (pin) return this.dragWire(pin);
      const hit = this.stage.pick(sx, sy, [this.wiresGroup]);
      if (hit) {
        let o = hit.object;
        while (o && !o.userData.wireRef) o = o.parent;
        this.selectWire(o?.userData.wireRef ?? null);
        return { move() {}, end() {} };
      }
      return null;
    }
    if (this.mode === "build") {
      const hit = this.stage.pick(sx, sy, [this.robot, ...this.loose], (m) => !m.userData.wire);
      if (!hit) return null;
      let o = hit.object;
      while (o && !o.userData.part) o = o.parent;
      if (!o || o.userData.part.kind === "chassis") return null;
      if (o.userData.slot && this.parts[o.userData.slot] === o) this.unmount(o.userData.slot);
      this.renderBin();
      this.refresh();
      return this.dragPart(o);
    }
    return null;
  }

  hover(sx, sy) {
    if (this.mode !== "wire" || !this.active) { this.setTip(null); return; }
    const p = this.hoverPin ?? this.pinAt(sx, sy);
    for (const q of this.allPins()) q.pin.marker.scale.setScalar(q === p || (p && q.id === p.id) ? 2.2 : 1);
    this.setTip(p ? { text: `${SLOT_NAMES[p.id.split(".")[0]]} · <b>${p.pin.label}</b>`, x: sx, y: sy } : null);
  }

  setTip(t) {
    const el = this.ui.tip;
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = t.text;
    el.style.transform = `translate(${t.x + 18}px, ${t.y - 34}px)`;
  }

  // ---- The circuit ---------------------------------------------------------------------

  // Works out what is connected to what from the wires, and what that means
  // electrically: who has power, which GPIO drives which input, and what's
  // wrong.
  refresh() {
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const join = (a, b) => { if (!parent.has(a) || !parent.has(b)) return; parent.set(find(a), find(b)); };
    for (const p of this.allPins()) parent.set(p.id, p.id);
    join("esp32.GND1", "esp32.GND2");
    join("esp32.GND1", "esp32.GND3");
    for (const w of this.wires) join(w.a, w.b);
    const net = (id) => (parent.has(id) ? find(id) : `none:${id}`);
    const has = (id) => !!this.parts[id];
    const members = (n) => [...parent.keys()].filter((k) => find(k) === n);
    const c = { errors: [], warnings: [], fatal: null, net, members };

    const VBAT = has("battery") ? net("battery.+") : null;
    const G = has("battery") ? net("battery.-") : null;
    if (VBAT && VBAT === G) c.fatal = "Short circuit: the battery's + and − are joined. In real life: sparks, heat and a ruined battery.";
    c.driverPowered = has("driver") && VBAT && net("driver.12V") === VBAT && net("driver.GND") === G;
    if (has("driver") && VBAT && net("driver.12V") !== VBAT) c.errors.push("The driver has no battery power: wire battery + to its +12V terminal.");
    if (has("driver") && G && net("driver.GND") !== G) c.errors.push("The driver's GND isn't joined to battery −.");
    const V5 = c.driverPowered ? net("driver.5V") : null;
    if (has("driver") && VBAT && net("driver.5V") === VBAT) c.errors.push("The driver's +5V is an output: don't feed the battery into it.");
    if (has("esp32")) {
      const e5 = net("esp32.5V"), e3 = net("esp32.3V3"), eg = net("esp32.GND1");
      if (e3 === VBAT || (V5 && e3 === V5)) c.fatal = `The ESP32's 3V3 pin got ${e3 === VBAT ? "7.4" : "5"} V. That pin is the regulator's output: the chip is destroyed (magic smoke).`;
      for (const pin of [...P.ESP32_LEFT, ...P.ESP32_RIGHT]) {
        const g = gpioOf(pin);
        if (g === null) continue;
        const n = net(`esp32.${pin}`);
        if (n === VBAT || (V5 && n === V5)) c.fatal = `GPIO ${g} is wired straight to ${n === VBAT ? "the battery" : "5 V"}. ESP32 pins take 3.3 V at most: the pin (and maybe the chip) is destroyed.`;
      }
      c.espPowered = !!(G && eg === G && ((V5 && e5 === V5) || e5 === VBAT));
      if (G && e5 === VBAT) c.warnings.push("The ESP32's 5V pin is on the raw battery (7.4–8.4 V). Its regulator copes, but runs hot. The driver's +5V is better.");
      if (!c.espPowered) {
        if (!V5 && e5 !== VBAT) c.errors.push("The ESP32 has no power: wire the driver's +5V to the ESP32's 5V pin.");
        else if ((V5 && e5 !== V5) && e5 !== VBAT) c.errors.push("The ESP32 has no power: wire the driver's +5V to the ESP32's 5V pin.");
        if (G && eg !== G) c.errors.push("The ESP32's GND isn't joined to the battery's ground: no common ground, no circuit.");
      }
    }
    // What drives each driver input: a GPIO, a fixed level, nothing (floating),
    // or for ENA / ENB with no wire, the jumper.
    const gpioIn = (n) => {
      for (const id of members(n)) if (id.startsWith("esp32.")) { const g = gpioOf(id.slice(6)); if (g !== null) return g; }
      return null;
    };
    c.inputs = {};
    if (has("driver")) for (const pin of P.L298N_PINS) {
      const n = net(`driver.${pin}`);
      const g = gpioIn(n);
      const wired = this.wires.some((w) => w.a === `driver.${pin}` || w.b === `driver.${pin}`);
      c.inputs[pin] = g !== null ? { gpio: g } : n === V5 || n === VBAT ? { level: 1 } : n === G ? { level: 0 } : wired ? { floating: true } : pin.startsWith("EN") ? { level: 1, jumper: true } : { floating: true };
      if (c.inputs[pin].floating && has("motorL") && pin.startsWith("IN")) c.warnings.push(`${pin} isn't connected to the ESP32: that motor won't respond.`);
    }
    // Which driver outputs each motor terminal is on.
    c.motors = {};
    for (const m of ["motorL", "motorR"]) {
      if (!has(m)) continue;
      const outs = (t) => ["OUT1", "OUT2", "OUT3", "OUT4"].filter((o) => has("driver") && net(`driver.${o}`) === net(`${m}.${t}`));
      c.motors[m] = { plus: outs("M+")[0] ?? null, minus: outs("M-")[0] ?? null };
      if (!c.motors[m].plus || !c.motors[m].minus) c.warnings.push(`The ${m === "motorL" ? "left" : "right"} motor isn't connected to the driver's outputs.`);
    }
    if (has("esp32") && c.espPowered) {
      const ig = c.inputs?.IN1?.gpio !== undefined && !c.inputs?.IN1?.floating;
      if (!ig && has("driver")) c.warnings.push("No ESP32 pins drive the motor driver yet.");
    }
    // The distance sensor.
    if (has("sonar")) {
      const vcc = net("sonar.VCC");
      c.sonar = {
        trig: gpioIn(net("sonar.Trig")),
        echo: gpioIn(net("sonar.Echo")),
        powered: !!(G && net("sonar.GND") === G && ((V5 && vcc === V5) || (c.espPowered && vcc === net("esp32.5V")))),
        weak: has("esp32") && vcc === net("esp32.3V3"),
        over: vcc === VBAT,
      };
      if (c.sonar.over) c.warnings.push("The HC-SR04 is on 7.4 V: it's made for 5 V and may fail.");
      if (c.sonar.weak) c.warnings.push("The HC-SR04 is on 3.3 V: it needs 5 V and will miss echoes.");
      if (!c.sonar.powered && !c.sonar.weak && !c.sonar.over) c.warnings.push("The distance sensor has no 5 V power, or no ground.");
      if (c.sonar.echo !== null) c.warnings.push(`Echo (5 V) goes straight into GPIO ${c.sonar.echo}. Fine in the simulator; on a real build add a 1 kΩ / 2 kΩ divider.`);
      if (c.sonar.trig === null || c.sonar.echo === null) c.warnings.push("Wire the sensor's Trig and Echo to ESP32 pins.");
    }
    c.refOk = REFERENCE.map(([a, b]) => has(a.split(".")[0]) && has(b.split(".")[0]) && net(a) === net(b));
    c.refDone = c.refOk.filter(Boolean).length;
    this.circuit = c;
    if (this.mode === "build" || this.mode === "wire") this.renderSide();
    else this.renderStatus();
  }

  // ---- The simulated ESP32 -------------------------------------------------------------

  hardware() {
    const sim = this;
    const st = (g) => {
      if (!sim.gpio.has(g)) sim.gpio.set(g, { mode: "INPUT", level: 0, duty: null });
      return sim.gpio.get(g);
    };
    return {
      pinMode(g, mode) {
        if (g >= 6 && g <= 11) sim.crash(`Guru Meditation Error: Core 1 panic'ed (Cache disabled but cached memory region accessed). GPIO ${g} belongs to the flash chip.`);
        if (g >= 34 && g <= 39 && mode === "OUTPUT") { sim.serial(`E (${Math.floor(sim.runner.millis())}) gpio: GPIO ${g} can only be used as input mode`); st(g).mode = "INPUT"; return; }
        if (!(g >= 0 && g <= 39)) { sim.serial(`E gpio: GPIO ${g} doesn't exist`); return; }
        st(g).mode = mode;
      },
      digitalWrite(g, v) {
        const s = st(g);
        if (s.mode !== "OUTPUT") return; // writing to an input only toggles its pull-up on real chips
        s.level = v; s.duty = null;
        const trig = sim.circuit?.sonar?.trig;
        if (g === trig) {
          const now = sim.runner.micros();
          if (v) sim.trigHigh = now;
          else if (sim.trigHigh != null) { if (now - sim.trigHigh >= 9.5) sim.trigArmed = now; sim.trigHigh = null; }
        }
      },
      digitalRead(g) {
        const s = st(g);
        if (s.mode === "OUTPUT") return s.level;
        if (s.mode === "INPUT_PULLUP") return 1;
        return 0;
      },
      analogRead() { return Math.floor(Math.random() * 30); },
      pwm(g, duty) { const s = st(g); s.mode = "OUTPUT"; s.duty = Math.min(Math.max(duty, 0), 1); s.level = duty > 0.5 ? 1 : 0; },
      pulseIn(g, level, timeout, now) {
        const c = sim.circuit;
        if (!c?.sonar || g !== c.sonar.echo || level !== 1) return 0;
        if (sim.trigArmed == null || now - sim.trigArmed > 50000) return 0;
        sim.trigArmed = null;
        if (!c.sonar.powered && !c.sonar.over) return 0;
        if (c.sonar.weak && Math.random() < 0.7) return 0;
        const d = sim.distance;
        if (d == null || d > 400) return 0;
        const us = Math.max(d, 2) * 2 / 0.0343 * (1 + (Math.random() - 0.5) * 0.01);
        return us > timeout ? 0 : Math.round(us);
      },
      serial: (text) => sim.serial(text),
    };
  }

  crash(msg) {
    this.serial(msg);
    this.serial("Rebooting...");
    this.runner.stop();
    this.runError = "The ESP32 crashed (see the Serial monitor).";
    this.renderStatus();
    throw new Error(msg);
  }

  serial(text) {
    this.serialLines.push(text);
    if (this.serialLines.length > 300) this.serialLines.splice(0, this.serialLines.length - 300);
    this.serialDirty = true;
  }

  setPower(on) {
    this.powerOn = on;
    if (!on) this.stopSketch();
    else this.startSketch();
    this.renderSide();
  }

  upload() {
    this.lastError = null;
    this.runError = null;
    if (this.mode !== "run") this.setMode("run");
    this.serialLines = [];
    this.serialDirty = true;
    if (!this.powerOn) this.setPower(true);
    else this.startSketch();
  }

  startSketch() {
    this.stopSketch();
    this.gpio.clear();
    this.runError = null;
    const c = this.circuit;
    if (!this.isBuilt()) { this.runError = "The robot isn't finished: go back to Build."; this.renderStatus(); return; }
    if (c.fatal) { this.runError = "Nothing runs: something burnt out. Fix the wiring, then power up again."; this.renderStatus(); return; }
    if (!c.espPowered) { this.runError = "The ESP32 has no power, so the sketch can't run."; this.renderStatus(); return; }
    this.serial("ets Jun  8 2016 00:22:57");
    this.serial("rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)");
    this.parts.esp32.userData.powerLed.material.emissiveIntensity = 3;
    this.runner.run(this.sketch, (msg, line) => {
      this.lastError = { msg, line };
      this.runError = `${line ? `Line ${line}: ` : ""}${msg}`;
      this.serial(`Error: ${this.runError}`);
      this.renderStatus();
    });
    this.renderStatus();
  }

  stopSketch() {
    this.runner.stop();
    this.gpio.clear();
    if (this.parts?.esp32) this.parts.esp32.userData.powerLed.material.emissiveIntensity = 0.15;
  }

  // ---- Driving --------------------------------------------------------------------------

  enterArena() {
    this.stage.bench.visible = false;
    this.arena.visible = true;
    this.ghosts.clear();
    for (const p of this.loose) p.visible = false;
    this.stage.scene.fog.far = 900;
    this.follow ??= true;
    this.stage.flyTo({ target: [this.pose.x, 5, this.pose.z], theta: 0.6, phi: 0.95, radius: 120 }, 1200);
  }

  leaveArena() {
    this.stopSketch();
    this.powerOn = false;
    this.arena.visible = false;
    this.stage.bench.visible = true;
    for (const p of this.loose) p.visible = true;
    this.stage.scene.fog.far = 320;
    this.robot.position.set(0, 0, 0);
    this.robot.rotation.set(0, 0, 0);
  }

  // The voltage on a driver output, and whether its bridge is braking.
  bridge(c, side) {
    const [inA, inB, en] = side === "A" ? ["IN1", "IN2", "ENA"] : ["IN3", "IN4", "ENB"];
    const read = (pin, pwm = false) => {
      const s = c.inputs[pin];
      if (!s || s.floating) return 0;
      if (s.level !== undefined) return s.level;
      const g = this.gpio.get(s.gpio);
      if (!g || g.mode !== "OUTPUT") return 0;
      return pwm ? (g.duty ?? g.level) : (g.duty ?? g.level) > 0.5 ? 1 : 0;
    };
    const a = read(inA), b = read(inB), d = read(en, true);
    const vm = Math.max(this.vbat - 2.0, 0); // the L298N drops about 2 V
    return { a: a * vm, b: b * vm, duty: d, brake: d > 0 && a === b };
  }

  motorVoltage(c, m) {
    const conn = c.motors[m];
    if (!conn?.plus || !conn?.minus) return { v: 0, brake: false };
    const side = (o) => (o === "OUT1" || o === "OUT2" ? "A" : "B");
    const outV = (o) => { const br = this.bridge(c, side(o)); return { v: o === "OUT1" || o === "OUT3" ? br.a : br.b, duty: br.duty, brake: br.brake }; };
    const p = outV(conn.plus), n = outV(conn.minus);
    if (side(conn.plus) === side(conn.minus)) return { v: (p.v - n.v) * p.duty, brake: p.brake };
    return { v: p.v * p.duty - n.v * n.duty, brake: false };
  }

  frame(dt) {
    if (!this.active) return;
    if (this.serialDirty && this.serialEl) {
      this.serialEl.textContent = this.serialLines.slice(-120).join("\n");
      this.serialEl.scrollTop = this.serialEl.scrollHeight;
      this.serialDirty = false;
    }
    if (this.mode !== "run") return;
    const c = this.circuit;
    this.vbat = 7.8;
    const running = this.powerOn && !c.fatal && c.driverPowered;
    // Wheel speeds from motor voltages: a TT motor turns about 200 RPM at 6 V
    // and stalls below about 1.5 V.
    const speed = (m) => {
      if (!running) return { target: 0, tau: 0.6 };
      const { v, brake } = this.motorVoltage(c, m);
      const mag = Math.abs(v) < 1.5 ? 0 : (v / 6) * 200; // RPM
      const sign = SLOTS[m].mirror ? -1 : 1;
      const cms = (mag / 60) * Math.PI * 2 * WHEEL_R * sign;
      return { target: cms, tau: brake ? 0.08 : mag ? 0.2 : 0.5 };
    };
    for (const [side, m] of [["L", "motorL"], ["R", "motorR"]]) {
      const s = speed(m);
      this.wheel[side] += (s.target - this.wheel[side]) * Math.min(dt / s.tau, 1);
    }
    // Differential drive.
    const v = (this.wheel.L + this.wheel.R) / 2;
    const w = (this.wheel.R - this.wheel.L) / TRACK;
    const heading = this.pose.heading + w * dt;
    const nx = this.pose.x + Math.sin(heading) * v * dt;
    const nz = this.pose.z + Math.cos(heading) * v * dt;
    if (!this.collides(nx, nz, heading)) Object.assign(this.pose, { x: nx, z: nz, heading });
    else { this.pose.heading = heading; this.bumped = 0.3; }
    this.robot.position.set(this.pose.x, 0, this.pose.z);
    this.robot.rotation.y = this.pose.heading;
    this.parts.wheelL.rotation.x += (this.wheel.L / WHEEL_R) * dt;
    this.parts.wheelR.rotation.x += (this.wheel.R / WHEEL_R) * dt;
    this.robot.updateMatrixWorld(true);
    this.distance = this.measure();
    if (this.follow) {
      const k = Math.min(dt * 3, 1);
      this.stage.pose.x += (this.pose.x - this.stage.pose.x) * k;
      this.stage.pose.z += (this.pose.z - this.stage.pose.z) * k;
    }
    this.liveT = (this.liveT ?? 0) + dt;
    if (this.liveT > 0.15) {
      this.liveT = 0;
      const live = this.ui.side.querySelector(".sim-live");
      if (live) {
        const rpm = (x) => Math.abs((x / (Math.PI * 2 * WHEEL_R)) * 60).toFixed(0);
        live.innerHTML = `<table class="ac-table">
          <tr><td>Power</td><td>${this.powerOn ? (running ? `<b class="ok">on</b>, battery ${this.vbat.toFixed(1)} V` : "<b class='warn'>on, but the driver has no power</b>") : "off"}</td></tr>
          <tr><td>ESP32</td><td>${this.powerOn && c.espPowered && !c.fatal ? (this.runner.stopped ? "stopped" : "<b class='ok'>running your sketch</b>") : "off"}</td></tr>
          <tr><td>Left wheel</td><td>${rpm(this.wheel.L)} RPM ${this.wheel.L < -1 ? "(reverse)" : ""}</td></tr>
          <tr><td>Right wheel</td><td>${rpm(this.wheel.R)} RPM ${this.wheel.R < -1 ? "(reverse)" : ""}</td></tr>
          <tr><td>Speed</td><td>${Math.abs(v).toFixed(0)} cm/s</td></tr>
          <tr><td>Sensor sees</td><td>${this.distance == null || this.distance > 400 ? "nothing within 4 m" : `${this.distance.toFixed(0)} cm`}</td></tr>
        </table>`;
      }
    }
  }

  collides(x, z, heading) {
    const R = 11.5; // the robot's footprint, roughly
    const p = V(x, 5, z);
    for (const o of this.arena.userData.obstacles) {
      const local = o.worldToLocal(p.clone());
      const g = o.geometry.parameters;
      if (g.radiusTop !== undefined) {
        if (Math.hypot(local.x, local.z) < g.radiusTop + R) return true;
      } else if (Math.abs(local.x) < g.width / 2 + R * 0.8 && Math.abs(local.z) < g.depth / 2 + R * 0.8) return true;
    }
    return false;
  }

  // What the ultrasonic sensor would measure: the nearest thing in its cone.
  measure() {
    const sonar = this.parts.sonar;
    if (!sonar) return null;
    const origin = sonar.localToWorld(sonar.userData.tx.clone()).lerp(sonar.localToWorld(sonar.userData.rx.clone()), 0.5);
    const ray = new THREE.Raycaster();
    let best = Infinity;
    for (const a of [-0.13, 0, 0.13]) {
      const h = this.pose.heading + a;
      ray.set(origin, V(Math.sin(h), 0, Math.cos(h)));
      ray.far = 450;
      const hit = ray.intersectObjects(this.arena.userData.obstacles, false)[0];
      if (hit) best = Math.min(best, hit.distance);
    }
    return Number.isFinite(best) ? best : null;
  }
}

const SLOT_NAMES = { battery: "Battery", driver: "L298N", esp32: "ESP32", sonar: "HC-SR04", motorL: "Left motor", motorR: "Right motor" };
function pinLabel(id) {
  const [part, pin] = id.split(".");
  const label = pin.replace(/^GND\d$/, "GND").replace(/^12V$/, "+12V").replace(/^5V$/, part === "driver" ? "+5V" : "5V");
  return `${SLOT_NAMES[part]} <b>${label}</b>`;
}
