import { useState, useEffect, useCallback, useRef } from 'react'

export function useDevice() {
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [deviceStatus, setDeviceStatus] = useState(null)
  const [mounting, setMounting] = useState(false)
  const [tunnelReady, setTunnelReady] = useState(false)
  const [tunneling, setTunneling] = useState(false)
  const [error, setError] = useState(null)
  const [initialized, setInitialized] = useState(false)

  // 用 ref 追蹤 selectedDevice，避免 interval 閉包抓到過期值
  const selectedRef = useRef(null)
  useEffect(() => { selectedRef.current = selectedDevice }, [selectedDevice])

  // 連續失敗次數；曾偵測到裝置後門檻提高，避免暫時性失敗觸發 modal
  const failCount = useRef(0)
  const everSeenDevice = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.listDevices()

      if (list.length === 0) {
        failCount.current += 1
        // 曾看過裝置：需要 5 次連續失敗（25 秒）才清空，避免 bridge 重啟等短暫失敗觸發 modal
        const threshold = everSeenDevice.current ? 5 : 2
        if (failCount.current < threshold) return
        setDevices([])
      } else {
        failCount.current = 0
        everSeenDevice.current = true
        setDevices(list)
        if (!selectedRef.current) {
          setSelectedDevice(list[0])
        } else {
          const stillPresent = list.find(d => d.udid === selectedRef.current.udid)
          if (!stillPresent) setSelectedDevice(list[0])
        }
      }
    } catch (e) {
      failCount.current += 1
      const threshold = everSeenDevice.current ? 5 : 2
      if (failCount.current >= threshold) setError(e.message)
    } finally {
      // initialized 只在曾成功偵測過裝置、或確認連續多次都沒裝置後才設 true
      // 避免第一次 poll 回空就立刻顯示 modal
      if (everSeenDevice.current || failCount.current >= 2) {
        setInitialized(true)
      }
    }
  }, []) // 無需依賴，全部透過 ref 讀取最新狀態

  const mountDDI = useCallback(async () => {
    if (!selectedRef.current) return
    setMounting(true)
    setError(null)
    try {
      const result = await window.api.mountDDI(selectedRef.current.udid)
      setDeviceStatus(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setMounting(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh]) // refresh 已無依賴，此處穩定不會重建 interval

  const startTunnel = useCallback(async () => {
    setTunneling(true)
    setError(null)
    try {
      const result = await window.api.startTunneld()
      if (result.ok) setTunnelReady(true)
      else setError(result.error)
    } catch (e) {
      setError(e.message)
    } finally {
      setTunneling(false)
    }
  }, [])

  const needsTunnel = selectedDevice && selectedDevice.ios_version && parseInt(selectedDevice.ios_version) >= 17

  return {
    devices, selectedDevice, setSelectedDevice, deviceStatus,
    mounting, mountDDI, tunnelReady, tunneling, startTunnel, needsTunnel,
    error, refresh, initialized,
  }
}
