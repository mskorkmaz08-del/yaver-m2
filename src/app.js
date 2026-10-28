// Yaver Mark II. The home screen is Yaver himself; the 3D Studio opens on top
// of it (button, "open the studio", or the #studio address) and is loaded the
// first time it's needed, so the camera only runs while you're in it.
import { startAssistant } from "./assistant/assistant.js?v=11";

const VERSION = new URL(import.meta.url).searchParams.get("v") ?? "dev";
for (const el of document.querySelectorAll(".app-version")) el.textContent = `v${VERSION}`;

let studio = null; // the studio module once loaded
let opening = null;

const view = () => document.body.dataset.view;

function show(name) {
  document.body.dataset.view = name;
  if (name === "studio") studio?.resume();
  else studio?.pause();
}

async function openStudio() {
  if (location.hash !== "#studio") history.pushState(null, "", "#studio");
  show("studio");
  opening ??= import("./studio.js?v=11").then((m) => {
    studio = m;
    if (view() !== "studio") studio.pause(); // went home while it was loading
  });
  await opening;
  return studio.api;
}

function goHome() {
  if (location.hash === "#studio") history.back();
  else show("home");
}

// The browser's Back button (and the Mac's swipe) go home too.
window.addEventListener("popstate", () => {
  if (location.hash === "#studio") openStudio();
  else show("home");
});

document.getElementById("open-studio").addEventListener("click", () => openStudio());
document.getElementById("go-home").addEventListener("click", () => goHome());
window.addEventListener("keydown", (e) => {
  // Esc goes home, unless it's clearing something being typed.
  if (e.key === "Escape" && view() === "studio" && !e.target.value) goHome();
});

window.yaver = {
  ...window.yaver,
  assistant: startAssistant({ view, openStudio, goHome, studio: () => studio?.api ?? null }),
};

if (location.hash === "#studio") openStudio();
else show("home");
window.studioStarted = true;
