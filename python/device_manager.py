import logging
import asyncio
from async_runner import run_async

logger = logging.getLogger(__name__)

class DeviceManager:
    def list_devices(self) -> list:
        return run_async(self._list_devices())

    async def _list_devices(self) -> list:
        from pymobiledevice3.usbmux import select_devices_by_connection_type
        from pymobiledevice3.lockdown import create_using_usbmux

        last_exc = None
        for attempt in range(3):
            try:
                devices = await select_devices_by_connection_type(connection_type='USB')
                result = []
                for d in devices:
                    try:
                        lockdown = await create_using_usbmux(serial=d.serial)
                        result.append({
                            'udid': d.serial,
                            'name': lockdown.display_name,
                            'ios_version': lockdown.product_version,
                            'model': lockdown.product_type,
                        })
                    except Exception as e:
                        logger.warning(f'Cannot read device {d.serial}: {e}')
                        # 裝置 USB 已接上但 lockdown 暫時失敗（鎖屏、尚未信任等）
                        # 仍回傳裝置讓前端顯示，避免 modal 誤跳出
                        result.append({
                            'udid': d.serial,
                            'name': 'iPhone',
                            'ios_version': None,
                            'model': None,
                        })
                return result
            except Exception as e:
                last_exc = e
                if attempt < 2:
                    await asyncio.sleep(0.5)
        logger.error(f'list_devices failed after 3 attempts: {last_exc}')
        return []

    def get_status(self, udid: str) -> dict:
        return run_async(self._get_status(udid))

    async def _get_status(self, udid: str) -> dict:
        from pymobiledevice3.lockdown import create_using_usbmux
        lockdown = await create_using_usbmux(serial=udid)
        ios_version = lockdown.product_version
        major = int(ios_version.split('.')[0])
        return {
            'udid': udid,
            'ios_version': ios_version,
            'ios_major': major,
            'needs_tunnel': major >= 17,
        }

    def ensure_mounted(self, udid: str) -> dict:
        return run_async(self._ensure_mounted(udid))

    async def _ensure_mounted(self, udid: str) -> dict:
        from pymobiledevice3.lockdown import create_using_usbmux

        # 重試 3 次，中間重建 lockdown 連線（防止 ConnectionTerminatedError）
        last_exc = None
        for attempt in range(3):
            try:
                lockdown = await create_using_usbmux(serial=udid)
                ios_version = lockdown.product_version
                major = int(ios_version.split('.')[0])
                logger.info(f'Device {udid} iOS {ios_version} (attempt {attempt+1})')
                if major >= 17:
                    return await self._mount_personalized(lockdown)
                else:
                    return await self._mount_ddi(lockdown, ios_version)
            except Exception as e:
                last_exc = e
                logger.warning(f'Mount attempt {attempt+1} failed: {e}')
                if attempt < 2:
                    await asyncio.sleep(1.5)

        raise RuntimeError(f'掛載失敗（已重試 3 次）：{last_exc}\n\n請確認：\n1. iPhone 有點選「信任此電腦」\n2. iPhone 已開啟「開發者模式」（設定 > 隱私與安全性）')

    async def _mount_ddi(self, lockdown, ios_version: str) -> dict:
        from pymobiledevice3.services.mobile_image_mounter import auto_mount_developer, AlreadyMountedError
        try:
            await auto_mount_developer(lockdown)
            return {'status': 'mounted', 'method': 'DDI'}
        except AlreadyMountedError:
            return {'status': 'already_mounted', 'method': 'DDI'}

    async def _mount_personalized(self, lockdown) -> dict:
        from pymobiledevice3.services.mobile_image_mounter import auto_mount_personalized, AlreadyMountedError
        try:
            await auto_mount_personalized(lockdown)
            return {'status': 'mounted', 'method': 'Personalized'}
        except AlreadyMountedError:
            return {'status': 'already_mounted', 'method': 'Personalized'}
