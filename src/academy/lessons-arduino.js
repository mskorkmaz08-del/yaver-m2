// Module 2: Arduino. The Uno board, a first sketch (Blink), reading a button,
// and PWM brightness with analogWrite.
import * as THREE from "three";
import { tween, ease } from "./anim.js?v=18";
import { arduinoUno, breadboard, resistor, led, pushButton, jumperWire, pinWorld, WIRE_COLORS, UNO_NOTES } from "./parts.js?v=18";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Meshes inside a part whose note has this title.
export function byInfo(part, ...titles) {
  const out = [];
  part.traverse((m) => { if (m.isMesh && titles.includes(m.userData.info?.title)) out.push(m); });
  return out;
}

// ---- Lesson 4: Meet the Arduino Uno -------------------------------------------------

const uno = {
  id: "uno",
  title: "Meet the Arduino Uno",
  summary: "A guided tour of the board: power, brain, pins.",
  minutes: 5,
  setup(ctx) {
    const board = arduinoUno();
    board.scale.setScalar(1.6);
    ctx.add(board, { at: [0, 0, 0] });
    return { board };
  },
  steps: [
    {
      title: "The whole board",
      text: `<p>The <b>Arduino Uno</b> is the most popular board for learning: rugged, cheap, and with thousands of examples online.</p>
        <p>Everything on it serves one chip: the <b>ATmega328P</b> microcontroller, a complete little computer that runs one program, your <b>sketch</b>, forever.</p>
        <p class="tip">Pinch (or click) any part to read about it. Next takes you round the board.</p>`,
      camera: { target: [0, 0, 0], theta: 0.2, phi: 0.75, radius: 24 },
      enter(ctx, s) {
        ctx.label(s.board, "Microcontroller", { offset: V(1.3, 0.6, 1.0), dx: 60, dy: 40 });
        ctx.label(s.board, "USB", { offset: V(-3.0, 1.1, -1.55), dx: -50, dy: -40 });
        ctx.label(s.board, "Digital pins", { offset: V(1.5, 1.0, -2.42), dx: 40, dy: -50 });
        ctx.label(s.board, "Analog + power pins", { offset: V(1.0, 1.0, 2.42), dx: 40, dy: 50 });
      },
    },
    {
      title: "Power in",
      text: `<p>There are two ways to power the Uno:</p>
        <ul><li>The <b>USB-B</b> port: 5 V from your computer, which also carries your sketch and its messages.</li>
        <li>The <b>barrel jack</b>: 7 to 12 V from a battery or adapter. The <b>regulator</b> brings it down to a clean 5 V.</li></ul>
        <p>Below 7 V on the jack the regulator can't keep 5 V; above 12 V it runs hot.</p>`,
      camera: { target: [-4, 1, 0], theta: -0.9, phi: 0.85, radius: 18 },
      enter(ctx, s) {
        ctx.focus(byInfo(s.board, UNO_NOTES.usb.title, UNO_NOTES.jack.title, UNO_NOTES.reg.title));
        ctx.label(s.board, "USB-B: 5 V + data", { offset: V(-3.0, 1.1, -1.55), dx: -40, dy: -50 });
        ctx.label(s.board, "Barrel jack: 7–12 V", { offset: V(-3.0, 1.1, 1.75), dx: -40, dy: 50 });
        ctx.label(s.board, "5 V regulator", { offset: V(-2.4, 0.4, 0.6), dx: 60, dy: 40 });
      },
    },
    {
      title: "The brain",
      text: `<p>The long black chip is the <b>ATmega328P</b>: 8-bit, <b>16 MHz</b>, <b>32 KB</b> of flash for your program, <b>2 KB</b> of RAM.</p>
        <p>That sounds tiny next to a phone, and it is. But it does exactly one thing, with no operating system in the way, so it reacts in microseconds.</p>
        <p>The silver <b>crystal</b> beside it ticks 16 million times a second, and every delay() is counted from it.</p>`,
      camera: { target: [1, 0.5, 1.5], theta: 0.55, phi: 0.65, radius: 13 },
      enter(ctx, s) {
        ctx.focus(byInfo(s.board, UNO_NOTES.mcu.title, UNO_NOTES.crystal.title));
        ctx.label(s.board, "ATmega328P", { offset: V(1.3, 0.6, 1.0), dx: 60, dy: -40 });
        ctx.label(s.board, "16 MHz crystal", { offset: V(-0.45, 0.4, 1.0), dx: -60, dy: 40 });
      },
    },
    {
      title: "Digital pins",
      text: `<p>Along the top edge: <b>digital pins 0 to 13</b>. Each one is either an <b>input</b> (reads whether something is HIGH or LOW) or an <b>output</b> (sets itself to 5 V or 0 V).</p>
        <ul><li>Pins with a <b>~</b> (3, 5, 6, 9, 10, 11) can also make <b>PWM</b>, a fake in-between voltage.</li>
        <li>Each pin can give about <b>20 mA</b> safely (40 mA absolute maximum): enough for an LED, not a motor.</li>
        <li>Pins 0 and 1 are the serial link to USB: leave them free.</li></ul>
        <p>Pin 13 also has the little <b>L</b> LED on the board.</p>`,
      camera: { target: [1.5, 1, -2.4], theta: 0.1, phi: 0.6, radius: 13 },
      enter(ctx, s) {
        ctx.focus(byInfo(s.board, UNO_NOTES.digital.title, UNO_NOTES.ledL.title));
        ctx.label(s.board, "~ = PWM capable", { offset: V(2.0, 1.0, -2.42), dx: 40, dy: -50 });
        ctx.label(s.board, "Pin 13 and LED L", { offset: V(1.0 - 5 * 0.254, 1.0, -2.42), dx: -50, dy: -50 });
        ctx.label(s.board, "0, 1: USB serial", { offset: V(3.0, 1.0, -2.42), dx: 50, dy: 30 });
      },
    },
    {
      title: "Analog inputs",
      text: `<p><b>A0 to A5</b> measure a voltage between 0 and 5 V and turn it into a number from <b>0 to 1023</b> with <code>analogRead()</code>. That's 10 bits, about 4.9 mV per step.</p>
        <p>Use them for knobs (potentiometers), light sensors, temperature sensors: anything that changes smoothly instead of just on and off.</p>`,
      camera: { target: [2.4, 1, 2.4], theta: 0.3, phi: 0.65, radius: 12 },
      enter(ctx, s) {
        ctx.focus(byInfo(s.board, UNO_NOTES.analog.title));
        ctx.label(s.board, "analogRead(A0) → 0…1023", { offset: V(2.2, 1.0, 2.42), dx: 50, dy: 40 });
      },
    },
    {
      title: "Power pins",
      text: `<p>The <b>power header</b> feeds your own circuits:</p>
        <ul><li><b>5V</b> and <b>3.3V</b>: regulated supply for sensors.</li>
        <li><b>GND</b>: ground, 0 V. Every circuit you add must share this ground with the board.</li>
        <li><b>Vin</b>: the raw voltage from the barrel jack.</li></ul>
        <p>Never join 5V straight to GND: that's a short circuit.</p>`,
      camera: { target: [0, 1, 2.4], theta: -0.2, phi: 0.65, radius: 12 },
      enter(ctx, s) {
        ctx.focus(byInfo(s.board, UNO_NOTES.power.title));
        ctx.label(s.board, "5V", { offset: V(-0.6 + 3 * 0.254, 1.0, 2.42), dx: -30, dy: 50 });
        ctx.label(s.board, "GND", { offset: V(-0.6 + 4.5 * 0.254, 1.0, 2.42), dx: 0, dy: 60 });
        ctx.label(s.board, "Vin", { offset: V(-0.6 + 6 * 0.254, 1.0, 2.42), dx: 40, dy: 50 });
      },
    },
    {
      title: "Explore it yourself",
      text: `<p>Turn the board around and <b>pinch any part</b>: the reset button, the USB chip, the capacitors, the TX and RX lights.</p>
        <p>Next up: making it do something. You'll write your first sketch.</p>`,
      camera: { target: [0, 0, 0], theta: 0.9, phi: 0.7, radius: 20 },
      enter() {},
    },
  ],
};

