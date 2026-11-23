// The Mini Yaver tutorial: the Arduino Uno "desk AI" project from his kit,
// taught in two parts. Wiring: a clickable diagram of every wire, built up in
// eight short steps. Code: the real sketch and Mac bridge (fetched from
// /mini-yaver/), walked through section by section; each note lights up the
// lines it talks about. Plain HTML and SVG, no 3D, so every pin is readable.

import { chartHTML, specHTML } from "./miniyaver-chart.js?v=27";

const SKETCH_URL = new URL("../../mini-yaver/MiniYaver/MiniYaver.ino", import.meta.url).href;
const BRIDGE_URL = new URL("../../mini-yaver/mini_yaver_bridge.py", import.meta.url).href;
const FILES_URL = new URL("../../mini-yaver/", import.meta.url).href;

// ---- The board ----------------------------------------------------------------------

// Uno pin positions in the diagram (viewBox 1000 x 640). Like the real board,
// the digital header runs D13…D0 left to right along the top, and the power
// and analog pins sit along the bottom.
const PIN = {};
["D13", "D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"].forEach((n, i) => { PIN[n] = [432 + i * 18, 268]; });
["3V3", "5V", "GND"].forEach((n, i) => { PIN[n] = [380 + i * 22, 422]; });
["A0", "A1", "A2", "A3", "A4", "A5"].forEach((n, i) => { PIN[n] = [540 + i * 22, 422]; });

// What each Uno pin does here, and why that pin.
const PIN_NOTE = {
  D0: "USB to the Mac (receive). Wired inside the board to the CH340 USB chip, so nothing plugs in here.",
  D1: "USB to the Mac (send). Same as D0: taken by USB.",
  D2: "IR receiver. D2 is interrupt INT0, so the IR library catches every flash of the remote.",
  D3: "Joystick button. D3 is interrupt INT1: a press is caught even while the LCD is busy.",
  D4: "Stepper coil IN1. D4 to D7 are bits 4 to 7 of one register (PORTD), so one write moves all four coils.",
  D5: "Stepper coil IN2.", D6: "Stepper coil IN3.", D7: "Stepper coil IN4.",
  D8: "74HC595 latch (pin 12). A rising edge copies the 8 shifted bits to the outputs.",
  D9: "Servo signal. The Servo library drives it with Timer1.",
  D10: "RC522 select (SDA). LOW means \"RFID, listen\"; the 595 ignores this line.",
  D11: "SPI data out (MOSI). Shared: goes to the RC522 MOSI and the 595 data pin 14.",
  D12: "SPI data in (MISO). Only the RC522 talks back.",
  D13: "SPI clock (SCK). Shared: RC522 SCK and 595 clock pin 11.",
  A0: "Joystick left/right (VRx).", A1: "Joystick up/down (VRy).",
  A2: "Light: the photoresistor + 10K divider.", A3: "Water sensor.",
  A4: "Sound sensor (KY-037 analog out). Read every loop to catch claps.",
  A5: "DHT11 data. An analog pin used as a plain digital pin.",
  "5V": "Feeds the + rail of the breadboard. Every part's + goes there (except the RC522).",
  "3V3": "Only for the RC522 (VCC and RST). 5V would damage it.",
  GND: "Feeds the − rail. Every part's − / GND goes there.",
};

// ---- The parts ----------------------------------------------------------------------

