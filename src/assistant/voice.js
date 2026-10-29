import { synth as geminiSynth } from "./gemini.js?v=17";

// Listening and speaking, with no keys needed. Listening uses Chrome's speech
// recognition (Chrome sends the audio to Google to turn it into text);
// speaking uses a natural neural voice (see Speaker at the bottom).

// Ways speech recognition tends to hear "Yaver".
const WAKE = /\b(?:hey\s+|ok\s+|okay\s+)?(?:yaver|yavar|yavor|yawer|javer|jabber|java|jarvis|yahweh|ya\s?ver|yeah\s?ver|y\s?aver)\b[\s,.!?]*/i;
const COMMAND_TIMEOUT_MS = 7000;  // after "Yaver", how long to wait for the request
const FOLLOW_UP_MS = 8000;        // after Yaver answers, how long to listen for a reply
const END_OF_SPEECH_MS = 750;     // this much silence ends a request (Chrome itself waits longer)

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
      if (this.enabled && !this.paused) setTimeout(() => this.startRec(), 50);
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
    clearTimeout(this.silenceTimer);
    if (on) this.rec?.abort();
    else this.startRec();
  }

  // After Yaver answers: listen for a reply without needing "Yaver" again,
  // so it's a normal back-and-forth conversation.
  followUp() {
    this.setMode("command", FOLLOW_UP_MS);
    if (this.paused) this.pause(false);
  }

  // Skip the wake word: take the next thing said as a request (the orb
  // button and the Space key use this).
  listenNow() {
    this.setMode("command");
    if (!this.enabled) this.start();
    else if (this.paused) this.pause(false);
  }

  setMode(mode, timeout = COMMAND_TIMEOUT_MS) {
    this.mode = mode;
    clearTimeout(this.commandTimer);
    clearTimeout(this.silenceTimer);
    if (mode === "command") {
      this.commandTimer = setTimeout(() => { this.setMode("wake"); }, timeout);
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
      const request = interim.replace(WAKE, "").trim();
      this.emit("interim", request);
      // Answer as soon as he stops talking, instead of waiting for Chrome to
      // decide the sentence is over. Restarting drops Chrome's late copy.
      clearTimeout(this.silenceTimer);
      if (request) {
        this.silenceTimer = setTimeout(() => {
          if (this.mode !== "command" || this.paused) return;
          this.rec.abort();
          this.finish(request);
        }, END_OF_SPEECH_MS);
      }
    }
  }

  handleFinal(text) {
    clearTimeout(this.silenceTimer);
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

// The computer's built-in voices: available instantly but robotic. Only used
// if the natural voice below can't run on this computer. Picks a British male
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

// Mark One's "JARVIS" touch, one per audio output: trim the boom, lift the
// presence a little and add a very short metallic echo.
const chains = new WeakMap();
export function jarvisOutput(ctx) {
  if (chains.has(ctx)) return chains.get(ctx);
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 140;
  const pres = ctx.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 3200; pres.gain.value = 3; pres.Q.value = 0.9;
  const dry = ctx.createGain(); dry.gain.value = 0.9;
  const echo = ctx.createDelay(0.05); echo.delayTime.value = 0.012;
  const fb = ctx.createGain(); fb.gain.value = 0.25;
  const wet = ctx.createGain(); wet.gain.value = 0.22;
  hp.connect(pres); pres.connect(dry); dry.connect(ctx.destination);
  pres.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(ctx.destination);
  chains.set(ctx, hp);
  return hp;
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
const SYNTH_TIMEOUT_MS = 15000;

class NeuralSpeaker extends EventTarget {
  constructor() {
    super();
    this.kokoroReady = false;
    this.failed = false;
    this.gemini = null;          // { key, voice } when there is a Gemini key
    this.geminiPausedUntil = 0;
    this.queue = 0;
    this.nextId = 0;
    this.pending = new Map();    // Kokoro job id -> resolve(result)
    this.playing = Promise.resolve();
    this.epoch = 0;              // bumped by stop(), so queued audio is dropped
    this.source = null;
    this.ctx = null;
    this.worker = null;          // Kokoro, started by loadKokoro()
  }

  // Downloads (the first time) and starts Kokoro. Not needed while Gemini's
  // voice is available.
  loadKokoro() {
    if (this.worker) return;
    this.worker = new Worker(new URL("./tts-worker.js?v=17", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data.type === "progress") this.dispatchEvent(new CustomEvent("progress", { detail: data.pct }));
      else if (data.type === "ready") { this.kokoroReady = true; this.dispatchEvent(new Event("ready")); }
      else if (data.type === "error") this.kokoroFailed(data.message);
      else if (data.type === "begin") this.pending.get(data.id)?.begin();
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
  unlock() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  async canPlay() {
    this.unlock();
    if (this.ctx.state !== "running") {
      await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    }
    return this.ctx.state === "running";
  }

  output() {
    return jarvisOutput(this.ctx);
  }

  kokoro(text) {
    if (!this.kokoroReady) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      // Never wait forever: a sentence stuck for long after the worker
      // started on it is skipped (the clock starts then, not while it waits
      // for the sentences before it).
      let timer;
      const job = (d) => { clearTimeout(timer); resolve(d.error ? null : { samples: d.samples, rate: d.rate }); };
      job.begin = () => { timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, SYNTH_TIMEOUT_MS); };
      this.pending.set(id, job);
      this.worker.postMessage({ type: "speak", id, text, voice: KOKORO_VOICE, speed: 1.05 });
    });
  }

  async synth(text) {
    if (this.geminiOn) {
      try {
        return await Promise.race([
          geminiSynth(this.gemini.key, text, this.gemini.voice),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SYNTH_TIMEOUT_MS)),
        ]);
      } catch (err) {
        console.warn("Google voice failed, using Kokoro for a while", err);
        this.geminiPausedUntil = Date.now() + GEMINI_PAUSE_MS;
        this.loadKokoro();
        this.dispatchEvent(new Event("ready"));
      }
    }
    return this.kokoro(text);
  }

  // Resolves when spoken. `blocked(text)` gets a piece the browser wouldn't
  // let us play yet (no click or key press so far).
  say(text, blocked) {
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
      if (!a?.samples?.length) console.warn("Natural voice couldn't voice:", text);
      else if (await this.canPlay()) await this.play(a.samples, a.rate);
      else blocked?.(text);
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
    // Drop sentences Kokoro hasn't voiced yet, so the next answer isn't
    // stuck behind them.
    this.worker?.postMessage({ type: "cancel", before: this.nextId });
    try { this.source?.stop(); } catch {}
    this.source = null;
    this.playing = Promise.resolve();
    if (this.queue) { this.queue = 0; this.dispatchEvent(new Event("end")); }
  }
}

