// Real-time conversation through Google's Gemini Live API: the microphone
// streams straight to Gemini, and Gemini streams its spoken answer straight
// back, so Yaver answers in well under a second, in a natural voice, and can
// be interrupted just by talking. Needs a free Gemini key (see keys.js).
import { jarvisOutput } from "./voice.js?v=14";

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
      if (part.inlineData?.data && /audio/.test(part.inlineData.mimeType || "audio")) this.play(fromBase64Pcm(part.inlineData.data));
    }
    if (content.inputTranscription?.text) this.emit("heard", content.inputTranscription.text);
    if (content.outputTranscription?.text) this.emit("said", content.outputTranscription.text);
    if (content.turnComplete) this.emit("turn");
  }

  // Queues a chunk of Yaver's voice right after the previous one.
  play(samples) {
    if (!samples.length || this.closed) return;
    const ctx = this.out;
    const buf = ctx.createBuffer(1, samples.length, OUT_RATE);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(jarvisOutput(ctx));
    this.playhead = Math.max(this.playhead, ctx.currentTime + 0.03);
    src.start(this.playhead);
    this.playhead += buf.duration;
    if (!this.sources.size) this.emit("speaking");
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      this.lastActivity = performance.now();
      if (!this.sources.size) this.emit("quiet");
    };
  }

  stopPlayback() {
    for (const src of this.sources) { try { src.stop(); } catch {} }
    this.sources.clear();
    this.playhead = 0;
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
