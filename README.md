# Yaver Mark II

Yaver Mark II is a voice-first personal assistant with a 3D editor that you control with your hands through the webcam. It runs on its own, separate from the first Yaver app.

The first feature is **Yaver Studio**. You pinch shapes from a shelf, move them in 3D, push and pull them in depth, scale and rotate them with two hands, and drop them in the bin.

Live at https://mskorkmaz08-del.github.io/yaver-m2/. In Chrome, install it with the install icon in the address bar, then use **Keep in Dock**.

## Using it

The app opens on **Yaver's home screen**, a big orb you talk to. To use the **3D Studio**, click the 3D Studio button or say "open the studio". To come back, use the ← button, press Esc, or say "go home". The camera only runs while the Studio is open.

## Talking to Yaver

Say **"Yaver"** and then your request, click the orb, or hold **Space** and talk. You can also type. Yaver answers out loud.

- **Studio commands** run instantly, and from the home screen they open the Studio first. Examples: "add two red cubes", "delete it", "make it bigger", "paint it green", "zoom in", "clear the scene", "show the gestures".
- **Brain**, with nothing to type in:
  - If Yaver Mark One (the first app, on the same site) already has a free Google Gemini key in this browser, Mark II reuses it automatically: Gemini answers, fast. Mark One's data is only read, never changed.
  - Otherwise a small model runs on the computer itself (Qwen 3.5 2B via WebLLM). It downloads once, about 1.5 GB, and then works offline. Until then, Pollinations' free keyless API answers, about once every 30 seconds.
  - Add `?brain=smart` to the address to use the 4B local model.
- **Voice**, the same tone as Mark One:
  - With Mark One's key, Google's "Charon" voice.
  - Otherwise Kokoro "George", a natural British voice that runs on the computer and downloads once.
  - Either way, Mark One's subtle JARVIS effect is applied. Until one of these is ready, the computer's built-in voice is used.
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
- `src/app.js`: the app shell (home screen, opening and closing the Studio).
- `src/studio.js`: the 3D Studio, loaded the first time it's opened.
- `src/assistant/`: the voice assistant.
  - `assistant.js`: transcript, orb and wiring.
  - `voice.js`: listening and speaking.
  - `commands.js`: studio voice commands.
  - `brain.js`: Gemini, the local model or the cloud fallback.
  - `gemini.js`: Gemini chat and voice.
  - `markone.js`: reads Mark One's key from this browser.
  - `tts-worker.js`: the Kokoro voice.
  - `llm-worker.js`: runs the model off the main thread.
- `manifest.webmanifest`, `icons/`, `sw.js`: make it an installable app.

Bump the `?v=` number in `index.html` and on every `?v=` import (`src/app.js`, `src/studio.js`, `src/shelf.js`, `src/assistant/*.js`) on every change, so browsers fetch the new files.

## Roadmap

1. Gesture 3D editor (done)
2. Voice: wake word, speech, voice commands (first version done)
3. Shaping, save and export, MCP tools
4. Phone and ESP32
