/*
  MIC TEST  -  is the KY-037 good enough to hear words?
  -----------------------------------------------------
  Same wiring as Mini Yaver: KY-037 AO -> A0, + -> 5V, G -> GND,
  and the LCD on D12..D7 (it's optional: the numbers also go to the
  Serial Monitor at 115200 baud).

  It records the sensor 8000 times a second, the same way Yaver will,
  and 4 times a second shows:
    level  the quiet middle of the signal (should be near 512)
    swing  how far your voice moves it, highest minus lowest
    avg    the average movement (a steadier "how loud")

  How to read it:
    1. Stay quiet for a few seconds: swing should be small (under ~10).
    2. Talk normally about 20 cm away, then 5 cm away.
       swing under 20   : too weak for words. Get a MAX9814 mic module.
       swing 20 to 60   : maybe. Gemini will catch loud, close speech.
       swing over 60    : good enough to try.
    3. If level is stuck near 0 or near 1023, or swing never changes,
       turn the little screw on the blue box slowly and watch level.
*/

#include <LiquidCrystal.h>

const uint8_t PIN_SOUND = A0;
LiquidCrystal lcd(12, 11, 10, 9, 8, 7);

const uint16_t SAMPLES = 2000;   // 2000 samples at 8000 a second = a quarter of a second
const uint16_t TICK_US = 125;    // 1 / 8000 s

long baseline = 512;             // the quiet middle, learned as it runs
uint16_t bestSwing = 0;          // loudest so far (shown on the LCD)

void setup() {
  Serial.begin(115200);
  lcd.begin(16, 2);
  lcd.print(F("Mic test"));
  lcd.setCursor(0, 1);
  lcd.print(F("talk to the KY"));
  Serial.println(F("level  swing  avg   (talk into the KY-037)"));
  delay(1000);
}

void loop() {
  uint16_t lo = 1023, hi = 0;
  long sum = 0, moveSum = 0;
  uint32_t next = micros();
  for (uint16_t i = 0; i < SAMPLES; i++) {
    while ((long)(micros() - next) < 0) {}      // wait for the next 1/8000 s
    next += TICK_US;
    int v = analogRead(PIN_SOUND);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    sum += v;
    moveSum += abs(v - baseline);
  }
  long level = sum / SAMPLES;
  baseline = (baseline * 3 + level) / 4;          // follow slow drift, not your voice
  uint16_t swing = hi - lo;
  uint16_t avg = moveSum / SAMPLES;
  if (swing > bestSwing) bestSwing = swing;

  // Serial Monitor: numbers and a bar
  Serial.print(level); Serial.print(F("    "));
  Serial.print(swing); Serial.print(F("    "));
  Serial.print(avg);   Serial.print(F("   "));
  for (uint16_t i = 0; i < swing / 4 && i < 60; i++) Serial.print('#');
  Serial.println();

  // LCD: "L512 S 34 max 88" and a bar
  char top[17];
  snprintf(top, sizeof(top), "L%-4d S%-3u mx%-3u", (int)level, swing, bestSwing);
  lcd.setCursor(0, 0);
  lcd.print(top);
  lcd.setCursor(0, 1);
  uint8_t bars = swing / 8 > 16 ? 16 : swing / 8;
  for (uint8_t i = 0; i < 16; i++) lcd.write(i < bars ? (uint8_t)255 : ' ');
}
