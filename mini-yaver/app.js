// Mini Yaver's brain: runs in Chrome on the Mac and talks to the Uno over USB
// (Web Serial). The Uno is the face, the button, the clap sensor and the alarm
// clock; this page listens through the Mac's microphone, asks Gemini, speaks
// the answer in Yaver's voice and sends a short version to the LCD.
//
// Messages to the Uno are one line each; the Uno answers every line with "K",
// and we wait for that before sending the next (it can only hold 64 bytes).
//   TM <local seconds>   set the clock        ST L|T|S|I|E   listen/think/speak/idle/error
//   HD <text>            what was heard       AB, A <text>, AE   the answer, in pieces
//   AL <id> <at> <kind> <label>  timer T, alarm A, daily D, reminder R
//   AX <id>|*  delete    LS  list them        WX <text> weather    SL 1|0 sleep clock
// From the Uno: HELLO, TALK, STOP, CLAP2, RING/DONE/SNOOZE <id>, ALM ... ALMEND, SLEEP 0|1
import { geminiSettings, saveKey } from "../src/assistant/keys.js?v=28";
import { pickChatModel } from "../src/assistant/gemini.js?v=28";
import { Speaker } from "../src/assistant/voice.js?v=28";

const API = "https://generativelanguage.googleapis.com/v1beta";
const $ = (id) => document.getElementById(id);
const store = { get: (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---- The Uno over USB ------------------------------------------------------

class Uno extends EventTarget {
  constructor() { super(); this.port = null; this.chain = Promise.resolve(); this.ackWaiter = null; }
  get connected() { return Boolean(this.writer); }

  async open(port) {
    this.port = port;
    await port.open({ baudRate: 115200 });
    this.writer = port.writable.getWriter();
    this.readLoop();
    port.addEventListener("disconnect", () => this.closed());
    this.emit("open");
  }

  async readLoop() {
    const decoder = new TextDecoderStream();
    const done = this.port.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += value;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          if (line === "K") { this.ackWaiter?.(); this.ackWaiter = null; }
          else this.emit("line", line);
        }
      }
    } catch { /* unplugged */ }
    await done;
    this.closed();
  }

  closed() {
    if (!this.writer) return;
    this.writer = null;
    this.emit("close");
  }

  // Sends one line, then waits for the Uno's "K" (at most 1.5 s).
  send(line) {
    const job = this.chain.then(async () => {
      if (!this.writer) return;
      const ack = new Promise((resolve) => { this.ackWaiter = resolve; setTimeout(resolve, 1500); });
      await this.writer.write(new TextEncoder().encode(line + "\n")).catch(() => {});
      await ack;
    });
    this.chain = job;
    return job;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

const uno = new Uno();
const localNow = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 1000);

