// "My kit": one short lesson for every part of Mustafa's own Arduino kit (the
// "RFID UNO Kit" with a CH340 Uno). Each lesson wires the part up in 3D, then
// runs two or three small programs that build on each other: make it do one
// thing once, then repeat it in a loop, then make it react to something. Every
// program runs in the simulator against the circuit as wired, and can be
// copied into the Arduino IDE for the real board.
import { KINDS } from "./project-parts.js?v=20";

const BOARD_PINS = new Set(["5V", "3V3", "GND", "VIN", ...Array.from({ length: 14 }, (_, i) => `D${i}`), ...Array.from({ length: 6 }, (_, i) => `A${i}`)]);

// ---- The lessons ---------------------------------------------------------------------
// parts: [id, type, label, value, why, start?]
// build: [{ title, text, parts: [ids], wires: [[from, to, color, why]] }]
// stages: [{ title, text, code, hl: [text on the lines to highlight], try }]

const LESSONS = [];
const L = (def) => LESSONS.push(def);

// ---- Start ---------------------------------------------------------------------------------

L({
  id: "start", group: 0, emoji: "🔌", title: "Your Uno and the Arduino IDE", minutes: 5, say: "start|uno|board|setup",
  summary: "Plug in the CH340 Uno, upload your first sketch, and see setup() and loop() at work.",
  intro: "Your kit's brain is an **Arduino Uno** made with a **CH340** USB chip. A program for it is called a **sketch**. Every sketch has two parts: **setup()** runs once when the board starts, and **loop()** runs again and again, forever. You'll see both with the little orange **L** LED on the board, which is wired to pin **13**.\n\nThe kit also has the 50 cm USB cable, the 830-hole breadboard, jumper wires (male–male and male–female), a strip of pin headers, button caps and a card that decodes resistor colours. They turn up in the lessons as you need them.",
  parts: [],
  build: [{ title: "Plug it in", text: "Connect the Uno to your Mac with the kit's USB cable. The green **ON** LED lights. Nothing else to wire for this lesson: the **L** LED is already on the board, joined to pin 13.", parts: [], wires: [] }],
  stages: [
    {
      title: "1 · Light it once",
      text: "**setup()** runs one time. `pinMode(13, OUTPUT)` makes pin 13 an output. `digitalWrite(13, HIGH)` puts 5 V on it and the LED lights. After 2 seconds, `LOW` turns it off. **loop()** is empty, so nothing more happens.",
      code: `// Runs once: turn the L LED on for 2 seconds.
void setup() {
  pinMode(13, OUTPUT);     // pin 13 is an output
  digitalWrite(13, HIGH);  // 5 V: LED on
  delay(2000);             // wait 2000 ms = 2 s
  digitalWrite(13, LOW);   // 0 V: LED off
}

void loop() {
  // nothing here yet
}`,
      hl: ["pinMode(13", "HIGH);", "delay(2000)", "LOW);"],
      try: "the L LED on the board lights for 2 seconds, once",
    },
    {
      title: "2 · Blink forever",
      text: "Move the on/off lines into **loop()** and they repeat forever: that's **Blink**, the \"hello world\" of Arduino. A **const int** gives the pin a name, so you only change it in one place.",
      code: `// Blink: on, off, on, off… forever.
const int LED = 13;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
}`,
      hl: ["const int LED", "void loop", "delay(500)"],
      try: "the L LED blinks once a second",
    },
    {
      title: "3 · Talk to the Mac",
      text: "**Serial** sends text over the USB cable. `Serial.begin(9600)` starts it, `Serial.println()` sends a line. In the Arduino IDE open **Tools → Serial Monitor** (9600 baud) to read it. A variable, **count**, remembers a number between passes of loop().",
      code: `// Count the blinks and report them.
const int LED = 13;
int count = 0;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Hello from my Uno!");
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(300);
  digitalWrite(LED, LOW);
  delay(700);
  count = count + 1;
  Serial.print("Blinks: ");
  Serial.println(count);
}`,
      hl: ["Serial.begin", "Serial.println(\"Hello", "count = count + 1", "Serial.println(count)"],
      try: "the Serial monitor under the code counts the blinks",
    },
  ],
  tips: [
    "The kit's **9 V battery clip** ends in a round plug that fits the Uno's black power jack. Once a sketch is uploaded, unplug USB and plug the battery in: the board keeps running on its own.",
    "The sketch stays in the Uno's memory when it's unplugged and starts again at power-up.",
  ],
});

// ---- Motors -----------------------------------------------------------------------------

L({
  id: "servo", focus: "SV", group: 1, emoji: "🦾", title: "Servo motor (9g)", minutes: 6, say: "servo",
  summary: "Turn it to an angle once, sweep it back and forth, then steer it with a knob.",
  intro: "The **9g servo** is a small motor with gears and a position sensor inside. You don't tell it to spin: you tell it an **angle from 0° to 180°**, and it turns there and holds. The **Servo** library (built into the Arduino IDE) makes the control signal for you.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", "Its rails share 5 V and GND between the servo and the knob."],
    ["SV", "servo", "9g servo", "", "Turns its white arm (the horn) to the angle you send it."],
    ["POT", "potentiometer", "10K potentiometer", "10k", "A knob for part 3: its middle leg gives 0 to 5 V."],
  ],
  build: [
    {
      title: "Wire the servo",
      text: "First the breadboard rails: **5V → +** and **GND → −**. The servo has three wires: **brown** is GND, **red** is +5 V and **orange** is the signal. With male–male jumpers in its plug: brown to the **−** rail, red to the **+** rail, orange to pin **9**.",
      parts: ["BB", "SV"],
      wires: [["BOARD.5V", "BB.+", "red", "5 V for the + rail."], ["BOARD.GND", "BB.-", "black", "Ground for the − rail."], ["SV.GND", "BB.-", "brown", "Ground for the motor."], ["SV.V+", "BB.+", "red", "Power for the motor."], ["BOARD.D9", "SV.SIG", "orange", "Pin 9 sends the angle as a pulse."]],
    },
    {
      title: "Add the knob (for part 3)",
      text: "The potentiometer's outer legs go to the **−** and **+** rails, its **middle leg** to **A0**.",
      parts: ["POT"],
      wires: [["POT.1", "BB.-", "black", "One end of the track at 0 V."], ["POT.2", "BB.+", "red", "The other end at 5 V."], ["POT.W", "BOARD.A0", "green", "The wiper: any voltage in between, read on A0."]],
    },
  ],
  stages: [
    {
      title: "1 · Move it once",
      text: "`Servo arm;` makes a servo object, `arm.attach(9)` connects it to pin 9. Then `arm.write(0)`, wait, `arm.write(180)`, wait, `arm.write(90)`: it swings to one end, the other, and stops in the middle. It all happens in **setup()**, so just once.",
      code: `#include <Servo.h>
Servo arm;

void setup() {
  arm.attach(9);    // the signal wire is on pin 9
  arm.write(0);     // turn to 0 degrees
  delay(1000);
  arm.write(180);   // all the way to 180
  delay(1000);
  arm.write(90);    // and stop in the middle
}

void loop() {
}`,
      hl: ["Servo arm", "arm.attach(9)", "arm.write(0)", "arm.write(180)", "arm.write(90)"],
      try: "the horn swings 0° → 180° → 90°, once",
    },
    {
      title: "2 · Sweep with a loop",
      text: "A **for** loop counts: `for (int angle = 0; angle <= 180; angle++)` runs its block with angle = 0, 1, 2 … 180. Writing each angle with a short delay makes a smooth sweep. A second loop counts back down. Inside **loop()**, it never stops.",
      code: `#include <Servo.h>
Servo arm;

void setup() {
  arm.attach(9);
}

void loop() {
  for (int angle = 0; angle <= 180; angle++) {
    arm.write(angle);
    delay(10);
  }
  for (int angle = 180; angle >= 0; angle--) {
    arm.write(angle);
    delay(10);
  }
}`,
      hl: ["angle <= 180; angle++", "arm.write(angle)", "angle >= 0; angle--"],
      try: "the horn sweeps smoothly back and forth",
    },
    {
      title: "3 · Steer it with the knob",
      text: "`analogRead(A0)` measures the knob's voltage as a number from **0 to 1023**. `map()` rescales it to **0 to 180**, and the servo follows. Turn the knob slider on the left.",
      code: `#include <Servo.h>
Servo arm;

void setup() {
  arm.attach(9);
}

void loop() {
  int knob = analogRead(A0);              // 0 … 1023
  int angle = map(knob, 0, 1023, 0, 180); // → 0 … 180
  arm.write(angle);
  delay(15);
}`,
      hl: ["analogRead(A0)", "map(knob"],
      try: "drag the potentiometer slider and the servo follows",
    },
  ],
  tips: ["A servo pulling hard can reset the Uno. If it twitches or the board restarts, power the servo from a separate 5 V supply (with the GNDs joined)."],
});

L({
  id: "stepper", focus: "ST", group: 1, emoji: "⚙️", title: "Stepper motor + ULN2003", minutes: 7, say: "stepper",
  summary: "One full turn, back and forth in a loop, then a button that picks the direction.",
  intro: "The **28BYJ-48** is a **stepper motor**: it moves in tiny exact steps. **2048 steps = one full turn** of the shaft. Inside are four coils. Switching them on in turn pulls a magnet round, step by step. An Arduino pin can't power a coil, so the **ULN2003 board** does it: each **IN** pin switches one coil, and the four red LEDs (A to D) show which coils are on.",
  parts: [
    ["ST", "stepper", "Stepper motor + ULN2003", "", "Plug the motor's white cable into the driver board first."],
    ["BTN", "button", "Button", "", "For part 3: hold it to reverse."],
  ],
  build: [
    {
      title: "Wire the driver board",
      text: "Use male–female jumpers: **IN1 → 8**, **IN2 → 9**, **IN3 → 10**, **IN4 → 11**. Then the driver's **+** to **5V** and **−** to **GND**. The motor's power comes through the board, not the pins.",
      parts: ["ST"],
      wires: [["BOARD.D8", "ST.IN1", "orange", "Coil A."], ["BOARD.D9", "ST.IN2", "yellow", "Coil B."], ["BOARD.D10", "ST.IN3", "green", "Coil C."], ["BOARD.D11", "ST.IN4", "blue", "Coil D."], ["BOARD.5V", "ST.+", "red", "Power for the coils."], ["BOARD.GND", "ST.-", "black", "Ground."]],
    },
    {
      title: "A button (for part 3)",
      text: "One side of the button to pin **2**, the other to **GND**. Snap a coloured **button cap** on it if you like.",
      parts: ["BTN"],
      wires: [["BOARD.D2", "BTN.1", "white", "Pin 2 reads the button."], ["BTN.2", "BOARD.GND", "black", "Pressed, pin 2 is joined to GND."]],
    },
  ],
  stages: [
    {
      title: "1 · One full turn",
      text: "The **Stepper** library (built in) knows the coil order. `Stepper motor(2048, 8, 10, 9, 11)`: 2048 steps per turn, then the pins in the order **IN1, IN3, IN2, IN4** (that order is right for this motor). `setSpeed(10)` is 10 turns a minute, and `step(2048)` turns once. Watch the LEDs chase.",
      code: `#include <Stepper.h>
// 2048 steps per turn; pins in the order IN1, IN3, IN2, IN4
Stepper motor(2048, 8, 10, 9, 11);

void setup() {
  motor.setSpeed(10);   // 10 turns per minute
  motor.step(2048);     // one full turn
}

void loop() {
}`,
      hl: ["Stepper motor(2048", "setSpeed(10)", "motor.step(2048)"],
      try: "the orange pointer goes once round (about 6 s)",
    },
    {
      title: "2 · Back and forth",
      text: "In **loop()**: a quarter turn forward (`step(512)`), a pause, then a **negative** number to go back (`step(-512)`). The same idea opens and closes things: a blind, a door latch, a dial.",
      code: `#include <Stepper.h>
Stepper motor(2048, 8, 10, 9, 11);

void setup() {
  motor.setSpeed(12);
}

void loop() {
  motor.step(512);    // a quarter turn forward
  delay(500);
  motor.step(-512);   // and back
  delay(500);
}`,
      hl: ["step(512)", "step(-512)"],
      try: "the pointer swings a quarter turn and back, over and over",
    },
    {
      title: "3 · A button picks the direction",
      text: "`INPUT_PULLUP` holds pin 2 HIGH until the button joins it to GND, so **pressed reads LOW**. Each pass of loop() takes 32 steps: forward normally, backwards while the button is held. Press it with a pinch, a click, or key **1**.",
      code: `#include <Stepper.h>
Stepper motor(2048, 8, 10, 9, 11);
const int BUTTON = 2;

void setup() {
  motor.setSpeed(12);
  pinMode(BUTTON, INPUT_PULLUP);
}

void loop() {
  if (digitalRead(BUTTON) == LOW) {
    motor.step(-32);   // held: backwards
  } else {
    motor.step(32);    // released: forwards
  }
}`,
      hl: ["INPUT_PULLUP", "digitalRead(BUTTON) == LOW", "step(-32)", "step(32)"],
      try: "hold the button (or key 1) to reverse",
    },
  ],
  tips: ["Above about 15 turns per minute this motor misses steps and just buzzes: go slower.", "When it's stopped, the coils that are still on get warm. That's normal for a while."],
});