// ---- Shared circuit: Uno, breadboard, resistor and LED on one pin ---------------------

function ledCircuit(ctx, pin = 13, ohms = 220) {
  const board = ctx.add(ctx.place(arduinoUno(), [-6, 0, 0]));
  const bb = ctx.add(ctx.place(breadboard(), [5.5, 0, 0]), { delay: 150 });
  const hole = (c, r) => bb.localToWorld(bb.userData.hole(c - 1, r));
  const a = hole(8, "b"), b = hole(12, "b");
  const res = ctx.add(resistor(ohms, { span: a.distanceTo(b), legDown: 0.9 }), { at: [(a.x + b.x) / 2, 1.15, a.z], delay: 300 });
  const la = hole(12, "c"), lk = hole(13, "c");
  const light = ctx.add(led("red"), { at: [(la.x + lk.x) / 2, 1.65, la.z], delay: 400 });
  const sig = ctx.add(jumperWire(pinWorld(board, `D${pin}`), hole(8, "a"), WIRE_COLORS.orange, { lift: 2 }), { drop: false });
  const gnd = ctx.add(jumperWire(pinWorld(board, "GND_D"), hole(13, "a"), WIRE_COLORS.black, { lift: 2.6 }), { drop: false });
  return { board, bb, res, light, sig, gnd, hole };
}

