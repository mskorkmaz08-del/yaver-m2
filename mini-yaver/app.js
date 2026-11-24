// Mini Yaver's link to the internet: runs in Chrome on the Mac and talks to
// the Uno over USB (Web Serial). The Uno is Yaver: it records you with its own
// microphone (the KY-037) and sends the sound here; this page hands that
// recording to Gemini as it is, and sends the answer back: the text for the
// LCD and the spoken voice for the buzzer (or the Mac's speakers: Settings).
// An Uno with an older sketch (no "MIC" in its hello) is heard through the
// Mac's microphone instead.
//
// Messages to the Uno are one line each; the Uno answers every line with "K",
// and we wait for that before sending the next (it can only hold 64 bytes).
//   TM <local seconds>   set the clock        ST L|T|S|I|E   listen/think/speak/idle/error
//   HD <text>            what was heard       AB, A <text>, AE   the answer, in pieces
//   AL <id> <at> <kind> <label>  timer T, alarm A, daily D, reminder R
//   AX <id>|*  delete    LS  list them        WX <text> weather    SL 1|0 sleep clock
//   VO  then raw sound bytes (8000 a second, 1-255) ended by a 0 byte    VX stop talking
//   RC  record (listen) now      MG <1-32>  microphone boost
// From the Uno: HELLO, TALK, STOP, CLAP2, RING/DONE/SNOOZE <id>, ALM ... ALMEND, SLEEP 0|1,
//   V (room for 64 more sound bytes), VE (the voice has finished), VN (can't talk now),
//   MIC then the recording (8000 bytes a second, 1-255) ended by a 0 byte, then ME 1|0 (heard talking or not)
import { geminiSettings, saveKey } from "../src/assistant/keys.js?v=28";
import { pickChatModel } from "../src/assistant/gemini.js?v=28";
import { Speaker } from "../src/assistant/voice.js?v=28";

