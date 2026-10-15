#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

// =====================================================
// ECOVISION - AUTOMATIC GARBAGE CLASSIFICATION SYSTEM
// =====================================================

// HC-SR04
const int TRIG_PIN = 2;
const int ECHO_PIN = 3;

// Servo
const int SERVO_PIN = 9;

// I2C LCD: SDA -> A4, SCL -> A5
// If your LCD does not show text, try 0x3F instead of 0x27.
LiquidCrystal_I2C lcd(0x27, 16, 2);

Servo sortingServo;

// Detection distance in centimeters
const float DETECT_DISTANCE = 20.0;

// Servo positions - adjust these to match your sorter
const int CENTER_ANGLE = 90;
const int BIO_ANGLE = 145;
const int NON_BIO_ANGLE = 35;

bool objectPresent = false;

// Result display timing (non-blocking, so the sensor keeps reporting distance)
bool resultActive = false;
unsigned long resultStart = 0;
const unsigned long RESULT_TIME = 2500;

// Serial command buffer (non-blocking line reader)
String rxLine = "";

// Scan mode, set by the EcoVision website (MODE_AUTO / MODE_MANUAL).
// Auto   : the ultrasonic sensor starts the scan.
// Manual : the sensor still reports OBJECT_DETECTED and distance, but the LCD
//          waits for the person to press "Scan now" in the browser.
bool autoMode = true;
unsigned long lastDetectionTime = 0;
const unsigned long detectionDelay = 2000;


// =====================================================
// LCD HELPERS
// The LCD is 16 columns x 2 rows. "NON-BIODEGRADABLE" is 17 characters,
// so it cannot fit on one row. It is split over both rows instead:
//     RESULT: NON-
//     BIODEGRADABLE
// =====================================================

void showLcd(const char* line1, const char* line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

void showReady() {
  showLcd("EcoVision Ready", "Place Object");
}


// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(9600);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  sortingServo.attach(SERVO_PIN);
  sortingServo.write(CENTER_ANGLE);

  lcd.init();
  lcd.backlight();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("EcoVision");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");

  delay(1500);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("EcoVision Ready");
  lcd.setCursor(0, 1);
  lcd.print("Place Object");

  Serial.println("ECOVISION_READY");
}


// =====================================================
// HC-SR04 DISTANCE
// =====================================================

float getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    return -1;
  }

  return duration * 0.0343 / 2.0;
}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  // Check commands coming from the EcoVision browser via Web Serial
  readEcoVisionCommand();

  // End of the result display: centre the servo
  if (resultActive && millis() - resultStart >= RESULT_TIME) {
    resultActive = false;
    sortingServo.write(CENTER_ANGLE);
    if (objectPresent) showLcd("Remove Object", "to scan again");
    else showReady();
  }

  float distance = getDistance();

  if (distance > 0) {

    // Send distance to EcoVision
    Serial.print("DISTANCE:");
    Serial.println(distance, 1);

    // Object has arrived
    if (distance <= DETECT_DISTANCE && !objectPresent) {

      if (millis() - lastDetectionTime > detectionDelay) {

        objectPresent = true;
        lastDetectionTime = millis();

        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Object Detected");
        lcd.setCursor(0, 1);
        lcd.print(autoMode ? "Scanning..." : "Press Scan now");

        Serial.println("OBJECT_DETECTED");

        // Allow the object to settle
        delay(500);
      }
    }

    // Object has been removed
    if (distance > DETECT_DISTANCE + 5 && objectPresent) {

      objectPresent = false;


      sortingServo.write(CENTER_ANGLE);

      resultActive = false;
      showReady();

      Serial.println("OBJECT_REMOVED");

      delay(300);
    }
  }

  delay(100);
}


// =====================================================
// COMMANDS FROM ECOVISION BROWSER (WEB SERIAL)
// =====================================================

void readEcoVisionCommand() {

  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') continue;
    if (c != '\n') {
      if (rxLine.length() < 24) rxLine += c;   // ignore runaway input
      continue;
    }

    String command = rxLine;
    rxLine = "";
    command.trim();
    if (command.length() == 0) continue;

    // -------------------------------------------------
    // SCAN MODE (sent by the website)
    // -------------------------------------------------
    if (command == "MODE_AUTO" || command == "MODE_MANUAL") {

      autoMode = (command == "MODE_AUTO");

      showLcd(autoMode ? "Auto Scan" : "Manual Scan",
              autoMode ? "Place Object" : "Use Scan now");

      Serial.println(autoMode ? "MODE_AUTO_ACCEPTED" : "MODE_MANUAL_ACCEPTED");
    }

    // -------------------------------------------------
    // BIODEGRADABLE
    // -------------------------------------------------
    else if (command == "BIO") {


      showLcd("RESULT:", "BIODEGRADABLE");          // 13 characters

      sortingServo.write(BIO_ANGLE);
      resultActive = true;
      resultStart = millis();

      Serial.println("BIO_ACCEPTED");
    }

    // -------------------------------------------------
    // NON-BIODEGRADABLE
    // "NON-BIODEGRADABLE" is 17 characters, one more than the
    // 16-column LCD, so it is split across the two rows.
    // -------------------------------------------------
    else if (command == "NON_BIO") {


      showLcd("RESULT: NON-", "BIODEGRADABLE");     // 12 + 13 characters

      sortingServo.write(NON_BIO_ANGLE);
      resultActive = true;
      resultStart = millis();

      Serial.println("NON_BIO_ACCEPTED");
    }
  }
}
