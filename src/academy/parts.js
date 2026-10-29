// Realistic 3D models of the parts used in the course and the simulator,
// built at real size in centimetres: boards, chips, sensors, motors, wheels,
// LEDs, resistors, batteries, wires. Each part keeps a list of its pins (where
// a wire connects, in the part's own space) and short notes on its pieces,
// shown when you point at them.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const PITCH = 0.254; // 0.1 inch, the spacing of header pins and breadboard holes

const shared = (m) => { m.userData.shared = true; return m; };
export const MAT = {
  gold: shared(new THREE.MeshStandardMaterial({ color: "#d9b44a", metalness: 1, roughness: 0.28 })),
  silver: shared(new THREE.MeshStandardMaterial({ color: "#cfd4da", metalness: 1, roughness: 0.22 })),
  steel: shared(new THREE.MeshStandardMaterial({ color: "#9aa3ad", metalness: 0.9, roughness: 0.38 })),
  tin: shared(new THREE.MeshStandardMaterial({ color: "#e4e7ea", metalness: 1, roughness: 0.15 })),
  copper: shared(new THREE.MeshStandardMaterial({ color: "#c8794a", metalness: 1, roughness: 0.3 })),
  chip: shared(new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.55, metalness: 0.05 })),
  blackPlastic: shared(new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.6 })),
  darkPlastic: shared(new THREE.MeshStandardMaterial({ color: "#26282c", roughness: 0.55 })),
  whitePlastic: shared(new THREE.MeshStandardMaterial({ color: "#f0eee6", roughness: 0.65 })),
  yellowPlastic: shared(new THREE.MeshStandardMaterial({ color: "#f3c623", roughness: 0.5 })),
  bluePlastic: shared(new THREE.MeshStandardMaterial({ color: "#1f63c6", roughness: 0.45 })),
  rubber: shared(new THREE.MeshStandardMaterial({ color: "#1c1c1e", roughness: 0.95 })),
  hole: shared(new THREE.MeshStandardMaterial({ color: "#050505", roughness: 1 })),
  ceramic: shared(new THREE.MeshStandardMaterial({ color: "#c9b68d", roughness: 0.7 })),
  marker: shared(new THREE.MeshBasicMaterial({ color: "#4cc9ff", transparent: true, opacity: 0.9, depthTest: false })),
};

const pcbMat = (color, map = null) => new THREE.MeshStandardMaterial({ color: map ? "#ffffff" : color, map, roughness: 0.55, metalness: 0.08 });

function mesh(geo, mat, info = null) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (info) m.userData.info = info;
  return m;
}
const box = (w, h, d, mat, info, r = 0) =>
  mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d), mat, info);
const cyl = (rt, rb, h, mat, info, seg = 28) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, info);
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };

// Draws a board's silkscreen into a texture: `draw(g, s)` gets the 2D context
// and the pixels per centimetre. Canvas left is -x, canvas top is -z.
function silk(w, d, bg, draw, s = 160) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(d * s);
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); // origin at the board's centre
  draw(g, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function text(g, s, str, x, z, { size = 0.14, color = "#f4f4f4", rot = 0, align = "center", weight = 600, font = "system-ui, sans-serif" } = {}) {
  g.save();
  g.translate(x * s, z * s);
  g.rotate(rot);
  g.fillStyle = color;
  g.font = `${weight} ${size * s}px ${font}`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(str, 0, 0);
  g.restore();
}

// A printed circuit board with its silkscreen on top.
function pcb(w, t, d, color, draw, info) {
  const top = pcbMat(color, silk(w, d, color, draw));
  const side = pcbMat(color);
  const m = mesh(new THREE.BoxGeometry(w, t, d), [side, side, top, side, side, side], info);
  return m;
}

// ---- Parts and pins -----------------------------------------------------------

function makePart(kind, title, info) {
  const g = new THREE.Group();
  g.name = kind;
  g.userData.part = { kind, title, info, pins: new Map() };
  g.userData.info = { title, text: info };
  return g;
}

// A pin: a named point where wires connect. The marker (a small glowing
// dot) only shows while wiring.
function addPin(part, name, pos, label = name, extra = {}) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), MAT.marker);
  marker.position.copy(pos);
  marker.visible = false;
  marker.renderOrder = 10;
  marker.userData.pin = name;
  marker.userData.noPick = true;
  part.add(marker);
  part.userData.part.pins.set(name, { name, label, pos: pos.clone(), marker, ...extra });
}

export function pinWorld(part, name, target = new THREE.Vector3()) {
  const pin = part.userData.part.pins.get(name);
  return part.localToWorld(target.copy(pin.pos));
}

export function showPins(part, on) {
  for (const pin of part.userData.part.pins.values()) pin.marker.visible = on;
}

// A male header pin: a gold post through a black plastic spacer.
function headerPost(height = 0.6) {
  const g = new THREE.Group();
  g.add(at(box(0.064, height, 0.064, MAT.gold), 0, height / 2 - 0.25, 0));
  g.add(at(box(0.25, 0.25, 0.25, MAT.blackPlastic), 0, -0.125, 0));
  return g;
}

// A row of female header sockets (Arduino style).
function femaleHeader(n) {
  const w = n * PITCH;
  const tex = silk(w, PITCH, "#121212", (g, s) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = "#000";
      const x = (i - (n - 1) / 2) * PITCH;
      g.fillRect((x - 0.045) * s, -0.045 * s, 0.09 * s, 0.09 * s);
    }
  }, 300);
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  return mesh(new THREE.BoxGeometry(w, 0.85, PITCH), [MAT.blackPlastic, MAT.blackPlastic, top, MAT.blackPlastic, MAT.blackPlastic, MAT.blackPlastic]);
}

// A small surface-mount part: black body, tin end caps or legs.
function smd(w, d, h = 0.06, mat = MAT.chip) {
  const g = new THREE.Group();
  g.add(at(box(w, h, d, mat), 0, h / 2, 0));
  return g;
}

function tactile(info) {
  const g = new THREE.Group();
  g.add(at(box(0.35, 0.14, 0.35, MAT.steel), 0, 0.07, 0));
  g.add(at(cyl(0.09, 0.09, 0.12, MAT.blackPlastic), 0, 0.2, 0));
  g.userData.info = info;
  g.traverse((m) => { if (m.isMesh) m.userData.info = info; });
  return g;
}

function smallLed(color, info) {
  const m = box(0.16, 0.07, 0.08, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.15, roughness: 0.3 }), info);
  m.userData.ledMat = m.material;
  return m;
}

// ---- ESP32 DevKitC (38 pins) ----------------------------------------------

export const ESP32_LEFT = ["3V3", "EN", "IO36", "IO39", "IO34", "IO35", "IO32", "IO33", "IO25", "IO26", "IO27", "IO14", "IO12", "GND1", "IO13", "SD2", "SD3", "CMD", "5V"];
export const ESP32_RIGHT = ["GND2", "IO23", "IO22", "TX", "RX", "IO21", "GND3", "IO19", "IO18", "IO5", "IO17", "IO16", "IO4", "IO0", "IO2", "IO15", "SD1", "SD0", "CLK"];
const pinText = (n) => n.replace(/^GND\d$/, "GND").replace(/^IO/, "");

export const ESP32_NOTES = {
  module: { title: "ESP32-WROOM-32 module", text: "The brain: an ESP32 chip with two Xtensa LX6 cores at up to 240 MHz, 520 KB of RAM, 4 MB of flash, Wi-Fi and Bluetooth, all under one metal shield that blocks radio noise." },
  antenna: { title: "PCB antenna", text: "The zig-zag copper trace is the Wi-Fi and Bluetooth antenna. Keep metal, wires and batteries away from it, or the range drops sharply." },
  usb: { title: "Micro-USB port", text: "Powers the board with 5 V and carries your code from the computer. It also opens the Serial Monitor." },
  uart: { title: "USB-to-serial chip (CP2102)", text: "Translates USB into the serial signals the ESP32 understands, so the Arduino IDE can upload sketches and print messages." },
  reg: { title: "3.3 V regulator (AMS1117)", text: "The ESP32 runs on 3.3 V. This regulator turns the 5 V from USB or the 5V pin into a steady 3.3 V. Its GPIO pins are 3.3 V too, and not 5 V tolerant." },
  en: { title: "EN button", text: "Reset. Pressing it restarts your program from setup()." },
  boot: { title: "BOOT button", text: "Holds GPIO0 low. Hold it while pressing EN to enter upload mode, if the board doesn't do it on its own." },
  pins: { title: "GPIO header pins", text: "38 pins, 0.1 inch apart. Most can be inputs or outputs, PWM, touch or ADC. Pins 34 to 39 are input only. Pins 6 to 11 (SD0 to CMD) belong to the flash memory: never use them." },
};

