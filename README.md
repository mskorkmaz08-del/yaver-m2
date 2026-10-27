# Yaver Mark II

Yaver Mark II is a voice-first personal assistant with a 3D editor that you control with your hands through the webcam. It runs on its own, separate from the first Yaver app.

The first feature is **Yaver Studio**. You pinch shapes from a shelf, move them in 3D, push and pull them in depth, scale and rotate them with two hands, and drop them in the bin.

Live at https://mskorkmaz08-del.github.io/yaver-m2/. In Chrome, install it with the install icon in the address bar, then use **Keep in Dock**.

## Talking to Yaver

Say **"Yaver"** and then your request, click the glowing orb, or hold **Space** and talk. You can also type in the box above the orb. Yaver answers out loud.

- **Studio commands** run instantly. Examples: "add two red cubes", "delete it", "make it bigger", "paint it green", "zoom in", "clear the scene", "show the gestures".
- **Everything else** goes to Yaver's brain, which needs no API key.
  - Normally the brain is a small AI model (Qwen 3.5, 2B) that runs on your own computer through WebLLM and WebGPU. The first launch downloads it once (about 1.5 GB). After that it works offline, privately and without limits.
  - While it downloads, or if the browser can't run it, Yaver uses the free Pollinations cloud API, which allows about one answer every 30 seconds.
  - Add `?brain=smart` to the address to use the bigger 4B model, which needs about 4 GB of graphics memory.
- **Voice:** listening uses Chrome's built-in speech recognition, and speaking uses the computer's own voices ("Daniel" on a Mac).

## Code

- `index.html`, `style.css`: the page.
- `src/editor.js`: the scene and its shapes, plus the commands that change them.
- `src/hands.js`: reads the camera (MediaPipe).
- `src/gestures.js`: turns hand points into gestures.
- `src/filters.js`: smooths the pointer.
- `src/hand3d.js`: draws the pointers.
- `src/shelf.js`: the shape shelf.
- `src/helpicons.js`: the help icons.
- `src/main.js`: wires it all together.
- `src/assistant/`: the voice assistant.
  - `assistant.js`: transcript, orb and wiring.
  - `voice.js`: listening and speaking.
  - `commands.js`: studio voice commands.
  - `brain.js`: local model plus cloud fallback.
  - `llm-worker.js`: runs the model off the main thread.
- `manifest.webmanifest`, `icons/`, `sw.js`: make it an installable app.

Bump the `?v=` number in `index.html` and on every `?v=` import (`src/main.js`, `src/shelf.js`, `src/assistant/*.js`) on every change, so browsers fetch the new files.

## Roadmap

1. Gesture 3D editor (done)
2. Voice: wake word, speech, voice commands (first version done)
3. Shaping, save and export, MCP tools
4. Phone and ESP32
