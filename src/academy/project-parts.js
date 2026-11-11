// The parts a project plan can use, each with named pins. The course's own
// models (parts.js) are reused where they exist; the rest (piezo buzzer,
// potentiometer, servo, light sensor and a labelled generic module) are
// built here at real size in centimetres.
import * as THREE from "three";
import * as P from "./parts.js?v=21";
import { KIT_KINDS, buildKitPart } from "./kit-parts.js?v=21";

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
const plastic = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });

// Pins standing down from a part: a row of gold posts, `names` along x.
function pinRow(part, names, { y = 0, z = 0, length = 0.6, pitch = PITCH } = {}) {
  names.forEach((n, i) => {
    const x = (i - (names.length - 1) / 2) * pitch;
    const post = box(0.064, length, 0.064, MAT.gold);
    post.position.set(x, y - length / 2, z);
    part.add(post);
    addPin(part, n, V(x, y - length + 0.05, z), n);
  });
}

// A label printed on a canvas, for the generic module's face.
function labelTexture(lines, w, d, bg) {
  const s = 120;
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(d * s);
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#f4f4f4";
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((t, i) => {
    const size = i === 0 ? 0.32 : 0.14;
    g.font = `${i === 0 ? 800 : 600} ${size * s}px system-ui, sans-serif`;
    let str = t;
    while (str.length > 3 && g.measureText(str).width > c.width * 0.92) str = str.slice(0, -2);
    g.fillText(str === t ? t : `${str}…`, c.width / 2, c.height * (lines.length === 1 ? 0.5 : 0.36 + i * 0.36));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A 12 mm piezo buzzer: a black can with a hole on top, + and − legs.
export function buzzer() {
  const part = makePart("buzzer", "Piezo buzzer", "A thin crystal disc that bends when voltage is applied. Switch it on and off fast with tone() and it sings at that frequency. The longer leg is +.");
  const can = cyl(0.6, 0.85, MAT.blackPlastic, part.userData.info, 36);
  can.position.y = 0.425;
  const hole = cyl(0.12, 0.02, MAT.hole);
  hole.position.y = 0.86;
  const plus = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), new THREE.MeshBasicMaterial({ color: "#ddd", transparent: true, opacity: 0.8 }));
  plus.rotation.x = -Math.PI / 2;
  plus.position.set(-0.32, 0.852, 0);
  part.add(can, hole, plus);
  for (const [n, x] of [["+", -0.38], ["-", 0.38]]) {
    const leg = box(0.05, 0.9, 0.05, MAT.tin);
    leg.position.set(x, -0.45, 0);
    part.add(leg);
    addPin(part, n, V(x, -0.85, 0), n === "+" ? "+" : "−");
  }
  part.userData.setSound = (on) => { can.material = on ? glowMat("#4cc9ff", can.material) : MAT.blackPlastic; };
  return part;
}

function glowMat(color, current) {
  if (current?.userData?.glowColor === color) return current;
  const m = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.6, emissive: color, emissiveIntensity: 0.35 });
  m.userData.glowColor = color;
  return m;
}

// A 10 kΩ rotary potentiometer: three legs (1, wiper W, 2) and a knob.
export function potentiometer() {
  const part = makePart("pot", "Potentiometer", "A knob that slides a contact (the middle leg, the wiper) along a resistive track. With the outer legs on 5 V and GND, the wiper gives any voltage in between: read it with analogRead().");
  const body = box(1.0, 0.6, 1.0, MAT.bluePlastic, part.userData.info);
  body.position.y = 0.3;
  const shaft = cyl(0.3, 0.4, MAT.silver);
  shaft.position.y = 0.8;
  const knob = cyl(0.45, 0.7, plastic("#2a2c31"), { title: "Knob", text: "Turn it to change the wiper voltage. In the simulator, use the slider on the left." }, 20);
  knob.position.y = 1.3;
  const mark = box(0.08, 0.05, 0.35, MAT.whitePlastic);
  mark.position.set(0, 1.66, -0.2);
  const turn = new THREE.Group();
  turn.add(knob, mark);
  part.add(body, shaft, turn);
  pinRow(part, ["1", "W", "2"], { z: 0.35, pitch: 0.5 });
  part.userData.setValue = (k) => { turn.rotation.y = (0.5 - k) * Math.PI * 1.5; };
  return part;
}

// An SG90 micro servo: blue case, a white horn on top, three leads.
export function servo() {
  const part = makePart("servo", "SG90 micro servo", "A small motor with gears and a position sensor inside. Send it an angle from 0 to 180 degrees with the Servo library and it turns there and holds. Brown = GND, red = +5 V, orange = signal.");
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: "#2b63c9", roughness: 0.35, transmission: 0.1 });
  const body = box(2.3, 2.2, 1.2, bodyMat, part.userData.info);
  body.position.set(0, 1.4, 0);
  const tabs = box(3.2, 0.25, 1.2, bodyMat);
  tabs.position.set(0, 2.0, 0);
  const top = cyl(0.55, 0.4, bodyMat);
  top.position.set(-0.55, 2.7, 0);
  const horn = new THREE.Group();
  const arm = box(2.2, 0.15, 0.45, MAT.whitePlastic, { title: "Horn", text: "The arm that turns. Fix whatever should move to it." });
  arm.position.x = 0.8;
  horn.add(arm, cyl(0.3, 0.2, MAT.whitePlastic));
  horn.position.set(-0.55, 3.0, 0);
  part.add(body, tabs, top, horn);
  // A short three-wire lead ending in a header pinned onto the bench.
  const colors = ["#e8892b", "#d33", "#6b3e1f"];
  ["SIG", "V+", "GND"].forEach((n, i) => {
    const z = (i - 1) * PITCH;
    const pts = [V(1.1, 0.8, z), V(1.6, 0.6, z), V(2.0, 0.3, z), V(2.3, 0.3, z)];
    const tube = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.05, 6), plastic(colors[i]));
    part.add(tube);
    addPin(part, n, V(2.35, 0.3, z), n);
  });
  const plug = box(0.3, 0.3, 0.8, MAT.blackPlastic);
  plug.position.set(2.45, 0.3, 0);
  part.add(plug);
  part.userData.setAngle = (deg) => { horn.rotation.y = ((deg - 90) * Math.PI) / 180; };
  return part;
}