// Box [x, y, w, h], pins with absolute positions, power hookup as text, and a
// short note. Colours are wire colours.
const PARTS = [
  { id: "lcd", name: "LCD1602", box: [20, 20, 310, 75], color: "#4cc9ff",
    pins: { RS: [200, 95], E: [220, 95], D4: [240, 95], D5: [260, 95], D6: [280, 95], D7: [300, 95] },
    power: ["1 VSS, 5 RW, 16 K → GND", "2 VDD → 5V", "15 A → 5V through 220Ω", "3 V0 → pot middle leg (pot ends: 5V, GND)", "7–10 empty"],
    note: "The screen. It is driven entirely by the 74HC595, so it costs the Uno zero extra pins. Pins count 1 to 16 from the left. If you see nothing, turn the pot: it sets the contrast." },
  { id: "sr", name: "74HC595", box: [180, 125, 140, 75], color: "#ffd166",
    pins: { Q0: [200, 125], Q1: [220, 125], Q2: [240, 125], Q3: [260, 125], Q4: [280, 125], Q5: [300, 125], Q6: [180, 150], Q7: [180, 180], "SH_CP 11": [200, 200], "DS 14": [240, 200], "ST_CP 12": [290, 200] },
    power: ["16 VCC, 10 MR → 5V", "8 GND, 13 OE → GND", "9 empty"],
    note: "Shift register: 3 wires in, 8 outputs out. The Uno clocks in 8 bits over SPI, pulses the latch, and Q0–Q7 change together. Notch to the left: pin 1 is bottom-left, pin 16 top-left." },
  { id: "rfid", name: "RC522 RFID", box: [355, 125, 137, 75], color: "#c792ea", vlabels: true,
    pins: { SCK: [432, 200], MISO: [450, 200], MOSI: [468, 200], SDA: [486, 200] },
    power: ["3.3V and RST → Uno 3.3V (never 5V)", "GND → GND", "IRQ empty"],
    note: "Reads cards by their ID. It shares the SPI clock and data with the 595; its own select line (SDA on D10) says when it is the one listening." },
  { id: "servo", name: "Servo SG90", box: [498, 125, 94, 70], color: "#ff9f43",
    pins: { SIG: [504, 195] },
    power: ["red → 5V", "brown → GND"],
    note: "The head that nods while the AI thinks. It is switched off (detached) when still, to stop buzzing and save power." },
  { id: "step", name: "Stepper + ULN2003", box: [600, 125, 170, 75], color: "#06d6a0",
    pins: { IN4: [620, 200], IN3: [640, 200], IN2: [660, 200], IN1: [680, 200] },
    power: ["board + → 5V", "board − → GND", "motor plugs into the board"],
    note: "Turns the head left and right. 4096 half-steps = one turn. The ULN2003 board carries the coil current the Uno can't." },
  { id: "ir", name: "IR receiver", box: [800, 140, 160, 60], color: "#ff6b6b",
    pins: { S: [830, 200] },
    power: ["+ → 5V", "− → GND"],
    note: "The remote is the keyboard: 21 keys on one pin. Check the letters printed on your module, layouts differ." },
  { id: "joy", name: "Joystick", box: [140, 480, 170, 70], color: "#f78fb3",
    pins: { VRx: [260, 480], VRy: [285, 480], SW: [220, 550] },
    power: ["+5V → 5V", "GND → GND"],
    note: "Left/right flips screens, up/down scrolls, press = OK. The press uses interrupt INT1 on D3." },
  { id: "light", name: "Light (LDR)", box: [340, 480, 90, 70], color: "#ffe066",
    pins: { leg: [400, 480] },
    power: ["other leg → 5V", "10K from A2 → GND"],
    note: "Light level. With the 10K resistor it forms a divider: more light, higher voltage on A2." },
  { id: "water", name: "Water", box: [445, 480, 90, 70], color: "#4dabf7",
    pins: { S: [505, 480] },
    power: ["+ → 5V", "− → GND"],
    note: "Water level on the sensor's stripes. 0–100% on the Sensors screen." },
  { id: "sound", name: "KY-037", box: [550, 480, 90, 70], color: "#a9e34b",
    pins: { A0: [628, 480] },
    power: ["+ → 5V", "G → GND"],
    note: "Sound. Clap and Mini Yaver says \"Yes, sir?\". Turn its blue screw until a clap triggers it." },
  { id: "dht", name: "DHT11", box: [655, 480, 90, 70], color: "#66d9e8",
    pins: { S: [700, 480] },
    power: ["+ → 5V", "− → GND"],
    note: "Temperature and humidity on one wire. Reading it stops interrupts for about 4 ms, the one place two parts fight over time." },
  { id: "relay", name: "Relay", box: [20, 130, 120, 55], color: "#ff8787",
    pins: { S: [140, 150] },
    power: ["+ → 5V", "− → GND", "low-voltage lamp only, never 220V"],
    note: "A switch for a lamp, driven by 595 output Q6. Only switch low-voltage things." },
  { id: "buzz", name: "Active buzzer", box: [20, 200, 120, 50], color: "#e599f7",
    pins: { "+": [140, 225] },
    power: ["+ via 220Ω (on the Q7 wire)", "− → GND"],
    note: "The one with the sticker. The 220Ω resistor keeps the 595's output safe." },
  { id: "mac", name: "Mac (USB)", box: [20, 290, 150, 60], color: "#adb5bd",
    pins: {},
    power: ["USB cable", "runs mini_yaver_bridge.py"],
    note: "The Uno has no internet. The Mac script asks the AI and sends the answer back over USB (D0/D1)." },
];
const PART = Object.fromEntries(PARTS.map((p) => [p.id, p]));

// Every signal wire. `via` is the y of the horizontal run (or a full point list).
const WIRES = [
  { from: "D13", to: "rfid.SCK" },
  { from: "D12", to: "rfid.MISO" },
  { from: "D11", to: "rfid.MOSI" },
  { from: "D10", to: "rfid.SDA" },
  { from: "D13", to: "sr.SH_CP 11", via: 248 },
  { from: "D11", to: "sr.DS 14", via: 240 },
  { from: "D8", to: "sr.ST_CP 12", via: 232 },
  { from: "sr.Q0", to: "lcd.RS" }, { from: "sr.Q1", to: "lcd.E" }, { from: "sr.Q2", to: "lcd.D4" },
  { from: "sr.Q3", to: "lcd.D5" }, { from: "sr.Q4", to: "lcd.D6" }, { from: "sr.Q5", to: "lcd.D7" },
  { from: "sr.Q6", to: "relay.S" },
  { from: "sr.Q7", to: "buzz.+", pts: [[180, 180], [160, 180], [160, 225], [140, 225]], note: "220Ω on this wire" },
  { from: "D9", to: "servo.SIG" },
  { from: "D7", to: "step.IN4", via: 212 }, { from: "D6", to: "step.IN3", via: 220 },
  { from: "D5", to: "step.IN2", via: 228 }, { from: "D4", to: "step.IN1", via: 236 },
  { from: "D2", to: "ir.S", via: 244 },
  { from: "D3", to: "joy.SW", pts: [[612, 268], [612, 252], [785, 252], [785, 585], [220, 585], [220, 550]] },
  { from: "A0", to: "joy.VRx", via: 440 }, { from: "A1", to: "joy.VRy", via: 450 },
  { from: "A2", to: "light.leg", via: 460 }, { from: "A3", to: "water.S", via: 468 },
  { from: "A4", to: "sound.A0" }, { from: "A5", to: "dht.S", via: 465 },
];

