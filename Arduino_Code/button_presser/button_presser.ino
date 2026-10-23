// Drives the button-pressing servos (MG995 / MG996R) on command from the ESP32.
//
// The ESP32 sends text lines over one wire (9600 baud):
//   PRESS n id check   press with servo n (1 or 2), then return to rest. The ESP32
//                      sends each press 3 times with the same id; check = (7n + id) % 97.
//                      In the monitor, plain "PRESS" or "PRESS 2" also works.
//   ANGLE [n] <deg>    move servo n to an angle and hold (for finding press/rest angles)
//
// Wiring:
//   ESP32 GPIO 18 -> Arduino pin 2      ESP32 GND -> Arduino GND
//   Servo 1 orange -> Arduino pin 9     Servo 2 orange -> Arduino pin 10
//   Both servos red / brown -> Arduino 5V / GND
//   Skip the GND jumper when both boards are on the Mac's USB (ground loop); use it otherwise.

#include <Servo.h>
#include <SoftwareSerial.h>
#include <avr/wdt.h>

const int RX_PIN = 2;     // from ESP32
const int TX_PIN = 3;     // unused, SoftwareSerial needs one
const int LED_PIN = LED_BUILTIN;  // the "L" LED: flashes when a valid command arrives

// One entry per servo. Tune press/rest so each arm just clicks its button
// without grinding into it.
const int NUM_SERVOS = 2;
const int SERVO_PINS[NUM_SERVOS]   = {9, 10};
const int REST_ANGLE[NUM_SERVOS]   = {90, 90};
const int PRESS_ANGLE[NUM_SERVOS]  = {60, 120};  // servo 2 is mounted the other way round
const int PRESS_HOLD_MS = 300;
const int STEP_MS = 8;    // per-degree delay; moving gradually keeps current surges low
const int SETTLE_MS = 100;

SoftwareSerial esp32(RX_PIN, TX_PIN);
Servo servos[NUM_SERVOS];
int current[NUM_SERVOS];  // assumed positions; servos aren't moved at startup
String line;     // from the ESP32
String usbLine;  // from the USB serial monitor
long lastPressId = -1;  // id of the last PRESS acted on, to skip its repeated copies

// Move one degree at a time. A full-speed jump draws a big current surge,
// which can drop the 5V enough to reset the Uno.
void moveTo(int i, int angle) {
  if (!servos[i].attached()) {
    servos[i].write(current[i]);               // set the first pulse before attaching
    servos[i].attach(SERVO_PINS[i], 500, 2500);  // same pulse range as servo.py on the ESP32
  }
  int step = angle > current[i] ? 1 : -1;
  while (current[i] != angle) {
    current[i] += step;
    servos[i].write(current[i]);
    delay(STEP_MS);
    wdt_reset();
  }
  delay(SETTLE_MS);
}

void release(int i) {
  servos[i].detach();  // stop pulses so the servo goes limp and draws almost nothing
}

// Servos move one at a time and go limp afterwards, so only one draws current at once.
void pressButton(int i) {
  moveTo(i, PRESS_ANGLE[i]);
  delay(PRESS_HOLD_MS);
  wdt_reset();
  moveTo(i, REST_ANGLE[i]);
  release(i);
}

void flashLed() {
  digitalWrite(LED_PIN, HIGH);
  delay(100);
  digitalWrite(LED_PIN, LOW);
}

// Must match press_check() in ESP32_Code/lib/button.py.
long pressCheck(long n, long id) {
  return (n * 7 + id) % 97;
}

// Read up to three space-separated whole numbers into a, b, c.
// Returns how many were found; stops at anything that isn't a digit or space.
int parseNumbers(String s, int &a, long &b, long &c) {
  long vals[3];
  int count = 0;
  int i = 0;
  while (count < 3) {
    while (i < (int)s.length() && s[i] == ' ') i++;
    if (i >= (int)s.length() || !isDigit(s[i])) break;
    long v = 0;
    while (i < (int)s.length() && isDigit(s[i])) {
      v = v * 10 + (s[i] - '0');
      i++;
    }
    vals[count++] = v;
  }
  if (count > 0) a = vals[0];
  if (count > 1) b = vals[1];
  if (count > 2) c = vals[2];
  return count;
}

