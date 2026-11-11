// The project tutor's brain: turns "I want to make a piano from an Arduino"
// into a project plan (parts, wiring, code and build steps) that the Academy
// shows in 3D. It asks Google Gemini with the free key Yaver already has, or
// Claude when an Anthropic API key has been added. Both keys stay in this
// browser and go only to Google or Anthropic.
import { geminiSettings } from "../assistant/keys.js?v=20";
import { pickChatModel } from "../assistant/gemini.js?v=20";
import { KINDS } from "./project-parts.js?v=20";

const CLAUDE_STORE = "yaver-claude-key";
const CLAUDE_MODEL = "claude-opus-5-5";
const CLAUDE_SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.7.0/+esm";

export const WIRE_COLORS = ["red", "black", "orange", "yellow", "green", "blue", "purple", "white", "grey", "brown"];
const TYPES = Object.keys(KINDS);

export const UNO_PINS = [...Array.from({ length: 14 }, (_, i) => `D${i}`), ...Array.from({ length: 6 }, (_, i) => `A${i}`), "5V", "3V3", "GND", "VIN"];
export const ESP32_GPIO = [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39];
export const ESP32_PINS = [...ESP32_GPIO.map((n) => `IO${n}`), "3V3", "5V", "GND"];

// ---- Keys --------------------------------------------------------------------

export function claudeKey() {
  try { return (localStorage.getItem(CLAUDE_STORE) || "").trim(); } catch { return ""; }
}
export function saveClaudeKey(key) {
  key = key.trim();
  if (!/^sk-ant-/.test(key)) throw new Error("That doesn't look like an Anthropic key (they start with sk-ant-).");
  localStorage.setItem(CLAUDE_STORE, key);
}
export function forgetClaudeKey() { try { localStorage.removeItem(CLAUDE_STORE); } catch {} }

// Which brain will plan: "claude", "gemini" or null (no key yet).
export async function plannerBrain() {
  if (claudeKey()) return "claude";
  return (await geminiSettings()).geminiKey ? "gemini" : null;
}

// ---- The request -----------------------------------------------------------------

const PROMPT = `You are Yaver's electronics tutor. A beginner describes a gadget they want to build. Design it as a small, safe, working Arduino Uno or ESP32 project, and teach it step by step. The app draws your plan in 3D, wires it exactly as you say, and runs your code in a simulator, so every name must follow these rules.

BOARD: "uno" (the default, 5 V) or "esp32" (when Wi-Fi/Bluetooth is needed; 3.3 V logic).
Board pins are written "BOARD.<pin>":
- uno: ${UNO_PINS.join(", ")}
- esp32: ${ESP32_PINS.join(", ")} (IO34-IO39 are input only)

PARTS: each has a short id (like "BTN1", "R1", "BZ1") and a type. Pins per type:
${TYPES.map((t) => `- ${t}: ${t === "module" ? 'any other module; list its pin names in "pins" (e.g. DHT11: VCC, DATA, GND)' : KINDS[t].join(", ")}`).join("\n")}
LED: A = anode (long leg, +), K = cathode (short leg, −); put the colour in "value". Resistor: ohms in "value" (e.g. "220"). Potentiometer: 1 and 2 are the outer legs, W the wiper. Breadboard: only its power rails "+" and "-" are used; any number of wires may join a rail. Use a breadboard whenever two or more parts need 5V or GND, and wire BOARD.5V to BB.+ and BOARD.GND to BB.-.
Do NOT add the board itself to "parts".

WIRES: {"from": "<id>.<pin>", "to": "<id>.<pin>", "color": one of ${WIRE_COLORS.join(", ")}, "why": one short sentence}. Every connection is one jumper wire. Red for + supply, black for GND, other colours for signals. A part's leg can be wired directly to another part's leg (e.g. R1.2 to LED1.A).

CODE: one complete Arduino sketch (C++). Only built-in Arduino functions plus the Servo library (tone(), noTone(), analogRead(), pulseIn(), Serial…). No other libraries unless a module truly needs one. Define musical notes as numbers in the sketch (no pitches.h). Buttons: wire one side to a pin and the other to GND, and use INPUT_PULLUP (pressed reads LOW). Short comments. At most 90 lines.

STEPS: 4 to 8 build steps in order. Each step adds some parts and wires: list the part ids it introduces in "parts" and the indexes (0-based, into "wires") of the wires it adds in "wires". Every part and every wire belongs to exactly one step. After the wiring steps, add 1 to 3 steps that explain the code; give them the 1-based line numbers they explain in "code_lines" (and empty "parts" and "wires"). Write "text" for a beginner: plain words, 2 to 5 short sentences, say what goes where and why. Use **bold** for pin names.

TIPS: 2 to 4 practical tips (safety, common mistakes, what to try next).

Keep it buildable: no more than 16 parts and 30 wires. Reply with the JSON object only.`;

