// 3D models of the parts in Mustafa's own Arduino kit (the "RFID UNO Kit")
// that the course didn't have yet: the stepper motor and its ULN2003 board,
// the RGB module, displays (7-segment, 4-digit, 8×8 matrix, 1602 LCD), the
// 74HC595 chip, sensors (DHT11, water, sound, LM35, tilt, joystick), the IR
// receiver, the 4×4 keypad, the DS1302 clock, the RC522 RFID reader and the
// relay. Sizes are in centimetres. Each part has named pins (where wires go)
// and setters the project player calls to light, turn or redraw it.
import * as THREE from "three";
import * as P from "./parts.js?v=21";

const { makePart, addPin, MAT, PITCH } = P;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mesh(geo, mat, info = null) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  if (info) m.userData.info = info;
  return m;
}
const box = (w, h, d, mat, info) => mesh(new THREE.BoxGeometry(w, h, d), mat, info);
const cyl = (r, h, mat, info, seg = 28) => mesh(new THREE.CylinderGeometry(r, r, h, seg), mat, info);
const plastic = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

// A canvas texture that can be redrawn: draw(g, w, h).
function canvasFace(pxW, pxH, draw) {
  const c = document.createElement("canvas");
  c.width = pxW;
  c.height = pxH;
  const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const redraw = (...args) => { g.clearRect(0, 0, pxW, pxH); draw(g, pxW, pxH, ...args); tex.needsUpdate = true; };
  redraw();
  return { tex, redraw };
}

