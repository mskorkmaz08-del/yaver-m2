/*
  MINI YAVER  -  a desk AI terminal that uses an Arduino Uno up to its limits
  ---------------------------------------------------------------------------
  Board : Arduino Uno (ATmega328P, CH340 USB clone is fine)
  Talks : USB serial 115200 to mini_yaver_bridge.py on the Mac, which calls the AI.

  What is "maxed out" (see README.md for the full report):
    - all 20 I/O pins used (D0..D13, A0..A5)
    - all 3 hardware timers taken (Timer0 millis, Timer1 Servo, Timer2 IR)
    - both external interrupts (INT0 IR receiver pin, INT1 joystick button)
    - the SPI bus shared by two chips (RC522 RFID + 74HC595)
    - all 8 outputs of the 74HC595 (LCD 6 lines + relay + buzzer)
    - all 8 custom-character slots of the LCD
    - all 1024 bytes of EEPROM laid out (settings, 16 RFID cards, 24 h sensor log)
    - SRAM measured live (stack painting) so you can see the real headroom
    - flash filled with an offline lesson library you can read without the Mac

  Libraries (Arduino IDE > Tools > Manage Libraries):
    - "MFRC522" by GithubCommunity
    - "IRremote" by Armin Joachimsmeyer (version 4.x)
    - Servo, SPI, EEPROM come with the IDE
*/

#define DECODE_NEC            // only decode NEC remotes: saves ~2 KB of flash
#include <IRremote.hpp>
#include <SPI.h>
#include <MFRC522.h>
#include <Servo.h>
#include <EEPROM.h>
#include <avr/pgmspace.h>

// ---------------------------------------------------------------- pin map
// D0, D1  : USB serial to the Mac (taken by the CH340 chip)
const uint8_t PIN_IR       = 2;   // IR receiver OUT            (INT0 pin)
const uint8_t PIN_JOY_SW   = 3;   // joystick button SW         (INT1)
// D4..D7  : ULN2003 IN1..IN4 (stepper). Written in one go through PORTD.
const uint8_t PIN_LATCH    = 8;   // 74HC595 ST_CP (pin 12)
const uint8_t PIN_SERVO    = 9;   // SG90 signal
const uint8_t PIN_RFID_SS  = 10;  // RC522 SDA/SS
// D11 MOSI -> RC522 MOSI + 74HC595 DS (pin 14)
// D12 MISO <- RC522 MISO
// D13 SCK  -> RC522 SCK  + 74HC595 SH_CP (pin 11)
const uint8_t PIN_JOY_X    = A0;
const uint8_t PIN_JOY_Y    = A1;
const uint8_t PIN_LIGHT    = A2;  // photoresistor + 10K divider
const uint8_t PIN_WATER    = A3;  // water level sensor S
const uint8_t PIN_SOUND    = A4;  // KY-037 analog out A0
const uint8_t PIN_DHT      = A5;  // DHT11 data (used as a digital pin)

// 74HC595 output bits (Q0..Q7)
const uint8_t SR_RS     = 0x01;  // Q0 -> LCD RS
const uint8_t SR_E      = 0x02;  // Q1 -> LCD E
                                 // Q2..Q5 -> LCD D4..D7
const uint8_t SR_RELAY  = 0x40;  // Q6 -> relay IN
const uint8_t SR_BUZZ   = 0x80;  // Q7 -> active buzzer (+) through 220R

const bool RELAY_ACTIVE_HIGH = true;  // flip if your relay clicks the wrong way

// ---------------------------------------------------------------- tunables
#define ANSWER_MAX   640    // AI answer buffer. The biggest single RAM user.
                            // Raise it until STATS shows "min" near 150 B.
#define RX_LINE_MAX  72     // one line from the Mac (the Mac sends <= 60)
#define CARD_SLOTS   16
const int16_t STEPS_PER_REV = 4096;   // 28BYJ-48 in half-step mode
const uint16_t STEP_US      = 1200;   // fastest reliable half-step period

// ---------------------------------------------------------------- EEPROM map
// 0..3 magic | 4..5 boot count | 6..7 log head | 8 flags | 9..15 spare
// 16..143  : 16 card slots x 8 bytes (uid[4], uidLen, action, 2 spare)
// 144..1023: sensor log ring, 146 records x 6 bytes (+4 spare) = 24 h at 10 min
const int EE_MAGIC = 0, EE_BOOTS = 4, EE_LOGHEAD = 6, EE_FLAGS = 8;
const int EE_CARDS = 16, CARD_BYTES = 8;
const int EE_LOG = 144, LOG_REC = 6, LOG_RECS = 146;
const uint32_t LOG_EVERY_MS = 600000UL;   // 10 minutes

// ---------------------------------------------------------------- objects
MFRC522 rfid(PIN_RFID_SS, MFRC522::UNUSED_PIN);  // RST tied to 3.3V, soft reset
Servo head;

// ---------------------------------------------------------------- state
enum Screen : uint8_t { SC_HOME, SC_ANSWER, SC_SENSORS, SC_STATS, SC_LESSONS, SC_CARDS, SC_COUNT };
Screen screen = SC_HOME;

char answer[ANSWER_MAX + 1];
uint16_t answerLen = 0;
bool answerTruncated = false;

char rxLine[RX_LINE_MAX + 1];
uint8_t rxLen = 0;

char fb[2][16];        // what we want on the LCD
char shown[2][16];     // what is on the LCD now (only the difference is sent)
uint8_t srBits = 0;    // shadow of the 74HC595 outputs

// reader (shared by AI answers in RAM and lessons in flash)
const char* rdText = answer;
bool rdFlash = false;
uint16_t rdLen = 0, rdTop = 0;
uint32_t rdAutoAt = 0;
bool rdAuto = false;
uint8_t lessonIdx = 0;

