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
