// Borrows settings from Yaver Mark One, the first Yaver app. Both apps live on
// the same site (mskorkmaz08-del.github.io), so this browser shares their
// storage: if Mark One already has a Google Gemini key here, Mark II uses it
// too, and nobody has to paste it again. Read-only: Mark One's data is never
// changed.
let cached;

export function markOneSettings() {
  cached ??= read().catch((err) => {
    console.warn("Couldn't read Mark One's settings", err);
    return {};
  });
  return cached;
}

async function read() {
  // Opening a database that doesn't exist would create an empty one, so check
  // first.
  const dbs = (await indexedDB.databases?.()) ?? [];
  if (!dbs.some((d) => d.name === "yaver")) return {};
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("yaver");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onupgradeneeded = () => { r.transaction.abort(); reject(new Error("no Mark One data")); };
  });
  try {
    if (!db.objectStoreNames.contains("kv")) return {};
    const get = (id) => new Promise((resolve) => {
      const r = db.transaction("kv").objectStore("kv").get(id);
      r.onsuccess = () => resolve(r.result?.value);
      r.onerror = () => resolve(undefined);
    });
    return {
      geminiKey: String((await get("geminiKey")) ?? "").trim(),
      geminiModel: String((await get("geminiModel")) ?? ""),
      ttsVoice: String((await get("ttsVoice")) ?? ""),
    };
  } finally {
    db.close();
  }
}