// ---- Lights and sound --------------------------------------------------------------------

L({
  id: "leds", group: 2, emoji: "🚦", title: "LEDs and resistors", minutes: 6, say: "led|leds|traffic",
  summary: "Light an LED, run a traffic light, and fade one smoothly with PWM.",
  intro: "An **LED** lights when current flows from its **long leg (+, anode)** to its **short leg (−, cathode)**. It must never connect straight to 5 V: a **220 Ω resistor** (red-red-brown bands) limits the current to a safe ~13 mA. On the **breadboard**, the 5 holes in each short column are joined inside, and the long **−** rail along the edge is one strip.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", "Its long − rail gives every LED a ground."],
    ["R1", "resistor", "220 Ω resistor", "220", "Limits the red LED's current."],
    ["LR", "led", "Red LED", "red", ""],
    ["R2", "resistor", "220 Ω resistor", "220", ""],
    ["LY", "led", "Yellow LED", "yellow", ""],
    ["R3", "resistor", "220 Ω resistor", "220", ""],
    ["LG", "led", "Green LED", "green", ""],
  ],
  build: [
    {
      title: "Ground rail and the red LED",
      text: "A black wire from **GND** to the breadboard's **−** rail. Then **pin 12 → 220 Ω → red LED long leg**, and the short leg to the **−** rail.",
      parts: ["BB", "R1", "LR"],
      wires: [["BOARD.GND", "BB.-", "black", "Ground for all three LEDs."], ["BOARD.D12", "R1.1", "red", "Pin 12 drives the red LED."], ["R1.2", "LR.A", "red", "Into the long leg."], ["LR.K", "BB.-", "black", "Short leg to ground."]],
    },
    {
      title: "Yellow and green",
      text: "The same again: **pin 11 → 220 Ω → yellow**, **pin 10 → 220 Ω → green**, short legs to **−**. Pins 10 and 11 have a **~** next to them on the board: they can dim (part 3).",
      parts: ["R2", "LY", "R3", "LG"],
      wires: [["BOARD.D11", "R2.1", "yellow", ""], ["R2.2", "LY.A", "yellow", ""], ["LY.K", "BB.-", "black", ""], ["BOARD.D10", "R3.1", "green", ""], ["R3.2", "LG.A", "green", ""], ["LG.K", "BB.-", "black", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Light one, once",
      text: "Pin 12 goes HIGH: current flows through the resistor and the red LED lights, and stays lit because nothing turns it off.",
      code: `const int RED = 12;

void setup() {
  pinMode(RED, OUTPUT);
  digitalWrite(RED, HIGH);  // on, and it stays on
}

void loop() {
}`,
      hl: ["digitalWrite(RED, HIGH)"],
      try: "the red LED lights",
    },
    {
      title: "2 · A traffic light",
      text: "Three outputs and a sequence in **loop()**: green 3 s, yellow 1 s, red 3 s, red + yellow 1 s, and round again. A helper function, `lights(r, y, g)`, sets all three in one line.",
      code: `const int RED = 12, YELLOW = 11, GREEN = 10;

void lights(int r, int y, int g) {
  digitalWrite(RED, r);
  digitalWrite(YELLOW, y);
  digitalWrite(GREEN, g);
}

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void loop() {
  lights(LOW, LOW, HIGH);   delay(3000);  // go
  lights(LOW, HIGH, LOW);   delay(1000);  // get ready to stop
  lights(HIGH, LOW, LOW);   delay(3000);  // stop
  lights(HIGH, HIGH, LOW);  delay(1000);  // get ready to go
}`,
      hl: ["void lights", "lights(LOW, LOW, HIGH)", "lights(HIGH, LOW, LOW)"],
      try: "the three LEDs run the traffic-light sequence",
    },
    {
      title: "3 · Fade with PWM",
      text: "`analogWrite(pin, 0…255)` switches a **~** pin on and off 490 times a second; the share of time it's on sets the brightness. 0 is off, 255 is full. Two loops fade the green LED up and down: it \"breathes\".",
      code: `const int GREEN = 10;   // a ~ (PWM) pin

void setup() {
  pinMode(GREEN, OUTPUT);
}

void loop() {
  for (int b = 0; b <= 255; b += 5) {
    analogWrite(GREEN, b);
    delay(20);
  }
  for (int b = 255; b >= 0; b -= 5) {
    analogWrite(GREEN, b);
    delay(20);
  }
}`,
      hl: ["analogWrite(GREEN, b)", "b += 5", "b -= 5"],
      try: "the green LED breathes",
    },
  ],
  tips: ["Use the kit's resistor card: 220 Ω is red-red-brown, 1 kΩ brown-black-red, 10 kΩ brown-black-orange.", "LED in backwards? It just stays dark: nothing breaks. Turn it round."],
});

