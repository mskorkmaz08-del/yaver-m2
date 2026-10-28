// Google Gemini, used only when Mark One already has a free Gemini key in this
// browser (see markone.js): a fast, smart brain and the "Charon" voice that
// Mark One speaks with.
const API = "https://generativelanguage.googleapis.com/v1beta";

async function listModels(key) {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  return ((await res.json()).models || []).map((m) => ({ name: m.name.replace("models/", ""), methods: m.supportedGenerationMethods || [] }));
}

const ver = (n) => parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]);
const preview = (n) => /preview|exp/.test(n);

// Same choice as Mark One: the newest stable "flash" chat model.
export async function pickChatModel(key, preferred) {
  if (preferred) return preferred;
  const usable = (await listModels(key))
    .filter((m) => m.methods.includes("generateContent") && /^gemini-[\d.]+-flash/.test(m.name) && !/(lite|image|tts|live|audio|thinking-exp|embedding)/.test(m.name))
    .map((m) => m.name);
  usable.sort((a, b) => preview(a) - preview(b) || ver(b) - ver(a) || a.length - b.length);
  return usable[0] || "gemini-2.5-flash";
}

let ttsModels;
async function pickTtsModels(key) {
  if (ttsModels) return ttsModels;
  const names = (await listModels(key).catch(() => [])).map((m) => m.name).filter((n) => /tts/.test(n));
  const rank = (n) => (preview(n) ? 2 : 0) + (/pro/.test(n) ? 1 : 0) + (/lite/.test(n) ? -0.5 : 0);
  names.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a) || a.length - b.length);
  return (ttsModels = names.length ? names : ["gemini-2.5-flash-preview-tts"]);
}

// Answer straight away instead of thinking first: seconds faster.
function thinkingOff(model) {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-[3-9]/.test(model)) return { thinkingConfig: { thinkingLevel: "low" } };
  return {};
}

// Streams a reply. `messages` are OpenAI-style {role, content}.
export async function* streamChat(key, model, messages, retry = true) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const res = await fetch(`${API}/models/${model}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.8, maxOutputTokens: 600, ...(retry ? thinkingOff(model) : {}) },
    }),
  });
  if (res.status === 400 && retry) {
    // A model that rejects the thinking setting: ask again without it.
    yield* streamChat(key, model, messages, false);
    return;
  }
  if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}`), { status: res.status });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const data = JSON.parse(line.slice(5));
        for (const p of data.candidates?.[0]?.content?.parts || []) if (p.text && !p.thought) yield p.text;
      } catch { /* partial line */ }
    }
  }
}

// Text → { samples: Float32Array, rate } in the given voice ("Charon" is
// Mark One's calm male voice).
export async function synth(key, text, voice = "Charon") {
  const models = await pickTtsModels(key);
  let lastErr;
  for (const model of models.slice(0, 3)) {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Only the words: Gemini reads any style instruction out loud.
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
      signal: AbortSignal.timeout(20000),
    }).catch(() => ({ ok: false, status: 0 }));
    if (!res.ok) { lastErr = new Error(`Gemini voice ${res.status}`); continue; }
    const part = (await res.json()).candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) { lastErr = new Error("Gemini sent no audio"); continue; }
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [0, 24000])[1]);
    return { samples: trimPcm(part.inlineData.data, rate), rate };
  }
  throw lastErr || new Error("Gemini voice unavailable");
}

// Gemini sends raw 16-bit mono PCM. Convert it, cut the leading silence (so
// speech starts sooner) and soften the ends.
function trimPcm(b64, rate) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  let start = 0, end = pcm.length;
  while (start < end && Math.abs(pcm[start]) < 400) start++;
  while (end > start && Math.abs(pcm[end - 1]) < 400) end--;
  start = Math.max(0, start - Math.round(rate * 0.03));
  end = Math.min(pcm.length, end + Math.round(rate * 0.06));
  const len = Math.max(end - start, 1);
  const out = new Float32Array(len);
  const fadeIn = Math.round(rate * 0.01), fadeOut = Math.round(rate * 0.08);
  for (let i = 0; i < len; i++) out[i] = (pcm[start + i] / 32768) * Math.min(1, i / fadeIn, (len - i) / fadeOut);
  return out;
}
