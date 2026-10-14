ECOVISION - PUBLIC WEBSITE + PERSONAL ARDUINO
===============================================

IMPORTANT ARCHITECTURE CHANGE
-----------------------------
This version is designed for a public Render/GitHub website.

Render runs the Flask AI prediction server only. It NEVER tries to open a
visitor's COM port. On a desktop/laptop, the visitor's Chrome/Edge browser
connects directly to that visitor's Arduino using the Web Serial API.

Architecture:

  Visitor browser -> HTTPS Render website -> AI prediction
         |
         +------ Web Serial (USB) ------> Visitor's Arduino

The Arduino is therefore the visitor's own Arduino, not the Arduino attached
to the computer where the website was developed.

1. ARDUINO SETUP
----------------
Upload:
  EcoVision_Final/EcoVision_Final.ino

to an Arduino UNO.

Connections used by the sketch:
  HC-SR04 TRIG  -> D2
  HC-SR04 ECHO  -> D3
  Green LED      -> D8
  Red LED        -> D7
  Servo          -> D9
  LCD SDA        -> A4
  LCD SCL        -> A5

The sketch uses 9600 baud.

2. PUBLIC WEBSITE DEPLOYMENT
-----------------------------
Deploy this folder to GitHub and connect the repository to Render as a
Python web service.

Start command:
  gunicorn app:app

If your Render service uses a different start command, use the normal Flask
/Gunicorn command configured for your service.

The Flask app reads PORT automatically from Render.

3. VISITOR LAPTOP/PC
---------------------
Use Google Chrome or Microsoft Edge on a desktop/laptop.

Open your public HTTPS EcoVision link.

1. Allow camera permission.
2. Connect the Arduino to that computer by USB.
3. Click "Connect Arduino" on EcoVision.
4. In the browser serial-device chooser, select the visitor's Arduino.
5. Wait for "Arduino Connected".
6. Place an object near the HC-SR04.
7. The Arduino sends OBJECT_DETECTED to the browser.
8. The browser captures the camera frame and sends it to Render for AI.
9. Render returns BIO / NON_BIO.
10. The browser sends that command directly to the visitor's Arduino.

No COM7, COM8, etc. is hard-coded. Each visitor chooses their own device.

4. MOBILE PHONE
---------------
On mobile, Arduino controls are hidden. The website uses the phone's own
camera. The mobile layout also hides SYSTEM STATUS.

Open the public HTTPS link in Android Chrome. Allow camera access and press
SCAN NOW.

The phone does not need an Arduino.

5. BROWSER SUPPORT
------------------
Web Serial is supported primarily by Chromium browsers such as:
  - Google Chrome desktop
  - Microsoft Edge desktop

For the Arduino part, use a laptop/desktop with Chrome or Edge. Safari and
iPhone browsers should be treated as camera-only for this project.

6. SECURITY / PRIVACY BEHAVIOUR
-------------------------------
A website cannot silently open arbitrary USB/serial devices. The visitor must
click "Connect Arduino" and explicitly select a device in the browser dialog.
This is a browser security requirement.

Render never receives the visitor's COM port and never controls the USB
connection. The browser performs the serial communication locally.

7. RUN LOCALLY (OPTIONAL)
--------------------------
Install requirements:
  pip install -r requirements.txt

Start:
  python app.py

Then open:
  http://127.0.0.1:5000

For a phone on the same network, use HTTPS because camera access from another
device normally requires a secure context.

8. IF "CONNECT ARDUINO" DOES NOT APPEAR
-----------------------------------------
Check that:
  - You are on a desktop/laptop.
  - You are using Chrome or Edge.
  - The page is HTTPS (Render provides HTTPS).
  - The Arduino USB cable supports data, not power only.
  - The Arduino is connected before clicking Connect Arduino.
  - The Arduino sketch has been uploaded successfully.

9. IMPORTANT DIFFERENCE FROM THE OLD VERSION
---------------------------------------------
The old Flask version attempted to use Python/pyserial and a fixed COM7 on
the server. That cannot work for a public Render website because COM7 belongs
to the visitor's PC.

This version removes that server-side serial dependency and uses Web Serial
in the visitor's browser instead.


