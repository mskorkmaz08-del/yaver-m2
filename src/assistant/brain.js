// Yaver's brain, fastest and smartest first. None of them needs a key typed in:
//  - Gemini, if Mark One already has its free Google key in this browser
//    (see markone.js).
//  - Puter: free cloud models (GPT-5.4 nano by default) through puter.js.
//    Puter asks for a free account once (one click); after that it is
//    remembered.
//  - Local: a small language model (Qwen 3.5) that runs on this computer's
//    graphics chip through WebLLM. It downloads once (about 1.5 GB), then
//    works offline. Only loaded when there is no cloud brain.
//  - Pollinations' free text API, a last resort (heavily rate limited).
import { geminiSettings } from "./keys.js?v=16";
import { pickChatModel, streamChat } from "./gemini.js?v=16";

const GEMINI_PAUSE_MS = 10 * 60000;
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";
const CLOUD_URL = "https://text.pollinations.ai/";
const CLOUD_GAP_MS = 30000;
const PUTER_URL = "https://js.puter.com/v2/";
const PUTER_MODEL = "gpt-5.4-nano";

let puterLoading = null;
function loadPuter() {
  puterLoading ??= new Promise((resolve, reject) => {
    if (window.puter) return resolve(window.puter);
    const script = document.createElement("script");
    script.src = PUTER_URL;
    script.onload = () => (window.puter ? resolve(window.puter) : reject(new Error("Puter didn't start")));
    script.onerror = () => { puterLoading = null; reject(new Error("Couldn't reach Puter")); };
    document.head.appendChild(script);
  });
  return puterLoading;
}

// Model ids from WebLLM's prebuilt list. q4f32 is for GPUs without 16-bit
// float support. ?brain=smart picks the bigger model (needs about 4 GB of
// graphics memory, so a Mac with 16 GB or more).
const MODELS = {
  fast: { f16: "Qwen3.5-2B-q4f16_1-MLC", f32: "Qwen3.5-2B-q4f32_1-MLC" },
  smart: { f16: "Qwen3.5-4B-q4f16_1-MLC", f32: "Qwen3.5-4B-q4f32_1-MLC" },
};

// Small models sometimes still write out their reasoning; never speak it.
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
}

export class Brain extends EventTarget {
  constructor() {
    super();
    this.engine = null;
    this.state = "starting"; // starting | gemini | puter | signin | loading | local | cloud
    this.puter = null;        // puter.js, once signed in
    this.gemini = null;       // { key, model }
    this.geminiPausedUntil = 0;
    this.localStarted = false;
    this.detail = "";
    this.lastCloudAt = -Infinity;
  }

  setState(state, detail = "") {
    this.state = state;
    this.detail = detail;
    this.dispatchEvent(new Event("state"));
  }

  // Uses Gemini when Mark One has a key; otherwise starts loading the local
  // model in the background (replies use the free cloud until it's ready).
  async init() {
    const { geminiKey, geminiModel } = await geminiSettings();
    if (geminiKey) {
      try {
        this.gemini = { key: geminiKey, model: await pickChatModel(geminiKey, geminiModel) };
        this.setState("gemini", "Google Gemini brain");
        return;
      } catch (err) {
        console.warn("Mark One's key didn't work", err);
      }
    }
    try {
      const puter = await loadPuter();
      if (puter.auth.isSignedIn()) {
        this.puter = puter;
        this.setState("puter", "Cloud brain ready");
        return;
      }
      this.needsSignIn = true;
    } catch (err) {
      console.warn("Puter unavailable", err);
    }
    return this.initLocal();
  }

  // Must run from a click: Puter opens its free sign-up / sign-in window.
  async connect() {
    const puter = await loadPuter();
    if (!puter.auth.isSignedIn()) await puter.auth.signIn();
    if (!puter.auth.isSignedIn()) throw new Error("Puter sign-in was cancelled");
    this.puter = puter;
    this.needsSignIn = false;
    this.setState("puter", "Cloud brain ready");
  }

