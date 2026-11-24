# Mini Yaver: a small desk AI on your Arduino Uno

Six parts from your kit, and **the Uno is Yaver**: it hears you with its own microphone (the KY-037), speaks through its buzzer, shows its face and the answer on the LCD, and shows its mood on an RGB light. The Uno can't reach the internet, so a **page in Chrome on your Mac passes things along**: the Uno's recording goes to Gemini as it is, and Gemini's answer (the text and the spoken voice) comes back to the Uno over USB. The Mac's own microphone isn't used.

- **Tutorial with 3D build, wire list and code tour:** https://mskorkmaz08-del.github.io/yaver-m2/#academy/mini-yaver/3d
- **The page:** https://mskorkmaz08-del.github.io/yaver-m2/mini-yaver/

## What it can do

| You | Yaver |
|---|---|
| Clap twice, press the button, or press Space on the page | Beeps, turns green and records you, and stops by itself when you stop talking |
| "What's the weather?" | Says today's weather for your city, and keeps it on the LCD |
| "Set a timer for 5 minutes for tea" | Counts down on the LCD, then plays the timer tune |
| "Wake me up at 7:30 every day" | Rings every morning, even with the page closed |
| "Remind me at 6 to call mom" | Rings and shows "call mom" at 6 |
| "Good night" | Turns on the big night clock |
| Any question | Answers out loud from the buzzer in the Charon voice, and scrolls the answer on the LCD |

The button: **press** to talk; press again while it listens for "I'm done talking"; press while it speaks to stop it. **Hold 1 second** for the night clock. When an alarm rings: **press** to stop it, **hold** to snooze 5 minutes.

**The mood light** fades smoothly between moods: breathing cyan when idle, green that gets brighter as you talk, swirling purple while it thinks, a pulse in time with its own voice while it speaks, a short rainbow when it's done, red-orange when an alarm rings, a red flash on an error, and a faint blue night light with the night clock.

## Parts

1. Arduino Uno and its USB cable
2. 1602 LCD, with the 10K potentiometer (contrast) and one 220Ω resistor (backlight)
3. KY-037 sound sensor (Yaver's ear)
4. **Passive** buzzer (the one without a sticker on top). It has to be the passive one: an active buzzer has its own beeper inside and can only beep at one pitch, so it can't speak.
5. One push button
6. RGB LED module, with three 220Ω resistors (one per colour)

Plus the breadboard and about 30 jumper wires.

## Wiring

| From | To |
|---|---|
| Uno 5V | breadboard + rail |
| Uno GND | breadboard − rail |
| LCD 1 VSS, 5 RW, 16 K | − rail |
| LCD 2 VDD | + rail |
| LCD 15 A | 220Ω, then + rail |
| Pot outer legs | + rail and − rail |
| Pot middle leg | LCD 3 V0 |
| LCD 4 RS | Uno D12 |
| LCD 6 E | Uno D11 |
| LCD 11 D4 | Uno D10 |
| LCD 12 D5 | Uno D9 |
| LCD 13 D6 | Uno D8 |
| LCD 14 D7 | Uno D7 |
| Button, one side | Uno D2 |
| Button, other side | − rail |
| Buzzer + | Uno **D3** |
| Buzzer − | − rail |
| RGB R | 220Ω, then Uno **D5** |
| RGB G | 220Ω, then Uno **D6** |
| RGB B | 220Ω, then Uno **D4** |
| RGB − | − rail |
| KY-037 AO | Uno A0 |
| KY-037 + / G | + rail / − rail |

LCD pins 7 to 10 (D0 to D3) and the sound sensor's DO stay empty. If your RGB module's shared leg is marked **+** instead of −, connect it to the + rail and set `RGB_COMMON_ANODE = true` at the top of the sketch.

## Step by step

1. **Wire the LCD first** (power, pot, backlight, then the six data wires).
2. Open `MiniYaver/MiniYaver.ino` in the Arduino IDE. It needs no extra libraries. Pick **Arduino Uno** and the port called `usbserial` or `wchusbserial`, and press **Upload**.
3. **Turn the pot** until Yaver's face appears. If the screen is empty or shows black boxes, it's always the pot.
4. Add the button, the buzzer, the RGB light and the sound sensor. The light should breathe cyan.
5. **Close the Arduino IDE's Serial Monitor**, because only one app can use the USB port.
6. Open the page in **Chrome**, click **Connect Uno** and pick the Uno. If you already saved your Gemini key in Yaver Mark II, it's used automatically. If not, paste it once.
7. Clap twice or press the button, wait for the beep, and talk to the KY-037 from close by.
8. Type your city under Settings for the weather.

## How it hears you

After the beep, the Uno records the KY-037 8000 times a second: a timer starts each measurement and collects it on the next tick, takes away the signal's slow middle, boosts what's left and sends it to the page over USB (`MIC`, the sound bytes, a `0`). It learns how loud the room is in the first 0.2 s and stops by itself after almost a second of quiet once you've talked (or 5 s if you never start, 10 s at most). The page wraps the recording as a .wav and gives it to Gemini **as it is**: Gemini works out the words and answers. Gemini starts its answer with `[heard: …]`, which the page shows (with a **▶ hear it** button to listen to the recording) and keeps out of the spoken answer.

The boost starts at ×8 and the page tunes it after every recording: down if your voice hit the top, up if it barely moved.

**The KY-037 is the weak link.** It's made for claps, so its signal is small and rough. Talk close to it. If Gemini keeps mishearing, run `MicTest/MicTest.ino` to see how much your voice moves the signal, and turn the screw on the blue box so the quiet level sits near 512. A MAX9814 microphone module (same three wires: OUT to A0) makes a big difference.

## How the buzzer talks

The page makes Yaver's voice (Gemini's Charon), cuts it down to what a buzzer can play (no deep bass, the 1 to 3 kHz where words are lifted, quiet parts made louder) and streams it over USB as 8000 numbers a second. On the Uno, Timer2 pulses D3 62,500 times a second and Timer1 changes the pulse width 8000 times a second, so the buzzer's membrane follows the voice. That's why the buzzer is on **D3** (it was on D5 in v2): D3 is the pin Timer2 drives. It sounds like an old walkie-talkie, not a speaker, but you can follow it. For a fuller voice, put a small 8 Ω speaker in place of the buzzer, through an NPN transistor (base to D3 through 1K, speaker between 5V and the collector, emitter to GND); the code stays the same.

Under Settings, **Yaver speaks from** switches the voice to the Mac's speakers. The page also uses the Mac by itself while an alarm rings or before the Gemini key is set. An Uno with an older sketch (v2 or v3) is heard through the Mac's microphone instead of its own.

**Timers and alarms live on the Uno** (6 at a time, saved in its EEPROM). They ring even if the page is closed, as long as the Uno has USB power. The page sets the Uno's clock whenever it connects.
