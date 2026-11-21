# Mini Yaver: pushing the Arduino Uno to 100%

Mini Yaver is a desk AI terminal built from your RFID UNO Kit. You ask with the IR remote, the joystick or an RFID card. The Uno sends the question over USB to a small script on your Mac, the Mac asks Gemini, and the answer scrolls on the LCD. The stepper turns the "head", the servo nods while it thinks, the relay switches a lamp, the buzzer beeps, and the sensors tell the AI about your room.

The real goal is to find the Uno's ceiling. Every pin, timer and interrupt is taken, the EEPROM is fully mapped, and the sketch measures its own RAM and speed live. The report at the end shows where the Uno runs out, which is the reason for the Pi 5 and ESP32-S3 later.

## Files

| File | What it is |
|---|---|
| `MiniYaver/MiniYaver.ino` | The Arduino sketch. Open this in the Arduino IDE. |
| `mini_yaver_bridge.py` | The Mac script. It needs nothing installed. |
| `README.md` | This guide: wiring, how to run, and the limits report. |

## Parts used (18 of the kit's parts)

Uno, breadboard, LCD1602, 10K potentiometer (LCD contrast), 74HC595, RC522 RFID with card and tag, IR receiver with remote, joystick, SG90 servo, 28BYJ-48 stepper with ULN2003 board, DHT11, photoresistor with a 10K resistor, water sensor, KY-037 sound sensor, 5V relay, active buzzer with a 220Ω resistor, and jumper wires.

## Pin map: all 20 pins

| Pin | Goes to | Why this pin |
|---|---|---|
| D0, D1 | USB to the Mac | Hard-wired to the CH340 USB chip |
| D2 | IR receiver OUT | |
| D3 | Joystick SW | INT1 hardware interrupt, so no press is missed |
| D4 | ULN2003 IN1 | D4 to D7 are bits 4 to 7 of PORTD, so one write moves all four coils |
| D5 | ULN2003 IN2 | |
| D6 | ULN2003 IN3 | |
| D7 | ULN2003 IN4 | |
| D8 | 74HC595 pin 12 (ST_CP, latch) | |
| D9 | Servo signal (orange) | |
| D10 | RC522 SDA (SS) | SPI select for the RFID |
| D11 | RC522 MOSI **and** 74HC595 pin 14 (DS) | Shared SPI data line |
| D12 | RC522 MISO | |
| D13 | RC522 SCK **and** 74HC595 pin 11 (SH_CP) | Shared SPI clock |
| A0 | Joystick VRx | |
| A1 | Joystick VRy | |
| A2 | Photoresistor divider | |
| A3 | Water sensor S | |
| A4 | KY-037 analog out (A0 on the module) | |
| A5 | DHT11 S | Analog pin used as a digital pin |

The 74HC595 outputs, all 8 of them:

| 595 output (chip pin) | Goes to |
|---|---|
| Q0 (15) | LCD RS (LCD pin 4) |
| Q1 (1) | LCD E (LCD pin 6) |
| Q2 (2) | LCD D4 (LCD pin 11) |
| Q3 (3) | LCD D5 (LCD pin 12) |
| Q4 (4) | LCD D6 (LCD pin 13) |
| Q5 (5) | LCD D7 (LCD pin 14) |
| Q6 (6) | Relay IN (S) |
| Q7 (7) | Active buzzer + through a 220Ω resistor; buzzer − to GND |

## Wiring guide

Run the Uno's **5V** and **GND** to the two power rails of the breadboard first. Every "5V" and "GND" below means those rails.

**74HC595** (notch facing left, pin 1 is bottom-left, pin 16 is top-left)
- Pin 16 (VCC) to 5V, pin 8 (GND) to GND
- Pin 10 (MR) to 5V, pin 13 (OE) to GND
- Pin 14 to D11, pin 11 to D13, pin 12 to D8
- Pin 9 stays empty

**LCD1602** (pins 1 to 16, from left)
- 1 VSS to GND, 2 VDD to 5V, 3 V0 to the potentiometer's middle leg (its outer legs go to 5V and GND)
- 4 RS to 595 Q0, 5 RW to GND, 6 E to 595 Q1
- 7 to 10 stay empty
- 11 to 14 (D4 to D7) to 595 Q2 to Q5
- 15 A to 5V through a 220Ω resistor, 16 K to GND
- Turn the potentiometer until you can see letters. If the screen shows nothing, this is almost always the reason.

**RC522 RFID**: use **3.3V**, never 5V
- 3.3V to the Uno's 3.3V pin, RST to the same 3.3V pin, GND to GND
- SDA to D10, SCK to D13, MOSI to D11, MISO to D12, IRQ stays empty

