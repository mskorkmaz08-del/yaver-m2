// A ready-made project plan, in the same shape the AI returns, so the
// project tutor can be tried before any key is added.
const PIANO_CODE = `// Arduino piano: seven keys play C D E F G A B.
const int BUZZER = 9;
const int KEYS[] = {2, 3, 4, 5, 6, 7, 8};
// Note frequencies in hertz (C4 to B4).
const int NOTES[] = {262, 294, 330, 349, 392, 440, 494};

void setup() {
  for (int i = 0; i < 7; i++) {
    pinMode(KEYS[i], INPUT_PULLUP); // pressed = LOW
  }
  pinMode(BUZZER, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int playing = -1;
  for (int i = 0; i < 7; i++) {
    if (digitalRead(KEYS[i]) == LOW) {
      playing = i;
      break; // the lowest pressed key wins
    }
  }
  if (playing >= 0) {
    tone(BUZZER, NOTES[playing]);
  } else {
    noTone(BUZZER);
  }
  delay(10);
}`;

const KEY_NAMES = ["C", "D", "E", "F", "G", "A", "B"];

export const PIANO = {
  title: "Seven-key Arduino piano",
  summary: "Seven push buttons are the piano keys and a piezo buzzer is the speaker. The Arduino checks the keys about a hundred times a second and plays the note of the key you press with tone().",
  board: "uno",
  parts: [
    { id: "BB", type: "breadboard", label: "Breadboard", value: "", pins: [], why: "Its long − rail lets all seven keys share the Arduino's GND." },
    ...KEY_NAMES.map((n, i) => ({ id: `K${i + 1}`, type: "button", label: `Key ${n}`, value: "", pins: [], why: `The ${n} key. Pressing it joins pin ${i + 2} to GND.` })),
    { id: "BZ", type: "buzzer", label: "Piezo buzzer", value: "", pins: [], why: "The speaker. tone() switches it on and off at the note's frequency." },
  ],
  wires: [
    { from: "BOARD.GND", to: "BB.-", color: "black", why: "Brings the Arduino's ground to the − rail." },
    ...KEY_NAMES.map((n, i) => ({ from: `BOARD.D${i + 2}`, to: `K${i + 1}.1`, color: ["orange", "yellow", "green", "blue", "purple", "white", "grey"][i], why: `Pin ${i + 2} reads the ${n} key.` })),
    ...KEY_NAMES.map((n, i) => ({ from: `K${i + 1}.2`, to: "BB.-", color: "black", why: `The other side of the ${n} key goes to GND.` })),
    { from: "BOARD.D9", to: "BZ.+", color: "red", why: "Pin 9 drives the buzzer with the note." },
    { from: "BZ.-", to: "BOARD.GND", color: "black", why: "The buzzer's − leg goes to ground." },
  ],
  code: PIANO_CODE,
  steps: [
    { title: "Ground rail", text: "Put the **breadboard** next to the Arduino and run a black wire from **GND** to the blue **−** rail. Every key will use this rail as its ground.", parts: ["BB"], wires: [0], code_lines: [] },
    { title: "The first three keys", text: "Place keys C, D and E. Wire one side of each key to pins **2**, **3** and **4**, and the other side to the **−** rail. Pressing a key joins its pin to GND, so the pin reads LOW.", parts: ["K1", "K2", "K3"], wires: [1, 2, 3, 8, 9, 10], code_lines: [] },
    { title: "Four more keys", text: "Do the same for F, G, A and B on pins **5**, **6**, **7** and **8**. No resistors are needed: the Arduino's own pull-up resistors hold each pin HIGH until its key is pressed.", parts: ["K4", "K5", "K6", "K7"], wires: [4, 5, 6, 7, 11, 12, 13, 14], code_lines: [] },
    { title: "The speaker", text: "Push the **buzzer** in with its long **+** leg wired to pin **9** and its **−** leg to **GND**. A piezo buzzer clicks each time the voltage changes, so switching it 440 times a second plays an A.", parts: ["BZ"], wires: [15, 16], code_lines: [] },
    { title: "Code: pins and notes", text: "The sketch names the buzzer pin and lists the seven key pins and their notes in two arrays, in the same order. In **setup()** each key pin becomes an input with its pull-up switched on.", parts: [], wires: [], code_lines: [2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13] },
    { title: "Code: playing a note", text: "**loop()** runs over and over. It looks for a key reading LOW (pressed), then plays that key's note with **tone()**. When no key is down, **noTone()** stops the sound.", parts: [], wires: [], code_lines: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29] },
  ],
  tips: [
    "Press keys 1 to 7 on your keyboard (or click the buttons) to play it in the simulator.",
    "Want two octaves? Double each frequency for the next C to B up.",
    "Use a passive piezo buzzer: an active one only beeps at one pitch.",
  ],
};
