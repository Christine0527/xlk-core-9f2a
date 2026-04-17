import { useState, useCallback, useRef } from 'react'
import {
  haversine,
  smoothPath, buildArcTable, arcLengthToCoord,
  createDriftModel, createWanderModel,
} from '../utils/gps'

// 精準計時器（支援提前取消）
function preciseDelay(ms, abort = null) {
  return new Promise(resolve => {
    const start = performance.now()
    const tick = () => {
      if (abort?.cancelled || performance.now() - start >= ms) resolve()
      else setTimeout(tick, Math.max(0, ms - (performance.now() - start) - 1))
    }
    setTimeout(tick, Math.max(ms - 5, 0))
  })
}

export function useLocation(udid, jitter = false, smoothWalk = false) {
  const [currentCoord, setCurrentCoord] = useState(null)
  const [isActive, setIsActive]         = useState(false)
  const [loading, setLoading]           = useState(false)
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(null)
  const [error, setError]               = useState(null)
  const currentRef  = useRef(null)
  const walkAbort   = useRef(null)
  // 追蹤目前 walk loop 何時真正結束
  const walkDone    = useRef(Promise.resolve())

  const updateCoord = useCallback((coord) => {
    currentRef.current = coord
    setCurrentCoord(coord)
  }, [])

  // 停止目前正在跑的 loop，等它真正結束
  async function cancelCurrent() {
    if (walkAbort.current) {
      walkAbort.current.cancelled = true
      await walkDone.current      // 等舊 loop 完全退出
    }
  }

  // ─── 單點設定定位（含平滑步行） ──────────────────────────────
  const setLocation = useCallback(async (lat, lng) => {
    if (!udid) return

    await cancelCurrent()

    const from = currentRef.current
    const dist = from ? haversine(from.lat, from.lng, lat, lng) : 0

    if (smoothWalk && from && dist > 5) {
      const SPEED    = 1.4
      const INTERVAL = 1000

      const abort = { cancelled: false }
      walkAbort.current = abort

      let markDone
      walkDone.current = new Promise(r => { markDone = r })

      setError(null)
      setIsActive(true)
      setCurrentSpeedKmh(SPEED * 3.6)

      const midLat = (from.lat + lat) / 2 + (Math.random() - 0.5) * 0.00008
      const midLng = (from.lng + lng) / 2 + (Math.random() - 0.5) * 0.00008
      const wp = [from, { lat: midLat, lng: midLng }, { lat, lng }]
      const smooth = smoothPath(wp, 12)
      const arcTable = buildArcTable(smooth)
      const totalDist = arcTable[arcTable.length - 1]

      const drift  = createDriftModel()
      const wander = createWanderModel()
      let traveled = 0
      let pauseIn  = Math.floor(Math.random() * 35) + 20

      while (traveled < totalDist && !abort.cancelled) {
        const stepSpeed = SPEED * (0.88 + Math.random() * 0.24)
        traveled = Math.min(traveled + stepSpeed, totalDist)

        const pos = arcLengthToCoord(smooth, arcTable, traveled)
        const d = drift()
        const w = wander(pos.dirLat, pos.dirLng)

        const finalLat = pos.lat + d.dLat + w.dLat
        const finalLng = pos.lng + d.dLng + w.dLng

        try {
          await window.api.setLocation(udid, finalLat, finalLng, false)
          updateCoord({ lat: finalLat, lng: finalLng })
          setError(null)
        } catch (e) {
          const msg = e.message || ''
          if (msg.includes('重連') || msg.includes('reconnect')) {
            // 暫時性重連，不中斷行走，靜默等待後繼續
            setError(null)
          } else {
            setError(msg || '定位失敗')
            abort.cancelled = true
            break
          }
        }

        pauseIn--
        if (pauseIn <= 0) {
          pauseIn = Math.floor(Math.random() * 35) + 20
          await preciseDelay(Math.floor(Math.random() * 2000) + 600, abort)
        }

        await preciseDelay(INTERVAL, abort)
      }

      walkAbort.current = null
      setCurrentSpeedKmh(null)
      markDone()
      return
    }

    // 一般模式：單點跳位
    setLoading(true)
    setError(null)
    try {
      const drift = createDriftModel()
      const d = drift()
      const finalLat = lat + d.dLat
      const finalLng = lng + d.dLng
      await window.api.setLocation(udid, finalLat, finalLng, false)
      updateCoord({ lat, lng })
      setIsActive(true)
    } catch (e) {
      setError(e.message || '定位設定失敗')
    } finally {
      setLoading(false)
    }
  }, [udid, smoothWalk])

  // ─── 停止模擬 ─────────────────────────────────────────────────
  const stopLocation = useCallback(async () => {
    if (!udid) return
    if (walkAbort.current) walkAbort.current.cancelled = true
    setError(null)
    setCurrentSpeedKmh(null)
    try {
      await window.api.stopLocation(udid)
    } catch { /* ignore */ }
    setIsActive(false)
    updateCoord(null)
  }, [udid])

  // ─── 路線模式（完整反偵測引擎） ───────────────────────────────
  const startRoute = useCallback(async (waypoints, speed = 1.4, { preRouted = false } = {}) => {
    if (!udid || waypoints.length < 2) return

    await cancelCurrent()   // 等前一個 loop 完全結束，不再有任何座標送出

    const abort = { cancelled: false }
    walkAbort.current = abort

    let markDone
    walkDone.current = new Promise(r => { markDone = r })

    setCurrentSpeedKmh(speed * 3.6)
    setError(null)
    setIsActive(true)

    const smooth    = preRouted ? waypoints : smoothPath(waypoints, 24)
    const arcTable  = buildArcTable(smooth)
    const totalDist = arcTable[arcTable.length - 1]

    const drift       = createDriftModel()
    const wanderScale = speed <= 2 ? 1.0 : speed <= 10 ? 0.3 : 0.05
    const wander      = createWanderModel()

    let traveled = 0
    let pauseIn  = speed <= 2 ? (Math.floor(Math.random() * 40) + 25) : Infinity

    while (traveled < totalDist && !abort.cancelled) {
      const stepSpeed = speed * (0.88 + Math.random() * 0.24)
      traveled = Math.min(traveled + stepSpeed, totalDist)

      const pos = arcLengthToCoord(smooth, arcTable, traveled)
      const d   = drift()
      const w   = wander(pos.dirLat, pos.dirLng)

      const finalLat = pos.lat + d.dLat + w.dLat * wanderScale
      const finalLng = pos.lng + d.dLng + w.dLng * wanderScale

      try {
        await window.api.setLocation(udid, finalLat, finalLng, false)
        updateCoord({ lat: finalLat, lng: finalLng })
        setError(null)
      } catch (e) {
        const msg = e.message || ''
        if (msg.includes('重連') || msg.includes('reconnect')) {
          setError(null)
        } else {
          setError(msg || '定位失敗')
          abort.cancelled = true
          break
        }
      }

      if (speed <= 2) {
        pauseIn--
        if (pauseIn <= 0) {
          pauseIn = Math.floor(Math.random() * 40) + 25
          await preciseDelay(Math.floor(Math.random() * 2500) + 600, abort)
        }
      }

      await preciseDelay(1000, abort)
    }

    walkAbort.current = null
    setCurrentSpeedKmh(null)
    markDone()
  }, [udid])

  return {
    currentCoord, setCurrentCoord: updateCoord,
    isActive, loading, error, currentSpeedKmh,
    setLocation, stopLocation, startRoute,
  }
}
