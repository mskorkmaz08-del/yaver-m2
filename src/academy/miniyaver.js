// The Mini Yaver tutorial: the Arduino Uno "desk AI" project from his kit,
// the lean version with five parts. Wiring: a clickable diagram of every
// wire, built up in six short steps. Code: the real sketch and the Chrome
// page that is Yaver's brain (fetched from /mini-yaver/), walked through
// section by section; each note lights up the lines it talks about. Plain
// HTML and SVG, no 3D, so every pin is readable.

import { chartHTML, specHTML } from "./miniyaver-chart.js?v=28";

const SKETCH_URL = new URL("../../mini-yaver/MiniYaver/MiniYaver.ino", import.meta.url).href;
const BRAIN_URL = new URL("../../mini-yaver/app.js", import.meta.url).href;
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
  D0: "USB to the Mac (receive). Wired inside the board to the USB chip, so nothing plugs in here.",
  D1: "USB to the Mac (send). Same as D0: taken by USB.",
  D2: "The talk button. The code turns on the Uno's built-in pull-up, so D2 reads HIGH, and LOW while you press.",
  D3: "The buzzer, and Yaver's voice. tone() plays notes on it; for speech, Timer2 pulses D3 62,500 times a second and the pulse width follows the voice.",
  D7: "LCD D7 (data bit 4 of 4).", D8: "LCD D6 (data bit 3 of 4).", D9: "LCD D5 (data bit 2 of 4).", D10: "LCD D4 (data bit 1 of 4).",
  D11: "LCD E (enable): a short pulse tells the LCD \"read the data pins now\".",
  D12: "LCD RS: HIGH means \"this is a letter\", LOW means \"this is a command\".",
  A0: "The sound sensor's loudness, read hundreds of times a second to catch a double clap.",
  "5V": "Feeds the + rail of the breadboard. Every part's + goes there.",
  GND: "Feeds the − rail. Every part's − / GND goes there.",
};

// ---- The parts ----------------------------------------------------------------------

// Box [x, y, w, h], pins with absolute positions, power hookup as text, and a
// short note. Colours are wire colours.
const PARTS = [
  { id: "lcd", name: "LCD1602 (Yaver's face)", box: [40, 30, 440, 80], color: "#4cc9ff",
    pins: { V0: [95, 110], RS: [200, 110], E: [230, 110], D4: [300, 110], D5: [330, 110], D6: [360, 110], D7: [390, 110] },
    power: ["1 VSS, 5 RW, 16 K → GND", "2 VDD → 5V", "15 A → 5V through 220Ω", "3 V0 → pot middle leg", "7–10 (D0–D3) empty"],
    note: "Yaver's face, clock, timers and the short answer. It talks in 4-bit halves on six wires. Pins count 1 to 16 from the left. If you see nothing, turn the pot: it sets the contrast." },
  { id: "pot", name: "10K pot", box: [40, 150, 110, 60], color: "#ff9f43",
    pins: { W: [95, 150] },
    power: ["outer legs → 5V and GND", "middle leg (W) → LCD V0"],
    note: "The LCD's contrast knob. Too far one way: empty screen. Too far the other: black boxes." },
  { id: "buzz", name: "Passive buzzer", box: [585, 120, 120, 70], color: "#c792ea",
    pins: { "+": [612, 190] },
    power: ["− → GND"],
    note: "The one without a sticker. Yaver's voice: the page streams the spoken answer to the Uno, 8000 numbers a second, and the buzzer plays it. tone() plays the beeps and alarm tunes." },
  { id: "btn", name: "Talk button", box: [740, 120, 140, 70], color: "#f78fb3",
    pins: { "1": [760, 190] },
    power: ["other side → GND"],
    note: "Short press: talk, or stop. Hold 1 s: the big night clock. While an alarm rings: press = stop, hold = snooze 5 minutes." },
  { id: "sound", name: "KY-037 sound (ears)", box: [470, 480, 150, 70], color: "#06d6a0",
    pins: { AO: [540, 480] },
    power: ["+ → 5V", "G → GND", "DO empty"],
    note: "Clap twice and Yaver listens. If it reacts to everything, or to nothing, turn the little screw on its blue box." },
  { id: "mac", name: "Mac + Chrome", box: [20, 290, 150, 60], color: "#adb5bd",
    pins: {},
    power: ["USB cable", "the Mini Yaver page in Chrome"],
    note: "The brain. The page hears you through the Mac's microphone, asks Gemini, and sends the answer over USB (D0/D1): the words for the LCD, then the voice for the buzzer." },
];
const PART = Object.fromEntries(PARTS.map((p) => [p.id, p]));

