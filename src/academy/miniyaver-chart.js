// Mini Yaver's wiring as a chart and as a wire list, both made from the same
// plan as the 3D build (miniyaver-3d.js) and the same breadboard layout
// (bench.js), so the numbers, colours and holes match everywhere.
//
// The chart is a pin table, not a picture: every wire is one straight
// horizontal line in its own row, from a pin on the left to a pin on the
// right, so no two wires can cross or cover each other.
import { miniPlan } from "./miniyaver-3d.js?v=28";
import { benchPlan, withBreadboard } from "./bench.js?v=28";
import { WIRE_COLORS } from "./parts.js?v=28";

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Wire colours as drawn on a dark page: black and brown get a lighter edge.
const swatch = (c) => WIRE_COLORS[c] ?? "#888";
const DARK = new Set(["black", "brown"]);

// Why each Uno pin, in one line.
const PIN_WHY = {
  D2: "The talk button: the built-in pull-up keeps it HIGH until pressed.",
  D3: "The buzzer: Yaver's voice (Timer2), beeps and tunes (tone()).",
  D4: "RGB blue (through 220 Ω): dimmed by the sound timer.",
  D5: "RGB red (through 220 Ω): analogWrite.",
  D6: "RGB green (through 220 Ω): analogWrite.",
  D7: "LCD D7.", D8: "LCD D6.", D9: "LCD D5.", D10: "LCD D4.",
  D11: "LCD E: a pulse means \"read now\".",
  D12: "LCD RS: letter or command.",
  A0: "Yaver's ear: recorded while it listens, checked for a double clap otherwise.",
};
const PIN_ORDER = ["5V", "GND", "3V3", ...Array.from({ length: 14 }, (_, i) => `D${i}`), ...Array.from({ length: 6 }, (_, i) => `A${i}`)];

let model = null;

// Every wire with its number, step, both ends as text, colour and where it
// plugs in on the bench. A shared Uno pin's own jumper to its column is
// listed right before the first wire that uses it, numbered "4a".
export function wiring() {
  if (model) return model;
  const plan = withBreadboard(miniPlan());
  const bench = benchPlan(plan);
  const part = (id) => plan.parts.find((p) => p.id === id);
  const name = (e) => (e.part === "BOARD" ? `Uno ${e.pin}` : e.part === "BB" ? (e.pin === "+" ? "+ rail (5V)" : "− rail (GND)") : `${part(e.part).tag} ${e.pin === "-" ? "−" : e.pin}`);
  const at = (x) => !x ? "" : x.kind === "hole" ? `hole ${x.name}` : x.kind === "rail" ? x.name : x.kind === "board" ? `Uno ${x.name ?? ""} socket` : `${part(x.part)?.tag ?? x.part} ${x.pin} header pin`;
  const stepOf = new Map();
  plan.steps.forEach((s, k) => s.wires.forEach((w) => stepOf.set(w, k)));
  const rows = [];
  plan.wires.forEach((w, i) => {
    const e = bench.wires[i];
    let extra = 0;
    for (const br of bench.bridges.filter((x) => !x.hub && x.at === i)) {
      const sign = br.a.pin === "+" ? "+" : "−", what = sign === "+" ? "5V" : "GND";
      rows.push({ n: `${i + 1}${"abc"[extra++]}`, i, step: stepOf.get(i), from: { part: "BB", pin: br.a.pin }, to: { part: "BB", pin: br.b.pin }, rails: true,
        fromText: `top ${sign} rail`, toText: `bottom ${sign} rail`, color: br.color, where: `${br.a.name} → ${br.b.name}, at the left end`,
        why: `Joins the two ${sign} rails, so parts on either side get ${what}.` });
    }
    for (const hub of bench.bridges.filter((br) => br.hub && br.at === i)) {
      rows.push({ n: `${i + 1}${"abc"[extra++]}`, i, step: stepOf.get(i), from: { part: "BOARD", pin: hub.hub }, to: { part: "HUB", pin: hub.b.name },
        fromText: `Uno ${hub.hub}`, toText: `${hub.hub} column (hole ${hub.b.name})`, color: w.color, where: `Uno ${hub.hub} socket → hole ${hub.b.name}`,
        why: `${hub.hub} feeds two parts and a socket holds one jumper, so it goes to its own breadboard column first.` });
    }
    rows.push({
      n: String(i + 1), i, step: stepOf.get(i), from: w.from, to: w.to, fromText: name(w.from), toText: name(w.to), color: w.color, why: w.why,
      skip: e.skip, where: e.skip ? (e.sameColumn ? `No jumper: both legs are in one breadboard column (${e.a.name ?? ""} and ${e.b.name ?? ""}).` : "No jumper: already joined.") : `${at(e.a)} → ${at(e.b)}`,
    });
  });
  model = { plan, bench, rows, part };
  return model;
}

// ---- The chart ---------------------------------------------------------------------

