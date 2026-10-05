from flask import Flask, render_template, request, jsonify
import os
import time
import threading

import numpy as np
import serial
from serial.tools import list_ports
from PIL import Image

try:
    import tflite_runtime.interpreter as tflite
except ImportError:
    try:
        from tensorflow import lite as tflite
    except ImportError:
        raise SystemExit(
            "TFLite is not installed. Install tflite-runtime or TensorFlow."
        )

app = Flask(__name__)


def is_mobile_request(req):
    """Detect mobile browsers so API prediction can skip Arduino commands."""
    user_agent = (req.headers.get("User-Agent") or "").lower()
    return any(token in user_agent for token in (
        "android", "iphone", "ipad", "ipod", "mobile", "windows phone"
    ))

# ------------------------------------------------------------
# SETTINGS
# ------------------------------------------------------------
SERIAL_PORT = "COM7"
BAUD_RATE = 9600

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model_unquant.tflite")
LABELS_PATH = os.path.join(os.path.dirname(__file__), "labels.txt")

MODEL_WIDTH = 224
MODEL_HEIGHT = 224

# The website animation stays visible for this long before prediction.
SCAN_DELAY_SECONDS = 2.5

# ------------------------------------------------------------
# GLOBAL STATE
# ------------------------------------------------------------
arduino = None
arduino_lock = threading.Lock()
arduino_connected = False
serial_listener_thread = None
serial_listener_running = False

# HC-SR04 / Arduino sensor state
sensor_lock = threading.Lock()
sensor_object_present = False
sensor_distance = None
sensor_event_id = 0
last_sensor_event = "waiting"

interpreter = None
input_details = None
output_details = None
class_names = []


# ------------------------------------------------------------
# LOAD MODEL
# ------------------------------------------------------------
def load_model():
    global interpreter, input_details, output_details, class_names

    interpreter = tflite.Interpreter(model_path=MODEL_PATH)
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    with open(LABELS_PATH, "r", encoding="utf-8") as f:
        class_names = [line.strip() for line in f.readlines() if line.strip()]

    print("AI model loaded.")
    print("Labels:", class_names)
    print("Input shape:", input_details[0]["shape"])
    print("Input dtype:", input_details[0]["dtype"])


# ------------------------------------------------------------
# SENSOR STATE HELPERS
# ------------------------------------------------------------
def set_sensor_state(present=None, distance=None, event=None):
    global sensor_object_present, sensor_distance, sensor_event_id, last_sensor_event

    with sensor_lock:
        if present is not None:
            sensor_object_present = present
        if distance is not None:
            sensor_distance = distance
        if event:
            sensor_event_id += 1
            last_sensor_event = event


def get_sensor_state():
    with sensor_lock:
        return {
            "object_present": sensor_object_present,
            "distance_cm": sensor_distance,
            "event_id": sensor_event_id,
            "event": last_sensor_event
        }


# ------------------------------------------------------------
# ARDUINO SERIAL LISTENER
# ------------------------------------------------------------
def serial_listener():
    """Listen for HC-SR04 messages from Arduino without blocking Flask."""
    global serial_listener_running

    serial_listener_running = True
    print("Arduino sensor listener started.")

    while serial_listener_running:
        try:
            with arduino_lock:
                current = arduino
                connected = arduino_connected

            if not connected or current is None or not current.is_open:
                time.sleep(0.2)
                continue

            if current.in_waiting > 0:
                raw = current.readline().decode("utf-8", errors="ignore").strip()

                if not raw:
                    continue

                print("Arduino:", raw)

                # New HC-SR04 sketch messages
                if raw == "OBJECT_DETECTED" or raw == "TRIGGER_SCAN":
                    set_sensor_state(present=True, event="detected")

                elif raw == "OBJECT_REMOVED":
                    set_sensor_state(present=False, event="removed")

                elif raw.startswith("DISTANCE:"):
                    try:
                        distance = float(raw.split(":", 1)[1])
                        with sensor_lock:
                            sensor_distance = distance
                    except ValueError:
                        pass

            else:
                time.sleep(0.03)

        except Exception as e:
            print("Serial listener error:", e)
            time.sleep(0.2)


# ------------------------------------------------------------
# ARDUINO CONNECTION
# ------------------------------------------------------------
def connect_arduino(port=None):
    global arduino, arduino_connected, SERIAL_PORT, serial_listener_thread

    selected_port = port or SERIAL_PORT

    with arduino_lock:
        try:
            if arduino is not None and arduino.is_open:
                arduino.close()
        except Exception:
            pass

        arduino = None
        arduino_connected = False

        try:
            arduino = serial.Serial(
                port=selected_port,
                baudrate=BAUD_RATE,
                timeout=0.2
            )
            SERIAL_PORT = selected_port
            time.sleep(2)
            arduino.reset_input_buffer()
            arduino_connected = True
            print(f"Arduino connected on {SERIAL_PORT}")

            if serial_listener_thread is None or not serial_listener_thread.is_alive():
                serial_listener_thread = threading.Thread(
                    target=serial_listener,
                    daemon=True
                )
                serial_listener_thread.start()

            return True, f"Arduino connected on {SERIAL_PORT}"

        except Exception as e:
            arduino = None
            arduino_connected = False
            print(f"Arduino connection failed: {e}")
            return False, str(e)