LATEST AUTO-SCAN / STATUS BEHAVIOR
-----------------------------------
- The HC-SR04 sends OBJECT_DETECTED to the browser when an item enters the detection zone.
- The browser automatically captures the camera frame and sends it to /api/predict.
- After classification, Object Sensor shows "Object Classified" with a yellow dot instead of exposing "Result sent to Arduino".
- After 2.5 seconds it returns to "Waiting for object".
- If the object is removed, the Arduino sends OBJECT_REMOVED and the browser immediately returns to "Waiting for object".
- The automatic scan is locked until the current object is removed, preventing repeated scans of the same item.
- The explanatory serial sentence below System Status has been removed.


NEW IN THIS VERSION: "DEEP LAGOON" INTERFACE
---------------------------------------------
- One-screen layout. The page never scrolls on PC, tablet or phone.
- Large 16:9 camera on desktop (fills the phone screen on mobile).
- Colour follows the result: aqua = idle, amber = scanning,
  lime = biodegradable, coral = non-biodegradable.
- Live proximity gauge and distance chip fed by the HC-SR04 (trigger line at 20 cm).
- Confidence ring, eco tip for every result, and a result banner over the camera.
- Statistics (scanned / bio / non-bio) with a split bar, saved in the browser.
- History tab with photo thumbnails of recent scans.
- Arduino tab: live serial log plus "Test Bio" / "Test Non-bio" buttons
  to check the servo, LEDs and LCD without scanning anything.
- Header toggles: Auto-scan on/off, Sound on/off, Fullscreen. Space bar = scan.
- Flip button cycles through available cameras.
No change was needed in app.py or the Arduino sketch.


AUTO SCAN / MANUAL SCAN MODE (NEW)
-----------------------------------
A switch under the camera, "Auto | Manual", works on PC and on mobile. The choice is
remembered in the browser.

AUTO
  - Arduino connected (PC, Chrome/Edge): the HC-SR04 ultrasonic sensor starts the scan
    when an object comes within 20 cm. The camera is not used to trigger scans.
  - Arduino not connected (PC or mobile): the camera detects the item by itself.
      1. On start the camera learns what the empty view looks like (keep the frame
         clear for about a second; status shows "Learning the empty view").
      2. When an item enters the square frame and stops moving (about 0.7 s) a scan
         starts automatically.
      3. One scan per item. Remove the item and the camera re-arms for the next one.
      4. A hand that only passes through the frame does not trigger a scan.
  - Unplug or plug in the Arduino at any time: EcoVision switches between sensor
    and camera triggering by itself.

MANUAL
  - Nothing starts a scan except "Scan now" or the Space bar (both also work in Auto).
  - With an Arduino connected the sensor still shows the distance, but the LCD says
    "Press Scan now" instead of "Scanning...".

TIPS FOR CAMERA AUTO-SCAN
  - Keep the camera still (a stand or something to lean the phone on) and use a plain
    background. Good light helps.
  - If the light changes a lot, or the camera was moved or an item was in view while
    it was learning, press "Recalibrate" (shown when the camera is the trigger).
  - An item that looks almost the same colour as the background may not be noticed.
    Use Manual mode or a plainer background in that case.
  - Sensitivity can be tuned in the DET block of static/script.js (ENTER, PIXEL,
    STEADY_MS).

ARDUINO SKETCH CHANGE
  Re-upload EcoVision_Final/EcoVision_Final.ino. It now understands MODE_AUTO and
  MODE_MANUAL from the website so the LCD matches the selected mode. The old sketch
  still works with the new website; only the LCD wording in Manual mode differs.


UPDATE: SCROLLING PANELS, LCD FIT, MOBILE SOUND, CODE DOWNLOAD
--------------------------------------------------------------
- History, Arduino and Guide panels scroll, with a teal scrollbar that matches the theme.
  History now keeps the last 30 scans (it showed only 6 before).
- LCD (16x2): NON-BIODEGRADABLE is 17 characters, so it is shown over two rows:
      RESULT: NON-
      BIODEGRADABLE
  The sketch no longer freezes while showing a result (no delay()), so the sensor keeps reporting.
  Re-upload EcoVision_Final/EcoVision_Final.ino.
- Mobile: tap the book icon (top right) to open History and Guide.
- Mobile sound: beep, vibration (Android) and a spoken result ("Biodegradable" / "Non biodegradable").
  Phones keep audio locked until the first touch, so tap anywhere once after opening the page.
  On iPhone, turn the silent switch off. The screen is kept awake so camera auto-scan keeps running.
- Arduino tab: "Download Arduino code" button (served from /download/arduino).
  Upload limit for scans is 8 MB.