// Rows are grouped: Uno pins to parts (in pin order), the 74HC595 outputs and
// other part-to-part wires, then the two power rails with every part on them.
function groups() {
  const { rows } = wiring();
  const board = (r) => r.from.part === "BOARD" ? r.from : r.to.part === "BOARD" ? r.to : null;
  const rail = (r) => r.from.part === "BB" ? r.from : r.to.part === "BB" ? r.to : null;
  const uno = [], parts = [], plus = [], minus = [];
  for (const r of rows) {
    const b = board(r), rl = rail(r);
    if (b && rl) continue; // 5V → + rail and GND → − rail head the rail groups
    if (r.rails) { (r.from.pin === "+" ? plus : minus).push({ r, left: { part: "BB" } }); continue; }
    if (rl) (rl.pin === "+" ? plus : minus).push({ r, left: rl === r.from ? r.to : r.from });
    else if (b) uno.push({ r, pin: b.pin, right: b === r.from ? r.to : r.from });
    else parts.push(r);
  }
  uno.sort((a, b) => PIN_ORDER.indexOf(a.pin) - PIN_ORDER.indexOf(b.pin) || (a.r.n.endsWith("a") ? -1 : 0) - (b.r.n.endsWith("a") ? -1 : 0));
  // A part-to-part wire reads from the side nearer the Uno to the part.
  const srFirst = (r) => (r.to.part === "SR" ? { ...r, from: r.to, to: r.from, fromText: r.toText, toText: r.fromText } : r);
  parts.sort((a, b) => (b.from.part === "SR" || b.to.part === "SR") - (a.from.part === "SR" || a.to.part === "SR"));
  return { uno, parts: parts.map(srFirst), plus, minus };
}

function line(r, left, right, extra = "") {
  return `<div class="ch-row ${r.skip ? "skip" : ""} ${extra}" data-wire="${esc(r.n)}" data-step="${r.step}" role="button" tabindex="0">
    <span class="ch-n">${esc(r.n)}</span>
    ${left}
    <i class="ch-line ${DARK.has(r.color) ? "dark" : ""} ${r.skip ? "none" : ""}" style="--c:${swatch(r.color)}"></i>
    <b class="ch-pin part">${esc(right)}</b>
    <span class="ch-why">${esc(r.skip ? "same column, no jumper" : r.why || "")}</span>
  </div>`;
}

export function chartHTML() {
  const { uno, parts, plus, minus } = groups();
  let last = null;
  const unoRows = uno.map(({ r, pin, right }) => {
    const first = pin !== last;
    last = pin;
    const left = first ? `<b class="ch-pin uno" title="${esc(PIN_WHY[pin] ?? "")}">${esc(pin)}</b>` : `<b class="ch-pin branch">└</b>`;
    const to = r.to.part === "HUB" ? r.toText : r.from.part === "BOARD" ? r.toText : r.fromText;
    return line(r, left, to, first ? "" : "cont");
  }).join("");
  const partRows = parts.map((r) => line(r, `<b class="ch-pin part">${esc(r.fromText)}</b>`, r.toText)).join("");
  const rail = (list, label, cls) => list.map(({ r, left }, k) => line(r, k ? `<b class="ch-pin branch">└</b>` : `<b class="ch-pin ${cls}">${label}</b>`, r.rails ? r.toText : r.from === left ? r.fromText : r.toText, k ? "cont" : "")).join("");
  return `
    <div class="ch-legend">Each line is one jumper wire, in its real colour, numbered as in the 3D build and the wire list. Lines never cross: read across a row. Hover an Uno pin for why that pin.</div>
    <h3>Uno pins → parts</h3>${unoRows}
    <h3>Part to part</h3>${partRows}
    <h3>+ rail: Uno 5V</h3>${rail(plus, "+ 5V", "pwr")}
    <h3>− rail: Uno GND</h3>${rail(minus, "− GND", "gnd")}`;
}

// ---- The wire list -----------------------------------------------------------------

export function specHTML() {
  const { rows, plan } = wiring();
  const body = plan.steps.map((s, k) => `
    <tr class="sp-step"><th colspan="6">Step ${k + 1} · ${esc(s.title)}</th></tr>
    ${rows.filter((r) => r.step === k).map((r) => `
      <tr class="${r.skip ? "skip" : ""}" data-wire="${esc(r.n)}">
        <td class="sp-n">${esc(r.n)}</td>
        <td><b>${esc(r.fromText)}</b></td>
        <td><b>${esc(r.toText)}</b></td>
        <td><i class="sp-sw ${DARK.has(r.color) ? "dark" : ""}" style="background:${swatch(r.color)}"></i>${esc(r.skip ? "—" : r.color)}</td>
        <td>${esc(r.where)}</td>
        <td>${esc(r.why || "")}</td>
      </tr>`).join("")}`).join("");
  const n = rows.filter((r) => !r.skip).length;
  return `
    <div class="sp-top"><p class="ac-lead">${n} jumper wires, in build order. Holes are on the breadboard as laid out in the 3D build: columns 1–63, rows a–e and f–j.</p>
      <button class="ac-btn" data-my="print">🖨 Print</button></div>
    <table class="sp-table">
      <thead><tr><th>#</th><th>From</th><th>To</th><th>Colour</th><th>Where it plugs in</th><th>Why</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <h3>Checked against the sketch</h3>
    <ul class="sp-checks">
      <li>Every Uno pin matches <code>MiniYaver.ino</code>: LCD RS D12, E D11, D4–D7 on D10–D7, button D2, buzzer D3, RGB D5/D6/D4 (red/green/blue), sound A0.</li>
      <li>Each RGB colour has its own 220 Ω resistor between the Uno pin and the LED.</li>
      <li>The button needs no resistor: the sketch uses <code>INPUT_PULLUP</code>, so its other side goes to GND.</li>
      <li>The buzzer is the passive one (no sticker): the sketch plays notes on it with <code>tone()</code>, and speech with Timer2 on D3. An active buzzer (sticker on top) only beeps at its own pitch, so it can't speak.</li>
      <li>Some 830-hole breadboards split each power rail in the middle (a break in the red/blue line). If yours does, bridge the gap with a short wire on both rails.</li>
    </ul>`;
}