// sensors
uint8_t tempC = 0, humid = 0, lightPct = 0, waterPct = 0;
uint16_t soundPeak = 0;
uint16_t sMin = 1023, sMax = 0;
bool dhtOk = false;

// actuators
volatile int16_t stepPos = 0;
int16_t stepTarget = 0;
uint8_t stepPhase = 0;
uint32_t lastStepUs = 0;
bool stepperBusy = false;
uint8_t servoAngle = 90;
uint8_t servoGoal = 90;
uint8_t nodLeft = 0;
uint32_t servoIdleAt = 0;
bool lampOn = false;
uint8_t beepsLeft = 0;
uint32_t beepAt = 0;

// ui / status
char clockStr[6] = "--:--";
char msgBuf[33];
uint32_t msgUntil = 0;
bool thinking = false;
uint32_t thinkSince = 0;
bool macOnline = false;
uint32_t lastMacMs = 0;
uint8_t face = 0;      // 0 calm, 1 happy, 2 thinking, 3 sleepy
int8_t pendingBindSlot = -1;
uint8_t pendingUid[4];
uint8_t lastUid[4];
uint32_t lastCardMs = 0;
bool stress = false;

// stats
uint16_t boots = 0;
uint32_t loopCount = 0, loopsPerSec = 0, statWindow = 0;
uint32_t maxLoopUs = 0, lastLoopUs = 0;
volatile bool joyPressed = false;
volatile uint32_t joyIsrCount = 0;

// timers
uint32_t tSensors = 0, tDht = 0, tReport = 0, tLog = 0, tRfid = 0, tJoy = 0, tFace = 0, tBlink = 0;

// ---------------------------------------------------------------- forward declarations
void lcdCmd(uint8_t c);
void lcdData(uint8_t d);
void srWrite(uint8_t bits);
void setStatus(const char* l1, const char* l2, uint16_t ms);
void beep(uint8_t n);
void handleKey(uint8_t key);
void openReader(const char* text, bool inFlash, uint16_t len);
uint16_t freeRamNow();
uint16_t stackHeadroom();

// ================================================================= PROGMEM data
// 8 custom characters: every CGRAM slot is used
const uint8_t glyphs[8][8] PROGMEM = {
  {0x00,0x0E,0x1F,0x1B,0x1F,0x0E,0x00,0x00}, // 0 eye open
  {0x00,0x00,0x00,0x1F,0x0E,0x00,0x00,0x00}, // 1 eye closed / blink
  {0x00,0x00,0x00,0x00,0x11,0x0E,0x00,0x00}, // 2 smile
  {0x0E,0x11,0x01,0x06,0x04,0x00,0x04,0x00}, // 3 question (thinking)
  {0x04,0x0A,0x0A,0x0A,0x0E,0x1F,0x1F,0x0E}, // 4 thermometer
  {0x04,0x04,0x0A,0x0A,0x11,0x11,0x11,0x0E}, // 5 water drop
  {0x0E,0x11,0x11,0x11,0x0E,0x0E,0x04,0x00}, // 6 light bulb
  {0x00,0x0A,0x1F,0x1F,0x0E,0x04,0x00,0x00}  // 7 heart
};

// IR codes of the 21-key "Car MP3" remote that ships with most kits (NEC)
// key ids: 0..9 digits, 10 PLAY/OK, 11 PREV, 12 NEXT, 13 VOL-, 14 VOL+,
//          15 CH-, 16 CH, 17 CH+, 18 EQ, 19 100+, 20 200+
const uint8_t irCodes[21] PROGMEM = {
  0x16,0x0C,0x18,0x5E,0x08,0x1C,0x5A,0x42,0x52,0x4A,
  0x43,0x44,0x40,0x07,0x15,0x45,0x46,0x47,0x09,0x19,0x0D
};
enum { K_OK = 10, K_PREV, K_NEXT, K_DOWN, K_UP, K_LEFT, K_CENTER, K_RIGHT, K_LAMP, K_STATS, K_STRESS };

