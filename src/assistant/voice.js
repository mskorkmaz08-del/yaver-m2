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

// Picks a calm British male voice when the computer has one (macOS has
// "Daniel"), for the proper butler feel.
const PREFERRED = ["Daniel", "Arthur", "Google UK English Male", "Oliver", "Malcolm", "George"];

export class Speaker extends EventTarget {
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
