import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from flask import Flask, request, jsonify
from flask_sock import Sock
from device_manager import DeviceManager
from location_client import (
    set_location as _bridge_set,
    stop_location as _bridge_stop,
    ping as _bridge_ping,
    shutdown_bridge as _bridge_shutdown,
    BRIDGE_PORT_FILE,
)

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
sock = Sock(app)

device_manager = DeviceManager()


def _find_python() -> str:
    if sys.platform == 'win32':
        for candidate in ['python', 'py', 'python3']:
            found = shutil.which(candidate)
            if found:
                return found
        return 'python'
    return shutil.which('python3') or '/opt/anaconda3/bin/python3'


PYTHON3 = _find_python()

# ─── root_bridge 管理（只需要輸入一次密碼）────────────
_bridge_ready = False
_bridge_lock = __import__('threading').Lock()
_bridge_not_ok_since = None


def _kill_bridge():
    """強制殺掉舊的 root_bridge 程序"""
    try:
        if sys.platform == 'win32':
            # Windows：嘗試透過 PowerShell 以管理員身份殺掉
            subprocess.run(
                ['powershell', '-NoProfile', '-Command',
                 'Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like "*root_bridge*"} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'],
                capture_output=True, timeout=10
            )
        else:
            subprocess.run(
                ['osascript', '-e', 'do shell script "pkill -f root_bridge || true" with administrator privileges'],
                capture_output=True, timeout=10
            )
    except Exception as e:
        logger.warning(f'kill bridge failed: {e}')
    finally:
        if os.path.exists(BRIDGE_PORT_FILE):
            try:
                os.remove(BRIDGE_PORT_FILE)
            except Exception:
                pass


def _ensure_bridge():
    """確保 root_bridge 正在執行。第一次呼叫會要求管理員授權，之後不再需要。"""
    global _bridge_ready, _bridge_not_ok_since

    if _bridge_ready:
        status = _bridge_ping()
        if status.get('ok'):
            _bridge_not_ok_since = None
            return
        if status.get('pong'):
            if _bridge_not_ok_since is None:
                _bridge_not_ok_since = time.time()
            elif time.time() - _bridge_not_ok_since < 60:
                return
            else:
                logger.warning('Bridge stuck for 60s, force restarting...')
                _kill_bridge()
                _bridge_ready = False
                _bridge_not_ok_since = None

    with _bridge_lock:
        status = _bridge_ping()
        if status.get('ok'):
            _bridge_ready = True
            return
        if status.get('pong'):
            logger.warning('Found stuck bridge (pong=True, ok=False), shutting it down...')
            _bridge_shutdown()
            time.sleep(2)

        logger.info('Starting root_bridge (one-time admin authorization)...')
        if getattr(sys, 'frozen', False):
            # PyInstaller 打包模式：root_bridge binary 在 server 同一層目錄
            bin_dir = os.path.dirname(sys.executable)
            bridge_name = 'root_bridge.exe' if sys.platform == 'win32' else 'root_bridge'
            script_path = os.path.join(bin_dir, bridge_name)
        else:
            # 開發模式：使用 .py 腳本
            script_dir = os.path.dirname(os.path.abspath(__file__))
            script_path = os.path.join(script_dir, 'root_bridge.py')

        if sys.platform == 'win32':
            _start_bridge_windows(script_path)
        else:
            _start_bridge_macos(script_path)

        # 等待 bridge 就緒（最多 40 秒）
        for _ in range(80):
            time.sleep(0.5)
            if _bridge_ping().get('ok'):
                _bridge_ready = True
                logger.info('root_bridge ready!')
                return

        raise RuntimeError('root_bridge 啟動逾時，請查看日誌')