// The JSON shape, as a JSON schema (Claude) and as Gemini's schema.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "board", "parts", "wires", "code", "steps", "tips"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    board: { type: "string", enum: ["uno", "esp32"] },
    parts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "type", "label", "value", "pins", "why"],
        properties: {
          id: { type: "string" }, type: { type: "string", enum: TYPES }, label: { type: "string" },
          value: { type: "string" }, pins: { type: "array", items: { type: "string" } }, why: { type: "string" },
        },
      },
    },
    wires: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["from", "to", "color", "why"],
        properties: { from: { type: "string" }, to: { type: "string" }, color: { type: "string", enum: WIRE_COLORS }, why: { type: "string" } },
      },
    },
    code: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "text", "parts", "wires", "code_lines"],
        properties: {
          title: { type: "string" }, text: { type: "string" },
          parts: { type: "array", items: { type: "string" } },
          wires: { type: "array", items: { type: "integer" } },
          code_lines: { type: "array", items: { type: "integer" } },
        },
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
};

function geminiSchema(s) {
  const out = { type: s.type.toUpperCase() };
  if (s.enum) out.enum = s.enum;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]));
    out.required = s.required;
    out.propertyOrdering = Object.keys(s.properties);
  }
  if (s.items) out.items = geminiSchema(s.items);
  return out;
}

function userText(request, previous) {
  if (!previous) return `Project: ${request}`;
  return `Here is the current plan:\n${JSON.stringify(stripPlan(previous))}\n\nChange it as follows and reply with the whole updated plan: ${request}`;
}

const stripPlan = ({ title, summary, board, parts, wires, code, steps, tips }) => ({ title, summary, board, parts, wires, code, steps, tips });

// Asks the AI for a plan. `previous` is the plan to change, if any.
// `onStatus(text)` reports progress. Returns a checked plan.
export async function planProject(request, { previous = null, onStatus = () => {}, signal } = {}) {
  const brain = await plannerBrain();
  if (!brain) throw Object.assign(new Error("Yaver needs an AI key to plan projects."), { needKey: true });
  onStatus(brain === "claude" ? "Claude is designing your project…" : "Gemini is designing your project…");
  const raw = brain === "claude" ? await askClaude(request, previous, signal) : await askGemini(request, previous, signal);
  const plan = checkPlan(parseJson(raw));
  plan.request = previous ? `${previous.request}; then: ${request}` : request;
  plan.brain = brain;
  return plan;
}

async function askGemini(request, previous, signal) {
  const { geminiKey, geminiModel } = await geminiSettings();
  const model = await pickChatModel(geminiKey, geminiModel);
  const body = (schema) => JSON.stringify({
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText(request, previous) }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 16384, responseMimeType: "application/json", ...(schema ? { responseSchema: geminiSchema(SCHEMA) } : {}) },
  });
  const call = (schema) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
    body: body(schema),
    signal,
  });
  let res = await call(true);
  if (res.status === 400) res = await call(false); // a model that rejects the schema
  if (!res.ok) throw new Error(res.status === 429 ? "Gemini is busy (free limit reached). Try again in a minute." : `Gemini answered ${res.status}.`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (!text) throw new Error("Gemini sent an empty plan. Try again.");
  return text;
}

