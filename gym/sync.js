// Supabase sync: uploads 3D skeleton captures and workout summaries to the
// user's own Supabase project (no SDK: plain REST calls).
//
//   Auth:    6-digit email code (works inside an installed iPhone web app,
//            where magic links would open Safari instead)
//   Storage: bucket "captures", file <user id>/<capture id>.json.gz
//   Tables:  public.captures (one row per set capture), public.sessions
// Set-up SQL and steps: supabase/schema.sql and supabase/README.md.
import { store, settings } from "./store.js";
import { toJSON, gzipBlob } from "./capture.js";

const AKEY = "calicoach.sbAuth";
const listeners = new Set();
let busy = null;

function cfg() {
  const s = settings.get();
  return { url: (s.sbUrl || "").replace(/\/+$/, ""), key: s.sbKey || "", email: s.sbEmail || "", auto: s.autoUpload !== false };
}
function loadAuth() { try { return JSON.parse(localStorage.getItem(AKEY) || "null"); } catch { return null; } }
function saveAuth(a) { try { if (a) localStorage.setItem(AKEY, JSON.stringify(a)); else localStorage.removeItem(AKEY); } catch {} emit(); }
function emit(extra = {}) { for (const fn of listeners) fn({ ...sync.state(), ...extra }); }

async function api(path, { method = "GET", body = null, headers = {}, auth = true, raw = false } = {}) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error("Server not set up");
  const h = { apikey: key, ...headers };
  if (auth) h.Authorization = `Bearer ${await sync.token()}`;
  if (body != null && !(body instanceof Blob) && !h["Content-Type"]) h["Content-Type"] = "application/json";
  const r = await fetch(url + path, { method, headers: h, body: body == null ? undefined : body instanceof Blob ? body : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${r.status}`);
  return raw ? r : data;
}

function takeSession(d) {
  saveAuth({
    access_token: d.access_token, refresh_token: d.refresh_token,
    expires_at: Date.now() + (d.expires_in || 3600) * 1000,
    user: { id: d.user?.id, email: d.user?.email },
  });
}

export const sync = {
  configured() { const c = cfg(); return !!(c.url && c.key); },
  signedIn() { return !!loadAuth()?.access_token; },
  user() { return loadAuth()?.user || null; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  state() { return { configured: this.configured(), signedIn: this.signedIn(), user: this.user(), busy: !!busy }; },

  /** Email a 6-digit sign-in code (and a magic link). */
  async sendCode(email) {
    await api(`/auth/v1/otp?redirect_to=${encodeURIComponent(location.href.split("#")[0])}`, { method: "POST", auth: false, body: { email, create_user: true } });
  },
  async verify(email, code) {
    const d = await api("/auth/v1/verify", { method: "POST", auth: false, body: { type: "email", email, token: code.trim() } });
    takeSession(d);
  },
  /** Tokens from a magic link opened in this browser (#access_token=…). */
  takeFromHash() {
    if (!location.hash.includes("access_token=")) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    saveAuth({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_at: Date.now() + (+p.get("expires_in") || 3600) * 1000, user: null });
    history.replaceState(null, "", location.pathname + location.search + "#settings");
    this.fetchUser().catch(() => {});
    return true;
  },
  async fetchUser() {
    const u = await api("/auth/v1/user");
    const a = loadAuth();
    if (a) saveAuth({ ...a, user: { id: u.id, email: u.email } });
    return u;
  },
  async token() {
    const a = loadAuth();
    if (!a) throw new Error("Not signed in");
    if (a.expires_at - Date.now() > 60000) return a.access_token;
    const d = await api("/auth/v1/token?grant_type=refresh_token", { method: "POST", auth: false, body: { refresh_token: a.refresh_token } });
    takeSession({ ...d, user: d.user || a.user });
    return d.access_token;
  },
  signOut() { saveAuth(null); },

  async uploadCapture(cap) {
    const uid = this.user()?.id || (await this.fetchUser()).id;
    const path = `${uid}/${cap.id}.json.gz`;
    const { blob, gz } = await gzipBlob(JSON.stringify(toJSON(cap)));
    await api(`/storage/v1/object/captures/${path}`, {
      method: "POST", body: blob,
      headers: { "Content-Type": gz ? "application/gzip" : "application/json", "x-upsert": "true", "cache-control": "3600" },
    });
    const s = cap.summary || {};
    await api("/rest/v1/captures?on_conflict=id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: {
        id: cap.id, user_id: uid, session_id: cap.sessionId, set_index: cap.setIndex, exercise: cap.exercise,
        recorded_at: new Date(cap.recordedAt).toISOString(), frames: cap.frames, fps: cap.fps,
        reps: s.reps ?? cap.reps?.length ?? 0, clean_reps: s.clean ?? null, score: s.score ?? null,
        file_path: path, bytes: blob.size, meta: { reps: cap.reps, summary: s, source: cap.source, format: cap.format },
      },
    });
    return blob.size;
  },
  async uploadSession(session) {
    const uid = this.user()?.id || (await this.fetchUser()).id;
    const { uploaded, ...data } = session;
    for (const st of data.sets || []) for (const r of st.repList || []) if (r.trace) delete r.trace.k; // 3D lives in the capture files
    await api("/rest/v1/sessions?on_conflict=id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: { id: session.id, user_id: uid, started_at: new Date(session.start).toISOString(), ended_at: session.end ? new Date(session.end).toISOString() : null, source: session.source, data },
    });
  },

  async pending() {
    const caps = (await store.captures()).filter((c) => !c.uploaded);
    const sessions = (await store.sessions()).filter((s) => !s.uploaded);
    return { caps, sessions };
  },

  /** Upload everything not uploaded yet. Returns { captures, sessions, bytes } or throws. */
  async uploadPending(onProgress = () => {}) {
    if (busy) return busy;
    busy = (async () => {
      emit();
      const { caps, sessions } = await this.pending();
      let bytes = 0, nc = 0, ns = 0;
      for (const s of sessions) {
        await this.uploadSession(JSON.parse(JSON.stringify(s)));
        await store.saveSession({ ...s, uploaded: Date.now() });
        ns++; onProgress({ sessions: ns, captures: nc, total: caps.length + sessions.length });
      }
      for (const c of caps) {
        bytes += await this.uploadCapture(c);
        await store.saveCapture({ ...c, uploaded: Date.now() });
        nc++; onProgress({ sessions: ns, captures: nc, total: caps.length + sessions.length });
      }
      return { captures: nc, sessions: ns, bytes };
    })();
    try { return await busy; } finally { busy = null; emit(); }
  },

  /** After saving a workout: upload in the background when set up. */
  queueAfterSave() {
    if (!cfg().auto || !this.configured() || !this.signedIn() || !navigator.onLine) return;
    this.uploadPending().then((r) => emit({ last: r }), (e) => emit({ error: e.message }));
  },
};

window.addEventListener?.("online", () => sync.queueAfterSave());