  async initLocal() {
    if (this.localStarted) return;
    this.localStarted = true;
    const gpu = navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null));
    if (!gpu) {
      if (!this.puter) this.setState("cloud", "This browser can't run the local model, using the free cloud brain");
      return;
    }
    const size = new URLSearchParams(location.search).get("brain") === "smart" ? "smart" : "fast";
    const modelId = MODELS[size][gpu.features.has("shader-f16") ? "f16" : "f32"];
    this.setState("loading", "Preparing my brain…");
    try {
      // Ask the browser to keep the downloaded model instead of clearing it
      // when space runs low.
      navigator.storage?.persist?.().catch(() => {});
      const { CreateWebWorkerMLCEngine } = await import(WEBLLM_URL);
      const worker = new Worker(new URL("./llm-worker.js?v=16", import.meta.url), { type: "module" });
      this.engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (r) => {
          const pct = Math.round((r.progress ?? 0) * 100);
          const first = /fetch/i.test(r.text ?? "");
          if (!this.puter) this.setState("loading", first ? `Downloading my brain, first time only: ${pct}%` : `Waking up my brain: ${pct}%`);
        },
      });
      if (!this.puter) this.setState("local", "On-device brain ready");
    } catch (err) {
      console.warn("Local model failed, staying on the cloud brain", err);
      this.engine = null;
      if (!this.puter) this.setState("cloud", "Using the free cloud brain (the local one couldn't start)");
    }
  }

  // Yields the reply in pieces as it is written.
  async *reply(messages) {
    if (this.gemini && Date.now() > this.geminiPausedUntil) {
      let any = false;
      try {
        for await (const piece of streamChat(this.gemini.key, this.gemini.model, messages)) {
          any = true;
          yield piece;
        }
        if (any) return;
      } catch (err) {
        if (any) throw err;
        // Free limit reached or Google unreachable: use the free sources for a
        // while, and start getting the local brain ready.
        console.warn("Gemini failed, switching brains for a while", err);
        this.geminiPausedUntil = Date.now() + GEMINI_PAUSE_MS;
        this.setState("cloud", "Gemini is resting, using a free brain for a few minutes");
        this.initLocal();
      }
    }
    if (this.puter) {
      let any = false;
      try {
        for await (const piece of this.replyPuter(messages)) {
          any = true;
          yield piece;
        }
        if (any) return;
      } catch (err) {
        if (any) throw err;
        console.warn("Puter failed, trying the other brains", err);
        this.initLocal();
      }
    }
    if (this.engine) {
      try {
        yield* this.replyLocal(messages);
        return;
      } catch (err) {
        console.warn("Local reply failed, trying the cloud", err);
      }
    }
    yield await this.replyCloud(messages);
  }

  async *replyLocal(messages) {
    const chunks = await this.engine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 350,
      extra_body: { enable_thinking: false },
    });
    let inThink = false;
    for await (const chunk of chunks) {
      let text = chunk.choices[0]?.delta?.content ?? "";
      // Drop any <think>…</think> section as it streams by.
      if (text.includes("<think>")) { inThink = true; text = text.split("<think>")[0]; }
      if (inThink) {
        if (!text.includes("</think>")) continue;
        inThink = false;
        text = text.split("</think>").pop();
      }
      if (text) yield text;
    }
  }

  async *replyPuter(messages) {
    // Ask for a quick answer without long thinking; if the model rejects
    // that setting, ask again without it.
    const tries = [
      { model: PUTER_MODEL, stream: true, max_tokens: 400, reasoning_effort: "none" },
      { model: PUTER_MODEL, stream: true, max_tokens: 400 },
    ];
    let lastErr = null;
    for (const options of tries) {
      const parts = await this.puter.ai.chat(messages, false, options);
      let any = false;
      for await (const part of parts) {
        if (part?.type === "error" || part?.error) {
          lastErr = new Error(part.message || part.error?.message || "Puter error");
          break;
        }
        if (part?.text) { any = true; yield part.text; }
      }
      if (any) return;
      if (!lastErr) return; // an empty answer
    }
    throw lastErr;
  }

  async replyCloud(messages) {
    // The free tier wants requests far apart. Never keep him waiting in
    // silence for it.
    const wait = this.lastCloudAt + CLOUD_GAP_MS - performance.now();
    if (wait > 2000) {
      throw new Error(this.state === "loading"
        ? "One moment, sir. My brain is still downloading; ask me again in a few seconds."
        : "Give me a few seconds, sir, my free brain is catching its breath.");
    }
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCloudAt = performance.now();
    let res;
    try {
      res = await fetch(CLOUD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("I can't reach my cloud brain. Check the internet connection.");
    }
    if (res.status === 402 || res.status === 429 || res.status === 401) {
      const after = Number(res.headers.get("Retry-After")) || 30;
      this.lastCloudAt = performance.now() + after * 1000 - CLOUD_GAP_MS;
      throw new Error(this.needsSignIn
        ? "My free brain is rate limited, sir. Click \"Connect cloud brain\" once and I'll be much quicker."
        : "My free brain is rate limited, sir. Give me a moment.");
    }
    if (!res.ok) throw new Error(`My cloud brain answered with an error (${res.status}).`);
    return stripThinking(await res.text()).trim();
  }
}
