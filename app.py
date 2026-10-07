from flask import Flask, render_template, request, jsonify
import os

import numpy as np
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

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model_unquant.tflite")
LABELS_PATH = os.path.join(os.path.dirname(__file__), "labels.txt")
MODEL_WIDTH = 224
MODEL_HEIGHT = 224
SCAN_DELAY_SECONDS = 2.5

interpreter = None
input_details = None
output_details = None
class_names = []


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


# Load once when Flask/Gunicorn imports this module. This is required for
# production hosts such as Render, where app.py is imported by Gunicorn.
load_model()


def predict_image(image):
    image = image.convert("RGB")
    image = image.resize((MODEL_WIDTH, MODEL_HEIGHT), Image.Resampling.LANCZOS)

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

    class_name = class_names[index] if index < len(class_names) else f"Class {index}"

    if "BIODEGRADABLE" in class_name.upper() and "NON" not in class_name.upper():
        result_type = "BIODEGRADABLE"
        command = "BIO"
        icon = "🌿"
    else:
        result_type = "NON-BIODEGRADABLE"
        command = "NON_BIO"
        icon = "🗑️"

    return {
        "result": result_type,
        "original_label": class_name,
        "confidence": round(max(0.0, min(1.0, confidence)) * 100, 1),
        "icon": icon,
        "arduino_command": command,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def status():
    return jsonify({
        "model_ready": interpreter is not None,
        "labels": class_names,
        "arduino_mode": "browser-web-serial",
        "arduino_supported": True,
    })


@app.route("/api/predict", methods=["POST"])
def api_predict():
    if interpreter is None:
        return jsonify({"success": False, "error": "AI model is not loaded."}), 500

    if "image" not in request.files:
        return jsonify({"success": False, "error": "No image was received."}), 400

    try:
        image = Image.open(request.files["image"].stream)
        result = predict_image(image)

        # IMPORTANT:
        # The Arduino command is returned to the browser. The Flask/Render
        # server never opens a serial port. The visitor's browser sends this
        # command to the Arduino through the Web Serial API.
        return jsonify({
            "success": True,
            "result": result["result"],
            "original_label": result["original_label"],
            "confidence": result["confidence"],
            "icon": result["icon"],
            "arduino_command": result["arduino_command"],
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
