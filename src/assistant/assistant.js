// Yaver, the talking assistant. With a Gemini key: a real-time voice
// conversation through Gemini Live (live.js). Without one: wake word or button
// → speech to text → studio command or language model → spoken answer.
import { Brain } from "./brain.js?v=18";
import { Listener, Speaker } from "./voice.js?v=18";
import { parseCommand, navCommand, describeScene } from "./commands.js?v=18";
import { geminiSettings, saveKey, forgetKey } from "./keys.js?v=18";
import { LiveSession } from "./live.js?v=18";

const HISTORY_KEY = "yaver-chat";
const HISTORY_TURNS = 12; // messages kept for context (the local model's window is small)

const LIVE_IDLE_S = 20; // a live conversation ends after this much silence
const LIVE_PAUSE_MS = 10 * 60000; // after a Live failure, the other way for a while

const PERSONA = `You are Yaver, Mustafa's personal AI assistant. Speak like JARVIS: calm, precise and understated, with British English and a touch of dry wit; now and then address him as "sir", not every time. No American filler. This is a voice conversation: you are heard, not read, so answer in one to three short spoken sentences, with no lists, markdown, emoji or code unless he asks for detail. You live in Yaver Mark II. Its home screen is you; from there he can open the 3D Studio (say "open the studio"), where he builds things with hand gestures through the webcam, and the Robotics Academy (say "open the course"): 3D lessons on electronics, Arduino and the ESP32, and a simulator where he builds, wires and programs a robot. In the Academy he can say "next", "back", "lesson 5" or "open the simulator". The app itself handles studio commands like "add a red cube", "delete it", "make it bigger", "paint it green", "zoom in" and "clear the scene", so if he asks how to do something there, tell him the command or gesture. You can't browse the internet yet, so for live news, weather or prices say you can't check that yet. Never make up facts; say when you're unsure.`;

// The same, for Gemini Live: it can search the web and run studio commands.
const LIVE_PERSONA = PERSONA
  .replace("You can't browse the internet yet, so for live news, weather or prices say you can't check that yet.", "For news, weather, prices or anything recent, use Google Search.")
  .replace("The app itself handles studio commands", "Use the studio tool for anything in the 3D Studio (it opens the studio if needed), with commands")
  + " Speak with a refined British accent, at a brisk, natural pace.";

const LIVE_TOOLS = [
  {
    name: "studio",
    description: "Runs a command in Yaver's 3D Studio or Robotics Academy and says what happened. One short English command per call, such as: open the studio, open the course, open the simulator, next, back, lesson 3, go home, add two red cubes, add a gold torus, delete it, clear the scene, make it bigger, make it smaller, paint it green, turn it, zoom in, zoom out, show the gestures.",
    parameters: { type: "OBJECT", properties: { command: { type: "STRING", description: "The command, in plain English." } }, required: ["command"] },
  },
  { name: "describe_scene", description: "Says what is in the 3D Studio right now." },
];

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

