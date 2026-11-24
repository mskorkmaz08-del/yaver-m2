// Mini Yaver brain page test: runs mini-yaver/ against a pretend Uno (a fake
// Web Serial port that answers like MiniYaver.ino), pretend speech
// recognition and a pretend Gemini, and checks the whole conversation.
//
//   python3 -m http.server 8765        (from the repo root)
//   node tests/mini-brain.mjs
//
// CHROMIUM=/path/to/chromium picks the browser.
//
// It checks:
//  1. connecting: the page says HI, and after HELLO sets the clock (TM) and asks for the alarms (LS);
//  2. a TALK from the Uno starts listening (ST L), shows what was heard (HD) and thinking (ST T);
//  3. Gemini's set_timer call becomes an AL line the Uno stores, with the right time and label;
//  4. the answer reaches the LCD in pieces of at most 40 letters (AB, A ..., AE) and the voice states (ST S, ST I);
//  5. a RING from the Uno is spoken, and the alarm list on the page shows the timer;
//  6. no line sent to the Uno is longer than its 72-byte line buffer.
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

// The pretend Uno, microphone and key.
await page.addInitScript(() => {
  localStorage.setItem("yaver-gemini-key", "test-key");
  localStorage.setItem("miniyaver-city", "Almaty");
  window.__sent = [];
  window.__say = "set a timer for 5 minutes for tea";
  const alarms = new Map();
  let push;
  const readable = new ReadableStream({ start(c) { push = (t) => c.enqueue(new TextEncoder().encode(t)); } });
  window.__unoSay = (line) => push(line + "\r\n");
  let buf = "";
  const writable = new WritableStream({
    write(chunk) {
      buf += new TextDecoder().decode(chunk);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        window.__sent.push(line);
        if (line === "HI") push("HELLO MINIYAVER v2\r\n");
        if (line.startsWith("AL ")) { const [, id, at, kind, ...label] = line.split(" "); alarms.set(id, `${id} ${at} ${kind} ${label.join(" ")}`); }
        if (line.startsWith("AX ")) { const id = line.slice(3); id === "*" ? alarms.clear() : alarms.delete(id); }
        if (line === "LS") { for (const a of alarms.values()) push(`ALM ${a}\r\n`); push("ALMEND\r\n"); }
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

// Pretend Gemini: first a tool call, then the spoken answer. Its voice fails, so nothing plays.
let calls = 0;
const asked = [];
await page.route("https://generativelanguage.googleapis.com/**", async (r) => {
  const url = r.request().url();
  if (url.includes("/models?")) return r.fulfill({ json: { models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] } });
  if (/tts/.test(url)) return r.fulfill({ status: 500, body: "" });
  const body = JSON.parse(r.request().postData() || "{}");
  asked.push(body);
  calls++;
  if (calls === 1) return r.fulfill({ json: { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "set_timer", args: { minutes: 5, label: "tea" } } }] } }] } });
  return r.fulfill({ json: { candidates: [{ content: { role: "model", parts: [{ text: "Very good, sir. Your tea timer is set for five minutes, and I shall ring the moment it is ready to drink." }] } }] } });
});
await page.route(/open-meteo\.com/, (r) => r.fulfill({ json: r.request().url().includes("geocoding")
  ? { results: [{ latitude: 43.24, longitude: 76.95, name: "Almaty" }] }
  : { current: { temperature_2m: -3.2, apparent_temperature: -7, weather_code: 73, wind_speed_10m: 9 }, daily: { temperature_2m_max: [-1, 2], temperature_2m_min: [-8, -5], weather_code: [73, 3], precipitation_probability_max: [80, 10] } } }));
await page.route(/kokoro|huggingface|jsdelivr/, (r) => r.abort());

const fails = [];
await page.goto(`${BASE}/mini-yaver/`);
await page.click("#connect");
await page.waitForFunction(() => window.__sent.includes("LS"), null, { timeout: 10000 }).catch(() => fails.push("never synced after HELLO"));
let sent = await page.evaluate(() => window.__sent);
// 1
if (!sent.includes("HI")) fails.push("no HI after connecting");
const tm = sent.find((l) => l.startsWith("TM "));
const localNow = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 1000);
if (!tm || Math.abs(Number(tm.slice(3)) - localNow) > 30) fails.push(`clock not set right: ${tm}`);
await page.waitForFunction(() => window.__sent.some((l) => l.startsWith("WX ")), null, { timeout: 5000 }).catch(() => fails.push("no weather sent to the LCD"));

// 2-4: the Uno's button
await page.evaluate(() => { window.__sent.length = 0; window.__unoSay("TALK"); });
await page.waitForFunction(() => window.__sent.includes("ST I"), null, { timeout: 15000 }).catch(() => fails.push("the conversation never finished"));
sent = await page.evaluate(() => window.__sent);
const order = ["ST L", "ST T", "AB", "AE", "ST S", "ST I"].map((x) => sent.indexOf(x));
if (order.some((i) => i < 0) || order.some((v, i) => i && v < order[i - 1])) fails.push(`states out of order: ${sent.join(" | ")}`);
if (!sent.some((l) => l.startsWith("HD ") && l.includes("tea"))) fails.push("heard text not shown");
const al = sent.find((l) => l.startsWith("AL "));
if (!al) fails.push("no timer sent to the Uno");
else {
  const [, id, at, kind, label] = al.split(" ");
  if (kind !== "T" || label !== "tea") fails.push(`timer is wrong: ${al}`);
  if (Math.abs(Number(at) - (localNow + 300)) > 30) fails.push(`timer time is wrong: ${al}`);
}
const pieces = sent.filter((l) => l.startsWith("A "));
if (!pieces.length || pieces.some((l) => l.length > 42)) fails.push(`answer pieces wrong: ${pieces.length}`);
if (!pieces.join("").includes("tea timer")) fails.push("answer text missing on the LCD");
if (!asked[1]?.contents?.some((c) => c.parts?.some((p) => p.functionResponse?.name === "set_timer"))) fails.push("the tool result wasn't sent back to Gemini");
// 5
await page.evaluate(() => window.__unoSay("RING 1 T tea"));
await page.waitForFunction(() => document.querySelector("#log").textContent.includes("tea timer is done"), null, { timeout: 4000 }).catch(() => fails.push("the ring wasn't announced"));
const list = await page.textContent("#alarms");
if (!/Timer/.test(list) || !/tea/.test(list)) fails.push(`alarm list doesn't show the timer: ${list}`);
// 6
sent = await page.evaluate(() => window.__sent);
const long = sent.filter((l) => l.length > 71);
if (long.length) fails.push(`lines too long for the Uno: ${long[0]}`);

await page.screenshot({ path: process.env.SHOT ?? "/dev/null" }).catch(() => {});
await browser.close();
if (errors.length) fails.push(...errors.map((e) => `page error: ${e}`));
if (fails.length) { console.log(`FAIL\n- ${fails.join("\n- ")}`); process.exit(1); }
console.log(`PASS: ${sent.length} lines to the pretend Uno; the timer, the answer and the ring all went through.`);
