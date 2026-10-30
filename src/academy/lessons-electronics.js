// Module 1: electronics fundamentals. Voltage, current and resistance; the
// LED and the resistor colour code; the breadboard.
import * as THREE from "three";
import { tween, ease } from "./anim.js?v=18";
import { battery9v, resistor, led, breadboard, wirePath, roundedPath, jumperWire, pinWorld, resistorBands, formatOhms, BAND_NAMES, LED_COLORS, WIRE_COLORS } from "./parts.js?v=18";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
const E12_STEPS = [100, 150, 220, 330, 470, 680, 1000, 1500, 2200];
const mA = (amps) => `${(amps * 1000).toFixed(amps < 0.01 ? 2 : 1)} mA`;

// The next standard (E12) resistor value at or above `ohms`.
export function nextE12(ohms) {
  for (let decade = 1; decade < 1e7; decade *= 10) for (const v of E12) if (v * decade >= ohms - 1e-9) return v * decade;
  return ohms;
}

// A puff of smoke rising from a point (for parts that are pushed too far).
export function smoke(ctx, at, { count = 14, color = "#8c8c8c" } = {}) {
  for (let i = 0; i < count; i++) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctx.parts.glowTexture(), color, transparent: true, opacity: 0.7, depthWrite: false }));
    puff.position.copy(at);
    puff.scale.setScalar(0.4);
    puff.userData.noPick = true;
    ctx.stage.root.add(puff);
    const delay = i * 60;
    const drift = V((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3);
    tween(puff.position, { x: at.x + drift.x, y: at.y + drift.y, z: at.z + drift.z }, { ms: 2200, delay, curve: ease.out });
    tween(puff.scale, { x: 3, y: 3 }, { ms: 2200, delay, curve: ease.out });
    tween(puff.material, { opacity: 0 }, { ms: 2200, delay, curve: ease.in }).then(() => { puff.parent?.remove(puff); puff.material.dispose(); });
  }
}

// ---- Lesson 1: Voltage, current and resistance ----------------------------------