L({
  id: "button", group: 2, emoji: "🔘", title: "Push button", minutes: 5, say: "button",
  summary: "Read a button, light an LED while it's held, then make it an on/off switch.",
  intro: "A **push button** joins its two sides while pressed. Read it on a pin set to **INPUT_PULLUP**: the Uno's own resistor holds the pin **HIGH**, and pressing pulls it **LOW** (to GND). So in code: **pressed = LOW**. The four legs are joined in pairs: use two legs on **diagonally opposite** corners and you can't get it wrong.",
  parts: [
    ["BTN", "button", "Button", "", "Joins pin 2 to GND while pressed."],
    ["R1", "resistor", "220 Ω resistor", "220", ""],
    ["LED", "led", "Green LED", "green", ""],
  ],
  build: [{
    title: "Button and LED",
    text: "Button: one side to **pin 2**, the other to **GND**. LED: **pin 8 → 220 Ω → long leg**, short leg to **GND**.",
    parts: ["BTN", "R1", "LED"],
    wires: [["BOARD.D2", "BTN.1", "white", "Pin 2 reads the button."], ["BTN.2", "BOARD.GND", "black", ""], ["BOARD.D8", "R1.1", "green", ""], ["R1.2", "LED.A", "green", ""], ["LED.K", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · Read it",
      text: "`digitalRead(2)` gives **1** (HIGH, released) or **0** (LOW, pressed). Printing it 10 times a second shows the button's state. Press it (pinch, click or key **1**) and watch the Serial monitor.",
      code: `const int BUTTON = 2;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  int state = digitalRead(BUTTON);
  Serial.println(state);   // 1 = released, 0 = pressed
  delay(100);
}`,
      hl: ["INPUT_PULLUP", "digitalRead(BUTTON)"],
      try: "press the button: 1 turns into 0",
    },
    {
      title: "2 · LED while held",
      text: "**if / else** decides: pressed (LOW) → LED on, otherwise off. loop() checks thousands of times a second, so it feels instant.",
      code: `const int BUTTON = 2, LED = 8;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  if (digitalRead(BUTTON) == LOW) {
    digitalWrite(LED, HIGH);
  } else {
    digitalWrite(LED, LOW);
  }
}`,
      hl: ["if (digitalRead(BUTTON) == LOW)", "} else {"],
      try: "hold the button and the LED lights",
    },
    {
      title: "3 · An on/off switch",
      text: "To toggle, react only to the **moment** it's pressed: the reading was HIGH last time and is LOW now. Then flip `on` with `!on`. The short delay skips **bounce**: the metal contacts rattle for a few milliseconds.",
      code: `const int BUTTON = 2, LED = 8;
bool on = false;
int last = HIGH;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  int now = digitalRead(BUTTON);
  if (last == HIGH && now == LOW) {   // just pressed
    on = !on;                         // flip it
    digitalWrite(LED, on);
    delay(30);                        // ignore the bounce
  }
  last = now;
}`,
      hl: ["bool on = false", "last == HIGH && now == LOW", "on = !on", "delay(30)"],
      try: "each press switches the LED on or off",
    },
  ],
  tips: ["The kit's coloured caps press onto the 12 mm buttons."],
});

L({
  id: "buzzers", group: 2, emoji: "🔔", title: "Active and passive buzzers", minutes: 6, say: "buzzer|buzzers|melody",
  summary: "Beep once, sound an alarm in a loop, then play a melody with tone().",
  intro: "Your kit has two buzzers that look alike. The **active** one (sealed bottom, often a sticker on top) has its own oscillator: give it 5 V and it **beeps** at one pitch. The **passive** one (green circuit board visible underneath) is just a speaker: the Arduino must vibrate it with **tone()**, so it can play **any note**. The **+** leg is the longer one.",
  parts: [
    ["BA", "buzzer", "Active buzzer", "active", "Beeps by itself when powered."],
    ["BP", "buzzer", "Passive buzzer", "passive", "Plays the note tone() gives it."],
  ],
  build: [{
    title: "Two buzzers",
    text: "Active buzzer: **+ → pin 8**, **− → GND**. Passive buzzer: **+ → pin 9**, **− → GND**.",
    parts: ["BA", "BP"],
    wires: [["BOARD.D8", "BA.+", "red", "Pin 8 switches the active buzzer on and off."], ["BA.-", "BOARD.GND", "black", ""], ["BOARD.D9", "BP.+", "orange", "Pin 9 plays notes on the passive one."], ["BP.-", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · One beep",
      text: "The active buzzer only needs HIGH: on for 300 ms, then LOW. (Turn your sound on.)",
      code: `const int ACTIVE = 8;

void setup() {
  pinMode(ACTIVE, OUTPUT);
  digitalWrite(ACTIVE, HIGH);  // beep…
  delay(300);
  digitalWrite(ACTIVE, LOW);   // …stop
}

void loop() {
}`,
      hl: ["HIGH);", "LOW);"],
      try: "one short beep",
    },
    {
      title: "2 · An alarm",
      text: "A **for** loop beeps 3 times fast, then loop() waits 2 seconds and does it again.",
      code: `const int ACTIVE = 8;

void setup() {
  pinMode(ACTIVE, OUTPUT);
}

void loop() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(ACTIVE, HIGH);
    delay(100);
    digitalWrite(ACTIVE, LOW);
    delay(100);
  }
  delay(2000);
}`,
      hl: ["for (int i = 0; i < 3; i++)", "delay(2000)"],
      try: "beep-beep-beep, pause, repeat",
    },
    {
      title: "3 · A melody",
      text: "`tone(pin, hertz, ms)` vibrates the passive buzzer at a frequency: 262 Hz is C, 294 D, 330 E, 349 F, 392 G. Two arrays hold the notes and their lengths, and a loop plays them.",
      code: `const int SPEAKER = 9;
// Twinkle twinkle: C C G G A A G
int notes[] = {262, 262, 392, 392, 440, 440, 392};
int beats[] = {1, 1, 1, 1, 1, 1, 2};

void setup() {
}

void loop() {
  for (int i = 0; i < 7; i++) {
    int ms = beats[i] * 350;
    tone(SPEAKER, notes[i], ms);
    delay(ms + 50);   // the note, plus a tiny gap
  }
  delay(1500);
}`,
      hl: ["int notes[]", "int beats[]", "tone(SPEAKER"],
      try: "it plays Twinkle Twinkle",
    },
  ],
  tips: ["tone() on the active buzzer sounds rough: it's made for one pitch only."],
});

L({
  id: "rgb", focus: "RGB", group: 2, emoji: "🌈", title: "RGB LED module", minutes: 5, say: "rgb|colour|color",
  summary: "Show one colour, cycle through colours, then fade through the rainbow.",
  intro: "An **RGB LED** is three LEDs (red, green, blue) in one dome sharing the **−** pin. Mixing them makes any colour: red + green = yellow, all three = white. Use the **~** pins with **analogWrite()** to mix in-between shades.",
  parts: [
    ["RGB", "rgb", "RGB module", "", "Three LEDs in one."],
    ["R1", "resistor", "220 Ω", "220", "For red."],
    ["R2", "resistor", "220 Ω", "220", "For green."],
    ["R3", "resistor", "220 Ω", "220", "For blue."],
  ],
  build: [{
    title: "Three colours, three resistors",
    text: "**Pin 9 → 220 Ω → R**, **pin 10 → 220 Ω → G**, **pin 11 → 220 Ω → B**, and the module's **−** to **GND**. (If your module already has resistors on it, these just make it a little dimmer.)",
    parts: ["RGB", "R1", "R2", "R3"],
    wires: [["BOARD.D9", "R1.1", "red", ""], ["R1.2", "RGB.R", "red", ""], ["BOARD.D10", "R2.1", "green", ""], ["R2.2", "RGB.G", "green", ""], ["BOARD.D11", "R3.1", "blue", ""], ["R3.2", "RGB.B", "blue", ""], ["RGB.-", "BOARD.GND", "black", "The shared minus."]],
  }],
  stages: [
    {
      title: "1 · One colour",
      text: "`analogWrite` each channel once: full red, a bit of green, no blue makes **orange**.",
      code: `const int R = 9, G = 10, B = 11;

void setup() {
  analogWrite(R, 255);  // full red
  analogWrite(G, 60);   // a little green
  analogWrite(B, 0);    // no blue  → orange
}

void loop() {
}`,
      hl: ["analogWrite(R, 255)", "analogWrite(G, 60)"],
      try: "the dome glows orange",
    },
    {
      title: "2 · Cycle the colours",
      text: "A helper `color(r, g, b)` sets all three. loop() shows red, green, blue, yellow, cyan, purple and white, one a second.",
      code: `const int R = 9, G = 10, B = 11;

void color(int r, int g, int b) {
  analogWrite(R, r);
  analogWrite(G, g);
  analogWrite(B, b);
}

void setup() {
}

void loop() {
  color(255, 0, 0);     delay(1000);  // red
  color(0, 255, 0);     delay(1000);  // green
  color(0, 0, 255);     delay(1000);  // blue
  color(255, 255, 0);   delay(1000);  // yellow
  color(0, 255, 255);   delay(1000);  // cyan
  color(255, 0, 255);   delay(1000);  // purple
  color(255, 255, 255); delay(1000);  // white
}`,
      hl: ["void color", "color(255, 255, 0)"],
      try: "seven colours, one each second",
    },
    {
      title: "3 · Rainbow fade",
      text: "One counter from 0 to 255 fades red **down** while green comes **up**, then green to blue, then blue back to red: a smooth rainbow forever.",
      code: `const int R = 9, G = 10, B = 11;

void color(int r, int g, int b) {
  analogWrite(R, r);
  analogWrite(G, g);
  analogWrite(B, b);
}

void setup() {
}

void loop() {
  for (int i = 0; i < 256; i += 3) { color(255 - i, i, 0); delay(15); }  // red → green
  for (int i = 0; i < 256; i += 3) { color(0, 255 - i, i); delay(15); }  // green → blue
  for (int i = 0; i < 256; i += 3) { color(i, 0, 255 - i); delay(15); }  // blue → red
}`,
      hl: ["color(255 - i, i, 0)", "color(0, 255 - i, i)", "color(i, 0, 255 - i)"],
      try: "a smooth rainbow",
    },
  ],
  tips: ["Some RGB modules are common-anode (marked + instead of −): wire + to 5V, and then 0 is full brightness and 255 is off."],
});

L({
  id: "relay", group: 2, emoji: "🔁", title: "5 V relay", minutes: 6, say: "relay",
  summary: "Click it once, switch a lamp on a timer, then switch it with a button.",
  intro: "A **relay** is a switch worked by a magnet. A small signal on **S** pulls a metal arm with a **click**, and its contacts change over: **COM** joins **NO** (normally open) instead of **NC** (normally closed). The switched side is a separate circuit, so a relay can turn on things the Arduino could never power, like a lamp or a fan. Here it switches an LED, so it's safe to play with.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", "Shares 5 V and GND."],
    ["RL", "relay", "Relay module", "", "Pin 7 works the switch."],
    ["R1", "resistor", "220 Ω", "220", ""],
    ["LAMP", "led", "Yellow LED (the \"lamp\")", "yellow", "Stands in for a lamp."],
    ["BTN", "button", "Button", "", "For part 3."],
  ],
  build: [
    {
      title: "The relay's control side",
      text: "**5V → + rail** and **GND → − rail** on the breadboard. Relay **S → pin 7**, **+ → + rail**, **− → − rail**.",
      parts: ["BB", "RL"],
      wires: [["BOARD.5V", "BB.+", "red", ""], ["BOARD.GND", "BB.-", "black", ""], ["BOARD.D7", "RL.S", "orange", "The signal that works the relay."], ["RL.+", "BB.+", "red", "Power for its coil."], ["RL.-", "BB.-", "black", ""]],
    },
    {
      title: "The switched side",
      text: "The relay's screw terminals: **+ rail → COM**, **NO → 220 Ω → LED long leg**, LED short leg → **− rail**. While the relay is off, NO is disconnected and the \"lamp\" is dark. Loosen a screw, push the wire in, tighten.",
      parts: ["R1", "LAMP"],
      wires: [["BB.+", "RL.COM", "red", "The switch's common contact."], ["RL.NO", "R1.1", "yellow", "Joined to COM only while the relay is on."], ["R1.2", "LAMP.A", "yellow", ""], ["LAMP.K", "BB.-", "black", ""]],
    },
    {
      title: "A button (for part 3)",
      text: "Button between **pin 2** and the **− rail**.",
      parts: ["BTN"],
      wires: [["BOARD.D2", "BTN.1", "white", ""], ["BTN.2", "BB.-", "black", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Click once",
      text: "HIGH on pin 7: click, the lamp lights. Two seconds later LOW: click, it's off. The relay's own red LED shows when the coil is on.",
      code: `const int RELAY = 7;

void setup() {
  pinMode(RELAY, OUTPUT);
  digitalWrite(RELAY, HIGH);  // click: lamp on
  delay(2000);
  digitalWrite(RELAY, LOW);   // click: lamp off
}

void loop() {
}`,
      hl: ["digitalWrite(RELAY, HIGH)", "digitalWrite(RELAY, LOW)"],
      try: "the lamp lights for 2 s",
    },
    {
      title: "2 · A timer",
      text: "On 1 s, off 3 s, forever, like a warning light. Don't switch a relay many times a second: it's mechanical and wears out.",
      code: `const int RELAY = 7;

void setup() {
  pinMode(RELAY, OUTPUT);
}

void loop() {
  digitalWrite(RELAY, HIGH);
  delay(1000);
  digitalWrite(RELAY, LOW);
  delay(3000);
}`,
      hl: ["delay(1000)", "delay(3000)"],
      try: "on 1 s, off 3 s",
    },
    {
      title: "3 · A button switch",
      text: "The toggle from the button lesson, now working the relay: each press switches the lamp.",
      code: `const int RELAY = 7, BUTTON = 2;
bool on = false;
int last = HIGH;

void setup() {
  pinMode(RELAY, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
}

void loop() {
  int now = digitalRead(BUTTON);
  if (last == HIGH && now == LOW) {
    on = !on;
    digitalWrite(RELAY, on);
    delay(30);
  }
  last = now;
}`,
      hl: ["on = !on", "digitalWrite(RELAY, on)"],
      try: "press the button (or key 1) to switch the lamp",
    },
  ],
  tips: ["Never wire mains (220 V) to a relay on a breadboard. Keep to low-voltage circuits."],
});

// ---- Inputs ---------------------------------------------------------------------------------

L({
  id: "pot", group: 3, emoji: "🎛️", title: "Potentiometer (10K)", minutes: 5, say: "potentiometer|knob",
  summary: "Read the knob, dim an LED with it, then show its level on three LEDs.",
  intro: "A **potentiometer** is a knob that slides a contact (the middle leg, the **wiper**) along a resistive track. With the outer legs on 0 V and 5 V, the wiper gives any voltage between. **analogRead()** on an **A** pin turns 0–5 V into a number **0–1023**.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", "Shares GND."],
    ["POT", "potentiometer", "10K potentiometer", "10k", ""],
    ["R1", "resistor", "220 Ω", "220", ""], ["L1", "led", "Green LED", "green", ""],
    ["R2", "resistor", "220 Ω", "220", ""], ["L2", "led", "Yellow LED", "yellow", ""],
    ["R3", "resistor", "220 Ω", "220", ""], ["L3", "led", "Red LED", "red", ""],
  ],
  build: [
    {
      title: "The knob",
      text: "Outer legs: one to **5V**, the other to **GND** (through the − rail). Middle leg to **A0**.",
      parts: ["BB", "POT"],
      wires: [["BOARD.GND", "BB.-", "black", ""], ["BB.-", "POT.1", "black", ""], ["BOARD.5V", "POT.2", "red", ""], ["POT.W", "BOARD.A0", "green", "The wiper voltage, read on A0."]],
    },
    {
      title: "Three LEDs",
      text: "Green on **pin 9**, yellow on **10**, red on **11**, each through 220 Ω, short legs to **−**.",
      parts: ["R1", "L1", "R2", "L2", "R3", "L3"],
      wires: [["BOARD.D9", "R1.1", "green", ""], ["R1.2", "L1.A", "green", ""], ["L1.K", "BB.-", "black", ""], ["BOARD.D10", "R2.1", "yellow", ""], ["R2.2", "L2.A", "yellow", ""], ["L2.K", "BB.-", "black", ""], ["BOARD.D11", "R3.1", "red", ""], ["R3.2", "L3.A", "red", ""], ["L3.K", "BB.-", "black", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Read it",
      text: "Print the reading and the voltage it means: `value * 5.0 / 1023`. Turn the knob slider.",
      code: `void setup() {
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(A0);          // 0 … 1023
  float volts = value * 5.0 / 1023;
  Serial.print(value);
  Serial.print("  = ");
  Serial.print(volts);
  Serial.println(" V");
  delay(200);
}`,
      hl: ["analogRead(A0)", "5.0 / 1023"],
      try: "turn the slider and watch the numbers",
    },
    {
      title: "2 · A dimmer",
      text: "analogRead gives 0–1023, analogWrite wants 0–255: divide by 4 (or use map). Now the knob dims the green LED.",
      code: `const int LED = 9;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  int value = analogRead(A0);
  analogWrite(LED, value / 4);   // 0 … 255
}`,
      hl: ["analogWrite(LED, value / 4)"],
      try: "the knob dims the green LED",
    },
    {
      title: "3 · A level meter",
      text: "Three thresholds: above 250 the green lights, above 500 yellow too, above 750 all three. Comparisons like `value > 500` are **true** or **false**, which digitalWrite takes as HIGH or LOW.",
      code: `const int G = 9, Y = 10, R = 11;

void setup() {
  pinMode(G, OUTPUT);
  pinMode(Y, OUTPUT);
  pinMode(R, OUTPUT);
}

void loop() {
  int value = analogRead(A0);
  digitalWrite(G, value > 250);
  digitalWrite(Y, value > 500);
  digitalWrite(R, value > 750);
  delay(20);
}`,
      hl: ["value > 250", "value > 500", "value > 750"],
      try: "turn it up: green, then yellow, then red",
    },
  ],
});

L({
  id: "light", group: 3, emoji: "🌙", title: "Photoresistor (light sensor)", minutes: 5, say: "photoresistor|light sensor|ldr",
  summary: "Measure light, then build a night light that switches itself on.",
  intro: "The **photoresistor** changes its resistance with light: about 1 MΩ in the dark, a few hundred Ω in bright light. The Arduino can only measure voltage, so pair it with a **10 kΩ resistor** (brown-black-orange) as a **voltage divider**: the point between them rises with light, and **A0** reads it.",
  parts: [
    ["LDR", "ldr", "Photoresistor", "", "Top half of the divider."],
    ["R10", "resistor", "10 kΩ", "10k", "Bottom half of the divider."],
    ["R1", "resistor", "220 Ω", "220", ""],
    ["LED", "led", "Yellow LED", "yellow", "The night light."],
  ],
  build: [{
    title: "The divider and an LED",
    text: "**5V → photoresistor → A0**, and **A0 → 10 kΩ → GND**. (On a breadboard: the photoresistor and the 10 kΩ share one column, and that column goes to A0.) LED: **pin 9 → 220 Ω → LED → GND**.",
    parts: ["LDR", "R10", "R1", "LED"],
    wires: [["BOARD.5V", "LDR.1", "red", ""], ["LDR.2", "BOARD.A0", "green", "The middle of the divider."], ["LDR.2", "R10.1", "green", ""], ["R10.2", "BOARD.GND", "black", ""], ["BOARD.D9", "R1.1", "yellow", ""], ["R1.2", "LED.A", "yellow", ""], ["LED.K", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · Measure the light",
      text: "Print the reading: bright gives a high number, dark a low one. Move the light slider (on the real one, cover it with your hand).",
      code: `void setup() {
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(A0);
  Serial.print("Light: ");
  Serial.println(light);
  delay(300);
}`,
      hl: ["analogRead(A0)"],
      try: "move the light slider",
    },
    {
      title: "2 · An automatic night light",
      text: "Below a **threshold** the LED turns on. Pick the number from what part 1 printed in your room: halfway between light and dark works well.",
      code: `const int LED = 9;
const int DARK = 300;   // below this, it's night

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  int light = analogRead(A0);
  if (light < DARK) {
    digitalWrite(LED, HIGH);
  } else {
    digitalWrite(LED, LOW);
  }
  delay(100);
}`,
      hl: ["const int DARK", "light < DARK"],
      try: "slide the light down and the LED comes on",
    },
    {
      title: "3 · The darker, the brighter",
      text: "Instead of on/off, **map** the darkness to brightness: the less light, the brighter the LED. `constrain` keeps the number between 0 and 255.",
      code: `const int LED = 9;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  int light = analogRead(A0);
  int glow = map(light, 100, 800, 255, 0);  // dark → bright
  glow = constrain(glow, 0, 255);
  analogWrite(LED, glow);
  delay(30);
}`,
      hl: ["map(light, 100, 800, 255, 0)", "constrain"],
      try: "the LED fades in as it gets dark",
    },
  ],
});

L({
  id: "joystick", group: 3, emoji: "🕹️", title: "Joystick", minutes: 6, say: "joystick",
  summary: "Read X, Y and the push button, then steer the servo with the stick.",
  intro: "The **joystick** is two potentiometers at right angles (**VRx** left–right, **VRy** up–down) plus a **button** (SW) you press by pushing the stick down. Centred, both read about **512**. SW works like the button lesson: INPUT_PULLUP, pressed = LOW.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", "Shares 5 V and GND."],
    ["JS", "joystick", "Joystick module", "", ""],
    ["SV", "servo", "9g servo", "", "For part 3."],
  ],
  build: [
    {
      title: "Wire the joystick",
      text: "Male–female jumpers: **GND → − rail**, **+5V → + rail**, **VRx → A0**, **VRy → A1**, **SW → pin 2**. The rails get **5V** and **GND** from the Uno.",
      parts: ["BB", "JS"],
      wires: [["BOARD.5V", "BB.+", "red", ""], ["BOARD.GND", "BB.-", "black", ""], ["JS.GND", "BB.-", "black", ""], ["JS.+5V", "BB.+", "red", ""], ["JS.VRx", "BOARD.A0", "green", "Left–right."], ["JS.VRy", "BOARD.A1", "blue", "Up–down."], ["JS.SW", "BOARD.D2", "white", "The push button."]],
    },
    {
      title: "The servo (for part 3)",
      text: "Servo **brown → − rail**, **red → + rail**, **orange → pin 9**.",
      parts: ["SV"],
      wires: [["SV.GND", "BB.-", "brown", ""], ["SV.V+", "BB.+", "red", ""], ["BOARD.D9", "SV.SIG", "orange", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Read the stick",
      text: "Two analogReads and a digitalRead, printed on one line. Move the X and Y sliders and press the stick.",
      code: `const int SW = 2;

void setup() {
  pinMode(SW, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  int x = analogRead(A0);
  int y = analogRead(A1);
  int pressed = digitalRead(SW) == LOW;
  Serial.print("X: "); Serial.print(x);
  Serial.print("  Y: "); Serial.print(y);
  Serial.print("  pressed: "); Serial.println(pressed);
  delay(200);
}`,
      hl: ["analogRead(A0)", "analogRead(A1)", "digitalRead(SW) == LOW"],
      try: "move the stick sliders",
    },
    {
      title: "2 · Which way?",
      text: "Turn numbers into directions with thresholds around the centre (512). A **dead zone** in the middle ignores small wobbles.",
      code: `void setup() {
  Serial.begin(9600);
}

void loop() {
  int x = analogRead(A0);
  int y = analogRead(A1);
  if (x < 300) Serial.println("LEFT");
  else if (x > 700) Serial.println("RIGHT");
  else if (y < 300) Serial.println("DOWN");
  else if (y > 700) Serial.println("UP");
  else Serial.println("centre");
  delay(250);
}`,
      hl: ["x < 300", "x > 700", "else Serial.println(\"centre\")"],
      try: "push the stick sliders to the ends",
    },
    {
      title: "3 · Steer the servo",
      text: "Map X (0–1023) onto the servo (0–180°). Pressing the stick snaps it back to the middle.",
      code: `#include <Servo.h>
Servo arm;
const int SW = 2;

void setup() {
  arm.attach(9);
  pinMode(SW, INPUT_PULLUP);
}

void loop() {
  if (digitalRead(SW) == LOW) {
    arm.write(90);                          // pressed: centre
  } else {
    int x = analogRead(A0);
    arm.write(map(x, 0, 1023, 0, 180));     // follow the stick
  }
  delay(15);
}`,
      hl: ["arm.write(90)", "map(x, 0, 1023, 0, 180)"],
      try: "the servo follows the stick",
    },
  ],
});

L({
  id: "tilt", group: 3, emoji: "📐", title: "Tilt switch", minutes: 4, say: "tilt",
  summary: "Detect when it's tipped over, then sound an alarm.",
  intro: "A **tilt switch** is a tiny can with metal balls inside. Upright, the balls touch both legs and the switch is **closed**. Tip it and they roll away: **open**. It's read exactly like a button, with INPUT_PULLUP: upright = LOW, tipped = HIGH.",
  parts: [
    ["TS", "tilt", "Tilt switch", "", ""],
    ["BZ", "buzzer", "Active buzzer", "active", "For the alarm."],
  ],
  build: [{
    title: "Switch and buzzer",
    text: "Tilt switch: one leg to **pin 2**, the other to **GND** (either way round). Active buzzer: **+ → pin 8**, **− → GND**.",
    parts: ["TS", "BZ"],
    wires: [["BOARD.D2", "TS.1", "white", ""], ["TS.2", "BOARD.GND", "black", ""], ["BOARD.D8", "BZ.+", "red", ""], ["BZ.-", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · Upright or tipped?",
      text: "Print its state. Use the **Tip it over** button on the left.",
      code: `const int TILT = 2;

void setup() {
  pinMode(TILT, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(TILT) == HIGH) {
    Serial.println("Tipped over!");
  } else {
    Serial.println("Upright");
  }
  delay(300);
}`,
      hl: ["digitalRead(TILT) == HIGH"],
      try: "press Tip it over",
    },
    {
      title: "2 · Tip alarm",
      text: "While it's tipped, the buzzer beeps. Glue it inside a box and you know if someone moves it.",
      code: `const int TILT = 2, BUZZER = 8;

void setup() {
  pinMode(TILT, INPUT_PULLUP);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  if (digitalRead(TILT) == HIGH) {
    digitalWrite(BUZZER, HIGH);
    delay(100);
    digitalWrite(BUZZER, LOW);
    delay(100);
  }
}`,
      hl: ["digitalRead(TILT) == HIGH", "digitalWrite(BUZZER, HIGH)"],
      try: "tip it: beeping",
    },
  ],
});

L({
  id: "sound", group: 3, emoji: "👏", title: "Sound sensor (KY-037)", minutes: 5, say: "sound sensor|clap|microphone",
  summary: "Watch the loudness, then switch a light with a clap.",
  intro: "The **KY-037** is a microphone with an amplifier. **AO** gives the loudness as a voltage (quiet is about 500, louder goes higher). **DO** goes HIGH when the sound passes the level set by the blue screw. Its little red LED shows DO.",
  parts: [["MIC", "sound", "KY-037 sound sensor", "", ""]],
  build: [{
    title: "Wire it",
    text: "**AO → A0**, **G → GND**, **+ → 5V**, **DO → pin 2**. The light for part 2 is the **L** LED on pin 13.",
    parts: ["MIC"],
    wires: [["MIC.AO", "BOARD.A0", "green", "Loudness."], ["MIC.G", "BOARD.GND", "black", ""], ["MIC.+", "BOARD.5V", "red", ""], ["MIC.DO", "BOARD.D2", "white", "Loud or not."]],
  }],
  stages: [
    {
      title: "1 · Watch the loudness",
      text: "Print AO quickly. Press **Clap** and see it jump. Raise the room noise and the baseline goes up.",
      code: `void setup() {
  Serial.begin(9600);
}

void loop() {
  int level = analogRead(A0);
  Serial.println(level);
  delay(50);
}`,
      hl: ["analogRead(A0)"],
      try: "press Clap",
    },
    {
      title: "2 · Clap switch",
      text: "A clap pushes AO well above normal. When it passes 650 the L LED toggles. The 300 ms pause stops one clap counting twice.",
      code: `const int LED = 13;
bool on = false;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  int level = analogRead(A0);
  if (level > 650) {      // a loud clap
    on = !on;
    digitalWrite(LED, on);
    delay(300);           // ignore the echo
  }
}`,
      hl: ["level > 650", "on = !on", "delay(300)"],
      try: "clap to switch the L LED on and off",
    },
  ],
  tips: ["On the real module, turn the blue screw until the red DO LED just goes out in a quiet room. Then claps light it."],
});

L({
  id: "water", group: 3, emoji: "💧", title: "Water level sensor", minutes: 4, say: "water",
  summary: "Read how deep it's dipped, then warn when the water is high.",
  intro: "The **water sensor** has rows of copper traces. Water bridges them and lets a little current through: the deeper it's dipped, the higher **S** reads. Tip: power it from a **pin** and switch it on only while measuring: constant power corrodes the traces.",
  parts: [
    ["WS", "water", "Water sensor", "", ""],
    ["BZ", "buzzer", "Active buzzer", "active", "For the warning."],
  ],
  build: [{
    title: "Wire it",
    text: "**S → A0**, **+ → pin 7** (power only when reading), **− → GND**. Active buzzer: **+ → pin 8**, **− → GND**.",
    parts: ["WS", "BZ"],
    wires: [["WS.S", "BOARD.A0", "green", ""], ["BOARD.D7", "WS.+", "red", "Powered only while measuring."], ["WS.-", "BOARD.GND", "black", ""], ["BOARD.D8", "BZ.+", "red", ""], ["BZ.-", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · How deep?",
      text: "Switch the sensor on, wait 10 ms, read, switch off. Move the water slider.",
      code: `const int POWER = 7;

int readWater() {
  digitalWrite(POWER, HIGH);
  delay(10);
  int level = analogRead(A0);
  digitalWrite(POWER, LOW);
  return level;
}

void setup() {
  pinMode(POWER, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  Serial.print("Water: ");
  Serial.println(readWater());
  delay(500);
}`,
      hl: ["int readWater()", "digitalWrite(POWER, HIGH)", "return level"],
      try: "raise the water level slider",
    },
    {
      title: "2 · Flood warning",
      text: "Above 400, beep. That's a sink or plant-pot alarm.",
      code: `const int POWER = 7, BUZZER = 8;

int readWater() {
  digitalWrite(POWER, HIGH);
  delay(10);
  int level = analogRead(A0);
  digitalWrite(POWER, LOW);
  return level;
}

void setup() {
  pinMode(POWER, OUTPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  if (readWater() > 400) {
    digitalWrite(BUZZER, HIGH);
    delay(200);
    digitalWrite(BUZZER, LOW);
  }
  delay(300);
}`,
      hl: ["readWater() > 400"],
      try: "raise the water past halfway",
    },
  ],
  tips: ["Only the traces go in water: keep the pins and the top of the board dry."],
});

L({
  id: "lm35", group: 3, emoji: "🌡️", title: "LM35 temperature sensor", minutes: 5, say: "lm35|temperature sensor",
  summary: "Read its voltage, turn it into °C, then light a warning when it's hot.",
  intro: "The **LM35** looks like a transistor but measures temperature: its middle leg gives **10 mV per °C** (25 °C → 0.25 V). With the **flat side facing you**: left leg **+5 V**, middle **OUT**, right **GND**. Wire it backwards and it gets hot fast, so check twice.",
  parts: [
    ["T", "lm35", "LM35", "", ""],
    ["R1", "resistor", "220 Ω", "220", ""],
    ["LED", "led", "Red LED", "red", "Too hot!"],
  ],
  build: [{
    title: "Wire it",
    text: "LM35: **+Vs → 5V**, **Vout → A0**, **GND → GND**. Red LED on **pin 8** through 220 Ω.",
    parts: ["T", "R1", "LED"],
    wires: [["BOARD.5V", "T.VS", "red", ""], ["T.OUT", "BOARD.A0", "green", "10 mV per °C."], ["T.GND", "BOARD.GND", "black", ""], ["BOARD.D8", "R1.1", "red", ""], ["R1.2", "LED.A", "red", ""], ["LED.K", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · The raw reading",
      text: "At room temperature the reading is small, about 45: 0.22 V out of 5 V.",
      code: `void setup() {
  Serial.begin(9600);
}

void loop() {
  Serial.println(analogRead(A0));
  delay(500);
}`,
      hl: ["analogRead(A0)"],
      try: "move the temperature slider",
    },
    {
      title: "2 · In degrees",
      text: "Volts = reading × 5 / 1023, and °C = volts × 100. Together: **°C = reading × 500 / 1023**. A **float** keeps the decimals.",
      code: `void setup() {
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(A0);
  float celsius = reading * 500.0 / 1023;
  Serial.print("Temperature: ");
  Serial.print(celsius);
  Serial.println(" C");
  delay(1000);
}`,
      hl: ["float celsius = reading * 500.0 / 1023"],
      try: "move the temperature slider",
    },
    {
      title: "3 · Too hot!",
      text: "Above 30 °C the red LED lights. Change the limit to whatever you like.",
      code: `const int LED = 8;
const float LIMIT = 30.0;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  float celsius = analogRead(A0) * 500.0 / 1023;
  Serial.println(celsius);
  digitalWrite(LED, celsius > LIMIT);
  delay(500);
}`,
      hl: ["const float LIMIT", "celsius > LIMIT"],
      try: "push the temperature above 30 °C",
    },
  ],
});

L({
  id: "dht11", group: 3, emoji: "💦", title: "DHT11 temperature & humidity", minutes: 5, say: "dht|humidity",
  summary: "Use a library to read temperature and humidity, then warn when it's muggy.",
  intro: "The **DHT11** measures **temperature** and **humidity** and sends both as a digital message on one wire. A **library** decodes it: in the Arduino IDE open **Tools → Manage Libraries**, search **DHT sensor library** (by Adafruit) and install it with its dependencies. The DHT11 is slow: read it at most once a second.",
  parts: [["DHT", "dht11", "DHT11 module", "", ""]],
  build: [{
    title: "Wire it",
    text: "**S → pin 2**, **+ → 5V**, **− → GND**.",
    parts: ["DHT"],
    wires: [["DHT.S", "BOARD.D2", "white", "The data wire."], ["DHT.+", "BOARD.5V", "red", ""], ["DHT.-", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · One reading",
      text: "`DHT dht(2, DHT11)` sets up the sensor on pin 2. In setup(): `begin()`, wait 2 s for it to wake, then read and print once. **isnan** (\"is not a number\") catches a failed read.",
      code: `#include <DHT.h>
DHT dht(2, DHT11);

void setup() {
  Serial.begin(9600);
  dht.begin();
  delay(2000);
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t)) {
    Serial.println("No answer: check the wiring");
  } else {
    Serial.print(t); Serial.print(" C, ");
    Serial.print(h); Serial.println(" %");
  }
}

void loop() {
}`,
      hl: ["DHT dht(2, DHT11)", "dht.begin()", "readTemperature()", "isnan(t)"],
      try: "one reading in the Serial monitor",
    },
    {
      title: "2 · A weather station",
      text: "The same, every 2 seconds in loop(). Move the sliders.",
      code: `#include <DHT.h>
DHT dht(2, DHT11);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  delay(2000);
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  Serial.print("Temp: "); Serial.print(t);
  Serial.print(" C   Humidity: "); Serial.print(h);
  Serial.println(" %");
}`,
      hl: ["delay(2000)"],
      try: "move the sliders",
    },
    {
      title: "3 · Muggy warning",
      text: "Above 70 % humidity, the L LED (pin 13) lights: time to open a window.",
      code: `#include <DHT.h>
DHT dht(2, DHT11);
const int LED = 13;

void setup() {
  pinMode(LED, OUTPUT);
  dht.begin();
}

void loop() {
  delay(2000);
  float h = dht.readHumidity();
  digitalWrite(LED, h > 70);
}`,
      hl: ["h > 70"],
      try: "push the humidity over 70 %",
    },
  ],
});

// ---- Displays ---------------------------------------------------------------------------------

const DIGITS = "const byte DIGITS[10] = {B00111111, B00000110, B01011011, B01001111, B01100110, B01101101, B01111101, B00000111, B01111111, B01101111};";

L({
  id: "seg7", focus: "D", group: 4, emoji: "8️⃣", title: "1-digit 7-segment display", minutes: 7, say: "seven segment|7 segment|digit",
  summary: "Light a number, count 0 to 9 with an array, then count button presses.",
  intro: "Eight LEDs shaped as the bars of a digit, named **a to g** clockwise from the top, with **g** in the middle and **dp** the dot. Yours is **common cathode** (5161AS): all their − ends meet at **COM**, which goes to GND through one **220 Ω** resistor. Each segment pin then lights its bar when HIGH.",
  parts: [
    ["D", "seg7", "7-segment display", "", ""],
    ["RC", "resistor", "220 Ω", "220", "Limits the current for the whole digit."],
    ["BTN", "button", "Button", "", "For part 3."],
  ],
  build: [
    {
      title: "Eight segment wires",
      text: "**a → 2, b → 3, c → 4, d → 5, e → 6, f → 7, g → 8, dp → 9**. The display's legs are numbered 1–5 along the bottom (left to right, dot at the bottom right) and 6–10 along the top (right to left): point at a leg to see its name.",
      parts: ["D"],
      wires: [["BOARD.D2", "D.a", "red", ""], ["BOARD.D3", "D.b", "orange", ""], ["BOARD.D4", "D.c", "yellow", ""], ["BOARD.D5", "D.d", "green", ""], ["BOARD.D6", "D.e", "blue", ""], ["BOARD.D7", "D.f", "purple", ""], ["BOARD.D8", "D.g", "white", ""], ["BOARD.D9", "D.dp", "grey", ""]],
    },
    {
      title: "Common pin and a button",
      text: "**COM → 220 Ω → GND**. Then a button between **pin 10** and **GND** for part 3.",
      parts: ["RC", "BTN"],
      wires: [["D.COM", "RC.1", "black", ""], ["RC.2", "BOARD.GND", "black", ""], ["BOARD.D10", "BTN.1", "white", ""], ["BTN.2", "BOARD.GND", "black", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Show a 7",
      text: "A **7** is segments **a, b and c**. Set every segment pin as an output, then turn those three HIGH.",
      code: `void setup() {
  for (int pin = 2; pin <= 9; pin++) {
    pinMode(pin, OUTPUT);
  }
  digitalWrite(2, HIGH);  // a
  digitalWrite(3, HIGH);  // b
  digitalWrite(4, HIGH);  // c
}

void loop() {
}`,
      hl: ["pin <= 9", "digitalWrite(2, HIGH)", "digitalWrite(4, HIGH)"],
      try: "it shows 7",
    },
    {
      title: "2 · Count 0 to 9",
      text: "Each digit is a **byte**: 8 bits, one per segment (bit 0 = a … bit 6 = g). `B01011011` is a 2. An **array** of ten of them is a lookup table, and **bitRead** pulls each bit out for its pin.",
      code: `${DIGITS}

void show(int n) {
  for (int s = 0; s < 7; s++) {
    digitalWrite(2 + s, bitRead(DIGITS[n], s));
  }
}

void setup() {
  for (int pin = 2; pin <= 9; pin++) pinMode(pin, OUTPUT);
}

void loop() {
  for (int n = 0; n <= 9; n++) {
    show(n);
    delay(700);
  }
}`,
      hl: ["const byte DIGITS", "bitRead(DIGITS[n], s)", "show(n)"],
      try: "it counts 0 to 9",
    },
    {
      title: "3 · Count presses",
      text: "Each press adds one; after 9 it wraps to 0 with **%** (the remainder after dividing by 10).",
      code: `${DIGITS}
const int BUTTON = 10;
int count = 0;
int last = HIGH;

void show(int n) {
  for (int s = 0; s < 7; s++) {
    digitalWrite(2 + s, bitRead(DIGITS[n], s));
  }
}

void setup() {
  for (int pin = 2; pin <= 9; pin++) pinMode(pin, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  show(0);
}

void loop() {
  int now = digitalRead(BUTTON);
  if (last == HIGH && now == LOW) {
    count = (count + 1) % 10;
    show(count);
    delay(30);
  }
  last = now;
}`,
      hl: ["count = (count + 1) % 10", "show(count)"],
      try: "press the button (or key 1) to count",
    },
  ],
  tips: ["With one shared resistor, an 8 looks a little dimmer than a 1. For even brightness use one 220 Ω per segment instead.", "Nothing lights? Your display may be common anode (5161BS): COM to 5V, and LOW lights a segment."],
});

L({
  id: "hc595", focus: "D", group: 4, emoji: "🧩", title: "74HC595 shift register", minutes: 7, say: "shift register|595",
  summary: "Drive the 7-segment display with only 3 pins: one pattern, a counter, a spinner.",
  intro: "The **74HC595** turns **3 Arduino pins into 8 outputs**. You send it 8 bits one at a time on **DS** (data), ticking **SHCP** (the clock) after each, then tick **STCP** (the latch) and all eight outputs **Q0–Q7** change at once. **shiftOut()** does the ticking. Here its outputs drive the 7-segment display, freeing 5 pins. The chip's notch marks pin 1's end.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", "Power rails."],
    ["U1", "hc595", "74HC595", "", "Sits across the breadboard's middle gap."],
    ["D", "seg7", "7-segment display", "", ""],
    ["RC", "resistor", "220 Ω", "220", ""],
  ],
  build: [
    {
      title: "Power the chip",
      text: "Rails: **5V → +**, **GND → −**. Chip: **VCC (16) → +**, **GND (8) → −**, **MR (10) → +** (never reset), **OE (13) → −** (outputs always on).",
      parts: ["BB", "U1"],
      wires: [["BOARD.5V", "BB.+", "red", ""], ["BOARD.GND", "BB.-", "black", ""], ["U1.VCC", "BB.+", "red", ""], ["U1.GND", "BB.-", "black", ""], ["U1.MR", "BB.+", "red", "Reset off."], ["U1.OE", "BB.-", "black", "Outputs on."]],
    },
    {
      title: "Three control wires",
      text: "**DS (14) → pin 11**, **SHCP (11) → pin 12** (clock), **STCP (12) → pin 8** (latch).",
      parts: [],
      wires: [["BOARD.D11", "U1.DS", "blue", "Data."], ["BOARD.D12", "U1.SHCP", "yellow", "Clock."], ["BOARD.D8", "U1.STCP", "green", "Latch."]],
    },
    {
      title: "Outputs to the display",
      text: "**Q0 → a, Q1 → b, … Q6 → g, Q7 → dp**, and the display's **COM → 220 Ω → −**.",
      parts: ["D", "RC"],
      wires: [["U1.Q0", "D.a", "red", ""], ["U1.Q1", "D.b", "orange", ""], ["U1.Q2", "D.c", "yellow", ""], ["U1.Q3", "D.d", "green", ""], ["U1.Q4", "D.e", "blue", ""], ["U1.Q5", "D.f", "purple", ""], ["U1.Q6", "D.g", "white", ""], ["U1.Q7", "D.dp", "grey", ""], ["D.COM", "RC.1", "black", ""], ["RC.2", "BB.-", "black", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Send one byte",
      text: "Latch LOW, **shiftOut** 8 bits (MSBFIRST: bit 7 first, so it ends up on Q7), latch HIGH: the outputs update together. `B01110110` lights b, c, e, f, g: an **H**.",
      code: `const int DATA = 11, CLOCK = 12, LATCH = 8;

void send(byte pattern) {
  digitalWrite(LATCH, LOW);
  shiftOut(DATA, CLOCK, MSBFIRST, pattern);
  digitalWrite(LATCH, HIGH);   // all 8 outputs change now
}

void setup() {
  pinMode(DATA, OUTPUT);
  pinMode(CLOCK, OUTPUT);
  pinMode(LATCH, OUTPUT);
  send(B01110110);             // H
}

void loop() {
}`,
      hl: ["digitalWrite(LATCH, LOW)", "shiftOut(DATA, CLOCK, MSBFIRST, pattern)", "digitalWrite(LATCH, HIGH)", "send(B01110110)"],
      try: "it shows H",
    },
    {
      title: "2 · Count with 3 pins",
      text: "The same digit table as the 7-segment lesson, but each digit goes out as one byte.",
      code: `const int DATA = 11, CLOCK = 12, LATCH = 8;
${DIGITS}

void send(byte pattern) {
  digitalWrite(LATCH, LOW);
  shiftOut(DATA, CLOCK, MSBFIRST, pattern);
  digitalWrite(LATCH, HIGH);
}

void setup() {
  pinMode(DATA, OUTPUT);
  pinMode(CLOCK, OUTPUT);
  pinMode(LATCH, OUTPUT);
}

void loop() {
  for (int n = 0; n <= 9; n++) {
    send(DIGITS[n]);
    delay(600);
  }
}`,
      hl: ["send(DIGITS[n])"],
      try: "it counts, using only 3 pins",
    },
    {
      title: "3 · A spinner",
      text: "Light one outer segment at a time, a → f, with `1 << s` (a 1 moved s places left). It looks like a loading spinner.",
      code: `const int DATA = 11, CLOCK = 12, LATCH = 8;

void send(byte pattern) {
  digitalWrite(LATCH, LOW);
  shiftOut(DATA, CLOCK, MSBFIRST, pattern);
  digitalWrite(LATCH, HIGH);
}

void setup() {
  pinMode(DATA, OUTPUT);
  pinMode(CLOCK, OUTPUT);
  pinMode(LATCH, OUTPUT);
}

void loop() {
  for (int s = 0; s < 6; s++) {
    send(1 << s);   // a, b, c, d, e, f
    delay(120);
  }
}`,
      hl: ["send(1 << s)"],
      try: "a segment chases round",
    },
  ],
  tips: ["Two 595s can be chained (Q7S → the next DS) for 16 outputs, still from 3 pins."],
});

L({
  id: "seg4", focus: "D", group: 4, emoji: "🔢", title: "4-digit 7-segment display", minutes: 8, say: "four digit|4 digit",
  summary: "Light one digit, show 1234 by multiplexing, then a seconds counter.",
  intro: "Four digits share the same eight segment pins (a to g, dp). Each digit has its own common cathode, **D1 to D4**. A digit lights only while its D pin is **LOW**. To show four different numbers, light them **one at a time**, a few milliseconds each, over and over: your eye blends them. That's **multiplexing**.",
  parts: [
    ["D", "seg7x4", "4-digit display", "", ""],
    ["R1", "resistor", "220 Ω", "220", "Digit 1."], ["R2", "resistor", "220 Ω", "220", "Digit 2."],
    ["R3", "resistor", "220 Ω", "220", "Digit 3."], ["R4", "resistor", "220 Ω", "220", "Digit 4."],
  ],
  build: [
    {
      title: "Segments",
      text: "**a → 2, b → 3, c → 4, d → 5, e → 6, f → 7, g → 8, dp → 9**. Legs 1–6 run along the bottom (left to right), 7–12 along the top (right to left).",
      parts: ["D"],
      wires: [["BOARD.D2", "D.a", "red", ""], ["BOARD.D3", "D.b", "orange", ""], ["BOARD.D4", "D.c", "yellow", ""], ["BOARD.D5", "D.d", "green", ""], ["BOARD.D6", "D.e", "blue", ""], ["BOARD.D7", "D.f", "purple", ""], ["BOARD.D8", "D.g", "white", ""], ["BOARD.D9", "D.dp", "grey", ""]],
    },
    {
      title: "Digits",
      text: "Each digit pin through its own 220 Ω: **D1 → 10, D2 → 11, D3 → 12, D4 → 13**.",
      parts: ["R1", "R2", "R3", "R4"],
      wires: [["BOARD.D10", "R1.1", "black", ""], ["R1.2", "D.D1", "black", ""], ["BOARD.D11", "R2.1", "black", ""], ["R2.2", "D.D2", "black", ""], ["BOARD.D12", "R3.1", "black", ""], ["R3.2", "D.D3", "black", ""], ["BOARD.D13", "R4.1", "black", ""], ["R4.2", "D.D4", "black", ""]],
    },
  ],
  stages: [
    {
      title: "1 · One digit",
      text: "Segment pins HIGH for a **5** (a, c, d, f, g). Digit pins: all HIGH (off) except D4 LOW. Only the last digit shows 5.",
      code: `${DIGITS}

void setup() {
  for (int pin = 2; pin <= 13; pin++) pinMode(pin, OUTPUT);
  for (int d = 10; d <= 13; d++) digitalWrite(d, HIGH);  // all digits off
  for (int s = 0; s < 7; s++) digitalWrite(2 + s, bitRead(DIGITS[5], s));
  digitalWrite(13, LOW);                                 // digit 4 on
}

void loop() {
}`,
      hl: ["digitalWrite(d, HIGH)", "bitRead(DIGITS[5], s)", "digitalWrite(13, LOW)"],
      try: "the 4th digit shows 5",
    },
    {
      title: "2 · Show 1234",
      text: "**showDigit(place, n)** turns every digit off, sets the segments, turns one digit on and waits 4 ms. loop() does it for all four places, endlessly: you see 1234.",
      code: `${DIGITS}
const int DIGIT_PINS[4] = {10, 11, 12, 13};

void showDigit(int place, int n) {
  for (int d = 0; d < 4; d++) digitalWrite(DIGIT_PINS[d], HIGH);
  for (int s = 0; s < 7; s++) digitalWrite(2 + s, bitRead(DIGITS[n], s));
  digitalWrite(DIGIT_PINS[place], LOW);
  delay(4);
}

void setup() {
  for (int pin = 2; pin <= 13; pin++) pinMode(pin, OUTPUT);
}

void loop() {
  showDigit(0, 1);
  showDigit(1, 2);
  showDigit(2, 3);
  showDigit(3, 4);
}`,
      hl: ["void showDigit", "digitalWrite(DIGIT_PINS[place], LOW)", "showDigit(0, 1)"],
      try: "1234, made of flashes too fast to see",
    },
    {
      title: "3 · Seconds counter",
      text: "**millis()** is the time since start-up in milliseconds; /1000 gives seconds. `/` and `%` split the number into its four digits: 1234 / 1000 = 1, then (1234 / 100) % 10 = 2, and so on.",
      code: `${DIGITS}
const int DIGIT_PINS[4] = {10, 11, 12, 13};

void showDigit(int place, int n) {
  for (int d = 0; d < 4; d++) digitalWrite(DIGIT_PINS[d], HIGH);
  for (int s = 0; s < 7; s++) digitalWrite(2 + s, bitRead(DIGITS[n], s));
  digitalWrite(DIGIT_PINS[place], LOW);
  delay(4);
}

void setup() {
  for (int pin = 2; pin <= 13; pin++) pinMode(pin, OUTPUT);
}

void loop() {
  int secs = millis() / 1000;
  int thousands = (secs / 1000) % 10;
  int hundreds = (secs / 100) % 10;
  int tens = (secs / 10) % 10;
  int ones = secs % 10;
  showDigit(0, thousands);
  showDigit(1, hundreds);
  showDigit(2, tens);
  showDigit(3, ones);
}`,
      hl: ["millis() / 1000", "(secs / 100) % 10", "secs % 10"],
      try: "it counts seconds since Run",
    },
  ],
  tips: ["A digit flickers? Something in loop() is too slow. Keep long delays out of a multiplexing loop.", "If nothing lights, yours may be common anode (5461BS): swap HIGH and LOW for the digit pins and segments."],
});

L({
  id: "matrix", focus: "M", group: 4, emoji: "🟥", title: "8×8 LED matrix", minutes: 8, say: "matrix|dot matrix",
  summary: "Light one dot, scan a moving line, then draw a smiley.",
  intro: "**64 LEDs** in 8 rows and 8 columns. Every LED sits where a row wire crosses a column wire: make its **row HIGH** and its **column LOW** and it lights. To draw a picture, show **one row at a time**, very fast (multiplexing again). The 16 pins are in a scrambled order: point at a leg to see if it's a row (R) or column (C). Each column gets a 220 Ω resistor.",
  parts: [
    ["M", "matrix", "8×8 matrix", "", ""],
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`R${i}`, "resistor", "220 Ω", "220", `Column ${i}.`]),
  ],
  build: [
    {
      title: "Rows",
      text: "Rows straight to pins: **R1 → 2, R2 → 3 … R8 → 9**.",
      parts: ["M"],
      wires: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ["BOARD.D" + (i + 1), `M.R${i}`, "red", ""]),
    },
    {
      title: "Columns, through resistors",
      text: "Columns through 220 Ω: **C1 → 10, C2 → 11, C3 → 12, C4 → 13, C5 → A0, C6 → A1, C7 → A2, C8 → A3**. The A pins work as normal digital pins too.",
      parts: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `R${i}`),
      wires: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [[`BOARD.${["D10", "D11", "D12", "D13", "A0", "A1", "A2", "A3"][i - 1]}`, `R${i}.1`, "blue", ""], [`R${i}.2`, `M.C${i}`, "blue", ""]]),
    },
  ],
  stages: [
    {
      title: "1 · One dot",
      text: "All rows LOW and all columns HIGH (everything off), then row 1 HIGH and column 1 LOW: the top-left dot lights. If yours doesn't, your matrix is wired the other way round: swap HIGH and LOW.",
      code: `const int ROW[8] = {2, 3, 4, 5, 6, 7, 8, 9};
const int COL[8] = {10, 11, 12, 13, A0, A1, A2, A3};

void setup() {
  for (int i = 0; i < 8; i++) {
    pinMode(ROW[i], OUTPUT);
    pinMode(COL[i], OUTPUT);
    digitalWrite(ROW[i], LOW);    // rows off
    digitalWrite(COL[i], HIGH);   // columns off
  }
  digitalWrite(ROW[0], HIGH);     // row 1 on
  digitalWrite(COL[0], LOW);      // column 1 on → one dot
}

void loop() {
}`,
      hl: ["const int ROW[8]", "const int COL[8]", "digitalWrite(ROW[0], HIGH)", "digitalWrite(COL[0], LOW)"],
      try: "the top-left dot lights",
    },
    {
      title: "2 · A falling line",
      text: "All columns on, then light the rows one after another: a line sweeps down the matrix.",
      code: `const int ROW[8] = {2, 3, 4, 5, 6, 7, 8, 9};
const int COL[8] = {10, 11, 12, 13, A0, A1, A2, A3};

void setup() {
  for (int i = 0; i < 8; i++) {
    pinMode(ROW[i], OUTPUT);
    pinMode(COL[i], OUTPUT);
    digitalWrite(ROW[i], LOW);
    digitalWrite(COL[i], LOW);    // every column on
  }
}

void loop() {
  for (int r = 0; r < 8; r++) {
    digitalWrite(ROW[r], HIGH);
    delay(150);
    digitalWrite(ROW[r], LOW);
  }
}`,
      hl: ["digitalWrite(ROW[r], HIGH)", "digitalWrite(ROW[r], LOW)"],
      try: "a line falls, over and over",
    },
    {
      title: "3 · Draw a smiley",
      text: "The picture is 8 bytes, one per row; a **1** bit is a lit dot (look at the B… numbers: you can see the face). For each row, set the 8 columns from its bits, light the row for 2 ms, move on.",
      code: `const int ROW[8] = {2, 3, 4, 5, 6, 7, 8, 9};
const int COL[8] = {10, 11, 12, 13, A0, A1, A2, A3};
const byte SMILE[8] = {
  B00111100,
  B01000010,
  B10100101,
  B10000001,
  B10100101,
  B10011001,
  B01000010,
  B00111100
};

void setup() {
  for (int i = 0; i < 8; i++) {
    pinMode(ROW[i], OUTPUT);
    pinMode(COL[i], OUTPUT);
  }
}

void loop() {
  for (int r = 0; r < 8; r++) {
    for (int c = 0; c < 8; c++) {
      digitalWrite(COL[c], bitRead(SMILE[r], 7 - c) ? LOW : HIGH);
    }
    digitalWrite(ROW[r], HIGH);
    delay(2);
    digitalWrite(ROW[r], LOW);
  }
}`,
      hl: ["const byte SMILE[8]", "bitRead(SMILE[r], 7 - c) ? LOW : HIGH", "delay(2)"],
      try: "a smiley face",
    },
  ],
  tips: ["The row/column map used here is the common 1088AS one. If the picture comes out scrambled, run part 1 for each pin to find yours.", "Out of pins? Two 74HC595s can drive the whole matrix from 3 pins."],
});

L({
  id: "lcd", focus: "LCD", group: 4, emoji: "📟", title: "1602 LCD screen", minutes: 8, say: "lcd|screen",
  summary: "Print a message, count seconds, then show a live sensor reading.",
  intro: "A screen of **2 lines × 16 characters**. The built-in **LiquidCrystal** library drives it over 6 wires: **RS, E and D4–D7**. The potentiometer on **V0** sets the **contrast**: if you see nothing (or only boxes), turn it. **A and K** are the backlight. It's 12 wires, so take your time and check each one.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", "Shares 5 V and GND."],
    ["LCD", "lcd", "1602 LCD", "", ""],
    ["POT", "potentiometer", "10K (contrast)", "10k", "Sets the contrast.", 0.15],
    ["RB", "resistor", "220 Ω", "220", "For the backlight."],
  ],
  build: [
    {
      title: "Power and contrast",
      text: "Rails: **5V → +**, **GND → −**. LCD **VSS → −**, **VDD → +**, **RW → −** (we only write), **K → −**, **A → 220 Ω → +**. Contrast pot: outer legs to **+** and **−**, middle to **V0**.",
      parts: ["BB", "LCD", "POT", "RB"],
      wires: [["BOARD.5V", "BB.+", "red", ""], ["BOARD.GND", "BB.-", "black", ""], ["LCD.VSS", "BB.-", "black", ""], ["LCD.VDD", "BB.+", "red", ""], ["LCD.RW", "BB.-", "black", "Write mode."], ["LCD.K", "BB.-", "black", ""], ["LCD.A", "RB.1", "red", "Backlight +."], ["RB.2", "BB.+", "red", ""], ["POT.1", "BB.-", "black", ""], ["POT.2", "BB.+", "red", ""], ["POT.W", "LCD.V0", "orange", "Contrast."]],
    },
    {
      title: "Six data wires",
      text: "**RS → 12**, **E → 11**, **D4 → 5**, **D5 → 4**, **D6 → 3**, **D7 → 2**. D0–D3 stay empty.",
      parts: [],
      wires: [["BOARD.D12", "LCD.RS", "green", ""], ["BOARD.D11", "LCD.E", "yellow", ""], ["BOARD.D5", "LCD.D4", "blue", ""], ["BOARD.D4", "LCD.D5", "blue", ""], ["BOARD.D3", "LCD.D6", "blue", ""], ["BOARD.D2", "LCD.D7", "blue", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Hello!",
      text: "`LiquidCrystal lcd(12, 11, 5, 4, 3, 2)` lists the pins: RS, E, D4, D5, D6, D7. `begin(16, 2)` starts it. `print()` writes at the cursor, `setCursor(column, row)` moves it (counting from 0).",
      code: `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);  // RS, E, D4, D5, D6, D7

void setup() {
  lcd.begin(16, 2);
  lcd.print("Hello, Yaver!");
  lcd.setCursor(0, 1);       // column 0, line 2
  lcd.print("My kit works :)");
}

void loop() {
}`,
      hl: ["LiquidCrystal lcd(12, 11, 5, 4, 3, 2)", "lcd.begin(16, 2)", "lcd.setCursor(0, 1)"],
      try: "the message appears (turn the contrast slider if it fades)",
    },
    {
      title: "2 · Counting seconds",
      text: "Line 1 stays; line 2 is rewritten every second with **millis() / 1000**. Printing over old text replaces it.",
      code: `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

void setup() {
  lcd.begin(16, 2);
  lcd.print("Uptime:");
}

void loop() {
  unsigned long secs = millis() / 1000;
  lcd.setCursor(0, 1);
  lcd.print(secs);
  lcd.print(" seconds");
  delay(1000);
}`,
      hl: ["millis() / 1000", "lcd.print(secs)"],
      try: "the seconds tick",
    },
    {
      title: "3 · A live reading",
      text: "Show the contrast knob's own reading as a number and a bar of # signs that grows with it: any sensor works the same way. `lcd.clear()` wipes the screen first.",
      code: `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

void setup() {
  lcd.begin(16, 2);
}

void loop() {
  int value = analogRead(A0);
  int bars = map(value, 0, 1023, 0, 16);
  lcd.clear();
  lcd.print("A0 = ");
  lcd.print(value);
  lcd.setCursor(0, 1);
  for (int i = 0; i < bars; i++) lcd.print("#");
  delay(250);
}`,
      hl: ["map(value, 0, 1023, 0, 16)", "lcd.clear()", "lcd.print(\"#\")"],
      try: "A0 isn't wired here, so it wanders: wire any sensor from earlier to A0 and it shows that",
    },
  ],
  tips: ["Only boxes on line 1? Power and contrast are fine but the data wires aren't: check RS, E and D4–D7.", "Nothing at all? Turn the contrast knob slowly from end to end."],
});

// ---- Modules ------------------------------------------------------------------------------------

L({
  id: "keypad", group: 5, emoji: "🔢", title: "4×4 keypad", minutes: 7, say: "keypad",
  summary: "Read keys, type a number, then unlock with a secret code.",
  intro: "16 keys in **4 rows and 4 columns** (8 wires). Pressing a key joins its row to its column. The **Keypad** library checks the rows and columns many times a second to find which. Install it in **Tools → Manage Libraries**: search **Keypad** (by Mark Stanley).",
  parts: [["KP", "keypad", "4×4 keypad", "", ""]],
  build: [{
    title: "Eight wires",
    text: "Looking at the keys, the 8 pins go left to right: **R1 → 9, R2 → 8, R3 → 7, R4 → 6, C1 → 5, C2 → 4, C3 → 3, C4 → 2**.",
    parts: ["KP"],
    wires: [["KP.R1", "BOARD.D9", "red", ""], ["KP.R2", "BOARD.D8", "orange", ""], ["KP.R3", "BOARD.D7", "yellow", ""], ["KP.R4", "BOARD.D6", "green", ""], ["KP.C1", "BOARD.D5", "blue", ""], ["KP.C2", "BOARD.D4", "purple", ""], ["KP.C3", "BOARD.D3", "grey", ""], ["KP.C4", "BOARD.D2", "white", ""]],
  }],
  stages: [
    {
      title: "1 · Which key?",
      text: "A 2D array maps rows and columns to labels. `getKey()` returns the key just pressed, or 0 if none. Click the keypad on the left, or type 0–9, A–D, * and #.",
      code: `#include <Keypad.h>
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

void setup() {
  Serial.begin(9600);
}

void loop() {
  char key = keypad.getKey();
  if (key) {
    Serial.print("Pressed: ");
    Serial.println(key);
  }
}`,
      hl: ["char keys[ROWS][COLS]", "byte rowPins", "keypad.getKey()", "if (key)"],
      try: "press some keys",
    },
    {
      title: "2 · Type a number",
      text: "Digits build a number (number × 10 + new digit). **#** is Enter and prints it; **\\*** clears. `key - '0'` turns the character '7' into the number 7.",
      code: `#include <Keypad.h>
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
long number = 0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  char key = keypad.getKey();
  if (key >= '0' && key <= '9') {
    number = number * 10 + (key - '0');
    Serial.println(number);
  } else if (key == '#') {
    Serial.print("You entered: ");
    Serial.println(number);
    number = 0;
  } else if (key == '*') {
    number = 0;
    Serial.println("Cleared");
  }
}`,
      hl: ["number * 10 + (key - '0')", "key == '#'", "key == '*'"],
      try: "type 42 then #",
    },
    {
      title: "3 · A code lock",
      text: "Type **1234** then **#**: right code, the L LED lights for 3 s; wrong, it blinks fast. Change SECRET to your own.",
      code: `#include <Keypad.h>
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
const long SECRET = 1234;
const int LED = 13;
long number = 0;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Enter the code, then #");
}

void loop() {
  char key = keypad.getKey();
  if (key >= '0' && key <= '9') {
    number = number * 10 + (key - '0');
    Serial.print("*");
  } else if (key == '#') {
    Serial.println();
    if (number == SECRET) {
      Serial.println("Unlocked!");
      digitalWrite(LED, HIGH);
      delay(3000);
      digitalWrite(LED, LOW);
    } else {
      Serial.println("Wrong code");
      for (int i = 0; i < 6; i++) { digitalWrite(LED, i % 2 == 0); delay(100); }
    }
    number = 0;
  }
}`,
      hl: ["const long SECRET = 1234", "number == SECRET", "Unlocked!"],
      try: "type 1234 then #",
    },
  ],
});

L({
  id: "ir", group: 5, emoji: "📡", title: "IR remote and receiver", minutes: 6, say: "remote|infrared|ir",
  summary: "See each button's code, then switch and dim an LED from the remote.",
  intro: "The remote flashes **invisible infrared light** in a code. The **receiver** (VS1838B) decodes the flashes into a signal on **OUT**. Facing its dome: left **OUT**, middle **GND**, right **VCC**. Install the **IRremote** library (by shirriff, z3t0, ArminJo) in **Manage Libraries**. Every button sends its own **command** number.",
  parts: [
    ["IR", "ir", "IR receiver", "", ""],
    ["R1", "resistor", "220 Ω", "220", ""],
    ["LED", "led", "Red LED", "red", ""],
  ],
  build: [{
    title: "Receiver and LED",
    text: "Receiver: **OUT → 11**, **GND → GND**, **VCC → 5V**. LED on **pin 9** (a ~ pin) through 220 Ω.",
    parts: ["IR", "R1", "LED"],
    wires: [["IR.OUT", "BOARD.D11", "green", ""], ["IR.GND", "BOARD.GND", "black", ""], ["IR.VCC", "BOARD.5V", "red", ""], ["BOARD.D9", "R1.1", "red", ""], ["R1.2", "LED.A", "red", ""], ["LED.K", "BOARD.GND", "black", ""]],
  }],
  stages: [
    {
      title: "1 · Read the codes",
      text: "`IrReceiver.begin(11)` starts listening. When `decode()` is true a button was caught: print its **command** in hexadecimal, then `resume()` to listen again. Press keys on the remote on the left. Write down the codes: your real remote may differ.",
      code: `#include <IRremote.hpp>

void setup() {
  Serial.begin(9600);
  IrReceiver.begin(11, ENABLE_LED_FEEDBACK);
}

void loop() {
  if (IrReceiver.decode()) {
    Serial.print("Command: 0x");
    Serial.println(IrReceiver.decodedIRData.command, HEX);
    IrReceiver.resume();   // ready for the next one
  }
}`,
      hl: ["IrReceiver.begin(11", "IrReceiver.decode()", "decodedIRData.command, HEX", "IrReceiver.resume()"],
      try: "press remote keys",
    },
    {
      title: "2 · On, off and dimmer",
      text: "A **switch** picks the action by code: **1** on, **2** off, **+** and **−** change the brightness by 50.",
      code: `#include <IRremote.hpp>
const int LED = 9;
int brightness = 0;

void setup() {
  IrReceiver.begin(11, ENABLE_LED_FEEDBACK);
  pinMode(LED, OUTPUT);
}

void loop() {
  if (IrReceiver.decode()) {
    switch (IrReceiver.decodedIRData.command) {
      case 0x0C: brightness = 255; break;  // 1: on
      case 0x18: brightness = 0; break;    // 2: off
      case 0x15: brightness = brightness + 50; break;  // +
      case 0x07: brightness = brightness - 50; break;  // −
    }
    brightness = constrain(brightness, 0, 255);
    analogWrite(LED, brightness);
    IrReceiver.resume();
  }
}`,
      hl: ["switch (IrReceiver.decodedIRData.command)", "case 0x0C", "case 0x15", "constrain(brightness"],
      try: "remote 1 = on, 2 = off, + and − dim",
    },
  ],
  tips: ["Remove the clear plastic tab from the remote's battery first."],
});

L({
  id: "rtc", group: 5, emoji: "🕰️", title: "DS1302 real-time clock", minutes: 6, say: "clock|rtc|ds1302",
  summary: "Set the clock once, print the time every second, then an alarm.",
  intro: "The **DS1302** keeps the date and time running, even with the Arduino off, thanks to its coin cell. Install **Rtc by Makuna** in **Manage Libraries**. It talks over 3 wires: **CLK**, **DAT** and **RST**.",
  parts: [["CLK", "ds1302", "DS1302 module", "", ""]],
  build: [{
    title: "Wire it",
    text: "**VCC → 5V**, **GND → GND**, **CLK → 6**, **DAT → 7**, **RST → 8**.",
    parts: ["CLK"],
    wires: [["CLK.VCC", "BOARD.5V", "red", ""], ["CLK.GND", "BOARD.GND", "black", ""], ["CLK.CLK", "BOARD.D6", "yellow", ""], ["CLK.DAT", "BOARD.D7", "green", ""], ["CLK.RST", "BOARD.D8", "blue", ""]],
  }],
  stages: [
    {
      title: "1 · Set the time",
      text: "`__DATE__` and `__TIME__` are the moment you compiled the sketch: a handy way to set the clock. Upload this once, then the module remembers.",
      code: `#include <ThreeWire.h>
#include <RtcDS1302.h>
ThreeWire myWire(7, 6, 8);   // DAT, CLK, RST
RtcDS1302<ThreeWire> Rtc(myWire);

void setup() {
  Serial.begin(9600);
  Rtc.Begin();
  Rtc.SetIsWriteProtected(false);
  Rtc.SetIsRunning(true);
  RtcDateTime compiled = RtcDateTime(__DATE__, __TIME__);
  Rtc.SetDateTime(compiled);
  Serial.println("Clock set!");
}

void loop() {
}`,
      hl: ["ThreeWire myWire(7, 6, 8)", "RtcDateTime(__DATE__, __TIME__)", "Rtc.SetDateTime(compiled)"],
      try: "it prints Clock set!",
    },
    {
      title: "2 · A clock",
      text: "Every second, read the time and print hh:mm:ss. **print2()** adds a leading zero so 9 prints as 09.",
      code: `#include <ThreeWire.h>
#include <RtcDS1302.h>
ThreeWire myWire(7, 6, 8);   // DAT, CLK, RST
RtcDS1302<ThreeWire> Rtc(myWire);

void print2(int v) {
  if (v < 10) Serial.print("0");
  Serial.print(v);
}

void setup() {
  Serial.begin(9600);
  Rtc.Begin();
}

void loop() {
  RtcDateTime now = Rtc.GetDateTime();
  print2(now.Hour());   Serial.print(":");
  print2(now.Minute()); Serial.print(":");
  print2(now.Second()); Serial.println();
  delay(1000);
}`,
      hl: ["Rtc.GetDateTime()", "void print2", "now.Hour()"],
      try: "the time ticks in the Serial monitor",
    },
    {
      title: "3 · An alarm",
      text: "Pick a minute (here: the next minute after you press Run). When the clock reaches it, the L LED blinks for the whole minute.",
      code: `#include <ThreeWire.h>
#include <RtcDS1302.h>
ThreeWire myWire(7, 6, 8);   // DAT, CLK, RST
RtcDS1302<ThreeWire> Rtc(myWire);
const int LED = 13;
int alarmMinute = 0;

void setup() {
  Serial.begin(9600);
  pinMode(LED, OUTPUT);
  Rtc.Begin();
  RtcDateTime now = Rtc.GetDateTime();
  alarmMinute = (now.Minute() + 1) % 60;   // one minute from now
  Serial.print("Alarm at minute ");
  Serial.println(alarmMinute);
}

void loop() {
  RtcDateTime now = Rtc.GetDateTime();
  if (now.Minute() == alarmMinute) {
    digitalWrite(LED, HIGH); delay(250);
    digitalWrite(LED, LOW);  delay(250);
  } else {
    delay(500);
  }
}`,
      hl: ["alarmMinute = (now.Minute() + 1) % 60", "now.Minute() == alarmMinute"],
      try: "wait for the next minute: the L LED blinks",
    },
  ],
  tips: ["Seeing times like 45:165:85? The data wires are mixed up. Check CLK, DAT and RST."],
});

L({
  id: "rfid", group: 5, emoji: "🪪", title: "RC522 RFID reader", minutes: 8, say: "rfid|card|rc522",
  summary: "Read a card's ID, let only your card in, then open a servo lock. The final project!",
  intro: "The **RC522** sends out a radio field. Hold the **card** or **key tag** near it and the tag wakes up and answers with its **ID number (UID)**. It talks **SPI**, which on the Uno uses fixed pins **13 (SCK), 11 (MOSI), 12 (MISO)**. It runs on **3.3 V**: 5 V can damage it. Install **MFRC522** (by GithubCommunity) in **Manage Libraries**. You'll need to solder the pin header onto it first, or hold it in firmly.",
  parts: [
    ["BB", "breadboard", "Breadboard", "", ""],
    ["RF", "rfid", "RC522 reader", "", ""],
    ["RG", "resistor", "220 Ω", "220", ""], ["LG", "led", "Green LED", "green", "Welcome."],
    ["RR", "resistor", "220 Ω", "220", ""], ["LR", "led", "Red LED", "red", "Access denied."],
    ["SV", "servo", "9g servo (the lock)", "", "For part 3."],
  ],
  build: [
    {
      title: "Wire the reader",
      text: "**SDA → 10**, **SCK → 13**, **MOSI → 11**, **MISO → 12**, **RST → 9**, **GND → GND**, **3.3V → 3.3V** (not 5V!). IRQ stays empty.",
      parts: ["BB", "RF"],
      wires: [["RF.SDA", "BOARD.D10", "yellow", "Chip select."], ["RF.SCK", "BOARD.D13", "orange", "SPI clock."], ["RF.MOSI", "BOARD.D11", "blue", "Data to the reader."], ["RF.MISO", "BOARD.D12", "green", "Data back."], ["RF.RST", "BOARD.D9", "white", "Reset."], ["RF.GND", "BOARD.GND", "black", ""], ["RF.3.3V", "BOARD.3V3", "red", "3.3 V only."]],
    },
    {
      title: "Two LEDs and the lock",
      text: "Breadboard: **5V → +**, **GND → −**. Green LED **pin 5 → 220 Ω**, red **pin 4 → 220 Ω**, short legs to −. Servo: **brown → −**, **red → +**, **orange → pin 6**.",
      parts: ["RG", "LG", "RR", "LR", "SV"],
      wires: [["BOARD.5V", "BB.+", "red", ""], ["BOARD.GND", "BB.-", "black", ""], ["BOARD.D5", "RG.1", "green", ""], ["RG.2", "LG.A", "green", ""], ["LG.K", "BB.-", "black", ""], ["BOARD.D4", "RR.1", "red", ""], ["RR.2", "LR.A", "red", ""], ["LR.K", "BB.-", "black", ""], ["SV.GND", "BB.-", "brown", ""], ["SV.V+", "BB.+", "red", ""], ["BOARD.D6", "SV.SIG", "orange", ""]],
    },
  ],
  stages: [
    {
      title: "1 · Read the ID",
      text: "Each pass of loop(): no new card → **return** (start loop() again). Otherwise read it and print the 4 bytes of its UID in hex. Tap the card and the tag on the left. On your real kit, **write down your card's ID**: you'll need it next.",
      code: `#include <SPI.h>
#include <MFRC522.h>
MFRC522 rfid(10, 9);   // SDA, RST

void setup() {
  Serial.begin(9600);
  SPI.begin();
  rfid.PCD_Init();
  Serial.println("Hold a card to the reader...");
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;
  Serial.print("Card ID:");
  for (byte i = 0; i < rfid.uid.size; i++) {
    Serial.print(" ");
    if (rfid.uid.uidByte[i] < 0x10) Serial.print("0");
    Serial.print(rfid.uid.uidByte[i], HEX);
  }
  Serial.println();
  rfid.PICC_HaltA();
}`,
      hl: ["MFRC522 rfid(10, 9)", "PICC_IsNewCardPresent()", "PICC_ReadCardSerial()", "uidByte[i], HEX"],
      try: "tap the card, then the tag",
    },
    {
      title: "2 · Only my card",
      text: "Keep your card's ID in an array and compare it byte by byte in **isAllowed()**. Match: green LED. Anything else: red. (Here the white card is \"yours\": put your real ID in.)",
      code: `#include <SPI.h>
#include <MFRC522.h>
MFRC522 rfid(10, 9);
const int GREEN = 5, RED = 4;
byte myCard[4] = {0x93, 0x2A, 0x7C, 0x1E};   // ← your card's ID

bool isAllowed() {
  for (byte i = 0; i < 4; i++) {
    if (rfid.uid.uidByte[i] != myCard[i]) return false;
  }
  return true;
}

void setup() {
  SPI.begin();
  rfid.PCD_Init();
  pinMode(GREEN, OUTPUT);
  pinMode(RED, OUTPUT);
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;
  int led = isAllowed() ? GREEN : RED;
  digitalWrite(led, HIGH);
  delay(1500);
  digitalWrite(led, LOW);
  rfid.PICC_HaltA();
}`,
      hl: ["byte myCard[4]", "bool isAllowed()", "isAllowed() ? GREEN : RED"],
      try: "the card gets green, the tag gets red",
    },
    {
      title: "3 · A door lock",
      text: "Put it together: the right card turns the servo to **open** (90°) for 3 seconds, then it **locks** again (0°). Wrong card: red LED and three beeps of the L LED. That's a real access-control system, from your kit.",
      code: `#include <SPI.h>
#include <MFRC522.h>
#include <Servo.h>
MFRC522 rfid(10, 9);
Servo lock;
const int GREEN = 5, RED = 4;
byte myCard[4] = {0x93, 0x2A, 0x7C, 0x1E};

bool isAllowed() {
  for (byte i = 0; i < 4; i++) {
    if (rfid.uid.uidByte[i] != myCard[i]) return false;
  }
  return true;
}

void setup() {
  SPI.begin();
  rfid.PCD_Init();
  lock.attach(6);
  lock.write(0);            // locked
  pinMode(GREEN, OUTPUT);
  pinMode(RED, OUTPUT);
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;
  if (isAllowed()) {
    digitalWrite(GREEN, HIGH);
    lock.write(90);         // open
    delay(3000);
    lock.write(0);          // lock again
    digitalWrite(GREEN, LOW);
  } else {
    digitalWrite(RED, HIGH);
    delay(1500);
    digitalWrite(RED, LOW);
  }
  rfid.PICC_HaltA();
}`,
      hl: ["lock.write(90)", "lock.write(0);          // lock again", "if (isAllowed())"],
      try: "the white card opens the lock",
    },
  ],
  tips: ["Run it from the 9 V battery clip and it works with no computer at all."],
});

// ---- Groups, numbering, and building a plan -----------------------------------------------------

const GROUPS = [
  { label: "Start here", title: "The board" },
  { label: "Motors", title: "Make things move" },
  { label: "Lights and sound", title: "Outputs" },
  { label: "Sensors", title: "Inputs" },
  { label: "Displays", title: "Show numbers, pictures and text" },
  { label: "Modules", title: "Keypad, remote, clock and RFID" },
];

LESSONS.forEach((l, i) => { l.n = i + 1; });

export const KIT = {
  title: "My Arduino kit",
  lead: `A short lesson for every part of your <b>RFID UNO Kit</b>. Each one wires the part up, runs it <b>once</b>, then in a <b>loop</b>, then makes it <b>react</b>. Run every program here, then copy it to your real Uno.`,
  lessons: LESSONS,
  groups: GROUPS.map((g, i) => ({ ...g, lessons: LESSONS.filter((l) => l.group === i) })),
};

// The pins a part's kind has, or the Uno's.
function pinOk(id, pin, types) {
  if (id === "BOARD") return BOARD_PINS.has(pin);
  return (KINDS[types.get(id)] ?? []).includes(pin);
}

function end(s, types) {
  const i = s.indexOf(".");
  const part = s.slice(0, i), pin = s.slice(i + 1);
  if (!pinOk(part, pin, types)) throw new Error(`Kit lesson: no pin ${s}`);
  return { part, pin };
}

const footer = (l) => `
  <ol>
    <li>Build it on your bench as shown (the parts list is on the first step).</li>
    <li>Open the <b>Arduino IDE</b> and plug in the Uno. Pick <b>Tools → Board → Arduino Uno</b>, then <b>Tools → Port</b>: your CH340 board shows as <b>/dev/cu.usbserial-…</b> (or <b>cu.wchusbserial…</b>).</li>
    ${l.libs ? `<li>Libraries: ${l.libs}</li>` : ""}
    <li>Copy a program (the ⧉ button), paste it in and press <b>Upload</b> (→).${l.stages.some((s) => /Serial\./.test(s.code)) ? " Open <b>Tools → Serial Monitor</b> at <b>9600</b> to see its messages." : ""}</li>
  </ol>
  <p class="tip">No port in the list? Use the kit's own USB cable (some cables only charge), try another USB port or adapter, and if it still doesn't show, install the <b>CH34x driver</b> from <b>wch-ic.com</b> and restart.</p>
  ${l.tips?.length ? `<h4>Tips</h4><ul>${l.tips.map((t) => `<li>${t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</li>`).join("")}</ul>` : ""}`;

const LIBS = {
  dht11: "<b>Tools → Manage Libraries</b>, install <b>DHT sensor library</b> by Adafruit (say yes to its dependencies).",
  keypad: "<b>Tools → Manage Libraries</b>, install <b>Keypad</b> by Mark Stanley.",
  ir: "<b>Tools → Manage Libraries</b>, install <b>IRremote</b>.",
  rtc: "<b>Tools → Manage Libraries</b>, install <b>Rtc by Makuna</b>.",
  rfid: "<b>Tools → Manage Libraries</b>, install <b>MFRC522</b>.",
};

const cache = new Map();
// The project plan for a kit lesson, in the shape the project player takes.
export function kitPlan(id) {
  if (cache.has(id)) return cache.get(id);
  const l = LESSONS.find((x) => x.id === id);
  if (!l) return null;
  const types = new Map(l.parts.map(([pid, type]) => [pid, type]));
  const parts = l.parts.map(([pid, type, label, value, why, start]) => ({ id: pid, type, label, value: value ?? "", pins: KINDS[type], why: why ?? "", ...(start !== undefined ? { start } : {}) }));
  const wires = [];
  const steps = l.build.map((b) => {
    const idx = b.wires.map(([from, to, color, why]) => { wires.push({ from: end(from, types), to: end(to, types), color, why: why ?? "" }); return wires.length - 1; });
    return { title: b.title, text: b.text, parts: b.parts, wires: idx, code_lines: [] };
  });
  const stages = l.stages.map((st) => {
    const lines = st.code.split("\n");
    const hl = [];
    for (const h of st.hl ?? []) {
      const k = lines.findIndex((line, i) => line.includes(h) && !hl.includes(i + 1));
      if (k < 0) throw new Error(`Kit lesson ${id}: no line with "${h}"`);
      hl.push(k + 1);
    }
    return { title: st.title, text: st.text, code: st.code, lines: hl, try: st.try };
  });
  const plan = {
    title: l.title, summary: l.intro, board: "uno", parts, wires, steps, stages,
    code: stages[0].code, tips: [], warnings: [],
    kit: { id: l.id, n: l.n, focus: l.focus, footer: footer({ ...l, libs: LIBS[l.id] }) },
  };
  cache.set(id, plan);
  return plan;
}