export function esp32() {
  const part = makePart("esp32", "ESP32 DevKitC", "A Wi-Fi and Bluetooth microcontroller board. It runs your code, reads sensors and drives the motor controller.");
  const W = 5.5, D = 2.8, T = 0.16;
  const rowZ = 1.27;
  const pinX = (i) => 2.286 - i * PITCH;
  const board = pcb(W, T, D, "#121417", (g, s) => {
    // Pin labels along each header, plus the board's name.
    ESP32_LEFT.forEach((n, i) => text(g, s, pinText(n), pinX(i), -rowZ + 0.27, { size: 0.085, rot: Math.PI / 2, align: "left" }));
    ESP32_RIGHT.forEach((n, i) => text(g, s, pinText(n), pinX(i), rowZ - 0.27, { size: 0.085, rot: Math.PI / 2, align: "right" }));
    for (const z of [-rowZ, rowZ]) for (let i = 0; i < 19; i++) {
      g.fillStyle = "#c9a94a";
      g.beginPath(); g.arc(pinX(i) * s, z * s, 0.065 * s, 0, Math.PI * 2); g.fill();
    }
    text(g, s, "ESP32-DevKitC", -1.25, 0.55, { size: 0.14, weight: 700 });
    text(g, s, "EN", -2.2, -0.42, { size: 0.09 });
    text(g, s, "BOOT", -2.2, 0.42, { size: 0.09 });
  }, ESP32_NOTES.pins);
  board.position.y = T / 2;
  part.add(board);

  // The module: a metal shield and its antenna.
  const shieldTex = silk(1.75, 1.8, "#b8bec6", (g, s) => {
    text(g, s, "ESP32-WROOM-32", 0, -0.35, { size: 0.15, color: "#3a3f46", weight: 700 });
    text(g, s, "Wi-Fi + BT + BLE", 0, -0.08, { size: 0.1, color: "#3a3f46" });
    text(g, s, "ESPRESSIF", 0, 0.25, { size: 0.12, color: "#3a3f46", weight: 800 });
    text(g, s, "FCC ID: 2AC7Z-ESPWROOM32", 0, 0.5, { size: 0.07, color: "#4a5058" });
  });
  const shieldTop = new THREE.MeshStandardMaterial({ map: shieldTex, metalness: 0.85, roughness: 0.32 });
  const shield = mesh(new THREE.BoxGeometry(1.75, 0.24, 1.8), [MAT.silver, MAT.silver, shieldTop, MAT.silver, MAT.silver, MAT.silver], ESP32_NOTES.module);
  at(shield, 1.0, T + 0.08 + 0.12, 0);
  part.add(shield);
  const modPcb = box(2.55, 0.08, 1.8, pcbMat("#1d2a3a"), ESP32_NOTES.module);
  at(modPcb, 1.4, T + 0.04, 0);
  part.add(modPcb);
  // The antenna's meander trace.
  const pts = [];
  for (let i = 0; i < 7; i++) {
    const z = -0.7 + i * 0.23;
    pts.push(new THREE.Vector3(2.15, 0, z), new THREE.Vector3(2.55, 0, z));
  }
  const trace = new THREE.Group();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const seg = box(len + 0.04, 0.012, 0.04, MAT.gold, ESP32_NOTES.antenna);
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.position.y = T + 0.086;
    seg.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    trace.add(seg);
  }
  part.add(trace);

  // USB, the USB chip, the regulator, buttons and the power LED.
  part.add(at(box(0.6, 0.3, 0.78, MAT.silver, ESP32_NOTES.usb, 0.06), -2.5, T + 0.15, 0));
  const uart = smd(0.5, 0.5, 0.09); uart.children[0].userData.info = ESP32_NOTES.uart;
  part.add(at(uart, -1.25, T, -0.05));
  const reg = smd(0.65, 0.35, 0.16); reg.children[0].userData.info = ESP32_NOTES.reg;
  reg.add(at(box(0.3, 0.02, 0.18, MAT.tin), 0, 0.03, -0.25));
  part.add(at(reg, -0.4, T, -0.5));
  part.add(at(tactile(ESP32_NOTES.en), -2.2, T, -0.72));
  part.add(at(tactile(ESP32_NOTES.boot), -2.2, T, 0.72));
  const pwr = smallLed("#ff3030", { title: "Power LED", text: "Lights when the board has power." });
  part.add(at(pwr, -1.65, T + 0.035, 0.55));
  for (let i = 0; i < 6; i++) part.add(at(smd(0.1, 0.05, 0.04, MAT.ceramic), -0.2 + i * 0.2, T, 0.55));

  // Header pins: pins under the board, solder joints on top where wires go.
  ESP32_LEFT.forEach((n, i) => {
    const post = headerPost(0.85);
    part.add(at(post, pinX(i), -0.26, -rowZ));
    addPin(part, n, new THREE.Vector3(pinX(i), T + 0.05, -rowZ), pinText(n));
  });
  ESP32_RIGHT.forEach((n, i) => {
    const post = headerPost(0.85);
    part.add(at(post, pinX(i), -0.26, rowZ));
    addPin(part, n, new THREE.Vector3(pinX(i), T + 0.05, rowZ), pinText(n));
  });
  part.userData.powerLed = pwr;
  part.userData.size = { w: W, h: 0.9, d: D, base: 0.51 }; // its pins stand 0.51 below the board
  return part;
}

// ---- Arduino Uno R3 --------------------------------------------------------

export const UNO_NOTES = {
  mcu: { title: "ATmega328P microcontroller", text: "The Uno's brain: an 8-bit chip at 16 MHz with 32 KB of flash for your sketch, 2 KB of RAM and 1 KB of EEPROM. It runs at 5 V." },
  crystal: { title: "16 MHz crystal", text: "The heartbeat. It ticks 16 million times a second, and every instruction and delay() is timed from it." },
  usb: { title: "USB-B port", text: "Uploads sketches from the computer and powers the board with 5 V. It also carries Serial.println() messages back." },
  jack: { title: "DC barrel jack", text: "Plug in 7 to 12 V here (a 9 V battery or adapter). The on-board regulator brings it down to 5 V." },
  reg: { title: "5 V regulator", text: "Turns the barrel-jack voltage into a steady 5 V for the chip and the 5V pin." },
  reset: { title: "Reset button", text: "Restarts your sketch from the top of setup()." },
  usbChip: { title: "ATmega16U2 USB chip", text: "A second small microcontroller that talks USB to the computer and serial to the main chip." },
  digital: { title: "Digital pins 0 to 13", text: "Each can be an input or an output, HIGH (5 V) or LOW (0 V). Pins marked ~ (3, 5, 6, 9, 10, 11) can also do PWM. 0 and 1 are shared with USB serial." },
  analog: { title: "Analog inputs A0 to A5", text: "Read a voltage from 0 to 5 V as a number from 0 to 1023, with analogRead(). They can also act as digital pins." },
  power: { title: "Power header", text: "5V and 3.3V outputs for sensors, GND (ground, 0 V), and Vin (the raw voltage from the barrel jack)." },
  ledL: { title: "LED \"L\"", text: "A tiny LED wired to pin 13 through a resistor. Blink lights it without any wiring." },
};