const ohm = {
  id: "ohm",
  title: "Voltage, current and resistance",
  summary: "What makes electricity flow, and the one law that predicts it.",
  minutes: 6,
  setup(ctx) {
    const bat = ctx.place(battery9v(), [-7, 0, 0]);
    const res = ctx.place(resistor(470, { span: 6 * 0.254, legDown: 1.0 }), [1, 1.6, -3.5]);
    const light = ctx.place(led("red"), [6, 1.5, 0], [0, -Math.PI / 2, 0]);
    const p = (part, pin) => pinWorld(part, pin);
    const bp = p(bat, "+"), bm = p(bat, "-"), r1 = p(res, "1"), r2 = p(res, "2"), la = p(light, "A"), lk = p(light, "K");
    const y = 0.1;
    const w1 = [bp, V(-3, bp.y, bp.z), V(-3, y, bp.z), V(-3, y, r1.z), V(r1.x, y, r1.z), r1];
    const w2 = [r2, V(r2.x, y, r2.z), V(la.x, y, r2.z), V(la.x, y, la.z), la];
    const w3 = [lk, V(lk.x, y, lk.z), V(lk.x, y, 3.5), V(-3, y, 3.5), V(-3, y, bm.z), V(-3, bm.y, bm.z), bm];
    const wires = [wirePath(w1, WIRE_COLORS.red), wirePath(w2, WIRE_COLORS.orange), wirePath(w3, WIRE_COLORS.black)];
    wires.forEach((w, i) => ctx.add(w, { delay: 400 + i * 120 }));
    ctx.add(bat);
    ctx.add(res, { delay: 150 });
    ctx.add(light, { delay: 300 });
    // The whole loop, through the parts and back through the battery, for
    // the moving charges.
    const loop = roundedPath([
      ...w1,
      V(r1.x, 1.9, r1.z), V(r2.x, 1.9, r2.z),
      ...w2,
      V(la.x, 1.8, la.z), V(la.x, 2.05, 0), V(lk.x, 1.8, lk.z),
      ...w3,
      V(-4.8, bm.y, bm.z), V(-4.8, bp.y, bp.z), bp,
    ], 0.3);
    const charges = ctx.flow(loop, { count: 90, radius: 0.1 });
    const s = { bat, res, light, wires, charges, R: 470, bypass: false, burnt: false, electrons: false, bypassWire: null };
    ctx.frame(() => {
      const r = s.bypass ? 1.5 : s.R; // with no resistor only the battery's own ~1.5 Ω limits it
      const I = s.burnt ? 0 : Math.max(0, (9 - 2) / r);
      s.I = I;
      light.userData.setBrightness(s.burnt ? 0 : I / 0.02);
      charges.setRate(Math.min(I * 4, 1.2));
      charges.dir(s.electrons ? -1 : 1);
      charges.color(s.electrons ? "#7fd8ff" : "#ffe27a");
      // A resistor that has to turn more than ¼ W into heat starts glowing.
      const P = s.bypass ? 0 : I * I * s.R;
      s.P = P;
      res.userData.bodyMat.emissive.set("#ff4a1a");
      res.userData.bodyMat.emissiveIntensity = Math.max(0, Math.min((P - 0.25) * 3, 1.2));
    });
    return s;
  },
  steps: [
    {
      title: "A circuit is a loop",
      text: `<p>Electricity only flows when there is a <b>complete loop</b>: out of the battery's <b>+</b>, through the parts, and back into its <b>−</b>.</p>
        <p>This one has a 9 V battery, a 470 Ω resistor and a red LED. Watch the charges (the yellow dots) move round it. Break the loop anywhere and they all stop at once.</p>
        <p class="tip">Pinch (or click) any part to read about it. Pinch empty space and move to turn the view; pinch with both hands to zoom.</p>`,
      camera: { target: [0, 0, 0], theta: 0.35, phi: 0.9, radius: 32 },
      enter(ctx, s) {
        Object.assign(s, { R: 470, bypass: false, burnt: false, electrons: false });
        ctx.label(s.bat, "Battery: the push", { offset: V(0, 1.8, 0), dx: -40, dy: -50 });
        ctx.label(s.res, "Resistor: limits the flow", { offset: V(0, 0.45, 0), dx: -30, dy: -60 });
        ctx.label(s.light, "LED: turns current into light", { offset: V(0, 0.8, 0), dx: 40, dy: -50 });
        ctx.label(s.wires[2], "Wire: the path back", { offset: V(1.5, 0.1, 3.5), dx: 40, dy: 40 });
      },
    },
    {
      title: "Voltage: the push",
      text: `<p><b>Voltage</b>, measured in <b>volts (V)</b>, is the electrical pressure between two points. A 9 V battery keeps its + terminal 9 V above its −.</p>
        <p>Think of water: voltage is how high the tank is. The higher it is, the harder the water pushes through the pipes.</p>
        <p>Every part along the loop uses up some of the voltage. The LED always takes about <b>2 V</b>; the resistor takes the remaining <b>7 V</b>. Back at the − terminal it's <b>0 V</b>.</p>`,
      camera: { target: [-1, 0, 0], theta: -0.25, phi: 0.75, radius: 30 },
      enter(ctx, s) {
        ctx.focus(s.bat);
        const r1 = pinWorld(s.res, "1"), r2 = pinWorld(s.res, "2"), lk = pinWorld(s.light, "K");
        ctx.label(pinWorld(s.bat, "+"), "<b class='v9'>9 V</b>", { dx: -20, dy: -46 });
        ctx.label(r1, "<b class='v9'>9 V</b> before the resistor", { dx: -40, dy: -40 });
        ctx.label(r2, "<b class='v2'>2 V</b> after it: 7 V used", { dx: 40, dy: -50 });
        ctx.label(lk, "<b class='v0'>0 V</b> after the LED", { dx: 40, dy: 40 });
        ctx.label(pinWorld(s.bat, "-"), "<b class='v0'>0 V</b>", { dx: -30, dy: 40 });
      },
    },
    {
      title: "Current: the flow",
      text: `<p><b>Current</b>, measured in <b>amps (A)</b>, is how much charge flows past a point each second. One amp is about 6 billion billion electrons a second.</p>
        <p>The current is the same everywhere in a single loop: the charges can't pile up or vanish. Here it's about <b>15 mA</b> (milliamps, thousandths of an amp), the comfortable range for an LED.</p>
        <p>By old convention current flows from + to −. The electrons themselves actually drift the other way.</p>`,
      camera: { target: [0, 0, 0], theta: 0.9, phi: 0.95, radius: 26 },
      enter(ctx, s) {
        ctx.focus(s.wires);
        const out = ctx.readout();
        ctx.buttons([
          { label: "Conventional current (+ to −)", active: !s.electrons, onClick: () => { s.electrons = false; } },
          { label: "Electrons (− to +)", active: s.electrons, onClick: () => { s.electrons = true; } },
        ], { toggle: true });
        ctx.stepFrame(() => out.set(`Current: <b>${mA(s.I)}</b> everywhere in the loop`));
      },
    },
    {
      title: "Resistance: the narrow pipe",
      text: `<p><b>Resistance</b>, measured in <b>ohms (Ω)</b>, is how hard a part makes it for current to pass. A resistor is a deliberately narrow pipe.</p>
        <p>Drag the slider. More resistance means less current: the charges slow down and the LED dims. Less resistance means more current and a brighter LED, up to a point.</p>
        <p>Watch the coloured bands: they change to spell out the value.</p>`,
      camera: { target: [1.5, 1, -2], theta: 0.15, phi: 0.85, radius: 15 },
      enter(ctx, s) {
        ctx.focus(s.res);
        s.bypass = false; s.burnt = false;
        const out = ctx.readout();
        ctx.slider({
          label: "Resistance", min: 0, max: E12_STEPS.length - 1, value: E12_STEPS.indexOf(s.R) >= 0 ? E12_STEPS.indexOf(s.R) : 4,
          format: (i) => formatOhms(E12_STEPS[i]),
          onInput: (i) => { s.R = E12_STEPS[i]; s.res.userData.setOhms(s.R); },
        });
        ctx.stepFrame(() => {
          const warn = s.I > 0.02 ? ` <span class="warn">over the LED's 20 mA limit: it won't last long</span>` : "";
          out.set(`Current: <b>${mA(s.I)}</b>${warn}`);
        });
      },
    },
    {
      title: "Ohm's law: V = I × R",
      text: `<p>The three are tied together by <b>Ohm's law</b>: <b class="formula">V = I × R</b>. Voltage equals current times resistance.</p>
        <p>Turn it round to find the current: <b class="formula">I = V ÷ R</b>. Here 7 V across 470 Ω gives 7 ÷ 470 = <b>0.0149 A</b>, or 14.9 mA.</p>
        <p>The resistor turns that energy into heat: <b class="formula">P = V × I</b>. A normal resistor can take <b>¼ W</b>. Try 100 Ω and watch it start to glow.</p>`,
      camera: { target: [1.5, 1, -2], theta: -0.4, phi: 0.8, radius: 17 },
      enter(ctx, s) {
        ctx.focus(s.res);
        s.bypass = false; s.burnt = false;
        const out = ctx.readout();
        ctx.slider({
          label: "Resistance", min: 0, max: E12_STEPS.length - 1, value: Math.max(E12_STEPS.indexOf(s.R), 0),
          format: (i) => formatOhms(E12_STEPS[i]),
          onInput: (i) => { s.R = E12_STEPS[i]; s.res.userData.setOhms(s.R); },
        });
        ctx.stepFrame(() => {
          const P = s.P ?? 0;
          out.set(`<table class="ac-table">
            <tr><td>Voltage across the resistor</td><td><b>7.0 V</b></td></tr>
            <tr><td>Resistance</td><td><b>${formatOhms(s.R)}</b></td></tr>
            <tr><td>Current, I = V ÷ R</td><td><b>${mA(s.I)}</b></td></tr>
            <tr><td>Heat in the resistor, P = V × I</td><td><b class="${P > 0.25 ? "warn" : ""}">${(P * 1000).toFixed(0)} mW</b>${P > 0.25 ? " (too hot!)" : ""}</td></tr>
          </table>`);
        });
      },
    },
    {
      title: "Why the resistor matters",
      text: `<p>An LED has almost no resistance of its own once it lights. Without a resistor, the only thing limiting the current is the battery's small internal resistance.</p>
        <p>Press <b>Remove the resistor</b> to see what happens. (In real life too: it's the classic first mistake.)</p>
        <p>Rule: <b>every LED needs a resistor in series</b>.</p>`,
      camera: { target: [4, 1, -1.5], theta: 0.5, phi: 0.85, radius: 18 },
      enter(ctx, s) {
        ctx.focus(s.light);
        s.R = 470; s.res.userData.setOhms(470);
        const out = ctx.readout("");
        const restore = () => {
          s.bypass = false; s.burnt = false;
          s.res.visible = true;
          tween(s.res.position, { y: 1.6 }, { ms: 600 });
          if (s.bypassWire) { ctx.remove(s.bypassWire); s.bypassWire = null; }
          s.light.traverse((m) => { if (m.material?.color && m.userData.burnColor) { m.material.color.copy(m.userData.burnColor); delete m.userData.burnColor; } });
          out.set("");
        };
        restore();
        const alive = ctx.alive();
        ctx.buttons([
          { label: "Remove the resistor", cls: "danger", onClick: async () => {
            if (s.bypass) return;
            await tween(s.res.position, { y: 7 }, { ms: 700, curve: ease.inOut });
            if (!alive()) return;
            s.res.visible = false;
            const r1 = pinWorld(s.res, "1").setY(0.6), r2 = pinWorld(s.res, "2").setY(0.6);
            s.bypassWire = ctx.add(wirePath([r1, V(r1.x, 1.0, r1.z), V(r2.x, 1.0, r2.z), r2], WIRE_COLORS.yellow), { drop: false });
            s.bypass = true;
            out.set(`Current: about <b class="warn">4.7 A</b>, 235 times the LED's limit…`);
            await ctx.wait(700);
            if (!alive()) return;
            s.burnt = true;
            smoke(ctx, ctx.world(s.light, [0, 0.8, 0]));
            s.light.traverse((m) => { if (m.isMesh && m.material?.color && !m.material.userData.shared) { m.userData.burnColor = m.material.color.clone(); m.material.color.set("#2a1410"); } });
            out.set(`<span class="warn">Pop. The LED's chip overheated in a fraction of a second.</span> It's dead for good.`);
          } },
          { label: "Put it back (new LED)", onClick: restore },
        ]);
      },
    },
  ],
};

