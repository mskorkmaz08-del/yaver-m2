// Yaver's free Google Gemini key. Pasted once into this browser and kept here
// for good (it survives app updates); never sent anywhere except Google. If
// none was pasted, Mark One's key from the same site is used (markone.js).
import { markOneSettings } from "./markone.js?v=15";

const STORE = "yaver-gemini-key";

export function savedKey() {
  try { return (localStorage.getItem(STORE) || "").trim(); } catch { return ""; }
}

// Checks the key with Google before keeping it. Throws a readable message.
export async function saveKey(key) {
  key = key.trim();
  if (!key) throw new Error("Paste the key first.");
  let res;
  try {
    res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key } });
  } catch {
    throw new Error("Couldn't reach Google. Check the internet connection.");
  }
  if (!res.ok) throw new Error("Google didn't accept that key. Copy it again from aistudio.google.com/apikey.");
  localStorage.setItem(STORE, key);
}

export function forgetKey() {
  try { localStorage.removeItem(STORE); } catch {}
}

// { geminiKey, geminiModel, ttsVoice }: the pasted key first, else Mark One's.
export async function geminiSettings() {
  const markOne = await markOneSettings();
  const own = savedKey();
  if (!own) return markOne;
  return { ...markOne, geminiKey: own, geminiModel: own === markOne.geminiKey ? markOne.geminiModel : "" };
}
