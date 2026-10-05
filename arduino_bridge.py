import os
import time
import serial
from serial.tools import list_ports
import requests
import json
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name('bridge_config.json')

def load_config():
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    except Exception:
        return {}

_cfg = load_config()
SERVER_URL = os.environ.get('ECOVISION_SERVER_URL', _cfg.get('server_url', '')).rstrip('/')
TOKEN = os.environ.get('ECOVISION_BRIDGE_TOKEN', _cfg.get('bridge_token', ''))
PORT = os.environ.get('ECOVISION_ARDUINO_PORT', _cfg.get('arduino_port', 'COM7'))
BAUD = int(os.environ.get('ECOVISION_BAUD', _cfg.get('baud', 9600)))


def connect():
    try:
        board = serial.Serial(PORT, BAUD, timeout=0.2)
        time.sleep(2)
        board.reset_input_buffer()
        print(f'Connected to Arduino on {PORT}')
        return board
    except Exception as e:
        print(f'Could not open {PORT}: {e}')
        print('Available ports:', [p.device for p in list_ports.comports()])
        return None


def main():
    if not SERVER_URL or not TOKEN:
        print('Set ECOVISION_SERVER_URL and ECOVISION_BRIDGE_TOKEN first.')
        return
    board = connect()
    if board is None:
        return
    headers = {'X-EcoVision-Bridge-Token': TOKEN}
    last_id = 0
    print(f'Listening for remote EcoVision commands from {SERVER_URL}')
    while True:
        try:
            r = requests.get(SERVER_URL + '/api/remote/next', headers=headers, timeout=10)
            r.raise_for_status()
            item = r.json().get('command')
            if item and item.get('id', 0) > last_id:
                command = item.get('command', '')
                board.write(command.encode('utf-8'))
                board.flush()
                print(f"Sent: {command.strip()} (job {item['id']})")
                requests.post(SERVER_URL + '/api/remote/ack', headers=headers,
                              json={'id': item['id']}, timeout=10)
                last_id = item['id']
        except Exception as e:
            print('Bridge:', e)
        time.sleep(0.8)


if __name__ == '__main__':
    main()