// A photoresistor (LDR): its resistance falls as light rises.
export function ldr() {
  const part = makePart("ldr", "Light sensor (LDR)", "A photoresistor: in the dark it is about 1 MΩ, in bright light a few hundred Ω. Put it in a divider with a 10 kΩ resistor and read the middle with analogRead().");
  const head = cyl(0.25, 0.2, plastic("#e3c79a"), part.userData.info, 24);
  head.position.y = 1.0;
  const track = box(0.4, 0.01, 0.06, plastic("#a8452a"));
  track.position.y = 1.105;
  part.add(head, track);
  for (const [n, x] of [["1", -0.12], ["2", 0.12]]) {
    const leg = box(0.04, 1.0, 0.04, MAT.tin);
    leg.position.set(x, 0.45, 0);
    part.add(leg);
    addPin(part, n, V(x, 0.0, 0), `Leg ${n}`);
  }
  return part;
}

// A small breakout board for anything else: its name on the face and its
// pins along one edge.
export function genericModule(name, pins) {
  const list = pins.length ? pins.slice(0, 16) : ["VCC", "GND", "OUT"];
  const W = Math.max(2.4, list.length * PITCH + 0.8), D = 2.2, T = 0.16;
  const part = makePart("module", name, `${name}: a ready-made module. Its pins are along the front edge.`);
  const tex = labelTexture([name, list.join(" · ")], W, D, "#16426e");
  const side = new THREE.MeshStandardMaterial({ color: "#16426e", roughness: 0.55 });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
  const board = mesh(new THREE.BoxGeometry(W, T, D), [side, side, top, side, side, side], part.userData.info);
  board.position.y = 0.8;
  const chip = box(0.9, 0.15, 0.9, MAT.chip);
  chip.position.set(W / 2 - 0.7, 0.95, -0.4);
  part.add(board, chip);
  pinRow(part, list, { y: 0.8, z: D / 2 - 0.2, length: 0.85 });
  return part;
}

// A push button with two named sides, 1 and 2 (the course's model has no pins).
export function button() {
  const part = P.pushButton();
  addPin(part, "1", V(-PITCH, -0.45, 0.381), "Side 1");
  addPin(part, "2", V(PITCH, -0.45, -0.381), "Side 2");
  return part;
}

// A breadboard used for its power rails: "+" and "−" are each a long strip,
// so any number of wires can share them (each lands in its own hole).
export function railBoard() {
  const part = P.breadboard();
  let plus = 0, minus = 0;
  // The next free hole on a rail, in the board's own space.
  part.userData.railHole = (which) => {
    const i = which === "+" ? plus++ : minus++;
    const k = (i * 3) % 25;
    return part.userData.rail(k, which === "+" ? "bottom+" : "bottom-");
  };
  addPin(part, "+", part.userData.rail(0, "bottom+"), "+ rail");
  addPin(part, "-", part.userData.rail(0, "bottom-"), "− rail");
  return part;
}

// The kinds a plan can name, with their pins (shown to the AI).
export const KINDS = {
  led: ["A", "K"],
  resistor: ["1", "2"],
  button: ["1", "2"],
  buzzer: ["+", "-"],
  potentiometer: ["1", "W", "2"],
  servo: ["SIG", "V+", "GND"],
  ultrasonic: ["VCC", "Trig", "Echo", "GND"],
  motor_driver: ["ENA", "IN1", "IN2", "IN3", "IN4", "ENB", "OUT1", "OUT2", "OUT3", "OUT4", "12V", "GND", "5V"],
  dc_motor: ["M+", "M-"],
  battery_9v: ["+", "-"],
  ldr: ["1", "2"],
  breadboard: ["+", "-"],
  ...KIT_KINDS,
  module: [],
};

const LED_NAMES = Object.keys(P.LED_COLORS);

// Builds a plan's part: { type, label, value, pins }.
export function buildPart(spec) {
  let part;
  switch (spec.type) {
    case "led": {
      const v = String(spec.value || spec.label || "").toLowerCase();
      part = P.led(LED_NAMES.find((c) => v.includes(c)) || "red");
      break;
    }
    case "resistor": part = P.resistor(parseOhms(spec.value) || 220); break;
    case "button": part = button(); break;
    case "buzzer": part = buzzer(); break;
    case "potentiometer": part = potentiometer(); break;
    case "servo": part = servo(); break;
    case "ultrasonic": part = P.hcsr04(); break;
    case "motor_driver": part = P.l298n(); break;
    case "dc_motor": part = P.ttMotor(1); break;
    case "battery_9v": part = P.battery9v(); break;
    case "ldr": part = ldr(); break;
    case "breadboard": part = railBoard(); break;
    default: part = buildKitPart(spec.type) ?? genericModule(spec.label || "Module", spec.pins || []);
  }
  return part;
}

// "220", "220Ω", "4.7k", "10 kOhm", "1M" → ohms.
export function parseOhms(v) {
  const m = String(v ?? "").replace(/,/g, ".").match(/([\d.]+)\s*([kKmM]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Math.round(n * (m[2].toLowerCase() === "k" ? 1e3 : m[2] === "M" ? 1e6 : m[2] === "m" ? 1e6 : 1));
}
