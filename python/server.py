import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time

# ─── PyInstaller 打包模式下補齊缺失的 package metadata ──
# pymobiledevice3 內部用 importlib.metadata 查多個套件版本，
# PyInstaller onefile 無法完整打包 dist-info，這裡全面 patch 避免崩潰。
if getattr(sys, 'frozen', False):
    import importlib.metadata as _im
    from email.message import Message as _Message

    def _fake_dist(package_name):
        msg = _Message()
        msg['Metadata-Version'] = '2.1'
        msg['Name'] = package_name
        msg['Version'] = '0.0.0'
        return msg

    _orig_metadata = _im.metadata
    def _safe_metadata(package_name):
        try:
            return _orig_metadata(package_name)
        except _im.PackageNotFoundError:
            return _fake_dist(package_name)
    _im.metadata = _safe_metadata

    _orig_version = _im.version
    def _safe_version(package_name):
        try:
            return _orig_version(package_name)
        except _im.PackageNotFoundError:
            return '0.0.0'
    _im.version = _safe_version

    _orig_requires = _im.requires
    def _safe_requires(package_name):
        try:
            return _orig_requires(package_name)
        except _im.PackageNotFoundError:
            return []
    _im.requires = _safe_requires
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
            subprocess.run(
                ['powershell', '-NoProfile', '-Command',
                 'Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like "*root_bridge*"} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'],
                capture_output=True, timeout=10
            )
        else:
            subprocess.run(
                ['sudo', '-n', '/usr/bin/pkill', '-f', 'root_bridge'],
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

        # 等待 bridge TCP server 啟動（pong=True 即代表 bridge 已起來）
        # 設備連接在背景進行，不在此等待
        for _ in range(80):
            time.sleep(0.5)
            status = _bridge_ping()
            if status.get('pong'):
                _bridge_ready = True
                logger.info('root_bridge TCP server ready!')
                return

        raise RuntimeError('root_bridge 啟動逾時，請查看日誌')


def _start_bridge_macos(script_path: str):
    """macOS：以 root 身分啟動 root_bridge（sudoers 可用則無密碼，否則用 osascript）"""
    if getattr(sys, 'frozen', False):
        tmp_bin = '/tmp/root_bridge_bin'
        try:
            os.remove(tmp_bin)
        except FileNotFoundError:
            pass
        shutil.copyfile(script_path, tmp_bin)
        os.chmod(tmp_bin, 0o755)
        sudo_cmd = f'sudo -n {tmp_bin} > /tmp/root_bridge.log 2>&1 &'
        raw_cmd  = f'{tmp_bin} > /tmp/root_bridge.log 2>&1 &'
    else:
        shutil.copyfile(script_path, '/tmp/root_bridge.py')
        sudo_cmd = f'sudo -n {PYTHON3} /tmp/root_bridge.py > /tmp/root_bridge.log 2>&1 &'
        raw_cmd  = f'{PYTHON3} /tmp/root_bridge.py > /tmp/root_bridge.log 2>&1 &'

    # 探測 sudo 是否可無密碼執行
    probe = subprocess.run(['sudo', '-n', '/usr/bin/true'],
                           capture_output=True, timeout=5)
    if probe.returncode == 0:
        subprocess.run(['bash', '-c', sudo_cmd], capture_output=True, text=True, timeout=30)
    else:
        # 退回 osascript（彈一次密碼視窗）
        osa_script = f'do shell script "{raw_cmd}" with administrator privileges'
        result = subprocess.run(['osascript', '-e', osa_script],
                                capture_output=True, text=True, timeout=60)
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


# ─── Location 序號（確保新的 call 能搶佔舊的 retry loop）──
_location_seq = 0
_location_seq_lock = __import__('threading').Lock()

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
    global _location_seq
    import random
    with _location_seq_lock:
        _location_seq += 1
        my_seq = _location_seq

    _ensure_bridge()
    if jitter:
        lat += random.uniform(-0.000009, 0.000009)
        lng += random.uniform(-0.000009, 0.000009)
    result = _bridge_set(lat, lng)
    if not result.get('ok'):
        for _ in range(20):  # 20 × 1s = 最多 20s，但就緒後立即成功
            time.sleep(1)
            # 有更新的 location call 進來了，放棄這個過時的 retry
            if _location_seq != my_seq:
                return {'ok': True}
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
