# Mini Yaver: a small desk AI on your Arduino Uno

Five parts from your kit. The Uno is Yaver's **face, ears and alarm clock**. The **brain is a page in Chrome on your Mac**: it hears you through the Mac's microphone, asks Gemini, speaks the answer in Yaver's voice and sends a short version to the LCD.

- **Tutorial with 3D build, wire list and code tour:** https://mskorkmaz08-del.github.io/yaver-m2/#academy/mini-yaver/3d
- **The brain page:** https://mskorkmaz08-del.github.io/yaver-m2/mini-yaver/

## What it can do

| You | Yaver |
|---|---|
| Clap twice, press the button, or press Space on the page | Beeps, shows its listening face, and listens |
| "What's the weather?" | Says today's weather for your city, and keeps it on the LCD |
| "Set a timer for 5 minutes for tea" | Counts down on the LCD, then plays the timer tune |
| "Wake me up at 7:30 every day" | Rings every morning, even with the page closed |
| "Remind me at 6 to call mom" | Rings and shows "call mom" at 6 |
| "Good night" | Turns on the big night clock |
| Any question | Answers out loud in the Charon voice, short version on the LCD |

The button: **press** to talk, or to stop Yaver talking. **Hold 1 second** for the night clock. When an alarm rings: **press** to stop it, **hold** to snooze 5 minutes.

## Parts

1. Arduino Uno and its USB cable
2. 1602 LCD, with the 10K potentiometer (contrast) and one 220Ω resistor (backlight)
3. KY-037 sound sensor
4. **Passive** buzzer (the one without a sticker on top)
5. One push button

Plus the breadboard and about 23 jumper wires.

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
| Buzzer + | Uno D5 |
| Buzzer − | − rail |
| KY-037 AO | Uno A0 |
| KY-037 + / G | + rail / − rail |

LCD pins 7 to 10 (D0 to D3) and the sound sensor's DO stay empty.

## Step by step

1. **Wire the LCD first** (power, pot, backlight, then the six data wires).
2. Open `MiniYaver/MiniYaver.ino` in the Arduino IDE. It needs no extra libraries. Pick **Arduino Uno** and the port called `usbserial` or `wchusbserial`, and press **Upload**.
3. **Turn the pot** until Yaver's face appears. If the screen is empty or shows black boxes, it's always the pot.
4. Add the button, the buzzer and the sound sensor. Press the button: it beeps and shows the listening face.
5. **Close the Arduino IDE's Serial Monitor**, because only one app can use the USB port.
6. Open the brain page in **Chrome**, click **Connect Uno** and pick the Uno. If you already saved your Gemini key in Yaver Mark II, it's used automatically. If not, paste it once.
7. Allow the microphone when Chrome asks, then clap twice or press the button and talk.
8. Type your city under Settings for the weather.

**If clapping does nothing, or Yaver reacts to every sound,** turn the little screw on the sound sensor's blue box a bit. You can also change `CLAP_LEVEL` near the top of the sketch: a lower number makes it more sensitive.

**Timers and alarms live on the Uno** (6 at a time, saved in its EEPROM). They ring even if the page is closed, as long as the Uno has USB power. The page sets the Uno's clock whenever it connects.
