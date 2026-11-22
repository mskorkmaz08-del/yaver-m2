// Local storage: IndexedDB for workouts and personal examples, localStorage
// for settings. Everything stays on the phone.
const DB_NAME = "calicoach";
const DB_VER = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("examples")) db.createObjectStore("examples", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips", { keyPath: "id", autoIncrement: true });
      // v2: 3D skeleton captures (one per set) and the user's own perfect-form references
      if (!db.objectStoreNames.contains("captures")) db.createObjectStore("captures", { keyPath: "id" });
      if (!db.objectStoreNames.contains("references")) db.createObjectStore("references", { keyPath: "exercise" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  async saveSession(s) { return tx("sessions", "readwrite", (st) => st.put(s)); },
  async sessions() {
    try {
      const all = await tx("sessions", "readonly", (st) => reqP(st.getAll()));
      return (all || []).sort((a, b) => b.start - a.start);
    } catch { return []; }
  },
  async deleteSession(id) { return tx("sessions", "readwrite", (st) => st.delete(id)); },
  async clearSessions() { return tx("sessions", "readwrite", (st) => st.clear()); },
  async addExamples(list) { return tx("examples", "readwrite", (st) => { for (const e of list) st.add(e); }); },
  async examples() { try { return (await tx("examples", "readonly", (st) => reqP(st.getAll()))) || []; } catch { return []; } },
  async clearExamples() { await tx("examples", "readwrite", (st) => st.clear()); return tx("clips", "readwrite", (st) => st.clear()); },
  async addClip(c) { return tx("clips", "readwrite", (st) => st.add(c)); },
  async clips() { try { return (await tx("clips", "readonly", (st) => reqP(st.getAll()))) || []; } catch { return []; } },
  async saveCapture(c) { const { t0, ...rest } = c; return tx("captures", "readwrite", (st) => st.put(rest)); },
  async capture(id) { try { return await tx("captures", "readonly", (st) => reqP(st.get(id))); } catch { return null; } },
  async captures() { try { return (await tx("captures", "readonly", (st) => reqP(st.getAll()))) || []; } catch { return []; } },
  async deleteCapturesOf(sessionId) {
    const all = await this.captures();
    return tx("captures", "readwrite", (st) => { for (const c of all) if (c.sessionId === sessionId) st.delete(c.id); });
  },
  async clearCaptures() { return tx("captures", "readwrite", (st) => st.clear()); },
  async saveReference(r) { return tx("references", "readwrite", (st) => st.put(r)); },
  async reference(ex) { try { return await tx("references", "readonly", (st) => reqP(st.get(ex))); } catch { return null; } },
  async deleteReference(ex) { return tx("references", "readwrite", (st) => st.delete(ex)); },
  async persist() {
    try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
    return false;
  },
  async estimate() { try { return await navigator.storage.estimate(); } catch { return null; } },
};

const SKEY = "calicoach.settings";
const DEFAULTS = { skeleton: false, voice: true, voiceCues: true, mirror: true, model: "full", facing: "user", startEx: "auto", sbUrl: "", sbKey: "", sbEmail: "", autoUpload: true };
export const settings = {
  get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || "{}") }; } catch { return { ...DEFAULTS }; }
  },
  set(patch) {
    const s = { ...this.get(), ...patch };
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch {}
    return s;
  },
};