export function arduinoUno() {
  const part = makePart("uno", "Arduino Uno R3", "The classic beginner board: an ATmega328P running at 16 MHz and 5 V, with 14 digital and 6 analog pins.");
  const W = 6.86, D = 5.34, T = 0.16;
  const digitalX = (n) => (n < 8 ? 3.05 - n * PITCH : 1.0 - (n - 8) * PITCH);
  const board = pcb(W, T, D, "#0e7c86", (g, s) => {
    for (let n = 0; n < 14; n++) {
      text(g, s, (n === 3 || n === 5 || n === 6 || n === 9 || n === 10 || n === 11 ? "~" : "") + n, digitalX(n), -2.08, { size: 0.12, rot: -Math.PI / 2 });
    }
    ["GND", "AREF"].forEach((t, i) => text(g, s, t, 1.0 - (6 + i) * PITCH, -2.0, { size: 0.09, rot: -Math.PI / 2 }));
    text(g, s, "DIGITAL (PWM~)", 1.7, -1.62, { size: 0.15, weight: 700 });
    ["IOREF", "RESET", "3.3V", "5V", "GND", "GND", "Vin"].forEach((t, i) => text(g, s, t, -0.6 + i * PITCH, 2.0, { size: 0.09, rot: -Math.PI / 2 }));
    ["A0", "A1", "A2", "A3", "A4", "A5"].forEach((t, i) => text(g, s, t, 1.6 + i * PITCH, 2.05, { size: 0.1, rot: -Math.PI / 2 }));
    text(g, s, "POWER", 0.16, 1.62, { size: 0.15, weight: 700 });
    text(g, s, "ANALOG IN", 2.25, 1.62, { size: 0.15, weight: 700 });
    text(g, s, "UNO", 0.2, -0.35, { size: 0.62, weight: 800, font: "Georgia, serif" });
    text(g, s, "ARDUINO", 0.2, 0.3, { size: 0.3, weight: 800 });
    text(g, s, "L", 0.95, -1.25, { size: 0.11 });
    text(g, s, "TX", 0.95, -0.95, { size: 0.1 });
    text(g, s, "RX", 0.95, -0.8, { size: 0.1 });
    text(g, s, "ON", 2.6, -0.6, { size: 0.1 });
    g.strokeStyle = "#f4f4f4";
    g.lineWidth = 0.02 * s;
    g.strokeRect(-0.9 * s, -0.95 * s, 2.2 * s, 1.5 * s);
  }, { title: "Arduino Uno R3", text: "A 6.9 × 5.3 cm board. Everything on it supports the one chip in the middle." });
  board.position.y = T / 2;
  part.add(board);

  // The ATmega328P in its 28-pin DIP socket.
  const chipTex = silk(3.5, 0.75, "#18191c", (g, s) => {
    text(g, s, "ATMEGA328P-PU", 0.2, -0.08, { size: 0.16, color: "#cfd3d8", weight: 700 });
    text(g, s, "1840  ●  AU", 0.2, 0.15, { size: 0.11, color: "#9aa0a8" });
    g.fillStyle = "#0a0a0a"; g.beginPath(); g.arc(-1.6 * s, 0, 0.12 * s, -Math.PI / 2, Math.PI / 2); g.fill();
  }, 220);
  const chipTop = new THREE.MeshStandardMaterial({ map: chipTex, roughness: 0.5 });
  const mcu = mesh(new THREE.BoxGeometry(3.5, 0.38, 0.75), [MAT.chip, MAT.chip, chipTop, MAT.chip, MAT.chip, MAT.chip], UNO_NOTES.mcu);
  at(mcu, 1.3, T + 0.38, 1.0);
  part.add(mcu);
  part.add(at(box(3.6, 0.2, 0.95, MAT.darkPlastic, UNO_NOTES.mcu), 1.3, T + 0.1, 1.0));
  for (let i = 0; i < 14; i++) for (const z of [0.6, 1.4]) part.add(at(box(0.05, 0.2, 0.06, MAT.tin), 1.3 + (i - 6.5) * PITCH, T + 0.25, z));

  part.add(at(box(1.6, 1.1, 1.2, MAT.silver, UNO_NOTES.usb, 0.05), -3.0, T + 0.55, -1.55));
  part.add(at(box(1.4, 1.05, 0.9, MAT.blackPlastic, UNO_NOTES.jack, 0.08), -3.0, T + 0.52, 1.75));
  const xtal = box(0.95, 0.35, 0.38, MAT.silver, UNO_NOTES.crystal, 0.15);
  part.add(at(xtal, -0.45, T + 0.17, 1.0));
  const reg = smd(0.65, 0.65, 0.22); reg.children[0].userData.info = UNO_NOTES.reg;
  reg.add(at(box(0.6, 0.03, 0.25, MAT.tin), 0, 0.02, -0.4));
  part.add(at(reg, -2.4, T, 0.6));
  const usbChip = smd(0.5, 0.5, 0.09); usbChip.children[0].userData.info = UNO_NOTES.usbChip;
  part.add(at(usbChip, -1.7, T, -1.3));
  part.add(at(tactile(UNO_NOTES.reset), -2.2, T, -2.2));
  for (const [x, z, r] of [[-1.7, 0.95, 0.32], [-1.0, 1.85, 0.32]]) part.add(at(cyl(r, r, 0.75, MAT.darkPlastic, { title: "Capacitor", text: "Smooths the supply, like a small water tank evening out the flow." }), x, T + 0.38, z));

  const ledL = smallLed("#ffb020", UNO_NOTES.ledL);
  part.add(at(ledL, 0.75, T + 0.035, -1.25));
  const ledTx = smallLed("#ffb020", { title: "TX LED", text: "Flickers when the board sends serial data to the computer." });
  part.add(at(ledTx, 0.75, T + 0.035, -0.95));
  const ledRx = smallLed("#ffb020", { title: "RX LED", text: "Flickers when the board receives serial data, such as a sketch being uploaded." });
  part.add(at(ledRx, 0.75, T + 0.035, -0.8));
  const ledOn = smallLed("#38e070", { title: "ON LED", text: "Lights while the board has power." });
  part.add(at(ledOn, 2.6, T + 0.035, -0.4));
  ledOn.material.emissiveIntensity = 1.6;

  // Female headers: digital (top edge), power and analog (bottom edge).
  const headerY = T + 0.43;
  const dig1 = femaleHeader(8); dig1.userData.info = UNO_NOTES.digital;
  part.add(at(dig1, digitalX(0) - 3.5 * PITCH, headerY, -2.42));
  const dig2 = femaleHeader(10); dig2.userData.info = UNO_NOTES.digital;
  part.add(at(dig2, digitalX(8) - 4.5 * PITCH, headerY, -2.42));
  const pwrH = femaleHeader(8); pwrH.userData.info = UNO_NOTES.power;
  part.add(at(pwrH, -0.6 + 2.5 * PITCH, headerY, 2.42));
  const anaH = femaleHeader(6); anaH.userData.info = UNO_NOTES.analog;
  part.add(at(anaH, 1.6 + 2.5 * PITCH, headerY, 2.42));

  const top = T + 0.86;
  for (let n = 0; n < 14; n++) addPin(part, `D${n}`, new THREE.Vector3(digitalX(n), top, -2.42), `D${n}`);
  addPin(part, "GND_D", new THREE.Vector3(1.0 - 6 * PITCH, top, -2.42), "GND");
  ["3V3", "5V", "GND", "GND_2", "VIN"].forEach((n, i) => addPin(part, n, new THREE.Vector3(-0.6 + (i + 2) * PITCH, top, 2.42), n.replace("_2", "")));
  for (let i = 0; i < 6; i++) addPin(part, `A${i}`, new THREE.Vector3(1.6 + i * PITCH, top, 2.42), `A${i}`);

  part.userData.leds = { L: ledL, TX: ledTx, RX: ledRx, ON: ledOn };
  part.userData.size = { w: W, h: 1.2, d: D, base: 0 };
  return part;
}

// ---- Breadboard (half size, 400 points) -------------------------------------

