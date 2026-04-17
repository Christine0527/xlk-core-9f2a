"""
在背景執行緒維持一個持久的 asyncio event loop，
讓 Flask（同步）可以安全地呼叫 async 函數。
"""
import asyncio
import threading

_loop: asyncio.AbstractEventLoop = None
_thread: threading.Thread = None

def _start_loop(loop: asyncio.AbstractEventLoop):
    asyncio.set_event_loop(loop)
    loop.run_forever()

def get_loop() -> asyncio.AbstractEventLoop:
    global _loop, _thread
    if _loop is None or not _loop.is_running():
        _loop = asyncio.new_event_loop()
        _thread = threading.Thread(target=_start_loop, args=(_loop,), daemon=True)
        _thread.start()
    return _loop

def run_async(coro):
    """從同步代碼呼叫 async 函數，等待結果"""
    loop = get_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=30)
