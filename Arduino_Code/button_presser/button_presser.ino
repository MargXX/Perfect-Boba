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

const int RX_PIN = 2;     // from ESP32
const int TX_PIN = 3;     // unused, SoftwareSerial needs one
const int SERVO_PIN = 9;

// Tune these so the arm just clicks the button without grinding into it.
const int REST_ANGLE = 90;
const int PRESS_ANGLE = 60;
const int PRESS_HOLD_MS = 300;
const int MOVE_MS = 400;  // time for the servo to reach a position

SoftwareSerial esp32(RX_PIN, TX_PIN);
Servo servo;
String line;     // from the ESP32
String usbLine;  // from the USB serial monitor

void moveTo(int angle) {
  servo.attach(SERVO_PIN, 500, 2500);  // same pulse range as servo.py on the ESP32
  servo.write(angle);
  delay(MOVE_MS);
}

void release() {
  servo.detach();  // stop pulses so the servo goes limp and draws almost nothing
}

void pressButton() {
  moveTo(PRESS_ANGLE);
  delay(PRESS_HOLD_MS);
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
  // SoftwareSerial turns on the internal pull-up, which would pull the ESP32's
  // 3.3 V pin up to 5 V. The ESP32 drives this line itself, so turn it off.
  pinMode(RX_PIN, INPUT);

  moveTo(REST_ANGLE);
  release();
  Serial.println("button_presser ready");
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
  readCommands(esp32, line);
  readCommands(Serial, usbLine);  // commands typed in ./monitor.sh, for testing
}
