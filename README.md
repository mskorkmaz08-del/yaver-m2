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
- `src/hands.js`: reads the camera (MediaPipe).
- `src/gestures.js`: turns hand points into gestures.
- `src/filters.js`: smooths the pointer.
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
  - `sketch.js`: runs Arduino sketches in the browser.
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

Bump the `?v=` number in `index.html` and on every `?v=` import (`src/app.js`, `src/studio.js`, `src/shelf.js`, `src/handinput.js`, `src/assistant/*.js`, `src/academy/*.js`) on every change, so browsers fetch the new files.

## Roadmap

1. Gesture 3D editor (done)
2. Voice: wake word, speech, voice commands (first version done)
3. Robotics Academy: course and robot simulator (first version done)
4. Shaping, save and export, MCP tools
5. Phone and ESP32