// Steps through a scripted program: [{ line, ms, run() }], looping from
// `loopFrom`. Shows the line being run in the code panel.
function scriptRunner(ctx, code, program, loopFrom = 0) {
  let i = 0, t = 0, running = false;
  const run = () => { const st = program[i]; code.highlight(st.line); st.run?.(); };
  ctx.frame((dt) => {
    if (!running) return;
    t += dt * 1000;
    const ms = typeof program[i].ms === "function" ? program[i].ms() : program[i].ms;
    if (t >= ms) {
      t = 0;
      i = i + 1 >= program.length ? loopFrom : i + 1;
      run();
    }
  });
  return {
    start(from = 0) { i = from; t = 0; running = true; run(); },
    stop() { running = false; code.highlight([]); },
    get running() { return running; },
  };
}

// ---- Lesson 5: Blink -------------------------------------------------------------------

const BLINK = `// Blink: the LED on pin 13 turns on and off.
const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);     // pin 13 becomes an output
}

void loop() {
  digitalWrite(LED_PIN, HIGH);  // 5 V: LED on
  delay(1000);                  // wait 1000 ms
  digitalWrite(LED_PIN, LOW);   // 0 V: LED off
  delay(1000);                  // wait again
}`;

const blink = {
  id: "blink",
  title: "Your first sketch: Blink",
  summary: "setup(), loop(), digitalWrite and delay, running line by line.",
  minutes: 6,
  setup(ctx) {
    const c = ledCircuit(ctx, 13);
    const s = { ...c, on: false, wait: 1000 };
    s.code = ctx.code(BLINK, { title: "Blink.ino" });
    const set = (on) => { s.on = on; };
    s.runner = scriptRunner(ctx, s.code, [
      { line: 4, ms: 500 },
      { line: 5, ms: 700 },
      { line: 9, ms: 450, run: () => set(true) },
      { line: 10, ms: () => s.wait },
      { line: 11, ms: 450, run: () => set(false) },
      { line: 12, ms: () => s.wait },
    ], 2);
    ctx.frame(() => {
      const k = s.on ? 0.68 : 0;
      s.light.userData.setBrightness(k);
      s.board.userData.leds.L.material.emissiveIntensity = s.on ? 2.5 : 0.1;
      s.sig.userData.mat.emissiveIntensity = s.on ? 0.6 : 0;
    });
    ctx.scope([{ name: "pin 13", color: "#ffb020", read: () => (s.on ? 1 : 0) }], { title: "Pin 13 voltage", seconds: 6 });
    return s;
  },
  steps: [
    {
      title: "The circuit",
      text: `<p>Pin <b>13</b> → orange wire → <b>220 Ω</b> resistor → LED → black wire → <b>GND</b>.</p>
        <p>When the pin goes HIGH (5 V), current flows: (5 − 2) ÷ 220 = <b>13.6 mA</b>, safely under the pin's 20 mA.</p>
        <p>The program is on the right. A sketch always has two parts: <code>setup()</code> and <code>loop()</code>.</p>`,
      camera: { target: [0, 0, 0], theta: 0.25, phi: 0.8, radius: 30 },
      enter(ctx, s) {
        s.runner.stop(); s.on = false;
        ctx.label(s.board, "Pin 13", { offset: s.board.worldToLocal(pinWorld(s.board, "D13")), dx: -30, dy: -50 });
        ctx.label(s.res, "220 Ω", { offset: V(0, 0.45, 0), dx: 30, dy: -50 });
        ctx.label(s.light, "LED", { offset: V(0, 0.8, 0), dx: 40, dy: -40 });
        ctx.label(s.board, "GND", { offset: s.board.worldToLocal(pinWorld(s.board, "GND_D")), dx: -50, dy: -30 });
      },
    },
    {
      title: "setup() runs once",
      text: `<p>When the board powers up (or you press reset), it runs <code>setup()</code> exactly <b>once</b>.</p>
        <p><code>pinMode(LED_PIN, OUTPUT)</code> turns pin 13 into an output, so it can drive the LED. Pins start as inputs, which would leave the LED dark.</p>
        <p><code>const int LED_PIN = 13;</code> gives the pin a name, so the code says what it means.</p>`,
      camera: { target: [-3, 0, 0], theta: 0.1, phi: 0.75, radius: 26 },
      enter(ctx, s) {
        s.runner.stop(); s.on = false;
        s.code.highlight([4, 5, 6]);
        ctx.focus(s.board);
      },
    },
    {
      title: "loop() runs forever",
      text: `<p>Then <code>loop()</code> runs, and when it reaches the end it starts again, forever, until the power goes.</p>
        <p>Watch the highlighted line move through the code, and the LED follow it.</p>
        <ul><li><code>digitalWrite(LED_PIN, HIGH)</code>: the pin jumps to 5 V.</li>
        <li><code>delay(1000)</code>: do nothing for 1000 ms, one second.</li>
        <li><code>LOW</code>: back to 0 V.</li></ul>`,
      camera: { target: [1, 0, 0], theta: 0.5, phi: 0.85, radius: 24 },
      enter(ctx, s) {
        s.wait = 1000;
        s.code.set(BLINK);
        s.runner.start(0);
        ctx.focus(s.light);
      },
    },
    {
      title: "Timing is up to you",
      text: `<p>Change the delay and the blink follows. The oscilloscope shows pin 13's voltage over time: a <b>square wave</b>.</p>
        <p>Below about 20 ms per half, your eyes can't follow it any more and the LED looks steadily on, just dimmer. That trick is called PWM, and it's two lessons away.</p>
        <p class="tip">Lines that don't wait are shown slowed down here. The real chip runs each one in well under a microsecond.</p>`,
      camera: { target: [3, 0, 0], theta: 0.3, phi: 0.8, radius: 22 },
      enter(ctx, s) {
        if (!s.runner.running) s.runner.start(2);
        ctx.slider({
          label: "delay()", min: 50, max: 2000, step: 50, value: s.wait, format: (v) => `${v} ms`,
          onInput: (v) => { s.wait = v; s.code.set(BLINK.replace(/delay\(1000\)/g, `delay(${v})`)); },
        });
      },
    },
    {
      title: "Uploading for real",
      text: `<p>To run this on a real Uno:</p>
        <ol><li>Install the <b>Arduino IDE</b> from arduino.cc.</li>
        <li>Plug the board in with a USB cable.</li>
        <li><b>Tools → Board → Arduino Uno</b>, and pick its port under <b>Tools → Port</b>.</li>
        <li>Paste the code and press <b>Upload</b> (the → arrow).</li></ol>
        <p>The TX and RX lights flicker during the upload, and then the LED starts blinking.</p>`,
      camera: { target: [-6, 0, 0], theta: -0.6, phi: 0.8, radius: 18 },
      enter(ctx, s) {
        if (!s.runner.running) s.runner.start(2);
        ctx.focus(byInfo(s.board, UNO_NOTES.usb.title, "TX LED", "RX LED"));
      },
    },
  ],
};

