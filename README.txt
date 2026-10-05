PYTHON 3.14.3 COMPATIBILITY
This package is prepared for Python 3.14.3. It uses ai-edge-litert instead of the old tflite-runtime package, which does not provide the required Python 3.14 wheel.

INSTALL
python -m pip install -r requirements.txt

PUBLIC CLOUD INSTALL
Render uses requirements-cloud.txt.

ECOVISION - PC + MOBILE VERSION

This version supports two modes from the same website:

PC MODE
- Live camera
- AI waste classification
- Arduino COM-port connection
- HC-SR04 automatic scan
- Servo, LCD and LED control through Arduino

MOBILE MODE (ANDROID CHROME)
- Uses the phone camera
- Browser camera permission is requested
- AI waste classification still runs on the PC
- Arduino controls and COM-port controls are hidden
- No Arduino connection is required from the phone
- Press SCAN NOW to classify an item

PC SETUP
1. Install dependencies: pip install -r requirements.txt
2. Connect the Arduino by USB.
3. Upload EcoVision_Final/EcoVision_Final.ino to the Arduino.
4. Run START_ECOVISION_PC.bat or: python app.py
5. Open http://127.0.0.1:5000 on the PC.
6. Select the Arduino COM port and connect it.
7. Allow camera permission.

PHONE SETUP
1. Keep the PC running EcoVision.
2. Connect the phone and PC to the same Wi-Fi network.
3. Find the PC IPv4 address using ipconfig on Windows.
4. Run START_ECOVISION_PHONE.bat.
5. On Android Chrome open: https://PC-IP:5000
   Example: https://192.168.1.10:5000
6. Because this uses a temporary local HTTPS certificate, Chrome may show a certificate warning. Continue to the site if prompted.
7. Allow camera permission when Chrome asks.
8. The phone runs camera + AI only. The Arduino remains connected to the PC and is not required by the phone interface.

IMPORTANT
Android Chrome normally blocks getUserMedia camera access on a plain HTTP LAN address. That is why PHONE MODE uses HTTPS.

HC-SR04 / ARDUINO
The original PC Arduino workflow is preserved. The Arduino remains connected by USB to the PC.

The HC-SR04 detects object presence; the camera and AI model classify the object.


PUBLIC WEBSITE + WIRED ARDUINO
This package also supports a public website that can send AI classification results to the Arduino connected to your PC by USB.

ARCHITECTURE
Phone -> public EcoVision website -> cloud AI -> secure command queue -> arduino_bridge.py on your PC -> USB/COM -> Arduino.

DEPLOY PUBLIC WEBSITE (Render)
1. Create a GitHub repository and upload the contents of this EcoVision Auto folder.
2. In Render, create a Web Service from that repository.
3. Build command: pip install -r requirements-cloud.txt
4. Start command: gunicorn cloud_app:app
5. Add environment variable ECOVISION_BRIDGE_TOKEN with a long random secret.
6. Deploy. Render gives you a public https://...onrender.com link.

CONNECT YOUR WIRED ARDUINO PC
1. Put the Render URL in bridge_config.json under server_url.
2. Put exactly the same Render secret under bridge_token.
3. Set arduino_port to your Arduino COM port, for example COM7.
4. Keep the Arduino connected to the PC by USB.
5. Upload EcoVision_Final/EcoVision_Final.ino to the Arduino.
6. Run START_ARDUINO_BRIDGE.bat and leave it running.

PHONE
Open the Render https link on Android Chrome. Allow camera access. The phone does not need Arduino, USB, COM ports, or the PC camera. After classification, BIO/NON_BIO is queued and the PC bridge sends it to the wired Arduino.

PC LOCAL MODE
START_ECOVISION_PC.bat remains available for the original local PC camera + Arduino + HC-SR04 workflow.

IMPORTANT
The PC must stay powered, connected to the Internet, Arduino connected by USB, and START_ARDUINO_BRIDGE.bat running if you want phone classifications to control that Arduino. Never expose COM7 directly to the Internet. The bridge uses an authentication token.

UPDATED PC + ARDUINO CONNECTION
The recommended public setup now has only ONE program owning the Arduino COM port: arduino_bridge.py.
Do NOT run app.py at the same time as the bridge.

1. In Render, set ECOVISION_BRIDGE_TOKEN to exactly:
   ECOVISION-DEMO-BRIDGE-2026
   (Or replace this value in bridge_config.json with your own Render token.)
2. Keep server_url as https://ecovision-0z28.onrender.com, or replace it with your final domain.
3. Connect the Arduino USB cable to the PC.
4. Upload EcoVision_Final/EcoVision_Final.ino.
5. Double-click START_ECOVISION_PC.bat.
6. The Arduino Bridge automatically detects a suitable COM port and reconnects if the cable is temporarily disconnected.
7. The browser opens the public EcoVision website. The PC Arduino controls now show the bridge/Arduino status.
8. The website sends classification commands through Render to the bridge, and the bridge sends them to the Arduino.

IMPORTANT:
- Do not run START_ECOVISION_PC.bat and python app.py together.
- Do not open two Arduino Bridge windows.
- If the website says Arduino offline, keep the bridge window open and check that the Arduino appears in Windows Device Manager / Arduino IDE under Tools > Port.
- If you use your own Render bridge token, the value in bridge_config.json must exactly match Render's ECOVISION_BRIDGE_TOKEN.
