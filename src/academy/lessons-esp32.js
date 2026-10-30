// Module 3: ESP32 and robotics. The ESP32 board, driving motors with an
// H-bridge, and measuring distance with ultrasound.
import * as THREE from "three";
import { tween, ease } from "./anim.js?v=18";
import { esp32, l298n, ttMotor, wheel, battery2x18650, hcsr04, jumperWire, wirePath, roundedPath, pinWorld, WIRE_COLORS, ESP32_NOTES, L298N_NOTES } from "./parts.js?v=18";
import { byInfo } from "./lessons-arduino.js?v=18";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- Lesson 8: Meet the ESP32 ------------------------------------------------------

const PIN_GROUPS = {
  good: { color: "#06d6a0", label: "Safe for anything", pins: ["IO4", "IO13", "IO14", "IO16", "IO17", "IO18", "IO19", "IO21", "IO22", "IO23", "IO25", "IO26", "IO27", "IO32", "IO33"] },
  input: { color: "#ff9f43", label: "Input only (34–39)", pins: ["IO34", "IO35", "IO36", "IO39"] },
  strap: { color: "#ffd166", label: "Boot pins: careful", pins: ["IO0", "IO2", "IO5", "IO12", "IO15"] },
  flash: { color: "#ff4d6d", label: "Flash: never use", pins: ["SD0", "SD1", "SD2", "SD3", "CMD", "CLK"] },
  power: { color: "#e8f4ff", label: "Power and ground", pins: ["3V3", "5V", "GND1", "GND2", "GND3", "EN"] },
};

function colorPins(board, groups) {
  for (const pin of board.userData.part.pins.values()) pin.marker.visible = false;
  for (const key of groups) {
    const g = PIN_GROUPS[key];
    const mat = new THREE.MeshBasicMaterial({ color: g.color, depthTest: false, transparent: true, opacity: 0.95 });
    for (const name of g.pins) {
      const pin = board.userData.part.pins.get(name);
      if (!pin) continue;
      pin.marker.material = mat;
      pin.marker.visible = true;
      pin.marker.scale.setScalar(1.2);
    }
  }
}

const ESP32_CODE = `#include <WiFi.h>

const int LED_PIN = 2;   // the blue LED on many boards

void setup() {
  Serial.begin(115200);
  ledcAttach(LED_PIN, 5000, 8);  // PWM: 5 kHz, 8 bits (0-255)
  WiFi.begin("my-network", "password");
  while (WiFi.status() != WL_CONNECTED) delay(200);
  Serial.println(WiFi.localIP());
}

void loop() {
  int raw = analogRead(34);       // 12 bits: 0-4095 for 0-3.3 V
  ledcWrite(LED_PIN, raw / 16);   // brightness follows the knob
  delay(20);
}`;