// ---- Lesson 2: The LED and the resistor colour code --------------------------------

const ledLesson = {
  id: "led",
  title: "LEDs and resistor codes",
  summary: "Inside an LED, reading resistor bands, and picking the right resistor.",
  minutes: 5,
  setup(ctx) {
    const s = { color: "red" };
    s.makeLed = (color) => {
      if (s.led) ctx.remove(s.led);
      s.color = color;
      s.led = ctx.add(led(color, { legs: 2.2 }), { at: [-3, 0, 0], drop: false });
      s.led.scale.setScalar(4);
      s.led.position.y = 8.8;
      s.led.userData.setBrightness(0.5);
      return s.led;
    };
    s.makeLed("red");
    s.led.scale.setScalar(0.001);
    tween(s.led.scale, { x: 4, y: 4, z: 4 }, { ms: 700, curve: ease.back });
    s.res = resistor(220, { span: 1.6, legDown: 0.5 });
    s.res.scale.setScalar(5);
    ctx.add(s.res, { at: [6, 3, 0], delay: 200 });
    return s;
  },
  steps: [
    {
      title: "Inside an LED",
      text: `<p>This is a 5 mm LED, shown four times its real size. Look through the clear epoxy:</p>
        <ul><li>The <b>anvil</b>, the big piece, holds the tiny light-emitting chip. It's on the <b>cathode (−)</b> side.</li>
        <li>The thin <b>post</b> is the <b>anode (+)</b>. A hair-thin gold wire joins it to the chip.</li>
        <li>The <b>long leg</b> is the anode, the short one the cathode, and the rim is <b>flat</b> on the cathode side.</li></ul>
        <p>An LED is a diode: current only flows from anode to cathode. Put it in backwards and it simply stays dark.</p>`,
      camera: { target: [-3, 6.5, 0], theta: 0.6, phi: 1.25, radius: 30 },
      enter(ctx, s) {
        s.res.visible = false;
        if (s.color !== "red") s.makeLed("red");
        s.led.userData.setBrightness(0.35);
        ctx.focus(s.led);
        const L = s.led;
        ctx.label(L, "Anvil (cathode side)", { offset: V(0.12, 0.42, 0), dx: 60, dy: -30 });
        ctx.label(L, "Post (anode side)", { offset: V(-0.12, 0.42, 0), dx: -60, dy: -30 });
        ctx.label(L, "Light-emitting chip", { offset: V(0.1, 0.53, 0), dx: 70, dy: -70 });
        ctx.label(L, "Long leg: anode +", { offset: V(-0.127, -1.5, 0), dx: -60, dy: 10 });
        ctx.label(L, "Short leg: cathode −", { offset: V(0.127, -1.3, 0), dx: 60, dy: 10 });
        ctx.label(L, "Flat rim = cathode", { offset: V(0.29, 0.16, 0), dx: 70, dy: 30 });
      },
    },
    {
      title: "Colour sets the voltage",
      text: `<p>Each colour comes from a different semiconductor, and each needs a different <b>forward voltage</b> (V<sub>f</sub>) before it lights.</p>
        <p>Red and yellow need about 2 V. Green, blue and white need about 3 V, because their light carries more energy per photon.</p>
        <p>Pick a colour:</p>`,
      camera: { target: [-3, 6.5, 0], theta: 0.3, phi: 1.2, radius: 32 },
      enter(ctx, s) {
        s.res.visible = false;
        const out = ctx.readout();
        const show = (c) => {
          s.makeLed(c);
          s.led.userData.setBrightness(1);
          ctx.focus(s.led);
          const d = LED_COLORS[c];
          out.set(`<b>${c[0].toUpperCase() + c.slice(1)}</b>: forward voltage about <b>${d.vf} V</b>${d.nm ? `, light at <b>${d.nm} nm</b>` : ", a blue chip under a yellow phosphor"}.`);
        };
        ctx.buttons(Object.keys(LED_COLORS).map((c) => ({ label: `<i class="dot" style="background:${LED_COLORS[c].hex}"></i>${c}`, active: c === s.color, onClick: () => show(c) })), { toggle: true });
        show(s.color);
      },
    },
    {
      title: "Reading resistor bands",
      text: `<p>Resistors are too small to print numbers on, so their value is painted as <b>colour bands</b>. Read them from the end without the gold band:</p>
        <ul><li>Bands 1 and 2: <b>digits</b>.</li><li>Band 3: the <b>multiplier</b>, how many zeros to add.</li><li>Gold: <b>±5 %</b> tolerance.</li></ul>
        <p class="code-line">black 0 · brown 1 · red 2 · orange 3 · yellow 4 · green 5 · blue 6 · violet 7 · grey 8 · white 9</p>
        <p>A memory trick: <i>"Bad Beer Rots Our Young Guts, But Vodka Goes Well."</i></p>`,
      camera: { target: [6, 3.5, 0], theta: 0, phi: 1.2, radius: 24 },
      enter(ctx, s) {
        s.res.visible = true;
        ctx.focus(s.res);
        const out = ctx.readout();
        const values = [10, 47, 100, 220, 330, 470, 1000, 2200, 4700, 10000, 47000, 100000];
        ctx.slider({
          label: "Value", min: 0, max: values.length - 1, value: values.indexOf(s.res.userData.ohms) >= 0 ? values.indexOf(s.res.userData.ohms) : 3,
          format: (i) => formatOhms(values[i]),
          onInput: (i) => {
            const o = values[i];
            s.res.userData.setOhms(o);
            const [a, b, m] = resistorBands(o);
            const sw = (n) => `<i class="band" style="background:${["#111", "#8b4513", "#e02020", "#ff8c1a", "#f5d90a", "#1fa83a", "#2050e0", "#8a2be2", "#8f8f8f", "#f5f5f5"][n]}"></i>${BAND_NAMES[n]}`;
            out.set(`${sw(a)} ${sw(b)} ${sw(m)} <i class="band" style="background:#c8a24a"></i>gold<br><b>${a}${b}</b> × 10<sup>${m}</sup> = <b>${formatOhms(o)}</b> ±5 %`);
          },
        });
      },
    },
    {
      title: "Picking the right resistor",
      text: `<p>To light an LED safely, pick the resistor that sets the current you want:</p>
        <p class="formula">R = (V<sub>supply</sub> − V<sub>f</sub>) ÷ I</p>
        <p>Then round <b>up</b> to the next standard value, so the current comes out a little lower, never higher. 15 to 20 mA is bright; 5 to 10 mA is plenty indoors.</p>`,
      camera: { target: [1.5, 5, 0], theta: 0.15, phi: 1.2, radius: 40 },
      enter(ctx, s) {
        s.res.visible = true;
        const st = { vs: 5, color: s.color, I: 0.015 };
        const out = ctx.readout();
        const update = () => {
          if (s.color !== st.color) s.makeLed(st.color);
          const vf = LED_COLORS[st.color].vf;
          if (st.vs <= vf) {
            s.led.userData.setBrightness(0);
            out.set(`<span class="warn">${st.vs} V is not enough to light a ${st.color} LED (it needs about ${vf} V).</span>`);
            return;
          }
          const exact = (st.vs - vf) / st.I;
          const std = nextE12(exact);
          const real = (st.vs - vf) / std;
          s.res.userData.setOhms(std);
          s.led.userData.setBrightness(real / 0.02);
          out.set(`R = (${st.vs} − ${vf}) ÷ ${st.I} = <b>${exact.toFixed(0)} Ω</b><br>Next standard value up: <b>${formatOhms(std)}</b>, giving <b>${mA(real)}</b>`);
        };
        ctx.buttons([3.3, 5, 9].map((v) => ({ label: `${v} V supply`, active: v === st.vs, onClick: () => { st.vs = v; update(); } })), { toggle: true });
        ctx.buttons(Object.keys(LED_COLORS).map((c) => ({ label: `<i class="dot" style="background:${LED_COLORS[c].hex}"></i>${c}`, active: c === st.color, onClick: () => { st.color = c; update(); } })), { toggle: true });
        ctx.buttons([0.005, 0.01, 0.015, 0.02].map((i) => ({ label: `${i * 1000} mA`, active: i === st.I, onClick: () => { st.I = i; update(); } })), { toggle: true });
        update();
      },
    },
  ],
};