// Every signal wire. `via` is the y of the horizontal run (or a full point list).
// The LCD wires nest: the one furthest right runs highest, so none cross.
const WIRES = [
  { from: "D12", to: "lcd.RS", via: 240 }, { from: "D11", to: "lcd.E", via: 232 },
  { from: "D10", to: "lcd.D4", via: 224 }, { from: "D9", to: "lcd.D5", via: 216 },
  { from: "D8", to: "lcd.D6", via: 208 }, { from: "D7", to: "lcd.D7", via: 200 },
  { from: "pot.W", to: "lcd.V0" },
  { from: "D3", to: "buzz.+" },
  { from: "D2", to: "btn.1", via: 236 },
  { from: "A0", to: "sound.AO" },
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
    text: "Run the Uno's <b>5V</b> to the breadboard's red <b>+</b> rail and <b>GND</b> to the blue <b>−</b> rail. From now on, every \"5V\" and \"GND\" means those rails.",
    check: ["Uno 5V → + rail", "Uno GND → − rail"] },
  { title: "The LCD: power, contrast, light", parts: ["lcd", "pot"],
    text: "Put the LCD in the breadboard. Its power pins: <b>VSS, RW, K</b> to GND, <b>VDD</b> to 5V, and the backlight <b>A</b> to 5V through the <b>220Ω</b> resistor. The pot's middle leg goes to <b>V0</b>: it sets the contrast.",
    check: ["VSS, RW, K → GND; VDD → 5V", "A → 5V through 220Ω", "Pot outer legs → 5V and GND", "Pot middle → V0"] },
  { title: "The LCD's six data wires", parts: ["lcd"],
    text: "Six Uno pins in a row, <b>D12 to D7</b>: <b>RS, E, D4, D5, D6, D7</b>. The LCD's D0–D3 stay empty, because it takes 4 bits at a time. Upload now and turn the pot until you see Yaver's face: test early, before more wires hide a mistake.",
    check: ["RS ← D12, E ← D11", "D4 ← D10, D5 ← D9", "D6 ← D8, D7 ← D7"] },
  { title: "The talk button", parts: ["btn"],
    text: "One side to <b>D2</b>, the other to <b>GND</b>. No resistor: the code turns on the Uno's built-in pull-up, so the pin reads HIGH until you press.",
    check: ["Button side 1 → D2", "Button side 2 → GND"] },
  { title: "The buzzer", parts: ["buzz"],
    text: "The <b>passive</b> buzzer (no sticker on top): <b>+ → D3</b>, <b>− → GND</b>. It is Yaver's voice: unlike the active one (which only beeps at its own pitch), it moves however the Uno pushes it, so it can play any note and even speech. D3 matters: it is the pin the Uno's Timer2 can pulse fast enough for a voice.",
    check: ["Buzzer + → D3", "Buzzer − → GND"] },
  { title: "The ears, then the Mac", parts: ["sound"],
    text: "KY-037: <b>AO → A0</b>, <b>+ → 5V</b>, <b>G → GND</b>. Plug the USB cable into the Mac, open the <b>Mini Yaver page</b> in Chrome, click <b>Connect Uno</b>, and clap twice.",
    check: ["AO → A0", "+ → 5V, G → GND", "USB to the Mac, page open in Chrome"] },
];

// ---- The code tour -------------------------------------------------------------------