const API = "https://generativelanguage.googleapis.com/v1beta";
const $ = (id) => document.getElementById(id);
const store = { get: (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---- The Uno over USB ------------------------------------------------------

const VOICE_RATE = 8000;       // sound bytes a second
const VOICE_START_ROOM = 448;  // the Uno's ring holds 512; leave a little spare
const VOICE_ROOM = 64;         // each "V" from the Uno frees this many

class Uno extends EventTarget {
  constructor() {
    super();
    this.port = null; this.chain = Promise.resolve(); this.ackWaiter = null;
    this.canVoice = false;     // a v3 sketch can talk through its buzzer
    this.canMic = false;       // a v4 sketch records with its own microphone
    this.room = 0; this.roomWaiter = null; this.voiceEnd = null; this.refused = false; this.cut = false;
    this.recording = null;     // while the Uno sends a recording: a promise for its end
    this.release = null;
  }
  get connected() { return Boolean(this.writer); }

  async open(port) {
    this.port = port;
    await port.open({ baudRate: 115200 });
    this.writer = port.writable.getWriter();
    this.readLoop();
    port.addEventListener("disconnect", () => this.closed());
    this.emit("open");
  }

  // Lines of text, except between "MIC" and a 0 byte: that's a recording.
  async readLoop() {
    const reader = this.port.readable.getReader();
    const text = new TextDecoder();
    let line = [];
    let mic = null, micLen = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const b of value) {
          if (mic) {
            if (b !== 0) {
              if (micLen === mic.length) { const bigger = new Uint8Array(mic.length * 2); bigger.set(mic); mic = bigger; }
              mic[micLen++] = b;
              continue;
            }
            this.emit("mic", mic.slice(0, micLen));
            mic = null;
            this.endRecording();
            continue;
          }
          if (b === 13) continue;
          if (b !== 10) { line.push(b); continue; }
          const l = text.decode(new Uint8Array(line)).trim();
          line = [];
          if (!l) continue;
          if (l === "MIC") { mic = new Uint8Array(16000); micLen = 0; this.startRecording(); }
          else if (l === "K") { this.ackWaiter?.(); this.ackWaiter = null; }
          else if (l === "V") { this.room += VOICE_ROOM; this.roomWaiter?.(true); }
          else if (l === "VE") { this.voiceEnd?.(); }
          else if (l === "VN") { this.refused = true; }
          else this.emit("line", l);
        }
      }
    } catch { /* unplugged */ }
    this.closed();
  }

  // While the Uno records, it can't read lines: hold them until it's done.
  startRecording() {
    this.recording = new Promise((resolve) => { this.release = resolve; });
    this.emit("recording");
    setTimeout(() => this.endRecording(), 15000);   // never hold for ever
  }
  endRecording() { this.release?.(); this.release = null; this.recording = null; }

  closed() {
    if (!this.writer) return;
    this.writer = null;
    this.canVoice = false;
    this.canMic = false;
    this.roomWaiter?.(false); this.voiceEnd?.(); this.endRecording();
    this.emit("close");
  }

  async line(text) {
    if (this.recording) await this.recording;
    if (!this.writer) return;
    const ack = new Promise((resolve) => { this.ackWaiter = resolve; setTimeout(resolve, 1500); });
    await this.writer.write(new TextEncoder().encode(text + "\n")).catch(() => {});
    await ack;
  }

  // Sends one line, then waits for the Uno's "K" (at most 1.5 s).
  send(line) {
    const job = this.chain.then(() => this.line(line));
    this.chain = job;
    return job;
  }

  // Plays sound bytes (1-255, 8000 a second) on the Uno's buzzer. Resolves
  // true when the Uno has played them all, false if it couldn't talk. Sent in
  // the same queue as the lines, so nothing else lands in the middle of the
  // sound; never more than the Uno has room for.
  voice(bytes) {
    const job = this.chain.then(async () => {
      if (!this.writer || !this.canVoice) return false;
      this.refused = false; this.cut = false;
      const ended = new Promise((resolve) => { this.voiceEnd = resolve; });
      await this.line("VO");
      if (this.refused || !this.writer) { this.voiceEnd = null; return false; }
      this.room = VOICE_START_ROOM;
      let i = 0;
      while (i < bytes.length && !this.cut && this.writer) {
        if (this.room < VOICE_ROOM) {
          const more = await new Promise((resolve) => { this.roomWaiter = resolve; setTimeout(() => resolve(false), 1500); });
          this.roomWaiter = null;
          if (!more && this.room < VOICE_ROOM) break;     // the Uno stopped making room
          continue;
        }
        const n = Math.min(this.room, 256, bytes.length - i);
        this.room -= n;
        await this.writer.write(bytes.subarray(i, i + n)).catch(() => {});
        i += n;
      }
      await this.writer?.write(new Uint8Array([0])).catch(() => {});
      if (this.cut) await this.line("VX");
      await Promise.race([ended, new Promise((r) => setTimeout(r, 2500))]);
      this.voiceEnd = null;
      return true;
    });
    this.chain = job.then(() => {});
    return job;
  }

  stopVoice() { this.cut = true; this.roomWaiter?.(false); }

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

