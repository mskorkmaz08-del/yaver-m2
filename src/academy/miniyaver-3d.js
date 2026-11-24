// Mini Yaver built in 3D on a real breadboard, from the kit's own part
// models: the lean version with six parts (Uno, LCD, sound sensor, buzzer,
// button, RGB light). Every wire end carries the name of the pin it goes to ("D12",
// "LCD RS"), so nothing is only "left" or "right". Played by the project
// player (project.js).
import { KINDS } from "./project-parts.js?v=28";

// parts: [id, type, label, value, why, tag]. The tag is the short name on
// the pin labels.
const PARTS = [
  ["BB", "breadboard", "Breadboard", "", "Its + and − rails share 5V and GND with every part.", "BB"],
  ["LCD", "lcd", "1602 LCD (Yaver's face)", "", "Shows the face, the clock, timers and the short answer.", "LCD"],
  ["POT", "potentiometer", "10K pot (LCD contrast)", "10k", "Turn it until letters appear.", "POT"],
  ["RB", "resistor", "220 Ω (LCD backlight)", "220", "Keeps the backlight LED from burning.", "220Ω"],
  ["BTN", "button", "Push button (talk)", "", "Press to talk or stop. Hold 1 s for the night clock.", "BTN"],
  ["BZ", "buzzer", "Passive buzzer (Yaver's voice)", "passive", "Speaks Yaver's answers, and plays the beeps and alarm tunes.", "BUZZ"],
  ["MIC", "sound", "KY-037 sound sensor (Yaver's ear)", "", "Yaver's own microphone: it records you, and hears the double clap.", "SOUND"],
  ["RGB", "rgb", "RGB LED module (mood light)", "", "Fades through Yaver's moods: idle, listening, thinking, speaking.", "RGB"],
  ["R1", "resistor", "220 Ω (red)", "220", "One resistor per colour, or that LED burns.", "220Ω"],
  ["R2", "resistor", "220 Ω (green)", "220", "One resistor per colour.", "220Ω"],
  ["R3", "resistor", "220 Ω (blue)", "220", "One resistor per colour.", "220Ω"],
];

// The build steps: [from, to, colour, why].
const BUILD = [
  { title: "Power rails", parts: ["BB"],
    text: "Uno **5V → + rail** (red), **GND → − rail** (black). Every \"+\" and \"−\" after this means these rails.",
    wires: [["BOARD.5V", "BB.+", "red", ""], ["BOARD.GND", "BB.-", "black", ""]] },
  { title: "The LCD: power, contrast, light", parts: ["LCD", "POT", "RB"],
    text: "**VSS, RW, K → −**, **VDD → +**. Backlight: **A → 220 Ω → +**. Contrast pot: its ends to **+** and **−**, the middle leg (W) to **V0**. Turn it later until letters show.",
    wires: [["LCD.VSS", "BB.-", "black", ""], ["LCD.VDD", "BB.+", "red", ""], ["LCD.RW", "BB.-", "black", "Write only."], ["LCD.K", "BB.-", "black", "Backlight −."],
      ["LCD.A", "RB.1", "red", "Backlight +."], ["RB.2", "BB.+", "red", ""],
      ["POT.1", "BB.-", "black", ""], ["POT.2", "BB.+", "red", ""], ["POT.W", "LCD.V0", "orange", "Contrast."]] },
  { title: "The LCD's six data wires", parts: [],
    text: "Six Uno pins in a row: **D12 → RS**, **D11 → E**, **D10 → D4**, **D9 → D5**, **D8 → D6**, **D7 → D7**. The LCD's D0–D3 stay empty: it talks in 4-bit halves.",
    wires: [["BOARD.D12", "LCD.RS", "green", "Letter or command."], ["BOARD.D11", "LCD.E", "yellow", "Enable: read now."], ["BOARD.D10", "LCD.D4", "blue", ""],
      ["BOARD.D9", "LCD.D5", "blue", ""], ["BOARD.D8", "LCD.D6", "blue", ""], ["BOARD.D7", "LCD.D7", "blue", ""]] },
  { title: "The talk button", parts: ["BTN"],
    text: "One side to **D2**, the other side to **−**. No resistor: the Uno's own pull-up keeps D2 HIGH until you press.",
    wires: [["BTN.1", "BOARD.D2", "white", "Reads LOW when pressed."], ["BTN.2", "BB.-", "black", ""]] },
  { title: "The buzzer", parts: ["BZ"],
    text: "The **passive** buzzer (no sticker): **+ → D3**, **− → −**. It is Yaver's voice: D3 is the pin Timer2 can pulse fast enough for speech.",
    wires: [["BZ.+", "BOARD.D3", "purple", "The voice, beeps and tunes."], ["BZ.-", "BB.-", "black", ""]] },
  { title: "The mood light", parts: ["RGB", "R1", "R2", "R3"],
    text: "Each colour through its own **220 Ω**: **D5 → R**, **D6 → G**, **D4 → B**, and **− → −**. (A module marked **+** instead: that leg to **+**, and set RGB_COMMON_ANODE to true.)",
    wires: [["BOARD.D5", "R1.1", "red", "Red: analogWrite."], ["R1.2", "RGB.R", "red", ""], ["BOARD.D6", "R2.1", "green", "Green: analogWrite."], ["R2.2", "RGB.G", "green", ""],
      ["BOARD.D4", "R3.1", "blue", "Blue: dimmed by the sound timer."], ["R3.2", "RGB.B", "blue", ""], ["RGB.-", "BB.-", "black", "The shared minus."]] },
  { title: "The ear: sound sensor", parts: ["MIC"],
    text: "KY-037 **AO → A0**, **+ → +**, **G → −**. DO stays empty. It's Yaver's own microphone. Then plug the USB cable into the Mac and open the Mini Yaver page in Chrome.",
    wires: [["MIC.AO", "BOARD.A0", "purple", "Your voice, recorded 8000 times a second."], ["MIC.+", "BB.+", "red", ""], ["MIC.G", "BB.-", "black", ""]] },
];