// Offline lesson library: readable with no Mac attached. It also fills flash on purpose.
const char L00[] PROGMEM = "Uno basics: The Uno runs an ATmega328P at 16 MHz: 32 KB flash for code, 2 KB SRAM for variables, 1 KB EEPROM that survives power off. One instruction takes about 62 ns, so roughly 16 million simple steps per second. It has no Wi-Fi, so Mini Yaver borrows the Mac's internet over USB.";
const char L01[] PROGMEM = "Pins: 20 I/O pins: D0-D13 and A0-A5. D0 and D1 are the USB serial line, so you really get 18. Mini Yaver uses every single one. When pins run out you add chips: a 74HC595 turns 3 SPI wires into 8 outputs, I2C backpacks put many devices on 2 wires.";
const char L02[] PROGMEM = "SRAM: 2048 bytes for every variable, the serial buffers and the stack. This answer buffer alone is 640 bytes. Strings in quotes are kept in flash with PROGMEM and F() so they do not eat SRAM. The STATS screen paints the stack and shows the lowest free RAM ever seen.";
const char L03[] PROGMEM = "Flash: 32 KB, minus 0.5 KB for the bootloader. Code and constant data live here, like these lessons. Libraries are big: RFID and IR decoding together take several KB. Reading flash needs pgm_read_byte because the AVR keeps code and data on separate buses.";
const char L04[] PROGMEM = "EEPROM: 1024 bytes that keep their value without power, good for about 100000 writes per cell. Mini Yaver keeps the boot count, 16 RFID card bindings and a 24 hour ring log of your room: temp, humidity, light, water and noise every 10 minutes.";
const char L05[] PROGMEM = "Timers: Three hardware timers. Timer0 runs millis() and delay(). Timer1 is taken by the Servo library, which also kills PWM on D9 and D10. Timer2 is taken by IRremote, which kills PWM on D3 and D11 and also tone(). That is why the buzzer here is an active one.";
const char L06[] PROGMEM = "Interrupts: INT0 on D2 and INT1 on D3 can wake code the instant a pin changes. The joystick button uses INT1, so a press is never missed even while the LCD is busy. Every pin also has pin-change interrupts, grouped by port.";
const char L07[] PROGMEM = "SPI bus: A fast 4 wire bus: clock, data out, data in, select. The RC522 RFID reader and the 74HC595 share clock and data. The RFID only listens when its select pin is low; the 595 only shows new bits when its latch pin rises. Two chips, one bus.";
const char L08[] PROGMEM = "74HC595: A shift register: you clock 8 bits in, pulse the latch, and 8 outputs change at once. Here it drives the whole LCD (RS, E, D4-D7) plus the relay and the buzzer. Each output can only give a few mA, so the buzzer gets a resistor.";
const char L09[] PROGMEM = "LCD 1602: 16x2 characters with a HD44780 controller. It talks in 4 bit halves. It has 8 slots for your own 5x8 pixel characters: eyes, smile, thermometer, drop, bulb and heart use all 8. Only changed letters are resent, which keeps the loop fast.";
const char L10[] PROGMEM = "RC522 RFID: Reads 13.56 MHz cards and tags by their unique ID. It runs on 3.3 V: never connect its VCC to 5 V. Tap an unknown card and Mini Yaver asks you to bind it to a key 0-9. Then the card becomes a shortcut question.";
const char L11[] PROGMEM = "IR remote: The receiver turns 38 kHz light flashes into pulses. IRremote measures them every 50 us with Timer2 and decodes the NEC protocol: an address and a command byte per key. Unknown keys are shown on screen and sent to the Mac.";
const char L12[] PROGMEM = "Servo SG90: Holds an angle from a 1-2 ms pulse every 20 ms. The Servo library makes those pulses with Timer1 interrupts. Mini Yaver detaches it when idle to stop buzzing and save power. It nods while the AI is thinking.";
const char L13[] PROGMEM = "Stepper: The 28BYJ-48 needs 4096 half steps for one turn. Its four coils are on D4-D7, which are bits 4-7 of PORTD, so one write sets all four. Coils are switched off when it stops, because they eat about 240 mA and get warm.";
const char L14[] PROGMEM = "Power: USB gives 500 mA. Stepper 240, servo up to 600 when it stalls, relay 70, LCD light 20, RFID 25. All at once is too much and the board resets. So the code never moves the servo and the stepper together, except in stress test.";
const char L15[] PROGMEM = "DHT11: Temperature and humidity on one wire. The sensor sends 40 bits as short or long high pulses. Reading it means about 4 ms with interrupts off, which can make the servo twitch. A good example of two parts fighting over time.";
const char L16[] PROGMEM = "Analog in: The ADC turns 0-5 V into 0-1023 in about 112 us. Light, water, sound and the joystick are all analog. The sound sensor is read every loop to catch claps; the others are read a few times a second.";
const char L17[] PROGMEM = "Serial: 115200 baud is about 11 KB per second. The Uno only buffers 64 bytes of incoming data. If the Mac sends faster than the loop reads, letters are lost. So the Mac sends one short line and waits for K before the next.";
const char L18[] PROGMEM = "Relay: A switch for a separate circuit like a desk lamp, moved by an electromagnet. The module has its own transistor so the 595 can drive it. Mains voltage is dangerous: only switch low voltage things until an adult checks your wiring.";
const char L19[] PROGMEM = "Next board: The ESP32-S3 has 512 KB SRAM, 8 MB PSRAM, 16 MB flash, 240 MHz dual core, Wi-Fi and 45 pins. That is 250 times the RAM of this Uno. The Pi 5 has 4-8 GB and runs a full computer. The Uno is still great as a motor and sensor helper.";

const char* const lessons[] PROGMEM = {L00,L01,L02,L03,L04,L05,L06,L07,L08,L09,L10,L11,L12,L13,L14,L15,L16,L17,L18,L19};
const uint8_t LESSON_COUNT = sizeof(lessons) / sizeof(lessons[0]);

// ================================================================= stack painting
extern uint8_t __heap_start;
extern void* __brkval;
const uint8_t PAINT = 0xC5;

uint8_t* ramFreeStart() {
  return __brkval ? (uint8_t*)__brkval : &__heap_start;
}
void paintStack() {
  uint8_t* p = ramFreeStart();
  uint8_t* sp = (uint8_t*)SP;
  while (p < sp - 24) *p++ = PAINT;
}
uint16_t freeRamNow() {
  uint8_t here;
  return (uint16_t)(&here - ramFreeStart());
}
uint16_t stackHeadroom() {   // bytes never touched since boot = the true worst case
  uint8_t* p = ramFreeStart();
  uint16_t n = 0;
  while (p < (uint8_t*)SP && *p == PAINT) { p++; n++; }
  return n;
}

// ================================================================= 74HC595 + LCD
void srWrite(uint8_t bits) {
  srBits = bits;
  SPI.beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
  SPI.transfer(bits);
  SPI.endTransaction();
  digitalWrite(PIN_LATCH, HIGH);   // rising edge copies the shifted byte to Q0..Q7
  digitalWrite(PIN_LATCH, LOW);
}
void lcdNibble(uint8_t n, bool rs) {
  uint8_t b = (srBits & (SR_RELAY | SR_BUZZ)) | (rs ? SR_RS : 0) | ((n & 0x0F) << 2);
  srWrite(b | SR_E);
  srWrite(b);                      // LCD reads the nibble on E falling
}
void lcdByte(uint8_t v, bool rs) {
  lcdNibble(v >> 4, rs);
  lcdNibble(v, rs);
  delayMicroseconds(40);
}
void lcdCmd(uint8_t c) { lcdByte(c, false); if (c < 4) delay(2); }
void lcdData(uint8_t d) { lcdByte(d, true); }