export function breadboard() {
  const part = makePart("breadboard", "Half-size breadboard", "Push parts and wires into the holes to build a circuit without soldering. Metal clips inside join the holes in groups.");
  const COLS = 30, W = 8.25, D = 5.5, H = 0.85;
  const colX = (c) => (c - (COLS - 1) / 2) * PITCH;
  const rowZ = (r) => (r < 5 ? -0.381 - (4 - r) * PITCH : 0.381 + (r - 5) * PITCH); // a..e, then f..j
  const railZ = [-2.31, -2.06, 2.06, 2.31]; // top -, top +, bottom +, bottom -
  const railX = (i) => (i - 12 + Math.floor(i / 5) - 2) * PITCH; // groups of five, a gap between groups
  const tex = silk(W, D, "#f1eee5", (g, s) => {
    g.fillStyle = "#1a1a1a";
    const hole = (x, z) => g.fillRect((x - 0.04) * s, (z - 0.04) * s, 0.08 * s, 0.08 * s);
    for (let c = 0; c < COLS; c++) for (let r = 0; r < 10; r++) hole(colX(c), rowZ(r));
    for (const z of railZ) for (let i = 0; i < 25; i++) hole(railX(i), z);
    g.fillStyle = "#e7e3d8"; g.fillRect(-W / 2 * s, -0.12 * s, W * s, 0.24 * s); // centre channel
    g.fillStyle = "#cfcabd"; g.fillRect(-W / 2 * s, -0.05 * s, W * s, 0.1 * s);
    for (const [z, col] of [[-2.5, "#d33"], [-1.88, "#26c"], [1.88, "#d33"], [2.5, "#26c"]]) { g.fillStyle = col; g.fillRect(-3.4 * s, (z - 0.012) * s, 6.8 * s, 0.024 * s); }
    text(g, s, "–", -3.75, -2.31, { size: 0.22, color: "#26c", weight: 800 });
    text(g, s, "+", -3.75, -2.06, { size: 0.22, color: "#d33", weight: 800 });
    text(g, s, "+", -3.75, 2.06, { size: 0.22, color: "#d33", weight: 800 });
    text(g, s, "–", -3.75, 2.31, { size: 0.22, color: "#26c", weight: 800 });
    "abcde".split("").forEach((l, i) => text(g, s, l, -3.95, rowZ(i), { size: 0.12, color: "#777" }));
    "fghij".split("").forEach((l, i) => text(g, s, l, -3.95, rowZ(5 + i), { size: 0.12, color: "#777" }));
    for (let c = 0; c < COLS; c += 5) text(g, s, String(c + 1), colX(c), -1.7, { size: 0.11, color: "#777" });
  }, 200);
  const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, transparent: true });
  const white = new THREE.MeshStandardMaterial({ color: "#f0eee6", roughness: 0.65, transparent: true });
  const body = mesh(new THREE.BoxGeometry(W, H, D), [white, white, topMat, white, white, white], part.userData.info);
  body.position.y = H / 2;
  part.add(body);
  part.userData.body = body;
  part.userData.topMat = topMat;

  // The hidden metal clips. Each column of five holes (a-e or f-j) shares one;
  // each power rail is one long clip.
  const clips = new THREE.Group();
  // Phosphor-bronze spring clips, tin plated.
  const clipMat = new THREE.MeshStandardMaterial({ color: "#a98a5a", metalness: 0.7, roughness: 0.4, emissive: "#4cc9ff", emissiveIntensity: 0 });
  part.userData.clipMat = clipMat;
  part.userData.clips = [];
  for (let c = 0; c < COLS; c++) for (const half of [0, 1]) {
    const z0 = rowZ(half * 5), z1 = rowZ(half * 5 + 4);
    const clip = box(0.16, 0.5, Math.abs(z1 - z0) + 0.2, clipMat.clone());
    at(clip, colX(c), H - 0.35, (z0 + z1) / 2);
    clip.userData.group = { kind: "column", c, half };
    clips.add(clip);
    part.userData.clips.push(clip);
  }
  for (const z of railZ) {
    const clip = box(6.9, 0.5, 0.16, clipMat.clone());
    at(clip, (railX(0) + railX(24)) / 2, H - 0.35, z);
    clip.userData.group = { kind: "rail", z };
    clips.add(clip);
    part.userData.clips.push(clip);
  }
  clips.visible = false;
  part.add(clips);
  part.userData.clipGroup = clips;
  // 1 = solid plastic, lower = see the clips through it.
  part.userData.seeThrough = 1;
  part.userData.setSeeThrough = (k) => {
    part.userData.seeThrough = k;
    topMat.opacity = white.opacity = k;
    topMat.depthWrite = white.depthWrite = k > 0.95;
    clips.visible = k < 0.98;
  };
  // Lights the clip under a hole (or none).
  part.userData.lightClip = (clip) => {
    for (const c of part.userData.clips) c.material.emissiveIntensity = c === clip ? 0.9 : 0;
  };
  // The clip that joins a point on the board (local x, z), and its holes.
  part.userData.clipAt = (x, z) => {
    const c = Math.round(x / PITCH + (COLS - 1) / 2);
    if (Math.abs(z) > 1.85) {
      const zi = railZ.reduce((best, rz, i) => (Math.abs(rz - z) < Math.abs(railZ[best] - z) ? i : best), 0);
      return { clip: part.userData.clips[COLS * 2 + zi], name: ["top − rail", "top + rail", "bottom + rail", "bottom − rail"][zi] };
    }
    if (c < 0 || c >= COLS || Math.abs(z) < 0.2) return null;
    const half = z < 0 ? 0 : 1;
    return { clip: part.userData.clips[c * 2 + half], name: half ? `f${c + 1} to j${c + 1}` : `a${c + 1} to e${c + 1}` };
  };

  // Where a leg goes into a hole: column 0..29, row "a".."j".
  part.userData.hole = (c, r) => new THREE.Vector3(colX(c), H, rowZ("abcdefghij".indexOf(r)));
  part.userData.rail = (i, which) => new THREE.Vector3(railX(i), H, railZ[["top-", "top+", "bottom+", "bottom-"].indexOf(which)]);
  part.userData.size = { w: W, h: H, d: D, base: 0 };
  return part;
}

// ---- LED, resistor, button ----------------------------------------------------

export const LED_COLORS = {
  red: { hex: "#ff2a1f", vf: 2.0, nm: 630 },
  yellow: { hex: "#ffc21a", vf: 2.1, nm: 590 },
  green: { hex: "#22ff5a", vf: 3.0, nm: 525 },
  blue: { hex: "#2f6bff", vf: 3.1, nm: 465 },
  white: { hex: "#f4f7ff", vf: 3.2, nm: 0 },
};

// A 5 mm LED. Legs hang down from y = 0; the dome sits above. The anode (+)
// leg is the longer one; the cathode side of the rim is flat.
export function led(colorName = "red", { legs = 1.6 } = {}) {
  const c = LED_COLORS[colorName];
  const part = makePart("led", `${colorName[0].toUpperCase()}${colorName.slice(1)} LED`, `A light-emitting diode. Current only flows one way, from the long leg (anode, +) to the short leg (cathode, −). It needs about ${c.vf} V and up to 20 mA.`);
  const epoxy = new THREE.MeshPhysicalMaterial({
    color: c.hex, emissive: c.hex, emissiveIntensity: 0.05, roughness: 0.12, metalness: 0,
    transparent: true, opacity: 0.55, clearcoat: 1, clearcoatRoughness: 0.1, depthWrite: false,
  });
  const domeInfo = { title: "Epoxy lens", text: "The clear coloured dome protects the tiny chip inside and focuses its light into a beam." };
  const body = cyl(0.25, 0.25, 0.55, epoxy, domeInfo, 32);
  at(body, 0, 0.4, 0);
  const cap = mesh(new THREE.SphereGeometry(0.25, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), epoxy, domeInfo);
  at(cap, 0, 0.675, 0);
  // The rim, with its flat on the cathode side.
  const rimGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.1, 32, 1, false, 0.5, Math.PI * 2 - 1.0);
  const rim = mesh(rimGeo, epoxy, { title: "Flat edge", text: "The rim is flat on the cathode (−) side, so you can tell the legs apart even after they're trimmed." });
  at(rim, 0, 0.16, 0);
  rim.rotation.y = Math.PI / 2 - 0.5 + Math.PI;
  part.add(body, cap, rim);
  // Inside: the big anvil (cathode) holding the chip, and the thin post (anode).
  const anvil = box(0.16, 0.32, 0.05, MAT.steel, { title: "Anvil (cathode)", text: "The larger metal piece inside. Its little cup holds the light-emitting chip." });
  at(anvil, 0.1, 0.35, 0);
  const post = box(0.05, 0.32, 0.05, MAT.steel, { title: "Post (anode)", text: "The thin metal piece inside. A hair-thin gold bond wire joins it to the top of the chip." });
  at(post, -0.11, 0.35, 0);
  const chip = box(0.06, 0.03, 0.06, new THREE.MeshStandardMaterial({ color: c.hex, emissive: c.hex, emissiveIntensity: 0.2 }), { title: "LED chip (die)", text: `A tiny crystal of semiconductor. When current crosses its junction, electrons drop energy and give it off as ${c.nm ? `light at about ${c.nm} nm` : "blue light that a phosphor turns white"}.` });
  at(chip, 0.1, 0.52, 0);
  part.add(anvil, post, chip);
  // Legs.
  const legA = cyl(0.025, 0.025, legs, MAT.tin, { title: "Anode (+), the long leg", text: "Connect it toward the positive side, the Arduino pin or + supply." }, 8);
  at(legA, -PITCH / 2, 0.2 - legs / 2, 0);
  const legK = cyl(0.025, 0.025, legs - 0.18, MAT.tin, { title: "Cathode (−), the short leg", text: "Connect it toward ground (GND)." }, 8);
  at(legK, PITCH / 2, 0.2 - (legs - 0.18) / 2, 0);
  part.add(legA, legK);
  addPin(part, "A", new THREE.Vector3(-PITCH / 2, 0.2 - legs, 0), "Anode +");
  addPin(part, "K", new THREE.Vector3(PITCH / 2, 0.2 - legs + 0.18, 0), "Cathode −");

  // A glow sprite that grows with brightness.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: c.hex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(2.4);
  glow.position.y = 0.55;
  glow.userData.noPick = true;
  part.add(glow);
  let level = 0;
  part.userData.setBrightness = (b) => {
    level = Math.max(0, Math.min(b, 1.6));
    epoxy.emissiveIntensity = 0.05 + level * 2.2;
    chip.material.emissiveIntensity = 0.2 + level * 6;
    glow.material.opacity = Math.min(level, 1) * 0.9;
    glow.scale.setScalar(1.5 + level * 2.2);
  };
  part.userData.brightness = () => level;
  part.userData.color = c;
  return part;
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
export { glowTexture };

