# Yaver Mark II

Yaver Mark II is a voice-first personal assistant with a 3D editor that you control with your hands through the webcam. It runs on its own, separate from the first Yaver app.

The first feature is **Yaver Studio**. You pinch shapes from a shelf, move them in 3D, push and pull them in depth, scale and rotate them with two hands, and drop them in the bin.

Live at https://mskorkmaz08-del.github.io/yaver-m2/. In Chrome, install it with the install icon in the address bar, then use **Keep in Dock**.

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
- `manifest.webmanifest`, `icons/`, `sw.js`: make it an installable app.

Bump the `?v=` number in `index.html` and on the imports in `src/main.js` and `src/shelf.js` on every change, so browsers fetch the new files.

## Roadmap

1. Gesture 3D editor (done)
2. Voice: wake word, speech, voice commands
3. Shaping, save and export, MCP tools
4. Phone and ESP32
