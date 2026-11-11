// Stand-ins for the Arduino libraries the kit's parts use, so a sketch runs in
// the simulator against the circuit as it's wired: Stepper, LiquidCrystal,
// DHT, Keypad, IRremote (IrReceiver), MFRC522 and Rtc by Makuna (DS1302).
// Each checks that the part's pins really go to the pins the sketch names,
// and misbehaves the way the real part would if they don't.
import { KEYPAD_KEYS } from "./kit-parts.js?v=21";

// The kit's 21-key remote ("Car MP3"), NEC command codes.
export const IR_KEYS = [
  ["CH−", 0x45], ["CH", 0x46], ["CH+", 0x47],
  ["⏮", 0x44], ["⏭", 0x40], ["⏯", 0x43],
  ["−", 0x07], ["+", 0x15], ["EQ", 0x09],
  ["0", 0x16], ["100+", 0x19], ["200+", 0x0d],
  ["1", 0x0c], ["2", 0x18], ["3", 0x5e],
  ["4", 0x08], ["5", 0x1c], ["6", 0x5a],
  ["7", 0x42], ["8", 0x52], ["9", 0x4a],
];

// The two RFID tags in the kit (made-up IDs: the real ones are printed by lesson 1).
export const CARDS = {
  card: { name: "white card", uid: [0x93, 0x2a, 0x7c, 0x1e] },
  tag: { name: "blue key tag", uid: [0x4b, 0xc1, 0x08, 0xd5] },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `s` is the project player's state: { plan, circuit, objects }.
export function kitLibs(s) {
  const c = s.circuit;
  const parts = (type) => s.plan.parts.filter((p) => p.type === type);
  // Is this board pin wired to that pin of the part?
  const wired = (p, pin, boardPin) => boardPin !== undefined && boardPin !== null && c.netOf(`${p.id}.${pin}`) === c.boardNet(Number(boardPin));
  const say = (t) => c.onSerial?.(t);

  return {
    // Stepper(stepsPerTurn, pin1, pin2, pin3, pin4): the 4-wire full-step sequence.
    Stepper(rt, steps, ...pins) {
      let rpm = 1, index = 0, owed = 0;
      pins.forEach((p) => rt.output(p)); // the library makes its pins outputs
      const SEQ = [[1, 0, 1, 0], [0, 1, 1, 0], [0, 1, 0, 1], [1, 0, 0, 1]];
      return {
        setSpeed(v) { rpm = Math.max(0.1, Number(v) || 0.1); },
        async step(n) {
          n = Math.trunc(Number(n) || 0);
          const ms = 60000 / (steps * rpm);
          for (let k = 0; k < Math.abs(n); k++) {
            rt.check();
            index = (index + (n > 0 ? 1 : 3)) % 4;
            SEQ[index].forEach((v, i) => rt.write(pins[i], v));
            owed += ms;
            if (owed >= 14) { await rt.wait(owed); owed = 0; }
          }
        },
      };
    },

    // LiquidCrystal(rs, enable, d4, d5, d6, d7).
    LiquidCrystal(rt, rs, en, d4, d5, d6, d7) {
      const lcd = parts("lcd")[0];
      const ok = lcd && wired(lcd, "RS", rs) && wired(lcd, "E", en) && wired(lcd, "D4", d4) && wired(lcd, "D5", d5) && wired(lcd, "D6", d6) && wired(lcd, "D7", d7);
      const st = { lines: [" ".repeat(16), " ".repeat(16)], col: 0, row: 0, started: false, ok, shown: true };
      if (lcd) s.lcd = st;
      const put = (text) => {
        for (const ch of String(text)) {
          if (st.col < 40) {
            const line = st.lines[st.row].padEnd(40, " ");
            st.lines[st.row] = line.slice(0, st.col) + ch + line.slice(st.col + 1);
          }
          st.col++;
        }
      };
      return {
        begin() { st.started = true; },
        clear() { st.lines = [" ".repeat(16), " ".repeat(16)]; st.col = st.row = 0; },
        home() { st.col = st.row = 0; },
        setCursor(col, row) { st.col = Math.max(0, Math.trunc(col)); st.row = Math.min(1, Math.max(0, Math.trunc(row))); },
        print(v, base) { put(rt.fmt(v, base)); return String(v).length; },
        write(v) { put(typeof v === "number" ? String.fromCharCode(v) : v); },
        display() { st.shown = true; }, noDisplay() { st.shown = false; },
        cursor() {}, noCursor() {}, blink() {}, noBlink() {}, createChar() {},
        scrollDisplayLeft() { st.lines = st.lines.map((l) => l.slice(1) + " "); },
        scrollDisplayRight() { st.lines = st.lines.map((l) => ` ${l.slice(0, -1)}`); },
      };
    },

    // DHT(pin, type): temperature and humidity from the sliders.
    DHT(rt, pin) {
      const read = (what) => {
        const p = parts("dht11").find((q) => wired(q, "S", pin));
        if (!p || !c.powered(p, "+", "-")) return NaN;
        return Math.round(c.knobs.get(`${p.id}:${what}`) ?? (what === "temp" ? 22 : 45));
      };
      return { begin() {}, readTemperature: () => read("temp"), readHumidity: () => read("hum") };
    },

    // Keypad(keymap, rowPins, colPins, rows, cols): getKey() returns the key
    // pressed since the last call, as the keymap names it.
    Keypad(rt, map, rowPins, colPins) {
      return {
        getKey() {
          // No key is '\0' in C; "" behaves the same in comparisons here.
          const k = s.keyQueue?.shift();
          if (!k) return "";
          const pad = parts("keypad")[0];
          if (!pad) return "";
          const r = KEYPAD_KEYS.findIndex((row) => row.includes(k));
          const col = KEYPAD_KEYS[r].indexOf(k);
          const i = rowPins.findIndex((pin) => wired(pad, `R${r + 1}`, pin));
          const j = colPins.findIndex((pin) => wired(pad, `C${col + 1}`, pin));
          return i >= 0 && j >= 0 ? map[i]?.[j] ?? "" : "";
        },
        setDebounceTime() {}, setHoldTime() {},
      };
    },

    // IRremote 4.x: IrReceiver.begin(pin), decode(), decodedIRData.command, resume().
    IrReceiver() {
      let pin = null;
      const ir = {
        decodedIRData: { command: 0, address: 0, protocol: 0, flags: 0, decodedRawData: 0 },
        begin(p) { pin = Number(p); },
        decode() {
          if (!s.irQueue?.length) return false;
          const p = parts("ir").find((q) => wired(q, "OUT", pin));
          if (!p || !c.powered(p, "VCC", "GND")) { s.irQueue.length = 0; return false; }
          const cmd = s.irQueue[0];
          ir.decodedIRData = { command: cmd, address: 0, protocol: 8, flags: 0, decodedRawData: ((~cmd & 0xff) << 24 | cmd << 16 | 0xff00) >>> 0 };
          return true;
        },
        resume() { s.irQueue?.shift(); },
        start() {}, stop() {},
      };
      return ir;
    },

    // MFRC522(ssPin, rstPin): a card "tapped" in the simulator is read once.
    MFRC522(rt, ss, rst) {
      const rf = parts("rfid")[0];
      const okWiring = () => rf && wired(rf, "SDA", ss) && wired(rf, "RST", rst) && wired(rf, "SCK", 13) && wired(rf, "MOSI", 11) && wired(rf, "MISO", 12)
        && c.softLevel(c.netOf(`${rf.id}.GND`)) === 0 && c.high(`${rf.id}.3.3V`);
      let warned = false;
      const reader = {
        uid: { size: 0, uidByte: [0, 0, 0, 0] },
        PCD_Init() {
          if (rf && c.nodesOf(c.netOf(`${rf.id}.3.3V`)).includes("BOARD.5V") && !warned) { warned = true; say("⚠ The RC522 is on 5 V: it's a 3.3 V part, so move that wire to 3.3V."); }
        },
        PCD_DumpVersionToSerial() { say(okWiring() ? "Firmware Version: 0x92 = v2.0" : "Firmware Version: 0x0 = (unknown)\nWARNING: Communication failure, is the MFRC522 properly connected?"); },
        PICC_IsNewCardPresent() { return !!s.cardPending && okWiring(); },
        PICC_ReadCardSerial() {
          if (!s.cardPending || !okWiring()) return false;
          reader.uid = { size: 4, uidByte: [...CARDS[s.cardPending].uid], sak: 8 };
          s.cardPending = null;
          return true;
        },
        PICC_HaltA() {}, PCD_StopCrypto1() {},
      };
      return reader;
    },

    // Rtc by Makuna: ThreeWire(io, sclk, ce), RtcDS1302<ThreeWire> Rtc(wire).
    ThreeWire(rt, io, sclk, ce) { return { io, sclk, ce }; },
    RtcDS1302(rt, wire) {
      const ok = () => {
        const p = parts("ds1302")[0];
        return p && wired(p, "DAT", wire.io) && wired(p, "CLK", wire.sclk) && wired(p, "RST", wire.ce) && c.powered(p, "VCC", "GND");
      };
      s.rtcOffset ??= 0;
      return {
        Begin() {}, GetIsWriteProtected: () => false, SetIsWriteProtected() {}, GetIsRunning: () => true, SetIsRunning() {},
        IsDateTimeValid: () => ok(),
        SetDateTime(dt) { if (ok()) s.rtcOffset = dt.ms - Date.now(); },
        GetDateTime() { return ok() ? dateTime(Date.now() + s.rtcOffset) : dateTime(null); },
      };
    },
    // RtcDateTime(__DATE__, __TIME__) or (year, month, day, hour, minute, second).
    RtcDateTime(rt, a, b, ...rest) {
      if (typeof a === "string") {
        const [mon, day, year] = a.trim().split(/\s+/);
        const [h, m, sec] = String(b).split(":").map(Number);
        return dateTime(new Date(Number(year), MONTHS.indexOf(mon), Number(day), h, m, sec).getTime());
      }
      const [d = 1, h = 0, m = 0, sec = 0] = rest;
      return dateTime(new Date(a, (b ?? 1) - 1, d, h, m, sec).getTime());
    },
  };
}

// A RtcDateTime: Year(), Month(), Day(), Hour(), Minute(), Second(). A bad
// connection reads as 2000-01-01 with garbage time, like the real chip.
function dateTime(ms) {
  const bad = ms === null;
  const d = new Date(bad ? 946684800000 : ms);
  return {
    ms: d.getTime(),
    Year: () => d.getFullYear(), Month: () => d.getMonth() + 1, Day: () => d.getDate(),
    Hour: () => (bad ? 45 : d.getHours()), Minute: () => (bad ? 165 : d.getMinutes()), Second: () => (bad ? 85 : d.getSeconds()),
    DayOfWeek: () => d.getDay(),
  };
}