function point(ref) {
  if (PIN[ref]) return PIN[ref];
  const [id, pin] = ref.split(/\.(.+)/);
  return PART[id].pins[pin];
}
function partOf(ref) { return PIN[ref] ? null : ref.split(".")[0]; }
for (const w of WIRES) {
  w.part = partOf(w.to);
  w.src = partOf(w.from);
  const a = point(w.from), b = point(w.to);
  w.points = w.pts ?? (a[0] === b[0] ? [a, b] : w.via != null ? [a, [a[0], w.via], [b[0], w.via], b] : [a, b]);
}

// ---- The build, step by step ---------------------------------------------------------

const STEPS = [
  { title: "Power rails first", parts: [], power: true,
    text: "Run the Uno's <b>5V</b> to the breadboard's red <b>+</b> rail and <b>GND</b> to the blue <b>−</b> rail. From now on, every \"5V\" and \"GND\" means those rails. Only the RFID reader uses the separate <b>3.3V</b> pin.",
    check: ["Uno 5V → + rail", "Uno GND → − rail"] },
  { title: "74HC595: 3 wires, 8 outputs", parts: ["sr"],
    text: "This chip is why everything fits. Put it across the breadboard's middle gap, notch to the left. The Uno sends it 8 bits on <b>D11</b> (data) and <b>D13</b> (clock), then a pulse on <b>D8</b> (latch) makes all 8 outputs change at once.",
    check: ["16 VCC and 10 MR → 5V", "8 GND and 13 OE → GND", "14 DS → D11", "11 SH_CP → D13", "12 ST_CP → D8"] },
  { title: "The LCD screen", parts: ["lcd"],
    text: "The LCD takes six of the 595's outputs: <b>Q0 → RS</b>, <b>Q1 → E</b>, <b>Q2–Q5 → D4–D7</b>. It talks in 4-bit halves, so D0–D3 stay empty. The pot sets the contrast. Upload now and turn it until you see letters: test early, before more wires hide a mistake.",
    check: ["VSS, RW, K → GND; VDD → 5V", "V0 → pot middle (pot ends 5V, GND)", "A → 5V through 220Ω", "RS ← Q0, E ← Q1", "D4–D7 ← Q2–Q5"] },
  { title: "RFID reader on the same bus", parts: ["rfid"],
    text: "The RC522 <b>shares</b> clock (D13) and data (D11) with the 595. That's an SPI bus: many chips, one clock. Each chip has its own select line; the RC522's is <b>D10</b>. It runs on <b>3.3V only</b>.",
    check: ["3.3V and RST → Uno 3.3V", "GND → GND", "SDA → D10, SCK → D13", "MOSI → D11, MISO → D12"] },
  { title: "Inputs: remote and joystick", parts: ["ir", "joy"],
    text: "The IR remote replaces the 4×4 keypad: 21 keys on <b>one</b> pin (D2) instead of 8. The joystick reads two analog axes on <b>A0/A1</b> and its button on <b>D3</b>, the second interrupt pin.",
    check: ["IR S → D2", "Joystick VRx → A0, VRy → A1", "Joystick SW → D3", "+ and − of both → rails"] },
  { title: "Motion: servo and stepper", parts: ["servo", "step"],
    text: "Servo signal on <b>D9</b>. The stepper's four coils go through the ULN2003 board on <b>D4–D7</b>, which are one register, so the code moves all four in one write. USB can't power both motors at once, so the code moves only one at a time.",
    check: ["Servo orange → D9, red → 5V, brown → GND", "Motor plugged into the ULN2003", "IN1–IN4 → D4–D7", "Board + → 5V, − → GND"] },
  { title: "Sensors on the analog pins", parts: ["light", "water", "sound", "dht"],
    text: "Light on <b>A2</b> (with a 10K to GND), water on <b>A3</b>, sound on <b>A4</b>, DHT11 on <b>A5</b>. That uses A4/A5, the I2C pins, so the Uno has no I2C left: one of the limits this project hits on purpose.",
    check: ["Photoresistor: 5V → leg → A2, 10K A2 → GND", "Water S → A3", "KY-037 A0 → A4", "DHT11 S → A5"] },
  { title: "Relay and buzzer: the last 595 outputs", parts: ["relay", "buzz"],
    text: "<b>Q6 → relay</b> and <b>Q7 → buzzer</b> (through 220Ω). All 8 outputs and all 20 Uno pins are now used. Plug in USB, start the Mac bridge, and the LCD switches from \"off\" to the clock.",
    check: ["Relay S ← Q6", "Buzzer + ← Q7 via 220Ω, − → GND", "USB to the Mac"] },
];

