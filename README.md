# Yaver Mark II

Yaver Mark II is a voice-first personal assistant with a 3D editor that you control with your hands through the webcam. It runs on its own, separate from the first Yaver app.

The first feature is **Yaver Studio**. You pinch shapes from a shelf, move them in 3D, push and pull them in depth, scale and rotate them with two hands, and drop them in the bin.

The second is the **Robotics Academy**: a course of interactive 3D lessons on electronics, Arduino and the ESP32, ending in a robot simulator where you build, wire and program your own robot by hand.

Live at https://mskorkmaz08-del.github.io/yaver-m2/. In Chrome, install it with the install icon in the address bar, then use **Keep in Dock**.

## Using it

The app opens on **Yaver's home screen**, a big orb you talk to. To use the **3D Studio**, click the 3D Studio button or say "open the studio". To come back, use the ← button, press Esc, or say "go home". The camera only runs while the Studio is open.

## Robotics Academy

Click **Robotics Academy** on the home screen, or say "open the course". Every lesson is a 3D scene of real parts at real size that you can turn, zoom and point at, with step-by-step animations: charges flowing round a circuit, a breadboard's hidden clips, Blink running line by line next to an oscilloscope, an H-bridge reversing a motor, sound bouncing off a wall.

- **Module 1, Electronics:** voltage, current and resistance (Ohm's law, and what happens without a resistor); inside an LED and the resistor colour code; the breadboard.
- **Module 2, Arduino:** a tour of the Uno; Blink; buttons, pull-ups and bounce; PWM with analogWrite.
- **Module 3, ESP32 and robotics:** a tour of the ESP32 and its pin rules; motors and the L298N H-bridge; the HC-SR04 ultrasonic sensor.
- **Robot simulator:** pull parts off the shelf and fit them to the chassis (two TT motors and wheels, a ball caster, a 2 × 18650 battery pack, an L298N driver, an ESP32 and an HC-SR04), wire them pin to pin, edit the Arduino sketch, and run it in an arena. The electrics follow your actual wiring, so a missing ground, a motor on the wrong outputs or a pin mix-up behaves as it would on the bench. "Assemble it for me" and "Wire it for me" show the reference build.

With the camera: pinch to press buttons, drag sliders and grab parts; pinch empty space and move to turn the view; pinch with both hands to zoom; sweep an open hand sideways to change step. The mouse and arrow keys work too. Voice: "next", "back", "lesson 5", "open the simulator", "upload".

## My Arduino kit

At the top of the Academy, **My Arduino kit** has a short lesson for every part of Mustafa's own kit (the "RFID UNO Kit" with a CH340 Uno), 25 in all: the board itself; the servo and the 28BYJ-48 stepper with its ULN2003 board; LEDs and resistors, the button, active and passive buzzers, the RGB module and the relay; the potentiometer, photoresistor, joystick, tilt switch, KY-037 sound sensor, water sensor, LM35 and DHT11; the 1-digit and 4-digit 7-segment displays, the 74HC595, the 8×8 matrix and the 1602 LCD; and the 4×4 keypad, IR remote, DS1302 clock and RC522 RFID reader (which ends in an RFID door lock).

Each lesson wires the part up pin by pin in 3D, then runs two or three small programs that build on each other: do it **once**, repeat it in a **loop**, make it **react**. Every program runs in the simulator against the circuit as wired (the stepper turns step by step, displays multiplex, the LCD prints, the keypad, remote and RFID cards can be pressed or tapped, sensors have sliders) and copies straight into the Arduino IDE. The last step of each lesson covers uploading to the CH340 board on a Mac and any library to install. Lessons live in `src/academy/kit.js`, the new 3D parts in `kit-parts.js`, and the library stand-ins (Stepper, LiquidCrystal, DHT, Keypad, IRremote, MFRC522, Rtc by Makuna) in `kit-sim.js`. Links: `#academy/kit/<lesson>`, such as `#academy/kit/stepper`.

**Mini Yaver** (top of the Academy) is the tutorial for the Uno desk-AI project in `mini-yaver/`, the lean version with six parts: the 1602 LCD (Yaver's face, clock and the short answer, on D12 to D7, with its contrast pot and backlight resistor), a push button on D2, a passive buzzer on D3 (Yaver's voice), an RGB LED module on D5/D6/D4 through 220 Ω each (the mood light, fading smoothly between idle, listening, thinking and speaking) and the KY-037 sound sensor on A0, which is **Yaver's own ear**: the Uno records it at 8 kHz (Timer1 starts each ADC conversion and collects it on the next tick), listens while the button is held (or 8 s after a press or a double clap), and sends the recording to the page (`MIC`, the bytes, a 0, then `ME 1|0`). The page hands the recording to Gemini as a .wav, unchanged, and tunes the Uno's microphone boost (`MG`) after each use; Gemini's `[heard: …]` prefix is shown on the page and kept out of the answer. `mini-yaver/MicTest/MicTest.ino` measures how well the KY-037 hears a voice. The sketch is `mini-yaver/MiniYaver/MiniYaver.ino` and needs only libraries built into the Arduino IDE. **The internet link is a page, not a script**: `mini-yaver/index.html` + `mini-yaver/app.js` (live at `/yaver-m2/mini-yaver/`) runs in Chrome on the Mac, talks to the Uno over Web Serial (an Uno with an older v2/v3 sketch is heard through the Mac's microphone and Chrome speech recognition instead), asks Gemini with tools (timers, alarms, reminders, weather from Open-Meteo, the night clock) and speaks with Mark II's voice (`Speaker` from `src/assistant/voice.js`, Charon when there is a Gemini key) **through the Uno's buzzer**: the page filters the voice for a buzzer and streams it as 8-bit sound at 8000 samples a second (`VO`, bytes, a 0 byte; the Uno sends `V` for room and `VE` when done), and the sketch plays it with Timer1 (8 kHz tick) and Timer2's fast PWM on D3. Settings can send the voice to the Mac's speakers instead, and old v2 sketches fall back to them. `tests/mini-voice.mjs` checks the voice streaming and `tests/mini-mic.mjs` the Uno's recordings against a pretend Uno. It reuses the Gemini key already saved in this site (`src/assistant/keys.js`). Timers and alarms are kept on the Uno (EEPROM) and ring on the buzzer even if the page is closed.

