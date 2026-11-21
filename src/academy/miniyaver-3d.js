// Mini Yaver built in 3D on a real breadboard, from the kit's own part
// models. The same eight steps as the wiring map, but every wire end carries
// the name of the pin it goes to ("D13", "LCD RS", "595 Q0"), so nothing is
// only "left" or "right". Played by the project player (project.js).
import { KINDS } from "./project-parts.js?v=26";

// parts: [id, type, label, value, why, tag]. The tag is the short name on
// the pin labels.
const PARTS = [
  ["BB", "breadboard", "Breadboard", "", "Its + and − rails share 5V and GND with every part.", "BB"],
  ["SR", "hc595", "74HC595 shift register", "", "3 wires in, 8 outputs out. Sits across the middle gap, notch to the left.", "595"],
  ["LCD", "lcd", "1602 LCD", "", "Driven only by the 595: no Uno pins of its own.", "LCD"],
  ["POT", "potentiometer", "10K pot (LCD contrast)", "10k", "Turn it until letters appear.", "POT"],
  ["RB", "resistor", "220 Ω (LCD backlight)", "220", "", "220Ω"],
  ["RF", "rfid", "RC522 RFID reader", "", "3.3V only. Shares SPI with the 595.", "RFID"],
  ["IR", "ir", "IR receiver", "", "The remote: 21 keys on one pin.", "IR"],
  ["JS", "joystick", "Joystick", "", "Two axes on A0/A1, button on D3 (interrupt).", "JOY"],
  ["SV", "servo", "SG90 servo (the nod)", "", "Brown GND, red 5V, orange signal.", "SERVO"],
  ["ST", "stepper", "Stepper + ULN2003 (the head)", "", "IN1–IN4 on D4–D7: one register write moves all four coils.", "STEP"],
  ["LDR", "ldr", "Photoresistor (light)", "", "With the 10K it makes a voltage divider on A2.", "LDR"],
  ["R10", "resistor", "10K (light divider)", "10k", "From A2 to GND.", "10K"],
  ["WS", "water", "Water sensor", "", "", "WATER"],
  ["MIC", "sound", "KY-037 sound sensor", "", "Clap and Yaver says \"Yes, sir?\".", "SOUND"],
  ["DHT", "dht11", "DHT11 temperature + humidity", "", "", "DHT"],
  ["RL", "relay", "Relay (the lamp)", "", "Low-voltage lamp only, never 220V.", "RELAY"],
  ["RZ", "resistor", "220 Ω (buzzer)", "220", "Protects the 595's output.", "220Ω"],
  ["BZ", "buzzer", "Active buzzer", "active", "The one with the sticker on top.", "BUZZ"],
];