export const BAND_COLORS = ["#111111", "#8b4513", "#e02020", "#ff8c1a", "#f5d90a", "#1fa83a", "#2050e0", "#8a2be2", "#8f8f8f", "#f5f5f5"];
export const BAND_NAMES = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"];
const GOLD_BAND = "#c8a24a";

// The four colour bands of a resistor value: two digits, a multiplier, and
// gold for 5 % tolerance.
export function resistorBands(ohms) {
  let exp = 0;
  let v = ohms;
  while (v >= 100) { v /= 10; exp++; }
  v = Math.round(v);
  if (v < 10) { v *= 10; exp--; }
  return [Math.floor(v / 10), v % 10, Math.max(exp, 0)];
}

// A through-hole resistor lying flat, legs bent down, holes `span` apart.
export function resistor(ohms = 220, { span = 4 * PITCH, legDown = 0.9 } = {}) {
  const part = makePart("resistor", `${formatOhms(ohms)} resistor`, `Limits current. ${formatOhms(ohms)} means it lets through 1 mA for every ${ohms / 1000} V across it.`);
  const bodyMat = new THREE.MeshStandardMaterial({ color: "#d8c49a", roughness: 0.55 });
  const info = { title: "Resistor body", text: "Carbon or metal film wound round a ceramic core. The thinner and longer the film, the more it resists the current." };
  const body = cyl(0.11, 0.11, 0.55, bodyMat, info, 24);
  body.rotation.z = Math.PI / 2;
  at(body, 0, 0.3, 0);
  part.add(body);
  for (const x of [-0.3, 0.3]) {
    const end = mesh(new THREE.SphereGeometry(0.135, 20, 12), bodyMat, info);
    end.scale.set(0.8, 1, 1);
    at(end, x, 0.3, 0);
    part.add(end);
  }
  const bandMats = [];
  [-0.27, -0.15, -0.05, 0.22].forEach((x, i) => {
    const m = new THREE.MeshStandardMaterial({ color: GOLD_BAND, roughness: 0.4, metalness: i === 3 ? 0.6 : 0 });
    bandMats.push(m);
    const band = cyl(0.122, 0.122, 0.05, m, { title: i === 3 ? "Tolerance band" : `Band ${i + 1}`, text: i === 3 ? "Gold: the real value is within 5 % of the printed one." : i === 2 ? "Multiplier: how many zeros follow the two digits." : `Digit ${i + 1} of the value.` }, 24);
    band.rotation.z = Math.PI / 2;
    at(band, x, 0.3, 0);
    if (Math.abs(x) > 0.25) band.scale.set(1.08, 1, 1.08);
    part.add(band);
  });
  part.userData.setOhms = (o) => {
    const [a, b, m] = resistorBands(o);
    [a, b, m].forEach((v, i) => bandMats[i].color.set(BAND_COLORS[v]));
    bandMats[3].color.set(GOLD_BAND);
    part.userData.ohms = o;
  };
  part.userData.setOhms(ohms);
  part.userData.bodyMat = bodyMat;
  // Leads: out sideways, then bent down into the holes.
  const half = span / 2;
  for (const sx of [-1, 1]) {
    const flat = cyl(0.025, 0.025, half - 0.35, MAT.tin, null, 8);
    flat.rotation.z = Math.PI / 2;
    at(flat, sx * (0.35 + (half - 0.35) / 2), 0.3, 0);
    const down = cyl(0.025, 0.025, 0.3 + legDown, MAT.tin, null, 8);
    at(down, sx * half, 0.3 - (0.3 + legDown) / 2, 0);
    part.add(flat, down);
  }
  addPin(part, "1", new THREE.Vector3(-half, -legDown, 0), "Leg 1");
  addPin(part, "2", new THREE.Vector3(half, -legDown, 0), "Leg 2");
  return part;
}

export function formatOhms(o) {
  if (o >= 1e6) return `${+(o / 1e6).toFixed(2)} MΩ`;
  if (o >= 1000) return `${+(o / 1000).toFixed(2)} kΩ`;
  return `${Math.round(o)} Ω`;
}

// A 6 mm tactile push button straddling the breadboard's centre channel.
export function pushButton() {
  const part = makePart("button", "Push button", "A momentary switch: pressing it joins its two sides. Its four legs are joined in pairs inside.");
  const base = box(0.6, 0.35, 0.8, MAT.blackPlastic, part.userData.info);
  at(base, 0, 0.175, 0);
  const plate = box(0.6, 0.03, 0.8, MAT.steel, part.userData.info);
  at(plate, 0, 0.365, 0);
  const cap = cyl(0.18, 0.18, 0.25, MAT.darkPlastic, { title: "Plunger", text: "Press it and a metal dome inside snaps down, joining the two sides of the switch." });
  at(cap, 0, 0.5, 0);
  part.add(base, plate, cap);
  for (const x of [-PITCH, PITCH]) for (const z of [-0.381, 0.381]) {
    const leg = box(0.05, 0.6, 0.08, MAT.tin);
    at(leg, x, -0.15, z);
    part.add(leg);
  }
  part.userData.cap = cap;
  part.userData.press = (down) => { cap.position.y = down ? 0.4 : 0.5; };
  return part;
}

// ---- Batteries --------------------------------------------------------------

export function battery9v() {
  const part = makePart("battery9v", "9 V battery", "Six small 1.5 V cells stacked inside give 9 V. The snap terminals on top are + (round) and − (hexagonal).");
  const tex = silk(4.85, 2.65, "#111", (g, s) => {
    g.fillStyle = "#e6b422"; g.fillRect(-2.43 * s, -1.33 * s, 1.6 * s, 2.65 * s);
    text(g, s, "9V", -1.6, 0, { size: 0.9, color: "#111", weight: 900, rot: -Math.PI / 2 });
    text(g, s, "ALKALINE", 0.9, -0.3, { size: 0.36, color: "#e6b422", weight: 800 });
    text(g, s, "6LR61  •  9 VOLT", 0.9, 0.35, { size: 0.22, color: "#ddd" });
  });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.2 });
  // A rounded black case, with the label on a thin plate on top.
  const body = mesh(new RoundedBoxGeometry(4.85, 1.75, 2.65, 3, 0.18), MAT.blackPlastic, part.userData.info);
  at(body, 0, 0.875, 0);
  const label = mesh(new THREE.PlaneGeometry(4.6, 2.5), top, part.userData.info);
  label.rotation.x = -Math.PI / 2;
  at(label, 0, 1.752, 0);
  part.add(body, label);
  const plus = cyl(0.35, 0.35, 0.35, MAT.silver, { title: "+ terminal", text: "The round snap. Current leaves from here, round the circuit, and back into −." }, 24);
  plus.rotation.z = Math.PI / 2;
  at(plus, 2.6, 0.875, -0.6);
  const minus = cyl(0.42, 0.42, 0.35, MAT.silver, { title: "− terminal", text: "The hexagonal snap: the return path, 0 V." }, 6);
  minus.rotation.z = Math.PI / 2;
  at(minus, 2.6, 0.875, 0.6);
  part.add(plus, minus);
  addPin(part, "+", new THREE.Vector3(2.8, 0.875, -0.6), "+9 V");
  addPin(part, "-", new THREE.Vector3(2.8, 0.875, 0.6), "−");
  return part;
}

