// Mini Yaver wiring test: checks the 3D build against the sketch and against
// itself, so a wrong wire can't slip in.
//
//   python3 -m http.server 8765        (from the repo root)
//   node tests/mini-wiring.mjs
//
// Optional: THREE_DIR=/path/to/node_modules/three serves three.js locally when
// cdn.jsdelivr.net can't be reached; CHROMIUM=/path/to/chromium picks the browser.
//
// It checks:
//  1. every Uno pin the sketch uses goes to the right part pin, and nothing else;
//  2. the 74HC595 outputs match the sketch's bits (Q0 RS ... Q7 buzzer);
//  3. every part has power and ground, the RFID reader on 3.3 V only, and no
//     net joins 5V, 3V3 and GND;
//  4. the breadboard as laid out (holes, columns, rails, hub columns) joins
//     exactly the pins the wire plan joins: no missing and no extra connections;
//  5. one jumper per Uno socket and one plug per hole;
//  6. in the 3D view no two wires come within 0.15 cm of each other
//     (each wire is 0.14 thick), so none touch or hide inside another.
import fs from "fs";
import { createRequire } from "module";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); }
const BASE = process.env.BASE ?? "http://localhost:8765";
const ino = fs.readFileSync(new URL("../mini-yaver/MiniYaver/MiniYaver.ino", import.meta.url), "utf8");

// What the sketch says.
const pin = (v) => (v.startsWith("A") ? v : `D${v}`);
const P = Object.fromEntries([...ino.matchAll(/const uint8_t (PIN_\w+)\s*=\s*(A?\d+);/g)].map((m) => [m[1], pin(m[2])]));
const bit = (name) => Math.log2(Number(ino.match(new RegExp(`const uint8_t ${name}\\s*=\\s*(0x[0-9A-Fa-f]+)`))[1]));
const expected = {
  // Uno pins, from the sketch's pin map.
  "IR.OUT": P.PIN_IR, "JS.SW": P.PIN_JOY_SW, "SR.STCP": P.PIN_LATCH, "SV.SIG": P.PIN_SERVO, "RF.SDA": P.PIN_RFID_SS,
  "JS.VRx": P.PIN_JOY_X, "JS.VRy": P.PIN_JOY_Y, "LDR.2": P.PIN_LIGHT, "WS.S": P.PIN_WATER, "MIC.AO": P.PIN_SOUND, "DHT.S": P.PIN_DHT,
  // Hardware SPI on the Uno (the sketch uses SPI.h); the stepper on PORTD bits 4-7.
  "SR.DS": "D11", "RF.MOSI": "D11", "RF.MISO": "D12", "SR.SHCP": "D13", "RF.SCK": "D13",
  "ST.IN1": "D4", "ST.IN2": "D5", "ST.IN3": "D6", "ST.IN4": "D7",
  // 74HC595 outputs, from the sketch's bits. lcdNibble shifts the nibble by 2: Q2..Q5 = D4..D7.
  "LCD.RS": `SR.Q${bit("SR_RS")}`, "LCD.E": `SR.Q${bit("SR_E")}`, "LCD.D4": "SR.Q2", "LCD.D5": "SR.Q3", "LCD.D6": "SR.Q4", "LCD.D7": "SR.Q5",
  "RL.S": `SR.Q${bit("SR_RELAY")}`, "RZ.1": `SR.Q${bit("SR_BUZZ")}`,
  // RST tied high: the sketch passes MFRC522::UNUSED_PIN and resets it by software.
  "RF.3.3V": "3V3", "RF.RST": "3V3",
};
if (!/UNUSED_PIN/.test(ino)) expected["RF.RST"] = null;
if (!/\(n & 0x0F\) << 2/.test(ino)) throw new Error("lcdNibble no longer shifts by 2: update the LCD data pins in this test");
for (const [k, v] of Object.entries(expected)) if (v === undefined) throw new Error(`no value for ${k} in the sketch`);

const browser = await playwright.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
if (process.env.THREE_DIR) await page.route("https://cdn.jsdelivr.net/npm/three@0.160.0/**", (r) => r.fulfill({ path: process.env.THREE_DIR + new URL(r.request().url()).pathname.replace("/npm/three@0.160.0", ""), contentType: "text/javascript" }));
// Hand tracking and cloud voice aren't needed here: stub them.
await page.route(/mediapipe/, (r) => r.fulfill({ contentType: "text/javascript", body: "export const FilesetResolver={forVisionTasks:async()=>({})};export class HandLandmarker{static async createFromOptions(){return{detectForVideo(){return{landmarks:[]}}}}};export class GestureRecognizer extends HandLandmarker{};" }));
await page.route(/puter|kokoro/, (r) => r.abort());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/?debug#academy/mini-yaver/3d`, { waitUntil: "load" });
await page.waitForFunction(() => window.__academy?.state?.()?.wires?.length, null, { timeout: 60000 });

