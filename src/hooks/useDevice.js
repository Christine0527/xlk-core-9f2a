import { useState, useEffect, useCallback, useRef } from 'react'

export function useDevice() {
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [deviceStatus, setDeviceStatus] = useState(null)
  const [mounting, setMounting] = useState(false)
  const [tunnelReady, setTunnelReady] = useState(false)
  const [tunneling, setTunneling] = useState(false)
  const [error, setError] = useState(null)

  // 用 ref 追蹤 selectedDevice，避免 interval 閉包抓到過期值
  const selectedRef = useRef(null)
  useEffect(() => { selectedRef.current = selectedDevice }, [selectedDevice])

  // 連續失敗次數，需要 2 次失敗才真的清空裝置列表，避免 USB 短暫抖動誤判
  const failCount = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.listDevices()

      if (list.length === 0) {
        // 單次空回傳不立即清空，等第 2 次才確認裝置真的消失
        failCount.current += 1
        if (failCount.current < 2) return
        setDevices([])
      } else {
        failCount.current = 0
        setDevices(list)
        // 用 ref 避免閉包過期問題
        if (!selectedRef.current) {
          setSelectedDevice(list[0])
        } else {
          // 確保 selectedDevice 仍在列表中（裝置重新插拔後 udid 不變）
          const stillPresent = list.find(d => d.udid === selectedRef.current.udid)
          if (!stillPresent) setSelectedDevice(list[0])
        }
      }
    } catch (e) {
      // 單次例外不噴錯，等第 2 次才顯示
      failCount.current += 1
      if (failCount.current >= 2) setError(e.message)
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

  const needsTunnel = selectedDevice && parseInt(selectedDevice.ios_version) >= 17

  return {
    devices, selectedDevice, setSelectedDevice, deviceStatus,
    mounting, mountDDI, tunnelReady, tunneling, startTunnel, needsTunnel,
    error, refresh,
  }
}