// The eight build steps: [from, to, colour, why].
const BUILD = [
  { title: "Power rails", parts: ["BB"],
    text: "Uno **5V → + rail** (red), **GND → − rail** (black). Every \"+\" and \"−\" after this means these rails. Only the RFID reader uses the separate **3V3** pin.",
    wires: [["BOARD.5V", "BB.+", "red", ""], ["BOARD.GND", "BB.-", "black", ""]] },
  { title: "74HC595: 3 wires in, 8 outputs out", parts: ["SR"],
    text: "Across the middle gap, notch to the left. **DS ← D11** (data), **SHCP ← D13** (clock), **STCP ← D8** (latch). **VCC** and **MR** to +, **GND** and **OE** to −.",
    wires: [["SR.VCC", "BB.+", "red", "Power."], ["SR.MR", "BB.+", "red", "Reset off."], ["SR.GND", "BB.-", "black", ""], ["SR.OE", "BB.-", "black", "Outputs on."],
      ["BOARD.D11", "SR.DS", "blue", "Data (SPI MOSI)."], ["BOARD.D13", "SR.SHCP", "orange", "Clock (SPI SCK)."], ["BOARD.D8", "SR.STCP", "yellow", "Latch."]] },
  { title: "The LCD, through the 595", parts: ["LCD", "POT", "RB"],
    text: "**Q0 → RS**, **Q1 → E**, **Q2–Q5 → D4–D7**. D0–D3 stay empty. **VSS, RW, K → −**, **VDD → +**, **A → 220 Ω → +**. Pot: ends to + and −, middle (W) to **V0**.",
    wires: [["SR.Q0", "LCD.RS", "green", "Letter or command."], ["SR.Q1", "LCD.E", "yellow", "Enable: read now."], ["SR.Q2", "LCD.D4", "blue", ""], ["SR.Q3", "LCD.D5", "blue", ""], ["SR.Q4", "LCD.D6", "blue", ""], ["SR.Q5", "LCD.D7", "blue", ""],
      ["LCD.VSS", "BB.-", "black", ""], ["LCD.VDD", "BB.+", "red", ""], ["LCD.RW", "BB.-", "black", "Write only."], ["LCD.K", "BB.-", "black", ""], ["LCD.A", "RB.1", "red", "Backlight."], ["RB.2", "BB.+", "red", ""],
      ["POT.1", "BB.-", "black", ""], ["POT.2", "BB.+", "red", ""], ["POT.W", "LCD.V0", "orange", "Contrast."]] },
  { title: "RFID on the same SPI bus", parts: ["RF"],
    text: "**SCK → D13** and **MOSI → D11**, shared with the 595. **MISO → D12**, **SDA → D10** (its own select). **3.3V and RST → 3V3** (never 5V), **GND → −**.",
    wires: [["RF.SDA", "BOARD.D10", "yellow", "Select: \"RFID, listen\"."], ["RF.SCK", "BOARD.D13", "orange", "Shared clock."], ["RF.MOSI", "BOARD.D11", "blue", "Shared data out."], ["RF.MISO", "BOARD.D12", "green", "Data back."],
      ["RF.3.3V", "BOARD.3V3", "red", "3.3 V only."], ["RF.RST", "BOARD.3V3", "white", "Held high: the code resets it by software."], ["RF.GND", "BB.-", "black", ""]] },
  { title: "Inputs: remote and joystick", parts: ["IR", "JS"],
    text: "IR **OUT → D2** (interrupt INT0). Joystick **VRx → A0**, **VRy → A1**, **SW → D3** (interrupt INT1). Both get + and −.",
    wires: [["IR.OUT", "BOARD.D2", "white", ""], ["IR.VCC", "BB.+", "red", ""], ["IR.GND", "BB.-", "black", ""],
      ["JS.VRx", "BOARD.A0", "green", "Left/right."], ["JS.VRy", "BOARD.A1", "blue", "Up/down."], ["JS.SW", "BOARD.D3", "white", "Press = OK."], ["JS.+5V", "BB.+", "red", ""], ["JS.GND", "BB.-", "black", ""]] },
  { title: "Motion: servo and stepper", parts: ["SV", "ST"],
    text: "Servo **SIG (orange) → D9**. ULN2003 **IN1–IN4 → D4–D7**. Both to + and −. The code never moves both at once: USB can't power that.",
    wires: [["SV.SIG", "BOARD.D9", "orange", ""], ["SV.V+", "BB.+", "red", ""], ["SV.GND", "BB.-", "brown", ""],
      ["ST.IN1", "BOARD.D4", "orange", "Coil A."], ["ST.IN2", "BOARD.D5", "yellow", "Coil B."], ["ST.IN3", "BOARD.D6", "green", "Coil C."], ["ST.IN4", "BOARD.D7", "blue", "Coil D."], ["ST.+", "BB.+", "red", ""], ["ST.-", "BB.-", "black", ""]] },
  { title: "Sensors on A2 to A5", parts: ["LDR", "R10", "WS", "MIC", "DHT"],
    text: "Light: **LDR** from + to **A2**, **10K** from A2 to −. Water **S → A3**, sound **AO → A4**, DHT11 **S → A5**. Each gets + and −.",
    wires: [["LDR.1", "BB.+", "red", ""], ["LDR.2", "BOARD.A2", "green", ""], ["R10.1", "LDR.2", "green", "The divider's middle."], ["R10.2", "BB.-", "black", ""],
      ["WS.S", "BOARD.A3", "blue", ""], ["WS.+", "BB.+", "red", ""], ["WS.-", "BB.-", "black", ""],
      ["MIC.AO", "BOARD.A4", "purple", "Analog loudness."], ["MIC.+", "BB.+", "red", ""], ["MIC.G", "BB.-", "black", ""],
      ["DHT.S", "BOARD.A5", "yellow", ""], ["DHT.+", "BB.+", "red", ""], ["DHT.-", "BB.-", "black", ""]] },
  { title: "Relay and buzzer: the last two 595 outputs", parts: ["RL", "RZ", "BZ"],
    text: "**Q6 → relay S**, **Q7 → 220 Ω → buzzer +**, buzzer − to −. Relay + and −. Now all 20 Uno pins and all 8 outputs of the 595 are used.",
    wires: [["SR.Q6", "RL.S", "orange", "Lamp on/off."], ["RL.+", "BB.+", "red", ""], ["RL.-", "BB.-", "black", ""],
      ["SR.Q7", "RZ.1", "purple", ""], ["RZ.2", "BZ.+", "purple", ""], ["BZ.-", "BB.-", "black", ""]] },
];