**3D build** (`#academy/mini-yaver/3d`, plan in `src/academy/miniyaver-3d.js`) lays the six parts on a real breadboard in 7 steps; every wire end carries its pin name (yellow for Uno pins, blue for part pins), placed so they never overlap, and clicking a wire in the list shows only that wire. The wires run like lines on a chart (`harness()` in `bench.js`): straight up out of each plug, along, and straight down, each at its own height, so no two touch. The **wire list** (`#academy/mini-yaver/wires`, `src/academy/miniyaver-chart.js`) numbers every jumper as the 3D steps do, with from, to, colour, the hole it plugs into and why, and a pin chart where every wire is one straight line from an Uno pin to a part. The flat **wiring map** is at `#academy/mini-yaver`.

`tests/mini-wiring.mjs` checks the build (serve the repo on port 8765, then `node tests/mini-wiring.mjs`): every Uno pin against `MiniYaver.ino`, power on every part, that the breadboard as laid out joins exactly the planned nets, one plug per socket and hole, and that no two 3D wires touch. `tests/mini-brain.mjs` runs the brain page against a pretend Uno and a pretend Gemini: a spoken request becomes a timer on the Uno, the answer reaches the LCD in pieces, and a ring is spoken.

In every 3D view: drag turns, right-drag or two fingers on a trackpad move, pinch or the wheel zooms into the point under the pointer, and a double-click flies to a part. The Mini Yaver bench is only redrawn while something moves. **Wiring** is a clickable diagram of the six parts, built up in 7 steps with a checklist; click any part or Uno pin to see where it goes and why. **Code** walks through 11 sections of the real sketch and brain page, fetched live from `mini-yaver/`, and each note lights up the lines it explains. Code: `src/academy/miniyaver.js`.