void lcdInit() {
  delay(50);
  lcdNibble(0x3, false); delay(5);
  lcdNibble(0x3, false); delayMicroseconds(150);
  lcdNibble(0x3, false); delayMicroseconds(150);
  lcdNibble(0x2, false); delayMicroseconds(150);   // now in 4-bit mode
  lcdCmd(0x28);   // 2 lines, 5x8 font
  lcdCmd(0x0C);   // display on, no cursor
  lcdCmd(0x06);   // move right after each letter
  lcdCmd(0x40);   // load all 8 custom characters
  for (uint8_t i = 0; i < 64; i++) lcdData(pgm_read_byte(&glyphs[i / 8][i % 8]));
  lcdCmd(0x01);
  memset(shown, ' ', sizeof(shown));
  memset(fb, ' ', sizeof(fb));
}

// Send only the letters that changed since the last flush.
void lcdFlush() {
  for (uint8_t r = 0; r < 2; r++) {
    int8_t cursor = -1;
    for (uint8_t c = 0; c < 16; c++) {
      if (fb[r][c] == shown[r][c]) { cursor = -1; continue; }
      if (cursor != c) lcdCmd(0x80 | (r ? 0x40 : 0x00) | c);
      lcdData((uint8_t)fb[r][c]);
      shown[r][c] = fb[r][c];
      cursor = c + 1;
    }
  }
}

void fbClear() { memset(fb, ' ', sizeof(fb)); }
void fbText(uint8_t r, uint8_t c, const char* s) {
  while (*s && c < 16) fb[r][c++] = *s++;
}
void fbTextP(uint8_t r, uint8_t c, const char* s) {   // from flash
  char ch;
  while ((ch = pgm_read_byte(s++)) && c < 16) fb[r][c++] = ch;
}
void fbNum(uint8_t r, uint8_t c, uint32_t v, uint8_t width) {
  char tmp[11];
  ultoa(v, tmp, 10);
  uint8_t len = strlen(tmp);
  while (len < width && c < 16) { fb[r][c++] = ' '; width--; }
  fbText(r, c, tmp);
}

// ================================================================= outputs
void setRelay(bool on) {
  lampOn = on;
  uint8_t b = srBits & ~SR_RELAY;
  if (on == RELAY_ACTIVE_HIGH) b |= SR_RELAY;
  srWrite(b);
}
void setBuzzer(bool on) { srWrite(on ? (srBits | SR_BUZZ) : (srBits & ~SR_BUZZ)); }
void beep(uint8_t n) { beepsLeft = n * 2; beepAt = 0; }

void serviceBeeper(uint32_t now) {
  if (!beepsLeft || now < beepAt) return;
  beepsLeft--;
  setBuzzer(beepsLeft & 1);       // odd = on, even = off
  beepAt = now + 70;
}

void setStatus(const char* l1, const char* l2, uint16_t ms) {
  memset(msgBuf, ' ', 32); msgBuf[32] = 0;
  for (uint8_t i = 0; i < 16 && l1 && l1[i]; i++) msgBuf[i] = l1[i];
  for (uint8_t i = 0; i < 16 && l2 && l2[i]; i++) msgBuf[16 + i] = l2[i];
  msgUntil = millis() + ms;
}

// ---- stepper: non-blocking, one half-step per STEP_US
const uint8_t halfSteps[8] PROGMEM = {0x1, 0x3, 0x2, 0x6, 0x4, 0xC, 0x8, 0x9};
void serviceStepper(uint32_t us) {
  if (stepPos == stepTarget) {
    if (stepperBusy) { PORTD &= 0x0F; stepperBusy = false; }   // coils off
    return;
  }
  if (!stress && head.attached()) return;   // power rule: one motor at a time
  if ((uint32_t)(us - lastStepUs) < STEP_US) return;
  lastStepUs = us;
  stepperBusy = true;
  int8_t dir = (stepTarget > stepPos) ? 1 : -1;
  stepPos += dir;
  stepPhase = (stepPhase + dir) & 7;
  PORTD = (PORTD & 0x0F) | (pgm_read_byte(&halfSteps[stepPhase]) << 4);
}
void panTo(int16_t deg) {
  deg = constrain(deg, -180, 180);
  stepTarget = (int32_t)deg * STEPS_PER_REV / 360;
}
int16_t panDeg() { return (int32_t)stepPos * 360 / STEPS_PER_REV; }

// ---- servo: moves 1 degree per 15 ms, detaches when idle
uint32_t tServo = 0;
void serviceServo(uint32_t now) {
  if (now - tServo < 15) return;
  tServo = now;
  if (servoAngle == servoGoal) {
    if (nodLeft) { nodLeft--; servoGoal = (nodLeft & 1) ? 70 : 110; if (!nodLeft) servoGoal = 90; }
    else if (head.attached() && now > servoIdleAt) head.detach();
    return;
  }
  if (!stress && stepperBusy) return;      // wait for the stepper (power rule)
  if (!head.attached()) head.attach(PIN_SERVO);
  servoAngle += (servoGoal > servoAngle) ? 1 : -1;
  head.write(servoAngle);
  servoIdleAt = now + 400;
}
void nod(uint8_t times) { nodLeft = times * 2; servoGoal = 110; }

