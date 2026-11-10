// The project tutor's player: turns a project plan (from planner.js) into an
// Academy lesson. It lays the board and parts out on the bench, runs every
// jumper wire pin to pin, walks through the build one step at a time, explains
// the code line by line, and then runs the sketch against the circuit as
// wired: buttons can be pressed, the buzzer plays, LEDs light, servos turn.
import * as THREE from "three";
import { arduinoUno, esp32, pinWorld, jumperWire, WIRE_COLORS } from "./parts.js?v=19";
import { buildPart } from "./project-parts.js?v=19";
import { SketchRunner } from "./sketch.js?v=19";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// The AI's text: **bold** and `code`, paragraphs on blank lines.
const md = (s) => esc(s).split(/\n{2,}|\n(?=[-•] )/).map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>")}</p>`).join("");

const UNO_GND = ["GND_D", "GND", "GND_2"];
const ESP_GND = ["GND1", "GND2", "GND3"];
const SUPPLY_HIGH = new Set(["BOARD.5V", "BOARD.3V3", "BOARD.VIN"]);

// ---- The board's pin numbers --------------------------------------------------

function pinNumber(board, name) {
  if (board === "uno") {
    if (/^D\d+$/.test(name)) return Number(name.slice(1));
    if (/^A\d$/.test(name)) return 14 + Number(name.slice(1));
    return null;
  }
  return /^IO\d+$/.test(name) ? Number(name.slice(2)) : null;
}

function pinName(board, n) {
  if (board === "uno") return n >= 14 && n <= 19 ? `A${n - 14}` : `D${n}`;
  return `IO${n}`;
}

const CONSTANTS = {
  uno: { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, LED_BUILTIN: 13 },
  esp32: { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, LED_BUILTIN: 2 },
};

// ---- The circuit, as wired ------------------------------------------------------

// Works out what every pin sees from the wiring: wires and pressed buttons
// join pins solidly; resistors and light sensors join them weakly (a pull-up
// or a divider), so a solid connection always wins.
class Circuit {
  constructor(plan) {
    this.plan = plan;
    this.board = plan.board;
    this.mode = new Map();   // pin number → "INPUT" | "OUTPUT" | "INPUT_PULLUP" …
    this.out = new Map();    // pin number → 0..1 while it's an output
    this.tones = new Map();  // pin number → Hz
    this.servos = new Map(); // pin number → degrees
    this.pressed = new Set();
    this.knobs = new Map();  // part id → 0..1 (potentiometer, light, module)
    this.distance = 40;      // cm in front of an ultrasonic sensor
    this.serialLines = [];
    this.dirty = true;
  }

  reset() {
    this.mode.clear(); this.out.clear(); this.tones.clear(); this.servos.clear();
    this.dirty = true;
  }

  // Union-find over "PART.pin" nodes.
  solve() {
    if (!this.dirty) return this.nets;
    const parent = new Map();
    const find = (a) => { if (!parent.has(a)) parent.set(a, a); let r = a; while (parent.get(r) !== r) r = parent.get(r); parent.set(a, r); return r; };
    const join = (a, b) => parent.set(find(a), find(b));
    const node = (e) => `${e.part}.${e.pin}`;
    for (const w of this.plan.wires) join(node(w.from), node(w.to));
    const weak = [];
    for (const p of this.plan.parts) {
      if (p.type === "button" && this.pressed.has(p.id)) join(`${p.id}.1`, `${p.id}.2`);
      if (p.type === "resistor" || p.type === "ldr") weak.push([`${p.id}.1`, `${p.id}.2`]);
      if (p.type === "potentiometer") weak.push([`${p.id}.1`, `${p.id}.W`], [`${p.id}.W`, `${p.id}.2`]);
    }
    // Every node any wire or part mentions, grouped by net.
    for (const p of this.plan.parts) for (const pin of p.pins) find(`${p.id}.${pin}`);
    const members = new Map();
    for (const n of parent.keys()) {
      const r = find(n);
      if (!members.has(r)) members.set(r, []);
      members.get(r).push(n);
    }
    this.nets = { find, members, weak: weak.map(([a, b]) => [find(a), find(b)]) };
    this.dirty = false;
    return this.nets;
  }

