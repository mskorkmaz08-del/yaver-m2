// Mini Yaver buzzer-voice test: runs mini-yaver/ against a pretend v3 Uno that
// plays sound bytes the way MiniYaver.ino does (8000 a second out of a
// 512-byte ring, "V" for every 64 played, "VE" when done), with a pretend
// Gemini voice.
//
//   python3 -m http.server 8765        (from the repo root)
//   node tests/mini-voice.mjs
//
// CHROMIUM=/path/to/chromium picks the browser.
//
// It checks:
//  1. a v3 Uno gets the answer as sound: "VO", then the bytes, then a 0;
//  2. every sound byte is 1-255 (0 would end the stream early), the length
//     matches the voice at 8000 a second, and it isn't silent;
//  3. the page never sends more than the Uno has room for (the ring never overflows);
//  4. no text line lands in the middle of the sound, and "ST I" comes after "VE";
//  5. the Uno's button mid-sentence (STOP) cuts the sound: a 0 and "VX" follow quickly.
import { createRequire } from "module";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); }
const BASE = process.env.BASE ?? "http://localhost:8765";

const browser = await playwright.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.addInitScript(() => {
  localStorage.setItem("yaver-gemini-key", "test-key");
  localStorage.setItem("miniyaver-city", "Almaty");
  window.__events = [];          // text lines and sound streams, in order
  window.__say = "tell me a joke";
  const RING = 512;
  const uno = { mode: "line", fill: 0, maxFill: 0, played: 0, bytes: [], cut: false };
  window.__uno = uno;
  let push;
  const readable = new ReadableStream({ start(c) { push = (t) => c.enqueue(new TextEncoder().encode(t)); } });
  window.__unoSay = (line) => push(line + "\r\n");
  // Playback: 64 bytes every 8 ms, like the timer.
  setInterval(() => {
    if (uno.mode === "line" && !uno.draining) return;
    const n = Math.min(64, uno.fill);
    uno.fill -= n; uno.played += n;
    if (n === 64) push("V\r\n");
    if (uno.draining && !uno.fill) { uno.draining = false; push("VE\r\n"); }
  }, 8);
  let buf = "";
  const writable = new WritableStream({
    write(chunk) {
      for (const b of chunk) {
        if (uno.mode === "sound") {
          if (b === 0) { uno.mode = "line"; uno.draining = true; window.__events.push(`SOUND ${uno.bytes.length}`); if (uno.cut) uno.fill = 0; continue; }
          uno.bytes.push(b);
          if (!uno.cut) { uno.fill++; uno.maxFill = Math.max(uno.maxFill, uno.fill); }
          continue;
        }
        const c = String.fromCharCode(b);
        if (c !== "\n") { buf += c; continue; }
        const line = buf; buf = "";
        window.__events.push(line);
        if (line === "HI") push("HELLO MINIYAVER v3 VOICE\r\n");
        if (line === "LS") push("ALMEND\r\n");
        if (line === "VO") { uno.mode = "sound"; uno.bytes = []; uno.fill = 0; uno.maxFill = 0; uno.cut = false; }
        if (line === "VX") uno.fill = 0;
        push("K\r\n");
      }
    },
  });
  const port = { open: async () => {}, readable, writable, addEventListener() {} };
  Object.defineProperty(navigator, "serial", { value: { requestPort: async () => port, getPorts: async () => [] } });
  window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { this.onresult?.({ results: [[{ transcript: window.__say }]] }); setTimeout(() => this.onend?.(), 50); }, 100); }
    abort() { this.onend?.(); }
  };
  window.SpeechRecognition = window.webkitSpeechRecognition;
});