// ---- Lesson 6: Buttons and digitalRead --------------------------------------------------

const BUTTON_CODE = (mode) => `const int BUTTON = 2;
const int LED_PIN = 13;

void setup() {
  pinMode(BUTTON, ${mode});
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  bool pressed = digitalRead(BUTTON) == LOW;  // pressing joins pin 2 to GND
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
}`;

const buttonLesson = {
  id: "button",
  title: "Buttons and digitalRead",
  summary: "Reading a switch, the floating-pin trap, pull-ups and bounce.",
  minutes: 6,
  setup(ctx) {
    const c = ledCircuit(ctx, 13);
    const s = { ...c, pressed: false, mode: "INPUT_PULLUP", pin2: 1, bounceUntil: 0, noise: 0.5 };
    const hole = c.hole;
    const e20 = hole(20, "e"), e22 = hole(22, "e");
    s.button = ctx.add(pushButton(), { at: [(e20.x + e22.x) / 2, 0.85, 0], delay: 500 });
    s.w2 = ctx.add(jumperWire(pinWorld(c.board, "D2"), hole(20, "a"), WIRE_COLORS.yellow, { lift: 3.2 }), { drop: false });
    s.wg = ctx.add(jumperWire(hole(22, "j"), pinWorld(c.board, "GND_2"), WIRE_COLORS.black, { lift: 2.5 }), { drop: false });
    s.code = ctx.code(BUTTON_CODE("INPUT_PULLUP"), { title: "Button.ino" });
    ctx.frame((dt, t) => {
      s.button.userData.press(s.pressed);
      let v;
      if (s.pressed) v = 0;
      else if (s.mode === "INPUT_PULLUP") v = 1;
      else {
        // A floating input picks up whatever is nearby: it wanders.
        s.noise += (Math.random() - 0.5) * 0.5;
        s.noise = Math.min(Math.max(s.noise, 0), 1);
        v = s.noise > 0.5 ? 1 : 0;
      }
      if (t < s.bounceUntil) v = Math.random() < 0.5 ? 1 : 0; // the contacts bouncing
      s.pin2 = v;
      const lit = v === 0;
      s.light.userData.setBrightness(lit ? 0.68 : 0);
      s.board.userData.leds.L.material.emissiveIntensity = lit ? 2.5 : 0.1;
      s.code.highlight(lit ? [10, 11] : [10]);
    });
    ctx.scope([{ name: "pin 2", color: "#ffd166", read: () => s.pin2 }], { title: "Pin 2 voltage", seconds: 4 });
    s.press = (down) => {
      if (down && !s.pressed && s.bounce) s.bounceUntil = ctx.time + 0.35;
      s.pressed = down;
    };
    return s;
  },
  steps: [
    {
      title: "The circuit",
      text: `<p>A push button sits across the breadboard's channel. One side goes to <b>pin 2</b> (yellow wire), the other to <b>GND</b>.</p>
        <p>Pressing it joins pin 2 to ground. The code reads pin 2 and lights the LED while the button is down.</p>
        <p><b>Pinch the button</b> (or hold the mouse on it) to press it.</p>`,
      camera: { target: [2, 0, 0], theta: 0.3, phi: 0.75, radius: 28 },
      enter(ctx, s) {
        s.mode = "INPUT_PULLUP"; s.bounce = false; s.code.set(BUTTON_CODE("INPUT_PULLUP"));
        ctx.focus(s.button);
        ctx.label(s.button, "Push button", { offset: V(0, 0.6, 0), dx: 40, dy: -50 });
        ctx.label(s.board, "Pin 2", { offset: s.board.worldToLocal(pinWorld(s.board, "D2")), dx: 30, dy: -60 });
        grabButton(ctx, s);
      },
    },
    {
      title: "The floating-pin trap",
      text: `<p>Without anything holding it, an input pin connected to nothing is <b>floating</b>. It picks up electrical noise from your hand, the mains, the wires, and reads HIGH and LOW at random.</p>
        <p>This is <code>pinMode(BUTTON, INPUT)</code>. Look at the oscilloscope: the pin wanders even though nobody touches the button, and the LED flickers.</p>`,
      camera: { target: [6, 0, 0], theta: 0.6, phi: 0.8, radius: 20 },
      enter(ctx, s) {
        s.mode = "INPUT"; s.bounce = false;
        s.code.set(BUTTON_CODE("INPUT"));
        grabButton(ctx, s);
      },
    },
    {
      title: "The pull-up resistor",
      text: `<p>The fix is a <b>pull-up</b> resistor between the pin and 5 V. It gently holds the pin HIGH; pressing the button overpowers it and pulls the pin LOW.</p>
        <p>The Uno has one built into every pin (about 35 kΩ). <code>INPUT_PULLUP</code> switches it on, so you need no extra parts.</p>
        <p>Notice the logic is upside down: <b>pressed reads LOW</b>. That's why the code says <code>== LOW</code>.</p>`,
      camera: { target: [6, 0, 0], theta: 0.2, phi: 0.75, radius: 20 },
      enter(ctx, s) {
        s.mode = "INPUT_PULLUP"; s.bounce = false;
        s.code.set(BUTTON_CODE("INPUT_PULLUP"));
        s.code.highlight([5]);
        grabButton(ctx, s);
        ctx.buttons([{ label: "Hold the button for 1 second", onClick: () => { s.press(true); setTimeout(() => s.press(false), 1000); } }]);
      },
    },
    {
      title: "Contacts bounce",
      text: `<p>A button's metal contacts don't close cleanly: they <b>bounce</b> for a few milliseconds, so one press can read as several. Here it's shown slowed down.</p>
        <p>For a light that doesn't matter. For counting presses it does. The fix, <b>debouncing</b>, is to ignore changes that come too soon after the last one:</p>
        <pre class="snippet">if (millis() - lastChange > 50) {
  // accept the new reading
}</pre>`,
      camera: { target: [6, 0, 0], theta: -0.2, phi: 0.75, radius: 20 },
      enter(ctx, s) {
        s.mode = "INPUT_PULLUP"; s.bounce = true;
        s.code.set(BUTTON_CODE("INPUT_PULLUP"));
        grabButton(ctx, s);
        ctx.buttons([{ label: "Press once", onClick: () => { s.press(true); setTimeout(() => s.press(false), 900); } }]);
      },
    },
  ],
};

