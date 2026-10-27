// Yaver's brain. Two free sources, neither needs an API key:
//  - Local: a small language model (Qwen 3.5) that runs on this computer's
//    graphics chip through WebLLM. It downloads once (about 1.5 GB), then
//    works offline, privately and without limits.
//  - Cloud: Pollinations' free text API, used while the local model is
//    still downloading or if this browser can't run it. It allows about one
//    request every 30 seconds.
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";
const CLOUD_URL = "https://text.pollinations.ai/";
const CLOUD_GAP_MS = 30000;

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
    this.state = "starting"; // starting | loading | local | cloud | offline
    this.detail = "";
    this.lastCloudAt = -Infinity;
  }

  setState(state, detail = "") {
    this.state = state;
    this.detail = detail;
    this.dispatchEvent(new Event("state"));
  }

  // Starts loading the local model in the background. Replies use the cloud
  // until it is ready.
  async init() {
    const gpu = navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null));
    if (!gpu) {
      this.setState("cloud", "This browser can't run the local model, using the free cloud brain");
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
      const worker = new Worker(new URL("./llm-worker.js?v=10", import.meta.url), { type: "module" });
      this.engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (r) => {
          const pct = Math.round((r.progress ?? 0) * 100);
          const first = /fetch/i.test(r.text ?? "");
          this.setState("loading", first ? `Downloading my brain, first time only: ${pct}%` : `Waking up my brain: ${pct}%`);
        },
      });
      this.setState("local", "On-device brain ready");
    } catch (err) {
      console.warn("Local model failed, staying on the cloud brain", err);
      this.engine = null;
      this.setState("cloud", "Using the free cloud brain (the local one couldn't start)");
    }
  }

  // Yields the reply in pieces as it is written.
  async *reply(messages) {
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

  async replyCloud(messages, retried = false) {
    // The free tier wants requests at least 30 seconds apart.
    const wait = this.lastCloudAt + CLOUD_GAP_MS - performance.now();
    if (wait > 0) {
      this.dispatchEvent(new CustomEvent("waiting", { detail: Math.ceil(wait / 1000) }));
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastCloudAt = performance.now();
    let res;
    try {
      res = await fetch(CLOUD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
    } catch {
      throw new Error("I can't reach my cloud brain. Check the internet connection.");
    }
    if ((res.status === 402 || res.status === 429) && !retried) {
      const after = Number(res.headers.get("Retry-After")) || 30;
      this.lastCloudAt = performance.now() + after * 1000 - CLOUD_GAP_MS;
      return this.replyCloud(messages, true);
    }
    if (!res.ok) throw new Error(`My cloud brain answered with an error (${res.status}).`);
    return stripThinking(await res.text()).trim();
  }
}
