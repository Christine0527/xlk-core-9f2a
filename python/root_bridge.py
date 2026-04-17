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

logging.basicConfig(level=logging.INFO, format='[root_bridge] %(message)s')
logger = logging.getLogger(__name__)


def _bridge_port_file() -> str:
    if sys.platform == 'win32':
        return os.path.join(os.environ.get('ALLUSERSPROFILE', 'C:\\ProgramData'), 'ios-location-master.port')
    return '/tmp/ios-location-master.port'


PORT_FILE = _bridge_port_file()

_sim = None
_dvt_provider = None
_tunnel_cm = None


async def _cleanup():
    global _sim, _dvt_provider, _tunnel_cm
    for obj in [_sim, _dvt_provider, _tunnel_cm]:
        if obj is not None:
            try:
                await obj.__aexit__(None, None, None)
            except Exception:
                pass
    _sim = None
    _dvt_provider = None
    _tunnel_cm = None


async def connect():
    global _sim, _dvt_provider, _tunnel_cm
    from pymobiledevice3.remote.tunnel_service import (
        get_remote_pairing_tunnel_services, start_tunnel, TunnelProtocol
    )
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
    from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
    from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

    await _cleanup()

    logger.info('Discovering device...')
    services = await get_remote_pairing_tunnel_services(bonjour_timeout=15)
    if not services:
        logger.info('remote_pairing not found, trying core_device...')
        from pymobiledevice3.remote.tunnel_service import get_core_device_tunnel_services
        services = await get_core_device_tunnel_services(bonjour_timeout=15)
    if not services:
        raise RuntimeError('找不到裝置 — 請確認已點選「連接手機」並成功掛載')

    svc = services[0]
    logger.info(f'Found: {svc}')

    _tunnel_cm = start_tunnel(svc, protocol=TunnelProtocol.TCP)
    tunnel_result = await _tunnel_cm.__aenter__()

    rsd = RemoteServiceDiscoveryService((tunnel_result.address, tunnel_result.port))
    await rsd.connect()
    logger.info(f'RSD: {rsd.udid}')

    _dvt_provider = DvtProvider(lockdown=rsd)
    dvt = await _dvt_provider.__aenter__()

    sim_cm = LocationSimulation(dvt)
    _sim = await sim_cm.__aenter__()
    logger.info('Ready to spoof location!')


async def _reconnect_with_retry():
    global _sim
    attempt = 0
    while True:
        attempt += 1
        wait = min(attempt * 3, 30)
        logger.info(f'Reconnecting (attempt {attempt}), waiting {wait}s...')
        await asyncio.sleep(wait)
        try:
            await connect()
            logger.info('Reconnected successfully!')
            return True
        except Exception as e:
            logger.error(f'Attempt {attempt} failed: {e}')
            _sim = None


async def handle_client(reader, writer):
    global _sim
    try:
        data = await reader.read(256)
        if not data:
            return
        msg = json.loads(data.decode())
        cmd = msg.get('cmd')

        if cmd == 'ping':
            writer.write(json.dumps({'ok': _sim is not None, 'pong': True}).encode())
            return

        if cmd == 'shutdown':
            writer.write(b'{"ok":true,"shutdown":true}')
            await writer.drain()
            writer.close()
            logger.info('Shutdown command received, exiting...')
            asyncio.get_event_loop().stop()
            return

        if _sim is None:
            writer.write(json.dumps({'ok': False, 'error': '連線中斷，正在重連...'}).encode())
            return

        if cmd == 'set':
            lat, lng = msg['lat'], msg['lng']
            try:
                await _sim.set(lat, lng)
                writer.write(b'{"ok":true}')
                logger.info(f'Location set: {lat}, {lng}')
            except Exception as e:
                logger.warning(f'set failed: {e}, scheduling reconnect...')
                _sim = None
                writer.write(json.dumps({'ok': False, 'error': '定位失敗，正在重連中，請稍後再試'}).encode())
                asyncio.ensure_future(_reconnect_with_retry())

        elif cmd == 'stop':
            try:
                await _sim.clear()
                writer.write(b'{"ok":true,"stopped":true}')
                logger.info('Location stopped')
            except Exception as e:
                logger.warning(f'stop failed: {e}')
                _sim = None
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
    # 清除舊的 port 檔案
    try:
        os.remove(PORT_FILE)
    except Exception:
        pass

    logger.info('Connecting to device...')
    await connect()

    port = _find_free_port()

    # 確保目錄存在（Windows C:\ProgramData 預設存在，但以防萬一）
    os.makedirs(os.path.dirname(PORT_FILE), exist_ok=True)

    server = await asyncio.start_server(handle_client, '127.0.0.1', port)

    # 寫入 port 檔案，讓呼叫方知道要連哪個 port
    with open(PORT_FILE, 'w') as f:
        f.write(str(port))
    logger.info(f'Listening on 127.0.0.1:{port}  (port file: {PORT_FILE})')

    async with server:
        await server.serve_forever()


asyncio.run(main())
