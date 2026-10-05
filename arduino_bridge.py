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
PORT = os.environ.get('ECOVISION_ARDUINO_PORT', _cfg.get('arduino_port', 'AUTO'))
BAUD = int(os.environ.get('ECOVISION_BAUD', _cfg.get('baud', 9600)))

session = requests.Session()

def find_port(preferred):
    ports = [p.device for p in list_ports.comports()]
    if preferred and preferred.upper() != 'AUTO' and preferred in ports:
        return preferred
    # Prefer common Arduino/USB serial descriptions.
    for p in list_ports.comports():
        text = f'{p.description} {p.manufacturer}'.lower()
        if any(x in text for x in ('arduino', 'ch340', 'wch', 'usb serial', 'usb-sio')):
            return p.device
    return ports[0] if ports else None

def open_board(current=None):
    target = find_port(current or PORT)
    if not target:
        return None, None
    try:
        board = serial.Serial(target, BAUD, timeout=0.2)
        time.sleep(2)
        board.reset_input_buffer()
        print(f'Connected to Arduino on {target}')
        return board, target
    except Exception as e:
        print(f'Could not open {target}: {e}')
        return None, None

def heartbeat(board, port):
    try:
        r = session.post(
            SERVER_URL + '/api/remote/heartbeat',
            headers={'X-EcoVision-Bridge-Token': TOKEN},
            json={'arduino_connected': bool(board and board.is_open), 'port': port or ''},
            timeout=8)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print('Heartbeat:', e)
        return {'enabled': True}

def main():
    if not SERVER_URL or not TOKEN:
        print('Set ECOVISION_SERVER_URL and ECOVISION_BRIDGE_TOKEN in bridge_config.json first.')
        return

    board = None
    current_port = None
    last_id = 0
    last_heartbeat = 0
    enabled = True
    print('EcoVision Arduino Bridge starting...')
    print('Server:', SERVER_URL)
    print('Arduino port:', PORT)

    while True:
        try:
            if board is None or not board.is_open:
                board, current_port = open_board(current_port)
                if board is None:
                    if time.time() - last_heartbeat > 3:
                        state = heartbeat(None, '')
                        enabled = state.get('enabled', True)
                        last_heartbeat = time.time()
                    time.sleep(2)
                    continue

            if time.time() - last_heartbeat > 3:
                state = heartbeat(board, current_port)
                enabled = state.get('enabled', True)
                last_heartbeat = time.time()

            if not enabled:
                try:
                    board.close()
                except Exception:
                    pass
                board = None
                current_port = None
                time.sleep(1)
                continue

            r = session.get(
                SERVER_URL + '/api/remote/next',
                headers={'X-EcoVision-Bridge-Token': TOKEN},
                timeout=8)
            r.raise_for_status()
            data = r.json()
            enabled = data.get('enabled', True)
            item = data.get('command')

            if item and item.get('id', 0) > last_id:
                command = item.get('command', '')
                board.write(command.encode('utf-8'))
                board.flush()
                print(f"Sent: {command.strip()} (job {item['id']})")
                session.post(
                    SERVER_URL + '/api/remote/ack',
                    headers={'X-EcoVision-Bridge-Token': TOKEN},
                    json={'id': item['id']}, timeout=8).raise_for_status()
                last_id = item['id']

        except (serial.SerialException, OSError) as e:
            print('Arduino:', e)
            try:
                if board:
                    board.close()
            except Exception:
                pass
            board = None
            current_port = None
            time.sleep(2)
        except Exception as e:
            print('Bridge:', e)
            time.sleep(2)

if __name__ == '__main__':
    main()