const esp = {
  id: "esp32",
  title: "Meet the ESP32",
  summary: "Two cores, Wi-Fi and Bluetooth, and the 3.3 V rules for its pins.",
  minutes: 6,
  setup(ctx) {
    const board = esp32();
    board.scale.setScalar(2.4);
    ctx.add(board, { at: [0, 1.25, 0] });
    return { board };
  },
  steps: [
    {
      title: "A computer with a radio",
      text: `<p>The <b>ESP32</b> is the board at the heart of Yaver's hardware. Compared with the Uno it's a leap:</p>
        <table class="ac-table"><tr><td></td><td>Uno</td><td>ESP32</td></tr>
        <tr><td>Cores × speed</td><td>1 × 16 MHz</td><td><b>2 × 240 MHz</b></td></tr>
        <tr><td>RAM</td><td>2 KB</td><td><b>520 KB</b></td></tr>
        <tr><td>Flash</td><td>32 KB</td><td><b>4 MB</b></td></tr>
        <tr><td>Wireless</td><td>none</td><td><b>Wi-Fi + Bluetooth</b></td></tr>
        <tr><td>Logic level</td><td>5 V</td><td><b>3.3 V</b></td></tr></table>
        <p>And it costs about the same. You program it in the same Arduino language.</p>`,
      camera: { target: [0, 1, 0], theta: 0.3, phi: 0.8, radius: 22 },
      enter(ctx, s) {
        colorPins(s.board, []);
        ctx.label(s.board, "ESP32-WROOM-32 module", { offset: V(1.0, 0.45, 0), dx: 60, dy: -50 });
        ctx.label(s.board, "Micro-USB", { offset: V(-2.5, 0.3, 0), dx: -50, dy: -40 });
        ctx.label(s.board, "38 pins", { offset: V(0, 0.2, 1.27), dx: 40, dy: 60 });
      },
    },
    {
      title: "The module and its antenna",
      text: `<p>The metal can is the <b>ESP32-WROOM-32</b> module: the ESP32 chip, its 4 MB flash memory and a 40 MHz crystal, sealed under a shield that keeps radio noise in and out.</p>
        <p>The zig-zag copper beyond it is the <b>antenna</b> for Wi-Fi and Bluetooth (2.4 GHz). Keep metal, batteries and motors away from it, or the signal suffers.</p>`,
      camera: { target: [3.5, 1.5, 0], theta: 0.9, phi: 0.7, radius: 14 },
      enter(ctx, s) {
        colorPins(s.board, []);
        ctx.focus(byInfo(s.board, ESP32_NOTES.module.title, ESP32_NOTES.antenna.title));
        ctx.label(s.board, "Shielded module", { offset: V(1.0, 0.45, 0), dx: -50, dy: -60 });
        ctx.label(s.board, "PCB antenna", { offset: V(2.35, 0.25, 0), dx: 50, dy: -50 });
      },
    },
    {
      title: "USB, power and buttons",
      text: `<p>At the other end:</p>
        <ul><li><b>Micro-USB</b> for power and uploads, through the <b>CP2102</b> USB-to-serial chip.</li>
        <li>The <b>AMS1117</b> regulator, which makes 3.3 V from 5 V. On a robot you feed 5 V into the <b>5V</b> pin instead.</li>
        <li><b>EN</b> restarts the program. <b>BOOT</b> forces upload mode, if an upload ever hangs on "Connecting…".</li></ul>`,
      camera: { target: [-3.5, 1.5, 0], theta: -0.8, phi: 0.75, radius: 14 },
      enter(ctx, s) {
        colorPins(s.board, []);
        ctx.focus(byInfo(s.board, ESP32_NOTES.usb.title, ESP32_NOTES.uart.title, ESP32_NOTES.reg.title, ESP32_NOTES.en.title, ESP32_NOTES.boot.title));
        ctx.label(s.board, "USB-to-serial", { offset: V(-1.25, 0.25, 0), dx: 40, dy: -60 });
        ctx.label(s.board, "3.3 V regulator", { offset: V(-0.4, 0.3, -0.5), dx: 40, dy: -40 });
        ctx.label(s.board, "EN (reset)", { offset: V(-2.2, 0.35, -0.72), dx: -60, dy: -40 });
        ctx.label(s.board, "BOOT", { offset: V(-2.2, 0.35, 0.72), dx: -50, dy: 40 });
      },
    },
    {
      title: "The 3.3 V rule",
      text: `<p>This is the most important difference from the Uno: <b>the ESP32's pins work at 3.3 V and are not 5 V tolerant</b>.</p>
        <ul><li>An output HIGH is 3.3 V, not 5 V.</li>
        <li>Never connect a 5 V signal straight to an input. Many 5 V sensors (like the HC-SR04's echo) need a <b>voltage divider</b> first.</li>
        <li>Each pin can give about <b>20 mA</b> (40 mA absolute maximum).</li></ul>`,
      camera: { target: [0, 1, 0], theta: 0.1, phi: 0.6, radius: 18 },
      enter(ctx, s) {
        colorPins(s.board, ["power"]);
        ctx.label(s.board, "3V3: 3.3 V out", { offset: V(2.286, 0.2, -1.27), dx: 50, dy: -50 });
        ctx.label(s.board, "5V: power in", { offset: V(-2.286, 0.2, -1.27), dx: -50, dy: -50 });
      },
    },
    {
      title: "Which pins to use",
      text: `<p>Not all 38 pins are equal. Tap a group to light it up on the board:</p>
        <ul><li><b class="g-good">Green</b>: safe for anything. Use these first.</li>
        <li><b class="g-input">Orange</b>: GPIO 34 to 39 are <b>input only</b>, with no pull-ups.</li>
        <li><b class="g-strap">Yellow</b>: <b>boot pins</b>. Their level at power-up decides how it boots; fine for outputs once running, but don't hold them with a button.</li>
        <li><b class="g-flash">Red</b>: wired to the flash memory. Using them crashes the board.</li></ul>
        <p class="tip">Wi-Fi also borrows the second ADC, so with Wi-Fi on, only pins 32 to 39 can do analogRead.</p>`,
      camera: { target: [0, 1, 0], theta: 0.0, phi: 0.45, radius: 17 },
      enter(ctx, s) {
        const shown = new Set(["good", "input", "strap", "flash"]);
        colorPins(s.board, [...shown]);
        ctx.buttons(Object.entries(PIN_GROUPS).map(([k, g]) => ({
          label: `<i class="dot" style="background:${g.color}"></i>${g.label}`,
          active: shown.has(k),
          onClick: (el) => {
            if (shown.has(k)) shown.delete(k); else shown.add(k);
            el.classList.toggle("active", shown.has(k));
            colorPins(s.board, [...shown]);
          },
        })));
      },
    },
    {
      title: "Programming it",
      text: `<p>In the Arduino IDE, add the ESP32 boards (<b>Boards Manager → "esp32" by Espressif</b>), then pick <b>ESP32 Dev Module</b>. Then it's the same language, with a few extras:</p>
        <ul><li><b>Wi-Fi</b> in a few lines with <code>WiFi.begin()</code>.</li>
        <li><b>PWM</b> on any output pin with <code>ledcAttach()</code> and <code>ledcWrite()</code>.</li>
        <li><code>analogRead()</code> is 12-bit: <b>0 to 4095</b>.</li>
        <li><code>Serial.begin(115200)</code>: it talks faster than the Uno.</li></ul>`,
      camera: { target: [0, 1, 0], theta: 0.6, phi: 0.75, radius: 20 },
      enter(ctx, s) {
        colorPins(s.board, []);
        s.code ??= ctx.code(ESP32_CODE, { title: "ESP32 example" });
      },
    },
  ],
};

