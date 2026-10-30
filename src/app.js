// Yaver Mark II. The home screen is Yaver himself; the 3D Studio and the
// Robotics Academy open on top of it (buttons, voice, or the #studio and
// #academy addresses). Each is loaded the first time it's needed, and the
// camera only runs while one of them is open.
import { startAssistant } from "./assistant/assistant.js?v=18";

const VERSION = new URL(import.meta.url).searchParams.get("v") ?? "dev";
for (const el of document.querySelectorAll(".app-version")) el.textContent = `v${VERSION}`;

let studio = null; // the studio module once loaded
let opening = null;
let academy = null; // the academy module once loaded
let openingAcademy = null;

const view = () => document.body.dataset.view;

function show(name) {
  document.body.dataset.view = name;
  if (name !== "studio") studio?.pause();
  if (name !== "academy") academy?.pause();
  if (name === "studio") studio?.resume();
  if (name === "academy") academy?.resume();
}

async function openStudio() {
  if (location.hash !== "#studio") history.pushState(null, "", "#studio");
  show("studio");
  opening ??= import("./studio.js?v=18").then((m) => {
    studio = m;
    if (view() !== "studio") studio.pause(); // went home while it was loading
  });
  await opening;
  return studio.api;
}

// `sub` is "" (the course map), "sim", or a lesson id.
async function openAcademy(sub = "") {
  const hash = sub ? `#academy/${sub}` : "#academy";
  if (location.hash !== hash) history.pushState(null, "", hash);
  show("academy");
  openingAcademy ??= import("./academy/academy.js?v=18").then((m) => {
    academy = m;
    academy.setHome(goHome);
    if (view() !== "academy") academy.pause();
    else academy.resume();
  });
  await openingAcademy;
  academy.route(sub);
  return academy;
}

function goHome() {
  if (location.hash) history.pushState(null, "", location.pathname + location.search);
  show("home");
}

function fromHash() {
  const h = location.hash;
  if (h === "#studio") openStudio();
  else if (h.startsWith("#academy")) {
    const sub = h.slice("#academy".length).replace(/^\//, "");
    if (view() === "academy" && academy) academy.route(sub);
    else openAcademy(sub);
  } else show("home");
}

// The browser's Back button (and the Mac's swipe) move between screens too.
window.addEventListener("popstate", fromHash);

document.getElementById("open-studio").addEventListener("click", () => openStudio());
document.getElementById("open-academy").addEventListener("click", () => openAcademy());
document.getElementById("go-home").addEventListener("click", () => goHome());
window.addEventListener("keydown", (e) => {
  // Esc goes back a level, unless it's clearing something being typed.
  if (e.key !== "Escape" || e.target.value) return;
  if (view() === "studio") goHome();
  else if (view() === "academy") {
    if (location.hash === "#academy") goHome();
    else academy?.go("menu");
  }
});

window.yaver = {
  ...window.yaver,
  assistant: startAssistant({
    view,
    openStudio,
    goHome,
    studio: () => studio?.api ?? null,
    openAcademy,
    academy: () => (view() === "academy" ? academy : null),
  }),
};

fromHash();
window.studioStarted = true;