// ================================================================= sensors
int8_t dhtWait(bool level) {        // returns loop count, -1 on timeout
  uint16_t c = 0;
  while (digitalRead(PIN_DHT) == level) if (++c > 1500) return -1;
  return c > 127 ? 127 : c;
}
bool readDht11() {
  uint8_t d[5] = {0, 0, 0, 0, 0};
  pinMode(PIN_DHT, OUTPUT);
  digitalWrite(PIN_DHT, LOW);
  delay(20);                        // start signal (>18 ms)
  noInterrupts();                   // the 4 ms that can make the servo twitch
  digitalWrite(PIN_DHT, HIGH);
  delayMicroseconds(30);
  pinMode(PIN_DHT, INPUT_PULLUP);
  bool ok = dhtWait(HIGH) >= 0 && dhtWait(LOW) >= 0 && dhtWait(HIGH) >= 0;
  for (uint8_t i = 0; ok && i < 40; i++) {
    int8_t lo = dhtWait(LOW);
    int8_t hi = dhtWait(HIGH);
    if (lo < 0 || hi < 0) { ok = false; break; }
    d[i / 8] <<= 1;
    if (hi > lo) d[i / 8] |= 1;     // long high pulse = 1
  }
  interrupts();
  if (!ok || (uint8_t)(d[0] + d[1] + d[2] + d[3]) != d[4]) return false;
  humid = d[0];
  tempC = d[2];
  return true;
}

void sampleSound() {                // every loop: catches claps
  uint16_t v = analogRead(PIN_SOUND);
  if (v < sMin) sMin = v;
  if (v > sMax) sMax = v;
}
void readSlowSensors() {
  lightPct = map(analogRead(PIN_LIGHT), 0, 1023, 0, 100);
  waterPct = min(100, map(analogRead(PIN_WATER), 0, 700, 0, 100));
  soundPeak = sMax > sMin ? sMax - sMin : 0;
  sMin = 1023; sMax = 0;
  if (soundPeak > 300 && !thinking && millis() > 3000) {   // a clap
    Serial.println(F("CLAP"));
    setStatus("  Yes, sir?", "", 1500);
    nod(1);
  }
}

// ================================================================= EEPROM
void eeInit() {
  if (EEPROM.read(0) != 'Y' || EEPROM.read(1) != 'A' || EEPROM.read(2) != 'V' || EEPROM.read(3) != '1') {
    for (int i = 0; i < 1024; i++) EEPROM.update(i, 0xFF);
    EEPROM.update(0, 'Y'); EEPROM.update(1, 'A'); EEPROM.update(2, 'V'); EEPROM.update(3, '1');
    EEPROM.put(EE_BOOTS, (uint16_t)0);
    EEPROM.put(EE_LOGHEAD, (uint16_t)0);
    EEPROM.update(EE_FLAGS, 0);
  }
  EEPROM.get(EE_BOOTS, boots);
  boots++;
  EEPROM.put(EE_BOOTS, boots);
}
int8_t cardFind(const uint8_t* uid) {
  for (uint8_t s = 0; s < CARD_SLOTS; s++) {
    int a = EE_CARDS + s * CARD_BYTES;
    if (EEPROM.read(a + 4) != 4) continue;
    bool same = true;
    for (uint8_t i = 0; i < 4; i++) if (EEPROM.read(a + i) != uid[i]) same = false;
    if (same) return s;
  }
  return -1;
}
int8_t cardFreeSlot() {
  for (uint8_t s = 0; s < CARD_SLOTS; s++) if (EEPROM.read(EE_CARDS + s * CARD_BYTES + 4) != 4) return s;
  return -1;
}
uint8_t cardCount() { uint8_t n = 0; for (uint8_t s = 0; s < CARD_SLOTS; s++) if (EEPROM.read(EE_CARDS + s * CARD_BYTES + 4) == 4) n++; return n; }
void cardSave(uint8_t slot, const uint8_t* uid, uint8_t action) {
  int a = EE_CARDS + slot * CARD_BYTES;
  for (uint8_t i = 0; i < 4; i++) EEPROM.update(a + i, uid[i]);
  EEPROM.update(a + 4, 4);
  EEPROM.update(a + 5, action);
}
void cardsClear() { for (int i = EE_CARDS; i < EE_LOG; i++) EEPROM.update(i, 0xFF); }

void logWrite() {
  uint16_t head; EEPROM.get(EE_LOGHEAD, head);
  int a = EE_LOG + (head % LOG_RECS) * LOG_REC;
  EEPROM.update(a, tempC); EEPROM.update(a + 1, humid); EEPROM.update(a + 2, lightPct);
  EEPROM.update(a + 3, waterPct); EEPROM.update(a + 4, min(255, soundPeak / 4));
  EEPROM.update(a + 5, (uint8_t)head);   // sequence byte
  head++;
  EEPROM.put(EE_LOGHEAD, head);
}
void logDump() {
  uint16_t head; EEPROM.get(EE_LOGHEAD, head);
  uint16_t n = min(head, (uint16_t)LOG_RECS);
  Serial.print(F("LOGBEGIN ")); Serial.println(n);
  for (uint16_t k = 0; k < n; k++) {       // oldest first
    uint16_t idx = (head - n + k) % LOG_RECS;
    int a = EE_LOG + idx * LOG_REC;
    Serial.print(F("LOG ")); Serial.print(k);
    for (uint8_t i = 0; i < 5; i++) { Serial.print(' '); Serial.print(EEPROM.read(a + i)); }
    Serial.println();
  }
  Serial.println(F("LOGEND"));
}

// ================================================================= reader
char rdChar(uint16_t i) { return rdFlash ? pgm_read_byte(rdText + i) : rdText[i]; }