  // A net's voltage as a fraction of the supply, or null if nothing drives it.
  level(net, except = null) {
    const { members } = this.solve();
    let high = false, drive = null;
    for (const n of members.get(net) ?? []) {
      if (n === "BOARD.GND" || /^\w+\.-$/.test(n) && this.isBattery(n)) return 0;
      if (SUPPLY_HIGH.has(n) || /^\w+\.\+$/.test(n) && this.isBattery(n)) high = true;
      if (n.startsWith("BOARD.")) {
        const num = pinNumber(this.board, n.slice(6));
        if (num !== null && num !== except && this.mode.get(num) === "OUTPUT") drive = Math.max(drive ?? 0, this.out.get(num) ?? 0);
      }
    }
    return high ? 1 : drive;
  }

  isBattery(node) { return this.plan.parts.some((p) => p.type === "battery_9v" && node.startsWith(`${p.id}.`)); }

  // The level, or else what a resistor pulls it to.
  softLevel(net, except = null) {
    const l = this.level(net, except);
    if (l !== null) return l;
    for (const [a, b] of this.solve().weak) {
      if (a === net && b !== net) { const v = this.level(b, except); if (v !== null) return v; }
      if (b === net && a !== net) { const v = this.level(a, except); if (v !== null) return v; }
    }
    return null;
  }

  netOf(node) { return this.solve().find(node); }
  boardNet(num) { return this.netOf(`BOARD.${pinName(this.board, num)}`); }
  nodesOf(net) { return this.solve().members.get(net) ?? []; }

  // Board pins on this net or one resistor away.
  pinsNear(net) {
    const nets = [net, ...this.solve().weak.flatMap(([a, b]) => (a === net ? [b] : b === net ? [a] : []))];
    const pins = [];
    for (const n of nets) for (const node of this.nodesOf(n)) if (node.startsWith("BOARD.")) { const num = pinNumber(this.board, node.slice(6)); if (num !== null) pins.push(num); }
    return pins;
  }

  // ---- What the sketch sees ----------------------------------------------------

  hardware(onSerial) {
    const c = this;
    return {
      pinMode(pin, mode) { c.mode.set(pin, mode); if (mode !== "OUTPUT") c.out.delete(pin); c.dirty = true; },
      digitalWrite(pin, v) {
        if (c.mode.get(pin) !== "OUTPUT") { if (v) c.mode.set(pin, "INPUT_PULLUP"); return; }
        c.out.set(pin, v); c.dirty = true;
      },
      pwm(pin, duty) { c.mode.set(pin, "OUTPUT"); c.out.set(pin, duty); c.dirty = true; },
      digitalRead(pin) {
        const net = c.boardNet(pin);
        const sensor = c.sensorOn(net);
        if (sensor !== null) return sensor > 0.5 ? 1 : 0;
        const l = c.softLevel(net, pin);
        if (l !== null) return l > 0.5 ? 1 : 0;
        if (c.mode.get(pin) === "OUTPUT") return c.out.get(pin) > 0.5 ? 1 : 0;
        return c.mode.get(pin) === "INPUT_PULLUP" ? 1 : 0;
      },
      analogRead(pin) {
        const net = c.boardNet(pin);
        const full = c.board === "uno" ? 1023 : 4095;
        const sensor = c.sensorOn(net);
        if (sensor !== null) return Math.round(sensor * full);
        const l = c.softLevel(net, pin);
        return Math.round((l ?? (c.mode.get(pin) === "INPUT_PULLUP" ? 1 : 0.3 + Math.random() * 0.05)) * full);
      },
      pulseIn(pin) {
        const net = c.boardNet(pin);
        const sonar = c.plan.parts.find((p) => p.type === "ultrasonic" && c.netOf(`${p.id}.Echo`) === net);
        return sonar ? Math.round(c.distance * 58.2) : 0;
      },
      tone(pin, hz) { c.tones.set(pin, hz); },
      servo(pin, deg) { c.servos.set(pin, deg); },
      serial(text) { onSerial(text); },
      constants: () => CONSTANTS[c.board],
    };
  }