def _start_bridge_macos(script_path: str):
    """macOS：透過 osascript 以 root 身分啟動"""
    if getattr(sys, 'frozen', False):
        # 打包模式：直接執行 binary
        tmp_bin = '/tmp/root_bridge_bin'
        try:
            os.remove(tmp_bin)
        except FileNotFoundError:
            pass
        shutil.copyfile(script_path, tmp_bin)
        os.chmod(tmp_bin, 0o755)
        cmd = f'{tmp_bin} > /tmp/root_bridge.log 2>&1 &'
    else:
        # 開發模式：用 Python 跑腳本
        shutil.copyfile(script_path, '/tmp/root_bridge.py')
        cmd = f'{PYTHON3} /tmp/root_bridge.py > /tmp/root_bridge.log 2>&1 &'
    osascript_cmd = f'do shell script "{cmd}" with administrator privileges'
    result = subprocess.run(
        ['osascript', '-e', osascript_cmd],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise RuntimeError('無法啟動 root bridge：' + (result.stderr.strip() or '用戶取消授權'))


def _start_bridge_windows(script_path: str):
    """Windows：透過 PowerShell Start-Process -Verb RunAs 以管理員身分啟動"""
    if getattr(sys, 'frozen', False):
        # 打包模式：直接執行 .exe binary
        ps_cmd = (
            f"Start-Process -FilePath '{script_path}' "
            f"-Verb RunAs -WindowStyle Hidden"
        )
    else:
        # 開發模式：用 Python 跑腳本
        ps_cmd = (
            f"Start-Process -FilePath '{PYTHON3}' "
            f"-ArgumentList '{script_path}' "
            f"-Verb RunAs -WindowStyle Hidden"
        )
    result = subprocess.run(
        ['powershell', '-NoProfile', '-Command', ps_cmd],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise RuntimeError('無法啟動 root bridge：' + (result.stderr.strip() or '用戶取消 UAC 授權'))


# ─── RPC 分發 ────────────────────────────────────────
RPC = {}


def rpc(name):
    def dec(fn):
        RPC[name] = fn
        return fn
    return dec


@app.route('/health')
def health():
    return 'ok'


@app.route('/rpc', methods=['POST'])
def handle_rpc():
    body = request.json
    method = body.get('method', '')
    params = body.get('params', {})
    handler = RPC.get(method)
    if not handler:
        return jsonify({'error': f'Unknown method: {method}'}), 404
    try:
        result = handler(**params)
        return jsonify({'data': result})
    except Exception as e:
        logger.exception(f'RPC error in {method}')
        return jsonify({'error': str(e)}), 500


# ─── Device RPC ──────────────────────────────────────
@rpc('device.list')
def device_list():
    return device_manager.list_devices()


@rpc('device.status')
def device_status(udid: str):
    return device_manager.get_status(udid)


@rpc('device.mount')
def device_mount(udid: str):
    result = device_manager.ensure_mounted(udid)
    import threading
    threading.Thread(target=_warmup_bridge, daemon=True).start()
    return result


def _warmup_bridge():
    try:
        _ensure_bridge()
        logger.info('root_bridge pre-warmed successfully')
    except Exception as e:
        logger.warning(f'root_bridge pre-warm failed (will retry on first location set): {e}')


# ─── Location RPC（全部走 root_bridge，只需要一次密碼）──
@rpc('location.set')
def location_set(udid: str, lat: float, lng: float, jitter: bool = False):
    import random
    _ensure_bridge()
    if jitter:
        lat += random.uniform(-0.000009, 0.000009)
        lng += random.uniform(-0.000009, 0.000009)
    result = _bridge_set(lat, lng)
    if not result.get('ok'):
        for _ in range(6):
            time.sleep(3)
            result = _bridge_set(lat, lng)
            if result.get('ok'):
                break
    if not result.get('ok'):
        raise RuntimeError(result.get('error', '定位失敗，請確認裝置連線狀態'))
    return {'ok': True}


@rpc('location.stop')
def location_stop(udid: str):
    _ensure_bridge()
    result = _bridge_stop()
    return {'ok': True, 'output': str(result)}


@rpc('location.route')
def location_route(udid: str, waypoints: list, speed: float = 1.4):
    import threading
    import math
    _ensure_bridge()

    def walk():
        for i in range(len(waypoints) - 1):
            p1, p2 = waypoints[i], waypoints[i + 1]
            R = 6371000
            lat1, lon1 = math.radians(p1['lat']), math.radians(p1['lng'])
            lat2, lon2 = math.radians(p2['lat']), math.radians(p2['lng'])
            a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
            dist = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            steps = max(int(dist / speed * 3), 1)
            for s in range(steps):
                t = s / steps
                try:
                    _bridge_set(
                        p1['lat'] + (p2['lat'] - p1['lat']) * t,
                        p1['lng'] + (p2['lng'] - p1['lng']) * t
                    )
                except Exception:
                    pass
                time.sleep(3)

    threading.Thread(target=walk, daemon=True).start()
    return {'ok': True}


# ─── WebSocket：搖桿高頻更新 ──────────────────────────
@sock.route('/joystick/<udid>')
def joystick(ws, udid: str):
    try:
        _ensure_bridge()
    except Exception as e:
        ws.send(json.dumps({'error': f'Bridge 未就緒：{e}'}))
        return

    last = 0
    while True:
        data = ws.receive()
        if data is None:
            break
        now = time.time()
        if now - last < 3:
            ws.send('{"ack":true,"throttled":true}')
            continue
        try:
            payload = json.loads(data)
            _bridge_set(payload['lat'], payload['lng'])
            last = now
            ws.send('{"ack":true}')
        except Exception as e:
            ws.send(json.dumps({'error': str(e)}))


# ─── 啟動 ─────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=7654)
    args = parser.parse_args()
    logger.info(f'Starting on port {args.port}')
    app.run(host='127.0.0.1', port=args.port, debug=False, threaded=True)
