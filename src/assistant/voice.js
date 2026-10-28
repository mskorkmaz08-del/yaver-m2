import { synth as geminiSynth } from "./gemini.js?v=11";

// Listening and speaking, both built into Chrome, so no keys are needed.
// Listening uses the browser's speech recognition (Chrome sends the audio to
// Google to turn it into text); speaking uses the voices on this computer.

// Ways speech recognition tends to hear "Yaver".
const WAKE = /\b(?:hey\s+|ok\s+|okay\s+)?(?:yaver|yavar|yavor|yawer|javer|jabber|java|jarvis|yahweh|ya\s?ver|yeah\s?ver|y\s?aver)\b[\s,.!?]*/i;
const COMMAND_TIMEOUT_MS = 7000; // after "Yaver", how long to wait for the request

export class Listener extends EventTarget {
  constructor(lang = "en-US") {
    super();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(SR);
    this.enabled = false;
    this.paused = false;   // while Yaver is speaking, so it doesn't hear itself
    this.mode = "wake";    // "wake": waiting for "Yaver"; "command": taking a request
    if (!SR) return;
    this.rec = new SR();
    this.rec.lang = lang;
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.running = false;
    this.rec.onstart = () => { this.running = true; };
    this.rec.onend = () => {
      this.running = false;
      if (this.enabled && !this.paused) setTimeout(() => this.startRec(), 250);
    };
    this.rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.enabled = false;
        this.emit("blocked");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        console.warn("Speech recognition:", e.error);
      }
    };
    this.rec.onresult = (e) => this.onResult(e);
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  startRec() {
    if (this.running || !this.enabled || this.paused) return;
    try { this.rec.start(); } catch { /* already starting */ }
  }

  start() {
    if (!this.supported) return;
    this.enabled = true;
    this.startRec();
  }

  stop() {
    this.enabled = false;
    this.rec?.abort();
  }

  pause(on) {
    this.paused = on;
    if (on) this.rec?.abort();
    else this.startRec();
  }

  // Skip the wake word: take the next thing said as a request (the orb
  // button and the Space key use this).
  listenNow() {
    this.setMode("command");
    if (!this.enabled) this.start();
    else if (this.paused) this.pause(false);
  }

  setMode(mode) {
    this.mode = mode;
    clearTimeout(this.commandTimer);
    if (mode === "command") {
      this.commandTimer = setTimeout(() => { this.setMode("wake"); }, COMMAND_TIMEOUT_MS);
    }
    this.emit("mode", mode);
  }

  onResult(e) {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript.trim();
      if (!r.isFinal) { interim += text + " "; continue; }
      this.handleFinal(text);
    }
    interim = interim.trim();
    if (!interim) return;
    // Wake up as soon as the name is heard, before the sentence ends.
    if (this.mode === "wake" && WAKE.test(interim)) this.setMode("command");
    if (this.mode === "command") {
      clearTimeout(this.commandTimer);
      this.commandTimer = setTimeout(() => this.setMode("wake"), COMMAND_TIMEOUT_MS);
      this.emit("interim", interim.replace(WAKE, "").trim());
    }
  }

  handleFinal(text) {
    const m = text.match(WAKE);
    if (this.mode === "wake") {
      if (!m) return;
      const rest = text.slice(m.index + m[0].length).trim();
      if (rest) this.finish(rest);
      else this.setMode("command"); // just "Yaver": wait for the request
      return;
    }
    const request = (m ? text.slice(m.index + m[0].length) : text).trim();
    if (request) this.finish(request);
  }

  finish(text) {
    this.setMode("wake");
    this.emit("utterance", text);
  }
}

// ---- Speaking -------------------------------------------------------------------

// The computer's built-in voices: available instantly but robotic. Used until
// the natural voice below has loaded, or if it can't run. Picks a British male
// voice when there is one (macOS has "Daniel").
const PREFERRED = ["Daniel", "Arthur", "Google UK English Male", "Oliver", "Malcolm", "George"];