  // A sensor's reading if one drives this net: a potentiometer's wiper, a
  // light sensor's divider, a module's output. 0..1, or null.
  sensorOn(net) {
    for (const p of this.plan.parts) {
      if (p.type === "potentiometer" && this.netOf(`${p.id}.W`) === net) {
        const a = this.softLevel(this.netOf(`${p.id}.1`)) ?? 0, b = this.softLevel(this.netOf(`${p.id}.2`)) ?? 0;
        const k = this.knobs.get(p.id) ?? 0.5;
        return a + (b - a) * k;
      }
      if (p.type === "ldr" && (this.netOf(`${p.id}.1`) === net || this.netOf(`${p.id}.2`) === net) && this.level(net) === null) return this.knobs.get(p.id) ?? 0.5;
      if (p.type === "module") {
        for (const pin of p.pins) {
          if (/^(VCC|VIN|V\+|5V|3V3|3\.3V|GND|G)$/i.test(pin)) continue;
          if (this.netOf(`${p.id}.${pin}`) === net && this.level(net) === null) return this.knobs.get(p.id) ?? 0.5;
        }
      }
    }
    return null;
  }

  // Voltage across a two-pin part (a − b), or 0 if either end is floating.
  across(part, a, b) {
    const va = this.softLevel(this.netOf(`${part.id}.${a}`)), vb = this.softLevel(this.netOf(`${part.id}.${b}`));
    return va === null || vb === null ? 0 : va - vb;
  }

  // The pitch a buzzer plays now (0 = silent).
  buzzerHz(part) {
    if (this.softLevel(this.netOf(`${part.id}.-`)) !== 0) return 0;
    for (const pin of this.pinsNear(this.netOf(`${part.id}.+`))) {
      const hz = this.tones.get(pin);
      if (hz) return hz;
    }
    const active = /active/i.test(`${part.label} ${part.value}`);
    return active && this.across(part, "+", "-") > 0.5 ? 2300 : 0;
  }

  servoAngle(part) {
    if (this.across(part, "V+", "GND") < 0.5) return null;
    for (const pin of this.pinsNear(this.netOf(`${part.id}.SIG`))) if (this.servos.has(pin)) return this.servos.get(pin);
    return null;
  }
}

// ---- Sound -----------------------------------------------------------------------

class Sounds {
  constructor() { this.voices = new Map(); }
  set(id, hz) {
    if (!hz) { this.voices.get(id)?.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01); return; }
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
    let v = this.voices.get(id);
    if (!v) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const tone = this.ctx.createBiquadFilter();
      osc.type = "square";
      tone.type = "lowpass";
      tone.frequency.value = 3500;
      gain.gain.value = 0;
      osc.connect(tone).connect(gain).connect(this.ctx.destination);
      osc.start();
      v = { osc, gain, hz: 0 };
      this.voices.set(id, v);
    }
    if (v.hz !== hz) { v.osc.frequency.setValueAtTime(hz, this.ctx.currentTime); v.hz = hz; }
    v.gain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.005);
  }
  stopAll() { for (const id of this.voices.keys()) this.set(id, 0); }
  close() { this.ctx?.close(); this.voices.clear(); this.ctx = null; }
}

// ---- Laying the bench out ----------------------------------------------------------