// The top of the real sketch: the pin names the code uses. Each step lights
// the lines for its pins.
const PIN_MAP = `// D0, D1  : USB serial to the Mac (taken by the CH340 chip)
const uint8_t PIN_IR       = 2;   // IR receiver OUT            (INT0 pin)
const uint8_t PIN_JOY_SW   = 3;   // joystick button SW         (INT1)
// D4..D7  : ULN2003 IN1..IN4 (stepper). Written in one go through PORTD.
const uint8_t PIN_LATCH    = 8;   // 74HC595 ST_CP (pin 12)
const uint8_t PIN_SERVO    = 9;   // SG90 signal
const uint8_t PIN_RFID_SS  = 10;  // RC522 SDA/SS
// D11 MOSI -> RC522 MOSI + 74HC595 DS (pin 14)
// D12 MISO <- RC522 MISO
// D13 SCK  -> RC522 SCK  + 74HC595 SH_CP (pin 11)
const uint8_t PIN_JOY_X    = A0;
const uint8_t PIN_JOY_Y    = A1;
const uint8_t PIN_LIGHT    = A2;  // photoresistor + 10K divider
const uint8_t PIN_WATER    = A3;  // water level sensor S
const uint8_t PIN_SOUND    = A4;  // KY-037 analog out A0
const uint8_t PIN_DHT      = A5;  // DHT11 data (used as a digital pin)

// 74HC595 output bits (Q0..Q7)
const uint8_t SR_RS     = 0x01;  // Q0 -> LCD RS
const uint8_t SR_E      = 0x02;  // Q1 -> LCD E
                                 // Q2..Q5 -> LCD D4..D7
const uint8_t SR_RELAY  = 0x40;  // Q6 -> relay IN
const uint8_t SR_BUZZ   = 0x80;  // Q7 -> active buzzer (+) through 220R`;

const STEP_LINES = [
  [1],
  ["PIN_LATCH", "D11 MOSI", "D13 SCK"],
  ["SR_RS", "SR_E ", "Q2..Q5"],
  ["PIN_RFID_SS", "D11 MOSI", "D12 MISO", "D13 SCK"],
  ["PIN_IR", "PIN_JOY_SW", "PIN_JOY_X", "PIN_JOY_Y"],
  ["PIN_SERVO", "D4..D7"],
  ["PIN_LIGHT", "PIN_WATER", "PIN_SOUND", "PIN_DHT"],
  ["SR_RELAY", "SR_BUZZ"],
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
    summary: "Your Uno as a desk AI, built on a real breadboard from your kit's parts. **Every wire end is labelled with its pin**: Uno pins as **D13**, **A0**, **5V**; part pins as **LCD RS**, **595 Q0**, **RFID SCK**. Step through the build; click any part to see what it's for, and drag to turn the view.",
    board: "uno",
    parts: PARTS.map(([id, type, label, value, why, tag]) => ({ id, type, label, value, why, tag, pins: KINDS[type] })),
    wires, steps, stages: [], tips: [], warnings: ["Wire the 595 and the LCD first and test them: without them you see nothing."],
    code: PIN_MAP,
    mini: true,
    pinTags: true,
  };
  return cached;
}
