// Mini Yaver "the Uno's own ears" test: runs mini-yaver/ against a pretend v4
// Uno that records with its own microphone (MIC, sound bytes, a 0, ME 1|0)
// and plays the answer like MiniYaver.ino, with a pretend Gemini.
//
//   python3 -m http.server 8765        (from the repo root)
//   node tests/mini-mic.mjs
//
// CHROMIUM=/path/to/chromium picks the browser.
//
// It checks:
//  1. the page's Talk button asks the Uno to record (RC) instead of using the Mac's microphone;
//  2. the recording reaches Gemini as it is: one audio/wav part, 16-bit, 8000 a second, the right length;
//  3. nothing is sent to the Uno while it records (a weather update waits until the 0 byte);
//  4. "[heard: ...]" is taken out of the answer: the LCD and voice get only the answer,
//     the page shows what was heard, and the next question's history has words, not audio;
//  5. a clipped recording turns the microphone boost down (MG);
//  6. "ME 0" (no talking heard) ends quietly, without asking Gemini;
//  7. a busy Gemini (503) is tried again instead of failing, and the Mac never speaks;
//  8. the newest flash-lite model is used first, and one that's gone (404) is skipped.
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
  localStorage.setItem("miniyaver-micgain", "8");
  window.__events = [];
  const uno = { mode: "line", fill: 0, bytes: [], recording: false, macMic: 0 };
  window.__uno = uno;
  let push;
  const readable = new ReadableStream({ start(c) { push = (t) => c.enqueue(typeof t === "string" ? new TextEncoder().encode(t) : t); } });
  window.__unoSay = (line) => push(line + "\r\n");
  // The Uno records: "MIC", then `seconds` of a tone (loud = clipped), then a 0 and ME.
  window.__record = async (seconds, amp, heard = true) => {
    push("TALK\r\n");
    await new Promise((r) => setTimeout(r, 150));
    uno.recording = true;
    window.__events.push("<MIC>");
    push("MIC\r\n");
    const n = Math.round(seconds * 8000);
    for (let i = 0; i < n; i += 800) {
      const chunk = new Uint8Array(Math.min(800, n - i));
      for (let k = 0; k < chunk.length; k++) chunk[k] = Math.max(1, Math.min(255, Math.round(128 + amp * Math.sin((2 * Math.PI * 220 * (i + k)) / 8000))));
      push(chunk);
      await new Promise((r) => setTimeout(r, 100));
    }
    push(new Uint8Array([0]));
    window.__events.push("<END>");
    uno.recording = false;
    push(`ME ${heard ? 1 : 0}\r\n`);
  };
  setInterval(() => {
    if (uno.mode === "line" && !uno.draining) return;
    const n = Math.min(64, uno.fill);
    uno.fill -= n;
    if (n === 64) push("V\r\n");
    if (uno.draining && !uno.fill) { uno.draining = false; push("VE\r\n"); }
  }, 8);
  let buf = "";
  const writable = new WritableStream({
    write(chunk) {
      for (const b of chunk) {
        if (uno.mode === "sound") {
          if (b === 0) { uno.mode = "line"; uno.draining = true; window.__events.push(`SOUND ${uno.bytes.length}`); continue; }
          uno.bytes.push(b); uno.fill++;
          continue;
        }
        const c = String.fromCharCode(b);
        if (c !== "\n") { buf += c; continue; }
        const line = buf; buf = "";
        window.__events.push(uno.recording ? `DURING-REC ${line}` : line);
        if (line === "HI") push("HELLO MINIYAVER v4 VOICE MIC\r\n");
        if (line === "LS") push("ALMEND\r\n");
        if (line === "VO") { uno.mode = "sound"; uno.bytes = []; uno.fill = 0; }
        if (line === "RC") window.__record(1.2, 60);
        push("K\r\n");
      }
    },
  });
  const port = { open: async () => {}, readable, writable, addEventListener() {} };
  Object.defineProperty(navigator, "serial", { value: { requestPort: async () => port, getPorts: async () => [] } });
  window.webkitSpeechRecognition = class { start() { window.__uno.macMic++; setTimeout(() => this.onend?.(), 50); } abort() { this.onend?.(); } };
  window.SpeechRecognition = window.webkitSpeechRecognition;
  window.__macSpoke = 0;
  const realSpeak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => { window.__macSpoke++; realSpeak(u); };
});