// Word-wrap one 16-column line starting at pos. Returns where the next line starts.
uint16_t wrapLine(uint16_t pos, uint8_t* outLen) {
  while (pos < rdLen && rdChar(pos) == ' ') pos++;
  uint16_t end = pos, lastSpace = 0;
  uint8_t len = 0;
  while (end < rdLen && len < 16) {
    if (rdChar(end) == ' ') lastSpace = end;
    end++; len++;
  }
  if (end < rdLen && rdChar(end) != ' ' && lastSpace > pos) {   // don't cut a word
    len = lastSpace - pos;
    end = lastSpace;
  }
  *outLen = len;
  return end;
}
uint16_t prevLineStart(uint16_t target) {
  uint16_t pos = 0, prev = 0;
  uint8_t len;
  while (pos < target) { prev = pos; pos = wrapLine(pos, &len); if (pos == prev) break; }
  return prev;
}
void openReader(const char* text, bool inFlash, uint16_t len) {
  rdText = text; rdFlash = inFlash; rdLen = len; rdTop = 0;
  rdAuto = true; rdAutoAt = millis() + 3000;
}
bool readerDown() {            // false when the last line is already on screen
  uint8_t len;
  uint16_t next = wrapLine(rdTop, &len);
  if (wrapLine(next, &len) >= rdLen) return false;
  rdTop = next;
  return true;
}
void readerUp() { if (rdTop > 0) rdTop = prevLineStart(rdTop); }
void drawReader() {
  uint8_t len;
  uint16_t p = rdTop;
  for (uint8_t r = 0; r < 2; r++) {
    uint16_t start = p;
    while (start < rdLen && rdChar(start) == ' ') start++;
    p = wrapLine(p, &len);
    for (uint8_t c = 0; c < len; c++) fb[r][c] = rdChar(start + c);
  }
}
void openLesson(uint8_t i) {
  lessonIdx = i % LESSON_COUNT;
  const char* p = (const char*)pgm_read_word(&lessons[lessonIdx]);
  uint16_t len = strlen_P(p);
  openReader(p, true, len);
}

// ================================================================= screens
void drawFace() {
  bool blink = (millis() % 4000) < 150;
  uint8_t eye = (face == 3 || blink) ? 1 : 0;
  fb[0][0] = eye; fb[0][1] = (face == 2) ? 3 : (face == 1 ? 2 : '_'); fb[0][2] = eye;
}
void drawScreen() {
  fbClear();
  uint32_t now = millis();
  if (now < msgUntil) { memcpy(fb, msgBuf, 32); lcdFlush(); return; }
  if (thinking) {
    face = 2; drawFace();
    fbTextP(0, 4, PSTR("Thinking"));
    uint8_t dots = (now / 300) % 4;
    for (uint8_t i = 0; i < dots; i++) fb[0][12 + i] = '.';
    fbTextP(1, 0, PSTR("wait "));
    fbNum(1, 5, (now - thinkSince) / 1000, 2);
    fbTextP(1, 7, PSTR("s"));
    lcdFlush();
    return;
  }
  switch (screen) {
    case SC_HOME:
      drawFace();
      fbTextP(0, 4, PSTR("Yaver"));
      fbText(0, 11, clockStr);
      if (!macOnline) fbTextP(0, 10, PSTR("off  "));
      fb[1][0] = 4; fbNum(1, 1, tempC, 2); fb[1][3] = 'C';
      fb[1][5] = 5; fbNum(1, 6, humid, 2); fb[1][8] = '%';
      fb[1][10] = 6; fbNum(1, 11, lightPct, 3);
      fb[1][15] = lampOn ? 7 : ' ';
      break;
    case SC_ANSWER:
      if (!answerLen) { fbTextP(0, 0, PSTR("No answer yet")); fbTextP(1, 0, PSTR("Press 0-9 to ask")); }
      else drawReader();
      break;
    case SC_LESSONS:
      drawReader();
      break;
    case SC_SENSORS:
      fbTextP(0, 0, PSTR("T")); fbNum(0, 1, tempC, 2);
      fbTextP(0, 4, PSTR("H")); fbNum(0, 5, humid, 2);
      fbTextP(0, 8, PSTR("Wa")); fbNum(0, 10, waterPct, 3);
      fb[0][15] = dhtOk ? ' ' : '!';
      fbTextP(1, 0, PSTR("Lt")); fbNum(1, 2, lightPct, 3);
      fbTextP(1, 6, PSTR("Snd")); fbNum(1, 9, soundPeak, 4);
      fbTextP(1, 14, lampOn ? PSTR("L1") : PSTR("L0"));
      break;
    case SC_STATS: {
      bool page = (now / 3000) % 2;
      if (!page) {
        fbTextP(0, 0, PSTR("RAM")); fbNum(0, 3, freeRamNow(), 5);
        fbTextP(0, 9, PSTR("min")); fbNum(0, 12, stackHeadroom(), 4);
        fbTextP(1, 0, PSTR("loop")); fbNum(1, 4, loopsPerSec, 6);
        fbTextP(1, 10, PSTR("/s"));
        if (stress) fbTextP(1, 13, PSTR("STR"));
      } else {
        fbTextP(0, 0, PSTR("max loop")); fbNum(0, 8, maxLoopUs, 6); fbTextP(0, 14, PSTR("us"));
        fbTextP(1, 0, PSTR("boot")); fbNum(1, 4, boots, 4);
        fbTextP(1, 9, PSTR("pan")); {
          int16_t d = panDeg();
          fbNum(1, 12, d < 0 ? -d : d, 4);
          if (d < 0) fb[1][12] = '-';
        }
      }
      break;
    }
    case SC_CARDS:
      fbTextP(0, 0, PSTR("RFID cards")); fbNum(0, 11, cardCount(), 2); fbTextP(0, 13, PSTR("/16"));
      if (pendingBindSlot >= 0) fbTextP(1, 0, PSTR("Press 0-9: bind"));
      else fbTextP(1, 0, PSTR("Tap a card"));
      break;
    default: break;
  }
  lcdFlush();
}

void goScreen(int8_t delta) {
  screen = (Screen)((screen + SC_COUNT + delta) % SC_COUNT);
  if (screen == SC_LESSONS) openLesson(lessonIdx);
  if (screen == SC_ANSWER) openReader(answer, false, answerLen);
  if (screen == SC_STATS) maxLoopUs = 0;
}

