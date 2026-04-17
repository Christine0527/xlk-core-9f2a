import math
import time
import threading
import logging
from async_runner import run_async

logger = logging.getLogger(__name__)

class LocationSpoofer:
    def __init__(self, udid: str):
        self.udid = udid
        self._running = False
        self._lock = threading.Lock()
        self._lockdown = None
        self._rsd = None          # iOS 17+ via tunneld
        self._ios_major = 0
        run_async(self._init())

    async def _init(self):
        from pymobiledevice3.lockdown import create_using_usbmux
        self._lockdown = await create_using_usbmux(serial=self.udid)
        self._ios_major = int(self._lockdown.product_version.split('.')[0])
        if self._ios_major >= 17:
            await self._init_rsd()
        logger.info(f'LocationSpoofer ready for {self.udid} (iOS {self._ios_major})')

    async def _init_rsd(self):
        """iOS 17+：透過 tunneld 建立 RSD 連線"""
        from pymobiledevice3.remote.tunnel_service import get_rsds
        rsds = await get_rsds(bonjour_timeout=5, udid=self.udid)
        if not rsds:
            raise RuntimeError('tunneld 未啟動，請先點選「啟動 Tunnel」按鈕')
        self._rsd = rsds[0]
        await self._rsd.connect()
        logger.info(f'RSD connected for {self.udid}')

    def set_location(self, lat: float, lng: float):
        run_async(self._set_location(lat, lng))

    async def _set_location(self, lat: float, lng: float):
        from pymobiledevice3.services.simulate_location import DtSimulateLocation
        provider = self._rsd if self._ios_major >= 17 else self._lockdown
        async with DtSimulateLocation(lockdown=provider) as sim:
            await sim.set(lat, lng)

    def stop(self):
        self._running = False
        run_async(self._stop())

    async def _stop(self):
        from pymobiledevice3.services.simulate_location import DtSimulateLocation
        try:
            provider = self._rsd if self._ios_major >= 17 else self._lockdown
            async with DtSimulateLocation(lockdown=provider) as sim:
                await sim.clear()
        except Exception as e:
            logger.warning(f'stop error: {e}')

    def walk_route(self, waypoints: list, speed: float = 1.4):
        self._running = True
        for i in range(len(waypoints) - 1):
            if not self._running:
                break
            p1, p2 = waypoints[i], waypoints[i + 1]
            dist = self._haversine(p1['lat'], p1['lng'], p2['lat'], p2['lng'])
            steps = max(int(dist / speed * 10), 1)
            for s in range(steps):
                if not self._running:
                    return
                t = s / steps
                lat = p1['lat'] + (p2['lat'] - p1['lat']) * t
                lng = p1['lng'] + (p2['lng'] - p1['lng']) * t
                self.set_location(lat, lng)
                time.sleep(0.1)

    @staticmethod
    def _haversine(lat1, lon1, lat2, lon2) -> float:
        R = 6371000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
        a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