// Two 18650 lithium cells in series (2 × 3.7 V = 7.4 V nominal, 8.4 V full),
// in a holder with an on/off switch and red and black leads.
export function battery2x18650() {
  const part = makePart("battery", "2 × 18650 battery pack", "Two rechargeable lithium cells in series: 7.4 V nominal, 8.4 V fully charged. Plenty of current for two motors.");
  const holder = box(7.7, 1.0, 4.1, MAT.blackPlastic, part.userData.info, 0.12);
  at(holder, 0, 0.5, 0);
  part.add(holder);
  const wrapMats = [new THREE.MeshStandardMaterial({ color: "#2b6fd6", roughness: 0.35, metalness: 0.2 }), new THREE.MeshStandardMaterial({ color: "#2b6fd6", roughness: 0.35, metalness: 0.2 })];
  for (const [i, z] of [-1, 1].map((z, i) => [i, z])) {
    const cell = cyl(0.9, 0.9, 6.5, wrapMats[i], { title: "18650 lithium cell", text: "18 mm across, 65 mm long, 3.7 V. Treat it with respect: never short it, crush it or overcharge it." }, 32);
    cell.rotation.z = Math.PI / 2;
    at(cell, 0, 1.2, z * 1.0);
    part.add(cell);
    for (const sx of [-1, 1]) {
      const cap = cyl(0.88, 0.88, 0.06, MAT.silver, null, 32);
      cap.rotation.z = Math.PI / 2;
      at(cap, sx * 3.26, 1.2, z * 1.0);
      part.add(cap);
    }
    const nub = cyl(0.3, 0.3, 0.12, MAT.silver, null, 20);
    nub.rotation.z = Math.PI / 2;
    at(nub, (i === 0 ? 1 : -1) * 3.34, 1.2, z * 1.0);
    part.add(nub);
  }
  for (const sx of [-1, 1]) part.add(at(box(0.2, 1.8, 4.1, MAT.blackPlastic, part.userData.info), sx * 3.75, 0.9, 0));
  const sw = box(0.8, 0.5, 0.5, MAT.darkPlastic, { title: "Power switch", text: "Cuts the battery off completely. Always switch off before changing wires." });
  at(sw, -3.2, 0.5, 2.3);
  const knob = box(0.25, 0.25, 0.25, MAT.whitePlastic);
  at(knob, -3.35, 0.65, 2.5);
  part.add(sw, knob);
  part.userData.switchKnob = knob;
  // Leads: red (+) and black (−) wires ending in pins.
  const leadEnd = (color, z) => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(3.85, 0.5, z), new THREE.Vector3(4.6, 0.6, z), new THREE.Vector3(5.1, 0.6, z * 0.6)]);
    const tube = mesh(new THREE.TubeGeometry(curve, 16, 0.09, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    part.add(tube);
    part.add(at(box(0.25, 0.25, 0.25, MAT.tin), 5.15, 0.6, z * 0.6));
  };
  leadEnd("#d42020", -0.7);
  leadEnd("#151515", 0.7);
  addPin(part, "+", new THREE.Vector3(5.2, 0.6, -0.42), "+ (red)");
  addPin(part, "-", new THREE.Vector3(5.2, 0.6, 0.42), "− (black)");
  part.userData.size = { w: 9, h: 2.2, d: 4.1, base: 0 };
  return part;
}

// ---- L298N dual H-bridge motor driver -----------------------------------------

export const L298N_NOTES = {
  chip: { title: "L298N chip", text: "Two H-bridges in one package. Each can push up to 2 A through a motor, either way round. It loses about 2 V inside, which becomes heat." },
  sink: { title: "Heatsink", text: "The black aluminium fins carry the chip's heat away. Under heavy load it gets too hot to touch." },
  out: { title: "Motor outputs", text: "OUT1 and OUT2 drive motor A, OUT3 and OUT4 drive motor B. Swap a motor's two wires and it spins the other way." },
  power: { title: "Power terminal", text: "+12V takes the battery (5 to 35 V), GND is the shared ground, and +5V gives out 5 V from the on-board regulator while the jumper is fitted." },
  logic: { title: "Control pins", text: "IN1 and IN2 set motor A's direction, IN3 and IN4 motor B's. ENA and ENB set speed with PWM; with their jumpers on, they're always fully on." },
  reg: { title: "78M05 regulator", text: "Makes 5 V from the battery for the logic, and for the +5V terminal (enough to power an ESP32)." },
  cap: { title: "Filter capacitors", text: "Absorb the voltage spikes motors throw back into the supply." },
};

export const L298N_PINS = ["ENA", "IN1", "IN2", "IN3", "IN4", "ENB"];

export function l298n() {
  const part = makePart("driver", "L298N motor driver", "Lets a 3.3 V microcontroller pin control a hungry motor: the pin gives the order, the driver delivers the power from the battery.");
  const W = 4.3, T = 0.16;
  const board = pcb(W, T, W, "#b3121c", (g, s) => {
    text(g, s, "L298N", 0, 0.35, { size: 0.3, weight: 800 });
    text(g, s, "OUT1", -1.4, -1.25, { size: 0.12 }); text(g, s, "OUT2", -1.4, -0.35, { size: 0.12 });
    text(g, s, "OUT3", 1.4, -1.25, { size: 0.12 }); text(g, s, "OUT4", 1.4, -0.35, { size: 0.12 });
    ["+12V", "GND", "+5V"].forEach((t, i) => text(g, s, t, -1.45 + i * 0.5, 1.35, { size: 0.11 }));
    L298N_PINS.forEach((t, i) => text(g, s, t, 0.12 + i * PITCH, 1.3, { size: 0.075, rot: -Math.PI / 2 }));
    text(g, s, "5V-EN", -0.3, 0.75, { size: 0.09 });
  }, part.userData.info);
  board.position.y = T / 2;
  part.add(board);

  // Heatsink with fins, and the chip bolted to it.
  const sinkMat = new THREE.MeshStandardMaterial({ color: "#1a1b1e", metalness: 0.3, roughness: 0.55 });
  const sink = new THREE.Group();
  sink.add(at(box(2.4, 2.3, 0.35, sinkMat, L298N_NOTES.sink), 0, 1.15, 0));
  for (let i = 0; i < 7; i++) sink.add(at(box(0.12, 2.3, 1.5, sinkMat, L298N_NOTES.sink), -1.1 + i * 0.367, 1.15, -0.85));
  sink.add(at(box(2.4, 0.15, 1.5, sinkMat, L298N_NOTES.sink), 0, 2.25, -0.85));
  at(sink, 0, T, -0.4);
  part.add(sink);
  const chipTex = silk(2.0, 1.0, "#141414", (g, s) => {
    text(g, s, "L298N", 0, -0.12, { size: 0.24, color: "#d8d8d8", weight: 700 });
    text(g, s, "ST  e3  MULTIWATT15", 0, 0.2, { size: 0.1, color: "#999" });
  }, 200);
  const chipFace = new THREE.MeshStandardMaterial({ map: chipTex, roughness: 0.5 });
  const chip = mesh(new THREE.BoxGeometry(2.0, 1.0, 0.45), [MAT.chip, MAT.chip, MAT.chip, MAT.chip, chipFace, MAT.chip], L298N_NOTES.chip);
  at(chip, 0, T + 0.95, -0.0);
  part.add(chip);
  part.add(at(cyl(0.18, 0.18, 0.6, MAT.steel, L298N_NOTES.sink, 16), 0, T + 1.5, -0.05)).children.at(-1).rotation.x = Math.PI / 2;
  for (let i = 0; i < 15; i++) part.add(at(box(0.05, 0.5, 0.04, MAT.tin), -0.85 + i * 0.12, T + 0.25, 0.25 + (i % 2) * 0.12));

  // Screw terminals (blue) with their screws.
  const terminal = (n, info) => {
    const g = new THREE.Group();
    g.add(at(box(0.75, 1.0, n * 0.5, MAT.bluePlastic, info, 0.05), 0, 0.5, 0));
    for (let i = 0; i < n; i++) {
      const screw = cyl(0.17, 0.17, 0.06, MAT.silver, info, 16);
      at(screw, 0, 1.02, (i - (n - 1) / 2) * 0.5);
      const slot = box(0.3, 0.02, 0.05, MAT.chip);
      at(slot, 0, 1.06, (i - (n - 1) / 2) * 0.5);
      g.add(screw, slot);
    }
    return g;
  };
  const outA = terminal(2, L298N_NOTES.out); at(outA, -1.75, T, -0.8); part.add(outA);
  const outB = terminal(2, L298N_NOTES.out); at(outB, 1.75, T, -0.8); part.add(outB);
  const pwr = terminal(3, L298N_NOTES.power); pwr.rotation.y = Math.PI / 2; at(pwr, -0.95, T, 1.75); part.add(pwr);

  // Caps, regulator, logic header with jumpers.
  for (const [x, z] of [[-1.6, 0.55], [1.6, 0.55]]) part.add(at(cyl(0.4, 0.4, 1.1, MAT.chip, L298N_NOTES.cap), x, T + 0.55, z));
  const reg = smd(0.65, 0.5, 0.25); reg.children[0].userData.info = L298N_NOTES.reg;
  part.add(at(reg, 0.4, T, 0.75));
  const header = new THREE.Group();
  L298N_PINS.forEach((n, i) => {
    const post = headerPost(0.85);
    at(post, 0.12 + i * PITCH, T + 0.38, 1.75);
    post.traverse((m) => { if (m.isMesh) m.userData.info = L298N_NOTES.logic; });
    header.add(post);
  });
  part.add(header);
  // Jumpers fitted on ENA and ENB (always full speed) until wires replace them.
  const jumpers = {};
  for (const n of ["ENA", "ENB"]) {
    const i = L298N_PINS.indexOf(n);
    const j = box(0.25, 0.5, 0.5, MAT.blackPlastic, { title: `${n} jumper`, text: `While this cap is on, ${n} is held high: full speed. Pull it off and wire ${n} to a PWM pin to control speed.` }, 0.04);
    at(j, 0.12 + i * PITCH, T + 1.0, 1.62);
    part.add(j);
    jumpers[n] = j;
  }
  part.userData.jumpers = jumpers;

  const termY = T + 1.05;
  addPin(part, "OUT1", new THREE.Vector3(-1.75, termY, -1.05), "OUT1");
  addPin(part, "OUT2", new THREE.Vector3(-1.75, termY, -0.55), "OUT2");
  addPin(part, "OUT3", new THREE.Vector3(1.75, termY, -1.05), "OUT3");
  addPin(part, "OUT4", new THREE.Vector3(1.75, termY, -0.55), "OUT4");
  ["12V", "GND", "5V"].forEach((n, i) => addPin(part, n, new THREE.Vector3(-1.45 + i * 0.5, termY, 1.75), n === "GND" ? "GND" : `+${n}`));
  L298N_PINS.forEach((n, i) => addPin(part, n, new THREE.Vector3(0.12 + i * PITCH, T + 0.85, 1.75), n));
  part.userData.size = { w: W, h: 2.6, d: W, base: 0 };
  return part;
}