// ================================================================= input
void ask(uint8_t n) {
  Serial.print(F("ASK ")); Serial.println(n);
  if (!macOnline) { setStatus("Mac not linked", "Run the bridge", 2500); return; }
  thinking = true; thinkSince = millis(); nod(3);
}

void handleKey(uint8_t key) {
  rdAuto = false;
  if (key <= 9) {
    if (pendingBindSlot >= 0) {
      cardSave(pendingBindSlot, pendingUid, key);
      setStatus("Card saved", "", 1500);
      Serial.print(F("BOUND ")); Serial.print(pendingBindSlot); Serial.print(' '); Serial.println(key);
      pendingBindSlot = -1; beep(2);
    } else if (screen == SC_LESSONS) {
      openLesson(key);
    } else ask(key);
    return;
  }
  switch (key) {
    case K_OK:
      if (screen == SC_LESSONS) openLesson(lessonIdx + 1);
      else if (screen == SC_HOME) ask(0);
      else screen = SC_HOME;
      break;
    case K_NEXT:   goScreen(1); break;
    case K_PREV:   goScreen(-1); break;
    case K_DOWN:   readerDown(); break;
    case K_UP:     readerUp(); break;
    case K_LEFT:   panTo(panDeg() - 30); break;
    case K_RIGHT:  panTo(panDeg() + 30); break;
    case K_CENTER: panTo(0); servoGoal = 90; break;
    case K_LAMP:   setRelay(!lampOn); Serial.print(F("LAMP ")); Serial.println(lampOn); break;
    case K_STATS:  screen = SC_STATS; maxLoopUs = 0; break;
    case K_STRESS:
      stress = !stress;
      screen = SC_STATS; maxLoopUs = 0;
      if (stress) { panTo(180); nod(20); } else { panTo(0); nodLeft = 0; servoGoal = 90; }
      Serial.print(F("STRESS ")); Serial.println(stress);
      break;
  }
}

void pollIr() {
  if (!IrReceiver.decode()) return;
  if (!(IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT)) {
    uint8_t cmd = IrReceiver.decodedIRData.command;
    int8_t key = -1;
    for (uint8_t i = 0; i < sizeof(irCodes); i++) if (pgm_read_byte(&irCodes[i]) == cmd) key = i;
    if (key >= 0) handleKey(key);
    else {
      char hex[5] = {'0', 'x', "0123456789ABCDEF"[cmd >> 4], "0123456789ABCDEF"[cmd & 15], 0};
      setStatus("Unknown IR key", hex, 1500);
      Serial.print(F("IR ")); Serial.println(hex);
    }
  }
  IrReceiver.resume();
}

void joyIsr() { joyPressed = true; joyIsrCount++; }

void pollJoystick(uint32_t now) {
  if (joyPressed) {
    joyPressed = false;
    static uint32_t lastPress = 0;
    if (now - lastPress > 250) { lastPress = now; handleKey(K_OK); }
  }
  static uint16_t joyWait = 0;
  if (now - tJoy < joyWait) return;
  int x = analogRead(PIN_JOY_X), y = analogRead(PIN_JOY_Y);
  tJoy = now; joyWait = 30;                                  // idle: check 33x a second
  if (y < 200)      { handleKey(K_UP);   joyWait = 180; }   // scroll repeats fast
  else if (y > 820) { handleKey(K_DOWN); joyWait = 180; }
  else if (x < 200) { handleKey(K_PREV); joyWait = 350; }   // screen flips slower
  else if (x > 820) { handleKey(K_NEXT); joyWait = 350; }
}

void hexUid(const uint8_t* uid, char* out) {
  for (uint8_t i = 0; i < 4; i++) {
    out[i * 2] = "0123456789ABCDEF"[uid[i] >> 4];
    out[i * 2 + 1] = "0123456789ABCDEF"[uid[i] & 15];
  }
  out[8] = 0;
}
void pollRfid(uint32_t now) {
  if (now - tRfid < 150) return;
  tRfid = now;
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  uint8_t uid[4];
  for (uint8_t i = 0; i < 4; i++) uid[i] = rfid.uid.uidByte[i];
  rfid.PICC_HaltA();
  if (memcmp(uid, lastUid, 4) == 0 && now - lastCardMs < 1500) return;
  memcpy(lastUid, uid, 4); lastCardMs = now;
  char hx[9]; hexUid(uid, hx);
  int8_t slot = cardFind(uid);
  if (slot >= 0) {
    uint8_t action = EEPROM.read(EE_CARDS + slot * CARD_BYTES + 5);
    Serial.print(F("CARD ")); Serial.print(slot); Serial.print(' '); Serial.print(action); Serial.print(' '); Serial.println(hx);
    beep(1);
    ask(action);
  } else {
    int8_t freeSlot = cardFreeSlot();
    Serial.print(F("NEWCARD ")); Serial.println(hx);
    if (freeSlot < 0) { setStatus("Card memory full", "16/16 used", 2000); beep(3); return; }
    pendingBindSlot = freeSlot; memcpy(pendingUid, uid, 4);
    screen = SC_CARDS;
    setStatus("New card", hx, 1500);
    beep(1);
  }
}

// ================================================================= serial from the Mac
void appendAnswer(const char* s) {
  while (*s) {
    if (answerLen >= ANSWER_MAX) { answerTruncated = true; return; }
    char c = *s++;
    if (c < 32 || c > 126) c = ' ';
    answer[answerLen++] = c;
  }
  answer[answerLen] = 0;
}

