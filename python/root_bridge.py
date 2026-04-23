#!/usr/bin/env python3
"""
以管理員身份執行的橋接程序（跨平台 TCP 版本）
啟動後將監聽 port 寫入 port 檔案，接收定位指令並執行
"""
import asyncio
import json
import os
import socket
import sys
import logging

# ─── 日誌（Windows 也寫入檔案方便除錯）────────────────────
if sys.platform == 'win32':
    import tempfile
    _log_file = os.path.join(tempfile.gettempdir(), 'root_bridge.log')
    logging.basicConfig(
        level=logging.INFO,
        format='[root_bridge] %(message)s',
        handlers=[
            logging.FileHandler(_log_file, encoding='utf-8', mode='w'),
            logging.StreamHandler(),
        ],
        force=True,
    )
else:
    logging.basicConfig(level=logging.INFO, format='[root_bridge] %(message)s')
logger = logging.getLogger(__name__)


def _bridge_port_file() -> str:
    if sys.platform == 'win32':
        return os.path.join(os.environ.get('ALLUSERSPROFILE', 'C:\\ProgramData'), 'ios-location-master.port')
    return '/tmp/ios-location-master.port'


PORT_FILE = _bridge_port_file()

# iOS 17+ DVT 模式
_sim = None
_dvt_provider = None
_tunnel_cm = None

# iOS < 17 lockdown 模式（每次 call 重建連線）
_use_lockdown = False

_connecting = False


async def _cleanup():
    global _sim, _dvt_provider, _tunnel_cm, _use_lockdown
    for obj in [_sim, _dvt_provider, _tunnel_cm]:
        if obj is not None:
            try:
                await obj.__aexit__(None, None, None)
            except Exception:
                pass
    _sim = None
    _dvt_provider = None
    _tunnel_cm = None
    _use_lockdown = False


# ─── iOS < 17：SimulateLocationService（sync，每次重建連線）──
def _lockdown_set_sync(lat: float, lng: float):
    from pymobiledevice3.usbmux import list_devices
    from pymobiledevice3.lockdown import LockdownClient
    from pymobiledevice3.services.simulate_location import SimulateLocationService
    devices = list_devices()
    if not devices:
        raise RuntimeError('No USB devices found')
    lockdown = LockdownClient(serial=devices[0].serial)
    with SimulateLocationService(lockdown) as sim:
        sim.set(lat, lng)


def _lockdown_clear_sync():
    from pymobiledevice3.usbmux import list_devices
    from pymobiledevice3.lockdown import LockdownClient
    from pymobiledevice3.services.simulate_location import SimulateLocationService
    devices = list_devices()
    if not devices:
        raise RuntimeError('No USB devices found')
    lockdown = LockdownClient(serial=devices[0].serial)
    with SimulateLocationService(lockdown) as sim:
        sim.clear()


def _lockdown_test_sync():
    """測試 SimulateLocationService 是否可用（不改變位置）"""
    from pymobiledevice3.usbmux import list_devices
    from pymobiledevice3.lockdown import LockdownClient
    from pymobiledevice3.services.simulate_location import SimulateLocationService
    devices = list_devices()
    if not devices:
        raise RuntimeError('No USB devices found')
    lockdown = LockdownClient(serial=devices[0].serial)
    with SimulateLocationService(lockdown) as sim:
        sim.clear()  # clear 是 no-op，用來測試連線
    logger.info('SimulateLocationService test passed (iOS < 17 mode)')


# ─── iOS 17+：DVT tunnel 模式 ─────────────────────────────
async def _connect_dvt():
    global _sim, _dvt_provider, _tunnel_cm
    from pymobiledevice3.remote.tunnel_service import (
        get_remote_pairing_tunnel_services, start_tunnel, TunnelProtocol
    )
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
    from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
    from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

    logger.info('Discovering device via tunnel...')
    services = await get_remote_pairing_tunnel_services(bonjour_timeout=15)
    if not services:
        logger.info('remote_pairing not found, trying core_device...')
        from pymobiledevice3.remote.tunnel_service import get_core_device_tunnel_services
        services = await get_core_device_tunnel_services(bonjour_timeout=15)
    if not services:
        raise RuntimeError('找不到裝置 — 請確認已點選「連接手機」並成功掛載')

    svc = services[0]
    logger.info(f'Found: {svc}')

    last_err = None
    for protocol in [TunnelProtocol.TCP, TunnelProtocol.QUIC]:
        try:
            logger.info(f'Trying tunnel protocol: {protocol}')
            _tunnel_cm = start_tunnel(svc, protocol=protocol)
            tunnel_result = await _tunnel_cm.__aenter__()
            break
        except Exception as e:
            logger.warning(f'{protocol} failed: {e}')
            last_err = e
            _tunnel_cm = None
    else:
        raise RuntimeError(f'所有 tunnel 協議均失敗：{last_err}')

    rsd = RemoteServiceDiscoveryService((tunnel_result.address, tunnel_result.port))
    await rsd.connect()
    logger.info(f'RSD: {rsd.udid}')

    _dvt_provider = DvtProvider(lockdown=rsd)
    dvt = await _dvt_provider.__aenter__()

    sim_cm = LocationSimulation(dvt)
    _sim = await sim_cm.__aenter__()
    logger.info('Ready (DVT mode, iOS 17+)!')