// Pretend Gemini: busy (503) the first time it's asked.
const asked = [];
const tried = [];
let chatCalls = 0;
const pcm = Buffer.alloc(24000 * 2);
for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 400 * i) / 24000)), i * 2);
await page.route("https://generativelanguage.googleapis.com/**", async (r) => {
  const url = r.request().url();
  if (url.includes("/models?")) return r.fulfill({ json: { models: ["gemini-2.5-flash", "gemini-9.9-flash-lite", "gemini-2.5-flash-image", "gemini-9.8-flash-lite"].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ["generateContent"] })) } });
  if (/tts/.test(url)) return r.fulfill({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }] } });
  tried.push(url.match(/models\/([^:]+)/)[1]);
  if (url.includes("gemini-9.9-flash-lite")) return r.fulfill({ status: 404, body: "" });   // retired
  if (chatCalls++ === 0) return r.fulfill({ status: 503, body: "" });
  asked.push(JSON.parse(r.request().postData() || "{}"));
  return r.fulfill({ json: { candidates: [{ content: { role: "model", parts: [{ text: "[heard: what time is it] It is a quarter past midnight, sir." }] } }] } });
});
await page.route(/open-meteo\.com/, (r) => r.fulfill({ json: r.request().url().includes("geocoding")
  ? { results: [{ latitude: 47.1, longitude: 51.9, name: "Atyrau" }] }
  : { current: { temperature_2m: -3.2, apparent_temperature: -7, weather_code: 73, wind_speed_10m: 9 }, daily: { temperature_2m_max: [-1, 2], temperature_2m_min: [-8, -5], weather_code: [73, 3], precipitation_probability_max: [80, 10] } } }));
await page.route(/kokoro|huggingface|jsdelivr/, (r) => r.abort());

const fails = [];
await page.goto(`${BASE}/mini-yaver/`);
await page.click("#connect");
await page.waitForFunction(() => window.__events.includes("LS"), null, { timeout: 10000 }).catch(() => fails.push("never synced after HELLO"));
await page.waitForFunction(() => /own microphone/.test(document.querySelector("#s-mic").textContent), null, { timeout: 5000 }).catch(() => fails.push("status doesn't say the Uno's microphone is used"));
let ev = await page.evaluate(() => window.__events);
if (!ev.includes("MG 8")) fails.push("the microphone boost wasn't sent on connect");