// ---- TT gear motor and wheel --------------------------------------------------

// The yellow "TT" gear motor: a small DC motor and a 1:48 plastic gearbox.
// The output shaft points along +x (`side` = -1 mirrors it for the left side).
// Local origin is the shaft's centre on the gearbox face.
export function ttMotor(side = 1) {
  const part = makePart("motor", "TT gear motor", "A 3 to 6 V DC motor with a 1:48 gearbox: about 200 RPM at 6 V, with enough torque to push a small robot.");
  const info = { title: "1:48 gearbox", text: "Plastic gears trade speed for force: the motor spins about 48 times for every turn of the wheel." };
  const g = new THREE.Group();
  g.add(at(box(1.9, 2.25, 3.7, MAT.yellowPlastic, info, 0.12), 0, 0, 0.6));
  g.add(at(box(1.9, 0.6, 1.2, MAT.yellowPlastic, info, 0.1), 0, 0.6, -0.9));
  const motorInfo = { title: "DC motor", text: "Magnets and a spinning coil: current through the coil makes it turn. Reverse the current and it turns the other way." };
  const can = cyl(0.85, 0.85, 2.3, MAT.silver, motorInfo, 32);
  can.rotation.x = Math.PI / 2;
  at(can, 0, -0.1, -2.35);
  const endCap = cyl(0.7, 0.7, 0.25, new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.6 }), motorInfo, 24);
  endCap.rotation.x = Math.PI / 2;
  at(endCap, 0, -0.1, -3.6);
  const clamp = box(1.95, 0.35, 1.0, MAT.whitePlastic, null);
  at(clamp, 0, -0.1, -2.1);
  g.add(can, endCap, clamp);
  for (const sx of [-1, 1]) g.add(at(box(0.15, 0.3, 0.06, MAT.tin), sx * 0.35, -0.1, -3.75));
  // Output shaft, a white D-shaft out of both sides.
  const shaft = cyl(0.27, 0.27, 2.9, MAT.whitePlastic, { title: "Output shaft", text: "The D-shaped shaft the wheel pushes onto. It turns about 200 times a minute at 6 V." }, 20);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  g.position.x = -side * 0.95;
  part.add(g);
  part.userData.shaft = shaft;
  addPin(part, "M+", new THREE.Vector3(-side * 0.95 + 0.35 * side, -0.1, -3.82), "Motor + (red)");
  addPin(part, "M-", new THREE.Vector3(-side * 0.95 - 0.35 * side, -0.1, -3.82), "Motor − (black)");
  part.userData.size = { w: 2.9, h: 2.3, d: 7.4, base: 1.1 };
  part.userData.side = side;
  return part;
}

// A 65 mm TT wheel: yellow rim, rubber tyre with tread. Axle along x.
export function wheel() {
  const part = makePart("wheel", "65 mm wheel", "A rubber tyre on a plastic rim that pushes onto the motor's D-shaft. One turn moves the robot 20.4 cm (π × 6.5 cm).");
  const tyreInfo = { title: "Rubber tyre", text: "Grips the floor. Wheel size decides speed: bigger wheels go further per turn but need more torque." };
  const tyre = new THREE.Group();
  const outer = cyl(3.25, 3.25, 2.6, MAT.rubber, tyreInfo, 48);
  outer.rotation.z = Math.PI / 2;
  tyre.add(outer);
  // Tread blocks around the outside.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const tread = box(2.4, 0.18, 0.3, MAT.rubber);
    tread.position.set(0, Math.cos(a) * 3.28, Math.sin(a) * 3.28);
    tread.rotation.x = -a;
    tyre.add(tread);
  }
  part.add(tyre);
  const rimInfo = { title: "Rim", text: "Holds the tyre and grips the motor shaft." };
  for (const sx of [-1, 1]) {
    const rim = cyl(2.35, 2.35, 0.2, MAT.yellowPlastic, rimInfo, 40);
    rim.rotation.z = Math.PI / 2;
    at(rim, sx * 1.2, 0, 0);
    part.add(rim);
  }
  for (let i = 0; i < 6; i++) {
    const spoke = box(0.3, 4.4, 0.35, MAT.yellowPlastic, rimInfo);
    spoke.rotation.x = (i / 6) * Math.PI;
    at(spoke, 1.25, 0, 0);
    part.add(spoke);
  }
  const hub = cyl(0.6, 0.6, 2.7, MAT.yellowPlastic, rimInfo, 24);
  hub.rotation.z = Math.PI / 2;
  part.add(hub);
  part.userData.size = { w: 2.6, h: 6.5, d: 6.5, base: 0 };
  return part;
}

// A ball caster on brass standoffs, `height` cm from the floor to its top.
export function caster(height = 4.2) {
  const part = makePart("caster", "Ball caster", "A steel ball that rolls any direction: the third point that keeps the robot level while the two wheels steer.");
  const ball = mesh(new THREE.SphereGeometry(0.75, 32, 20), MAT.tin, { title: "Steel ball", text: "Rolls freely in a socket, so the robot can turn on the spot." });
  at(ball, 0, -height + 0.75, 0);
  const cup = cyl(0.95, 1.1, 0.7, MAT.blackPlastic, part.userData.info, 28);
  at(cup, 0, -height + 1.35, 0);
  part.add(ball, cup);
  const brass = new THREE.MeshStandardMaterial({ color: "#c9a241", metalness: 1, roughness: 0.3 });
  for (const x of [-0.8, 0.8]) part.add(at(cyl(0.18, 0.18, height - 1.7, brass, { title: "Brass standoff", text: "Spacers that hold the caster at the right height." }, 6), x, -(height - 1.7) / 2, 0));
  part.add(at(box(2.4, 0.15, 1.0, MAT.blackPlastic), 0, -height + 1.7, 0));
  part.userData.size = { w: 2.4, h: height, d: 2, base: height };
  return part;
}

// ---- HC-SR04 ultrasonic distance sensor ----------------------------------------

export const SR04_PINS = ["VCC", "Trig", "Echo", "GND"];