// Plain ASCII for the LCD: Turkish and other letters lose their marks.
const MAP = { ı: "i", İ: "I", ş: "s", Ş: "S", ğ: "g", Ğ: "G", ç: "c", Ç: "C", ö: "o", Ö: "O", ü: "u", Ü: "U", "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "°": "" };
function ascii(text) {
  return text.replace(/[ıİşŞğĞçÇöÖüÜ’‘“”–—…°]/g, (c) => MAP[c]).normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[*#_`>]/g, "").replace(/\s+/g, " ").trim();
}

async function toLcd(text) {
  const t = ascii(text).slice(0, 320);
  await uno.send("AB");
  for (let i = 0; i < t.length; i += 40) await uno.send("A " + t.slice(i, i + 40));
  await uno.send("AE");
}

// ---- What the page shows ---------------------------------------------------

function log(text, who = "note") {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}
function lcdMirror(a, b = "") { $("lcd").textContent = `${a.padEnd(16).slice(0, 16)}\n${b.padEnd(16).slice(0, 16)}`; }
function dot(id, state) { $(id).className = `dot ${state}`; }

// Timers, alarms and reminders as the Uno has them: { id: { at, kind, label } }.
let alarms = {};
let alarmsIncoming = null;
const KIND = { T: "⏱ Timer", A: "⏰ Alarm", D: "⏰ Every day", R: "📌 Reminder" };
function timeText(at) {
  const d = new Date((at + new Date().getTimezoneOffset() * 60) * 1000);
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
function renderAlarms() {
  const list = Object.entries(alarms).sort((a, b) => a[1].at - b[1].at);
  $("alarms").innerHTML = list.length
    ? list.map(([id, a]) => `<li><span>${KIND[a.kind] ?? a.kind} · <b>${timeText(a.at)}</b> · ${a.label.replace(/</g, "&lt;")}</span><button data-del="${id}">Delete</button></li>`).join("")
    : `<li><span class="muted">None yet.</span></li>`;
}
$("alarms").addEventListener("click", async (e) => {
  const id = e.target.dataset.del;
  if (!id) return;
  await uno.send(`AX ${id}`);
  await uno.send("LS");
});

// ---- Weather (Open-Meteo: free, no key) ------------------------------------

const WMO = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "fog", 48: "fog", 51: "drizzle", 53: "drizzle", 55: "drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow", 80: "showers", 81: "showers", 82: "heavy showers", 85: "snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm" };

async function place(name) {
  name = name || $("city").value.trim();
  if (name) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`).then((x) => x.json());
    const p = r.results?.[0];
    if (!p) throw new Error(`I couldn't find a place called ${name}.`);
    return { lat: p.latitude, lon: p.longitude, name: p.name };
  }
  const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 3600000 }))
    .catch(() => { throw new Error("I don't know your city yet. Type it under Settings, or allow location."); });
  return { lat: pos.coords.latitude, lon: pos.coords.longitude, name: "your location" };
}