// 1-4: the page's Talk button; a weather update is started while the Uno records.
await page.evaluate(() => { window.__events.length = 0; });
await page.click("#talk");
await page.waitForFunction(() => window.__events.includes("<MIC>"), null, { timeout: 5000 }).catch(() => fails.push("the Uno was never asked to record"));
await page.fill("#city", "Atyrau");
await page.dispatchEvent("#city", "change");
await page.waitForFunction(() => window.__events.includes("ST I"), null, { timeout: 20000 }).catch(() => fails.push("the conversation never finished"));
ev = await page.evaluate(() => window.__events);
if (ev[0] !== "RC") fails.push(`the Talk button didn't send RC first: ${ev.join(" | ")}`);
if (await page.evaluate(() => window.__uno.macMic)) fails.push("the Mac's microphone was used");
if (ev.some((l) => l.startsWith("DURING-REC"))) fails.push(`a line was sent while the Uno recorded: ${ev.filter((l) => l.startsWith("DURING-REC")).join(", ")}`);
const wx = ev.findIndex((l) => l.startsWith("WX ")), end = ev.indexOf("<END>");
if (wx < 0 || wx < end) fails.push(`the weather update didn't wait for the recording (WX at ${wx}, end at ${end})`);
const audio = asked[0]?.contents?.at(-1)?.parts?.find((p) => p.inlineData);
if (!audio || audio.inlineData.mimeType !== "audio/wav") fails.push("Gemini didn't get the recording as audio/wav");
else {
  const wav = Buffer.from(audio.inlineData.data, "base64");
  const rate = wav.readUInt32LE(24), bits = wav.readUInt16LE(34), samples = wav.readUInt32LE(40) / 2;
  if (wav.toString("ascii", 0, 4) !== "RIFF" || rate !== 8000 || bits !== 16) fails.push(`wav header wrong: ${rate} Hz ${bits} bit`);
  if (Math.abs(samples - 9600) > 10) fails.push(`wav length ${samples}, expected 9600`);
}
const pieces = ev.filter((l) => l.startsWith("A ")).map((l) => l.slice(2)).join("");
if (/heard/i.test(pieces) || !/quarter past midnight/.test(pieces)) fails.push(`LCD text wrong: ${pieces}`);
if (!ev.some((l) => l.startsWith("SOUND "))) fails.push("the answer wasn't spoken on the buzzer");
if (!(await page.textContent("#log")).includes("what time is it")) fails.push("the page doesn't show what was heard");

// 5: a clipped recording; and the history now holds words, not audio.
await page.evaluate(() => { window.__events.length = 0; window.__record(1, 200); });
await page.waitForFunction(() => window.__events.includes("ST I"), null, { timeout: 20000 }).catch(() => fails.push("second conversation never finished"));
ev = await page.evaluate(() => window.__events);
if (!ev.includes("MG 5")) fails.push(`a clipped recording didn't lower the boost to 5: ${ev.filter((l) => l.startsWith("MG")).join(",") || "no MG"}`);
const hist = asked[1]?.contents ?? [];
if (hist.filter((c) => c.parts?.some((p) => p.inlineData)).length !== 1) fails.push("old recordings are still in the history");
if (!hist.some((c) => c.parts?.some((p) => /what time is it/.test(p.text ?? "")))) fails.push("the first question isn't in the history as words");

// 6: nothing heard
const before = asked.length;
await page.evaluate(() => { window.__events.length = 0; window.__record(0.5, 2, false); });
await page.waitForFunction(() => /didn't hear any talking/.test(document.querySelector("#log").textContent), null, { timeout: 5000 }).catch(() => fails.push("ME 0 wasn't reported"));
await page.waitForTimeout(500);
if (asked.length !== before) fails.push("Gemini was asked although nothing was heard");
if (await page.evaluate(() => document.querySelector("#talk").classList.contains("on"))) fails.push("the page is still busy after ME 0");

// 7
if (chatCalls < 2 || /503|too busy/.test(await page.textContent("#log"))) fails.push("a busy Gemini wasn't tried again");
if (await page.evaluate(() => window.__macSpoke)) fails.push("the Mac spoke");
// 8
if (tried[0] !== "gemini-9.9-flash-lite" || !tried.includes("gemini-9.8-flash-lite")) fails.push(`models tried in the wrong order: ${tried.slice(0, 4).join(", ")}`);
if (tried.includes("gemini-2.5-flash-image")) fails.push("an image model was tried");
if (!/gemini-9\.8-flash-lite/.test(await page.textContent("#s-brain"))) fails.push(`status doesn't show the model that answered: ${await page.textContent("#s-brain")}`);

await browser.close();
if (errors.length) fails.push(...errors.map((e) => `page error: ${e}`));
if (fails.length) { console.log(`FAIL\n- ${fails.join("\n- ")}`); process.exit(1); }
console.log(`PASS: the Uno's recordings reached Gemini as audio, lines waited for them, the answer came back without "[heard]", and the boost went 8 → 5 after clipping.`);