// `app` is { view() → "home" | "studio" | "academy", openStudio() → Promise<studio API>,
// goHome(), studio() → studio API or null if never opened, openAcademy(sub),
// academy() → the open Academy module or null } from app.js.
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
    keyLink: document.getElementById("yaver-key-link"),
    keyBox: document.getElementById("yaver-key"),
    keyForm: document.getElementById("yaver-key-form"),
    keyInput: document.getElementById("yaver-key-input"),
    keyCancel: document.getElementById("yaver-key-cancel"),
    keyError: document.getElementById("yaver-key-error"),
  };
  const brain = new Brain();
  const listener = new Listener();
  const speaker = new Speaker();
  let history = loadHistory();
  const hello = greeting();
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

  // Opening and leaving the studio, and studio commands, are instant and never
  // need the model. A studio command from the home screen opens the studio
  // first. Returns what was done, or null if it isn't a studio command.
  async function studioCommand(request) {
    // In the Academy, "next", "back", "lesson 3"… come first.
    const academyReply = app.academy()?.command(request);
    if (academyReply) return academyReply;
    const nav = navCommand(request);
    const action = nav ? null : parseCommand(request);
    if (nav === "studio") { const was = app.view(); app.openStudio(); return was === "studio" ? "We're already in the studio, sir." : "Opening the studio."; }
    if (nav === "academy") { app.openAcademy(); return "Opening the Robotics Academy."; }
    if (nav === "sim") { app.openAcademy("sim"); return "Opening the robot simulator."; }
    if (nav === "home") { app.goHome(); return "Back to the home screen."; }
    if (action) return action(app.view() === "studio" ? app.studio() : await app.openStudio());
    return null;
  }

  async function handle(request) {
    request = request.trim();
    if (!request) return;
    if (liveOn()) { talkLive(request); return; }
    // A new request replaces whatever Yaver was still saying or thinking.
    const my = ++turn;
    speaker.stop();
    if (interimLine) { interimLine.remove(); interimLine = null; }
    addLine("msg-you", request);

    const done = await studioCommand(request);
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
      { role: "system", content: `${PERSONA}\nIt is now ${new Date().toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. ${app.academy()?.describe() ?? describeScene(app.view() === "studio" ? app.studio()?.editor : null)}` },
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

  // ---- Gemini Live -------------------------------------------------------------

  let liveKey = "";
  let liveVoice = "Charon";
  let livePausedUntil = 0;
  let live = null;      // the current LiveSession
  let liveLines = { you: null, yaver: null };
  const liveOn = () => Boolean(liveKey) && Date.now() > livePausedUntil;

  function liveSystem() {
    const now = new Date().toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const recent = history.slice(-8).map((m) => `${m.role === "user" ? "Mustafa" : "Yaver"}: ${m.content}`).join("\n");
    return `${LIVE_PERSONA}\nIt is now ${now}. ${app.academy()?.describe() ?? describeScene(app.view() === "studio" ? app.studio()?.editor : null)}${recent ? `\nYour last exchange:\n${recent}` : ""}`;
  }

  // Grows the transcript line for whoever is talking.
  function liveLine(who, text) {
    const other = who === "you" ? "yaver" : "you";
    if (liveLines[other]) { remember(other, liveLines[other].textContent); liveLines[other] = null; }
    liveLines[who] ??= addLine(who === "you" ? "msg-you" : "msg-yaver");
    liveLines[who].textContent += text;
    el.log.scrollTop = el.log.scrollHeight;
  }
  function remember(who, text) {
    text = text.trim();
    if (!text) return;
    history.push({ role: who === "you" ? "user" : "assistant", content: text });
    saveHistory(history);
  }

  // Starts a conversation (or adds to the one going on). `text` is what he
  // already said to wake Yaver, if anything.
  async function talkLive(text = "") {
    speaker.stop();
    if (interimLine) { interimLine.remove(); interimLine = null; }
    if (live && !live.closed) {
      if (text) { liveLine("you", text); live.sendText(text); }
      return;
    }
    listener.pause(true); // the conversation uses the microphone itself
    const session = new LiveSession({
      key: liveKey,
      voice: liveVoice,
      system: liveSystem(),
      tools: {
        declarations: LIVE_TOOLS,
        run: async (name, args) => {
          if (name === "describe_scene") return describeScene(app.studio()?.editor ?? null) || "The studio is empty.";
          return (await studioCommand(String(args.command || ""))) ?? "That isn't a studio command I know. Try: add, delete, clear, bigger, smaller, paint, turn, zoom.";
        },
      },
    });
    live = session;
    if (text) { liveLine("you", text); session.sendText(text); }
    session.addEventListener("open", () => { setLook("listening"); el.hint.textContent = ""; });
    session.addEventListener("speaking", () => setLook("speaking"));
    session.addEventListener("quiet", () => { if (live === session) setLook("listening"); });
    session.addEventListener("heard", (e) => liveLine("you", e.detail));
    session.addEventListener("said", (e) => liveLine("yaver", e.detail));
    session.addEventListener("turn", () => {
      for (const who of ["you", "yaver"]) if (liveLines[who]) { remember(who, liveLines[who].textContent); liveLines[who] = null; }
    });
    session.addEventListener("close", (e) => {
      if (live !== session) return;
      live = null;
      for (const who of ["you", "yaver"]) if (liveLines[who]) { remember(who, liveLines[who].textContent); liveLines[who] = null; }
      if (e.detail && e.detail !== "idle" && e.detail !== "stopped") el.hint.textContent = `Gemini Live: ${e.detail}`;
      setLook("idle");
      listener.setMode("wake");
      listener.pause(false);
    });
    setLook("thinking");
    try {
      await session.start();
    } catch (err) {
      if (live !== session) return;
      console.warn("Gemini Live failed", err);
      session.close("stopped");
      const msg = String(err.message || err);
      if (/api key/i.test(msg)) {
        // Refused key: offer the key box again (Mark One's own key is left alone).
        forgetKey();
        liveKey = "";
        el.keyLink.hidden = false;
        el.hint.textContent = "Google refused the Gemini key. Click \"Add free Gemini key\" and paste it again.";
      } else {
        el.hint.textContent = /permission|denied|notallowed/i.test(msg)
          ? "Microphone blocked: allow it in the address bar."
          : `Gemini Live isn't available right now (${msg}), using my other brains for a while.`;
      }
      livePausedUntil = Date.now() + LIVE_PAUSE_MS;
      if (text) handle(text);
    }
  }

  // A conversation nobody is talking in ends by itself (it uses free quota).
  setInterval(() => {
    if (live && !live.closed && live.ready && live.idleSeconds > LIVE_IDLE_S) live.close("idle");
  }, 1000);

  // ---- Listening ---------------------------------------------------------------

  listener.addEventListener("mode", () => {
    if (live) return;
    // "Yaver…": start the live conversation right away; it hears the rest.
    if (listener.mode === "command" && liveOn()) { talkLive(); return; }
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
  speaker.addEventListener("end", () => { if (!live) { listener.pause(false); refreshLook(); } });

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
  // The voice may not be ready when the greeting comes: say hello once it is.
  let voiced = false;
  let greetedAloud = false;
  speaker.addEventListener("ready", () => {
    showVoice();
    showTextMode();
    if (voiced) return;
    voiced = true;
    if (!greetedAloud && !speaker.speaking && !live) speaker.say(hello);
  });
  // With a Gemini key: Gemini Live for conversations and Google's voice for
  // the rest. Without: Kokoro on this computer, and the key box.
  geminiSettings().then(({ geminiKey, ttsVoice }) => {
    liveVoice = ttsVoice || "Charon";
    el.keyLink.hidden = Boolean(geminiKey);
    if (geminiKey) {
      liveKey = geminiKey;
      speaker.useGemini(geminiKey, liveVoice);
      el.voice.textContent = `Voice: Gemini Live "${liveVoice}"`;
    } else {
      speaker.loadKokoro();
    }
  });

  // ---- Gemini key, pasted once -------------------------------------------------

  el.keyLink.addEventListener("click", () => { el.keyBox.hidden = false; el.keyInput.focus(); });
  el.keyCancel.addEventListener("click", () => { el.keyBox.hidden = true; });
  el.keyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.keyError.textContent = "Checking…";
    try {
      await saveKey(el.keyInput.value);
      el.keyError.textContent = "Saved. Restarting…";
      setTimeout(() => location.reload(), 400);
    } catch (err) {
      el.keyError.textContent = err.message;
    }
  });

  // Sound may only start after a click or key press.
  for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => speaker.unlock(), { capture: true });

  el.orb.addEventListener("click", () => {
    if (live) { live.close("stopped"); return; } // ends the conversation
    if (speaker.speaking) { speaker.stop(); return; }
    if (liveOn()) talkLive();
    else listener.listenNow();
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.input.value;
    el.input.value = "";
    handle(text);
  });

  // Hold Space to talk (when not typing).
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || e.target === el.input || e.target === el.keyInput || e.target.closest?.("input, textarea")) return;
    e.preventDefault();
    if (live) return;
    if (liveOn()) talkLive();
    else listener.listenNow();
  });

  // ---- Start -----------------------------------------------------------------

  if (!listener.supported) {
    el.hint.textContent = "This browser can't listen. Use Chrome, or type below.";
  }
  listener.start();
  brain.init();

  addLine("msg-yaver", hello);
  setLook("idle");
  // Chrome only lets a page speak after a click or key press; if the greeting
  // is refused, the speaker says it on the first one.
  greetedAloud = !speaker.loading;
  speaker.say(hello);

  return { brain, listener, speaker, handle };
}
