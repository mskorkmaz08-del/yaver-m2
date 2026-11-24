/*
  MINI YAVER v2  -  a small desk AI on an Arduino Uno
  ---------------------------------------------------
  Five parts: Uno, 1602 LCD (with its contrast pot), KY-037 sound sensor,
  passive buzzer, one push button.

  The Uno is Yaver's face, ears-trigger and alarm clock. The brain is the
  Mini Yaver page in Chrome on the Mac
  (https://mskorkmaz08-del.github.io/yaver-m2/mini-yaver/): it listens
  through the Mac's microphone, asks Gemini, speaks the answer in Yaver's
  voice and sends a short version here over USB.

  What the Uno does on its own:
    - shows Yaver's face: idle, blink, listening, thinking, happy, asleep, alarm
    - clock (the page sets it), and a big "sleep clock" for the night
    - timers, alarms and reminders: kept in EEPROM, they ring on the buzzer
      even if the page is closed (as long as the Uno has USB power)
    - double clap or a button press = "Yaver, I'm talking to you"

  Button: short press = talk / stop.  Hold 1 s = sleep clock on or off.
          While ringing: short press = stop, hold = snooze 5 minutes.

  Libraries: only LiquidCrystal and EEPROM, both already in the Arduino IDE.
*/

#include <LiquidCrystal.h>
#include <EEPROM.h>
#include <avr/pgmspace.h>

// ---------------------------------------------------------------- pins
// D0, D1 : USB to the Mac
const uint8_t PIN_BUTTON = 2;    // push button; its other leg to GND (uses the built-in pull-up)
const uint8_t PIN_BUZZER = 5;    // passive buzzer +; its other leg to GND
const uint8_t PIN_LCD_D7 = 7;    // the LCD sits on six pins in a row: D12 down to D7
const uint8_t PIN_LCD_D6 = 8;
const uint8_t PIN_LCD_D5 = 9;
const uint8_t PIN_LCD_D4 = 10;
const uint8_t PIN_LCD_E  = 11;
const uint8_t PIN_LCD_RS = 12;
const uint8_t PIN_SOUND  = A0;   // KY-037 "AO" (analog out)

LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_E, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);

// ---------------------------------------------------------------- tunables
const uint16_t CLAP_LEVEL   = 120;   // sound jump that counts as a clap. Lower = more sensitive
const uint16_t HOLD_MS      = 800;   // a button press this long is a "hold"
const uint32_t RING_MAX_MS  = 60000; // an alarm rings at most one minute
#define ANSWER_MAX 320               // the short answer the LCD shows (the voice says it all)
#define MAX_ALARMS 6