// ---- The code tour -------------------------------------------------------------------

// Each section is cut from the real file between two lines (`from` is
// included, `to` is not). Each note's `hl` lists text whose lines light up.
const SECTIONS = [
  { title: "Names for every pin", file: "ino", from: "// ---------------------------------------------------------------- pin map", to: "const bool RELAY_ACTIVE_HIGH",
    notes: [
      { t: "Pins get names once, at the top. The rest of the code says <code>PIN_SERVO</code>, never 9, so rewiring means changing one line.", hl: ["PIN_SERVO", "PIN_IR "] },
      { t: "D4–D7 have no names: the stepper writes them all at once through the <code>PORTD</code> register.", hl: ["D4..D7"] },
      { t: "The 595's outputs are bits of one byte. <code>0x40</code> is bit 6 (Q6, relay), <code>0x80</code> is bit 7 (Q7, buzzer).", hl: ["SR_RELAY", "SR_BUZZ", "SR_RS", "SR_E "] },
    ] },
  { title: "loop(): never wait", file: "ino", from: "void loop() {", to: null,
    notes: [
      { t: "Every part gets a quick turn, every loop. Nothing calls <code>delay()</code>, so a remote press is never missed while the motor turns.", hl: ["pollSerial();", "pollIr();", "pollJoystick", "pollRfid", "serviceStepper", "serviceServo", "serviceBeeper"] },
      { t: "Slow jobs use a timestamp: <code>now - tSensors >= 250</code> means \"if 250 ms have passed\". That's how you do many things at different speeds.", hl: ["tSensors >= 250", "tDht >= 2000", "tReport >= 5000", "tLog >= LOG_EVERY_MS"] },
      { t: "The DHT11 waits while the stepper moves: the sensor turns interrupts off, which would make the motor stutter.", hl: ["!stepperBusy"] },
      { t: "The loop times itself. The STATS screen shows loops per second and the slowest loop, so you can watch the Uno get busy.", hl: ["loopCount++", "maxLoopUs"] },
    ] },
  { title: "LCD through the 74HC595", file: "ino", from: "void srWrite(uint8_t bits) {", to: "void lcdInit() {",
    notes: [
      { t: "<code>srWrite</code> shifts 8 bits out over SPI, then a HIGH-LOW on the latch makes Q0–Q7 change together.", hl: ["SPI.transfer(bits)", "PIN_LATCH, HIGH", "PIN_LATCH, LOW"] },
      { t: "The LCD takes 4 bits at a time. They sit on Q2–Q5, hence <code>&lt;&lt; 2</code>. RS says \"letter\" or \"command\".", hl: ["(n & 0x0F) << 2"] },
      { t: "The relay and buzzer bits are kept as they were, so writing to the LCD never clicks the lamp off.", hl: ["srBits & (SR_RELAY | SR_BUZZ)"] },
      { t: "E high then low: the LCD reads the 4 bits on the falling edge. One byte = two halves.", hl: ["srWrite(b | SR_E)", "srWrite(b);", "lcdNibble(v >> 4", "lcdNibble(v, rs)"] },
    ] },
  { title: "Stepper in one write", file: "ino", from: "// ---- stepper: non-blocking", to: "int16_t panDeg()",
    notes: [
      { t: "8 coil patterns, one per half-step. <code>0x3</code> means coils 1 and 2 on together.", hl: ["halfSteps[8]"] },
      { t: "One half-step per call, only when <code>STEP_US</code> has passed. The loop keeps running between steps.", hl: ["< STEP_US"] },
      { t: "The power rule: if the servo is on, the stepper waits (USB gives only 500 mA).", hl: ["head.attached()) return"] },
      { t: "The trick: D4–D7 are the top 4 bits of <code>PORTD</code>. One line sets all four coils; <code>&amp; 0x0F</code> keeps D0–D3 (USB, IR, button) untouched.", hl: ["PORTD = (PORTD & 0x0F)", "PORTD &= 0x0F"] },
      { t: "<code>panTo</code> just sets a target in steps. 4096 steps = 360°.", hl: ["stepTarget = (int32_t)deg"] },
    ] },
  { title: "Talking to the Mac", file: "ino", from: "void handleLine(char* line) {", to: "void reportStatus() {",
    notes: [
      { t: "Each line from the Mac starts with two letters: <code>AB</code> answer begins, <code>A </code> a piece of it, <code>AE</code> answer done.", hl: ["'A' && line[1] == 'B'", "'A' && line[1] == ' '", "'A' && line[1] == 'E'"] },
      { t: "Other commands move the hardware: <code>RL</code> relay, <code>PN</code> pan, <code>ND</code> nod, <code>BP</code> beep. That's how the AI switches the lamp.", hl: ["PSTR(\"RL\")", "PSTR(\"PN\")", "PSTR(\"ND\")", "PSTR(\"BP\")"] },
      { t: "After every line the Uno answers <code>K</code>. The Uno only buffers 64 bytes, so the Mac waits for K before sending more. Without it, letters get lost.", hl: ["Serial.println('K')"] },
      { t: "<code>pollSerial</code> collects letters until a newline, then hands over the whole line.", hl: ["if (c == '\\n')"] },
    ] },
  { title: "RFID cards remembered in EEPROM", file: "ino", from: "void pollRfid(uint32_t now) {", to: "// ================================================================= serial from the Mac",
    notes: [
      { t: "Check for a card only every 150 ms: the reader is slow and the loop has other work.", hl: ["now - tRfid < 150"] },
      { t: "The same card held still is ignored for 1.5 s, so one tap is one question.", hl: ["now - lastCardMs < 1500"] },
      { t: "A known card: read its saved digit from EEPROM and ask that question.", hl: ["EEPROM.read(EE_CARDS", "ask(action)"] },
      { t: "A new card: remember it and wait for a digit on the remote. EEPROM keeps it after power-off; 16 cards fit.", hl: ["pendingBindSlot = freeSlot", "Card memory full"] },
    ] },
  { title: "The Mac bridge (Python)", file: "py", from: "def answer(uno, key, prompt):", to: "# ------------------------------------------------------------------ main",
    notes: [
      { t: "<code>TH</code> first: the Uno shows the thinking face and nods while the AI works.", hl: ["uno.send(\"TH\")"] },
      { t: "Ask Gemini with the live sensor readings, so \"how is my room?\" gets a real answer.", hl: ["reply = ask_ai("] },
      { t: "The AI can add tags like <code>[LAMP ON]</code>. The bridge turns them into commands and strips them from the text.", hl: ["run_tags(reply, uno)"] },
      { t: "Cut to what fits in the Uno's 640-letter buffer, then send it in 40-letter pieces between <code>AB</code> and <code>AE</code>. Each <code>send</code> waits for the Uno's K.", hl: ["uno.cap", "uno.send(\"AB\")", "uno.send(\"A \" + text", "uno.send(\"AE\")"] },
    ] },
];