class SystemSpeaker extends EventTarget {
  constructor() {
    super();
    this.supported = "speechSynthesis" in window;
    this.voice = null;
    this.queue = 0;
    this.blocked = false;
    if (!this.supported) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice =
        PREFERRED.map((n) => voices.find((v) => v.name.startsWith(n))).find(Boolean) ||
        voices.find((v) => v.lang === "en-GB") ||
        voices.find((v) => v.lang.startsWith("en")) ||
        null;
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  get speaking() { return this.queue > 0; }

  // Queues one piece of text (a sentence or two). Resolves when it has been
  // spoken.
  say(text) {
    text = text.replace(/[*_#`>]+/g, "").trim();
    if (!this.supported || !text) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
      u.rate = 1.02;
      u.pitch = 0.95;
      const done = () => {
        this.queue = Math.max(0, this.queue - 1);
        if (!this.queue) this.dispatchEvent(new Event("end"));
        resolve();
      };
      u.onend = done;
      u.onerror = (e) => {
        // Chrome refuses to talk before the user has clicked or pressed a key.
        if (e.error === "not-allowed") this.blocked = true;
        done();
      };
      if (!this.queue) this.dispatchEvent(new Event("start"));
      this.queue++;
      speechSynthesis.speak(u);
    });
  }

  stop() {
    if (!this.supported) return;
    speechSynthesis.cancel();
    if (this.queue) { this.queue = 0; this.dispatchEvent(new Event("end")); }
  }
}

// The natural voices. Two sources, both free:
//  - Google's "Charon" (the voice Mark One uses), when Mark One's Gemini key
//    is in this browser. The free tier is small, so if it runs out Yaver
//    switches to Kokoro for a while.
//  - Kokoro "George", a calm British neural voice that runs on this computer
//    (tts-worker.js), downloaded once (about 90–300 MB).
// Both go through the same subtle "JARVIS" effect as Mark One.
const KOKORO_VOICE = "bm_george";
const GEMINI_PAUSE_MS = 10 * 60000;

class NeuralSpeaker extends EventTarget {
  constructor() {
    super();
    this.kokoroReady = false;
    this.failed = false;
    this.gemini = null;          // { key, voice } when Mark One has a key
    this.geminiPausedUntil = 0;
    this.queue = 0;
    this.nextId = 0;
    this.pending = new Map();    // Kokoro job id -> resolve(result)
    this.playing = Promise.resolve();
    this.epoch = 0;              // bumped by stop(), so queued audio is dropped
    this.source = null;
    this.ctx = null;
    this.chain = null;
    this.worker = new Worker(new URL("./tts-worker.js?v=11", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data.type === "progress") this.dispatchEvent(new CustomEvent("progress", { detail: data.pct }));
      else if (data.type === "ready") { this.kokoroReady = true; this.dispatchEvent(new Event("ready")); }
      else if (data.type === "error") this.kokoroFailed(data.message);
      else if (data.type === "audio") { this.pending.get(data.id)?.(data); this.pending.delete(data.id); }
    };
    this.worker.onerror = (e) => this.kokoroFailed(e.message);
    this.worker.postMessage({ type: "load" });
  }

  kokoroFailed(message) {
    this.failed = true;
    console.warn("Kokoro voice unavailable:", message);
    this.dispatchEvent(new Event("failed"));
  }

  useGemini(key, voice) {
    this.gemini = { key, voice: voice || "Charon" };
    this.dispatchEvent(new Event("ready"));
  }

  get geminiOn() { return Boolean(this.gemini) && Date.now() > this.geminiPausedUntil; }
  get ready() { return this.geminiOn || this.kokoroReady; }
  get name() { return this.geminiOn ? `Google "${this.gemini.voice}"` : this.kokoroReady ? 'Kokoro "George"' : "built-in"; }
  get speaking() { return this.queue > 0; }

  // Browsers only allow sound after the person has clicked or pressed a key.
  get blocked() { return !this.ctx || this.ctx.state !== "running"; }
  unlock() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  // Mark One's "JARVIS" touch: trim the boom, lift the presence a little and
  // add a very short metallic echo.
  output() {
    if (this.chain) return this.chain;
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 140;
    const pres = ctx.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 3200; pres.gain.value = 3; pres.Q.value = 0.9;
    const dry = ctx.createGain(); dry.gain.value = 0.9;
    const echo = ctx.createDelay(0.05); echo.delayTime.value = 0.012;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    hp.connect(pres); pres.connect(dry); dry.connect(ctx.destination);
    pres.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(ctx.destination);
    return (this.chain = hp);
  }

