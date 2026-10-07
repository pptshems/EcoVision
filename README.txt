ECOVISION - LAPTOP + MOBILE SETUP
=================================

WHAT THIS VERSION DOES
----------------------
Laptop/PC:
- Uses the laptop camera.
- Can connect to Arduino over USB/COM port.
- HC-SR04 automatic scanning remains available.
- Arduino controls and system status are visible.

Mobile phone:
- Uses the phone's own rear camera.
- Does NOT connect to Arduino or use COM ports.
- Arduino controls and SYSTEM STATUS are hidden.
- Scan Now sends the camera image to the Flask server on the laptop.

NETWORK ARCHITECTURE
--------------------
Phone camera -> Wi-Fi -> Laptop Flask server -> TFLite model
Laptop -> USB -> Arduino

IMPORTANT
---------
The phone and laptop must be connected to the same Wi-Fi network.
Android/iPhone browsers require HTTPS for camera access when the site is opened from another device.

LAPTOP SETUP
------------
1. Extract this folder.
2. Connect Arduino to the laptop by USB.
3. Upload EcoVision_Final/EcoVision_Final.ino using Arduino IDE.
4. Check the Arduino COM port in Arduino IDE.
5. Open Command Prompt in this folder.
6. Install packages:
   pip install -r requirements.txt
7. Laptop-only test:
   python app.py
8. Open on laptop:
   http://127.0.0.1:5000

MOBILE SETUP
------------
1. Connect the phone and laptop to the SAME Wi-Fi.
2. On the laptop run:
   python app.py --https
3. Find the laptop Wi-Fi IPv4 address with:
   ipconfig
4. On the phone open Chrome and enter:
   https://LAPTOP-IP:5000
   Example: https://192.168.1.8:5000
5. If Chrome displays a local certificate warning, use Advanced/Continue if offered.
6. Allow camera permission.
7. The phone uses its rear camera automatically when supported.
8. Tap SCAN NOW to classify an item.

FIREWALL
--------
If the phone cannot open the page, allow Python/Flask through Windows Firewall on Private networks.
You can also allow inbound TCP port 5000 on the laptop's Private network.

ARDUINO ON LAPTOP
-----------------
The phone never needs the Arduino USB/COM connection.
Keep the Arduino connected to the laptop for HC-SR04, LCD, servo and LEDs.

NOTES
-----
- Mobile automatic HC-SR04 scanning is intentionally disabled because the phone has no Arduino connection.
- Mobile classification still uses the same model_unquant.tflite and labels.txt on the laptop.
- The server must remain running while the phone is being used.