const report = await page.evaluate((expected) => {
  const st = window.__academy.state();
  const { plan, bench } = st;
  const fails = [];
  const key = (e) => `${e.part}.${e.pin}`;

  // ---- the wire plan's own nets
  const uf = () => { const p = new Map(); const f = (a) => { if (!p.has(a)) p.set(a, a); while (p.get(a) !== a) { p.set(a, p.get(p.get(a))); a = p.get(a); } return a; }; return { f, u: (a, b) => p.set(f(a), f(b)) }; };
  const L = uf();
  L.u("BOARD.5V", "BB.+"); L.u("BOARD.GND", "BB.-");
  for (const w of plan.wires) L.u(key(w.from), key(w.to));
  const pins = [...new Set(plan.wires.flatMap((w) => [key(w.from), key(w.to)]))];
  const net = (k) => pins.filter((q) => L.f(q) === L.f(k));

  // 1, 2: signal pins
  for (const [k, want] of Object.entries(expected)) {
    if (want === null) continue;
    const target = want.includes(".") ? want : `BOARD.${want}`;
    if (L.f(k) !== L.f(target)) fails.push(`${k} should be on ${want}, is on ${net(k).join(" ")}`);
  }
  // Each Uno signal pin joins exactly the parts the sketch expects.
  for (const p of pins.filter((q) => q.startsWith("BOARD.") && !/5V|GND|3V3/.test(q))) {
    const want = Object.entries(expected).filter(([, v]) => `BOARD.${v}` === p).map(([k]) => k).sort();
    const got = net(p).filter((q) => q !== p).sort();
    // The light divider also joins the 10K resistor.
    const extra = got.filter((q) => !want.includes(q) && !(p === `BOARD.${expected["LDR.2"]}` && q === "R10.1"));
    if (extra.length || want.some((q) => !got.includes(q))) fails.push(`${p}: has ${got.join(" ")}, sketch expects ${want.join(" ")}`);
  }
  // 3: power
  const five = L.f("BOARD.5V"), gnd = L.f("BOARD.GND"), v33 = L.f("BOARD.3V3");
  if (five === gnd || five === v33 || gnd === v33) fails.push("a short between 5V, 3V3 and GND");
  // Every powered part has a pin on 5V and a pin on GND.
  for (const part of ["SR", "LCD", "IR", "JS", "SV", "ST", "WS", "MIC", "DHT", "RL"]) {
    const mine = pins.filter((q) => q.startsWith(`${part}.`));
    if (!mine.some((q) => L.f(q) === five)) fails.push(`${part} has no 5V`);
    if (!mine.some((q) => L.f(q) === gnd)) fails.push(`${part} has no GND`);
  }
  if (L.f("RF.3.3V") !== v33 || L.f("RF.GND") !== gnd) fails.push("RFID power is wrong");
  if (net("RF.3.3V").some((q) => q === "BOARD.5V")) fails.push("RFID on 5 V");
  for (const [a, b] of [["SR.MR", five], ["SR.OE", gnd], ["LCD.RW", gnd], ["LCD.K", gnd], ["BZ.-", gnd]]) if (L.f(a) !== b) fails.push(`${a} is on the wrong net`);

  // ---- 4: the breadboard as built
  const B = uf();
  const half = (r) => (r < 5 ? 0 : 1);
  const node = (e) => e.kind === "hole" ? `H${e.c}:${half(e.r)}` : e.kind === "rail" ? `R${e.line}${e.pin}` : e.kind === "board" ? `B${/^GND/.test(e.pin) ? "GND" : e.pin}` : `P${e.part}.${e.pin}`;
  for (const [k, h] of bench.holes) B.u(`P${k}`, `H${h.c}:${half(h.r)}`);
  const phys = (spec) => spec.part === "BOARD" ? `B${spec.pin}` : spec.part === "BB" ? null : `P${spec.part}.${spec.pin}`;
  bench.wires.forEach((e) => { if (!e.skip) B.u(node(e.a), node(e.b)); });
  for (const br of bench.bridges) B.u(node(br.a), node(br.b));
  // A rail end's pin as wired: + on the + line.
  for (const e of bench.wires.filter((x) => !x.skip).flatMap((x) => [x.a, x.b]).concat(bench.bridges.flatMap((x) => [x.a, x.b]))) if (e.kind === "rail" && !e.line) fails.push("rail end without a line");
  const physOf = (k) => {
    const [part, ...rest] = k.split("."), p = rest.join(".");
    if (part === "BB") return p === "+" ? B.f("B5V") : B.f("BGND");
    return B.f(phys({ part, pin: p }));
  };
  for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
    const a = pins[i], b = pins[j];
    const want = L.f(a) === L.f(b), got = physOf(a) === physOf(b);
    if (want !== got) fails.push(`breadboard ${got ? "joins" : "doesn't join"} ${a} and ${b}`);
  }
  // Rails: + lines must be on 5V, − lines on GND.
  for (const e of bench.wires.filter((x) => !x.skip).flatMap((x) => [x.a, x.b])) if (e.kind === "rail" && B.f(`R${e.line}${e.pin}`) !== B.f(e.pin === "+" ? "B5V" : "BGND")) fails.push(`${e.name} is not on ${e.pin === "+" ? "5V" : "GND"}`);

  // ---- 5: one jumper per socket, one plug per hole
  const ends = bench.wires.filter((x) => !x.skip).flatMap((x) => [x.a, x.b]).concat(bench.bridges.flatMap((x) => [x.a, x.b]));
  const seen = new Map();
  for (const e of ends) {
    const id = e.kind === "board" ? `Uno socket ${e.pin}` : e.kind === "hole" ? `hole ${e.name}` : e.kind === "rail" ? `rail ${e.pos.map((v) => v.toFixed(2))}` : `pin ${e.part}.${e.pin}`;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [k, h] of bench.holes) { const id = `hole ${"abcdefghij"[h.r]}${h.c + 1}`; if (seen.has(id)) fails.push(`${id} has a leg of ${k} and a wire`); }
  for (const [id, n] of seen) if (n > 1) fails.push(`${id} has ${n} plugs`);

  // ---- 6: wires in 3D
  const tubes = [];
  st.wires.forEach((g, i) => g.traverse((m) => { if (m.isMesh && m.geometry.type === "TubeGeometry") tubes.push({ i, m, name: m.parent === g ? `${i + 1}` : `${i + 1}a` }); }));
  const S = tubes.map(({ m }) => { m.updateMatrixWorld(true); const c = m.geometry.parameters.path, n = Math.ceil(c.getLength() / 0.04), out = []; for (let k = 0; k <= n; k++) out.push(c.getPointAt(k / n).applyMatrix4(m.matrixWorld)); return out; });
  const box = S.map((s) => s.reduce((b, p) => [Math.min(b[0], p.x), Math.max(b[1], p.x), Math.min(b[2], p.y), Math.max(b[3], p.y), Math.min(b[4], p.z), Math.max(b[5], p.z)], [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]));
  let closest = Infinity;
  for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
    const A = box[a], Bx = box[b];
    if (A[0] > Bx[1] + 0.3 || Bx[0] > A[1] + 0.3 || A[2] > Bx[3] + 0.3 || Bx[2] > A[3] + 0.3 || A[4] > Bx[5] + 0.3 || Bx[4] > A[5] + 0.3) continue;
    let min = Infinity;
    for (const p of S[a]) for (const q of S[b]) { const d = p.distanceToSquared(q); if (d < min) min = d; }
    min = Math.sqrt(min);
    closest = Math.min(closest, min);
    if (min < 0.15) fails.push(`3D wires ${tubes[a].name} and ${tubes[b].name} are ${min.toFixed(3)} cm apart`);
  }
  return { fails, wires: plan.wires.length, jumpers: bench.jumpers, tubes: tubes.length, closest };
}, expected);

await browser.close();
console.log(`${report.wires} wires in the plan, ${report.jumpers} jumpers, ${report.tubes} in 3D; closest two wires ${report.closest.toFixed(3)} cm apart (centre to centre).`);
if (errors.length) report.fails.push(...errors.map((e) => `page error: ${e}`));
if (report.fails.length) { console.log(`FAIL\n- ${report.fails.join("\n- ")}`); process.exit(1); }
console.log("PASS: wiring matches the sketch, the breadboard joins exactly the planned nets, and no 3D wires touch.");