// ---- The view --------------------------------------------------------------------------

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pathOf = (pts) => "M" + pts.map((p) => p.join(" ")).join(" L");

function loadSet(key) { try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); } }
function saveSet(key, set) { try { localStorage.setItem(key, JSON.stringify([...set])); } catch {} }

export class MiniYaver {
  constructor(root) {
    this.el = document.createElement("section");
    this.el.className = "hud ac-panel my-tut";
    this.el.hidden = true;
    root.appendChild(this.el);
    this.tab = "wiring";
    this.step = 0;
    this.focus = null;          // { part } or { pin } clicked in the diagram
    this.section = 0;
    this.note = null;
    this.checked = loadSet("yaver-miniyaver-wired");
    this.files = {};
    this.el.addEventListener("click", (e) => this.click(e));
    this.el.addEventListener("change", (e) => {
      const box = e.target.closest("[data-check]");
      if (!box) return;
      box.checked ? this.checked.add(box.dataset.check) : this.checked.delete(box.dataset.check);
      saveSet("yaver-miniyaver-wired", this.checked);
      this.renderSteps();
    });
  }

  open(tab = "wiring") {
    this.tab = tab === "code" || tab === "wires" ? tab : "wiring";
    this.el.hidden = false;
    this.render();
  }
  close() { this.el.hidden = true; }
  get isOpen() { return !this.el.hidden; }

  describe() {
    if (this.tab === "wires") return "He is in the Mini Yaver tutorial (his Arduino Uno desk AI), on the numbered wire list: every jumper with its from pin, to pin, colour and breadboard hole.";
    if (this.tab === "code") return `He is in the Mini Yaver tutorial (his Arduino Uno desk AI), on the code tour: "${SECTIONS[this.section].title}".`;
    return `He is in the Mini Yaver tutorial (his Arduino Uno desk AI), wiring step ${this.step + 1} of ${STEPS.length}: "${STEPS[this.step].title}".`;
  }
  next() { if (this.tab === "wires") return; this.tab === "code" ? this.goSection(this.section + 1) : this.goStep(this.step + 1); }
  prev() { if (this.tab === "wires") return; this.tab === "code" ? this.goSection(this.section - 1) : this.goStep(this.step - 1); }
  goStep(i) { this.step = Math.max(0, Math.min(i, STEPS.length - 1)); this.focus = null; this.renderWiring(); }
  goSection(i) { this.section = Math.max(0, Math.min(i, SECTIONS.length - 1)); this.note = null; this.renderCode(); }
  setTab(tab) { this.tab = tab; this.render(); }

  click(e) {
    const t = e.target.closest("[data-my]");
    if (!t) return;
    const [act, arg] = t.dataset.my.split(":");
    if (act === "tab") this.setTab(arg);
    else if (act === "wv") { this.wireView = arg; this.renderWires(); }
    else if (act === "print") window.print();
    else if (act === "step") this.goStep(Number(arg));
    else if (act === "next") this.next();
    else if (act === "prev") this.prev();
    else if (act === "part") { this.focus = this.focus?.part === arg ? null : { part: arg }; this.renderWiring(); }
    else if (act === "pin") { this.focus = this.focus?.pin === arg ? null : { pin: arg }; this.renderWiring(); }
    else if (act === "all") { this.focus = { all: true }; this.renderWiring(); }
    else if (act === "sec") this.goSection(Number(arg));
    else if (act === "note") { this.note = this.note === Number(arg) ? null : Number(arg); this.renderCode(); }
  }