// A module: a coloured board with a printed name, a row of header pins along
// its front edge (+z) pointing down, so wires land on their tips.
function moduleBoard(kind, title, info, { w, d, color = "#1d5aa8", pins, name, sub = "", t = 0.16, y = 0.85, pitch = PITCH, pinZ = null, labels = null }) {
  const part = makePart(kind, title, info);
  const face = canvasFace(Math.round(w * 110), Math.round(d * 110), (g, W, H) => {
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${Math.min(H * 0.2, W * 0.12)}px system-ui, sans-serif`;
    if (name) g.fillText(name, W / 2, H * 0.3);
    g.font = `600 ${Math.min(H * 0.1, W * 0.07)}px system-ui, sans-serif`;
    if (sub) g.fillText(sub, W / 2, H * 0.47);
    // Pin names along the front edge.
    g.font = `700 ${Math.min(H * 0.09, 13)}px ui-monospace, monospace`;
    (labels ?? pins).forEach((n, i) => {
      const x = W / 2 + ((i - (pins.length - 1) / 2) * pitch) * 110;
      g.save();
      g.translate(x, H - 18);
      g.rotate(-Math.PI / 2);
      g.fillText(n, 0, 0);
      g.restore();
    });
  });
  const side = plastic(color);
  const board = mesh(new THREE.BoxGeometry(w, t, d), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.55 }), side, side, side], part.userData.info);
  board.position.y = y;
  part.add(board);
  const z = pinZ ?? d / 2 - 0.15;
  pins.forEach((n, i) => {
    const x = (i - (pins.length - 1) / 2) * pitch;
    const post = box(0.064, y + 0.1, 0.064, MAT.gold);
    post.position.set(x, (y + 0.1) / 2 - 0.05, z);
    const collar = box(0.22, 0.22, 0.22, MAT.blackPlastic);
    collar.position.set(x, y - 0.19, z);
    part.add(post, collar);
    addPin(part, n, V(x, 0.0, z), (labels ?? pins)[i]);
  });
  part.userData.top = y + t / 2;
  return part;
}

// Legs straight down from a component body (for bare parts).
function legs(part, names, { pitch = PITCH, length = 1.0, top = 0, z = 0, labels = null, mat = MAT.tin } = {}) {
  names.forEach((n, i) => {
    const x = (i - (names.length - 1) / 2) * pitch;
    const leg = box(0.045, length, 0.045, mat);
    leg.position.set(x, top - length / 2, z);
    part.add(leg);
    addPin(part, n, V(x, top - length + 0.02, z), labels?.[i] ?? n);
  });
}

// ---- Motors -------------------------------------------------------------------

// The 28BYJ-48 stepper motor wired to its ULN2003 driver board (they come
// joined by the white 5-wire cable). setAngle(deg) turns the shaft;
// setCoils([a, b, c, d]) lights the board's four LEDs.
export function stepper() {
  const part = makePart("stepper", "Stepper motor + ULN2003", "A 28BYJ-48 5 V stepper motor and its ULN2003 driver board. The Arduino switches the four coils on in turn (IN1 to IN4) and the shaft moves one small step each time: 2048 steps make one full turn. The driver board does the heavy lifting, because a pin can't power a coil by itself.");
  // Driver board.
  const pins = ["IN1", "IN2", "IN3", "IN4", "+", "-"];
  const W = 3.5, D = 3.2, y = 0.85;
  const face = canvasFace(385, 352, (g, w, h) => {
    g.fillStyle = "#1f6b3a"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e9f5ee"; g.font = "800 26px system-ui"; g.textAlign = "center";
    g.fillText("ULN2003", w / 2, 40);
    g.font = "700 15px ui-monospace, monospace";
    ["A", "B", "C", "D"].forEach((t, i) => g.fillText(t, 250 + i * 30, 120));
    ["IN1", "IN2", "IN3", "IN4", "+", "−"].forEach((t, i) => { g.save(); g.translate(w / 2 + (i - 2.5) * 0.254 * 110 - 4, h - 22); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); });
  });
  const side = plastic("#1f6b3a");
  const board = mesh(new THREE.BoxGeometry(W, 0.16, D), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.55 }), side, side, side], part.userData.info);
  board.position.set(0, y, 0);
  const chip = box(1.95, 0.35, 0.65, MAT.chip, { title: "ULN2003 chip", text: "Seven transistor switches in one chip. Each IN pin from the Arduino turns on one switch, which lets a much bigger current flow through one motor coil." });
  at(chip, -0.4, y + 0.25, -0.2);
  const plug = box(1.3, 0.6, 0.6, MAT.whitePlastic, { title: "Motor plug", text: "The motor's 5-wire cable plugs in here. It only fits one way." });
  at(plug, 0, y + 0.38, -1.25);
  part.add(board, chip, plug);
  const leds = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: "#5a1010", emissive: "#ff2a1f", emissiveIntensity: 0.05, roughness: 0.3 });
    const l = box(0.22, 0.14, 0.14, mat, { title: `LED ${"ABCD"[i]}`, text: `Lights while coil ${"ABCD"[i]} (IN${i + 1}) is switched on. Watch them chase each other as the motor turns.` });
    at(l, 0.6 + i * 0.28, y + 0.15, -0.35);
    part.add(l);
    leds.push(mat);
  }
  pins.forEach((n, i) => {
    const x = (i - 2.5) * PITCH;
    const post = box(0.064, y + 0.1, 0.064, MAT.gold);
    post.position.set(x, (y + 0.1) / 2 - 0.05, D / 2 - 0.2);
    part.add(post);
    addPin(part, n, V(x, 0, D / 2 - 0.2), n === "-" ? "− (GND)" : n === "+" ? "+ (5 V)" : n);
  });
  // The motor, behind the board.
  const motor = new THREE.Group();
  const can = cyl(1.4, 1.9, MAT.silver, { title: "28BYJ-48 stepper motor", text: "Inside: a magnet rotor, four coils around it and a gearbox (about 64 : 1). That gearbox is why it's slow but strong, and why one turn takes 2048 steps." });
  can.rotation.x = Math.PI / 2;
  const cap = cyl(1.42, 0.5, plastic("#2b63c9"), { title: "Wire cap", text: "Red is the common +5 V; the other four wires go to the four coils." });
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 1.1;
  const ears = box(4.2, 0.12, 0.7, MAT.silver);
  ears.position.set(0, 0, -0.9);
  ears.rotation.x = Math.PI / 2;
  const hub = new THREE.Group();
  const shaft = cyl(0.25, 0.9, MAT.steel, { title: "Shaft", text: "The output shaft. It has two flat sides so a wheel or arm can't slip on it." });
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.45;
  const arm = box(2.2, 0.35, 0.18, plastic("#ff9800"), { title: "Pointer", text: "A little arm on the shaft so you can see it turn. 2048 steps = once round." });
  arm.position.set(0.8, 0, -0.95);
  hub.add(shaft, arm);
  hub.position.set(0, 0.6, -1.0);
  motor.add(can, cap, ears, hub);
  motor.position.set(0, 1.9, -4.2);
  part.add(motor);
  // The cable.
  const tube = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 1.9, -3.0), V(0, 2.2, -2.4), V(0, 1.6, -1.8), V(0, y + 0.4, -1.4)]), 16, 0.18, 8), MAT.whitePlastic);
  part.add(tube);
  part.userData.setAngle = (deg) => { hub.rotation.z = (-deg * Math.PI) / 180; };
  part.userData.setCoils = (on) => { leds.forEach((m, i) => { m.emissiveIntensity = on[i] ? 2.2 : 0.05; }); };
  return part;
}

// ---- Lights ---------------------------------------------------------------------

// The RGB LED module (KY-016 style): one LED with red, green and blue chips.
export function rgbModule() {
  const part = moduleBoard("rgb", "RGB LED module", "Three LEDs (red, green, blue) in one dome, sharing the − leg. Mix them with analogWrite() on pins 3, 5, 6, 9, 10 or 11 to make any colour.", { w: 1.9, d: 1.5, color: "#141414", pins: ["R", "G", "B", "-"], labels: ["R", "G", "B", "−"], name: "RGB", y: 0.85 });
  const dome = new THREE.MeshPhysicalMaterial({ color: "#f4f6ff", emissive: "#000000", roughness: 0.15, transparent: true, opacity: 0.75, clearcoat: 1 });
  const body = cyl(0.25, 0.55, dome, { title: "RGB LED", text: "Look closely and you can see three tiny chips inside." });
  at(body, 0, 1.25, -0.2);
  const top = mesh(new THREE.SphereGeometry(0.25, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), dome);
  at(top, 0, 1.52, -0.2);
  const glow = new THREE.PointLight("#ffffff", 0, 6);
  glow.position.set(0, 1.9, -0.2);
  part.add(body, top, glow);
  part.userData.setRGB = (r, g, b) => {
    dome.emissive.setRGB(r, g, b);
    dome.emissiveIntensity = 1.6;
    glow.color.setRGB(r || 0.001, g || 0.001, b || 0.001);
    glow.intensity = (r + g + b) * 6;
  };
  return part;
}

// Segment shapes for a 7-segment digit in a w×h box (0..1 units).
const SEGS = {
  a: [0.18, 0.06, 0.64, 0.09], b: [0.76, 0.12, 0.09, 0.34], c: [0.76, 0.54, 0.09, 0.34],
  d: [0.18, 0.85, 0.64, 0.09], e: [0.15, 0.54, 0.09, 0.34], f: [0.15, 0.12, 0.09, 0.34], g: [0.18, 0.455, 0.64, 0.09],
};
function drawDigit(g, x0, y0, w, h, lit, color = "#ff3322") {
  g.save();
  g.translate(x0, y0);
  g.transform(1, 0, -0.08, 1, 0, 0); // a little slant
  for (const [s, [x, y, sw, sh]] of Object.entries(SEGS)) {
    g.fillStyle = lit.has(s) ? color : "#3a2a28";
    g.shadowColor = lit.has(s) ? color : "transparent";
    g.shadowBlur = lit.has(s) ? 12 : 0;
    g.fillRect(x * w, y * h, sw * w, sh * h);
  }
  g.beginPath();
  g.arc(0.93 * w, 0.9 * h, 0.05 * w, 0, Math.PI * 2);
  g.fillStyle = lit.has("dp") ? color : "#3a2a28";
  g.fill();
  g.restore();
}

// A 1-digit common-cathode display (5161AS). Pins in physical order:
// 1 e, 2 d, 3 COM, 4 c, 5 dp (bottom row), 6 b, 7 a, 8 COM, 9 f, 10 g (top row).
export const SEG1_PINS = ["e", "d", "COM", "c", "dp", "b", "a", "COM2", "f", "g"];
export function seg7() {
  const part = makePart("seg7", "1-digit 7-segment display", "Eight LEDs shaped as the bars of a digit (a to g) plus a dot (dp). All their cathodes meet at COM, so COM goes to GND (through a resistor) and each segment pin lights its bar when HIGH.");
  const W = 1.27, D = 1.9, H = 0.8;
  const face = canvasFace(254, 380, (g, w, h, lit = new Set()) => {
    g.fillStyle = "#121212"; g.fillRect(0, 0, w, h);
    drawDigit(g, 30, 40, w - 50, h - 80, lit);
  });
  const side = plastic("#1b1b1b");
  const body = mesh(new THREE.BoxGeometry(W, H, D), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.4, emissive: "#ffffff", emissiveMap: face.tex, emissiveIntensity: 0.6 }), side, side, side], part.userData.info);
  body.position.y = H / 2 + 0.3;
  part.add(body);
  // Two rows of 5 legs along the long sides.
  SEG1_PINS.forEach((n, i) => {
    const bottom = i < 5;
    const k = bottom ? i : 9 - i;
    const z = (k - 2) * PITCH * 1.4;
    const x = bottom ? 0.5 : -0.5;
    const leg = box(0.045, 0.9, 0.045, MAT.tin);
    leg.position.set(x, -0.15, z);
    part.add(leg);
    addPin(part, n, V(x, -0.6, z), `${n === "COM2" ? "COM" : n} (pin ${i + 1})`);
  });
  part.rotation.y = 0;
  let last = "";
  part.userData.setLit = (lit) => { const key = [...lit].sort().join(); if (key !== last) { last = key; face.redraw(lit); } };
  return part;
}

// A 4-digit common-cathode display (5461AS). Pins in physical order:
// 1 e, 2 d, 3 dp, 4 c, 5 g, 6 D4 (bottom), 7 b, 8 D3, 9 D2, 10 f, 11 a, 12 D1 (top).
export const SEG4_PINS = ["e", "d", "dp", "c", "g", "D4", "b", "D3", "D2", "f", "a", "D1"];
export function seg7x4() {
  const part = makePart("seg7x4", "4-digit 7-segment display", "Four digits that share the same eight segment pins (a to g, dp). Each digit has its own common cathode (D1 to D4). Light one digit at a time, very fast, and your eye sees all four: that's multiplexing.");
  const W = 5.0, D = 1.9, H = 0.8;
  const face = canvasFace(1000, 380, (g, w, h, lit = [new Set(), new Set(), new Set(), new Set()]) => {
    g.fillStyle = "#121212"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) drawDigit(g, 40 + i * 235, 50, 190, h - 100, lit[i]);
  });
  const side = plastic("#1b1b1b");
  const body = mesh(new THREE.BoxGeometry(W, H, D), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.4, emissive: "#ffffff", emissiveMap: face.tex, emissiveIntensity: 0.6 }), side, side, side], part.userData.info);
  body.position.y = H / 2 + 0.3;
  part.add(body);
  SEG4_PINS.forEach((n, i) => {
    const bottom = i < 6;
    const k = bottom ? i : 11 - i;
    const x = (k - 2.5) * PITCH * 1.6;
    const z = bottom ? 0.75 : -0.75;
    const leg = box(0.045, 0.9, 0.045, MAT.tin);
    leg.position.set(x, -0.15, z);
    part.add(leg);
    addPin(part, n, V(x, -0.6, z), `${n} (pin ${i + 1})`);
  });
  let last = "";
  part.userData.setLit = (lit) => { const key = lit.map((s) => [...s].sort().join()).join("|"); if (key !== last) { last = key; face.redraw(lit); } };
  return part;
}

// An 8×8 red dot matrix (1088AS). Physical pins 1–16 and what each one is:
// rows R1–R8 and columns C1–C8 (the arduino.cc row-column scanning map).
export const MATRIX_MAP = { 1: "R5", 2: "R7", 3: "C2", 4: "C3", 5: "R8", 6: "C5", 7: "R6", 8: "R3", 9: "R1", 10: "C4", 11: "C6", 12: "R4", 13: "C1", 14: "R2", 15: "C7", 16: "C8" };
export function ledMatrix() {
  const part = makePart("matrix", "8×8 LED matrix", "64 red LEDs in 8 rows and 8 columns. Each LED sits where a row wire crosses a column wire: make its row HIGH and its column LOW and it lights. Show a picture by lighting one row at a time, very fast.");
  const S = 3.2, H = 0.75;
  const face = canvasFace(400, 400, (g, w, h, lit = new Set()) => {
    g.fillStyle = "#181818"; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const on = lit.has(r * 8 + c);
      g.beginPath();
      g.arc(25 + c * 50, 25 + r * 50, 17, 0, Math.PI * 2);
      g.fillStyle = on ? "#ff2a1f" : "#3b2b29";
      g.shadowColor = on ? "#ff2a1f" : "transparent";
      g.shadowBlur = on ? 14 : 0;
      g.fill();
    }
  });
  const side = plastic("#e8e8e8");
  const body = mesh(new THREE.BoxGeometry(S, H, S), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.45, emissive: "#ffffff", emissiveMap: face.tex, emissiveIntensity: 0.6 }), side, side, side], part.userData.info);
  body.position.y = H / 2 + 0.3;
  part.add(body);
  for (let n = 1; n <= 16; n++) {
    const bottom = n <= 8;
    const k = bottom ? n - 1 : 16 - n;
    const x = (k - 3.5) * PITCH;
    const z = bottom ? 1.27 : -1.27;
    const role = MATRIX_MAP[n];
    const leg = box(0.045, 0.9, 0.045, MAT.tin);
    leg.position.set(x, -0.15, z);
    part.add(leg);
    addPin(part, role, V(x, -0.6, z), `${role} (pin ${n})`);
  }
  let last = "";
  part.userData.setLit = (lit) => { const key = [...lit].sort((a, b) => a - b).join(); if (key !== last) { last = key; face.redraw(lit); } };
  return part;
}

// The 1602 LCD: 16 characters × 2 lines, 16 pins along the top edge.
export const LCD_PINS = ["VSS", "VDD", "V0", "RS", "RW", "E", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A", "K"];
export function lcd1602() {
  const part = makePart("lcd", "1602 LCD", "A screen of 2 lines × 16 characters. The LiquidCrystal library talks to it over 6 wires (RS, E and D4 to D7). V0 sets the contrast (the potentiometer's middle leg), and A/K power the backlight.");
  const W = 8.0, D = 3.6;
  const face = canvasFace(800, 360, (g, w, h, st = { lines: ["", ""], visible: 1, backlight: true, blocks: false }) => {
    g.fillStyle = "#1a5b23"; g.fillRect(0, 0, w, h);
    g.fillStyle = st.backlight ? "#2f6df0" : "#16316b";
    g.fillRect(70, 80, 660, 200);
    const cw = 38, ch = 70;
    for (let row = 0; row < 2; row++) for (let col = 0; col < 16; col++) {
      const x = 92 + col * 39.5, y = 105 + row * 82;
      g.fillStyle = st.backlight ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)";
      g.fillRect(x, y, cw - 4, ch);
      const chr = st.blocks ? (row === 0 ? "█" : "") : (st.lines[row] ?? "")[col] ?? "";
      if (chr && st.visible > 0.05) {
        g.globalAlpha = st.visible;
        g.fillStyle = "#f2f6ff";
        if (chr === "█") g.fillRect(x, y, cw - 4, ch);
        else { g.font = "700 58px ui-monospace, Menlo, monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(chr, x + (cw - 4) / 2, y + ch / 2 + 3); }
        g.globalAlpha = 1;
      }
    }
    g.fillStyle = "#cfe0cf"; g.font = "700 15px ui-monospace, monospace"; g.textAlign = "center";
    LCD_PINS.forEach((n, i) => g.fillText(n, 75 + i * 25.4, 30));
  });
  const side = plastic("#1a5b23");
  const pcb = mesh(new THREE.BoxGeometry(W, 0.16, D), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.5 }), side, side, side], part.userData.info);
  pcb.position.y = 1.3;
  const bezel = box(7.1, 0.7, 2.4, MAT.blackPlastic);
  bezel.position.set(0, 1.0, 0.15);
  part.add(pcb, bezel);
  // Its pins: a row of 16 at the top-left edge, standing on posts.
  LCD_PINS.forEach((n, i) => {
    const x = -W / 2 + 0.75 + i * PITCH;
    const z = -D / 2 + 0.25;
    const post = box(0.064, 1.4, 0.064, MAT.gold);
    post.position.set(x, 0.65, z);
    part.add(post);
    addPin(part, n, V(x, 0, z), n);
  });
  let last = "";
  part.userData.setScreen = (st) => { const key = JSON.stringify(st); if (key !== last) { last = key; face.redraw(st); } };
  return part;
}

// ---- Chips ------------------------------------------------------------------------

// The 74HC595 shift register (DIP-16). Physical pin order 1–16.
export const HC595_PINS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "GND", "Q7S", "MR", "SHCP", "STCP", "OE", "DS", "Q0", "VCC"];
export function hc595() {
  const part = makePart("hc595", "74HC595 shift register", "Turns 3 Arduino pins into 8 outputs. Send it 8 bits one at a time on DS, ticking SHCP (the clock) after each, then tick STCP (the latch) and Q0 to Q7 all change together. shiftOut() does the ticking for you.");
  const L = 2.0, W = 0.65;
  const face = canvasFace(400, 130, (g, w, h) => {
    g.fillStyle = "#18191c"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#d8d8d8"; g.font = "700 34px ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("74HC595", w / 2, h / 2);
    g.beginPath(); g.arc(0, h / 2, 16, -Math.PI / 2, Math.PI / 2); g.fillStyle = "#0b0b0c"; g.fill();
  });
  const side = MAT.chip;
  const body = mesh(new THREE.BoxGeometry(L, 0.35, W), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.55 }), side, side, side], part.userData.info);
  body.position.y = 0.5;
  part.add(body);
  HC595_PINS.forEach((n, i) => {
    const bottom = i < 8;
    const k = bottom ? i : 15 - i;
    const x = (k - 3.5) * PITCH;
    const z = bottom ? 0.38 : -0.38;
    const leg = box(0.05, 0.75, 0.04, MAT.tin);
    leg.position.set(x, 0.12, z);
    part.add(leg);
    addPin(part, n, V(x, -0.25, z), `${n} (pin ${i + 1})`);
  });
  return part;
}

// ---- Sensors ------------------------------------------------------------------------

export function dht11() {
  const part = moduleBoard("dht11", "DHT11 temperature & humidity", "A blue sensor that measures temperature (0–50 °C) and humidity (20–90 %). It sends both as a digital message on one wire (S), at most once a second. The DHT library decodes it.", { w: 1.6, d: 2.6, color: "#1d5aa8", pins: ["S", "+", "-"], labels: ["S", "+", "−"], name: "", y: 0.85 });
  const grille = box(1.2, 0.55, 1.5, plastic("#2a8fe0"), { title: "DHT11 sensor", text: "Inside: a moisture-sensing layer and a thermistor, read by a tiny chip." });
  at(grille, 0, 1.2, -0.25);
  for (let i = 0; i < 4; i++) { const slot = box(1.0, 0.02, 0.12, MAT.hole); at(slot, 0, 1.48, -0.8 + i * 0.32); part.add(slot); }
  part.add(grille);
  return part;
}

export function waterSensor() {
  const part = moduleBoard("water", "Water level sensor", "Long copper traces that water bridges: the deeper it's dipped, the more current flows and the higher the reading on S. Power it only while measuring, or the traces corrode.", { w: 2.0, d: 6.2, color: "#b3261e", pins: ["S", "+", "-"], labels: ["S", "+", "−"], name: "", y: 0.85 });
  for (let i = 0; i < 10; i++) { const t = box(0.07, 0.02, 4.0, MAT.copper, { title: "Sensing traces", text: "Every other trace is joined to + and to S. Water between them lets a little current through." }); at(t, -0.75 + i * 0.165, 0.94, -0.9); part.add(t); }
  const level = box(1.95, 0.02, 0.01, new THREE.MeshBasicMaterial({ color: "#5bc0ff", transparent: true, opacity: 0.55 }));
  level.userData.noPick = true;
  part.add(level);
  part.userData.setLevel = (k) => { level.scale.z = Math.max(1, k * 400); level.position.set(0, 0.97, -2.9 + k * 2); level.visible = k > 0.02; };
  return part;
}

export function soundSensor() {
  const part = moduleBoard("sound", "KY-037 sound sensor", "A microphone with an amplifier. AO gives the loudness as a voltage (read it with analogRead). DO switches HIGH when the sound is louder than the level you set with the little blue screw.", { w: 1.6, d: 4.2, color: "#b3261e", pins: ["AO", "G", "+", "DO"], name: "", y: 0.85 });
  const mic = cyl(0.48, 0.5, MAT.silver, { title: "Microphone", text: "An electret capsule: sound moves a thin film and makes a tiny voltage." });
  at(mic, 0, 1.2, -1.5);
  const cap = cyl(0.42, 0.02, plastic("#1a1a1a"));
  at(cap, 0, 1.46, -1.5);
  const pot = box(0.5, 0.5, 0.95, MAT.bluePlastic, { title: "Sensitivity screw", text: "Turn it to set how loud a sound must be before DO goes HIGH." });
  at(pot, 0.3, 1.18, -0.4);
  const led = new THREE.MeshStandardMaterial({ color: "#3a0c0c", emissive: "#ff2a1f", emissiveIntensity: 0.05 });
  const l = box(0.18, 0.1, 0.12, led);
  at(l, -0.45, 0.98, 0.4);
  part.add(mic, cap, pot, l);
  part.userData.setLed = (on) => { led.emissiveIntensity = on ? 2.5 : 0.05; };
  return part;
}

export function lm35() {
  const part = makePart("lm35", "LM35 temperature sensor", "A 3-leg chip whose middle leg gives 10 mV for every °C: 25 °C = 0.25 V. With the flat face toward you: left +5 V, middle OUT, right GND.");
  const body = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 24, 1, false, 0, Math.PI), MAT.chip, part.userData.info);
  body.rotation.y = Math.PI / 2;
  const flat = box(0.48, 0.5, 0.01, MAT.chip);
  body.position.y = 0.85;
  flat.position.set(0, 0.85, 0);
  part.add(body, flat);
  legs(part, ["VS", "OUT", "GND"], { pitch: PITCH, top: 0.6, length: 1.0, labels: ["+Vs", "Vout", "GND"] });
  return part;
}

export function tiltSwitch() {
  const part = makePart("tilt", "Tilt switch", "A little can with a metal ball inside. Upright, the ball rests on both legs and joins them (switch closed). Tip it over and the ball rolls away (switch open).");
  const can = cyl(0.3, 1.1, plastic("#111111"), part.userData.info);
  at(can, 0, 0.85, 0);
  can.rotation.z = 0;
  part.add(can);
  legs(part, ["1", "2"], { pitch: PITCH * 1.5, top: 0.3, length: 1.0, labels: ["Leg 1", "Leg 2"] });
  part.userData.setTilt = (t) => { can.rotation.z = t ? 1.2 : 0; can.position.x = t ? 0.3 : 0; };
  return part;
}

export function joystick() {
  const part = moduleBoard("joystick", "Joystick module", "Two potentiometers (left–right on VRx, up–down on VRy) and a button you press by pushing the stick down (SW). Centred, VRx and VRy read about 512.", { w: 2.6, d: 3.4, color: "#151515", pins: ["GND", "+5V", "VRx", "VRy", "SW"], name: "", y: 0.85 });
  const base = box(1.6, 0.9, 1.6, MAT.blackPlastic);
  at(base, 0, 1.35, -0.45);
  const stick = new THREE.Group();
  const rod = cyl(0.15, 1.0, MAT.blackPlastic);
  rod.position.y = 0.5;
  const knob = cyl(0.65, 0.4, plastic("#1e1e1e"), { title: "Thumb stick", text: "Move it with the X and Y sliders, or press it with the button, in the simulator." });
  knob.position.y = 1.1;
  stick.add(rod, knob);
  stick.position.set(0, 1.8, -0.45);
  part.add(base, stick);
  part.userData.setStick = (x, y, down) => { stick.rotation.z = -(x - 0.5) * 0.9; stick.rotation.x = (y - 0.5) * 0.9; stick.position.y = down ? 1.65 : 1.8; };
  return part;
}

export function irReceiver() {
  const part = makePart("ir", "IR receiver (VS1838B)", "Sees the invisible infrared flashes from the remote and turns them into a digital signal on OUT. Facing the dome: left OUT, middle GND, right VCC.");
  const body = box(0.6, 0.7, 0.45, MAT.blackPlastic, part.userData.info);
  at(body, 0, 0.95, 0);
  const dome = mesh(new THREE.SphereGeometry(0.22, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.blackPlastic);
  dome.rotation.x = Math.PI / 2;
  at(dome, 0, 0.95, 0.22);
  part.add(body, dome);
  legs(part, ["OUT", "GND", "VCC"], { pitch: PITCH, top: 0.6, length: 1.0 });
  return part;
}

// The membrane 4×4 keypad. Pins left to right: R1–R4, C1–C4.
export const KEYPAD_KEYS = ["123A", "456B", "789C", "*0#D"];
export function keypad() {
  const part = makePart("keypad", "4×4 keypad", "16 keys in 4 rows and 4 columns. Pressing a key joins its row wire to its column wire. The Keypad library checks every row and column many times a second to find which key it is.");
  const W = 6.9, D = 7.6;
  const keyMats = [];
  const face = canvasFace(690, 760, (g, w, h, down = "") => {
    g.fillStyle = "#1a1a1a"; g.fillRect(0, 0, w, h);
    KEYPAD_KEYS.forEach((row, r) => [...row].forEach((k, c) => {
      const x = 40 + c * 160, y = 40 + r * 175;
      g.fillStyle = k === down ? "#4cc9ff" : /[A-D]/.test(k) ? "#c62828" : /[*#]/.test(k) ? "#2e7d32" : "#1565c0";
      g.fillRect(x, y, 130, 140);
      g.fillStyle = "#fff"; g.font = "800 70px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(k, x + 65, y + 72);
    }));
  });
  const side = plastic("#1a1a1a");
  const pad = mesh(new THREE.BoxGeometry(W, 0.08, D), [side, side, new THREE.MeshStandardMaterial({ map: face.tex, roughness: 0.6 }), side, side, side], part.userData.info);
  pad.position.y = 0.04;
  part.add(pad);
  // The ribbon tail with 8 pins.
  const tail = box(2.1, 0.03, 2.2, plastic("#b8860b", { transparent: true, opacity: 0.85 }));
  tail.position.set(0, 0.02, D / 2 + 1.1);
  part.add(tail);
  ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"].forEach((n, i) => {
    const x = (i - 3.5) * PITCH;
    const post = box(0.064, 0.5, 0.064, MAT.gold);
    post.position.set(x, -0.2, D / 2 + 2.2);
    part.add(post);
    addPin(part, n, V(x, -0.45, D / 2 + 2.2), n);
  });
  let last = null;
  part.userData.setDown = (k) => { if (k !== last) { last = k; face.redraw(k || ""); } };
  return part;
}

export function ds1302() {
  const part = moduleBoard("ds1302", "DS1302 clock module", "A real-time clock: a chip and a 32 kHz crystal that keep counting seconds, minutes, hours and the date, even while the Arduino is off, thanks to the coin battery.", { w: 2.8, d: 3.6, color: "#1d5aa8", pins: ["VCC", "GND", "CLK", "DAT", "RST"], name: "DS1302", y: 0.85 });
  const coin = cyl(1.0, 0.32, MAT.silver, { title: "CR2032 coin cell", text: "Keeps the clock running while the power is off." });
  at(coin, 0, 1.1, -0.7);
  const chip = box(0.5, 0.18, 0.45, MAT.chip);
  at(chip, -0.9, 1.0, 0.4);
  const xtal = cyl(0.1, 0.6, MAT.silver);
  xtal.rotation.z = Math.PI / 2;
  at(xtal, 0.8, 1.0, 0.45);
  part.add(coin, chip, xtal);
  return part;
}

export function rc522() {
  const part = moduleBoard("rfid", "RC522 RFID reader", "Reads the ID number of the card or key tag held near its antenna (13.56 MHz). It talks to the Arduino over SPI: SCK, MOSI and MISO are fixed pins 13, 11 and 12. Power it from 3.3 V, not 5 V!", { w: 6.0, d: 4.0, color: "#1d4fa0", pins: ["SDA", "SCK", "MOSI", "MISO", "IRQ", "GND", "RST", "3.3V"], name: "RFID-RC522", y: 0.85 });
  const ant = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 6, 4), MAT.copper);
  ant.rotation.x = Math.PI / 2;
  ant.rotation.z = Math.PI / 4;
  at(ant, -0.9, 0.95, -0.4);
  ant.userData.info = { title: "Antenna", text: "A copper loop that sends out a radio field. A card held near it wakes up and answers with its ID." };
  const card = box(5.4, 0.08, 3.4, plastic("#f5f5f5"), { title: "RFID card", text: "Inside: a coil and a tiny chip that answers with its own ID." });
  card.visible = false;
  part.add(ant, card);
  part.userData.showCard = (which) => {
    card.visible = !!which;
    if (which) { card.material.color.set(which === "tag" ? "#1f5bd6" : "#f5f5f5"); card.scale.set(which === "tag" ? 0.5 : 1, 1, which === "tag" ? 0.7 : 1); card.position.set(-0.9, 1.6, -0.4); }
  };
  return part;
}

export function relay() {
  const part = moduleBoard("relay", "5 V relay module", "An electrically worked switch. A small signal on S energises a coil, the coil pulls a metal arm and it clicks: COM is then joined to NO (normally open) instead of NC (normally closed). It can switch a separate circuit, even a big one, safely apart from the Arduino.", { w: 2.6, d: 5.0, color: "#1d5aa8", pins: ["S", "+", "-"], labels: ["S", "+", "−"], name: "", y: 0.85 });
  const cube = box(1.9, 1.5, 1.5, MAT.bluePlastic, { title: "Relay", text: "Inside: a coil, a spring and a switch arm. You can hear it click." });
  at(cube, 0, 1.68, -0.3);
  const term = box(2.2, 1.0, 0.8, plastic("#2d6cd6"), { title: "Screw terminal", text: "Left to right: NO, COM, NC. The circuit you switch is wired here." });
  at(term, 0, 1.43, -1.9);
  const led = new THREE.MeshStandardMaterial({ color: "#3a0c0c", emissive: "#ff2a1f", emissiveIntensity: 0.05 });
  const l = box(0.2, 0.1, 0.12, led);
  at(l, 0.9, 0.98, 1.1);
  part.add(cube, term, l);
  // The terminals take the switched circuit's wires (on top of the block).
  [["NO", -0.7], ["COM", 0], ["NC", 0.7]].forEach(([n, x]) => {
    const screw = cyl(0.2, 0.06, MAT.silver);
    at(screw, x, 1.96, -1.9);
    part.add(screw);
    addPin(part, n, V(x, 1.98, -1.9), n);
  });
  part.userData.setOn = (on) => { led.emissiveIntensity = on ? 2.5 : 0.05; cube.position.y = on ? 1.66 : 1.68; };
  return part;
}

// ---- What a plan can name, and how to build it ----------------------------------------

export const KIT_KINDS = {
  stepper: ["IN1", "IN2", "IN3", "IN4", "+", "-"],
  rgb: ["R", "G", "B", "-"],
  seg7: SEG1_PINS,
  seg7x4: SEG4_PINS,
  matrix: Object.values(MATRIX_MAP),
  lcd: LCD_PINS,
  hc595: HC595_PINS,
  dht11: ["S", "+", "-"],
  water: ["S", "+", "-"],
  sound: ["AO", "G", "+", "DO"],
  lm35: ["VS", "OUT", "GND"],
  tilt: ["1", "2"],
  joystick: ["GND", "+5V", "VRx", "VRy", "SW"],
  ir: ["OUT", "GND", "VCC"],
  keypad: ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"],
  ds1302: ["VCC", "GND", "CLK", "DAT", "RST"],
  rfid: ["SDA", "SCK", "MOSI", "MISO", "IRQ", "GND", "RST", "3.3V"],
  relay: ["S", "+", "-", "NO", "COM", "NC"],
};

const BUILDERS = { stepper, rgb: rgbModule, seg7, seg7x4, matrix: ledMatrix, lcd: lcd1602, hc595, dht11, water: waterSensor, sound: soundSensor, lm35, tilt: tiltSwitch, joystick, ir: irReceiver, keypad, ds1302, rfid: rc522, relay };
export function buildKitPart(type) { return BUILDERS[type]?.() ?? null; }

export const KIT_SHOP = {
  stepper: "28BYJ-48 stepper motor + ULN2003 board", rgb: "RGB LED module", seg7: "1-digit 7-segment display", seg7x4: "4-digit 7-segment display",
  matrix: "8×8 LED matrix", lcd: "1602 LCD", hc595: "74HC595 chip", dht11: "DHT11 module", water: "water level sensor", sound: "KY-037 sound sensor",
  lm35: "LM35 temperature sensor", tilt: "tilt switch", joystick: "joystick module", ir: "IR receiver + remote", keypad: "4×4 keypad", ds1302: "DS1302 clock module",
  rfid: "RC522 RFID reader + card + tag", relay: "5 V relay module",
};
