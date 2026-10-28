// Yaver's natural voice: Kokoro, a small neural text-to-speech model that
// runs on this computer (downloaded once, then cached). Runs in a background
// thread so the app stays smooth while it speaks.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const GPU = { dtype: "fp32", device: "webgpu" }; // fast, ~310 MB once
const CPU = { dtype: "q8", device: "wasm" };     // slower, ~90 MB once
let tts = null;
let device = null;
let toCpu = null; // switching to the CPU after a GPU failure (once)

async function loadWith(opts) {
  let lastPct = -1;
  tts = await KokoroTTS.from_pretrained(MODEL, {
    ...opts,
    progress_callback: (p) => {
      // Only the model file matters; the others are a few KB.
      if (p.status !== "progress" || !p.total || !/\.onnx$/.test(p.file || "")) return;
      const pct = Math.floor((p.loaded / p.total) * 100);
      if (pct !== lastPct) postMessage({ type: "progress", pct: (lastPct = pct) });
    },
  });
  device = opts.device;
}

// The graphics chip is much faster; without it (or if it fails), the CPU.
async function load() {
  const gpu = "gpu" in navigator && (await navigator.gpu.requestAdapter().catch(() => null));
  if (gpu) {
    try { await loadWith(GPU); } catch (err) { console.warn("Kokoro on the GPU failed, using the CPU", err); await loadWith(CPU); }
  } else {
    await loadWith(CPU);
  }
  // A first, unheard sentence gets the model warmed up, so the first real
  // answer starts quickly.
  await tts.generate("Ready.", { voice: "bm_george" }).catch(() => {});
  postMessage({ type: "ready", device });
}

// One sentence at a time, in order.
let queue = Promise.resolve();
let cancelBefore = 0; // jobs below this id were interrupted: skip them

async function speak(data) {
  if (data.id < cancelBefore) throw new Error("cancelled");
  postMessage({ type: "begin", id: data.id });
  try {
    return await tts.generate(data.text, { voice: data.voice, speed: data.speed });
  } catch (err) {
    if (device !== "webgpu" && !toCpu) throw err;
    if (!toCpu) { console.warn("Kokoro on the GPU failed, using the CPU", err); toCpu = loadWith(CPU); }
    await toCpu;
    return tts.generate(data.text, { voice: data.voice, speed: data.speed });
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === "load") {
    try { await load(); } catch (err) { postMessage({ type: "error", message: String(err?.message || err) }); }
  } else if (data.type === "cancel") {
    cancelBefore = data.before;
  } else if (data.type === "speak") {
    const job = queue.then(() => speak(data));
    queue = job.catch(() => {});
    try {
      const audio = await job;
      postMessage({ type: "audio", id: data.id, samples: audio.audio, rate: audio.sampling_rate }, [audio.audio.buffer]);
    } catch (err) {
      postMessage({ type: "audio", id: data.id, error: String(err?.message || err) });
    }
  }
};