// ---- Lesson 3: The breadboard ------------------------------------------------------

const breadboardLesson = {
  id: "breadboard",
  title: "The breadboard",
  summary: "How the holes are joined inside, and how to build a circuit on one.",
  minutes: 5,
  setup(ctx) {
    const bb = ctx.add(breadboard(), { at: [0, 0, 0] });
    return { bb, built: [] };
  },
  steps: [
    {
      title: "A board full of holes",
      text: `<p>A <b>breadboard</b> lets you build circuits by pushing legs and wires into holes, with no soldering. This half-size board has 400 holes, 2.54 mm (0.1 inch) apart, the same spacing as chip pins.</p>
        <ul><li><b>Columns 1 to 30</b>, each with rows <b>a–e</b> and <b>f–j</b>.</li>
        <li>A <b>channel</b> down the middle.</li>
        <li><b>Power rails</b> along both edges, marked red <b>+</b> and blue <b>−</b>.</li></ul>`,
      camera: { target: [0, 0, 0.5], theta: 0, phi: 0.65, radius: 14 },
      enter(ctx, s) {
        s.bb.userData.setSeeThrough(1);
        s.bb.userData.lightClip(null);
        const h = s.bb.userData.hole;
        ctx.label(s.bb, "Rows a–e", { offset: h(0, "c"), dx: -50, dy: 0 });
        ctx.label(s.bb, "Rows f–j", { offset: h(0, "h"), dx: -50, dy: 0 });
        ctx.label(s.bb, "Centre channel", { offset: V(1.5, 0.85, 0), dx: 70, dy: -10 });
        ctx.label(s.bb, "+ and − rails", { offset: V(3.5, 0.85, -2.2), dx: 50, dy: -40 });
        ctx.label(s.bb, "Column 1", { offset: h(0, "a"), dx: -10, dy: -55 });
      },
    },
    {
      title: "What's inside",
      text: `<p>Under the plastic, <b>metal clips</b> grip whatever you push in. Each clip joins <b>five holes in a column</b>: a to e, or f to j.</p>
        <p>The channel splits each column in two, so a chip can sit across it with every pin on its own clip.</p>
        <p>Anything in the same group of five is connected. Holes in different groups are not.</p>`,
      camera: { target: [0, 0, 0], theta: 0.5, phi: 0.75, radius: 13 },
      enter(ctx, s) {
        const o = { k: s.bb.userData.seeThrough };
        tween(o, { k: 0.12 }, { ms: 1200, onUpdate: () => s.bb.userData.setSeeThrough(o.k) });
        const clips = s.bb.userData.clips;
        let i = 0;
        ctx.stepFrame((dt, t) => {
          // A wave of light runs across the columns.
          const col = Math.floor(t * 8) % 30;
          if (col !== i) { i = col; s.bb.userData.lightClip(clips[col * 2 + (Math.floor(t * 8 / 30) % 2)]); }
        });
        ctx.label(s.bb, "Each clip joins 5 holes", { offset: s.bb.userData.hole(20, "c"), dx: 60, dy: -60 });
      },
    },
    {
      title: "The power rails",
      text: `<p>The long clips along the edges are the <b>power rails</b>. Each runs the full length of the board, so any part can reach + or − nearby.</p>
        <p>Connect your supply's + to the red rail and − (ground, GND) to the blue rail, then jump to them wherever you need.</p>
        <p class="tip">On some full-size boards the rails are split halfway along. Check with a meter, or bridge them with a wire.</p>`,
      camera: { target: [0, 0, -1.5], theta: -0.5, phi: 0.7, radius: 13 },
      enter(ctx, s) {
        s.bb.userData.setSeeThrough(0.18);
        const rails = s.bb.userData.clips.slice(60);
        ctx.stepFrame((dt, t) => {
          const k = 0.5 + 0.4 * Math.sin(t * 4);
          rails.forEach((c) => { c.material.emissiveIntensity = k; });
          s.bb.userData.clips.slice(0, 60).forEach((c) => { c.material.emissiveIntensity = 0; });
        });
      },
    },
    {
      title: "Try it: find the connections",
      text: `<p>Your turn. <b>Pinch any hole</b> (or click it) and the clip under it lights up, showing every hole it's joined to.</p>
        <p>Check yourself: is <b>a5</b> joined to <b>e5</b>? To <b>f5</b>? To <b>a6</b>?</p>`,
      camera: { target: [0, 0, 0], theta: 0.2, phi: 0.6, radius: 15 },
      enter(ctx, s) {
        s.bb.userData.setSeeThrough(0.55);
        s.bb.userData.lightClip(null);
        const out = ctx.readout("Pinch a hole…");
        ctx.onGrab((hit) => {
          let o = hit.object;
          while (o && o !== s.bb) o = o.parent;
          if (!o) return null;
          const local = s.bb.worldToLocal(hit.point.clone());
          const found = s.bb.userData.clipAt(local.x, local.z);
          s.bb.userData.lightClip(found?.clip ?? null);
          out.set(found ? `Joined: <b>${found.name}</b>` : "That's the centre channel: nothing connects across it.");
          return { end() {} };
        });
      },
    },
    {
      title: "Build: an LED circuit",
      text: `<p>Here's the circuit from the first lesson, built the proper way:</p>
        <ol><li>Battery + to the red rail, − to the blue rail.</li>
        <li>A red wire from the + rail to <b>a8</b>.</li>
        <li>A 470 Ω resistor from <b>b8</b> to <b>b12</b>.</li>
        <li>The LED's long leg in <b>c12</b>, short leg in <b>c13</b>.</li>
        <li>A black wire from <b>a13</b> back to the − rail.</li></ol>
        <p>Each step uses the clips: b8 is joined to a8, b12 to c12, and c13 to a13.</p>`,
      camera: { target: [-2, 0, -1.5], theta: 0.45, phi: 0.75, radius: 22 },
      async enter(ctx, s) {
        for (const p of s.built) ctx.remove(p);
        s.built = [];
        s.bb.userData.setSeeThrough(0.85);
        s.bb.userData.lightClip(null);
        const alive = ctx.alive();
        const hole = (c, r) => s.bb.localToWorld(s.bb.userData.hole(c - 1, r));
        const rail = (i, w) => s.bb.localToWorld(s.bb.userData.rail(i, w));
        const add = (obj, at = null) => { s.built.push(ctx.add(obj, { at })); return obj; };
        const bat = add(ctx.place(battery9v(), [-9, 0, -5.5], [0, -Math.PI / 2, 0]));
        await ctx.wait(500); if (!alive()) return;
        const bp = pinWorld(bat, "+"), bm = pinWorld(bat, "-");
        add(jumperWire(bp, rail(0, "top+"), WIRE_COLORS.red, { lift: 1.5 }));
        add(jumperWire(bm, rail(1, "top-"), WIRE_COLORS.black, { lift: 1.5 }));
        await ctx.wait(500); if (!alive()) return;
        add(jumperWire(rail(6, "top+"), hole(8, "a"), WIRE_COLORS.red, { lift: 0.6 }));
        await ctx.wait(500); if (!alive()) return;
        const a = hole(8, "b"), b = hole(12, "b");
        const r = resistor(470, { span: a.distanceTo(b), legDown: 0.9 });
        add(r, [(a.x + b.x) / 2, 0.85 - 0.6 + 0.9, a.z]);
        await ctx.wait(500); if (!alive()) return;
        const la = hole(12, "c"), lk = hole(13, "c");
        const l = led("red");
        add(l, [(la.x + lk.x) / 2, 0.85 - 0.6 + 1.4, la.z]);
        await ctx.wait(500); if (!alive()) return;
        add(jumperWire(hole(13, "a"), rail(10, "top-"), WIRE_COLORS.black, { lift: 0.6 }));
        await ctx.wait(800); if (!alive()) return;
        l.userData.setBrightness(0.75);
        ctx.label(l, "It lights: about 15 mA", { offset: V(0, 0.8, 0), dx: 50, dy: -50 });
      },
    },
  ],
};

export const ELECTRONICS = { id: "electronics", title: "Electronics fundamentals", lessons: [ohm, ledLesson, breadboardLesson] };