function grabButton(ctx, s) {
  ctx.onGrab((hit) => {
    let o = hit.object;
    while (o && o !== s.button) o = o.parent;
    if (!o) return null;
    s.press(true);
    return { end: () => s.press(false) };
  });
}

// ---- Lesson 7: PWM and analogWrite --------------------------------------------------------

const FADE = `const int LED_PIN = 9;     // a PWM pin (marked ~)

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  for (int b = 0; b <= 255; b++) {    // brighter...
    analogWrite(LED_PIN, b);          // on for b/255 of the time
    delay(8);
  }
  for (int b = 255; b >= 0; b--) {    // ...then dimmer
    analogWrite(LED_PIN, b);
    delay(8);
  }
}`;

const pwm = {
  id: "pwm",
  title: "PWM: dimming with analogWrite",
  summary: "Faking in-between voltages by switching very fast.",
  minutes: 5,
  setup(ctx) {
    const c = ledCircuit(ctx, 9);
    const s = { ...c, duty: 0.5, fading: false };
    s.code = ctx.code(FADE, { title: "Fade.ino" });
    let phase = 0;
    ctx.frame((dt, t) => {
      if (s.fading) {
        phase = (phase + dt / 4.1) % 1; // 256 steps × 8 ms ≈ 2 s each way
        const up = phase < 0.5;
        s.duty = up ? phase * 2 : 2 - phase * 2;
        s.code.highlight(up ? [8, 9, 10] : [12, 13, 14]);
        s.readout?.set(`b = <b>${Math.round(s.duty * 255)}</b>: on <b>${Math.round(s.duty * 100)} %</b> of the time`);
      }
      s.light.userData.setBrightness(0.68 * s.duty);
      s.wave = s.duty > 0 && (t * 2) % 1 < s.duty ? 1 : 0;
    });
    ctx.scope([{ name: "pin 9", color: "#ff9f43", read: () => s.wave }], { title: "Pin 9, slowed 245×", seconds: 3 });
    return s;
  },
  steps: [
    {
      title: "Only on or off",
      text: `<p>A digital pin can only be <b>5 V or 0 V</b>. So how do you make an LED half bright, or a motor half speed?</p>
        <p>You switch it on and off <b>very fast</b>, and vary how much of each cycle it's on. That's <b>PWM</b>: pulse-width modulation.</p>
        <p>This LED is now on <b>pin 9</b>, one of the PWM pins marked with ~.</p>`,
      camera: { target: [0, 0, 0], theta: 0.3, phi: 0.8, radius: 28 },
      enter(ctx, s) {
        s.fading = false; s.duty = 1; s.code.highlight([]);
        ctx.label(s.board, "Pin ~9", { offset: s.board.worldToLocal(pinWorld(s.board, "D9")), dx: -20, dy: -55 });
      },
    },
    {
      title: "The duty cycle",
      text: `<p>The fraction of time the pin is on is the <b>duty cycle</b>. On pin 9 the Uno repeats the cycle <b>490 times a second</b>, far too fast to see, so your eye averages it.</p>
        <p><code>analogWrite(pin, value)</code> sets it, from <b>0</b> (always off) to <b>255</b> (always on). 128 is about half.</p>
        <p>Drag the slider and watch the pulses on the oscilloscope get wider.</p>`,
      camera: { target: [4, 0, 0], theta: 0.4, phi: 0.75, radius: 22 },
      enter(ctx, s) {
        s.fading = false;
        s.code.highlight([9]);
        ctx.slider({ label: "analogWrite", min: 0, max: 255, value: Math.round(s.duty * 255), format: (v) => `${v} (${Math.round((v / 255) * 100)} %)`, onInput: (v) => { s.duty = v / 255; } });
      },
    },
    {
      title: "Fading in and out",
      text: `<p>This sketch counts <code>b</code> from 0 to 255 and back, writing each value with a short pause. The LED breathes smoothly.</p>
        <p>The same trick sets a <b>motor's speed</b>. That's exactly how the robot at the end of the course controls its wheels.</p>`,
      camera: { target: [3, 0, 0], theta: 0.1, phi: 0.8, radius: 22 },
      enter(ctx, s) {
        s.readout = ctx.readout();
        s.fading = true;
      },
    },
  ],
};

export const ARDUINO = { id: "arduino", title: "Arduino", lessons: [uno, blink, buttonLesson, pwm] };