async function weather(name) {
  const p = await place(name);
  const q = `latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=2`;
  const w = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`).then((x) => x.json());
  const c = w.current, d = w.daily;
  const now = `${Math.round(c.temperature_2m)}C ${WMO[c.weather_code] ?? ""}`.trim();
  if (!name) { uno.send(`WX ${ascii(now).slice(0, 12)}`); store.set("miniyaver-wx", now); }
  return {
    place: p.name,
    now: `${Math.round(c.temperature_2m)}°C, feels like ${Math.round(c.apparent_temperature)}°C, ${WMO[c.weather_code] ?? "?"}, wind ${Math.round(c.wind_speed_10m)} km/h`,
    today: `${Math.round(d.temperature_2m_min[0])} to ${Math.round(d.temperature_2m_max[0])}°C, ${WMO[d.weather_code[0]] ?? "?"}, rain or snow chance ${d.precipitation_probability_max[0]}%`,
    tomorrow: `${Math.round(d.temperature_2m_min[1])} to ${Math.round(d.temperature_2m_max[1])}°C, ${WMO[d.weather_code[1]] ?? "?"}`,
  };
}

// ---- What the AI can do (Gemini function calling) -------------------------

const nextId = () => { let id = 1; while (alarms[id]) id++; return id; };
function atTime(hhmm) {                       // "07:30" → the next 07:30, as local seconds
  const m = String(hhmm).match(/(\d{1,2})[:.]?(\d{2})?/);
  if (!m) throw new Error("time should look like 07:30");
  const day = Math.floor(localNow() / 86400) * 86400;
  let at = day + Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60;
  if (at <= localNow()) at += 86400;
  return at;
}
async function addAlarm(at, kind, label) {
  if (!uno.connected) throw new Error("The Uno isn't connected, so I can't keep timers. Click Connect Uno.");
  const id = nextId();
  label = ascii(label || "").slice(0, 13) || { T: "timer", A: "alarm", D: "alarm", R: "reminder" }[kind];
  await uno.send(`AL ${id} ${at} ${kind} ${label}`);
  alarms[id] = { at, kind, label };
  renderAlarms();
  return { ok: true, id, rings_at: timeText(at) };
}

const TOOLS = [
  { name: "set_timer", description: "Start a countdown timer that rings on the desk device.", parameters: { type: "object", properties: { minutes: { type: "number" }, seconds: { type: "number" }, label: { type: "string", description: "1-2 words, e.g. tea" } }, required: ["minutes"] },
    run: ({ minutes = 0, seconds = 0, label }) => addAlarm(localNow() + Math.round(minutes * 60 + seconds), "T", label) },
  { name: "set_alarm", description: "Set an alarm clock for a time of day (24h HH:MM, local).", parameters: { type: "object", properties: { time: { type: "string" }, label: { type: "string" }, every_day: { type: "boolean" } }, required: ["time"] },
    run: ({ time, label, every_day }) => addAlarm(atTime(time), every_day ? "D" : "A", label || "wake up") },
  { name: "set_reminder", description: "Remind the user of something, at a time of day or in some minutes.", parameters: { type: "object", properties: { text: { type: "string", description: "short, e.g. call mom" }, time: { type: "string", description: "HH:MM" }, in_minutes: { type: "number" } }, required: ["text"] },
    run: ({ text, time, in_minutes }) => addAlarm(time ? atTime(time) : localNow() + Math.round((in_minutes ?? 10) * 60), "R", text) },
  { name: "list_alarms", description: "List the timers, alarms and reminders that are set.", parameters: { type: "object", properties: {} },
    run: () => ({ items: Object.entries(alarms).map(([id, a]) => ({ id: Number(id), type: KIND[a.kind], when: timeText(a.at), label: a.label })) }) },
  { name: "cancel_alarm", description: "Delete a timer/alarm/reminder by id, or all of them.", parameters: { type: "object", properties: { id: { type: "number" }, all: { type: "boolean" } } },
    run: async ({ id, all }) => { await uno.send(all ? "AX *" : `AX ${id}`); await uno.send("LS"); return { ok: true }; } },
  { name: "get_weather", description: "Current weather and forecast. Leave place empty for the user's own city.", parameters: { type: "object", properties: { place: { type: "string" } } },
    run: ({ place: p }) => weather(p) },
  { name: "sleep_clock", description: "Turn the big night clock on the LCD on (good night) or off.", parameters: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
    run: async ({ on }) => { await uno.send(`SL ${on ? 1 : 0}`); return { ok: true }; } },
];

function system() {
  const now = new Date();
  return `You are Yaver, Mustafa's personal assistant, speaking out loud from a small desk robot (an Arduino with a 16x2 screen).
Talk like a calm, witty British butler (think JARVIS). Keep answers short: one to three spoken sentences, no lists, no markdown, no emoji.
Use your tools for timers, alarms, reminders, the weather and the night clock; never pretend to set something.
Reply in the language the user spoke. Now: ${now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`;
}

const history = [];
let brain = null; // { key, model }

function thinkingOff(model) {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-[3-9]/.test(model)) return { thinkingConfig: { thinkingLevel: "low" } };
  return {};
}

async function gemini(contents, fast = true) {
  const res = await fetch(`${API}/models/${brain.model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": brain.key, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system() }] },
      contents,
      tools: [{ functionDeclarations: TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters })) }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 500, ...(fast ? thinkingOff(brain.model) : {}) },
    }),
  });
  if (res.status === 400 && fast) return gemini(contents, false);
  if (!res.ok) throw new Error(res.status === 429 ? "The free AI limit is used up for now. Try again in a minute." : `Gemini said ${res.status}.`);
  return (await res.json()).candidates?.[0]?.content ?? { role: "model", parts: [] };
}

