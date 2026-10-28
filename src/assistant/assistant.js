// Yaver, the talking assistant: wake word or button → speech to text →
// studio command or language model → spoken, streamed answer.
import { Brain } from "./brain.js?v=13";
import { Listener, Speaker } from "./voice.js?v=13";
import { parseCommand, navCommand, describeScene } from "./commands.js?v=13";
import { markOneSettings } from "./markone.js?v=13";

const HISTORY_KEY = "yaver-chat";
const HISTORY_TURNS = 12; // messages kept for context (the local model's window is small)

const PERSONA = `You are Yaver, Mustafa's personal AI assistant. Speak like JARVIS: calm, precise and understated, with British English and a touch of dry wit; now and then address him as "sir", not every time. No American filler. This is a voice conversation: you are heard, not read, so answer in one to three short spoken sentences, with no lists, markdown, emoji or code unless he asks for detail. You live in Yaver Mark II. Its home screen is you; from there he can open the 3D Studio (say "open the studio"), where he builds things with hand gestures through the webcam. The app itself handles studio commands like "add a red cube", "delete it", "make it bigger", "paint it green", "zoom in" and "clear the scene", so if he asks how to do something there, tell him the command or gesture. You can't browse the internet yet, so for live news, weather or prices say you can't check that yet. Never make up facts; say when you're unsure.`;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_TURNS))); } catch {}
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, sir. Yaver online.`;
}

// `app` is { view() → "home" | "studio", openStudio() → Promise<studio API>,
// goHome(), studio() → studio API or null if never opened } from app.js.
export function startAssistant(app) {
  const el = {
    root: document.getElementById("yaver"),
    orb: document.getElementById("yaver-orb"),
    log: document.getElementById("yaver-log"),
    form: document.getElementById("yaver-form"),
    input: document.getElementById("yaver-text"),
    brain: document.getElementById("yaver-brain"),
    voice: document.getElementById("yaver-voice"),
    hint: document.getElementById("yaver-hint"),
    connect: document.getElementById("yaver-connect"),
    textToggle: document.getElementById("yaver-text-toggle"),
  };
  const brain = new Brain();
  const listener = new Listener();
  const speaker = new Speaker();
  let history = loadHistory();
  let busy = false;
  let turn = 0; // each request gets a number; a newer one replaces an older one

  // ---- Look ------------------------------------------------------------------

  function setLook(state) {
    el.root.dataset.state = state; // idle | listening | thinking | speaking
  }
  function refreshLook() {
    if (speaker.speaking) setLook("speaking");
    else if (busy) setLook("thinking");
    else if (listener.mode === "command") setLook("listening");
    else setLook("idle");
  }

  // Adds a line to the transcript and returns it, so a streamed reply can grow.
  function addLine(who, text = "") {
    const line = document.createElement("p");
    line.className = who;
    line.textContent = text;
    el.log.appendChild(line);
    while (el.log.children.length > 8) el.log.firstChild.remove();
    el.log.scrollTop = el.log.scrollHeight;
    return line;
  }
  let interimLine = null;

  brain.addEventListener("state", () => {
    el.brain.textContent = brain.detail;
    el.brain.dataset.state = brain.state;
    el.connect.hidden = !brain.needsSignIn;
  });
  // One click, once: a free Puter account for the fast cloud brain.
  el.connect.addEventListener("click", async () => {
    try {
      await brain.connect();
      speaker.say("Cloud brain connected, sir. I'm all yours.");
    } catch (err) {
      el.hint.textContent = err.message;
    }
  });

  // It's a voice conversation: the transcript stays hidden unless he wants it
  // (or the voice is still downloading, so text is all there is).
  let wantText = false;
  try { wantText = localStorage.getItem("yaver-show-text") === "1"; } catch {}
  function showTextMode() {
    el.root.dataset.text = wantText || !speaker.natural ? "on" : "off";
    el.textToggle.textContent = wantText ? "Hide text" : "Show text";
  }
  el.textToggle.addEventListener("click", () => {
    wantText = !wantText;
    try { localStorage.setItem("yaver-show-text", wantText ? "1" : "0"); } catch {}
    showTextMode();
  });

  // ---- Talking -----------------------------------------------------------------

  // Where the next speakable piece of `text` ends (0: not yet). The very first
  // piece may end at a comma, so the voice starts sooner.
  function pieceEnd(text, first) {
    const sentence = text.search(/[.!?…](\s|$)/);
    const clause = first ? text.slice(24).search(/[,;:]\s/) : -1;
    const ends = [sentence >= 1 ? sentence + 1 : -1, clause >= 0 ? clause + 25 : -1].filter((i) => i > 0);
    return ends.length ? Math.min(...ends) : 0;
  }

  // Speaks a reply as it streams in, one sentence at a time, so Yaver starts
  // talking before the whole answer is written.
  function sentenceSpeaker() {
    let buffer = "";
    let first = true;
    let spoken = Promise.resolve();
    return {
      push(text) {
        buffer += text;
        let end;
        while ((end = pieceEnd(buffer, first)) > 0) {
          spoken = speaker.say(buffer.slice(0, end));
          buffer = buffer.slice(end);
          first = false;
        }
      },
      flush() {
        if (buffer.trim()) spoken = speaker.say(buffer);
        buffer = "";
        return spoken;
      },
    };
  }

  // A brain that goes quiet for this long counts as failed, so Yaver never
  // just hangs.
  async function* timed(pieces, ms = 20000) {
    const it = pieces[Symbol.asyncIterator]();
    for (;;) {
      let timer;
      const next = await Promise.race([
        it.next(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Sorry sir, my brain didn't answer in time. Try me again.")), ms); }),
      ]).finally(() => clearTimeout(timer));
      if (next.done) return;
      yield next.value;
    }
  }

  // Says `text` and, when he's heard it, listens for his answer.
  async function answer(text, my) {
    await text;
    if (my === turn) listener.followUp();
  }

  async function handle(request) {
    request = request.trim();
    if (!request) return;
    // A new request replaces whatever Yaver was still saying or thinking.
    const my = ++turn;
    speaker.stop();
    if (interimLine) { interimLine.remove(); interimLine = null; }
    addLine("msg-you", request);

    // Opening and leaving the studio, and studio commands, are instant and
    // never need the model. A studio command from the home screen opens the
    // studio first.
    const nav = navCommand(request);
    const action = nav ? null : parseCommand(request);
    let done = null;
    if (nav === "studio") { done = app.view() === "studio" ? "We're already in the studio, sir." : "Opening the studio."; app.openStudio(); }
    else if (nav === "home") { app.goHome(); done = "Back to the home screen."; }
    else if (action) done = action(app.view() === "studio" ? app.studio() : await app.openStudio());
    if (done) {
      busy = false;
      addLine("msg-yaver", done);
      history.push({ role: "user", content: request }, { role: "assistant", content: done });
      saveHistory(history);
      refreshLook();
      answer(speaker.say(done), my);
      return;
    }

    busy = true;
    refreshLook();
    const line = addLine("msg-yaver", "…");
    const voice = sentenceSpeaker();
    let reply = "";
    const messages = [
      { role: "system", content: `${PERSONA}\nIt is now ${new Date().toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. ${describeScene(app.view() === "studio" ? app.studio()?.editor : null)}` },
      ...history.slice(-HISTORY_TURNS),
      { role: "user", content: request },
    ];
    try {
      for await (const piece of timed(brain.reply(messages))) {
        if (my !== turn) return; // he asked something else meanwhile
        reply += piece;
        line.textContent = reply;
        el.log.scrollTop = el.log.scrollHeight;
        voice.push(piece);
      }
      reply = reply.trim() || "I'm afraid I have nothing to say to that, sir.";
      line.textContent = reply;
      history.push({ role: "user", content: request }, { role: "assistant", content: reply });
      saveHistory(history);
    } catch (err) {
      if (my !== turn) return;
      console.warn(err);
      // Keep what was already said; otherwise say what went wrong.
      if (!reply.trim()) {
        reply = err.message || "Something went wrong in my head, sir.";
        line.textContent = reply;
        line.classList.add("error");
        voice.push(reply);
      }
    }
    if (my !== turn) return;
    busy = false;
    refreshLook();
    answer(voice.flush(), my);
  }

  // ---- Listening ---------------------------------------------------------------

  listener.addEventListener("mode", () => {
    if (listener.mode === "command") speaker.stop(); // talking over Yaver interrupts it
    refreshLook();
  });
  listener.addEventListener("interim", (e) => {
    if (!e.detail) return;
    interimLine ??= addLine("msg-you interim");
    interimLine.textContent = e.detail;
  });
  listener.addEventListener("utterance", (e) => handle(e.detail));
  listener.addEventListener("blocked", () => {
    el.hint.textContent = "Microphone blocked: allow it in the address bar, or type below.";
  });

  // Pause the microphone while Yaver speaks, so it doesn't hear itself.
  speaker.addEventListener("start", () => { listener.pause(true); refreshLook(); });
  speaker.addEventListener("end", () => { listener.pause(false); refreshLook(); });

  // ---- Voice status ------------------------------------------------------------

  function showVoice(pct) {
    el.voice.textContent = speaker.natural ? `Voice: ${speaker.voiceName}`
      : speaker.loading ? `Voice: downloading once${pct == null ? "…" : ` ${pct}%`} (text replies until then)`
      : "Voice: built-in (the natural voice couldn't load)";
  }
  speaker.addEventListener("progress", (e) => { if (speaker.loading) showVoice(e.detail); });
  speaker.addEventListener("failed", () => { showVoice(); showTextMode(); });
  showVoice();
  showTextMode();
  // The first time, the voice downloads after the greeting: say hello once it can.
  let voiced = false;
  let greetedAloud = false;
  speaker.addEventListener("ready", () => {
    showVoice();
    showTextMode();
    if (voiced) return;
    voiced = true;
    if (!greetedAloud && !speaker.speaking) speaker.say("Voice systems online, sir.");
  });
  markOneSettings().then(({ geminiKey, ttsVoice }) => {
    if (geminiKey) speaker.useGemini(geminiKey, ttsVoice || "Charon");
  });

  // Sound may only start after a click or key press.
  for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => speaker.unlock(), { capture: true });

  el.orb.addEventListener("click", () => {
    if (speaker.speaking) { speaker.stop(); return; }
    listener.listenNow();
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.input.value;
    el.input.value = "";
    handle(text);
  });

  // Hold Space to talk (when not typing).
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || e.target === el.input) return;
    e.preventDefault();
    listener.listenNow();
  });

  // ---- Start -----------------------------------------------------------------

  if (!listener.supported) {
    el.hint.textContent = "This browser can't listen. Use Chrome, or type below.";
  }
  listener.start();
  brain.init();

  const hello = greeting();
  addLine("msg-yaver", hello);
  setLook("idle");
  // Chrome only lets a page speak after a click or key press; if the greeting
  // is refused, the speaker says it on the first one.
  greetedAloud = !speaker.loading;
  speaker.say(hello);

  return { brain, listener, speaker, handle };
}