// Each section is cut from the real file between two lines (`from` is
// included, `to` is not). Each note's `hl` lists text whose lines light up.
const SECTIONS = [
  { title: "Names for every pin", file: "ino", from: "// ---------------------------------------------------------------- pins", to: "// ---------------------------------------------------------------- tunables",
    notes: [
      { t: "Pins get names once, at the top. The rest of the code says <code>PIN_BUZZER</code>, never 5, so rewiring means changing one line.", hl: ["PIN_BUZZER =", "PIN_BUTTON ="] },
      { t: "The LCD uses six pins in a row, D12 to D7. <code>LiquidCrystal</code> (built into the Arduino IDE) does the talking.", hl: ["PIN_LCD", "LiquidCrystal lcd("] },
      { t: "A0 is an analog pin: it reads how loud it is as a number from 0 to 1023.", hl: ["PIN_SOUND"] },
    ] },
  { title: "Faces from 8 custom letters", file: "ino", from: "void loadGlyphs(int16_t set) {", to: "// Word-wrap the answer",
    notes: [
      { t: "The LCD lets you draw 8 letters of your own, 5×8 dots each. A face is 4 letters wide and 2 high, so one face uses all 8.", hl: ["lcd.createChar(c, g)"] },
      { t: "The faces live in flash (<code>PROGMEM</code>), not in the 2 KB of RAM. <code>pgm_read_byte</code> reads them out.", hl: ["pgm_read_byte(&FACES"] },
      { t: "The night clock swaps in a different set: bars and a dot that build big digits.", hl: ["G_BIGFONT"] },
      { t: "<code>flush()</code> only sends the letters that changed, so blinking costs almost nothing.", hl: ["if (fb[r][c] != shown[r][c])"] },
    ] },
  { title: "loop(): never wait", file: "ino", from: "void loop() {", to: null,
    notes: [
      { t: "Every job gets a quick turn, every loop. Nothing calls <code>delay()</code>, so a clap or a press is never missed while a tune plays.", hl: ["pollSerial();", "pollButton(now);", "pollSound(now);", "serviceTune(now);"] },
      { t: "Slower jobs use a timestamp: <code>now - tAlarm >= 500</code> means \"if half a second has passed\".", hl: ["tAlarm >= 500", "tDraw >= 100"] },
      { t: "If the page goes quiet for 20 s, the Uno shows \"page offline\" but keeps the clock and alarms going.", hl: ["lastPageMs > 20000"] },
    ] },
  { title: "The button and the double clap", file: "ino", from: "// Button with debounce", to: "// ---------------------------------------------------------------- messages from the page",
    notes: [
      { t: "A button bounces: one press looks like several for a few ms. Ignoring changes closer than 25 ms fixes that.", hl: ["now - btnChange > 25"] },
      { t: "Short press on release, hold after 800 ms: one button, two jobs.", hl: ["!holdFired", "now - btnSince >= HOLD_MS"] },
      { t: "Loudness is the swing between the lowest and highest reading in 30 ms. A clap is a big swing.", hl: ["uint16_t swing = sMax - sMin", "swing < CLAP_LEVEL"] },
      { t: "Two claps 150–700 ms apart = talk. One clap alone (a door, a cough) does nothing, and Yaver ignores claps while its own buzzer plays.", hl: ["gap < 700", "quietTime"] },
    ] },
  { title: "Alarms that ring without the Mac", file: "ino", from: "void startRing(uint8_t i) {", to: "// ---------------------------------------------------------------- input",
    notes: [
      { t: "Each kind has its own tune: timer, reminder or wake-up. It loops until you press.", hl: ["TUNE_TIMER : k == 'R'"] },
      { t: "Hold = snooze: the same alarm comes back in 300 s.", hl: ["nowSec() + 300"] },
      { t: "An everyday alarm moves to tomorrow (+86400 s) instead of being deleted.", hl: ["a.at += 86400UL"] },
      { t: "Every change is saved in EEPROM, so alarms survive a reset. One missed by over an hour (the Uno was off) is skipped, not rung late.", hl: ["saveAlarms();", "t - a.at > 3600"] },
    ] },
  { title: "Talking to the page", file: "ino", from: "void handleLine(char* line) {", to: "void pollSerial() {",
    notes: [
      { t: "Each line from the page starts with two letters. <code>TM</code> sets the clock, <code>ST</code> the mood (listening, thinking, speaking).", hl: ["PSTR(\"TM\")", "PSTR(\"ST\")"] },
      { t: "The answer comes in pieces: <code>AB</code> begins, <code>A </code> adds up to 40 letters, <code>AE</code> shows it.", hl: ["'A' && line[1] == 'B'", "'A' && line[1] == ' '", "'A' && line[1] == 'E'"] },
      { t: "<code>AL</code> sets a timer, alarm or reminder; the Uno keeps it and rings it itself.", hl: ["PSTR(\"AL\")", "setAlarm(id, at, kind, p)"] },
      { t: "After every line the Uno answers <code>K</code>. It can only hold 64 bytes, so the page waits for K before sending more.", hl: ["Serial.println('K')"] },
    ] },
  { title: "A voice from a buzzer", file: "ino", from: "// ---------------------------------------------------------------- voice", to: "// ---------------------------------------------------------------- clock",
    notes: [
      { t: "A buzzer is a tiny membrane. Push it out and pull it back 8000 times a second by the right amounts and it makes any sound, including speech: that's all a speaker does too.", hl: ["The page turns the spoken answer", "Timer2 runs a very fast PWM"] },
      { t: "The Uno can't output in-between voltages, so Timer2 switches D3 on and off 62,500 times a second, far too fast to hear. The share of time it's on (<code>OCR2B</code>) is what the membrane follows.", hl: ["TCCR2A = _BV(COM2B1)", "OCR2B = vbuf[vTail]"] },
      { t: "Timer1 interrupts 8000 times a second, whatever <code>loop()</code> is doing (even redrawing the LCD), so the voice never stutters. Each tick plays one byte.", hl: ["ISR(TIMER1_COMPA_vect)", "OCR1A = F_CPU / 8000 - 1"] },
      { t: "The bytes wait in a 512-byte ring. The Uno sends <code>V</code> for every 64 played, and the page never sends more than that: no overflow, with only 2 KB of RAM.", hl: ["Serial.println('V')", "#define VRING 512"] },
      { t: "A <code>0</code> byte means the end; the Uno plays what's left, then says <code>VE</code>. The button cuts it short.", hl: ["if (!c)", "F(\"VE\")", "void voiceCut()"] },
    ] },
  { title: "The brain: hear, think, speak", file: "js", from: "async function conversation() {", to: "function finish()",
    notes: [
      { t: "<code>ST L</code> first: the Uno shows the listening face and beeps. Then Chrome listens through the Mac's microphone.", hl: ["uno.send(\"ST L\")", "await listen()"] },
      { t: "While Gemini thinks, the Uno shows what it heard and the thinking face.", hl: ["uno.send(\"ST T\")", "await think(question)"] },
      { t: "The answer goes to the LCD in pieces, then Yaver says it out loud in the Charon voice, from the Uno's buzzer.", hl: ["await toLcd(answer)", "await speak(answer"] },
      { t: "<code>ST I</code> when the voice is done: the Uno smiles and goes back to the clock.", hl: ["uno.send(\"ST I\")", "finish();"] },
    ] },
  { title: "Tools: what the AI can do", file: "js", from: "const TOOLS = [", to: "function system()",
    notes: [
      { t: "Each tool is a name, a description and its inputs. Gemini reads these and decides when to use one: \"tea in 5 minutes\" becomes <code>set_timer</code>.", hl: ["name: \"set_timer\"", "name: \"set_alarm\"", "name: \"set_reminder\""] },
      { t: "<code>run</code> does the real work: here it sends <code>AL</code> to the Uno, which keeps the timer.", hl: ["run: ({ minutes", "addAlarm(atTime(time)"] },
      { t: "The weather comes from Open-Meteo: free, no key needed.", hl: ["name: \"get_weather\"", "weather(p)"] },
      { t: "\"Good night\" turns on the big night clock.", hl: ["name: \"sleep_clock\"", "SL ${on"] },
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
        <div><h1>Mini Yaver</h1><p class="ac-lead">Your Uno as a desk AI with five parts: clap or press to talk, the Mac listens and thinks, the buzzer speaks the answer, and the LCD shows Yaver's face, timers and the answer.</p></div>
        <div class="my-tabs" role="tablist">
          <a class="ac-btn" href="#academy/mini-yaver/3d">1 · 3D build</a>
          <button class="ac-btn ${this.tab === "wires" ? "primary" : ""}" data-my="tab:wires" role="tab">📋 Wire list</button>
          <button class="ac-btn ${this.tab === "wiring" ? "primary" : ""}" data-my="tab:wiring" role="tab">Wiring map</button>
          <button class="ac-btn ${this.tab === "code" ? "primary" : ""}" data-my="tab:code" role="tab">2 · Code</button>
          <a class="ac-btn ghost" href="${FILES_URL}MiniYaver/MiniYaver.ino" download>⬇ Sketch</a>
          <a class="ac-btn ghost" href="${FILES_URL}" target="_blank" rel="noopener">🧠 Open the brain page</a>
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
    if (f?.all) return `<h3>Everything wired</h3><p>All ${WIRES.length} signal wires. Click a part or a pin to follow its wires.</p><button class="ac-btn ghost" data-my="step:${this.step}">✕ Back to step ${this.step + 1}</button>`;
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
      const url = kind === "js" ? BRAIN_URL : SKETCH_URL;
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
        <h2><span>${sec.file === "js" ? "mini-yaver/app.js · in Chrome on the Mac" : "MiniYaver.ino · on the Uno"}</span>${esc(sec.title)}</h2>
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
