// Real-time conversation through Google's Gemini Live API: the microphone
// streams straight to Gemini, and Gemini streams its spoken answer straight
// back, so Yaver answers in well under a second, in a natural voice, and can
// be interrupted just by talking. Needs a free Gemini key (see keys.js).
import { jarvisOutput } from "./voice.js?v=17";

const API = "https://generativelanguage.googleapis.com/v1beta";
const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const PREFERRED_MODEL = "gemini-3.8-live";
const IN_RATE = 16000;  // Gemini wants 16 kHz 16-bit PCM in…
const OUT_RATE = 24000; // …and sends 24 kHz back.

// Runs in the audio thread: turns the microphone into 40 ms chunks of 16-bit
// PCM, plus how loud each chunk was.
const CAPTURE_WORKLET = `
class YaverCapture extends AudioWorkletProcessor {
  constructor() { super(); this.out = new Int16Array(640); this.n = 0; this.sum = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.sum += s * s;
      this.out[this.n++] = s * 0x7fff;
      if (this.n === this.out.length) {
        const level = Math.sqrt(this.sum / this.n);
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(640); this.n = 0; this.sum = 0;
      }
    }
    return true;
  }
}
registerProcessor("yaver-capture", YaverCapture);
`;

// The newest Live model this key may use.
let modelCache = null;
export async function pickLiveModel(key) {
  if (modelCache) return modelCache;
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    if (!res.ok) return PREFERRED_MODEL;
    const live = ((await res.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("bidiGenerateContent"))
      .map((m) => m.name.replace("models/", ""))
      .filter((n) => !/translate|transcribe|thinking/.test(n));
    const ver = (n) => parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]);
    live.sort((a, b) => /preview|exp/.test(a) - /preview|exp/.test(b) || ver(b) - ver(a) || a.length - b.length);
    modelCache = live.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : live[0] || PREFERRED_MODEL;
  } catch {
    modelCache = PREFERRED_MODEL;
  }
  return modelCache;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64Pcm(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

// Google's voice sometimes adds a short burst of static after it stops
// talking (Mark One trims the same thing). This holds back the newest audio
// just long enough to recognise such a burst: a short, noisy sound (it crosses
// zero far more often than a voice) after a pause, with silence after it.
// Everything else passes straight through.
const WIN = 480;              // 20 ms at 24 kHz
const LOUD = 500 / 32768;     // quieter than this is silence
const GAP_WINDOWS = 6;        // a burst comes after at least 120 ms of silence…
const BURST_MAX = 12;         // …lasts at most 240 ms…
const AFTER_WINDOWS = 3;      // …and is followed by 60 ms of silence
const NOISY_ZCR = 0.35;
const MIN_AHEAD_S = 0.15;     // never hold audio back when less than this is queued to play

export class StaticTrimmer {
  // `ahead()`: seconds of voice already queued to play. Holding audio back
  // must never make the voice run dry (that's a stutter), so when little is
  // queued, doubtful sounds are let through.
  constructor(release, ahead = () => Infinity) {
    this.release = release; // gets cleaned Float32Array pieces, in order
    this.ahead = ahead;
    this.ready = [];        // windows released by the current drain
    this.reset();
  }

  reset() {
    this.ready = [];
    this.windows = [];  // [{ samples, loud, zcr }] not yet released
    this.rest = new Float32Array(0);
    this.silence = 0;   // quiet windows just released
    this.spoke = false; // whether this turn has had any speech yet
    this.muted = false; // whether the last window was static
  }

  push(samples) {
    const all = new Float32Array(this.rest.length + samples.length);
    all.set(this.rest);
    all.set(samples, this.rest.length);
    let i = 0;
    for (; i + WIN <= all.length; i += WIN) {
      const w = all.subarray(i, i + WIN);
      let e = 0, z = 0;
      for (let j = 0; j < WIN; j++) { e += w[j] * w[j]; if (j && (w[j] >= 0) !== (w[j - 1] >= 0)) z++; }
      this.windows.push({ samples: w.slice(), loud: Math.sqrt(e / WIN) > LOUD, zcr: z / WIN });
    }
    this.rest = all.slice(i);
    this.drain(false);
    this.emit();
  }

  // Hands over what was released in one piece (fewer, longer sounds).
  emit() {
    if (!this.ready.length) return;
    const n = this.ready.reduce((a, w) => a + w.length, 0);
    const out = new Float32Array(n);
    let o = 0;
    for (const w of this.ready) { out.set(w, o); o += w.length; }
    this.ready = [];
    this.release(out);
  }

  // End of Yaver's turn: decide on whatever is left, and release it.
  flush() {
    this.drain(true);
    if (this.rest.length) this.ready.push(this.muted ? new Float32Array(this.rest.length) : this.rest);
    this.emit();
    this.reset();
  }

  drain(final) {
    while (this.windows.length) {
      const w = this.windows[0];
      if (!w.loud) { this.out(this.windows.shift(), false); this.silence++; continue; }
      // Speech straight on, or the first sound of the turn: no burst possible.
      if (this.silence < GAP_WINDOWS || !this.spoke) { this.out(this.windows.shift(), false); this.silence = 0; this.spoke = true; continue; }
      // A sound after a pause: wait until we know how long it lasts.
      let k = 0;
      while (k < this.windows.length && this.windows[k].loud) k++;
      if (k > BURST_MAX) { this.releaseSegment(k, false); continue; } // long: speech
      let after = 0;
      while (k + after < this.windows.length && !this.windows[k + after].loud && after < AFTER_WINDOWS) after++;
      if (after < AFTER_WINDOWS && !final) {
        if (this.ahead() > MIN_AHEAD_S) return; // not sure yet: wait for more
        this.releaseSegment(k, false);
        continue;
      }
      const zcr = this.windows.slice(0, k).reduce((a, b) => a + b.zcr, 0) / k;
      this.releaseSegment(k, zcr > NOISY_ZCR);
    }
  }

  releaseSegment(k, mute) {
    for (let n = 0; n < k; n++) this.out(this.windows.shift(), mute);
    this.silence = 0;
    if (!mute) this.spoke = true;
  }

  out(w, mute) {
    this.muted = mute;
    if (mute) w.samples.fill(0);
    this.ready.push(w.samples);
  }
}

// Events: "open", "close" (detail: reason), "speaking" / "quiet", "heard"
// (his words), "said" (Yaver's words), "turn" (Yaver finished a turn).
// options: { key, voice, system, tools: { declarations, run(name, args) } }
export class LiveSession extends EventTarget {
  constructor(options) {
    super();
    this.options = options;
    this.ws = null;
    this.ready = false;
    this.closed = false;
    this.pendingAudio = []; // mic chunks recorded before Gemini was ready
    this.pendingText = [];
    this.sources = new Set();
    this.playhead = 0;
    this.run = null;   // the gain of the current unbroken stretch of voice
    this.trimmer = new StaticTrimmer(
      (samples) => this.schedule(samples),
      () => (this.out && this.sources.size ? this.playhead - this.out.currentTime : 0),
    );
    this.turnStarted = false; // whether this turn's voice has started playing
    this.lastActivity = performance.now();
    this.resumeHandle = null;
  }

  get speaking() { return this.sources.size > 0; }

  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }

  // Starts the microphone at once (so nothing he says is lost) and connects.
  async start() {
    await this.startMic();
    this.out ??= new AudioContext({ sampleRate: OUT_RATE });
    if (this.out.state === "suspended") this.out.resume().catch(() => {});
    this.model = await pickLiveModel(this.options.key);
    await this.connect(0);
  }

  async startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.mic = new AudioContext({ sampleRate: IN_RATE });
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
    await this.mic.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(this.mic, "yaver-capture");
    node.port.onmessage = ({ data }) => this.onMic(data);
    this.mic.createMediaStreamSource(this.stream).connect(node);
    // The worklet only runs while connected to the output; keep it silent.
    const mute = this.mic.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(this.mic.destination);
  }

  onMic({ pcm, level }) {
    if (this.closed) return;
    if (level > 0.02) this.lastActivity = performance.now();
    const msg = { realtimeInput: { audio: { data: toBase64(pcm), mimeType: `audio/pcm;rate=${IN_RATE}` } } };
    if (this.ready) this.send(msg);
    else if (this.pendingAudio.length < 250) this.pendingAudio.push(msg); // up to 10 s
  }

  // The first attempt asks for everything; if Gemini refuses the setup,
  // simpler ones follow (no web search, then the default voice).
  setup(attempt) {
    const { voice, system, tools } = this.options;
    const setup = {
      model: `models/${this.model}`,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: system }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 500 } },
      sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
      tools: [{ functionDeclarations: tools.declarations }],
    };
    if (attempt < 1) setup.tools.push({ googleSearch: {} });
    if (attempt < 2) setup.generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
    if (attempt >= 3) { delete setup.realtimeInputConfig; delete setup.contextWindowCompression; }
    return { setup };
  }

  connect(attempt) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(this.options.key)}`);
      this.ws = ws;
      this.ready = false;
      let settled = false;
      ws.onopen = () => ws.send(JSON.stringify(this.setup(attempt)));
      ws.onmessage = async (e) => {
        const text = typeof e.data === "string" ? e.data : await e.data.text();
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        if (msg.setupComplete) {
          this.ready = true;
          settled = true;
          for (const m of this.pendingAudio.splice(0)) this.send(m);
          for (const t of this.pendingText.splice(0)) this.sendText(t);
          this.emit("open");
          resolve();
          return;
        }
        this.onServer(msg);
      };
      ws.onclose = (e) => {
        if (this.ws !== ws) return;
        this.ready = false;
        if (!settled) {
          // Refused before it started: try a simpler setup, unless the key
          // itself is the problem.
          const why = e.reason || `connection closed (${e.code})`;
          if (attempt < 3 && !/api key|permission|quota|exhausted|billing/i.test(why)) {
            this.connect(attempt + 1).then(resolve, reject);
          } else {
            reject(new Error(why));
          }
          return;
        }
        // Gemini ends connections after about 10 minutes: carry on seamlessly.
        if (!this.closed && this.resumeHandle) {
          this.connect(attempt).catch((err) => this.close(err.message));
        } else if (!this.closed) {
          this.close(e.reason || "Gemini ended the conversation");
        }
      };
      ws.onerror = () => {};
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // Something typed, or what he said before the session started.
  sendText(text) {
    this.lastActivity = performance.now();
    if (!this.ready) { this.pendingText.push(text); return; }
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
  }

  async onServer(msg) {
    this.lastActivity = performance.now();
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) return; // the reconnect in onclose handles it
    if (msg.toolCall) {
      const functionResponses = [];
      for (const call of msg.toolCall.functionCalls || []) {
        let response;
        try { response = { result: await this.options.tools.run(call.name, call.args || {}) }; }
        catch (err) { response = { error: err.message }; }
        functionResponses.push({ id: call.id, name: call.name, response });
      }
      this.send({ toolResponse: { functionResponses } });
      return;
    }
    const content = msg.serverContent;
    if (!content) return;
    if (content.interrupted) this.stopPlayback(); // he started talking
    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data && /audio/.test(part.inlineData.mimeType || "audio")) this.trimmer.push(fromBase64Pcm(part.inlineData.data));
    }
    if (content.generationComplete || content.turnComplete) this.trimmer.flush();
    if (content.turnComplete) this.turnStarted = false;
    if (content.inputTranscription?.text) this.emit("heard", content.inputTranscription.text);
    if (content.outputTranscription?.text) this.emit("said", content.outputTranscription.text);
    if (content.turnComplete) this.emit("turn");
  }

  // Queues a piece of Yaver's voice right after the previous one. Each
  // unbroken stretch fades in and out over a few milliseconds, so starts,
  // stops and gaps never click; the first piece waits a moment so that a
  // slightly late next piece doesn't leave a gap.
  schedule(samples) {
    if (!samples.length || this.closed) return;
    const ctx = this.out;
    const buf = ctx.createBuffer(1, samples.length, OUT_RATE);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (!this.run || this.playhead < ctx.currentTime + 0.01) {
      // A new stretch. At the start of a turn, wait a moment so a slightly
      // late next piece doesn't leave a gap; if the voice ran dry mid-turn,
      // carry on at once.
      this.playhead = ctx.currentTime + (this.turnStarted ? 0.02 : 0.15);
      this.turnStarted = true;
      this.run = ctx.createGain();
      this.run.gain.setValueAtTime(0, this.playhead);
      this.run.gain.linearRampToValueAtTime(1, this.playhead + 0.005);
      this.run.connect(jarvisOutput(ctx));
      this.fadeAt = 0;
    }
    src.connect(this.run);
    src.start(this.playhead);
    this.playhead += buf.duration;
    // Fade out at the new end of the stretch (moved along as pieces arrive).
    const g = this.run.gain;
    if (this.fadeAt) g.cancelScheduledValues(this.fadeAt);
    this.fadeAt = Math.max(ctx.currentTime, this.playhead - 0.008);
    g.setValueAtTime(1, this.fadeAt);
    g.linearRampToValueAtTime(0, this.playhead);
    if (!this.sources.size) this.emit("speaking");
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      this.lastActivity = performance.now();
      if (!this.sources.size) this.emit("quiet");
    };
  }

  // Interrupted: fade out quickly instead of cutting off mid-word.
  stopPlayback() {
    this.trimmer.reset();
    if (this.run && this.out) {
      const now = this.out.currentTime;
      this.run.gain.cancelScheduledValues(now);
      this.run.gain.setValueAtTime(this.run.gain.value, now);
      this.run.gain.linearRampToValueAtTime(0, now + 0.03);
      for (const src of this.sources) { try { src.stop(now + 0.035); } catch {} }
    }
    this.sources.clear();
    this.run = null;
    this.playhead = 0;
    this.turnStarted = false;
    this.emit("quiet");
  }

  // Seconds since anyone said anything.
  get idleSeconds() {
    return this.speaking ? 0 : (performance.now() - this.lastActivity) / 1000;
  }

  close(reason = "") {
    if (this.closed) return;
    this.closed = true;
    this.stopPlayback();
    try { this.ws?.close(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.mic?.close().catch(() => {});
    this.out?.close().catch(() => {});
    this.emit("close", reason);
  }
}