function layout(ctx, plan) {
  const board = plan.board === "uno" ? arduinoUno() : esp32();
  // The Uno is turned round so its digital pins face the parts.
  if (plan.board === "uno") ctx.place(board, [0, 0, 0], [0, Math.PI, 0]);
  else ctx.place(board, [0, board.userData.size?.base ?? 0.51, 0]);
  const boardBox = new THREE.Box3().setFromObject(board);

  const objects = new Map([["BOARD", board]]);
  const sizes = new Map();
  for (const p of plan.parts) {
    const obj = buildPart(p);
    obj.userData.projectPart = p;
    const info = obj.userData.info;
    if (info) Object.assign(info, { title: `${p.id} · ${p.label}`, text: [p.why, info.text].filter(Boolean).join(" ") });
    obj.updateMatrixWorld(true);
    sizes.set(p.id, new THREE.Box3().setFromObject(obj));
    objects.set(p.id, obj);
  }

  // A breadboard sits beside the board; everything else in rows in front.
  let x0 = boardBox.max.x + 2.5;
  const rows = [];
  let row = [], width = 0;
  const MAX = 34, GAP = 2.4;
  for (const p of plan.parts) {
    const box = sizes.get(p.id);
    const w = box.max.x - box.min.x;
    if (p.type === "breadboard") {
      const obj = objects.get(p.id);
      ctx.place(obj, [x0 - box.min.x, -box.min.y, -(box.min.z + box.max.z) / 2]);
      x0 += w + 2;
      continue;
    }
    if (row.length && width + w > MAX) { rows.push(row); row = []; width = 0; }
    row.push(p);
    width += w + GAP;
  }
  if (row.length) rows.push(row);
  let z = boardBox.max.z + 5;
  for (const r of rows) {
    const total = r.reduce((s, p) => s + (sizes.get(p.id).max.x - sizes.get(p.id).min.x) + GAP, -GAP);
    let x = -total / 2;
    let depth = 0;
    for (const p of r) {
      const box = sizes.get(p.id);
      const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
      ctx.place(objects.get(p.id), [x - box.min.x, -box.min.y, z - box.min.z]);
      x += w + GAP;
      depth = Math.max(depth, d);
    }
    z += depth + 4;
  }

  // Wires, pin to pin. Pins several wires share (GND, the rails) hand each
  // wire its own hole or header pin.
  let gnd = 0;
  const end = (e) => {
    const obj = objects.get(e.part);
    if (e.part === "BOARD") {
      let name = e.pin;
      if (name === "GND") { const list = plan.board === "uno" ? UNO_GND : ESP_GND; name = list[gnd++ % list.length]; }
      return pinWorld(obj, name);
    }
    if (obj.userData.railHole && (e.pin === "+" || e.pin === "-")) return obj.localToWorld(obj.userData.railHole(e.pin));
    return pinWorld(obj, e.pin);
  };
  const wires = plan.wires.map((w) => {
    const a = end(w.from), b = end(w.to);
    const wire = jumperWire(a, b, WIRE_COLORS[w.color] ?? WIRE_COLORS.blue, { lift: Math.min(1.5 + a.distanceTo(b) * 0.18, 6) });
    wire.userData.ends = [a, b];
    wire.userData.noPick = true;
    wire.traverse((m) => { m.userData.noPick = true; });
    return wire;
  });
  return { board, objects, wires };
}

const SHOP = {
  led: (p) => `${(p.value || "").toLowerCase().match(/red|yellow|green|blue|white/)?.[0] ?? "red"} LED (5 mm)`,
  resistor: (p) => `${p.value || "220"} Ω resistor`.replace(/\s*(ohms?|Ω)\s*Ω/i, " Ω"),
  button: () => "push button (6 mm)",
  buzzer: (p) => (/active/i.test(`${p.label} ${p.value}`) ? "active buzzer" : "passive piezo buzzer"),
  potentiometer: () => "10 kΩ potentiometer",
  servo: () => "SG90 micro servo",
  ultrasonic: () => "HC-SR04 ultrasonic sensor",
  motor_driver: () => "L298N motor driver",
  dc_motor: () => "TT gear motor",
  battery_9v: () => "9 V battery and clip",
  ldr: () => "light sensor (LDR)",
  breadboard: () => "half-size breadboard",
};