async function think(question) {
  if (!brain) throw new Error("I need a Gemini key first: paste it at the top of the page.");
  history.push({ role: "user", parts: [{ text: question }] });
  for (let round = 0; round < 4; round++) {
    // The last few exchanges, always starting at one of his questions (never
    // between a tool call and its result).
    let start = Math.max(0, history.length - 16);
    const isQuestion = (m) => m.role === "user" && typeof m.parts?.[0]?.text === "string";
    while (start > 0 && !isQuestion(history[start])) start--;
    const content = await gemini(history.slice(start));
    history.push({ role: "model", parts: content.parts?.length ? content.parts : [{ text: "" }] });
    const calls = (content.parts ?? []).filter((p) => p.functionCall);
    if (!calls.length) return (content.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join(" ").trim();
    const results = [];
    for (const { functionCall: fc } of calls) {
      const tool = TOOLS.find((t) => t.name === fc.name);
      let response;
      try { response = await tool.run(fc.args ?? {}); } catch (err) { response = { error: err.message }; }
      log(`⚙ ${fc.name} ${JSON.stringify(fc.args ?? {})}`);
      results.push({ functionResponse: { name: fc.name, response } });
    }
    history.push({ role: "user", parts: results });
  }
  return "Done, sir.";
}

// ---- Listening and speaking -------------------------------------------------

const speaker = new Speaker();
speaker.addEventListener("ready", () => { $("s-voice").textContent = `Voice: ${speaker.voiceName}`; dot("d-voice", "ok"); });
let listening = false, busy = false, rec = null;

function listen() {
  return new Promise((resolve) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { log("This browser can't listen. Use Chrome."); resolve(""); return; }
    rec = new SR();
    rec.lang = $("lang").value;
    rec.interimResults = true;
    rec.continuous = false;
    let final = "", lastSent = 0;
    rec.onresult = (e) => {
      const text = [...e.results].map((r) => r[0].transcript).join(" ");
      final = text;
      $("talk").textContent = `🎙 ${text}`;
      if (Date.now() - lastSent > 400) { lastSent = Date.now(); uno.send(`HD ${ascii(text).slice(-32)}`); }
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") log("Chrome needs permission to use the microphone: click the 🎙 in the address bar."); };
    rec.onend = () => { rec = null; resolve(final.trim()); };
    rec.start();
  });
}

async function conversation() {
  if (busy) { stopAll(); return; }
  busy = true;
  speaker.unlock();
  speaker.stop();
  $("talk").classList.add("on");
  $("talk").textContent = "🎙 Listening…";
  lcdMirror(" Listening");
  await uno.send("ST L");
  const question = await listen();
  if (!busy) return;
  if (!question) { await uno.send("ST I"); finish(); return; }
  log(question, "you");
  $("talk").textContent = "💭 Thinking…";
  lcdMirror(" Thinking...", ascii(question).slice(-11));
  await uno.send(`HD ${ascii(question).slice(-32)}`);
  await uno.send("ST T");
  let answer;
  try { answer = await think(question); } catch (err) { answer = err.message; await uno.send("ST E"); }
  if (!busy) return;
  log(answer, "yaver");
  lcdMirror(ascii(answer).slice(0, 16), ascii(answer).slice(16, 32));
  await toLcd(answer);
  await uno.send("ST S");
  $("talk").textContent = "🔊 Speaking… (click to stop)";
  await speaker.say(answer);
  await uno.send("ST I");
  finish();
}
function finish() { busy = false; $("talk").classList.remove("on"); $("talk").innerHTML = "🎙 Talk to Yaver <small>(Space, the Uno's button, or clap twice)</small>"; }
function stopAll() { rec?.abort(); speaker.stop(); uno.send("ST I"); finish(); }

$("talk").addEventListener("click", () => conversation());
document.addEventListener("keydown", (e) => { if (e.code === "Space" && !e.target.closest("input, select, textarea")) { e.preventDefault(); conversation(); } });
document.addEventListener("click", () => { speaker.unlock(); $("banner").style.display = "none"; });

// ---- Messages from the Uno ----------------------------------------------------

uno.addEventListener("line", ({ detail: line }) => {
  const [cmd, ...rest] = line.split(" ");
  if (cmd === "HELLO") { log("The Uno said hello."); syncUno(); }
  else if (cmd === "TALK") { if (!busy) conversation(); }
  else if (cmd === "STOP") { if (busy) stopAll(); }
  else if (cmd === "RING") {
    const [, kind, ...label] = rest;
    const what = label.join(" ");
    const say = kind === "T" ? `Sir, your ${what} timer is done.` : kind === "R" ? `A reminder, sir: ${what}.` : `Good morning, sir. It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    log(`🔔 ${say}`, "yaver");
    setTimeout(() => speaker.say(say), 1500);
  } else if (cmd === "DONE" || cmd === "SNOOZE") { uno.send("LS"); }
  else if (cmd === "ALM") {
    const [id, at, kind, ...label] = rest;
    (alarmsIncoming ??= {})[id] = { at: Number(at), kind, label: label.join(" ") };
  } else if (cmd === "ALMEND") { alarms = alarmsIncoming ?? {}; alarmsIncoming = null; renderAlarms(); }
  else if (cmd === "SLEEP") log(rest[0] === "1" ? "Sleep clock on. Good night." : "Sleep clock off.");
  else if (cmd === "FULL") log("The Uno has no room for more: it keeps 6 at a time.");
});

async function syncUno() {
  await uno.send(`TM ${localNow()}`);
  const wx = store.get("miniyaver-wx");
  if (wx) await uno.send(`WX ${ascii(wx).slice(0, 12)}`);
  await uno.send("LS");
  weather().catch(() => {});
}

uno.addEventListener("open", () => {
  $("s-uno").textContent = "Uno connected.";
  dot("d-uno", "ok");
  $("connect").style.display = "none";
  setTimeout(() => uno.send("HI"), 2200);   // opening the port restarts the Uno; it says HELLO when ready
});
uno.addEventListener("close", () => {
  $("s-uno").textContent = "Uno unplugged.";
  dot("d-uno", "");
  $("connect").style.display = "";
});
setInterval(() => { if (uno.connected) uno.send(`TM ${localNow()}`); }, 8000);       // also "I'm still here"
setInterval(() => { if (uno.connected) weather().catch(() => {}); }, 30 * 60000);

$("connect").addEventListener("click", async () => {
  speaker.unlock();
  if (!("serial" in navigator)) { log("This browser can't talk to USB devices. Open this page in Chrome."); return; }
  try { await uno.open(await navigator.serial.requestPort()); }
  catch (err) { if (err.name !== "NotFoundError") log(`Couldn't open the Uno: ${err.message}. Close the Arduino IDE's Serial Monitor and try again.`); }
});

// ---- Start ------------------------------------------------------------------

$("lang").value = store.get("miniyaver-lang", "en-US");
$("city").value = store.get("miniyaver-city");
$("lang").addEventListener("change", () => store.set("miniyaver-lang", $("lang").value));
$("city").addEventListener("change", () => { store.set("miniyaver-city", $("city").value.trim()); weather().catch((e) => log(e.message)); });

async function startBrain() {
  const s = await geminiSettings().catch(() => ({}));
  if (!s.geminiKey) {
    $("s-brain").textContent = "No AI key yet.";
    $("keyform").style.display = "";
    $("s-voice").textContent = "Voice: built-in until there is a key";
    dot("d-voice", "warn");
    return;
  }
  brain = { key: s.geminiKey, model: await pickChatModel(s.geminiKey, s.geminiModel).catch(() => "gemini-2.5-flash") };
  speaker.useGemini(s.geminiKey, s.ttsVoice || "Charon");
  $("s-brain").textContent = `Brain: Google ${brain.model}`;
  dot("d-brain", "ok");
  $("keyform").style.display = "none";
}
$("keyform").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await saveKey(e.target.key.value); await startBrain(); }
  catch (err) { $("s-brain").textContent = err.message; }
});

startBrain();
lcdMirror(" Mini Yaver", " not connected");
if ("serial" in navigator) {
  // A Uno this browser was allowed to use before: connect without asking.
  navigator.serial.getPorts().then((ports) => {
    if (!ports.length) return;
    uno.open(ports[0]).then(() => { $("banner").style.display = "block"; }).catch(() => {});
  });
}