**IR receiver**: S to D2, + to 5V, − to GND (check the letters printed on your module).

**Joystick**: GND, +5V, VRx to A0, VRy to A1, SW to D3.

**Servo SG90**: brown to GND, red to 5V, orange to D9.

**Stepper**: plug the motor into the ULN2003 board. IN1 to IN4 go to D4 to D7. The board's + goes to 5V and − to GND.

**DHT11**: S to A5, + to 5V, − to GND.

**Photoresistor**: one leg to 5V, the other leg to A2, and a 10K resistor from A2 to GND.

**Water sensor**: S to A3, + to 5V, − to GND.

**KY-037 sound**: A0 to A4, + to 5V, G to GND. Clap and turn its little blue screw until a clap makes Mini Yaver say "Yes, sir?".

**Relay**: S to 595 Q6, + to 5V, − to GND. Use it for a low-voltage lamp or LED strip only. Do not wire mains (220V) without an adult who knows electrics.

**Active buzzer** (the one with a sticker on top): + through a 220Ω resistor to 595 Q7, − to GND. The resistor keeps the 595 safe. The beep is a bit quieter because of it.

You don't have to wire everything before the first upload. The sketch keeps running if a part is missing. Wire the 595 and the LCD first, because without them you see nothing. Then add one part at a time and check that it works.

## Run it

1. **Arduino IDE**: Tools > Manage Libraries, install **MFRC522** (by GithubCommunity) and **IRremote** (by Armin Joachimsmeyer, 4.x).
2. Open `MiniYaver/MiniYaver.ino`. Choose Board **Arduino Uno** and the port named `wchusbserial` or `usbserial`. Upload.
3. Write down the two lines the IDE prints at the bottom ("Sketch uses ... bytes" and "Global variables use ... bytes"). Those are the real flash and RAM numbers for the report below.
4. **Close the IDE's Serial Monitor**, because only one app can use the USB port at a time.
5. In Terminal: `cd` into this folder, then run `python3 mini_yaver_bridge.py`. The first time, it asks for your Gemini key (the free one from aistudio.google.com/apikey) and saves it only on your Mac. The LCD switches from "off" to the clock when the bridge connects.

If Terminal says "certificate verify failed": open Finder > Applications > Python 3.x and double-click **Install Certificates.command**, then run it again.

## How to use it

| Remote key | Joystick | Does |
|---|---|---|
| 0 to 9 | | Ask preset question 0 to 9 (edit them in `PRESETS` in the Mac script) |
| PLAY | press | OK. On the home screen it asks preset 0, the room status |
| PREV / NEXT | left / right | Change screen: Home, Answer, Sensors, Stats, Lessons, Cards |
| VOL− / VOL+ | down / up | Scroll the answer |
| CH− / CH+ | | Turn the head 30° left or right (stepper) |
| CH | | Center the head |
| EQ | | Lamp on or off (relay) |
| 100+ | | Stats screen: free RAM, the lowest free RAM ever, loops per second, slowest loop |
| 200+ | | **Stress test**: everything moves at once. Watch the stats fall |

**RFID cards**: tap a new card, then press a digit 0 to 9 on the remote. From then on, tapping that card asks that preset. 16 cards fit in EEPROM. Type `/clearcards` on the Mac to forget them all.

**Clap** near the sound sensor and Yaver nods and answers "Yes, sir?".

**On the Mac** you can also type any question, or `/lamp on`, `/pan 90`, `/nod`, `/log`, `/sensors`. The AI can control the device too: if it decides the room is dark, it switches the lamp on.

**Offline**: the Lessons screen has 20 short lessons stored in flash (Uno, pins, SRAM, timers, SPI, every part used here, and the next board). They work with no Mac attached.

**Room log**: every 10 minutes the Uno saves temperature, humidity, light, water and noise in EEPROM, keeping about 24 hours. It survives power-off. Preset 7 sends the log to the AI to summarize.

## Limits report: how close to 100%

