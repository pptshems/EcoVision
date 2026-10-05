import os
import threading
import time
from flask import Flask, render_template, request, jsonify
import numpy as np
from PIL import Image

# Python 3.14 compatible LiteRT backend.
# ai-edge-litert provides the TFLite-compatible Interpreter API.
try:
    from ai_edge_litert import interpreter as tflite
except ImportError:
    try:
        import tflite_runtime.interpreter as tflite
    except ImportError:
        try:
            from tensorflow import lite as tflite
        except ImportError as exc:
            raise SystemExit(
                "LiteRT is not installed. Install with: pip install ai-edge-litert"
            ) from exc

app = Flask(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model_unquant.tflite')
LABELS_PATH = os.path.join(os.path.dirname(__file__), 'labels.txt')
MODEL_WIDTH = 224
MODEL_HEIGHT = 224
BRIDGE_TOKEN = os.environ.get('ECOVISION_BRIDGE_TOKEN', 'ECOVISION-DEMO-BRIDGE-2026')

interpreter = None
input_details = None
output_details = None
class_names = []
queue_lock = threading.Lock()
command_id = 0
pending_command = None
bridge_connected = False
bridge_port = ''
bridge_last_seen = 0.0
bridge_enabled = True
bridge_lock = threading.Lock()


def load_model():
    global interpreter, input_details, output_details, class_names
    interpreter = tflite.Interpreter(model_path=MODEL_PATH)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    with open(LABELS_PATH, 'r', encoding='utf-8') as f:
        class_names = [x.strip() for x in f if x.strip()]


def authorized():
    return request.headers.get('X-EcoVision-Bridge-Token', '') == BRIDGE_TOKEN and BRIDGE_TOKEN != 'CHANGE_THIS_TOKEN'


def predict_image(image):
    image = image.convert('RGB').resize((MODEL_WIDTH, MODEL_HEIGHT), Image.Resampling.LANCZOS)
    arr = np.asarray(image, dtype=np.float32).reshape(1, MODEL_HEIGHT, MODEL_WIDTH, 3)
    arr = (arr / 127.5) - 1.0
    if input_details[0]['dtype'] != np.float32:
        arr = arr.astype(input_details[0]['dtype'])
    interpreter.set_tensor(input_details[0]['index'], arr)
    interpreter.invoke()
    prediction = interpreter.get_tensor(output_details[0]['index'])
    index = int(np.argmax(prediction[0]))
    confidence = float(prediction[0][index])
    label = class_names[index] if index < len(class_names) else f'Class {index}'
    if 'BIODEGRADABLE' in label.upper() and 'NON' not in label.upper():
        result = 'BIODEGRADABLE'; command = 'BIO\n'; icon = '🌿'
    else:
        result = 'NON-BIODEGRADABLE'; command = 'NON_BIO\n'; icon = '🗑️'
    return {'result': result, 'original_label': label,
            'confidence': round(max(0, min(1, confidence)) * 100, 1),
            'icon': icon, 'arduino_command': command}


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/status')
def status():
    with bridge_lock:
        alive = bridge_connected and (time.time() - bridge_last_seen) < 12
        port = bridge_port
    return jsonify({
        'model_ready': interpreter is not None,
        'arduino_connected': alive,
        'serial_port': port,
        'ports': ([{'device': port, 'description': 'EcoVision Arduino Bridge'}] if port else []),
        'mobile_request': True,
        'public_mode': True,
        'bridge_connected': alive
    })


@app.route('/api/ports')
def ports():
    with bridge_lock:
        alive = bridge_connected and (time.time() - bridge_last_seen) < 12
        port = bridge_port
    return jsonify({'success': True, 'ports': ([{'device': port, 'description': 'EcoVision Arduino Bridge'}] if alive and port else [])})


@app.route('/api/arduino/connect', methods=['POST'])
def connect_arduino_remote():
    global bridge_enabled
    data = request.get_json(silent=True) or {}
    with bridge_lock:
        bridge_enabled = True
        alive = bridge_connected and (time.time() - bridge_last_seen) < 12
        port = bridge_port or data.get('port', '')
    return jsonify({
        'success': alive,
        'connected': alive,
        'port': port,
        'message': ('Arduino bridge is connected and owns the serial port.' if alive else 'Arduino bridge is offline. Start START_ARDUINO_BRIDGE.bat on the PC.')
    })


@app.route('/api/arduino/disconnect', methods=['POST'])
def disconnect_arduino_remote():
    global bridge_enabled
    with bridge_lock:
        bridge_enabled = False
    return jsonify({'success': True, 'connected': False, 'message': 'Arduino bridge disconnected by request.'})


@app.route('/api/predict', methods=['POST'])
def predict():
    if interpreter is None:
        return jsonify({'success': False, 'error': 'AI model is not loaded.'}), 500
    if 'image' not in request.files:
        return jsonify({'success': False, 'error': 'No image was received.'}), 400
    try:
        result = predict_image(Image.open(request.files['image'].stream))
        global command_id, pending_command
        with queue_lock:
            command_id += 1
            pending_command = {'id': command_id, 'command': result['arduino_command'],
                               'result': result['result'], 'created': time.time()}
        return jsonify({'success': True, **result, 'arduino_command_sent': False,
                        'arduino_message': 'Queued for the EcoVision PC Arduino bridge.'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/remote/heartbeat', methods=['POST'])
def remote_heartbeat():
    global bridge_connected, bridge_port, bridge_last_seen, bridge_enabled
    if not authorized():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    with bridge_lock:
        bridge_connected = bool(data.get('arduino_connected', False))
        bridge_port = str(data.get('port', '') or '')
        bridge_last_seen = time.time()
        enabled = bridge_enabled
    return jsonify({'success': True, 'enabled': enabled, 'port': bridge_port})


@app.route('/api/remote/next')
def remote_next():
    if not authorized():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    with queue_lock:
        item = pending_command
    with bridge_lock:
        enabled = bridge_enabled
    return jsonify({'success': True, 'command': item, 'enabled': enabled})


@app.route('/api/remote/ack', methods=['POST'])
def remote_ack():
    global pending_command
    if not authorized():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    ack_id = data.get('id')
    with queue_lock:
        if pending_command and pending_command.get('id') == ack_id:
            pending_command = None
    return jsonify({'success': True})


# Load the model when imported by Gunicorn as well as when run directly.
load_model()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '10000')))