// What the assistant talks through: only the natural voice. While it is
// still downloading (the first time only) Yaver answers in text; the robotic
// built-in voice is used only if the natural one can't run at all.
export class Speaker extends EventTarget {
  constructor() {
    super();
    this.system = new SystemSpeaker();
    this.neural = null;
    this.retry = null; // text the browser blocked; said on the next click or key
    try { this.neural = new NeuralSpeaker(); } catch (err) { console.warn("No natural voice", err); }
    for (const s of [this.system, this.neural].filter(Boolean)) {
      s.addEventListener("start", () => this.dispatchEvent(new Event("start")));
      s.addEventListener("end", () => { if (!this.speaking) this.dispatchEvent(new Event("end")); });
    }
    this.neural?.addEventListener("progress", (e) => this.dispatchEvent(new CustomEvent("progress", { detail: e.detail })));
    this.neural?.addEventListener("ready", () => this.dispatchEvent(new Event("ready")));
    this.neural?.addEventListener("failed", () => this.dispatchEvent(new Event("failed")));
  }

  get loading() { return Boolean(this.neural) && !this.neural.ready && !this.neural.failed; }
  get natural() { return Boolean(this.neural?.ready); }
  get speaking() { return this.system.speaking || Boolean(this.neural?.speaking); }

  get voiceName() {
    if (this.natural) return this.neural.name;
    return this.loading ? "loading" : "built-in";
  }

  // Call from a click or key press: lets the natural voice make sound, and
  // says whatever the browser blocked before.
  unlock() {
    this.neural?.unlock();
    if (this.retry) {
      const text = this.retry;
      this.retry = null;
      this.system.blocked = false;
      setTimeout(() => this.say(text), 50);
    }
  }

  useGemini(key, voice) { this.neural?.useGemini(key, voice); }
  loadKokoro() { this.neural?.loadKokoro(); }

  say(text) {
    if (this.natural) return this.neural.say(text, (t) => { this.retry = this.retry ? `${this.retry} ${t}` : t; });
    if (this.loading) return Promise.resolve(); // text only until the voice is ready
    return this.system.say(text).then(() => { if (this.system.blocked) this.retry = text; });
  }

  stop() {
    this.retry = null;
    this.system.stop();
    this.neural?.stop();
  }
}