void handleLine(char* line) {
  lastMacMs = millis();
  if (!macOnline) { macOnline = true; face = 1; }
  char* arg = line[2] ? line + 3 : line + 2;
  if (line[0] == 'A' && line[1] == 'B') {               // answer begin
    answerLen = 0; answer[0] = 0; answerTruncated = false;
  } else if (line[0] == 'A' && line[1] == ' ') {        // answer chunk
    appendAnswer(line + 2);
  } else if (line[0] == 'A' && line[1] == 'E') {        // answer end
    thinking = false; face = 1; nodLeft = 0; servoGoal = 90;
    screen = SC_ANSWER; openReader(answer, false, answerLen);
    beep(1);
  } else if (!strncmp_P(line, PSTR("TM"), 2)) {          // TM HH:MM
    strncpy(clockStr, arg, 5); clockStr[5] = 0;
  } else if (!strncmp_P(line, PSTR("TH"), 2)) {
    thinking = true; thinkSince = millis(); nod(3);
  } else if (!strncmp_P(line, PSTR("MS"), 2)) {          // MS line1|line2
    char* bar = strchr(arg, '|');
    if (bar) *bar = 0;
    setStatus(arg, bar ? bar + 1 : "", 3000);
    thinking = false;
  } else if (!strncmp_P(line, PSTR("RL"), 2)) {
    setRelay(arg[0] == '1');
  } else if (!strncmp_P(line, PSTR("PN"), 2)) {
    panTo(atoi(arg));
  } else if (!strncmp_P(line, PSTR("ND"), 2)) {
    nod(2);
  } else if (!strncmp_P(line, PSTR("BP"), 2)) {
    beep(constrain(atoi(arg), 1, 5));
  } else if (!strncmp_P(line, PSTR("FC"), 2)) {
    face = atoi(arg) & 3;
  } else if (!strncmp_P(line, PSTR("LG"), 2)) {
    logDump();
  } else if (!strncmp_P(line, PSTR("CX"), 2)) {
    cardsClear(); setStatus("Cards cleared", "", 1500);
  } else if (!strncmp_P(line, PSTR("HI"), 2)) {
    Serial.print(F("HELLO MINIYAVER v1 cap=")); Serial.println(ANSWER_MAX);
  }
  Serial.println('K');   // ack: the Mac waits for this before the next line (64-byte RX buffer)
}

void pollSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { rxLine[rxLen] = 0; if (rxLen) handleLine(rxLine); rxLen = 0; }
    else if (rxLen < RX_LINE_MAX) rxLine[rxLen++] = c;
  }
}

void reportStatus() {
  Serial.print(F("S t=")); Serial.print(tempC);
  Serial.print(F(" h=")); Serial.print(humid);
  Serial.print(F(" light=")); Serial.print(lightPct);
  Serial.print(F(" water=")); Serial.print(waterPct);
  Serial.print(F(" sound=")); Serial.print(soundPeak);
  Serial.print(F(" lamp=")); Serial.print(lampOn);
  Serial.print(F(" pan=")); Serial.print(panDeg());
  Serial.print(F(" ram=")); Serial.print(freeRamNow());
  Serial.print(F(" ramMin=")); Serial.print(stackHeadroom());
  Serial.print(F(" loop=")); Serial.print(loopsPerSec);
  Serial.print(F(" maxLoopUs=")); Serial.print(maxLoopUs);
  Serial.print(F(" boots=")); Serial.print(boots);
  Serial.print(F(" cards=")); Serial.print(cardCount());
  Serial.print(F(" joyIrq=")); Serial.println(joyIsrCount);
}

// ================================================================= setup / loop
void setup() {
  paintStack();
  Serial.begin(115200);
  pinMode(PIN_LATCH, OUTPUT);
  DDRD |= 0xF0;                      // D4..D7 stepper outputs
  PORTD &= 0x0F;
  pinMode(PIN_JOY_SW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_JOY_SW), joyIsr, FALLING);
  SPI.begin();
  srWrite(0);
  setRelay(false);
  lcdInit();
  rfid.PCD_Init();
  IrReceiver.begin(PIN_IR, DISABLE_LED_FEEDBACK);
  eeInit();

  fbTextP(0, 0, PSTR(" MINI YAVER v1"));
  fbTextP(1, 0, PSTR("boot #")); fbNum(1, 6, boots, 1);
  lcdFlush();
  head.attach(PIN_SERVO); head.write(90);
  servoIdleAt = millis() + 600;
  beep(2);
  Serial.print(F("HELLO MINIYAVER v1 cap=")); Serial.println(ANSWER_MAX);
  uint32_t t = millis() + 1200;
  while (millis() < t) serviceBeeper(millis());
  tLog = millis();
}

void loop() {
  uint32_t startUs = micros();
  uint32_t now = millis();

  pollSerial();
  pollIr();
  pollJoystick(now);
  pollRfid(now);
  sampleSound();
  serviceStepper(startUs);
  serviceServo(now);
  serviceBeeper(now);

  if (now - tSensors >= 250) { tSensors = now; readSlowSensors(); }
  if (now - tDht >= 2000 && !stepperBusy) { tDht = now; dhtOk = readDht11(); }
  if (now - tReport >= 5000) { tReport = now; reportStatus(); }
  if (now - tLog >= LOG_EVERY_MS) { tLog = now; logWrite(); }
  // fresh millis(): lastMacMs/thinkSince can be newer than "now" (set during this loop)
  if (macOnline && millis() - lastMacMs > 20000) { macOnline = false; face = 3; thinking = false; }
  if (thinking && millis() - thinkSince > 60000) { thinking = false; setStatus("No reply", "Try again", 2000); }
  if (rdAuto && (screen == SC_ANSWER || screen == SC_LESSONS) && now > rdAutoAt) {
    rdAutoAt = now + 2200;
    if (!readerDown()) rdAuto = false;
  }
  if (now - tFace >= 100) { tFace = now; drawScreen(); }

  // stats: loops per second and the slowest single loop
  loopCount++;
  if (now - statWindow >= 1000) { loopsPerSec = loopCount; loopCount = 0; statWindow = now; }
  lastLoopUs = micros() - startUs;
  if (lastLoopUs > maxLoopUs) maxLoopUs = lastLoopUs;
}