| Resource | The Uno has | Mini Yaver uses | Used |
|---|---|---|---|
| I/O pins | 20 | 20 (2 for USB, 18 for parts) | **100%** |
| Hardware timers | 3 | Timer0 millis, Timer1 Servo, Timer2 IR | **100%** |
| External interrupts | 2 (INT0, INT1) | IR pin, joystick button | **100%** |
| PWM pins | 6 | 0 left: the Servo kills PWM on D9/D10, IR kills D3/D11, and D5/D6 drive the stepper | **100%** |
| UART | 1 | USB link to the Mac | **100%** |
| SPI bus | 1 bus | 2 chips sharing it (RC522 and 74HC595) | shared |
| I2C bus | 1 (A4/A5) | Lost: A4/A5 are used as sensor pins | taken |
| Analog inputs | 6 | 5 analog plus DHT11 as digital | **100%** |
| 74HC595 outputs | 8 | 6 LCD plus relay plus buzzer | **100%** |
| LCD custom characters | 8 | eyes, blink, smile, question, thermometer, drop, bulb, heart | **100%** |
| EEPROM | 1,024 B | 16 B settings, 128 B cards, 876 B room log, 4 B spare | **~100%** |
| SRAM | 2,048 B | about 1.4 KB of variables (≈70%) plus the stack. The STATS "min" shows the real lowest free RAM | see step 3 |
| Flash | 32,256 B | estimated 22 to 26 KB (≈70 to 80%): libraries, code and 4.8 KB of lessons | see step 3 |
| USB power | 500 mA | stepper 240, servo up to 600 when stuck, relay 70, RFID 25, LCD light 20 | over the limit if everything moves |
| Serial input buffer | 64 B | The Mac sends 40 characters, then waits for "K" | at the limit |

I couldn't run the real AVR compiler in the cloud, so the flash and global RAM numbers above are estimates. The IDE line from step 3 gives the exact ones, and the STATS screen shows RAM while it runs. I checked the code with a desktop compiler and stand-in libraries, and the word-wrap, serial protocol, stepper and EEPROM log all worked there.

**Want to really hit the RAM wall?** Raise `ANSWER_MAX` at the top of the sketch (it starts at 640 characters) and upload again. The bridge picks up the new size by itself. Keep raising it until the STATS "min" number gets near 150. If it reaches 0, the stack crashes into your variables and the Uno resets or shows garbage. That crash is the 2 KB wall, and seeing it is the point of the experiment.

### Where the Uno runs out, in the order you hit it

1. **Pins run out first.** 9 kit parts could not fit:
   - the 4×4 keypad needs 8 pins, so the IR remote replaces it: 21 keys on 1 pin;
   - the 8×8 matrix in this kit is a bare matrix that needs 16 pins, and the kit has only one 74HC595;
   - the 4-digit 7-segment needs 12 pins and the 1-digit one needs 8;
   - the DS1302 clock needs 3, so the Mac sends the time instead;
   - LM35 has no analog pin left (DHT11 measures temperature anyway);
   - the RGB LED needs 3 PWM pins and none are left;
   - the tilt switch, spare button and LEDs have no pins.

   The 74HC595 trick (3 wires in, 8 outputs) is the only reason the LCD, relay and buzzer fit at all.
2. **Timers run out next.** With Servo and IR running, `tone()` and the PWM pins are gone, so the passive buzzer can't play notes. That's why it uses the active buzzer.
3. **Time conflicts.** The DHT11 needs about 4 ms with interrupts off. During that time the servo can twitch and an IR press can be lost. The stress test shows the slowest loop jumping to tens of milliseconds.
4. **SRAM: one paragraph.** The whole answer buffer is 640 letters. One phone photo is about 3 MB, roughly 1,500 times the Uno's RAM.
5. **No network and no audio.** All the "AI" happens on the Mac. The Uno can't hear speech, play a voice or see.
6. **Power.** USB can't move the stepper and the servo together reliably, so the code only lets one move at a time, except in stress test.

### Fixing it with more parts vs. the next board

If you want to stay on the Uno longer, an **I2C backpack for the LCD (PCF8574)** and a **MAX7219 8×8 matrix module** would free pins and add the matrix face. Both are on Kaspi. They only push the wall a little, though, because RAM, timers and the lack of Wi-Fi stay the same.

| | Arduino Uno | ESP32-S3 (N16R8) | Raspberry Pi 5 |
|---|---|---|---|
| CPU | 16 MHz, 8-bit, 1 core | 240 MHz, 32-bit, 2 cores | 2.4 GHz, 64-bit, 4 cores |
| RAM | 2 KB | 512 KB plus 8 MB PSRAM | 4 to 8 GB |
| Storage | 32 KB | 16 MB | microSD, many GB |
| Wi-Fi / Bluetooth | none | both | both |
| Camera / mic / speaker | no | yes (camera port, I2S audio) | yes, and real AI vision |
| GPIO | 20 | about 35 usable | 28 |

That's why Mark II is split this way: the Pi 5 is the brain (camera, voice, AI), and the ESP32-S3 drives the motors. What you learn here (timers, interrupts, SPI, shift registers, power limits, protocols with acknowledgements) carries straight over to the ESP32-S3.