async function askClaude(request, previous, signal) {
  const { default: Anthropic } = await import(CLAUDE_SDK);
  const client = new Anthropic({ apiKey: claudeKey(), dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: PROMPT,
      messages: [{ role: "user", content: userText(request, previous) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }, { signal });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Anthropic didn't accept the Claude key. Check it at console.anthropic.com.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Claude is busy right now. Try again in a minute.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Couldn't reach Claude. Check the internet connection.");
    if (err instanceof Anthropic.APIError) throw new Error(`Claude answered ${err.status ?? "with an error"}: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined to plan that project.");
  if (response.stop_reason === "max_tokens") throw new Error("The plan came out too long. Try a simpler project.");
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new Error("The plan came back garbled. Try again.");
}

// ---- Checking a plan ---------------------------------------------------------------

// Normalises a board pin name: "8", "D8", "pin 8", "GPIO25", "3.3V"… → the
// board's own name, or null.
export function boardPin(board, raw) {
  let p = String(raw).trim().toUpperCase().replace(/^(PIN|GPIO|G)\s*(?=\d)/, "").replace(/\s+/g, "");
  if (/^(GND\d?|GROUND|-|0V)$/.test(p)) return "GND";
  if (/^(3\.?3V?|3V3)$/.test(p)) return "3V3";
  if (/^(5V|\+5V|VCC)$/.test(p)) return "5V";
  if (/^(VIN|VBAT)$/.test(p)) return board === "uno" ? "VIN" : "5V";
  if (board === "uno") {
    if (/^D?\d{1,2}$/.test(p)) { const n = Number(p.replace("D", "")); return n <= 13 ? `D${n}` : null; }
    if (/^A[0-5]$/.test(p)) return p;
    if (p === "LED_BUILTIN") return "D13";
    return null;
  }
  const n = Number(p.replace(/^IO/, ""));
  if (/^(IO)?\d{1,2}$/.test(p) && ESP32_GPIO.includes(n)) return `IO${n}`;
  return null;
}

// Makes a plan safe to draw: known types, unique ids, wires between pins that
// exist, steps that cover every part and wire. Problems are kept in
// plan.warnings rather than thrown, so a nearly-right plan still shows.
export function checkPlan(raw) {
  if (!raw || typeof raw !== "object") throw new Error("The plan came back empty. Try again.");
  const warnings = [];
  const board = raw.board === "esp32" ? "esp32" : "uno";
  const str = (v, max = 2000) => String(v ?? "").slice(0, max);
  const parts = [];
  const ids = new Set(["BOARD"]);
  for (const p of (Array.isArray(raw.parts) ? raw.parts : []).slice(0, 24)) {
    let id = str(p.id, 16).replace(/[^\w-]/g, "") || `P${parts.length + 1}`;
    if (/^(BOARD|UNO|ESP32|ARDUINO)$/i.test(id)) continue;
    while (ids.has(id)) id += "x";
    ids.add(id);
    const type = TYPES.includes(p.type) ? p.type : "module";
    const pins = type === "module" ? (Array.isArray(p.pins) ? p.pins.map((x) => str(x, 12)).filter(Boolean) : []) : KINDS[type];
    parts.push({ id, type, label: str(p.label, 60) || type, value: str(p.value, 30), pins: type === "module" && !pins.length ? ["VCC", "GND", "OUT"] : pins, why: str(p.why, 400) });
  }
  const byId = new Map(parts.map((p) => [p.id.toLowerCase(), p]));

  // "R1.2", "BOARD.D8", "uno.8", "BTN1 pin 1" → { part, pin } or null.
  const end = (s) => {
    const m = String(s ?? "").trim().match(/^([\w-]+)\s*[.:\s]\s*(?:pin\s*)?(.+)$/i);
    if (!m) return null;
    const [, id, pin] = m;
    if (/^(BOARD|UNO|ESP32|ARDUINO|MCU)$/i.test(id)) {
      const name = boardPin(board, pin);
      return name ? { part: "BOARD", pin: name } : null;
    }
    const part = byId.get(id.toLowerCase());
    if (!part) return null;
    const want = pin.trim().replace("−", "-");
    const found = part.pins.find((x) => x.toLowerCase() === want.toLowerCase())
      ?? (part.type === "led" ? { anode: "A", "+": "A", cathode: "K", "-": "K" }[want.toLowerCase()] : null)
      ?? (part.type === "buzzer" ? { positive: "+", negative: "-", gnd: "-" }[want.toLowerCase()] : null);
    return found ? { part: part.id, pin: found } : null;
  };

  const wires = [];
  const wireMap = new Map(); // index in the AI's list → index here
  (Array.isArray(raw.wires) ? raw.wires : []).slice(0, 40).forEach((w, i) => {
    const a = end(w.from), b = end(w.to);
    if (!a || !b) { warnings.push(`Skipped a wire Yaver couldn't place: ${str(w.from, 30)} → ${str(w.to, 30)}.`); return; }
    wireMap.set(i, wires.length);
    wires.push({ from: a, to: b, color: WIRE_COLORS.includes(w.color) ? w.color : "blue", why: str(w.why, 300) });
  });

  const steps = [];
  const seenParts = new Set(), seenWires = new Set();
  for (const s of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 12)) {
    const sp = (Array.isArray(s.parts) ? s.parts : []).map((id) => byId.get(String(id).toLowerCase())?.id).filter((id) => id && !seenParts.has(id));
    const sw = (Array.isArray(s.wires) ? s.wires : []).map((i) => wireMap.get(Number(i))).filter((i) => i !== undefined && !seenWires.has(i));
    sp.forEach((id) => seenParts.add(id));
    sw.forEach((i) => seenWires.add(i));
    const lines = (Array.isArray(s.code_lines) ? s.code_lines : []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 400);
    steps.push({ title: str(s.title, 80) || `Step ${steps.length + 1}`, text: str(s.text, 1500), parts: sp, wires: sw, code_lines: lines });
  }
  // Anything no step mentioned: a part goes in the first step, a wire in the
  // first step after both its ends are in place.
  const firstBuild = steps.findIndex((s) => !s.code_lines.length);
  const leftover = parts.filter((p) => !seenParts.has(p.id));
  if (leftover.length) {
    if (firstBuild >= 0) steps[firstBuild].parts.unshift(...leftover.map((p) => p.id));
    else steps.unshift({ title: "Gather the parts", text: "Lay out the parts.", parts: leftover.map((p) => p.id), wires: [], code_lines: [] });
  }
  const partStep = (id) => (id === "BOARD" ? 0 : steps.findIndex((s) => s.parts.includes(id)));
  wires.forEach((w, i) => {
    if (seenWires.has(i)) return;
    const at = Math.max(partStep(w.from.part), partStep(w.to.part), 0);
    const target = steps.findIndex((s, k) => k >= at && !s.code_lines.length);
    (steps[target >= 0 ? target : at] ?? steps[0]).wires.push(i);
  });
  if (!steps.length) steps.push({ title: "Build it", text: "", parts: parts.map((p) => p.id), wires: wires.map((_, i) => i), code_lines: [] });

  const code = str(raw.code, 12000).replace(/\r\n?/g, "\n");
  if (!parts.length) warnings.push("The plan had no parts.");
  return {
    title: str(raw.title, 80) || "My project",
    summary: str(raw.summary, 800),
    board, parts, wires, code, steps,
    tips: (Array.isArray(raw.tips) ? raw.tips : []).map((t) => str(t, 300)).slice(0, 6),
    warnings,
  };
}

// ---- Saved projects ------------------------------------------------------------------

const SAVED = "yaver-projects";

export function savedProjects() {
  try { return JSON.parse(localStorage.getItem(SAVED) || "[]"); } catch { return []; }
}

// Keeps the plan (newest first, at most 12) and returns its index (0).
export function saveProject(plan) {
  const list = savedProjects().filter((p) => p.request !== plan.request || p.title !== plan.title);
  list.unshift({ ...plan, saved: Date.now() });
  try { localStorage.setItem(SAVED, JSON.stringify(list.slice(0, 12))); } catch {}
  return 0;
}

export function deleteProject(i) {
  const list = savedProjects();
  list.splice(i, 1);
  try { localStorage.setItem(SAVED, JSON.stringify(list)); } catch {}
}