  render() {
    this.el.innerHTML = `
      <div class="my-head">
        <div><h1>Mini Yaver</h1><p class="ac-lead">Your Uno as a desk AI: ask with the remote or a card, the Mac asks the AI, the answer scrolls on the LCD. 18 parts, all 20 pins.</p></div>
        <div class="my-tabs" role="tablist">
          <a class="ac-btn" href="#academy/mini-yaver/3d">1 · 3D build</a>
          <button class="ac-btn ${this.tab === "wires" ? "primary" : ""}" data-my="tab:wires" role="tab">📋 Wire list</button>
          <button class="ac-btn ${this.tab === "wiring" ? "primary" : ""}" data-my="tab:wiring" role="tab">Wiring map</button>
          <button class="ac-btn ${this.tab === "code" ? "primary" : ""}" data-my="tab:code" role="tab">2 · Code</button>
          <a class="ac-btn ghost" href="${FILES_URL}MiniYaver/MiniYaver.ino" download>⬇ Sketch</a>
          <a class="ac-btn ghost" href="${FILES_URL}mini_yaver_bridge.py" download>⬇ Mac bridge</a>
        </div>
      </div>
      <div class="my-body"></div>`;
    this.body = this.el.querySelector(".my-body");
    this.tab === "code" ? this.renderCode() : this.tab === "wires" ? this.renderWires() : this.renderWiring();
  }

  // ---- Wire list: a chart where no lines cross, and the build spec ----

  renderWires() {
    if (this.tab !== "wires" || !this.body) return;
    this.body.className = "my-body my-wires";
    this.body.innerHTML = `<div class="my-sub">
        <button class="ac-btn ${this.wireView === "chart" ? "" : "primary"}" data-my="wv:list">Wire list</button>
        <button class="ac-btn ${this.wireView === "chart" ? "primary" : ""}" data-my="wv:chart">Pin chart</button>
        <a class="ac-btn ghost" href="#academy/mini-yaver/3d">See it in 3D</a>
      </div>
      <div class="my-wirebody" data-hand-scroll>${this.wireView === "chart" ? chartHTML() : specHTML()}</div>`;
  }

  // ---- Wiring ----

  // Which parts and pins are lit: the clicked one, or the current step's
  // parts plus everything built before it.
  lit() {
    const f = this.focus;
    const builtParts = new Set(STEPS.slice(0, this.step + 1).flatMap((s) => s.parts));
    builtParts.add("mac");
    if (f?.all) return { parts: new Set(PARTS.map((p) => p.id)), now: new Set(), built: new Set(PARTS.map((p) => p.id)) };
    if (f?.part) return { parts: new Set([f.part]), now: new Set([f.part]), built: new Set([...builtParts, f.part, ...WIRES.filter((w) => w.part === f.part || w.src === f.part).flatMap((w) => [w.part, w.src].filter(Boolean))]) };
    if (f?.pin) {
      const parts = new Set(WIRES.filter((w) => w.from === f.pin).map((w) => w.part));
      return { parts, now: parts, built: new Set([...builtParts, ...parts, ...WIRES.filter((w) => parts.has(w.part) && w.src).map((w) => w.src)]), pin: f.pin };
    }
    const now = new Set(STEPS[this.step].parts);
    return { parts: now, now, built: builtParts };
  }