  kokoro(text) {
    if (!this.kokoroReady) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, (d) => resolve(d.error ? null : { samples: d.samples, rate: d.rate }));
      this.worker.postMessage({ type: "speak", id, text, voice: KOKORO_VOICE, speed: 1 });
    });
  }

  async synth(text) {
    if (this.geminiOn) {
      try {
        return await geminiSynth(this.gemini.key, text, this.gemini.voice);
      } catch (err) {
        console.warn("Google voice failed, using Kokoro for a while", err);
        this.geminiPausedUntil = Date.now() + GEMINI_PAUSE_MS;
        this.dispatchEvent(new Event("ready"));
      }
    }
    return this.kokoro(text);
  }

  // Resolves when spoken. `fallback(text)` speaks a piece that couldn't be
  // voiced naturally with the built-in voice.
  say(text, fallback) {
    text = text.replace(/[*_#`>]+/g, "").trim();
    if (!text) return Promise.resolve();
    this.unlock();
    const epoch = this.epoch;
    // Start voicing right away, so the next sentence is ready while this one
    // plays; play them strictly in order.
    const audio = this.synth(text);
    if (!this.queue) this.dispatchEvent(new Event("start"));
    this.queue++;
    const done = () => {
      if (epoch !== this.epoch) return;
      this.queue = Math.max(0, this.queue - 1);
      if (!this.queue) this.dispatchEvent(new Event("end"));
    };
    this.playing = this.playing.then(async () => {
      const a = await audio;
      if (epoch !== this.epoch) return done();
      if (a?.samples?.length && this.ctx.state === "running") await this.play(a.samples, a.rate);
      else await fallback?.(text);
      done();
    });
    return this.playing;
  }

  play(samples, rate) {
    return new Promise((resolve) => {
      const buf = this.ctx.createBuffer(1, samples.length, rate);
      buf.copyToChannel(samples, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.output());
      src.onended = () => { if (this.source === src) this.source = null; resolve(); };
      this.source = src;
      src.start();
    });
  }

  stop() {
    this.epoch++;
    try { this.source?.stop(); } catch {}
    this.source = null;
    this.playing = Promise.resolve();
    if (this.queue) { this.queue = 0; this.dispatchEvent(new Event("end")); }
  }
}

// What the assistant talks through: the natural voice once it's ready, the
// built-in voice until then (and if the natural one can't run).
export class Speaker extends EventTarget {
  constructor() {
    super();
    this.system = new SystemSpeaker();
    this.neural = null;
    try { this.neural = new NeuralSpeaker(); } catch (err) { console.warn("No natural voice", err); }
    for (const s of [this.system, this.neural].filter(Boolean)) {
      s.addEventListener("start", () => this.dispatchEvent(new Event("start")));
      s.addEventListener("end", () => { if (!this.speaking) this.dispatchEvent(new Event("end")); });
    }
    this.neural?.addEventListener("progress", (e) => this.dispatchEvent(new CustomEvent("progress", { detail: e.detail })));
    this.neural?.addEventListener("ready", () => this.dispatchEvent(new Event("ready")));
    this.neural?.addEventListener("failed", () => this.dispatchEvent(new Event("failed")));
  }

  get active() { return this.neural?.ready ? this.neural : this.system; }
  get speaking() { return this.system.speaking || Boolean(this.neural?.speaking); }
  get natural() { return this.active === this.neural; }
  get blocked() { return this.active.blocked; }
  set blocked(v) { this.system.blocked = v; }

  get voiceName() { return this.natural ? this.neural.name : "built-in"; }

  // Call from a click or key press: lets the natural voice make sound.
  unlock() { this.neural?.unlock(); }

  useGemini(key, voice) { this.neural?.useGemini(key, voice); }

  say(text) {
    if (this.active === this.neural) return this.neural.say(text, (t) => this.system.say(t));
    return this.system.say(text);
  }

  stop() {
    this.system.stop();
    this.neural?.stop();
  }
}