def disconnect_arduino():
    global arduino, arduino_connected

    with arduino_lock:
        arduino_connected = False
        try:
            if arduino is not None and arduino.is_open:
                arduino.close()
        except Exception:
            pass
        arduino = None

    set_sensor_state(present=False, event="waiting")
    print("Arduino disconnected.")


def send_to_arduino(command):
    global arduino_connected

    with arduino_lock:
        if not arduino_connected or arduino is None or not arduino.is_open:
            return False, "Arduino is not connected."

        try:
            arduino.write(command)
            arduino.flush()
            return True, "Command sent."
        except Exception as e:
            arduino_connected = False
            return False, str(e)


# ------------------------------------------------------------
# AI PREDICTION
# ------------------------------------------------------------
def predict_image(image):
    image = image.convert("RGB")
    image = image.resize(
        (MODEL_WIDTH, MODEL_HEIGHT),
        Image.Resampling.LANCZOS
    )

    image_array = np.asarray(image, dtype=np.float32)
    image_array = image_array.reshape(1, MODEL_HEIGHT, MODEL_WIDTH, 3)
    normalized = (image_array / 127.5) - 1.0

    if input_details[0]["dtype"] != np.float32:
        normalized = normalized.astype(input_details[0]["dtype"])

    interpreter.set_tensor(input_details[0]["index"], normalized)
    interpreter.invoke()

    prediction = interpreter.get_tensor(output_details[0]["index"])
    index = int(np.argmax(prediction[0]))
    confidence = float(prediction[0][index])

    if index < len(class_names):
        class_name = class_names[index]
    else:
        class_name = f"Class {index}"

    if "BIODEGRADABLE" in class_name.upper() and "NON" not in class_name.upper():
        result_type = "BIODEGRADABLE"
        command = b"BIO\n"
        icon = "🌿"
    else:
        result_type = "NON-BIODEGRADABLE"
        command = b"NON_BIO\n"
        icon = "🗑️"

    return {
        "result": result_type,
        "original_label": class_name,
        "confidence": round(max(0.0, min(1.0, confidence)) * 100, 1),
        "icon": icon,
        "arduino_command": command
    }


# ------------------------------------------------------------
# SERIAL PORT DISCOVERY
# ------------------------------------------------------------
def get_serial_ports():
    ports = []
    for port in list_ports.comports():
        ports.append({
            "device": port.device,
            "description": port.description or "Serial device",
            "manufacturer": port.manufacturer or ""
        })
    return ports


# ------------------------------------------------------------
# ROUTES
# ------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def status():
    sensor = get_sensor_state()
    return jsonify({
        "model_ready": interpreter is not None,
        "arduino_connected": arduino_connected,
        "serial_port": SERIAL_PORT,
        "baud_rate": BAUD_RATE,
        "ports": get_serial_ports(),
        "labels": class_names,
        "sensor": sensor,
        "mobile_request": is_mobile_request(request)
    })


@app.route("/api/sensor/status", methods=["GET"])
def sensor_status():
    return jsonify(get_sensor_state())


@app.route("/api/ports", methods=["GET"])
def api_ports():
    return jsonify({"success": True, "ports": get_serial_ports()})


@app.route("/api/arduino/connect", methods=["POST"])
def api_connect_arduino():
    data = request.get_json(silent=True) or {}
    selected_port = data.get("port") or SERIAL_PORT
    success, message = connect_arduino(selected_port)

    return jsonify({
        "success": success,
        "connected": arduino_connected,
        "port": SERIAL_PORT,
        "message": message
    })


@app.route("/api/arduino/disconnect", methods=["POST"])
def api_disconnect_arduino():
    disconnect_arduino()
    return jsonify({
        "success": True,
        "connected": False,
        "message": "Arduino disconnected."
    })


@app.route("/api/predict", methods=["POST"])
def api_predict():
    if interpreter is None:
        return jsonify({"success": False, "error": "AI model is not loaded."}), 500

    if "image" not in request.files:
        return jsonify({"success": False, "error": "No image was received."}), 400

    try:
        image = Image.open(request.files["image"].stream)
    except Exception as e:
        return jsonify({"success": False, "error": f"Could not read image: {e}"}), 400

    try:
        result = predict_image(image)

        # Mobile browsers use camera + AI only. Keep Arduino fully optional.
        if is_mobile_request(request):
            sent = False
            arduino_message = "Mobile mode: Arduino not required."
        else:
            sent, arduino_message = send_to_arduino(result["arduino_command"])

        return jsonify({
            "success": True,
            "result": result["result"],
            "original_label": result["original_label"],
            "confidence": result["confidence"],
            "icon": result["icon"],
            "arduino_connected": arduino_connected,
            "arduino_command_sent": sent,
            "arduino_message": arduino_message
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ------------------------------------------------------------
# STARTUP
# ------------------------------------------------------------
if __name__ == "__main__":
    load_model()
    connect_arduino()

    # Mobile browsers require a secure context for camera access when
    # the site is opened through the PC's LAN IP. Set ECOVISION_HTTPS=1
    # to run the same app over HTTPS when using an Android phone.
    use_https = os.environ.get("ECOVISION_HTTPS", "0") == "1"

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        ssl_context="adhoc" if use_https else None
    )
