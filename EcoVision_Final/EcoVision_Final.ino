#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

// =====================================================
// ECOVISION - AUTOMATIC GARBAGE CLASSIFICATION SYSTEM
// =====================================================

// HC-SR04
const int TRIG_PIN = 2;
const int ECHO_PIN = 3;

// LEDs
const int GREEN_LED = 8;
const int RED_LED = 7;

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
const int BIO_ANGLE = 35;
const int NON_BIO_ANGLE = 145;

bool objectPresent = false;
unsigned long lastDetectionTime = 0;
const unsigned long detectionDelay = 2000;


// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(9600);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);

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
  // Check commands coming from EcoVision Python
  readEcoVisionCommand();

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
        lcd.print("Scanning...");

        Serial.println("OBJECT_DETECTED");

        // Allow the object to settle
        delay(500);
      }
    }

    // Object has been removed
    if (distance > DETECT_DISTANCE + 5 && objectPresent) {

      objectPresent = false;

      digitalWrite(GREEN_LED, LOW);
      digitalWrite(RED_LED, LOW);

      sortingServo.write(CENTER_ANGLE);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("EcoVision Ready");
      lcd.setCursor(0, 1);
      lcd.print("Place Object");

      Serial.println("OBJECT_REMOVED");

      delay(300);
    }
  }

  delay(100);
}


// =====================================================
// COMMANDS FROM ECOVISION PYTHON
// =====================================================

void readEcoVisionCommand() {

  while (Serial.available() > 0) {

    String command = Serial.readStringUntil('\n');
    command.trim();

    // -------------------------------------------------
    // BIODEGRADABLE
    // -------------------------------------------------
    if (command == "BIO") {

      digitalWrite(GREEN_LED, HIGH);
      digitalWrite(RED_LED, LOW);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("RESULT:");

      lcd.setCursor(0, 1);
      lcd.print("BIODEGRADABLE");

      sortingServo.write(BIO_ANGLE);

      Serial.println("BIO_ACCEPTED");

      delay(2500);

      sortingServo.write(CENTER_ANGLE);
      digitalWrite(GREEN_LED, LOW);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("EcoVision Ready");
      lcd.setCursor(0, 1);
      lcd.print("Place Object");
    }

    // -------------------------------------------------
    // NON-BIODEGRADABLE
    // -------------------------------------------------
    else if (command == "NON_BIO") {

      digitalWrite(GREEN_LED, LOW);
      digitalWrite(RED_LED, HIGH);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("RESULT:");

      lcd.setCursor(0, 1);
      lcd.print("NON-BIODEGRADABLE");

      sortingServo.write(NON_BIO_ANGLE);

      Serial.println("NON_BIO_ACCEPTED");

      delay(2500);

      sortingServo.write(CENTER_ANGLE);
      digitalWrite(RED_LED, LOW);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("EcoVision Ready");
      lcd.setCursor(0, 1);
      lcd.print("Place Object");
    }
  }
}