// Yaver's voice made for the buzzer: 8000 numbers a second, 1 to 255, with
// 128 as silence (0 is kept for "the end"). A buzzer can't move much air below
// about 400 Hz and rings loudest around 2-4 kHz, so the bass it can't play is
// cut, the 1-3 kHz where the words are is lifted, and the quiet parts are
// made louder so every syllable uses the whole swing.
async function buzzerBytes(samples, rate) {
  const len = Math.ceil((samples.length * VOICE_RATE) / rate);
  const ctx = new OfflineAudioContext(1, len, VOICE_RATE);
  const buf = ctx.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lowCut = ctx.createBiquadFilter(); lowCut.type = "highpass"; lowCut.frequency.value = 380; lowCut.Q.value = 0.7;
  const words = ctx.createBiquadFilter(); words.type = "peaking"; words.frequency.value = 2000; words.Q.value = 0.8; words.gain.value = 6;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -30; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.12;
  src.connect(lowCut).connect(words).connect(comp).connect(ctx.destination);
  src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  let peak = 1e-4;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = 1.4 / peak;                 // a little past full, softly rounded off below
  const ramp = Math.round(VOICE_RATE * 0.03);         // 30 ms fade from rest to the middle, and back: no click
  const bytes = new Uint8Array(out.length + ramp * 2);
  for (let i = 0; i < ramp; i++) { bytes[i] = 1 + Math.round((127 * i) / ramp); bytes[bytes.length - 1 - i] = bytes[i]; }
  for (let i = 0; i < out.length; i++) bytes[ramp + i] = Math.max(1, Math.min(255, Math.round(128 + 127 * Math.tanh(out[i] * gain))));
  return bytes;
}

// The Uno's recording as a .wav for Gemini: the middle taken out and made
// as loud as it can be without clipping, 16-bit, 8000 samples a second.
function wavBase64(bytes) {
  let mean = 0;
  for (const b of bytes) mean += b;
  mean /= bytes.length || 1;
  let peak = 1;
  for (const b of bytes) peak = Math.max(peak, Math.abs(b - mean));
  const scale = 30000 / peak;
  const n = bytes.length;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_RATE, true); view.setUint32(28, VOICE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round((bytes[i] - mean) * scale), true);
  const raw = new Uint8Array(view.buffer);
  let bin = "";
  for (let i = 0; i < raw.length; i += 0x8000) bin += String.fromCharCode(...raw.subarray(i, i + 0x8000));
  return btoa(bin);
}

// After each recording, nudge the Uno's microphone boost: down if your voice
// hit the top (clipped), up if it barely moved.
let micGain = Number(store.get("miniyaver-micgain", "8")) || 8;
function tuneGain(bytes) {
  const dev = Array.from(bytes, (b) => Math.abs(b - 128)).sort((a, b) => a - b);
  const loud = dev[Math.floor(dev.length * 0.995)] ?? 0;           // nearly the loudest
  const clipped = dev.filter((d) => d >= 126).length / (dev.length || 1);
  let g = micGain;
  if (clipped > 0.002) g = Math.max(1, Math.floor(g * 0.7));
  else if (loud < 45) g = Math.min(32, Math.ceil(g * 1.4));
  if (g !== micGain) { micGain = g; store.set("miniyaver-micgain", String(g)); uno.send(`MG ${g}`); }
  micStatus();
  return { loud, clipped };
}
function micStatus() {
  $("s-mic").textContent = !uno.connected ? "Ears: the Uno's microphone (once connected)"
    : uno.canMic ? `Ears: the Uno's own microphone (KY-037), boost ×${micGain}, adjusted after each use`
    : "Ears: the Mac's microphone (this Uno has an older sketch)";
  dot("d-mic", uno.connected ? (uno.canMic ? "ok" : "warn") : "");
}

// Lets you hear what Yaver's microphone heard (to judge the KY-037).
let playCtx = null;
function playRecording(bytes) {
  playCtx ??= new AudioContext();
  const buf = playCtx.createBuffer(1, bytes.length, VOICE_RATE);
  const ch = buf.getChannelData(0);
  let peak = 1;
  for (const b of bytes) peak = Math.max(peak, Math.abs(b - 128));
  for (let i = 0; i < bytes.length; i++) ch[i] = ((bytes[i] - 128) / peak) * 0.9;
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.connect(playCtx.destination);
  src.start();
}

// ---- What the page shows ---------------------------------------------------