void handle(String cmd, bool fromEsp32) {
  cmd.trim();
  cmd.toUpperCase();
  // Line noise can put junk characters in front of a command (e.g. "%UMM)PRESS"),
  // so look for a command anywhere in the line and ignore what comes before it.
  int p = cmd.indexOf("PRESS");
  int a = cmd.indexOf("ANGLE ");

  if (p >= 0) {
    // From the ESP32: "PRESS <servo> <id> <check>", e.g. "PRESS 2 417 4".
    // Typed in the monitor: "PRESS" or "PRESS 2".
    int n = 1;
    long id = -1;
    long check = -1;
    int parts = parseNumbers(cmd.substring(p + 5), n, id, check);

    if (fromEsp32) {
      // A garbled copy could still contain "PRESS" with wrong numbers, which would
      // cause an extra press and flip the toggle the wrong way. Require the
      // checksum so only intact commands are acted on.
      if (parts != 3 || check != pressCheck(n, id)) {
        Serial.println("(ignored garbled PRESS)");
        return;
      }
      // The ESP32 sends each press several times in case some copies get garbled.
      // Every copy has the same id, so only the first good one is acted on.
      if (id == lastPressId) {
        return;
      }
      lastPressId = id;
    }
    if (n < 1 || n > NUM_SERVOS) {
      Serial.println("bad servo number");
      return;
    }
    flashLed();
    Serial.print("got: PRESS ");
    Serial.println(n);
    pressButton(n - 1);
  } else if (a >= 0) {
    // "ANGLE 90" (servo 1) or "ANGLE 2 90"
    String args = cmd.substring(a + 6);
    args.trim();
    int n = 1;
    int space = args.indexOf(' ');
    if (space >= 0) {
      n = args.substring(0, space).toInt();
      args = args.substring(space + 1);
    }
    if (n < 1 || n > NUM_SERVOS) {
      Serial.println("bad servo number");
      return;
    }
    int angle = constrain(args.toInt(), 0, 180);
    flashLed();
    Serial.print("got: ANGLE ");
    Serial.print(n);
    Serial.print(" ");
    Serial.println(angle);
    moveTo(n - 1, angle);
  } else if (cmd.length() > 0) {
    Serial.println("(ignored noise)");
  }
}

void setup() {
  Serial.begin(9600);  // USB debug output: ./monitor.sh
  esp32.begin(9600);
  // Keep SoftwareSerial's internal pull-up on RX_PIN. Without it the wire floats
  // whenever the ESP32 isn't sending, and the noise keeps the Uno so busy it
  // misses commands. The pull-up only leaks ~40 uA into the ESP32 pin, and the
  // 1k series resistor on the line limits it further.
  pinMode(LED_PIN, OUTPUT);

  // Don't move the servos here: a startup surge used to reset the Uno, which
  // re-ran setup() and moved them again — a reset loop. They stay limp until a command.
  for (int i = 0; i < NUM_SERVOS; i++) {
    current[i] = REST_ANGLE[i];
  }
  Serial.println("button_presser ready");

  // Watchdog: if the program ever freezes (e.g. a servo drags the 5V down
  // far enough to crash the chip), the Uno restarts itself after 2 s.
  wdt_enable(WDTO_2S);
}

// Collect characters from `in` into `buf`; run the command when a full line arrives.
void readCommands(Stream &in, String &buf, bool fromEsp32) {
  while (in.available()) {
    char c = in.read();
    if (c == '\n' || c == '\r') {
      handle(buf, fromEsp32);
      buf = "";
    } else if (buf.length() < 32) {
      buf += c;
    }
  }
}

void loop() {
  wdt_reset();
  readCommands(esp32, line, true);
  readCommands(Serial, usbLine, false);  // commands typed in ./monitor.sh, for testing
}