// 4x2-character faces (20x16 pixels), generated from ASCII art by faces.py.
// Each face fills all 8 custom-character slots: top row 0-3, bottom row 4-7.
const uint8_t FACES[8][64] PROGMEM = {
  { // IDLE
    0x00,0x00,0x01,0x03,0x03,0x03,0x03,0x01,0x00,0x00,0x18,0x1C,0x1C,0x1C,0x1C,0x18,
    0x00,0x00,0x03,0x07,0x07,0x07,0x07,0x03,0x00,0x00,0x10,0x18,0x18,0x18,0x18,0x10,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x10,0x08,0x07,0x00,0x00,0x00,0x00,
    0x00,0x01,0x02,0x1C,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
  { // BLINK
    0x00,0x00,0x00,0x00,0x00,0x03,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x1C,0x18,0x00,
    0x00,0x00,0x00,0x00,0x00,0x07,0x03,0x00,0x00,0x00,0x00,0x00,0x00,0x18,0x10,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x10,0x08,0x07,0x00,0x00,0x00,0x00,
    0x00,0x01,0x02,0x1C,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
  { // LISTEN
    0x00,0x00,0x01,0x02,0x02,0x02,0x02,0x01,0x00,0x00,0x18,0x04,0x14,0x14,0x04,0x18,
    0x00,0x00,0x03,0x04,0x05,0x05,0x04,0x03,0x00,0x00,0x10,0x08,0x08,0x08,0x08,0x10,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x01,0x00,0x00,0x00,0x00,
    0x00,0x10,0x08,0x10,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
  { // THINK
    0x00,0x00,0x01,0x02,0x02,0x02,0x02,0x01,0x00,0x00,0x18,0x0C,0x0C,0x04,0x04,0x18,
    0x00,0x00,0x03,0x04,0x04,0x04,0x04,0x03,0x00,0x00,0x10,0x18,0x18,0x08,0x08,0x10,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0F,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x1E,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
  { // TALK
    0x00,0x00,0x01,0x03,0x03,0x03,0x03,0x01,0x00,0x00,0x18,0x1C,0x1C,0x1C,0x1C,0x18,
    0x00,0x00,0x03,0x07,0x07,0x07,0x07,0x03,0x00,0x00,0x10,0x18,0x18,0x18,0x18,0x10,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x03,0x04,0x04,0x03,0x00,0x00,0x00,
    0x00,0x18,0x04,0x04,0x18,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
  { // HAPPY
    0x00,0x00,0x00,0x01,0x02,0x02,0x00,0x00,0x00,0x00,0x00,0x18,0x04,0x04,0x00,0x00,
    0x00,0x00,0x00,0x03,0x04,0x04,0x00,0x00,0x00,0x00,0x00,0x10,0x08,0x08,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x1F,0x10,0x08,0x07,0x00,0x00,0x00,
    0x00,0x1F,0x01,0x02,0x1C,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
  { // SLEEP
    0x00,0x00,0x00,0x00,0x00,0x03,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x1C,0x18,0x00,
    0x00,0x00,0x00,0x00,0x00,0x07,0x03,0x00,0x00,0x00,0x00,0x00,0x00,0x18,0x10,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0F,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x1E,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
  { // ALARM
    0x00,0x00,0x01,0x02,0x02,0x02,0x02,0x01,0x00,0x00,0x18,0x04,0x14,0x14,0x04,0x18,
    0x00,0x00,0x03,0x04,0x05,0x05,0x04,0x03,0x00,0x00,0x10,0x08,0x08,0x08,0x08,0x10,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x03,0x04,0x04,0x03,0x00,0x00,0x00,
    0x00,0x18,0x04,0x04,0x18,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  },
};

enum { F_IDLE, F_BLINK, F_LISTEN, F_THINK, F_TALK, F_HAPPY, F_SLEEP, F_ALARM, G_BIGFONT = 100 };

// Big digits for the sleep clock: 3 columns x 2 rows each, from 4 shapes
// plus the LCD's own full block (character 255).
const uint8_t BIG_GLYPHS[4][8] PROGMEM = {
  {0x1F,0x1F,0x00,0x00,0x00,0x00,0x00,0x00},  // 0 bar on top
  {0x00,0x00,0x00,0x00,0x00,0x00,0x1F,0x1F},  // 1 bar at the bottom
  {0x1F,0x1F,0x00,0x00,0x00,0x00,0x1F,0x1F},  // 2 bars top and bottom
  {0x00,0x00,0x0E,0x0E,0x0E,0x00,0x00,0x00},  // 3 a dot (the colon)
};
#define FULL 255
#define BLANK ' '
const uint8_t BIG_DIGITS[10][6] PROGMEM = {   // top row 3 cells, bottom row 3 cells
  {FULL,0,FULL,   FULL,1,FULL},   // 0
  {0,FULL,BLANK,  1,FULL,1},      // 1
  {2,2,FULL,      FULL,1,1},      // 2
  {2,2,FULL,      1,1,FULL},      // 3
  {FULL,1,FULL,   BLANK,BLANK,FULL},    // 4
  {FULL,2,2,      1,1,FULL},      // 5
  {FULL,2,2,      FULL,1,FULL},   // 6
  {0,0,FULL,      BLANK,BLANK,FULL},    // 7
  {FULL,2,FULL,   FULL,1,FULL},   // 8
  {FULL,2,FULL,   1,1,FULL},      // 9
};

// ---------------------------------------------------------------- sounds
// Each tune is {frequency Hz, milliseconds} pairs; 0 Hz is a rest; {0,0} ends it.
const uint16_t TUNE_BOOT[]   PROGMEM = {523,80, 659,80, 784,80, 1047,160, 0,0};
const uint16_t TUNE_LISTEN[] PROGMEM = {880,60, 1320,90, 0,0};
const uint16_t TUNE_THINK[]  PROGMEM = {660,40, 0,0};
const uint16_t TUNE_DONE[]   PROGMEM = {1320,70, 0,30, 1760,110, 0,0};
const uint16_t TUNE_ERROR[]  PROGMEM = {330,120, 220,250, 0,0};
const uint16_t TUNE_ALARM[]  PROGMEM = {1047,120, 0,60, 1047,120, 0,60, 1319,220, 0,450, 0,0};
const uint16_t TUNE_TIMER[]  PROGMEM = {1568,100, 0,80, 1568,100, 0,80, 1568,100, 0,500, 0,0};
const uint16_t TUNE_REMIND[] PROGMEM = {988,120, 1319,220, 0,700, 0,0};
const uint16_t TUNE_OK[]     PROGMEM = {1175,60, 0,0};

const uint16_t* tune = nullptr;
bool tuneLoop = false;
uint8_t tuneIdx = 0;
uint32_t tuneNext = 0, tuneEndedAt = 0;

void play(const uint16_t* t, bool loop = false) { tune = t; tuneLoop = loop; tuneIdx = 0; tuneNext = 0; }
void stopTune() { tune = nullptr; noTone(PIN_BUZZER); tuneEndedAt = millis(); }
void serviceTune(uint32_t now) {
  if (!tune || now < tuneNext) return;
  uint16_t f = pgm_read_word(tune + tuneIdx * 2);
  uint16_t d = pgm_read_word(tune + tuneIdx * 2 + 1);
  if (!d) {                                  // end of the tune
    if (tuneLoop) { tuneIdx = 0; return; }
    stopTune(); return;
  }
  if (f) tone(PIN_BUZZER, f, d); else noTone(PIN_BUZZER);
  tuneNext = now + d;
  tuneIdx++;
}

// ---------------------------------------------------------------- state
enum Mode : uint8_t { M_IDLE, M_LISTEN, M_THINK, M_SPEAK, M_RING, M_SLEEP };
Mode mode = M_IDLE;
Mode beforeRing = M_IDLE;
uint32_t modeSince = 0;

struct Alarm { uint32_t at; uint8_t id; char kind; char label[14]; };  // kind: T timer, A alarm, D daily, R reminder, 0 empty
Alarm alarms[MAX_ALARMS];
int8_t ringing = -1;

uint32_t clockBase = 0, clockMs = 0;   // local time in seconds since 1970, and millis() when it was set
bool clockSet = false;
bool linked = false;
uint32_t lastPageMs = 0;

char answer[ANSWER_MAX + 1];
uint16_t answerLen = 0, rdTop = 0;
uint32_t rdNext = 0, speakDoneAt = 0;
bool speaking = false;

char heard[33] = "";                   // what Chrome heard, shown while listening
char wx[13] = "";                      // weather, e.g. "-3C snow"
char rx[72];
uint8_t rxLen = 0;

char fb[2][16], shown[2][16];
int16_t glyphSet = -1;

// ---------------------------------------------------------------- clock
uint32_t nowSec() { return clockBase + (millis() - clockMs) / 1000; }
void fmtTime(uint32_t t, char* out) {        // "HH:MM"
  uint32_t s = t % 86400UL;
  uint8_t h = s / 3600, m = (s / 60) % 60;
  out[0] = '0' + h / 10; out[1] = '0' + h % 10; out[2] = ':'; out[3] = '0' + m / 10; out[4] = '0' + m % 10; out[5] = 0;
}
const char DAYS[] PROGMEM = "SunMonTueWedThuFriSat";

// ---------------------------------------------------------------- LCD
void loadGlyphs(int16_t set) {
  if (set == glyphSet) return;
  glyphSet = set;
  uint8_t g[8];
  for (uint8_t c = 0; c < 8; c++) {
    for (uint8_t y = 0; y < 8; y++)
      g[y] = set == G_BIGFONT ? (c < 4 ? pgm_read_byte(&BIG_GLYPHS[c][y]) : 0) : pgm_read_byte(&FACES[set][c * 8 + y]);
    lcd.createChar(c, g);
  }
  lcd.setCursor(0, 0);
}
void fbClear() { memset(fb, ' ', sizeof(fb)); }
void fbText(uint8_t r, uint8_t c, const char* s) { while (*s && c < 16) fb[r][c++] = *s++; }
void fbTextP(uint8_t r, uint8_t c, const char* s) { char ch; while ((ch = pgm_read_byte(s++)) && c < 16) fb[r][c++] = ch; }
void fbFace() { for (uint8_t i = 0; i < 4; i++) { fb[0][i] = i; fb[1][i] = 4 + i; } }
void flush() {                                // send only what changed
  for (uint8_t r = 0; r < 2; r++)
    for (uint8_t c = 0; c < 16; c++)
      if (fb[r][c] != shown[r][c]) {
        lcd.setCursor(c, r);
        while (c < 16 && fb[r][c] != shown[r][c]) { lcd.write((uint8_t)fb[r][c]); shown[r][c] = fb[r][c]; c++; }
      }
}
void redrawAll() { memset(shown, 0xFE, sizeof(shown)); }

// Word-wrap the answer into 16-column lines.
uint16_t wrapLine(uint16_t pos, uint8_t* len) {
  while (pos < answerLen && answer[pos] == ' ') pos++;
  uint16_t end = pos, lastSpace = 0;
  uint8_t n = 0;
  while (end < answerLen && n < 16) { if (answer[end] == ' ') lastSpace = end; end++; n++; }
  if (end < answerLen && answer[end] != ' ' && lastSpace > pos) { n = lastSpace - pos; end = lastSpace; }
  *len = n;
  return end;
}
bool scrollDown() {
  uint8_t n;
  uint16_t next = wrapLine(rdTop, &n);
  if (wrapLine(next, &n) >= answerLen) return false;   // the last line is already showing
  rdTop = next;
  return true;
}

// ---------------------------------------------------------------- alarms
const int EE_MAGIC = 0, EE_ALARMS = 2;
void saveAlarms() { EEPROM.put(EE_ALARMS, alarms); }
void loadAlarms() {
  if (EEPROM.read(EE_MAGIC) != 'Y' || EEPROM.read(EE_MAGIC + 1) != '2') {
    memset(alarms, 0, sizeof(alarms));
    EEPROM.update(EE_MAGIC, 'Y'); EEPROM.update(EE_MAGIC + 1, '2');
    saveAlarms();
  }
  EEPROM.get(EE_ALARMS, alarms);
}
int8_t nextAlarm() {
  int8_t best = -1;
  for (uint8_t i = 0; i < MAX_ALARMS; i++)
    if (alarms[i].kind && (best < 0 || alarms[i].at < alarms[best].at)) best = i;
  return best;
}
void setAlarm(uint8_t id, uint32_t at, char kind, const char* label) {
  int8_t slot = -1;
  for (uint8_t i = 0; i < MAX_ALARMS; i++) if (alarms[i].kind && alarms[i].id == id) slot = i;
  for (uint8_t i = 0; slot < 0 && i < MAX_ALARMS; i++) if (!alarms[i].kind) slot = i;
  if (slot < 0) { Serial.println(F("FULL")); play(TUNE_ERROR); return; }
  alarms[slot].at = at; alarms[slot].id = id; alarms[slot].kind = kind;
  strncpy(alarms[slot].label, label, 13); alarms[slot].label[13] = 0;
  saveAlarms();
  play(TUNE_OK);
}
void clearAlarm(int16_t id) {                 // -1 = all
  for (uint8_t i = 0; i < MAX_ALARMS; i++) if (id < 0 || alarms[i].id == id) alarms[i].kind = 0;
  saveAlarms();
}
void listAlarms() {
  for (uint8_t i = 0; i < MAX_ALARMS; i++) if (alarms[i].kind) {
    Serial.print(F("ALM ")); Serial.print(alarms[i].id); Serial.print(' ');
    Serial.print(alarms[i].at); Serial.print(' '); Serial.print(alarms[i].kind); Serial.print(' ');
    Serial.println(alarms[i].label);
  }
  Serial.println(F("ALMEND"));
}

void setMode(Mode m) {
  mode = m; modeSince = millis();
  redrawAll();
}

void startRing(uint8_t i) {
  ringing = i;
  if (mode != M_RING) beforeRing = mode == M_SLEEP ? M_SLEEP : M_IDLE;
  setMode(M_RING);
  char k = alarms[i].kind;
  play(k == 'T' ? TUNE_TIMER : k == 'R' ? TUNE_REMIND : TUNE_ALARM, true);
  Serial.print(F("RING ")); Serial.print(alarms[i].id); Serial.print(' '); Serial.print(k); Serial.print(' '); Serial.println(alarms[i].label);
}
void endRing(bool snooze) {
  if (ringing < 0) return;
  Alarm& a = alarms[ringing];
  Serial.print(snooze ? F("SNOOZE ") : F("DONE ")); Serial.println(a.id);
  if (snooze) a.at = nowSec() + 300;
  else if (a.kind == 'D') { while (a.at <= nowSec()) a.at += 86400UL; }
  else a.kind = 0;
  saveAlarms();
  ringing = -1;
  stopTune();
  setMode(beforeRing);
}
void checkAlarms() {
  if (!clockSet || mode == M_RING) return;
  uint32_t t = nowSec();
  for (uint8_t i = 0; i < MAX_ALARMS; i++) {
    Alarm& a = alarms[i];
    if (!a.kind || a.at > t) continue;
    if (t - a.at > 3600) {                    // missed by over an hour (the Uno was off): skip it
      if (a.kind == 'D') { while (a.at <= t) a.at += 86400UL; } else a.kind = 0;
      saveAlarms();
      continue;
    }
    startRing(i);
    return;
  }
}

// ---------------------------------------------------------------- input
void talk() {
  if (mode == M_RING) return;
  stopTune();
  Serial.println(F("TALK"));
  heard[0] = 0;
  setMode(M_LISTEN);
  play(TUNE_LISTEN);
  if (!linked) { strcpy_P(heard, PSTR("Open the page")); }
}
void stopTalk() {
  Serial.println(F("STOP"));
  stopTune();
  setMode(M_IDLE);
}

// Button with debounce: short press on release, hold fires once at HOLD_MS.
bool btnDown = false, holdFired = false;
uint32_t btnSince = 0, btnChange = 0;
void pollButton(uint32_t now) {
  bool down = digitalRead(PIN_BUTTON) == LOW;
  if (down != btnDown && now - btnChange > 25) {
    btnChange = now;
    btnDown = down;
    if (down) { btnSince = now; holdFired = false; }
    else if (!holdFired) {                    // a short press
      if (mode == M_RING) endRing(false);
      else if (mode == M_SLEEP) setMode(M_IDLE);
      else if (mode == M_IDLE) talk();
      else stopTalk();
    }
  }
  if (btnDown && !holdFired && now - btnSince >= HOLD_MS) {
    holdFired = true;
    if (mode == M_RING) endRing(true);
    else { setMode(mode == M_SLEEP ? M_IDLE : M_SLEEP); play(TUNE_OK); Serial.println(mode == M_SLEEP ? F("SLEEP 1") : F("SLEEP 0")); }
  }
}

// Double clap: two loud jumps 150-700 ms apart. Ignored while the buzzer or
// Yaver's voice could set it off.
uint16_t sMin = 1023, sMax = 0;
uint32_t sWindow = 0, lastClap = 0;
void pollSound(uint32_t now) {
  uint16_t v = analogRead(PIN_SOUND);
  if (v < sMin) sMin = v;
  if (v > sMax) sMax = v;
  if (now - sWindow < 30) return;
  uint16_t swing = sMax - sMin;
  sMin = 1023; sMax = 0; sWindow = now;
  bool quietTime = !tune && now - tuneEndedAt > 400 && (mode == M_IDLE || mode == M_SLEEP);
  if (swing < CLAP_LEVEL || !quietTime) return;
  uint32_t gap = now - lastClap;
  if (gap < 150) return;                      // the same clap still ringing
  if (gap < 700) { lastClap = 0; Serial.println(F("CLAP2")); talk(); }
  else lastClap = now;
}

// ---------------------------------------------------------------- messages from the page
void handleLine(char* line) {
  lastPageMs = millis();
  linked = true;
  char* arg = line[2] ? line + 3 : line + 2;
  if (!strncmp_P(line, PSTR("TM"), 2)) {                // TM <local seconds since 1970>
    clockBase = strtoul(arg, nullptr, 10); clockMs = millis(); clockSet = true;
  } else if (!strncmp_P(line, PSTR("ST"), 2)) {         // state: L listen, T think, S speak, I idle, E error
    char s = arg[0];
    if (s == 'L' && mode != M_LISTEN) { setMode(M_LISTEN); play(TUNE_LISTEN); }
    else if (s == 'T') { setMode(M_THINK); play(TUNE_THINK); }
    else if (s == 'S') { speaking = true; }
    else if (s == 'I') { speaking = false; speakDoneAt = millis(); if (mode == M_LISTEN || mode == M_THINK) setMode(M_IDLE); }
    else if (s == 'E') { play(TUNE_ERROR); setMode(M_IDLE); }
  } else if (!strncmp_P(line, PSTR("HD"), 2)) {         // what was heard so far
    strncpy(heard, arg, 32); heard[32] = 0;
  } else if (line[0] == 'A' && line[1] == 'B') {        // answer begins
    answerLen = 0; answer[0] = 0;
  } else if (line[0] == 'A' && line[1] == ' ') {        // a piece of the answer
    for (char* p = line + 2; *p && answerLen < ANSWER_MAX; p++) answer[answerLen++] = (*p < 32 || *p > 126) ? ' ' : *p;
    answer[answerLen] = 0;
  } else if (line[0] == 'A' && line[1] == 'E') {        // answer complete: show it
    rdTop = 0; rdNext = millis() + 2500; speakDoneAt = 0;
    if (mode != M_RING) { setMode(M_SPEAK); play(TUNE_DONE); }
  } else if (!strncmp_P(line, PSTR("AL"), 2)) {         // AL <id> <at> <kind> <label>
    char* p = arg;
    uint8_t id = strtoul(p, &p, 10);
    uint32_t at = strtoul(p, &p, 10);
    while (*p == ' ') p++;
    char kind = *p ? *p++ : 'A';
    while (*p == ' ') p++;
    setAlarm(id, at, kind, p);
  } else if (!strncmp_P(line, PSTR("AX"), 2)) {         // AX <id> or AX * (all)
    clearAlarm(arg[0] == '*' ? -1 : atoi(arg));
  } else if (!strncmp_P(line, PSTR("LS"), 2)) {
    listAlarms();
  } else if (!strncmp_P(line, PSTR("WX"), 2)) {
    strncpy(wx, arg, 12); wx[12] = 0;
  } else if (!strncmp_P(line, PSTR("SL"), 2)) {         // sleep clock on/off
    setMode(arg[0] == '1' ? M_SLEEP : M_IDLE);
  } else if (!strncmp_P(line, PSTR("HI"), 2)) {
    Serial.println(F("HELLO MINIYAVER v2"));
  }
  Serial.println('K');   // "got it": the page waits for this before sending more (the Uno holds only 64 bytes)
}
void pollSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { rx[rxLen] = 0; if (rxLen) handleLine(rx); rxLen = 0; }
    else if (rxLen < sizeof(rx) - 1) rx[rxLen++] = c;
  }
}

// ---------------------------------------------------------------- screens
void drawIdleRight(uint32_t now) {
  char t[6];
  if (clockSet) {
    uint32_t s = nowSec();
    fmtTime(s, t);
    fbText(0, 5, t);
    char d[4]; uint8_t wd = (s / 86400UL + 4) % 7;
    for (uint8_t i = 0; i < 3; i++) d[i] = pgm_read_byte(&DAYS[wd * 3 + i]);
    d[3] = 0;
    fbText(0, 12, d);
  } else fbTextP(0, 5, PSTR("--:--"));
  if (!linked) { fbTextP(1, 4, PSTR(" page offline")); return; }
  // The bottom line takes turns: next alarm or timer, then the weather.
  int8_t n = nextAlarm();
  bool showAlarm = n >= 0 && clockSet && (!wx[0] || alarms[n].kind == 'T' || (now / 3000) % 2 == 0);  // a running timer always shows
  if (showAlarm) {
    Alarm& a = alarms[n];
    fb[1][4] = ' '; fb[1][5] = a.kind == 'D' ? 'A' : a.kind;
    if (a.kind == 'T') {                      // a timer counts down mm:ss
      uint32_t left = a.at > nowSec() ? a.at - nowSec() : 0;
      if (left > 5999) left = 5999;
      char c[6] = {(char)('0' + left / 600), (char)('0' + (left / 60) % 10), ':', (char)('0' + (left % 60) / 10), (char)('0' + left % 10), 0};
      fbText(1, 7, c);
    } else { fmtTime(a.at, t); fbText(1, 7, t); }
    fbText(1, 13, a.label);                   // first letters of the label
  } else if (wx[0]) fbText(1, 5, wx);
  else fbTextP(1, 5, PSTR("clap clap!"));
}

void drawBigClock() {
  loadGlyphs(G_BIGFONT);
  if (!clockSet) { fbTextP(0, 2, PSTR("Good night")); fbTextP(1, 2, PSTR("(no clock yet)")); return; }
  char t[6]; fmtTime(nowSec(), t);
  uint8_t col = 0;
  for (uint8_t k = 0; k < 5; k++) {
    if (k == 2) { fb[0][col] = 3; fb[1][col] = 3; col++; continue; }
    uint8_t d = t[k] - '0';
    for (uint8_t i = 0; i < 3; i++) {
      fb[0][col + i] = pgm_read_byte(&BIG_DIGITS[d][i]);
      fb[1][col + i] = pgm_read_byte(&BIG_DIGITS[d][3 + i]);
    }
    col += 3;
  }
  if (nextAlarm() >= 0) { fb[0][14] = 'A'; fb[0][15] = '!'; }  // an alarm is set
}

void draw(uint32_t now) {
  fbClear();
  switch (mode) {
    case M_IDLE: {
      bool blink = (now % 4500) < 160;
      loadGlyphs(blink ? F_BLINK : (now - modeSince < 2500 && speakDoneAt ? F_HAPPY : F_IDLE));
      fbFace();
      drawIdleRight(now);
      break;
    }
    case M_LISTEN: {
      loadGlyphs(F_LISTEN); fbFace();
      fbTextP(0, 5, PSTR("Listening"));
      uint8_t n = strlen(heard);
      fbText(1, 5, heard + (n > 11 ? n - 11 : 0));    // the newest words
      if (!linked && now - modeSince > 3000) setMode(M_IDLE);
      break;
    }
    case M_THINK: {
      loadGlyphs(F_THINK); fbFace();
      fbTextP(0, 5, PSTR("Thinking"));
      for (uint8_t i = 0; i < (now / 300) % 4; i++) fb[0][13 + i] = '.';
      uint8_t n = strlen(heard);
      fbText(1, 5, heard + (n > 11 ? n - 11 : 0));
      if (now - modeSince > 45000) { play(TUNE_ERROR); setMode(M_IDLE); }  // the page never answered
      break;
    }
    case M_SPEAK: {
      uint8_t n;
      uint16_t p = rdTop;
      for (uint8_t r = 0; r < 2; r++) {
        uint16_t start = p;
        while (start < answerLen && answer[start] == ' ') start++;
        p = wrapLine(p, &n);
        for (uint8_t c = 0; c < n; c++) fb[r][c] = answer[start + c];
      }
      if (now > rdNext) {
        rdNext = now + 2200;
        // At the end, wait until the voice has finished and 4 more seconds.
        // (If the page never says the voice is done, give up after 15 s.)
        bool voiceDone = !speaking && (speakDoneAt ? now - speakDoneAt > 4000 : now - modeSince > 15000);
        if (!scrollDown() && voiceDone) setMode(M_IDLE);
      }
      break;
    }
    case M_RING: {
      if (ringing < 0) { setMode(M_IDLE); break; }
      loadGlyphs(F_ALARM);
      if ((now / 400) % 2) fbFace();          // the face flashes
      Alarm& a = alarms[ringing];
      fbTextP(0, 5, a.kind == 'T' ? PSTR("TIME'S UP") : a.kind == 'R' ? PSTR("REMINDER") : PSTR("WAKE UP!"));
      fbText(1, 5, a.label);
      if (now - modeSince > RING_MAX_MS) endRing(false);
      break;
    }
    case M_SLEEP:
      drawBigClock();
      break;
  }
  flush();
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  lcd.begin(16, 2);
  loadAlarms();
  loadGlyphs(F_HAPPY);
  memset(shown, ' ', sizeof(shown));
  fbClear(); fbFace();
  fbTextP(0, 5, PSTR("Mini Yaver"));
  fbTextP(1, 5, PSTR("at your"));
  fbTextP(1, 13, PSTR("svc"));
  flush();
  play(TUNE_BOOT);
  Serial.println(F("HELLO MINIYAVER v2"));
  uint32_t until = millis() + 1500;
  while (millis() < until) serviceTune(millis());
  setMode(M_IDLE);
}

uint32_t tDraw = 0, tAlarm = 0;
void loop() {
  uint32_t now = millis();
  pollSerial();
  pollButton(now);
  pollSound(now);
  serviceTune(now);
  if (now - tAlarm >= 500) { tAlarm = now; checkAlarms(); }
  if (linked && millis() - lastPageMs > 20000) { linked = false; if (mode == M_LISTEN || mode == M_THINK) setMode(M_IDLE); }
  if (now - tDraw >= 100) { tDraw = now; draw(now); }
}