function log(text, who = "note") {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
  return div;
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
The user often speaks to you as audio recorded by your own small microphone (8 kHz, noisy). For an audio message, start your spoken reply with what you understood, written as [heard: their words], then answer. If you can't make out the words, say so in one short sentence and ask them to speak closer to you.
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

// `question` is text, or the parts of an audio message. Returns the answer;
// for audio, `heard` gets what Gemini understood.
const HEARD = /\[heard:\s*([^\]]*)\]\s*/i;
async function think(question, heard = {}) {
  if (!brain) throw new Error("I need a Gemini key first: paste it at the top of the page.");
  const turn = { role: "user", parts: typeof question === "string" ? [{ text: question }] : question };
  history.push(turn);
  try { return await thinkRounds(heard); }
  finally {
    // Keep only words in the history, not the recording: much smaller next time.
    if (turn.parts.some((p) => p.inlineData)) turn.parts = [{ text: heard.text ? `(said aloud) ${heard.text}` : "(an audio message)" }];
  }
}
async function thinkRounds(heard) {
  for (let round = 0; round < 4; round++) {
    // The last few exchanges, always starting at one of his questions (never
    // between a tool call and its result).
    let start = Math.max(0, history.length - 16);
    const isQuestion = (m) => m.role === "user" && (typeof m.parts?.[0]?.text === "string" || Boolean(m.parts?.[0]?.inlineData));
    while (start > 0 && !isQuestion(history[start])) start--;
    const content = await gemini(history.slice(start));
    history.push({ role: "model", parts: content.parts?.length ? content.parts : [{ text: "" }] });
    const calls = (content.parts ?? []).filter((p) => p.functionCall);
    const said = (content.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join(" ");
    const h = said.match(HEARD);
    if (h && !heard.text) heard.text = h[1].trim();
    if (!calls.length) return said.replace(HEARD, "").trim();
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
function voiceStatus() {
  const where = $("voiceout").value === "mac" ? "the Mac's speakers" : !uno.connected ? "the Uno's buzzer (once connected)" : uno.canVoice ? "the Uno's buzzer" : "the Mac (this Uno has the old sketch)";
  $("s-voice").textContent = `Voice: ${speaker.voiceName}, from ${where}`;
}
speaker.addEventListener("ready", () => { voiceStatus(); dot("d-voice", "ok"); });
let listening = false, busy = false, rec = null;

// Says the answer from the Uno's buzzer: the natural voice is made here, cut
// down to what a buzzer can play, and streamed to the Uno. Falls back to the
// Mac's speakers when the buzzer can't (Mac chosen in Settings, an old
// sketch, the Uno busy ringing, or no natural voice yet).
async function speak(text, still = () => true) {
  if ($("voiceout").value !== "mac" && uno.connected && uno.canVoice && speaker.natural) {
    const a = await speaker.neural.synth(text.replace(/[*_#`>]+/g, "").trim()).catch(() => null);
    if (!still()) return;
    if (a?.samples?.length && (await uno.voice(await buzzerBytes(a.samples, a.rate)))) return;
    if (!still()) return;
  }
  await speaker.say(text);
}

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

// Space, the Talk button, or TALK from an older Uno. A v4 Uno listens with its
// own microphone: we only ask it to start (RC); the rest comes as "MIC".
async function conversation() {
  if (busy) { stopAll(); return; }
  if (uno.connected && uno.canMic) { speaker.unlock(); uno.send("RC"); return; }
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
  await respond(answer);
}

// The Uno's recording arrived and it heard talking: hand it to Gemini as it is.
async function heardAudio(bytes) {
  busy = true;
  speaker.stop();
  tuneGain(bytes);
  const entry = log(`🎙 ${(bytes.length / VOICE_RATE).toFixed(1)} s from Yaver's microphone`, "you");
  const play = document.createElement("button");
  play.textContent = "▶ hear it";
  play.className = "mini";
  play.addEventListener("click", () => playRecording(bytes));
  entry.append(" ", play);
  $("talk").textContent = "💭 Thinking…";
  lcdMirror(" Thinking...");
  await uno.send("ST T");
  const heard = {};
  let answer;
  try { answer = await think([{ inlineData: { mimeType: "audio/wav", data: wavBase64(bytes) } }], heard); }
  catch (err) { answer = err.message; await uno.send("ST E"); }
  if (heard.text) entry.firstChild.textContent = `🎙 “${heard.text}” `;
  await respond(answer);
}

// The answer: to the LCD in pieces, then out loud.
async function respond(answer) {
  if (!busy) return;
  log(answer, "yaver");
  lcdMirror(ascii(answer).slice(0, 16), ascii(answer).slice(16, 32));
  await toLcd(answer);
  await uno.send("ST S");
  $("talk").textContent = "🔊 Speaking… (click to stop)";
  await speak(answer, () => busy);
  await uno.send("ST I");
  finish();
}
function finish() { busy = false; $("talk").classList.remove("on"); $("talk").innerHTML = "🎙 Talk to Yaver <small>(Space, the Uno's button, or clap twice)</small>"; }
micStatus();
function stopAll() { rec?.abort(); speaker.stop(); uno.stopVoice(); uno.send("ST I"); finish(); }

$("talk").addEventListener("click", () => conversation());
document.addEventListener("keydown", (e) => { if (e.code === "Space" && !e.target.closest("input, select, textarea")) { e.preventDefault(); conversation(); } });
document.addEventListener("click", () => { speaker.unlock(); $("banner").style.display = "none"; });

// ---- Messages from the Uno ----------------------------------------------------

let lastMic = null;
uno.addEventListener("mic", ({ detail }) => { lastMic = detail; });

uno.addEventListener("line", ({ detail: line }) => {
  const [cmd, ...rest] = line.split(" ");
  if (cmd === "HELLO") {
    uno.canVoice = rest.includes("VOICE");
    uno.canMic = rest.includes("MIC");
    micStatus();
    log(uno.canVoice ? "The Uno said hello. Yaver speaks from its buzzer." : "The Uno said hello. It has the old sketch, so Yaver speaks from the Mac: upload the new MiniYaver.ino to hear him from the buzzer.");
    voiceStatus();
    syncUno();
  }
  else if (cmd === "TALK") {
    if (uno.canMic) {                                   // the Uno is listening with its own microphone
      if (busy) stopAll();
      busy = true;
      speaker.stop();
      $("talk").classList.add("on");
      $("talk").textContent = "🎙 Yaver is listening… (its own microphone)";
      lcdMirror(" Listening");
    } else if (!busy) conversation();
  }
  else if (cmd === "ME") {                              // the recording is complete
    const mic = lastMic;
    lastMic = null;
    if (rest[0] === "1" && mic?.length) heardAudio(mic);
    else { log("Yaver didn't hear any talking. Speak a little closer, right after the beep."); finish(); }
  }
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
  if (uno.canMic) await uno.send(`MG ${micGain}`);
  const wx = store.get("miniyaver-wx");
  if (wx) await uno.send(`WX ${ascii(wx).slice(0, 12)}`);
  await uno.send("LS");
  weather().catch(() => {});
}

uno.addEventListener("open", () => {
  $("s-uno").textContent = "Uno connected.";
  dot("d-uno", "ok");
  $("connect").style.display = "none";
  voiceStatus();
  micStatus();
  setTimeout(() => uno.send("HI"), 2200);   // opening the port restarts the Uno; it says HELLO when ready
});
uno.addEventListener("close", () => {
  $("s-uno").textContent = "Uno unplugged.";
  dot("d-uno", "");
  $("connect").style.display = "";
  voiceStatus();
  micStatus();
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
$("voiceout").value = store.get("miniyaver-voiceout", "uno");
$("voiceout").addEventListener("change", () => { store.set("miniyaver-voiceout", $("voiceout").value); voiceStatus(); });
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
