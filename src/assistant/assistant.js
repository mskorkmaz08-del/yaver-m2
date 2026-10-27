// Yaver, the talking assistant: wake word or button → speech to text →
// studio command or language model → spoken, streamed answer.
import { Brain } from "./brain.js?v=10";
import { Listener, Speaker } from "./voice.js?v=10";
import { runCommand, describeScene } from "./commands.js?v=10";

const HISTORY_KEY = "yaver-chat";
const HISTORY_TURNS = 12; // messages kept for context (the local model's window is small)

const PERSONA = `You are Yaver, Mustafa's personal AI assistant, in the spirit of JARVIS from Iron Man: calm, loyal, quick, with a dry British wit. You speak out loud, so answer in one to three short sentences of plain spoken English, with no lists, markdown, emoji or code unless he asks for detail. Call him "sir" now and then, not every time. You live inside Yaver Mark II, a 3D studio he controls with hand gestures through the webcam; the app itself already handles studio voice commands like "add a red cube", "delete it", "make it bigger", "paint it green", "zoom in" and "clear the scene", so if he asks how to do something in the studio, tell him the command or gesture. You cannot browse the internet yet, so for live news, weather or prices say you can't check that yet. Never make up facts; say when you're unsure.`;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_TURNS))); } catch {}
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, sir. Yaver online. Say "Yaver" when you need me.`;
}

export function startAssistant(studio) {
  const el = {
    root: document.getElementById("yaver"),
    orb: document.getElementById("yaver-orb"),
    log: document.getElementById("yaver-log"),
    form: document.getElementById("yaver-form"),
    input: document.getElementById("yaver-text"),
    brain: document.getElementById("yaver-brain"),
    hint: document.getElementById("yaver-hint"),
  };
  const brain = new Brain();
  const listener = new Listener();
  const speaker = new Speaker();
  let history = loadHistory();
  let busy = false;

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
  });
  brain.addEventListener("waiting", (e) => {
    el.brain.textContent = `Free cloud brain is pacing itself: ${e.detail}s (until my own brain finishes downloading)`;
  });

  // ---- Talking -----------------------------------------------------------------

  // Speaks a reply as it streams in, one sentence at a time, so Yaver starts
  // talking before the whole answer is written.
  function sentenceSpeaker() {
    let buffer = "";
    let spoken = Promise.resolve();
    return {
      push(text) {
        buffer += text;
        const re = /^[\s\S]*?[.!?…](\s|$)/;
        let m;
        while ((m = buffer.match(re)) && m[0].trim().length > 1) {
          const sentence = m[0];
          buffer = buffer.slice(sentence.length);
          spoken = speaker.say(sentence);
        }
      },
      flush() {
        if (buffer.trim()) spoken = speaker.say(buffer);
        buffer = "";
        return spoken;
      },
    };
  }

  async function handle(request) {
    request = request.trim();
    if (!request || busy) return;
    speaker.stop();
    if (interimLine) { interimLine.remove(); interimLine = null; }
    addLine("msg-you", request);

    // Studio commands are instant and never need the model.
    const done = runCommand(request, studio);
    if (done) {
      addLine("msg-yaver", done);
      speaker.say(done);
      history.push({ role: "user", content: request }, { role: "assistant", content: done });
      saveHistory(history);
      return;
    }

    busy = true;
    refreshLook();
    const line = addLine("msg-yaver", "…");
    const voice = sentenceSpeaker();
    let reply = "";
    const messages = [
      { role: "system", content: `${PERSONA}\nIt is now ${new Date().toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. ${describeScene(studio.editor)}` },
      ...history.slice(-HISTORY_TURNS),
      { role: "user", content: request },
    ];
    try {
      for await (const piece of brain.reply(messages)) {
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
      reply = err.message || "Something went wrong in my head, sir.";
      line.textContent = reply;
      line.classList.add("error");
      voice.push(reply);
    }
    busy = false;
    voice.flush();
    refreshLook();
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
  // was refused, say it on the first one.
  speaker.say(hello).then(() => {
    if (!speaker.blocked) return;
    const once = () => {
      window.removeEventListener("pointerdown", once, true);
      window.removeEventListener("keydown", once, true);
      speaker.blocked = false;
      speaker.say(hello);
    };
    window.addEventListener("pointerdown", once, true);
    window.addEventListener("keydown", once, true);
  });

  return { brain, listener, speaker, handle };
}