// Pretend Gemini: a short answer, and a voice that is 1.5 s of a gliding tone at 24 kHz.
const VOICE_SECONDS = 1.5, RATE = 24000;
const pcm = Buffer.alloc(VOICE_SECONDS * RATE * 2);
for (let i = 0; i < VOICE_SECONDS * RATE; i++) pcm.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * (300 + i / 40) * (i / RATE))), i * 2);
await page.route("https://generativelanguage.googleapis.com/**", async (r) => {
  const url = r.request().url();
  if (url.includes("/models?")) return r.fulfill({ json: { models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] } });
  if (/tts/.test(url)) return r.fulfill({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: `audio/L16;codec=pcm;rate=${RATE}`, data: pcm.toString("base64") } }] } }] } });
  return r.fulfill({ json: { candidates: [{ content: { role: "model", parts: [{ text: "Why did the robot cross the road? It was programmed to, sir." }] } }] } });
});
await page.route(/open-meteo\.com/, (r) => r.fulfill({ json: r.request().url().includes("geocoding")
  ? { results: [{ latitude: 43.24, longitude: 76.95, name: "Almaty" }] }
  : { current: { temperature_2m: -3.2, apparent_temperature: -7, weather_code: 73, wind_speed_10m: 9 }, daily: { temperature_2m_max: [-1, 2], temperature_2m_min: [-8, -5], weather_code: [73, 3], precipitation_probability_max: [80, 10] } } }));
await page.route(/kokoro|huggingface|jsdelivr/, (r) => r.abort());

const fails = [];
await page.goto(`${BASE}/mini-yaver/`);
await page.click("#connect");
await page.waitForFunction(() => window.__events.includes("LS"), null, { timeout: 10000 }).catch(() => fails.push("never synced after HELLO"));
await page.waitForFunction(() => /buzzer/.test(document.querySelector("#s-voice").textContent), null, { timeout: 5000 }).catch(() => fails.push("status doesn't say the buzzer speaks"));

// 1-4: a whole answer
await page.evaluate(() => { window.__events.length = 0; window.__unoSay("TALK"); });
await page.waitForFunction(() => window.__events.includes("ST I"), null, { timeout: 20000 }).catch(() => fails.push("the conversation never finished"));
let ev = await page.evaluate(() => window.__events);
const uno = await page.evaluate(() => ({ ...window.__uno, bytes: window.__uno.bytes }));
const vo = ev.indexOf("VO"), snd = ev.findIndex((l) => l.startsWith("SOUND ")), sti = ev.indexOf("ST I");
if (vo < 0 || snd !== vo + 1) fails.push(`sound not sent right after VO: ${ev.join(" | ")}`);
if (!(ev.indexOf("ST S") < vo && sti > snd)) fails.push(`order wrong: ${ev.join(" | ")}`);
const expect = VOICE_SECONDS * 8000;
if (Math.abs(uno.bytes.length - expect) > 1200) fails.push(`sound length ${uno.bytes.length}, expected about ${expect}`);
if (uno.bytes.some((b) => b < 1 || b > 255)) fails.push("a sound byte is out of range");
const swing = Math.max(...uno.bytes) - Math.min(...uno.bytes);
if (swing < 150) fails.push(`the sound is too quiet: swing ${swing}`);
if (uno.maxFill > 512) fails.push(`the ring overflowed: ${uno.maxFill} bytes waiting`);
if (uno.played < uno.bytes.length - 64) fails.push(`not all of it was played before ST I: ${uno.played} of ${uno.bytes.length}`);

// 5: the button mid-sentence
await page.evaluate(() => { window.__events.length = 0; window.__uno.played = 0; window.__unoSay("TALK"); });
await page.waitForFunction(() => window.__uno.mode === "sound" && window.__uno.bytes.length > 2000, null, { timeout: 20000 }).catch(() => fails.push("second answer never started sounding"));
const t0 = Date.now();
await page.evaluate(() => { window.__uno.cut = true; window.__unoSay("STOP"); });
await page.waitForFunction(() => window.__events.includes("VX"), null, { timeout: 4000 }).catch(() => fails.push("STOP didn't end the sound with VX"));
const stopMs = Date.now() - t0;
ev = await page.evaluate(() => window.__events);
const cutAt = await page.evaluate(() => window.__uno.bytes.length);
if (cutAt > 8000) fails.push(`the whole sound was sent anyway (${cutAt} bytes)`);
if (stopMs > 1000) fails.push(`stopping took ${stopMs} ms`);

await browser.close();
if (errors.length) fails.push(...errors.map((e) => `page error: ${e}`));
if (fails.length) { console.log(`FAIL\n- ${fails.join("\n- ")}`); process.exit(1); }
console.log(`PASS: ${uno.bytes.length} sound bytes streamed (ring peak ${uno.maxFill} of 512), and STOP cut the next answer after ${cutAt} bytes in ${stopMs} ms.`);