// ---- Lesson 9: Motors and the H-bridge -------------------------------------------------

const hbridge = {
  id: "hbridge",
  title: "Motors and the H-bridge",
  summary: "Why a motor needs a driver, and how four switches reverse it.",
  minutes: 7,
  setup(ctx) {
    const drv = ctx.add(ctx.place(l298n(), [0, 0, 0]));
    const stand = ctx.add(ctx.place(new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.1, 4), new THREE.MeshStandardMaterial({ color: "#2b313c", roughness: 0.6 })), [7.4, 1.05, -0.6]), { delay: 100 });
    stand.castShadow = stand.receiveShadow = true;
    const motor = ctx.add(ctx.place(ttMotor(1), [6.5, 3.3, 0.6]), { delay: 200 });
    motor.updateMatrixWorld(true);
    const whl = ctx.add(ctx.place(wheel(), [8.0, 3.3, 0.6]), { delay: 300 });
    const bat = ctx.add(ctx.place(battery2x18650(), [-10.5, 0, 3.6]), { delay: 150 });
    const wires = [
      jumperWire(pinWorld(drv, "OUT1"), pinWorld(motor, "M+"), WIRE_COLORS.red, { lift: 2 }),
      jumperWire(pinWorld(drv, "OUT2"), pinWorld(motor, "M-"), WIRE_COLORS.black, { lift: 1.6 }),
      jumperWire(pinWorld(bat, "+"), pinWorld(drv, "12V"), WIRE_COLORS.red, { lift: 1.5 }),
      jumperWire(pinWorld(bat, "-"), pinWorld(drv, "GND"), WIRE_COLORS.black, { lift: 1.2 }),
    ];
    wires.forEach((w) => ctx.add(w, { drop: false }));

    // The H-bridge drawn in the air behind the board.
    const diag = new THREE.Group();
    diag.position.set(0, 0, -7);
    ctx.stage.root.add(diag);
    const lineMat = new THREE.MeshStandardMaterial({ color: "#5d7a99", emissive: "#4cc9ff", emissiveIntensity: 0.15, roughness: 0.5 });
    const seg = (pts) => { const m = new THREE.Mesh(new THREE.TubeGeometry(roundedPath(pts.map((p) => V(p[0], p[1], 0)), 0.01), 32, 0.07, 6), lineMat); diag.add(m); return m; };
    seg([[-4.5, 14.5], [4.5, 14.5]]);
    seg([[-4.5, 6.5], [4.5, 6.5]]);
    for (const x of [-4, 4]) {
      seg([[x, 14.5], [x, 12.6]]);
      seg([[x, 11.0], [x, 10.0]]);
      seg([[x, 10.0], [x, 9.4]]);
      seg([[x, 7.8], [x, 6.5]]);
    }
    seg([[-4, 10.5], [-1.25, 10.5]]);
    seg([[1.25, 10.5], [4, 10.5]]);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 8, 48), lineMat);
    ring.position.set(0, 10.5, 0);
    diag.add(ring);
    const mLabel = ctx.text("M", { size: 1.3 });
    mLabel.position.set(0, 10.5, 0);
    diag.add(mLabel);
    const plus = ctx.text("+7.4 V battery", { size: 0.8, color: "#ff8a80" });
    plus.position.set(0, 15.4, 0);
    const gnd = ctx.text("GND", { size: 0.8, color: "#b0bec5" });
    gnd.position.set(0, 5.6, 0);
    diag.add(plus, gnd);
    // Switches: a bar hinged at its top end. Closed = vertical.
    const switches = {};
    const swMat = () => new THREE.MeshStandardMaterial({ color: "#cfd8e3", emissive: "#06d6a0", emissiveIntensity: 0, metalness: 0.6, roughness: 0.3 });
    for (const [name, x, yTop, yBot] of [["S1", -4, 12.6, 11.0], ["S2", 4, 12.6, 11.0], ["S3", -4, 9.4, 7.8], ["S4", 4, 9.4, 7.8]]) {
      const hinge = new THREE.Group();
      hinge.position.set(x, yTop, 0);
      const len = yTop - yBot;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, len, 0.22), swMat());
      bar.position.y = -len / 2;
      hinge.add(bar);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), lineMat);
      dot.position.set(0, -len, 0);
      const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), lineMat);
      diag.add(hinge);
      dot.position.set(x, yBot, 0);
      pivot.position.set(x, yTop, 0);
      diag.add(dot, pivot);
      const label = ctx.text(name, { size: 0.7, color: "#9fb4c8" });
      label.position.set(x + (x < 0 ? -1.1 : 1.1), (yTop + yBot) / 2, 0);
      diag.add(label);
      switches[name] = { hinge, bar, open: 1 };
    }
    // Current paths for the flowing charges.
    const path = (pts) => roundedPath(pts.map((p) => V(p[0], p[1], -7)), 0.3);
    const flows = {
      forward: ctx.flow(path([[0, 14.5], [-4, 14.5], [-4, 10.5], [4, 10.5], [4, 6.5], [0, 6.5]]), { count: 30, radius: 0.16 }),
      reverse: ctx.flow(path([[0, 14.5], [4, 14.5], [4, 10.5], [-4, 10.5], [-4, 6.5], [0, 6.5]]), { count: 30, radius: 0.16 }),
      brake: ctx.flow(path([[-4, 10.5], [4, 10.5], [4, 6.5], [-4, 6.5], [-4, 10.4]]), { count: 30, radius: 0.16, color: "#ff9f43" }),
      short: ctx.flow(path([[-4, 14.5], [-4, 6.5]]), { count: 20, radius: 0.18, color: "#ff4d6d" }),
    };
    const s = { drv, motor, whl, bat, diag, switches, flows, mode: "coast", duty: 1, rpm: 0 };
    ctx.frame((dt) => {
      const m = s.mode;
      const closed = { forward: ["S1", "S4"], reverse: ["S2", "S3"], brake: ["S3", "S4"], coast: [], short: ["S1", "S3"] }[m];
      for (const [name, sw] of Object.entries(switches)) {
        const want = closed.includes(name) ? 0 : 1;
        sw.open += (want - sw.open) * Math.min(dt * 10, 1);
        sw.hinge.rotation.z = (name === "S1" || name === "S3" ? 1 : -1) * sw.open * 0.6;
        sw.bar.material.emissiveIntensity = want ? 0 : 0.8;
      }
      // Wheel speed: 6 V gives about 200 RPM; the L298N loses about 2 V.
      const vm = (7.4 - 2) * s.duty;
      const target = m === "forward" ? (vm / 6) * 200 : m === "reverse" ? -(vm / 6) * 200 : 0;
      const tau = m === "brake" ? 0.08 : m === "coast" ? 0.9 : 0.25;
      s.rpm += (target - s.rpm) * Math.min(dt / tau, 1);
      if (m === "short") s.rpm *= 0.9;
      whl.rotation.x += (s.rpm / 60) * Math.PI * 2 * dt;
      motor.userData.shaft.rotation.x = whl.rotation.x;
      const speed = Math.abs(s.rpm) / 180;
      flows.forward.visible(m === "forward"); flows.forward.setRate(0.25 * s.duty + 0.05);
      flows.reverse.visible(m === "reverse"); flows.reverse.setRate(0.25 * s.duty + 0.05);
      flows.brake.visible(m === "brake" && speed > 0.03); flows.brake.setRate(speed * 0.5);
      flows.short.visible(m === "short"); flows.short.setRate(1.4);
      lineMat.emissiveIntensity = m === "short" ? 0.6 + 0.4 * Math.sin(ctx.time * 20) : 0.15;
      lineMat.emissive.set(m === "short" ? "#ff4d6d" : "#4cc9ff");
    });
    return s;
  },
  steps: [
    {
      title: "Why a motor needs a driver",
      text: `<p>A small TT motor draws <b>150 to 250 mA</b> running, and over <b>1 A</b> when it starts or stalls. An ESP32 pin can give about <b>20 mA</b>. Connect a motor straight to a pin and the pin dies.</p>
        <p>Motors also kick back voltage spikes when they stop. So between the brain and the muscle you put a <b>motor driver</b>: the pin gives the order, the driver delivers the power from the battery.</p>
        <p>This is the <b>L298N</b>, a classic dual driver: it can run two motors.</p>`,
      camera: { target: [0, 2, 0], theta: 0.35, phi: 0.95, radius: 34 },
      enter(ctx, s) {
        s.mode = "coast";
        ctx.focus(s.drv);
        ctx.label(s.drv, "L298N driver", { offset: V(0, 2.6, -0.4), dx: -40, dy: -60 });
        ctx.label(s.motor, "TT gear motor", { offset: V(-0.95, 1.2, 0.6), dx: 50, dy: -50 });
        ctx.label(s.bat, "2 × 18650: 7.4 V", { offset: V(0, 2.2, 0), dx: -40, dy: -50 });
      },
    },
    {
      title: "The H-bridge",
      text: `<p>Inside, each motor sits in the middle of four switches arranged like the letter <b>H</b> (drawn above the board).</p>
        <ul><li>Close <b>S1 + S4</b>: current flows left to right through the motor. <b>Forward.</b></li>
        <li>Close <b>S2 + S3</b>: right to left. <b>Reverse.</b></li>
        <li>Close <b>S3 + S4</b>: the motor's ends are joined, and its own spinning current stops it fast. <b>Brake.</b></li>
        <li>All open: it rolls to a stop. <b>Coast.</b></li></ul>
        <p>The switches are really transistors, flipped by the IN pins.</p>`,
      camera: { target: [1, 8, -3], theta: 0.15, phi: 1.2, radius: 34 },
      enter(ctx, s) {
        modeButtons(ctx, s, ["forward", "reverse", "brake", "coast"]);
      },
    },
    {
      title: "The one forbidden move",
      text: `<p>Close <b>S1 and S3</b> together (both switches on one side) and the battery is connected straight across itself, through nothing. That's called <b>shoot-through</b>: a short circuit, huge current, and a burnt driver.</p>
        <p>The L298N's logic stops it: each IN pin flips one side as a pair, so the top and bottom switch on a side can never both close. Here you can see what it would look like.</p>`,
      camera: { target: [-2, 10, -5], theta: -0.35, phi: 1.25, radius: 26 },
      enter(ctx, s) {
        modeButtons(ctx, s, ["forward", "short"]);
      },
    },
    {
      title: "Truth table",
      text: `<p>On the L298N, motor A is set by <b>IN1</b>, <b>IN2</b> and <b>ENA</b>:</p>
        <table class="ac-table truth"><tr><th>ENA</th><th>IN1</th><th>IN2</th><th>Motor</th></tr>
        <tr data-mode="forward"><td>HIGH</td><td>HIGH</td><td>LOW</td><td>forward</td></tr>
        <tr data-mode="reverse"><td>HIGH</td><td>LOW</td><td>HIGH</td><td>reverse</td></tr>
        <tr data-mode="brake"><td>HIGH</td><td>same</td><td>same</td><td>brake</td></tr>
        <tr data-mode="coast"><td>LOW</td><td>any</td><td>any</td><td>coast</td></tr></table>
        <p>Motor B works the same with IN3, IN4 and ENB.</p>`,
      camera: { target: [1, 6, -2], theta: 0.6, phi: 1.1, radius: 34 },
      enter(ctx, s) {
        modeButtons(ctx, s, ["forward", "reverse", "brake", "coast"]);
        ctx.stepFrame(() => {
          for (const tr of document.querySelectorAll(".ac-text .truth tr[data-mode]")) tr.classList.toggle("on", tr.dataset.mode === s.mode);
        });
      },
    },
    {
      title: "Speed with PWM",
      text: `<p><b>ENA</b> switches the whole bridge on and off. Feed it <b>PWM</b> and the motor gets power for only part of each cycle: that sets its speed.</p>
        <p>The black <b>jumper</b> on ENA ties it permanently HIGH (full speed). Pull it off and wire ENA to a PWM pin to control speed.</p>
        <p>Below about 30 % a TT motor stalls: there isn't enough push to overcome friction.</p>`,
      camera: { target: [4, 3, 0], theta: 0.6, phi: 0.9, radius: 24 },
      enter(ctx, s) {
        if (s.mode !== "forward" && s.mode !== "reverse") s.mode = "forward";
        ctx.focus(s.drv.userData.jumpers.ENA);
        const out = ctx.readout();
        ctx.slider({ label: "ENA duty", min: 0, max: 255, value: Math.round(s.duty * 255), format: (v) => `${v} / 255`, onInput: (v) => { s.duty = v < 77 ? 0 : v / 255; } });
        modeButtons(ctx, s, ["forward", "reverse"]);
        ctx.stepFrame(() => out.set(`Wheel: <b>${Math.abs(s.rpm).toFixed(0)} RPM</b>, ${Math.abs((s.rpm / 60) * Math.PI * 6.5).toFixed(0)} cm/s on the floor${s.duty === 0 ? ` <span class="warn">(stalled: too little power)</span>` : ""}`));
      },
    },
    {
      title: "Wiring it to the ESP32",
      text: `<p>On the robot, six ESP32 pins drive the L298N, and the L298N's <b>+5V</b> output powers the ESP32. Always join the grounds.</p>
        <pre class="snippet">const int ENA = 33, IN1 = 25, IN2 = 26;

void setup() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  ledcAttach(ENA, 1000, 8);    // 1 kHz PWM
}

void loop() {
  digitalWrite(IN1, HIGH);     // forward
  digitalWrite(IN2, LOW);
  ledcWrite(ENA, 200);         // speed 200 / 255
}</pre>
        <p>The 3.3 V from the ESP32 is plenty: the L298N reads anything above about 2.3 V as HIGH.</p>`,
      camera: { target: [0, 2, 1], theta: -0.3, phi: 0.85, radius: 26 },
      enter(ctx, s) {
        s.mode = "forward"; s.duty = 200 / 255;
        ctx.focus(byInfo(s.drv, L298N_NOTES.logic.title));
        ctx.label(s.drv, "ENA IN1 IN2 IN3 IN4 ENB", { offset: V(0.75, 1.2, 1.75), dx: 40, dy: 60 });
        ctx.label(s.drv, "+5V out → ESP32 5V", { offset: V(-0.45, 1.2, 1.75), dx: -60, dy: 50 });
      },
    },
  ],
};