// The top of the real sketch: the pin names the code uses. Each step lights
// the lines for its pins.
const PIN_MAP = `// D0, D1 : USB to the Mac
const uint8_t PIN_BUTTON = 2;    // push button; its other leg to GND (uses the built-in pull-up)
const uint8_t PIN_BUZZER = 3;    // passive buzzer +; its other leg to GND (D3: Timer2 plays the voice on it)
const uint8_t PIN_LED_B  = 4;    // RGB blue, through 220 ohm (dimmed by the sound engine's timer)
const uint8_t PIN_LED_R  = 5;    // RGB red, through 220 ohm (analogWrite)
const uint8_t PIN_LED_G  = 6;    // RGB green, through 220 ohm (analogWrite)
const uint8_t PIN_LCD_D7 = 7;    // the LCD sits on six pins in a row: D12 down to D7
const uint8_t PIN_LCD_D6 = 8;
const uint8_t PIN_LCD_D5 = 9;
const uint8_t PIN_LCD_D4 = 10;
const uint8_t PIN_LCD_E  = 11;
const uint8_t PIN_LCD_RS = 12;
const uint8_t PIN_SOUND  = A0;   // KY-037 "AO" (analog out)`;

const STEP_LINES = [
  [1],
  [],
  ["PIN_LCD"],
  ["PIN_BUTTON"],
  ["PIN_BUZZER"],
  ["PIN_LED"],
  ["PIN_SOUND"],
];

let cached = null;
export function miniPlan() {
  if (cached) return cached;
  const types = new Map(PARTS.map(([id, type]) => [id, type]));
  const end = (s) => {
    const i = s.indexOf(".");
    const part = s.slice(0, i), pin = s.slice(i + 1);
    if (part !== "BOARD" && !(KINDS[types.get(part)] ?? []).includes(pin)) throw new Error(`Mini Yaver: no pin ${s}`);
    return { part, pin };
  };
  const codeLines = PIN_MAP.split("\n");
  const wires = [];
  const steps = BUILD.map((b, k) => ({
    title: b.title, text: b.text, parts: b.parts, code_lines: [],
    wires: b.wires.map(([from, to, color, why]) => { wires.push({ from: end(from), to: end(to), color, why }); return wires.length - 1; }),
    pinLines: STEP_LINES[k].flatMap((h) => (typeof h === "number" ? [h] : codeLines.flatMap((l, i) => (l.includes(h) ? [i + 1] : [])))),
  }));
  cached = {
    title: "Mini Yaver in 3D",
    summary: "Your Uno as a desk AI with just **six parts**: the LCD is Yaver's face, the sound sensor its ear, the buzzer its voice, the RGB light its mood, and one button to talk. The Mac only passes things to Gemini and back. **Every wire end is labelled with its pin** (D12, LCD RS, …). Step through the build; click any part to see what it's for, and drag to turn the view.",
    board: "uno",
    parts: PARTS.map(([id, type, label, value, why, tag]) => ({ id, type, label, value, why, tag, pins: KINDS[type] })),
    wires, steps, stages: [], tips: [], warnings: ["Wire the LCD first and test it: turn the pot until you see letters."],
    code: PIN_MAP,
    mini: true,
    pinTags: true,
  };
  return cached;
}