// Stands upright facing +z, its pins pointing down.
export function hcsr04() {
  const part = makePart("sonar", "HC-SR04 ultrasonic sensor", "Measures distance like a bat: it sends a 40 kHz chirp and times the echo. Range 2 cm to 4 m. Runs on 5 V.");
  const W = 4.5, H = 2.0, T = 0.16;
  const tex = silk(W, H, "#1b5fb8", (g, s) => {
    text(g, s, "HC-SR04", 0, -0.75, { size: 0.2, weight: 800 });
    text(g, s, "T", -1.9, 0.2, { size: 0.22, weight: 800 });
    text(g, s, "R", 1.9, 0.2, { size: 0.22, weight: 800 });
    SR04_PINS.forEach((t, i) => text(g, s, t, (i - 1.5) * PITCH, 0.72, { size: 0.08, rot: -Math.PI / 2 }));
  });
  const face = pcbMat("#1b5fb8", tex);
  const side = pcbMat("#1b5fb8");
  // A board in the XY plane: the silkscreen faces +z.
  const board = mesh(new THREE.BoxGeometry(W, H, T), [side, side, side, side, face, side], part.userData.info);
  at(board, 0, H / 2 + 0.25, 0);
  part.add(board);
  const grill = grillTexture();
  const tInfo = { title: "Transmitter (T)", text: "A piezo speaker. On a 10 µs pulse on Trig it sends eight 40 kHz pulses, far too high for us to hear." };
  const rInfo = { title: "Receiver (R)", text: "A piezo microphone that listens for the echo. Echo stays HIGH for as long as the sound took to go out and back." };
  for (const [x, info, key] of [[-1.3, tInfo, "tx"], [1.3, rInfo, "rx"]]) {
    const can = cyl(0.8, 0.8, 1.2, MAT.silver, info, 32);
    can.rotation.x = Math.PI / 2;
    at(can, x, H / 2 + 0.25, 0.68);
    const mesh_ = mesh(new THREE.CircleGeometry(0.72, 32), new THREE.MeshStandardMaterial({ map: grill, color: "#9aa0a8", metalness: 0.7, roughness: 0.5 }), info);
    at(mesh_, x, H / 2 + 0.25, 1.285);
    part.add(can, mesh_);
    part.userData[key] = new THREE.Vector3(x, H / 2 + 0.25, 1.3);
  }
  const xtal = box(0.9, 0.35, 0.3, MAT.silver, { title: "Crystal", text: "Times the 40 kHz chirp precisely." }, 0.14);
  at(xtal, 0, H / 2 + 0.95, 0.2);
  part.add(xtal);
  SR04_PINS.forEach((n, i) => {
    const pin = box(0.064, 0.6, 0.064, MAT.gold);
    at(pin, (i - 1.5) * PITCH, 0.0, 0);
    part.add(pin);
    addPin(part, n, new THREE.Vector3((i - 1.5) * PITCH, -0.28, 0), n);
  });
  part.userData.size = { w: W, h: H + 0.3, d: 2.6, base: 0.3 };
  return part;
}

let grillTex = null;
function grillTexture() {
  if (grillTex) return grillTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#777"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#222";
  for (let y = 0; y < 128; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < 128; x += 8) g.fillRect(x, y, 4, 4);
  grillTex = new THREE.CanvasTexture(c);
  grillTex.colorSpace = THREE.SRGBColorSpace;
  return grillTex;
}

// ---- Robot chassis --------------------------------------------------------------

// The 2WD chassis: a clear acrylic deck, 9.6 × 22 cm, with a front bracket for
// the distance sensor. Its origin is on the floor under the deck's centre;
// forward is +z. The deck's top is at y = DECK_TOP.
export const DECK_Y = 4.4;
export const DECK_TOP = DECK_Y + 0.3;
export const CHASSIS_W = 9.6;

export function chassis() {
  const part = makePart("chassis", "2WD robot chassis", "A laser-cut acrylic deck, 9.6 × 22 cm. Two driven wheels at the back steer by running at different speeds; a ball caster holds up the front.");
  const acrylic = new THREE.MeshPhysicalMaterial({ color: "#a9d8ff", roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.42, clearcoat: 1, depthWrite: false });
  const deck = mesh(new RoundedBoxGeometry(CHASSIS_W, 0.3, 22, 3, 0.14), acrylic, part.userData.info);
  at(deck, 0, DECK_Y + 0.15, 0);
  deck.castShadow = false;
  part.add(deck);
  // Edges, so the clear deck reads well.
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CHASSIS_W, 0.3, 22)), new THREE.LineBasicMaterial({ color: "#8fd0ff", transparent: true, opacity: 0.55 }));
  at(edges, 0, DECK_Y + 0.15, 0);
  edges.userData.noPick = true;
  part.add(edges);
  // The sensor bracket at the front.
  const bracket = box(5.2, 3.2, 0.25, new THREE.MeshStandardMaterial({ color: "#2d3340", roughness: 0.5 }), { title: "Sensor bracket", text: "Holds the distance sensor upright, looking straight ahead." });
  at(bracket, 0, DECK_TOP + 1.6, 10.6);
  part.add(bracket);
  // Motor mounts under the deck.
  for (const sx of [-1, 1]) part.add(at(box(0.3, 2.0, 2.4, new THREE.MeshStandardMaterial({ color: "#2d3340", roughness: 0.5 }), { title: "Motor mount", text: "Holds a gear motor under the deck." }), sx * 2.6, DECK_Y - 1.0, -4.5));
  part.userData.size = { w: CHASSIS_W, h: 5, d: 22, base: 0 };
  return part;
}

// ---- Jumper wires ----------------------------------------------------------------

export const WIRE_COLORS = { red: "#e53935", black: "#202124", orange: "#ff9800", yellow: "#fdd835", green: "#43a047", blue: "#1e88e5", purple: "#8e24aa", white: "#eeeeee", grey: "#8d99a6", brown: "#8d5524" };

// A jumper wire that arcs from a to b (world or local points). `lift` is how
// high the arc rises above the higher end.
export function jumperWire(a, b, color = WIRE_COLORS.blue, { lift = null, radius = 0.075 } = {}) {
  const span = a.distanceTo(b);
  const up = lift ?? Math.min(1 + span * 0.25, 5);
  const top = Math.max(a.y, b.y) + up;
  const pts = [
    a.clone(),
    a.clone().add(new THREE.Vector3(0, up * 0.55, 0)),
    a.clone().lerp(b, 0.5).setY(top),
    b.clone().add(new THREE.Vector3(0, up * 0.55, 0)),
    b.clone(),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: color, emissiveIntensity: 0 });
  const tube = mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.round(span * 6)), radius, 8), mat);
  g.add(tube);
  // Dupont housings at both ends.
  for (const p of [a, b]) g.add(at(box(0.25, 0.7, 0.25, MAT.blackPlastic), p.x, p.y + 0.35, p.z));
  g.userData.curve = curve;
  g.userData.mat = mat;
  return g;
}

// A path through points with rounded corners, like a wire laid on a bench.
export function roundedPath(input, r = 0.5) {
  const points = input.filter((p, i) => i === 0 || p.distanceTo(input[i - 1]) > 1e-3);
  const path = new THREE.CurvePath();
  let from = points[0].clone();
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (!next) { path.add(new THREE.LineCurve3(from, p.clone())); break; }
    const inDir = p.clone().sub(points[i - 1]);
    const outDir = next.clone().sub(p);
    const k = Math.min(r, inDir.length() / 2, outDir.length() / 2);
    if (k < 1e-3 || inDir.clone().normalize().dot(outDir.clone().normalize()) > 0.9999) continue; // no corner here
    const a = p.clone().sub(inDir.normalize().multiplyScalar(k));
    const b = p.clone().add(outDir.normalize().multiplyScalar(k));
    if (a.distanceTo(from) > 1e-4) path.add(new THREE.LineCurve3(from, a));
    path.add(new THREE.QuadraticBezierCurve3(a, p.clone(), b));
    from = b;
  }
  return path;
}

// A plain wire along points (for the lesson circuits).
export function wirePath(points, color = "#e53935", radius = 0.08) {
  const curve = roundedPath(points);
  // A tube follows a smooth curve best: resample the path densely.
  const smooth = new THREE.CatmullRomCurve3(curve.getSpacedPoints(Math.max(80, Math.round(curve.getLength() * 8))), false, "catmullrom", 0.5);
  const m = mesh(new THREE.TubeGeometry(smooth, Math.max(80, Math.round(curve.getLength() * 8)), radius, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: color, emissiveIntensity: 0 }));
  m.userData.curve = curve;
  return m;
}