Every circuit is built the way you would on the desk: a full 830-hole breadboard sits in front of the Uno, LEDs, resistors, chips and small sensors are plugged into its holes (legs that belong together share a column, ground goes to the − rail), and jumper wires run from the Uno's header pins to those holes and lie on the surfaces. Parts you hold, dip or that would cover every hole (servo, stepper, keypad, matrix, RC522, water and sound sensors) sit on the table and are joined by jumpers. The placement and routing live in `src/academy/bench.js`; each build step lists what to plug in and which hole each wire goes to.

## Project tutor

At the top of the Academy, **Make your own project**: type (or tell Yaver) what you want to build, such as "a piano from an Arduino". The AI designs it and the Academy shows it in 3D:

- **What you'll build** and the shopping list.
- **Build steps**: the parts drop onto the bench a few at a time, and every jumper wire is drawn pin to pin, with a list of what connects where and why.
- **The code**, explained a few lines at a time with those lines highlighted. ⧉ Copy puts it on the clipboard for the Arduino IDE.
- **Try it**: ▶ Run the code runs the sketch against the circuit exactly as it's wired. Buttons can be pressed (click, pinch, or keys 1 to 9), the buzzer really plays, LEDs light, servos turn, and sliders stand in for knobs, light and distance sensors. Serial output appears under the code.
- **Change it**: type a change ("add a volume knob", "use an ESP32") and the plan is redrawn.

Projects are kept in this browser, under the form. The piano example works without any key.

Which AI designs it: Google Gemini, with the same free key Yaver's voice uses (pasted once, or Mark One's). If a Claude (Anthropic) API key is pasted instead, Claude (`claude-opus-5-5`) designs it; that key is paid per use. Both keys stay in this browser and go only to Google or Anthropic.

By voice: "Yaver, I want to make a piano from an Arduino" (or anything with "make/build … Arduino/ESP32/circuit/robot…"). With Gemini Live, Yaver uses its `design_project` tool, and while a project is open it knows its parts, wiring and code, so you can ask it questions about them.

## Talking to Yaver

**Fastest: Gemini Live.** Click "Add free Gemini key" under the orb and paste a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) once; it stays in this browser (Mark One's key is used automatically if it's there). Then "Yaver", the orb or Space starts a real-time voice conversation: your voice streams to Google and Yaver answers in under a second in the "Charon" voice. You can interrupt just by talking, it can search the web, and it runs studio commands. The conversation ends after 20 seconds of silence or a click on the orb.

Without a key: say **"Yaver"** and then your request, click the orb, or hold **Space** and talk. You can also type. Yaver answers out loud, as soon as you stop talking, and then keeps listening for about 8 seconds so you can reply without saying "Yaver" again. A new request interrupts whatever Yaver was saying. The transcript is hidden; "Show text" brings it back.

- **Studio commands** run instantly, and from the home screen they open the Studio first. Examples: "add two red cubes", "delete it", "make it bigger", "paint it green", "zoom in", "clear the scene", "show the gestures".
- **Brain**, with nothing to type in:
  - If Yaver Mark One (the first app, on the same site) already has a free Google Gemini key in this browser, Mark II reuses it automatically: Gemini answers, fast. Mark One's data is only read, never changed.
  - Otherwise, click **Connect cloud brain** once: a free Puter account (puter.js) gives fast cloud models (GPT-5.4 nano). It is remembered after that.
  - Without either, a small model runs on the computer itself (Qwen 3.5 2B via WebLLM). It downloads once, about 1.5 GB, and then works offline. Pollinations' heavily rate-limited free API is the last resort.
  - Add `?brain=smart` to the address to use the 4B local model.
- **Voice**, the same tone as Mark One:
  - With Mark One's key, Google's "Charon" voice.
  - Otherwise Kokoro "George", a natural British voice that runs on the computer and downloads once.
  - Either way, Mark One's subtle JARVIS effect is applied. Until the voice has downloaded (the first time only), Yaver answers in text; the robotic built-in voice is only used if the natural voice can't run at all.
