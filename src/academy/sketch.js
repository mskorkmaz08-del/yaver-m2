// Runs Arduino sketches (C++) in the browser for the robot simulator. The
// sketch is translated into JavaScript line for line (types dropped,
// functions made async so delay() can wait without freezing the page), then
// run against a simulated ESP32 with the usual Arduino calls: pinMode,
// digitalWrite, digitalRead, analogRead, analogWrite, ledcAttach / ledcWrite,
// pulseIn, delay, millis, Serial and friends.

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const STOP = Symbol("stop");

const TYPE = String.raw`(?:(?:unsigned|signed|static|volatile|const)\s+)*(?:void|int|long|short|float|double|bool|boolean|byte|char|word|size_t|String|u?int(?:8|16|32|64)_t)(?:\s+(?:long|int))*`;
const INT_TYPE = /^(?:(?:unsigned|signed|static|volatile|const)\s+)*(?:int|long|short|byte|word|size_t|u?int(?:8|16|32|64)_t|char)(?:\s+(?:long|int))*$/;

// ---- Translating C++ to JavaScript -----------------------------------------------

export function translate(src) {
  // Keep strings and comments out of the way of the rewriting below.
  const strings = [];
  let code = src.replace(/\r\n?/g, "\n").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => {
    if (m.startsWith("//")) return "";
    if (m.startsWith("/*")) return m.replace(/[^\n]/g, "");
    strings.push(m);
    return `__S${strings.length - 1}__`;
  });

  code = code
    .replace(/^\s*#include[^\n]*/gm, "")
    .replace(/^\s*#define\s+(\w+)\s+([^\n]+)/gm, "const $1 = $2;")
    .replace(/^\s*#(?:ifdef|ifndef|endif|if|else|pragma)[^\n]*/gm, "")
    .replace(/\b(\d+)(?:UL|ul|LL|ll|L|l|U|u)\b/g, "$1")
    .replace(/(\b\d+\.\d*|\.\d+)[fF]\b/g, "$1")
    .replace(/\bF\(\s*(__S\d+__)\s*\)/g, "$1");

  // Function prototypes go; definitions become async functions.
  code = code.replace(new RegExp(String.raw`^[ \t]*${TYPE}\s*[*&]?\s*\w+\s*\([^)]*\)\s*;`, "gm"), "");
  const userFns = new Set();
  const wrappers = [];
  code = code.replace(new RegExp(String.raw`(^|[\n;}])([ \t]*)(${TYPE})\s*[*&]?\s*(\w+)\s*\(([^)]*)\)\s*\{`, "g"), (m, pre, indent, type, name, params) => {
    userFns.add(name);
    const names = params.split(",").map((p) => p.replace(/=.*$/, "").replace(/\[\s*\d*\s*\]/g, "").trim()).filter((p) => p && p !== "void").map((p) => p.match(/(\w+)\s*$/)?.[1] ?? p);
    // A function returning an integer truncates its result, like C does.
    if (INT_TYPE.test(type.trim())) {
      wrappers.push(`async function ${name}(...a) { return __int(await __impl_${name}(...a)); }`);
      return `${pre}${indent}async function __impl_${name}(${names.join(", ")}) {`;
    }
    return `${pre}${indent}async function ${name}(${names.join(", ")}) {`;
  });

  // Casts disappear.
  code = code.replace(new RegExp(String.raw`\(\s*${TYPE}\s*\*?\s*\)`, "g"), "");

  // Arrays: "int pins[] = {1, 2};" and "int buf[8];".
  code = code.replace(new RegExp(String.raw`\b(${TYPE})\s+(\w+)\s*((?:\[\s*\w*\s*\])+)\s*(=|;)`, "g"), (m, type, name, dims, end) => {
    const kw = /\bconst\b/.test(type) ? "const" : "let";
    if (end === "=") return `${kw} ${name} =`;
    const n = dims.match(/\[\s*(\w*)\s*\]/)[1] || 0;
    return `${kw} ${name} = new Array(${n}).fill(0);`;
  });
  // Brace initialisers become array literals (innermost first).
  for (let i = 0; i < 4; i++) code = code.replace(/([=,[(]\s*)\{([^{};]*)\}/g, "$1[$2]");

  // Declarations: drop the type. Integers are truncated like in C when set.
  code = rewriteDeclarations(code);

  // Calls to the sketch's own functions wait for them to finish.
  for (const name of userFns) code = code.replace(new RegExp(String.raw`(?<!function\s)\b${name}\s*\(`, "g"), `await ${name}(`);
  code = code.replace(/\bdelay\s*\(/g, "await delay(");

  // Every loop pass lets the page breathe, so a busy loop can't freeze it.
  code = addLoopTicks(code);

  code = code.replace(/__S(\d+)__/g, (m, i) => strings[Number(i)]);
  if (wrappers.length) code += `\n${wrappers.join("\n")}`;
  return { code, userFns: [...userFns] };
}

function rewriteDeclarations(code) {
  const re = new RegExp(String.raw`(^|[\s;{}(,])(${TYPE})\s+(?=[A-Za-z_]\w*\s*(?:=|;|,|\)|:))`, "g");
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(code))) {
    const type = m[2];
    if (/^\s*void\b/.test(type)) continue;
    const start = m.index + m[1].length;
    out += code.slice(last, start);
    const kw = /\bconst\b/.test(type) && !/\bfor\s*\($/.test(code.slice(0, start).trimEnd()) ? "const" : "let";
    out += `${kw} `;
    last = m.index + m[0].length;
    // An integer with a simple initialiser: wrap the value in __int().
    if (INT_TYPE.test(type.trim())) {
      const rest = code.slice(last);
      const head = rest.match(/^(\w+)\s*=\s*/);
      if (head) {
        let depth = 0, i = head[0].length, comma = false;
        for (; i < rest.length; i++) {
          const c = rest[i];
          if (c === "(" || c === "[") depth++;
          else if (c === ")" || c === "]") { if (depth === 0) break; depth--; }
          else if (c === "," && depth === 0) { comma = true; break; }
          else if (c === ";" && depth === 0) break;
        }
        if (!comma && rest[i] === ";") {
          out += `${head[1]} = __int(${rest.slice(head[0].length, i)})`;
          last += i;
        }
      }
    }
  }
  return out + code.slice(last);
}

function addLoopTicks(code) {
  let out = "";
  let i = 0;
  const re = /\b(for|while)\s*\(|\bdo\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[0].startsWith("do")) {
      out += code.slice(i, m.index + m[0].length) + " await __tick();";
      i = m.index + m[0].length;
      continue;
    }
    // Find the matching ")".
    let depth = 1, j = m.index + m[0].length;
    for (; j < code.length && depth; j++) { if (code[j] === "(") depth++; else if (code[j] === ")") depth--; }
    let k = j;
    while (k < code.length && /\s/.test(code[k])) k++;
    const before = code.slice(0, m.index).trimEnd();
    if (m[1] === "while" && code[k] === ";" && before.endsWith("}")) continue; // the end of a do-while
    if (code[k] === "{") {
      out += code.slice(i, k + 1) + " await __tick();";
      i = k + 1;
    } else {
      // A single statement: wrap it in braces.
      let depth2 = 0, e = k;
      for (; e < code.length; e++) {
        if (code[e] === "(" || code[e] === "[" || code[e] === "{") depth2++;
        else if (code[e] === ")" || code[e] === "]" || code[e] === "}") depth2--;
        else if (code[e] === ";" && depth2 === 0) break;
      }
      out += code.slice(i, k) + "{ await __tick(); " + code.slice(k, e + 1) + " }";
      i = e + 1;
    }
    re.lastIndex = i;
  }
  return out + code.slice(i);
}

// ---- Running it ------------------------------------------------------------------------

// `hw` is the simulated board: { pinMode(pin, mode), digitalWrite(pin, v),
// digitalRead(pin), analogRead(pin), pwm(pin, duty 0..1), pulseIn(pin, level,
// timeoutUs) → µs, serial(text), crash(message) }.
export class SketchRunner {
  constructor(hw) {
    this.hw = hw;
    this.stopped = true;
    this.offset = 0; // virtual time added by delayMicroseconds and pulseIn, in ms
    this.lastYield = 0;
    this.ticks = 0;
  }

  millis() { return performance.now() - this.t0 + this.offset; }
  micros() { return this.millis() * 1000; }

  stop() { this.stopped = true; }

  // Translates and starts the sketch. Resolves when it stops; calls
  // onError(message, line) if it can't compile or crashes.
  async run(src, onError) {
    this.stop();
    await new Promise((r) => setTimeout(r, 0)); // let a previous run notice
    let fn, translated;
    try {
      translated = translate(src);
      const api = this.api();
      fn = new AsyncFunction(...Object.keys(api), `${translated.code}\nreturn { setup: typeof setup === "function" ? setup : null, loop: typeof loop === "function" ? loop : null };`);
      this.apiValues = Object.values(api);
    } catch (err) {
      onError?.(friendly(err), null);
      return;
    }
    this.stopped = false;
    this.t0 = performance.now();
    this.offset = 0;
    this.lastYield = performance.now();
    const me = (this.runId = (this.runId ?? 0) + 1);
    try {
      const prog = await fn(...this.apiValues);
      if (!prog.loop) throw new Error("The sketch needs a loop() function.");
      await prog.setup?.();
      while (!this.stopped && me === this.runId) {
        await prog.loop();
        await this.breathe(true);
      }
    } catch (err) {
      if (err === STOP || this.stopped) return;
      const line = lineOf(err);
      onError?.(friendly(err), line);
      this.stopped = true;
    }
  }

  check() { if (this.stopped) throw STOP; }

  // Yields to the page now and then (every few milliseconds of busy work).
  breathe(force = false) {
    this.check();
    this.ticks++;
    const now = performance.now();
    if (now - this.lastYield > 6 || (force && this.ticks % 64 === 0)) {
      this.lastYield = now;
      return new Promise((r) => setTimeout(r, 0)).then(() => this.check());
    }
    return undefined;
  }

  api() {
    const hw = this.hw;
    const r = this;
    const pinNum = (p) => Number(p);
    const ledc = new Map(); // old-style channels → { pins, bits }
    const pinBits = new Map();
    const fmt = (v, base) => {
      if (typeof v === "number" && base !== undefined) {
        if (base === 2 || base === 8 || base === 16) return Math.trunc(v).toString(base).toUpperCase();
        if (base >= 0 && base <= 8 && !Number.isInteger(v)) return v.toFixed(base); // print(x, 3) = 3 decimals
      }
      if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(2);
      if (typeof v === "boolean") return v ? "1" : "0";
      return String(v);
    };
    let line = "";
    const out = (s) => {
      line += s;
      const parts = line.split("\n");
      line = parts.pop();
      for (const p of parts) hw.serial(p);
    };
    return {
      HIGH: 1, LOW: 0, INPUT: "INPUT", OUTPUT: "OUTPUT", INPUT_PULLUP: "INPUT_PULLUP", INPUT_PULLDOWN: "INPUT_PULLDOWN",
      LED_BUILTIN: 2, PI: Math.PI, DEC: 10, HEX: 16, BIN: 2, OCT: 8, WL_CONNECTED: 3, NULL: null,
      __int: (v) => (typeof v === "number" ? Math.trunc(v) : typeof v === "boolean" ? Number(v) : v),
      __tick: () => r.breathe(),
      pinMode: (p, mode) => { r.check(); hw.pinMode(pinNum(p), mode); },
      digitalWrite: (p, v) => { r.check(); hw.digitalWrite(pinNum(p), v ? 1 : 0); },
      digitalRead: (p) => { r.check(); return hw.digitalRead(pinNum(p)); },
      analogRead: (p) => { r.check(); return hw.analogRead(pinNum(p)); },
      analogWrite: (p, v) => { r.check(); hw.pwm(pinNum(p), Math.min(Math.max(v, 0), 255) / 255); },
      // Arduino-ESP32 3.x: ledcAttach(pin, freq, bits), ledcWrite(pin, duty).
      ledcAttach: (p, freq, bits = 8) => { pinBits.set(pinNum(p), bits); hw.pinMode(pinNum(p), "OUTPUT"); return true; },
      ledcAttachChannel: (p, freq, bits, ch) => { pinBits.set(pinNum(p), bits); ledc.set(ch, { pins: [pinNum(p)], bits }); return true; },
      // The older 2.x API with channels: ledcSetup(ch, freq, bits), ledcAttachPin(pin, ch).
      ledcSetup: (ch, freq, bits = 8) => { ledc.set(ch, { pins: ledc.get(ch)?.pins ?? [], bits }); return freq; },
      ledcAttachPin: (p, ch) => { const c = ledc.get(ch) ?? { pins: [], bits: 8 }; c.pins.push(pinNum(p)); ledc.set(ch, c); hw.pinMode(pinNum(p), "OUTPUT"); },
      ledcWrite: (target, duty) => {
        r.check();
        if (pinBits.has(target)) return hw.pwm(target, duty / (2 ** pinBits.get(target) - 1));
        const c = ledc.get(target);
        if (c) for (const p of c.pins) hw.pwm(p, duty / (2 ** c.bits - 1));
        else hw.serial(`E ledc: pin ${target} isn't attached. Call ledcAttach(${target}, 1000, 8) in setup() first.`);
      },
      delay: (ms) => {
        r.check();
        return new Promise((res) => setTimeout(res, Math.max(Number(ms) || 0, 0))).then(() => { r.lastYield = performance.now(); r.check(); });
      },
      delayMicroseconds: (us) => { r.check(); r.offset += us / 1000; },
      millis: () => Math.floor(r.millis()),
      micros: () => Math.floor(r.micros()),
      pulseIn: (p, level = 1, timeout = 1000000) => {
        r.check();
        const us = hw.pulseIn(pinNum(p), level, timeout, r.micros());
        r.offset += (us || timeout) / 1000;
        return us;
      },
      Serial: {
        begin: () => {}, end: () => {}, flush: () => {}, available: () => 0, read: () => -1,
        print: (v = "", b) => out(fmt(v, b)),
        println: (v = "", b) => out(fmt(v, b) + "\n"),
        printf: (f, ...args) => { let i = 0; out(String(f).replace(/%[-+ 0#]*\d*(?:\.(\d+))?[lh]*([dfisuxXc%])/g, (m, prec, t) => t === "%" ? "%" : t === "f" ? Number(args[i++]).toFixed(prec ? Number(prec) : 6) : t === "x" || t === "X" ? Math.trunc(args[i++]).toString(16) : t === "d" || t === "i" || t === "u" ? String(Math.trunc(args[i++])) : String(args[i++]))); },
      },
      WiFi: { begin: () => hw.serial("WiFi: connecting… (simulated)"), status: () => 3, localIP: () => "192.168.1.42", mode: () => {}, disconnect: () => {} },
      constrain: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
      map: (v, a, b, c, d) => Math.trunc(((v - a) * (d - c)) / (b - a) + c),
      abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, pow: Math.pow, sq: (x) => x * x,
      sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2, round: Math.round, floor: Math.floor, ceil: Math.ceil, fabs: Math.abs,
      random: (a, b) => (b === undefined ? Math.floor(Math.random() * a) : Math.floor(a + Math.random() * (b - a))),
      randomSeed: () => {},
      sizeof: (a) => (Array.isArray(a) ? a.length * 4 : 4),
      String: (v) => String(v),
      yield: () => r.breathe(true),
    };
  }
}

function lineOf(err) {
  const m = String(err?.stack ?? "").match(/<anonymous>:(\d+):\d+/);
  return m ? Math.max(Number(m[1]) - 2, 1) : null;
}

function friendly(err) {
  const msg = String(err?.message ?? err);
  let m;
  if ((m = msg.match(/^(\w+) is not defined/))) return `'${m[1]}' was not declared in this scope. Check the spelling, or declare it first.`;
  if ((m = msg.match(/^(\w+) is not a function/))) return `'${m[1]}' isn't a function the simulator knows.`;
  if (/Unexpected token|missing|Unexpected end|Invalid or unexpected/.test(msg)) return `Syntax error: ${msg}. Check for a missing ; ( ) or { }.`;
  return msg;
}