async def connect():
    global _use_lockdown
    await _cleanup()

    # 先試 SimulateLocationService（iOS < 17，不需 tunnel，更穩定）
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _lockdown_test_sync)
        _use_lockdown = True
        logger.info('Using SimulateLocationService (iOS < 17)')
        return
    except Exception as e:
        logger.info(f'SimulateLocationService unavailable ({e}), trying DVT tunnel...')
        _use_lockdown = False

    # Fallback：DVT tunnel（iOS 17+）
    await _connect_dvt()


async def _connect_in_background():
    global _connecting
    _connecting = True
    attempt = 0
    while True:
        attempt += 1
        try:
            await connect()
            logger.info('Device connected successfully!')
            _connecting = False
            return
        except Exception as e:
            logger.error(f'Connect attempt {attempt} failed: {e}')
            wait = min(attempt * 5, 60)
            logger.info(f'Retrying in {wait}s...')
            await asyncio.sleep(wait)


async def _reconnect_with_retry():
    global _sim, _use_lockdown, _connecting
    if _connecting:
        return
    _connecting = True
    attempt = 0
    while True:
        attempt += 1
        wait = min(attempt * 3, 30)
        logger.info(f'Reconnecting (attempt {attempt}), waiting {wait}s...')
        await asyncio.sleep(wait)
        try:
            await connect()
            logger.info('Reconnected successfully!')
            _connecting = False
            return True
        except Exception as e:
            logger.error(f'Attempt {attempt} failed: {e}')
            _sim = None
            _use_lockdown = False


async def handle_client(reader, writer):
    global _sim, _use_lockdown
    try:
        data = await reader.read(256)
        if not data:
            return
        msg = json.loads(data.decode())
        cmd = msg.get('cmd')

        if cmd == 'ping':
            connected = (_sim is not None) or _use_lockdown
            writer.write(json.dumps({'ok': connected, 'pong': True}).encode())
            return

        if cmd == 'shutdown':
            writer.write(b'{"ok":true,"shutdown":true}')
            await writer.drain()
            writer.close()
            logger.info('Shutdown command received, exiting...')
            asyncio.get_event_loop().stop()
            return

        connected = (_sim is not None) or _use_lockdown
        if not connected:
            writer.write(json.dumps({'ok': False, 'error': '裝置尚未連接，請稍後重試'}).encode())
            return

        if cmd == 'set':
            lat, lng = msg['lat'], msg['lng']
            try:
                if _sim is not None:
                    await _sim.set(lat, lng)
                else:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, _lockdown_set_sync, lat, lng)
                writer.write(b'{"ok":true}')
                logger.info(f'Location set: {lat}, {lng}')
            except Exception as e:
                logger.warning(f'set failed: {e}, scheduling reconnect...')
                _sim = None
                _use_lockdown = False
                writer.write(json.dumps({'ok': False, 'error': '定位失敗，正在重連中，請稍後再試'}).encode())
                asyncio.ensure_future(_reconnect_with_retry())

        elif cmd == 'stop':
            try:
                if _sim is not None:
                    await _sim.clear()
                else:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, _lockdown_clear_sync)
                writer.write(b'{"ok":true,"stopped":true}')
                logger.info('Location stopped')
            except Exception as e:
                logger.warning(f'stop failed: {e}')
                _sim = None
                _use_lockdown = False
                writer.write(json.dumps({'ok': False, 'error': str(e)}).encode())
                asyncio.ensure_future(_reconnect_with_retry())

    except Exception as e:
        logger.error(f'handle_client error: {e}')
        try:
            writer.write(json.dumps({'ok': False, 'error': str(e)}).encode())
        except Exception:
            pass
    finally:
        try:
            await writer.drain()
            writer.close()
        except Exception:
            pass


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


async def main():
    try:
        os.remove(PORT_FILE)
    except Exception:
        pass

    port = _find_free_port()
    server = await asyncio.start_server(handle_client, '127.0.0.1', port)

    parent_dir = os.path.dirname(PORT_FILE)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    with open(PORT_FILE, 'w') as f:
        f.write(str(port))
    logger.info(f'Listening on 127.0.0.1:{port}  (port file: {PORT_FILE})')

    logger.info('Connecting to device in background...')
    asyncio.ensure_future(_connect_in_background())

    async with server:
        await server.serve_forever()


if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

try:
    asyncio.run(main())
except Exception as e:
    logger.error(f'Fatal error: {e}')
    sys.exit(1)