- **Listening** uses Chrome's built-in speech recognition.

## Code

- `index.html`, `style.css`: the page.
- `src/editor.js`: the scene and its shapes, plus the commands that change them.
- `src/hands.js`: reads the camera (MediaPipe). Only new camera frames are looked at, at most 30 times a second (12 while no hand is in view), so the laptop stays cool.
- `src/hand-worker.js`: runs the hand model in the background so the screen never waits for it.
- `src/gestures.js`: turns hand points into gestures.
- `src/filters.js`: smooths the pointer (One Euro filter on each camera report, then a glide between reports every screen frame, so it moves smoothly whatever the camera).
- `src/hand3d.js`: draws the pointers.
- `src/shelf.js`: the shape shelf.
- `src/helpicons.js`: the help icons.
- `src/app.js`: the app shell (home screen, opening and closing the Studio and the Academy).
- `src/studio.js`: the 3D Studio, loaded the first time it's opened.
- `src/handinput.js`: hand control for the Academy (press, drag sliders, grab, orbit, zoom, swipe).
- `src/academy/`: the Robotics Academy, loaded the first time it's opened.
  - `academy.js`: the screen: course map, lesson player, hands and mouse.
  - `stage.js`: the 3D workbench, camera moves and labels.
  - `anim.js`: smooth animations.
  - `parts.js`: the 3D models of every part, with their pins and notes.
  - `course.js`: what a lesson can do (labels, highlights, sliders, code and oscilloscope panels).
  - `lessons-electronics.js`, `lessons-arduino.js`, `lessons-esp32.js`: the lessons.
  - `sim.js`: the robot simulator (build, wire, the electrics, driving).
  - `sketch.js`: runs Arduino sketches in the browser (with `tone()` and the Servo library).
  - `planner.js`: the project tutor's AI: asks Gemini (or Claude) for a project plan and checks it.
  - `miniyaver-chart.js`: Mini Yaver's numbered wire list and pin chart.
  - `project.js`: plays a project plan as a lesson: lays out the bench, wires it, explains the code, and simulates the circuit as wired.
  - `project-parts.js`: the extra parts a plan can use (buzzer, potentiometer, servo, light sensor, any module) and the list of part types and pins.
  - `project-examples.js`: the ready-made piano project.
- `academy.css`: the Academy's styles.
- `src/assistant/`: the voice assistant.
  - `assistant.js`: transcript, orb and wiring.
  - `voice.js`: listening and speaking.
  - `commands.js`: studio voice commands.
  - `brain.js`: Gemini, Puter, the local model or the last-resort fallback.
  - `live.js`: the real-time Gemini Live conversation.
  - `keys.js`: the Gemini key, pasted once.
  - `gemini.js`: Gemini chat and voice.
  - `markone.js`: reads Mark One's key from this browser.
  - `tts-worker.js`: the Kokoro voice.
  - `llm-worker.js`: runs the model off the main thread.
- `manifest.webmanifest`, `icons/`, `sw.js`: make it an installable app.

Both 3D scenes draw at most 60 frames a second at no more than 1.5 pixels per point, and the Studio only redraws when something changed.

Bump the `?v=` number in `index.html` and on every `?v=` import (`src/app.js`, `src/studio.js`, `src/shelf.js`, `src/handinput.js`, `src/assistant/*.js`, `src/academy/*.js`) on every change, so browsers fetch the new files.

## Roadmap

1. Gesture 3D editor (done)
2. Voice: wake word, speech, voice commands (first version done)
3. Robotics Academy: course and robot simulator (first version done), and the AI project tutor
4. Shaping, save and export, MCP tools
5. Phone and ESP32

## CaliCoach (gym/)

The camera calisthenics coach: recognises the exercise, counts reps, scores each rep's form, records every set as a 3D skeleton and replays it next to a perfect-form model. Open it from the CaliCoach button on the home screen, say "open the gym", or go to https://mskorkmaz08-del.github.io/yaver-m2/gym/. Yaver (Mark One) reads its results. Details: [gym/README.md](gym/README.md).