function modeButtons(ctx, s, modes) {
  const names = { forward: "Forward", reverse: "Reverse", brake: "Brake", coast: "Coast", short: "S1 + S3 (short!)" };
  if (!modes.includes(s.mode)) s.mode = modes[0];
  ctx.buttons(modes.map((m) => ({ label: names[m], cls: m === "short" ? "danger" : "", active: m === s.mode, onClick: () => { s.mode = m; } })), { toggle: true });
}

// ---- Lesson 10: Ultrasonic distance ---------------------------------------------------------

const SONAR_CODE = `const int TRIG = 5;
const int ECHO = 18;   // via a 1k/2k divider: echo is 5 V

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

void loop() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);       // a 10 µs pulse: "measure now"
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH);  // how long echo stayed HIGH
  float cm = us * 0.0343 / 2;     // sound: 343 m/s, there and back
  Serial.println(cm);
  delay(100);
}`;

const SLOW_SPEED = 40; // cm/s for the drawn sound (real sound: 34,300 cm/s)

const sonar = {
  id: "sonar",
  title: "Seeing with ultrasound",
  summary: "The HC-SR04: a chirp, an echo, and the speed of sound.",
  minutes: 6,
  setup(ctx) {
    const sensor = ctx.add(ctx.place(hcsr04(), [0, 0.3, 0]));
    const wallMat = new THREE.MeshStandardMaterial({ color: "#a47148", roughness: 0.8 });
    const wall = ctx.add(new THREE.Mesh(new THREE.BoxGeometry(30, 14, 1.2), wallMat), { at: [0, 7, 30], delay: 200 });
    wall.castShadow = wall.receiveShadow = true;
    wall.userData.info = { title: "A wall", text: "Hard, flat surfaces reflect sound best. Soft fabric or steep angles can swallow the echo." };
    const tx = sensor.localToWorld(sensor.userData.tx.clone());
    const rx = sensor.localToWorld(sensor.userData.rx.clone());
    const s = { sensor, wall, d: 28.7, t: 0, period: 2, trig: 0, echo: 0, phase: "idle", tx, rx };
    s.code = ctx.code(SONAR_CODE, { title: "Distance.ino" });
    // Sound fronts: rings that grow as they travel (the beam spreads about 15°).
    const ringMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const rings = [];
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), ringMat(i < 3 ? "#7fe3ff" : "#ffb35c"));
      r.userData.noPick = true;
      r.visible = false;
      ctx.stage.root.add(r);
      rings.push(r);
    }
    ctx.frame((dt) => {
      s.d = wall.position.z - 0.6 - tx.z;
      const T = (2 * s.d) / SLOW_SPEED; // drawn round trip
      s.period = Math.max(T + 0.9, 1.6);
      s.t += dt;
      if (s.t > s.period) s.t = 0;
      const t = s.t;
      s.trig = t < 0.12 ? 1 : 0;
      const tOut = t - 0.15;
      s.echo = tOut > 0 && tOut < T ? 1 : 0;
      s.code.highlight(t < 0.15 ? [13, 14, 15] : s.echo ? [16] : t < T + 0.5 ? [17, 18] : [19]);
      rings.forEach((r, i) => {
        const lag = (i % 3) * 0.06;
        const dist = (tOut - lag) * SLOW_SPEED;
        const going = i < 3;
        let z, x, travelled;
        if (going) { travelled = dist; z = tx.z + dist; x = tx.x; r.visible = dist > 0 && dist < s.d; }
        else { travelled = dist; const back = dist - s.d; z = wall.position.z - 0.6 - back; x = THREE.MathUtils.lerp(tx.x, rx.x, Math.min(back / s.d, 1)); r.visible = back > 0 && back < s.d; }
        const spread = 0.8 + travelled * Math.tan((15 * Math.PI) / 180);
        r.position.set(x, tx.y, z);
        r.scale.setScalar(spread);
        r.material.opacity = 0.85 * Math.max(0.15, 1 - travelled / 140);
      });
      const us = (2 * s.d) / 0.0343;
      s.readout?.set(`Wall at <b>${s.d.toFixed(1)} cm</b> → echo <b>${us.toFixed(0)} µs</b><br>${us.toFixed(0)} × 0.0343 ÷ 2 = <b>${((us * 0.0343) / 2).toFixed(1)} cm</b>`);
    });
    ctx.scope([
      { name: "Trig", color: "#7fe3ff", read: () => s.trig },
      { name: "Echo", color: "#ffb35c", read: () => s.echo },
    ], { title: "Trig and Echo (slowed down)", seconds: 4, labels: ["0", "5 V"] });
    s.dragWall = () => ctx.onGrab((hit, h) => {
      if (hit.object !== wall) return null;
      return {
        move: (hh) => {
          const p = ctx.stage.onPlane(hh.x, hh.y, 7);
          if (p) wall.position.z = THREE.MathUtils.clamp(p.z, 4, 80);
        },
      };
    });
    return s;
  },
  steps: [
    {
      title: "A bat on a circuit board",
      text: `<p>The <b>HC-SR04</b> measures distance the way bats do. It has a tiny speaker, <b>T</b> (transmit), and a microphone, <b>R</b> (receive), both working at <b>40 kHz</b>, twice as high as anyone can hear.</p>
        <p>It sees from <b>2 cm to 4 m</b>, in a cone about <b>15°</b> wide, to within about 3 mm. It needs <b>5 V</b>.</p>
        <p>Four pins: <b>VCC</b>, <b>Trig</b>, <b>Echo</b>, <b>GND</b>.</p>`,
      camera: { target: [0, 2, 3], theta: 0.7, phi: 1.05, radius: 18 },
      enter(ctx, s) {
        ctx.focus(s.sensor);
        ctx.label(s.sensor, "T: speaker", { offset: s.sensor.userData.tx.clone(), dx: -60, dy: -50 });
        ctx.label(s.sensor, "R: microphone", { offset: s.sensor.userData.rx.clone(), dx: 60, dy: -50 });
        ctx.label(s.sensor, "VCC Trig Echo GND", { offset: V(0, 0, 0), dx: 50, dy: 50 });
      },
    },
    {
      title: "Trigger and echo",
      text: `<p>Watch the oscilloscope and the scene together:</p>
        <ol><li>The ESP32 puts a <b>10 µs pulse</b> on <b>Trig</b>.</li>
        <li>The sensor sends a burst of eight 40 kHz pulses (blue), and raises <b>Echo</b>.</li>
        <li>The sound bounces off the wall and comes back (orange).</li>
        <li>When the microphone hears it, <b>Echo drops</b>.</li></ol>
        <p>So the length of the Echo pulse is the sound's round-trip time. Here the sound is slowed down about 850× so you can see it.</p>`,
      camera: { target: [0, 3, 14], theta: 1.25, phi: 1.1, radius: 46 },
      enter(ctx, s) {
        ctx.label(s.wall, "Echo returns", { offset: V(-8, 4, -0.6), dx: -60, dy: -40 });
      },
    },
    {
      title: "The maths",
      text: `<p>Sound travels at about <b>343 m/s</b> in air at 20 °C, which is <b>0.0343 cm per microsecond</b>. The echo time covers the trip there <i>and back</i>, so:</p>
        <p class="formula">distance = echo time × 0.0343 ÷ 2</p>
        <p><b>Pinch the wall and drag it</b> (or use the slider). The numbers follow.</p>`,
      camera: { target: [0, 3, 16], theta: 1.2, phi: 1.0, radius: 52 },
      enter(ctx, s) {
        s.readout = ctx.readout();
        const sl = ctx.slider({ label: "Wall distance", min: 5, max: 70, value: Math.round(s.d), format: (v) => `${v} cm`, onInput: (v) => { tween(s.wall.position, { z: v + 0.6 + s.tx.z }, { ms: 300 }); } });
        s.dragWall();
        ctx.stepFrame(() => { if (document.activeElement !== sl.input) sl.input.value = Math.round(s.d); });
      },
    },
    {
      title: "Wiring it to an ESP32",
      text: `<p>The HC-SR04 runs on 5 V, so its <b>Echo</b> pin outputs <b>5 V</b>, too much for an ESP32 input. Drop it with a <b>voltage divider</b>: 1 kΩ from Echo to the pin, 2 kΩ from the pin to GND.</p>
        <p class="formula">V<sub>pin</sub> = 5 × 2k ÷ (1k + 2k) = 3.33 V</p>
        <p>Trig is fine as it is: the sensor reads the ESP32's 3.3 V as HIGH. The code on the right takes a reading ten times a second.</p>
        <p>On the robot, this sensor is its eyes: when something is closer than about 25 cm, it turns away.</p>`,
      camera: { target: [0, 2, 4], theta: -0.6, phi: 1.0, radius: 24 },
      enter(ctx, s) {
        s.readout = ctx.readout();
        s.dragWall();
      },
    },
  ],
};

export const ESP32 = { id: "esp32", title: "ESP32 and robotics", lessons: [esp, hbridge, sonar] };
