// Drives the button-pressing servo (MG995 / MG996R) on command from the ESP32.
//
// The ESP32 sends text lines over one wire (9600 baud):
//   PRESS        press the button once, then return to rest
//   ANGLE <deg>  move to an angle and hold (for finding PRESS_ANGLE / REST_ANGLE)
//
// Wiring:
//   ESP32 GPIO 18 -> Arduino pin 2      ESP32 GND -> Arduino GND
//   Servo orange  -> Arduino pin 9      Servo red / brown -> Arduino 5V / GND

#include <Servo.h>
#include <SoftwareSerial.h>
#include <avr/wdt.h>

const int RX_PIN = 2;     // from ESP32
const int TX_PIN = 3;     // unused, SoftwareSerial needs one
const int SERVO_PIN = 9;
const int LED_PIN = LED_BUILTIN;  // the "L" LED: flashes when a valid command arrives

// Tune these so the arm just clicks the button without grinding into it.
const int REST_ANGLE = 90;
const int PRESS_ANGLE = 60;
const int PRESS_HOLD_MS = 300;
const int STEP_MS = 8;    // per-degree delay; moving gradually keeps current surges low
const int SETTLE_MS = 100;

SoftwareSerial esp32(RX_PIN, TX_PIN);
Servo servo;
String line;     // from the ESP32
String usbLine;  // from the USB serial monitor
int current = REST_ANGLE;  // assumed position; the servo isn't moved at startup

// Move one degree at a time. A full-speed jump draws a big current surge,
// which can drop the 5V enough to reset the Uno.
void moveTo(int angle) {
  if (!servo.attached()) {
    servo.write(current);                // set the first pulse before attaching
    servo.attach(SERVO_PIN, 500, 2500);  // same pulse range as servo.py on the ESP32
  }
  int step = angle > current ? 1 : -1;
  while (current != angle) {
    current += step;
    servo.write(current);
    delay(STEP_MS);
    wdt_reset();
  }
  delay(SETTLE_MS);
}

void release() {
  servo.detach();  // stop pulses so the servo goes limp and draws almost nothing
}

void pressButton() {
  moveTo(PRESS_ANGLE);
  delay(PRESS_HOLD_MS);
  wdt_reset();
  moveTo(REST_ANGLE);
  release();
}

void handle(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  // Line noise can put junk characters in front of a command (e.g. "%UMM)PRESS"),
  // so look for a command anywhere in the line and ignore what comes before it.
  int p = cmd.indexOf("PRESS");
  int a = cmd.indexOf("ANGLE ");

  if (p >= 0 || a >= 0) {
    // Flash so you can see commands arriving when the Uno isn't on the PC.
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
  }

  if (p >= 0) {
    Serial.println("got: PRESS");
    pressButton();
  } else if (a >= 0) {
    int angle = constrain(cmd.substring(a + 6).toInt(), 0, 180);
    Serial.print("got: ANGLE ");
    Serial.println(angle);
    moveTo(angle);
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

  // Don't move the servo here: its startup surge used to reset the Uno, which
  // re-ran setup() and moved it again — a reset loop. It stays limp until a command.
  Serial.println("button_presser ready");

  // Watchdog: if the program ever freezes (e.g. the servo drags the 5V down
  // far enough to crash the chip), the Uno restarts itself after 2 s.
  wdt_enable(WDTO_2S);
}

// Collect characters from `in` into `buf`; run the command when a full line arrives.
void readCommands(Stream &in, String &buf) {
  while (in.available()) {
    char c = in.read();
    if (c == '\n' || c == '\r') {
      handle(buf);
      buf = "";
    } else if (buf.length() < 32) {
      buf += c;
    }
  }
}

void loop() {
  wdt_reset();
  readCommands(esp32, line);
  readCommands(Serial, usbLine);  // commands typed in ./monitor.sh, for testing
}
