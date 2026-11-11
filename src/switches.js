// Two on/off switches, remembered in this browser: "voice" (Yaver listening
// and speaking) and "hands" (the camera that follows your hands). Both start on.
const KEYS = { voice: "yaver-voice-on", hands: "yaver-hands-on" };

export function isOn(name) {
  try { return localStorage.getItem(KEYS[name]) !== "0"; } catch { return true; }
}

export function setOn(name, on) {
  try { localStorage.setItem(KEYS[name], on ? "1" : "0"); } catch {}
  window.dispatchEvent(new CustomEvent("yaver-switch", { detail: { name, on } }));
}

// Calls fn(on) whenever that switch is flipped.
export function onSwitch(name, fn) {
  window.addEventListener("yaver-switch", (e) => { if (e.detail.name === name) fn(e.detail.on); });
}

// Wires up a switch button: shows its state and flips it on click.
export function switchButton(button, name) {
  const show = (on) => {
    button.setAttribute("aria-pressed", String(on));
    button.querySelector("b").textContent = on ? "On" : "Off";
  };
  show(isOn(name));
  onSwitch(name, show);
  button.addEventListener("click", () => setOn(name, !isOn(name)));
}
