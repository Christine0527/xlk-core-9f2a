"""非 root 的 Flask 呼叫這個來跟 root_bridge 通訊（跨平台 TCP 版本）"""
import json
import os
import socket
import sys


def _bridge_port_file() -> str:
    if sys.platform == 'win32':
        return os.path.join(os.environ.get('ALLUSERSPROFILE', 'C:\\ProgramData'), 'ios-location-master.port')
    return '/tmp/ios-location-master.port'


BRIDGE_PORT_FILE = _bridge_port_file()


def _get_port() -> int:
    try:
        with open(BRIDGE_PORT_FILE) as f:
            return int(f.read().strip())
    except Exception:
        raise RuntimeError('root_bridge 未啟動，請先點選「連接手機」')


def send_command(msg: dict, timeout: int = 30) -> dict:
    try:
        port = _get_port()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect(('127.0.0.1', port))
        sock.sendall(json.dumps(msg).encode())
        data = sock.recv(256)
        sock.close()
        return json.loads(data)
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f'Bridge error: {e}')


def set_location(lat: float, lng: float) -> dict:
    return send_command({'cmd': 'set', 'lat': lat, 'lng': lng})


def stop_location() -> dict:
    return send_command({'cmd': 'stop'})


def ping() -> dict:
    try:
        return send_command({'cmd': 'ping'}, timeout=3)
    except Exception:
        return {'ok': False}


def shutdown_bridge() -> dict:
    try:
        return send_command({'cmd': 'shutdown'}, timeout=5)
    except Exception:
        return {'ok': False}