// ---- The lesson ------------------------------------------------------------------------

const pinLabel = (plan, e) => {
  if (e.part === "BOARD") return e.pin === "GND" ? "GND" : plan.board === "uno" ? e.pin.replace(/^D/, "pin ") : e.pin.replace(/^IO/, "GPIO ");
  const p = plan.parts.find((q) => q.id === e.part);
  return `${p?.label ?? e.part} ${e.pin === "-" ? "−" : e.pin}`;
};

export function wireText(plan, w) {
  return `${pinLabel(plan, w.from)} → ${pinLabel(plan, w.to)}`;
}

// The lesson for a plan. `hooks.change(text)` asks for a change to the plan.
export function projectLesson(plan, hooks = {}) {
  const build = plan.steps.filter((s) => !s.code_lines.length);
  const codeSteps = plan.steps.filter((s) => s.code_lines.length);
  // When each part and wire appears: its build step's index in the lesson (0 is the overview).
  const partAt = new Map(), wireAt = new Map();
  build.forEach((s, i) => { s.parts.forEach((id) => partAt.set(id, i + 1)); s.wires.forEach((w) => wireAt.set(w, i + 1)); });

  // The shopping list: like parts together ("7 × push button").
  const counts = new Map();
  for (const p of plan.parts) {
    const name = SHOP[p.type]?.(p) ?? p.label;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const boardName = plan.board === "uno" ? "Arduino Uno" : "ESP32 DevKit";
  const shopping = `<ul class="pj-list"><li>1 × ${boardName} and its USB cable</li>${[...counts].map(([label, n]) => `<li>${n} × ${esc(label)}</li>`).join("")}<li>${plan.wires.length} jumper wires</li></ul>`;

  const steps = [];
  steps.push({
    title: "What you'll build",
    text: `${md(plan.summary)}<h4>You'll need</h4>${shopping}${plan.warnings?.length ? `<p class="tip">${plan.warnings.map(esc).join("<br>")}</p>` : ""}<p class="tip">Click or pinch any part to see what it's for. Next walks you through the build.</p>`,
    show: Infinity,
  });
  build.forEach((s, i) => {
    const list = s.wires.map((w) => plan.wires[w]).map((w) => `<li><i class="pj-swatch" style="background:${WIRE_COLORS[w.color] ?? "#888"}"></i><b>${esc(wireText(plan, w))}</b>${w.why ? `<br><small>${esc(w.why)}</small>` : ""}</li>`).join("");
    steps.push({ title: s.title, text: md(s.text) + (list ? `<h4>Connect</h4><ul class="pj-wires">${list}</ul>` : ""), show: i + 1, plan: s });
  });
  codeSteps.forEach((s) => steps.push({ title: s.title, text: md(s.text), show: Infinity, plan: s, lines: s.code_lines }));
  const realBoard = plan.board === "uno"
    ? "<li>Install the <b>Arduino IDE</b> from arduino.cc.</li><li>Plug the Uno in, pick <b>Tools → Board → Arduino Uno</b> and its <b>Port</b>.</li>"
    : "<li>Install the <b>Arduino IDE</b>, then add <b>esp32 by Espressif</b> in <b>Boards Manager</b>.</li><li>Plug the ESP32 in, pick <b>ESP32 Dev Module</b> and its <b>Port</b>.</li>";
  steps.push({
    title: "Try it, then build it for real",
    text: `<p>Press <b>▶ Run the code</b>: the sketch runs against the circuit exactly as it's wired. ${plan.parts.some((p) => p.type === "button") ? "Click or pinch the buttons, or press <b>1</b> to <b>9</b> on the keyboard." : ""}</p>
      ${plan.tips.length ? `<h4>Tips</h4><ul>${plan.tips.map((t) => `<li>${md(t).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul>` : ""}
      <h4>On the real board</h4><ol>${realBoard}<li>Copy the code (the ⧉ button above it), paste it in, and press <b>Upload</b>.</li></ol>
      <p class="tip">Want it different? Type a change below, like "add a volume knob" or "use an ESP32".</p>`,
    show: Infinity,
    last: true,
  });

  return {
    id: "project",
    title: plan.title,
    summary: plan.summary,
    custom: true,
    module: { title: "Your project" },
    moduleIndex: -1,
    setup(ctx) { return setup(ctx, plan, hooks); },
    steps: steps.map((st) => ({
      title: st.title,
      text: st.text,
      enter(ctx, s) { enterStep(ctx, s, st); },
    })),
    describe(stepIndex) { return describePlan(plan, steps[stepIndex]); },
    partAt, wireAt,
  };
}

function setup(ctx, plan, hooks) {
  const { board, objects, wires } = layout(ctx, plan);
  const s = { plan, board, objects, wires, hooks, circuit: new Circuit(plan), sounds: new Sounds(), running: false, error: null };
  const build = plan.steps.filter((st) => !st.code_lines.length);
  s.partAt = new Map([["BOARD", 0]]);
  s.wireAt = new Map();
  build.forEach((st, i) => { st.parts.forEach((id) => s.partAt.set(id, i + 1)); st.wires.forEach((w) => s.wireAt.set(w, i + 1)); });
  let k = 0;
  for (const [id, obj] of objects) ctx.add(obj, { delay: id === "BOARD" ? 0 : 80 + 40 * k++ });
  for (const w of wires) ctx.add(w, { drop: false });

  s.code = ctx.code(plan.code, { title: `${plan.title.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "project"}.ino` });
  addCopyButton(ctx);
  s.runner = new SketchRunner(s.circuit.hardware((line) => serial(ctx, s, line)));

  // Buttons: number keys press them while held.
  const buttons = plan.parts.filter((p) => p.type === "button");
  const keyDown = (e) => {
    if (e.target.closest?.("input, textarea") || e.repeat) return;
    const b = buttons[Number(e.key) - 1];
    if (b) press(s, b.id, true);
  };
  const keyUp = (e) => { const b = buttons[Number(e.key) - 1]; if (b) press(s, b.id, false); };
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  ctx.onDispose(() => {
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp);
    s.runner.stop();
    s.sounds.close();
  });

  ctx.frame(() => updateCircuit(s));
  return s;
}

function press(s, id, down) {
  if (down) s.circuit.pressed.add(id); else s.circuit.pressed.delete(id);
  s.circuit.dirty = true;
  s.objects.get(id)?.userData.press?.(down);
}

// Lights, sounds and moves the parts to match the circuit, every frame.
function updateCircuit(s) {
  const c = s.circuit;
  c.dirty = true;
  for (const p of s.plan.parts) {
    const obj = s.objects.get(p.id);
    if (p.type === "led") obj.userData.setBrightness?.(s.running ? Math.max(0, Math.min(1, c.across(p, "A", "K"))) * 0.7 : 0);
    else if (p.type === "buzzer") { const hz = s.running ? c.buzzerHz(p) : 0; s.sounds.set(p.id, hz); obj.userData.setSound?.(hz > 0); }
    else if (p.type === "servo" && s.running) { const a = c.servoAngle(p); if (a !== null) obj.userData.setAngle(a); }
    else if (p.type === "potentiometer") obj.userData.setValue(c.knobs.get(p.id) ?? 0.5);
  }
  if (s.plan.board === "uno") {
    const led = s.board.userData.leds?.L;
    if (led) led.material.emissiveIntensity = s.running && c.mode.get(13) === "OUTPUT" && c.out.get(13) > 0.5 ? 2.5 : 0.1;
  }
}

// ---- Steps -------------------------------------------------------------------------------

function enterStep(ctx, s, st) {
  // What's on the bench by this step; the new pieces glow and get labels.
  const fresh = [];
  for (const [id, obj] of s.objects) {
    const at = s.partAt.get(id) ?? 0;
    obj.visible = at <= st.show;
    if (at === st.show && st.show !== Infinity && id !== "BOARD") fresh.push(obj);
  }
  const freshWires = [];
  s.wires.forEach((w, i) => {
    const at = s.wireAt.get(i) ?? 0;
    w.visible = at <= st.show;
    if (at === st.show) freshWires.push(i);
  });
  for (const obj of fresh) {
    const k = obj.scale.x;
    obj.scale.setScalar(k * 0.001);
    ctx.tween(obj.scale, { x: k, y: k, z: k }, { ms: 500, curve: ctx.ease.back });
  }
  ctx.focus(...fresh, ...freshWires.map((i) => s.wires[i]));
  let labels = 0;
  for (const obj of fresh) {
    if (labels++ >= 6) break;
    const box = new THREE.Box3().setFromObject(obj);
    ctx.label(obj, esc(obj.userData.projectPart.label), { offset: V(0, box.max.y - obj.position.y + 0.3, 0), dx: 30, dy: -40 });
  }
  for (const i of freshWires) {
    const w = s.plan.wires[i];
    const boardEnd = w.from.part === "BOARD" ? 0 : w.to.part === "BOARD" ? 1 : -1;
    if (boardEnd < 0 || labels++ >= 10) continue;
    const pin = boardEnd === 0 ? w.from : w.to;
    const p = s.wires[i].userData.ends[boardEnd];
    ctx.label(s.board, esc(pinLabel(s.plan, pin)), { offset: s.board.worldToLocal(p.clone()), dx: -20 - 14 * (labels % 3), dy: -50 - 16 * (labels % 2) });
  }

  // Camera: the new pieces, or the whole bench.
  const box = new THREE.Box3();
  if (fresh.length || freshWires.length) {
    for (const obj of fresh) box.expandByObject(obj);
    for (const i of freshWires) for (const p of s.wires[i].userData.ends) box.expandByPoint(p);
  } else {
    for (const [, obj] of s.objects) if (obj.visible) box.expandByObject(obj);
  }
  if (!box.isEmpty()) {
    const c = box.getCenter(V(0, 0, 0)), size = box.getSize(V(0, 0, 0));
    const radius = Math.min(Math.max(Math.max(size.x, size.z) * 1.25 + 12, 16), 80);
    ctx.camera({ target: [c.x, 0, c.z], theta: 0.12, phi: st.lines ? 0.75 : 0.88, radius });
  }

  s.code.highlight(st.lines ?? []);
  runControls(ctx, s);
  if (st.last) changeBox(ctx, s);

  // Pinch or click: press a button, or turn a knob up a notch.
  ctx.onGrab((hit) => {
    let o = hit.object;
    while (o && !o.userData.projectPart) o = o.parent;
    const p = o?.userData.projectPart;
    if (p?.type !== "button") return null;
    press(s, p.id, true);
    return { move() {}, end() { press(s, p.id, false); } };
  });
}

function runControls(ctx, s) {
  ctx.buttons([
    { label: s.running ? "■ Stop" : "▶ Run the code", cls: s.running ? "" : "primary", onClick: (el) => toggleRun(ctx, s, el) },
  ]);
  s.status = ctx.readout(s.error ? `<span class="pj-err">${esc(s.error)}</span>` : s.running ? "Running…" : "");
  const c = s.circuit;
  for (const p of s.plan.parts) {
    if (p.type === "potentiometer" || p.type === "ldr" || (p.type === "module" && p.pins.some((n) => !/^(VCC|VIN|V\+|5V|3V3|3\.3V|GND|G)$/i.test(n)))) {
      ctx.slider({
        label: p.type === "ldr" ? `${p.label}: light` : p.type === "potentiometer" ? `${p.label}: turn` : `${p.label}: reading`,
        min: 0, max: 100, value: Math.round((c.knobs.get(p.id) ?? 0.5) * 100), format: (v) => `${v}%`,
        onInput: (v) => { c.knobs.set(p.id, v / 100); c.dirty = true; },
      });
    }
  }
  if (s.plan.parts.some((p) => p.type === "ultrasonic")) {
    ctx.slider({ label: "Object in front", min: 2, max: 300, value: c.distance, format: (v) => `${v} cm`, onInput: (v) => { c.distance = v; } });
  }
}

function toggleRun(ctx, s, el) {
  if (s.running) {
    s.runner.stop();
    s.running = false;
    s.sounds.stopAll();
    el.innerHTML = "▶ Run the code";
    el.classList.add("primary");
    s.status?.set("");
    return;
  }
  s.sounds.ctx ??= new AudioContext(); // unlocked by this click
  s.error = null;
  s.circuit.reset();
  s.circuit.serialLines = [];
  serial(ctx, s, null);
  s.running = true;
  el.innerHTML = "■ Stop";
  el.classList.remove("primary");
  s.status?.set("Running…");
  s.code.highlight([]);
  s.runner.run(s.plan.code, (msg, line) => {
    s.running = false;
    s.error = line ? `Line ${line}: ${msg}` : msg;
    s.status?.set(`<span class="pj-err">${esc(s.error)}</span>`);
    if (line) s.code.highlight(line);
    el.innerHTML = "▶ Run the code";
    el.classList.add("primary");
  });
}

// The serial monitor, in the panel under the code. `line` null clears it.
function serial(ctx, s, line) {
  const panel = ctx.ui.scope;
  if (line !== null) s.circuit.serialLines.push(line);
  if (s.circuit.serialLines.length > 60) s.circuit.serialLines.splice(0, s.circuit.serialLines.length - 60);
  if (!s.circuit.serialLines.length && line === null) { panel.hidden = true; return; }
  panel.hidden = false;
  if (!panel.querySelector(".pj-serial")) panel.innerHTML = `<div class="ac-code-title">Serial monitor</div><pre class="pj-serial"></pre>`;
  const pre = panel.querySelector(".pj-serial");
  pre.textContent = s.circuit.serialLines.join("\n");
  pre.scrollTop = pre.scrollHeight;
}

function addCopyButton(ctx) {
  const title = ctx.ui.code.querySelector(".ac-code-title");
  if (!title || title.querySelector(".pj-copy")) return;
  const b = document.createElement("button");
  b.className = "pj-copy";
  b.type = "button";
  b.title = "Copy the code";
  b.textContent = "⧉ Copy";
  b.addEventListener("click", async () => {
    const text = [...ctx.ui.code.querySelectorAll(".ln")].map((l) => l.textContent.replace(/^\d+/, "")).join("\n");
    try { await navigator.clipboard.writeText(text); b.textContent = "✓ Copied"; } catch { b.textContent = "Select and copy"; }
    setTimeout(() => { b.textContent = "⧉ Copy"; }, 1600);
  });
  title.appendChild(b);
}

function changeBox(ctx, s) {
  if (!s.hooks.change) return;
  const form = document.createElement("form");
  form.className = "pj-change";
  form.innerHTML = `<input type="text" placeholder="Change it: add a volume knob, use an ESP32…" aria-label="Change the project"><button class="ac-btn primary" type="submit">Update</button>`;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = form.querySelector("input").value.trim();
    if (text) s.hooks.change(text);
  });
  ctx.ui.controls.appendChild(form);
}

// For Yaver's voice: what's on screen, so it can answer questions about it.
function describePlan(plan, step) {
  const parts = plan.parts.map((p) => `${p.id} (${p.label})`).join(", ");
  const wires = plan.wires.map((w) => wireText(plan, w)).join("; ");
  const code = plan.code.length > 2500 ? `${plan.code.slice(0, 2500)}…` : plan.code;
  return `He is in the Robotics Academy's project tutor, building "${plan.title}" on an ${plan.board === "uno" ? "Arduino Uno" : "ESP32"}, at the step "${step?.title}". ${plan.summary}\nParts: ${parts}.\nWiring: ${wires}.\nCode:\n${code}`;
}
