// Yaver's natural voice: Kokoro, a small neural text-to-speech model that
// runs on this computer (downloaded once, then cached). Runs in a background
// thread so the app stays smooth while it speaks.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null;

async function load() {
  // The graphics chip is much faster; without it, a smaller model on the CPU.
  const gpu = "gpu" in navigator && (await navigator.gpu.requestAdapter().catch(() => null));
  const opts = gpu ? { dtype: "fp32", device: "webgpu" } : { dtype: "q8", device: "wasm" };
  let lastPct = -1;
  tts = await KokoroTTS.from_pretrained(MODEL, {
    ...opts,
    progress_callback: (p) => {
      if (p.status !== "progress" || !p.total) return;
      const pct = Math.round((p.loaded / p.total) * 100);
      if (pct !== lastPct) postMessage({ type: "progress", pct: (lastPct = pct) });
    },
  });
  postMessage({ type: "ready", device: opts.device });
}

self.onmessage = async ({ data }) => {
  if (data.type === "load") {
    try { await load(); } catch (err) { postMessage({ type: "error", message: String(err?.message || err) }); }
  } else if (data.type === "speak") {
    try {
      const audio = await tts.generate(data.text, { voice: data.voice, speed: data.speed });
      postMessage({ type: "audio", id: data.id, samples: audio.audio, rate: audio.sampling_rate }, [audio.audio.buffer]);
    } catch (err) {
      postMessage({ type: "audio", id: data.id, error: String(err?.message || err) });
    }
  }
};