  svg() {
    const L = this.lit();
    const f = this.focus;
    const wireOn = (w) => (f?.all ? true : f?.pin ? w.from === f.pin : L.now.has(w.part));
    const wireBuilt = (w) => L.built.has(w.part) && (!w.src || L.built.has(w.src));
    const usedPins = new Set(WIRES.map((w) => w.from));
    const step = STEPS[this.step];
    const powerOn = f?.all || (!f && step.power);
    const wires = WIRES.filter(wireBuilt).sort((a, b) => wireOn(a) - wireOn(b)).map((w) => {
      const color = PART[w.part].color;
      const on = wireOn(w);
      return `<path class="my-wire ${on ? "on" : ""}" d="${pathOf(w.points)}" stroke="${color}"/>${on ? w.points.slice(-1).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`).join("") : ""}`;
    }).join("");
    const parts = PARTS.map((p) => {
      const [x, y, w, h] = p.box;
      const on = L.parts.has(p.id), built = L.built.has(p.id);
      const pins = Object.entries(p.pins).map(([n, [px, py]]) => {
        const lx = px === x ? px + 5 : px === x + w ? px - 5 : px;
        const ly = py === y ? py + 11 : py === y + h ? py - 5 : py + 3;
        const anchor = px === x ? "start" : px === x + w ? "end" : "middle";
        const label = esc(n.split(" ")[0]);
        if (p.vlabels) return `<rect x="${px - 3}" y="${py - 3}" width="6" height="6" rx="1" fill="${p.color}"/><text class="my-pinlbl" transform="translate(${px + 3} ${py - 6}) rotate(-90)" text-anchor="start">${label}</text>`;
        return `<rect x="${px - 3}" y="${py - 3}" width="6" height="6" rx="1" fill="${p.color}"/><text class="my-pinlbl" x="${lx}" y="${ly}" text-anchor="${anchor}">${label}</text>`;
      }).join("");
      return `<g class="my-part ${on ? "on" : ""} ${built ? "" : "ghost"}" data-my="part:${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" stroke="${p.color}"/>
        <text class="my-name" x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${esc(p.name)}</text>${pins}</g>`;
    }).join("");
    const unoPins = Object.entries(PIN).map(([n, [x, y]]) => {
      const top = y < 300;
      const state = n === "D0" || n === "D1" ? "usb" : usedPins.has(n) || ["5V", "GND", "3V3"].includes(n) ? "used" : "";
      const hot = L.pin === n || (powerOn && (n === "5V" || n === "GND")) || (!f?.all && WIRES.some((w) => w.from === n && wireOn(w)));
      return `<g class="my-pin ${state} ${hot ? "hot" : ""}" data-my="pin:${n}" role="button" aria-label="Pin ${n}">
        <rect class="my-hit" x="${x - 9}" y="${top ? y - 9 : y - 22}" width="18" height="31"/>
        <rect x="${x - 6}" y="${y - 6}" width="12" height="12" rx="2"/>
        <text x="${x}" y="${top ? y + 20 : y - 12}" text-anchor="middle">${n.replace(/^D/, "")}</text></g>`;
    }).join("");
    return `<svg class="my-svg" viewBox="0 0 1000 640" role="img" aria-label="Mini Yaver wiring diagram">
      <g class="my-rails ${powerOn ? "on" : ""}">
        <line x1="20" y1="605" x2="980" y2="605" stroke="#ff6b6b"/><line x1="20" y1="620" x2="980" y2="620" stroke="#4dabf7"/>
        <text x="975" y="600" text-anchor="end">+ rail (5V)</text><text x="975" y="635" text-anchor="end">− rail (GND)</text>
        <path d="M402 428 L402 605" stroke="#ff6b6b"/><path d="M424 428 L424 620" stroke="#4dabf7"/>
      </g>
      <g class="my-uno">
        <rect x="330" y="255" width="360" height="180" rx="10"/>
        <rect class="my-usb" x="318" y="285" width="24" height="34" rx="3"/>
        <path class="my-cable" d="M318 302 L170 320"/>
        <text class="my-uno-name" x="520" y="355" text-anchor="middle">ARDUINO UNO</text>
        <text class="my-uno-sub" x="520" y="374" text-anchor="middle">click any pin</text>
        <text class="my-uno-sub" x="660" y="300" text-anchor="middle">USB</text>
        <text class="my-uno-sub" x="595" y="392" text-anchor="middle">ANALOG IN</text>
        <text class="my-uno-sub" x="402" y="392" text-anchor="middle">POWER</text>
      </g>
      ${wires}${parts}${unoPins}
      <text class="my-note" x="150" y="207" text-anchor="middle">220Ω</text>
    </svg>`;
  }

  info() {
    const f = this.focus;
    if (f?.part) {
      const p = PART[f.part];
      const conns = WIRES.filter((w) => w.part === p.id || w.src === p.id).map((w) => {
        const [a, b] = w.part === p.id ? [w.to.split(".")[1], w.from] : [w.from.split(".")[1], w.to];
        return `<li><b>${esc(a)}</b> → ${esc(b.replace("sr.", "595 ").replace(/^(\w+)\./, (m, id) => `${PART[id].name} `))}${w.note ? ` <small>(${esc(w.note)})</small>` : ""}</li>`;
      }).join("");
      return `<h3>${esc(p.name)}</h3><p>${esc(p.note)}</p>
        <ul class="my-list">${conns}${p.power.map((t) => `<li class="my-pwr">${esc(t)}</li>`).join("")}</ul>
        <button class="ac-btn ghost" data-my="part:${p.id}">✕ Back to step ${this.step + 1}</button>`;
    }
    if (f?.pin) {
      const goes = WIRES.filter((w) => w.from === f.pin).map((w) => `<li>${esc(PART[w.part].name)} · <b>${esc(w.to.split(".")[1])}</b></li>`).join("");
      return `<h3>Pin ${esc(f.pin)}</h3><p>${esc(PIN_NOTE[f.pin] ?? "")}</p>${goes ? `<ul class="my-list">${goes}</ul>` : ""}
        <button class="ac-btn ghost" data-my="pin:${f.pin}">✕ Back to step ${this.step + 1}</button>`;
    }
    if (f?.all) return `<h3>Everything wired</h3><p>All 28 signal wires. Click a part or a pin to follow its wires.</p><button class="ac-btn ghost" data-my="step:${this.step}">✕ Back to step ${this.step + 1}</button>`;
    return null;
  }

  renderWiring() {
    if (this.tab !== "wiring" || !this.body) return;
    this.body.className = "my-body my-wiring";
    this.body.innerHTML = `<div class="my-diagram">${this.svg()}</div><div class="my-side" data-hand-scroll></div>`;
    this.renderSteps();
  }

  renderSteps() {
    const side = this.body?.querySelector(".my-side");
    if (!side) return;
    const s = STEPS[this.step];
    const info = this.info();
    const done = (st, i) => st.check.every((c) => this.checked.has(`${i}:${c}`));
    side.innerHTML = `
      <div class="my-steps">${STEPS.map((st, i) => `<button class="my-stepdot ${i === this.step ? "on" : ""} ${done(st, i) ? "done" : ""}" data-my="step:${i}" title="${esc(st.title)}">${done(st, i) ? "✓" : i + 1}</button>`).join("")}</div>
      ${info ? `<div class="my-info">${info}</div>` : `
        <h2><span>Step ${this.step + 1} of ${STEPS.length}</span>${esc(s.title)}</h2>
        <p>${s.text}</p>
        <ul class="my-checks">${s.check.map((c) => { const k = `${this.step}:${c}`; return `<li><label><input type="checkbox" data-check="${esc(k)}" ${this.checked.has(k) ? "checked" : ""}> ${esc(c)}</label></li>`; }).join("")}</ul>
        <p class="tip">Click a part or an Uno pin in the diagram to see where it goes and why.</p>`}
      <nav class="ac-nav">
        <button class="ac-btn" data-my="prev" ${this.step === 0 ? "disabled" : ""}>◀ Back</button>
        <button class="ac-btn ghost" data-my="all">Show all</button>
        ${this.step < STEPS.length - 1 ? `<button class="ac-btn primary" data-my="next">Next ▶</button>` : `<button class="ac-btn primary" data-my="tab:code">The code ▶</button>`}
      </nav>`;
  }

  // ---- Code ----

  async file(kind) {
    if (!this.files[kind]) {
      const url = kind === "py" ? BRIDGE_URL : SKETCH_URL;
      this.files[kind] = fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }).then((t) => t.split("\n"));
      this.files[kind].catch(() => { delete this.files[kind]; });
    }
    return this.files[kind];
  }

  async renderCode() {
    if (this.tab !== "code" || !this.body) return;
    const sec = SECTIONS[this.section];
    this.body.className = "my-body my-code";
    this.body.innerHTML = `
      <div class="my-main">
        <div class="my-secs">${SECTIONS.map((s, i) => `<button class="my-sec ${i === this.section ? "on" : ""}" data-my="sec:${i}"><b>${i + 1}</b>${esc(s.title)}</button>`).join("")}</div>
        <pre class="my-src" data-hand-scroll><span class="code-line">Loading the code…</span></pre>
      </div>
      <div class="my-side" data-hand-scroll>
        <h2><span>${sec.file === "py" ? "mini_yaver_bridge.py · on the Mac" : "MiniYaver.ino · on the Uno"}</span>${esc(sec.title)}</h2>
        <p class="tip">Click a note to light up its lines.</p>
        <ol class="my-notes">${sec.notes.map((n, i) => `<li class="${this.note === i ? "on" : ""}" data-my="note:${i}" role="button" tabindex="0">${n.t}</li>`).join("")}</ol>
        <nav class="ac-nav">
          <button class="ac-btn" data-my="prev" ${this.section === 0 ? "disabled" : ""}>◀ Back</button>
          ${this.section < SECTIONS.length - 1 ? `<button class="ac-btn primary" data-my="next">Next ▶</button>` : `<button class="ac-btn primary" data-my="tab:wiring">Wiring ▶</button>`}
        </nav>
      </div>`;
    const pre = this.body.querySelector(".my-src");
    let lines;
    try { lines = await this.file(sec.file); }
    catch (err) { pre.textContent = `Couldn't load the code (${err.message}). Check the connection and try again.`; return; }
    if (this.tab !== "code" || SECTIONS[this.section] !== sec || !pre.isConnected) return;
    const start = lines.findIndex((l) => l.startsWith(sec.from));
    let end = sec.to ? lines.findIndex((l, i) => i > start && l.startsWith(sec.to)) : -1;
    if (end < 0) end = sec.to ? start + 40 : lines.length;
    while (end > start + 1 && !lines[end - 1].trim()) end--;
    const marks = (i) => sec.notes.map((n, k) => (n.hl.some((h) => lines[i].includes(h)) ? k : -1)).filter((k) => k >= 0);
    pre.innerHTML = lines.slice(start, end).map((l, j) => {
      const i = start + j, m = marks(i);
      const hot = this.note != null ? m.includes(this.note) : m.length > 0;
      const cls = this.note != null ? (hot ? "hot" : "dim") : hot ? "mark" : "";
      return `<span class="my-ln ${cls}" data-note="${m[0] ?? ""}"><i>${i + 1}</i>${esc(l) || " "}</span>`;
    }).join("");
    const hot = pre.querySelector(".hot");
    pre.scrollTop = hot ? Math.max(0, hot.offsetTop - pre.clientHeight / 3) : 0;
  }
}
