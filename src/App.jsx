import { useState, useCallback, useEffect } from 'react'
import styled, { createGlobalStyle, keyframes } from 'styled-components'
import { theme } from './theme'
import { useLang } from './LangContext'
import { useDevice } from './hooks/useDevice'
import { useLocation } from './hooks/useLocation'
import { DeviceStatus } from './components/DeviceStatus'
import { Map } from './components/Map'
import { Onboarding } from './components/Onboarding'
import { TRANSPORT_MODES, fmtDist, fmtTime, haversine } from './utils/gps'

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${theme.fonts.sans};
    background: ${theme.colors.bg};
    color: ${theme.colors.textPrimary};
    height: 100vh;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  #root { height: 100vh; display: flex; flex-direction: column; }
`

const Layout = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`

const Sidebar = styled.aside`
  width: 256px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 12px;
  background: ${theme.colors.bg};
  border-right: 1px solid ${theme.colors.border};
  overflow-y: auto;
`

const MapArea = styled.main`
  flex: 1;
  padding: 12px 12px 12px 0;
  display: flex;
  flex-direction: column;
`

const Card = styled.div`
  background: ${theme.colors.surface};
  border-radius: ${theme.radii.lg};
  border: 1.5px solid ${theme.colors.border};
  padding: 14px 16px;
  box-shadow: ${theme.shadows.soft};
`

const CardLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${theme.colors.textMuted};
  margin-bottom: 10px;
`

const StatusChip = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: ${theme.radii.md};
  background: ${p => p.$active ? 'linear-gradient(135deg, #e6f4ea, #d2f1d8)' : theme.colors.surfaceHover};
  border: 1.5px solid ${p => p.$active ? '#a8d5b2' : theme.colors.border};
  transition: all ${theme.transitions.normal};
`

const StatusDot = styled.span`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${p => p.$active ? theme.colors.success : theme.colors.textMuted};
  flex-shrink: 0;
  box-shadow: ${p => p.$active ? '0 0 0 3px #a8d5b240' : 'none'};
  transition: all ${theme.transitions.normal};
`

const StatusText = styled.span`
  font-size: 14px;
  font-weight: ${p => p.$active ? 700 : 400};
  color: ${p => p.$active ? theme.colors.success : theme.colors.textSecondary};
`

const CoordDisplay = styled.div`
  font-family: ${theme.fonts.mono};
  font-size: 12px;
  color: ${theme.colors.textMuted};
  background: ${theme.colors.surfaceHover};
  border-radius: ${theme.radii.sm};
  padding: 8px 10px;
  letter-spacing: 0.02em;
  border: 1px solid ${theme.colors.border};
  line-height: 1.7;
  margin-top: 10px;
`

const ActionBtn = styled.button`
  width: 100%;
  padding: 11px 14px;
  border-radius: ${theme.radii.md};
  border: ${p => p.$primary ? 'none' : p.$danger ? `1.5px solid #f5c6c2` : `1.5px solid ${theme.colors.border}`};
  background: ${p => p.$primary
    ? `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight})`
    : p.$danger
      ? 'linear-gradient(135deg, #fce8e6, #fad2cf)'
      : theme.colors.surfaceHover};
  color: ${p => p.$primary ? '#fff' : p.$danger ? theme.colors.error : theme.colors.textSecondary};
  font-family: ${theme.fonts.sans};
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all ${theme.transitions.spring};
  box-shadow: ${p => p.$primary ? theme.shadows.button : p.$danger ? '0 2px 8px rgba(234,67,53,0.15)' : 'none'};

  &:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: ${p => p.$primary
      ? '0 6px 18px rgba(26,115,232,0.4)'
      : p.$danger
        ? '0 4px 14px rgba(234,67,53,0.3)'
        : theme.shadows.soft};
  }
  &:active:not(:disabled) { transform: translateY(0); }
  &:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
`



// ─── No Device Modal ──────────────────────────────────────
const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`
const slideUp = keyframes`
  from { opacity: 0; transform: translate(-50%, -46%) scale(0.95); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
`

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  z-index: 8000;
  animation: ${fadeIn} 0.25s ease both;
`

const ModalBox = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 8001;
  background: ${theme.colors.surface};
  border-radius: ${theme.radii.lg};
  border: 1.5px solid ${theme.colors.border};
  box-shadow: 0 24px 64px rgba(0,0,0,0.22);
  padding: 40px 44px;
  width: 420px;
  text-align: center;
  animation: ${slideUp} 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
`

// ─── Toast ────────────────────────────────────────────────
const spin = keyframes`to { transform: rotate(360deg); }`
const popIn = keyframes`
  from { opacity: 0; transform: translateX(-50%) translateY(12px) scale(0.9); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
`

const ToastBase = styled.div`
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  background: ${theme.colors.surface};
  border-radius: ${theme.radii.full};
  padding: 11px 26px;
  font-family: ${theme.fonts.sans};
  font-size: 13px;
  font-weight: 500;
  box-shadow: ${theme.shadows.pop};
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
  animation: ${popIn} 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
`

const LoadingToast = styled(ToastBase)`
  border: 1.5px solid ${theme.colors.primary}44;
  color: ${theme.colors.primary};
`

const ErrorToast = styled(ToastBase)`
  border: 1.5px solid ${theme.colors.error}44;
  color: ${theme.colors.error};
`

const Spinner = styled.span`
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid ${theme.colors.primary}33;
  border-top-color: ${theme.colors.primary};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
  flex-shrink: 0;
`

export default function App() {
  const { t, toggle: toggleLang } = useLang()
  const [onboarded, setOnboarded] = useState(() => !!localStorage.getItem('cm_onboarded'))
  const {
    devices, selectedDevice, setSelectedDevice,
    mounting, mountDDI, deviceStatus, error: deviceError
  } = useDevice()
  const udid = selectedDevice?.udid
  const [routeMode, setRouteMode] = useState(false)
  const [transport, setTransport] = useState('walk')
  const [routeInfo, setRouteInfo] = useState(null)
  const [activeRoute, setActiveRoute] = useState(null)  // 行駛中路線資訊

  const handleRouteUpdate = useCallback((info) => setRouteInfo(info), [])
  const {
    currentCoord, setCurrentCoord, isActive, loading, error: locationError,
    currentSpeedKmh, setLocation, stopLocation, startRoute,
  } = useLocation(udid, true, true)

  const isRouting = currentSpeedKmh != null


  const handleStartRoute = useCallback((path, speed, opts) => {
    setActiveRoute({
      path,
      routedDist: routeInfo?.routedDist ?? 0,
      etaSec:     routeInfo?.etaSec ?? 0,
      speedKmh:   Math.round(speed * 3.6),
    })
    // routeMode 由 Map 的 onToggleRouteMode 負責關閉，這裡不重複設定
    setRouteInfo(null)
    startRoute(path, speed, opts)
  }, [routeInfo, startRoute])

  // 路線結束後清空行駛資訊
  useEffect(() => {
    if (!isRouting) setActiveRoute(null)
  }, [isRouting])

  const handleMapClick = (lat, lng) => {
    if (!udid || loading) return
    setLocation(lat, lng)
  }

  const handleOnboardingDone = () => {
    localStorage.setItem('cm_onboarded', '1')
    setOnboarded(true)
  }

  // ─── 計算剩餘距離（找最近點後累加剩餘路段）────────
  const remainingDist = (() => {
    if (!isRouting || !activeRoute?.path || !currentCoord) return activeRoute?.routedDist ?? 0
    const path = activeRoute.path
    let minDist = Infinity, minIdx = 0
    for (let i = 0; i < path.length; i++) {
      const d = haversine(currentCoord.lat, currentCoord.lng, path[i].lat, path[i].lng)
      if (d < minDist) { minDist = d; minIdx = i }
    }
    let rem = 0
    for (let i = minIdx; i < path.length - 1; i++) {
      rem += haversine(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng)
    }
    return rem
  })()
  const remainingEta = activeRoute ? remainingDist / (activeRoute.speedKmh / 3.6) : 0

  // ─── 側欄中段內容 ─────────────────────────────────
  let sidebarPanel
  if (isRouting && activeRoute) {
    sidebarPanel = (
      <Card style={{
        background: `linear-gradient(145deg, ${theme.colors.primary}0d, ${theme.colors.primary}06)`,
        border: `1.5px solid ${theme.colors.primary}44`,
      }}>
        <CardLabel style={{ color: theme.colors.primary }}>🚦 行駛中</CardLabel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {[
            { label: '即時速度', val: `${currentSpeedKmh != null ? currentSpeedKmh.toFixed(1) : '—'} km/h` },
            { label: '剩餘距離', val: fmtDist(remainingDist) },
            { label: '剩餘時間', val: fmtTime(remainingEta) },
            { label: '計畫速度', val: `${activeRoute.speedKmh} km/h` },
          ].map(item => (
            <div key={item.label} style={{
              background: theme.colors.surfaceHover,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.sm,
              padding: '10px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div style={{ fontSize: 15, color: theme.colors.textMuted, fontWeight: 500 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: theme.colors.textPrimary }}>
                {item.val}
              </div>
            </div>
          ))}
        </div>

        <ActionBtn $danger onClick={stopLocation}>
          ⏹ 取消路線
        </ActionBtn>
      </Card>
    )
  } else if (routeMode) {
    sidebarPanel = (
      <Card>
        <CardLabel>🗺 路徑模式</CardLabel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {TRANSPORT_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setTransport(m.key)}
              style={{
                width: '100%', padding: '11px 16px',
                borderRadius: theme.radii.md,
                border: `1.5px solid ${transport === m.key ? theme.colors.primary : theme.colors.border}`,
                background: transport === m.key
                  ? `linear-gradient(135deg, ${theme.colors.primary}18, ${theme.colors.primary}08)`
                  : theme.colors.surfaceHover,
                color: transport === m.key ? theme.colors.primary : theme.colors.textSecondary,
                fontFamily: theme.fonts.sans,
                fontSize: 16,
                fontWeight: transport === m.key ? 700 : 400,
                cursor: 'pointer',
                transition: `all ${theme.transitions.fast}`,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 26 }}>{m.label.split(' ')[0]}</span>
              <span>{m.label.split(' ')[1]}</span>
              <span style={{ marginLeft: 'auto', fontSize: 14, opacity: 0.75 }}>{m.speedKmh} km/h</span>
            </button>
          ))}
        </div>

        <div style={{
          padding: '10px 12px',
          borderRadius: theme.radii.md,
          background: routeInfo?.hasPath ? '#e6f4ea' : theme.colors.surfaceHover,
          border: `1px solid ${routeInfo?.hasPath ? '#a8d5b2' : theme.colors.border}`,
          fontSize: 14,
          color: routeInfo?.hasPath ? theme.colors.success : theme.colors.textSecondary,
          marginBottom: 10,
          fontWeight: 500,
        }}>
          {routeInfo?.routeLoading ? '⏳ 規劃道路路線中…'
            : routeInfo?.routeError ? `⚠ ${routeInfo.routeError}`
            : routeInfo?.hasPath ? '✓ 已規劃道路路線'
            : routeInfo?.waypointCount >= 1
              ? `📍 已加入 ${routeInfo.waypointCount} 個點，再點地圖繼續`
              : '點地圖開始加入路徑點'}
        </div>

        {routeInfo?.waypointCount >= 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {[
              { label: '距離', val: fmtDist(routeInfo.routedDist) },
              { label: '時間', val: fmtTime(routeInfo.etaSec) },
              { label: '速度', val: `${TRANSPORT_MODES.find(m => m.key === transport)?.speedKmh} km/h` },
            ].map(item => (
              <div key={item.label} style={{
                background: theme.colors.surfaceHover,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.sm,
                padding: '10px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div style={{ fontSize: 13, color: theme.colors.textMuted, fontWeight: 500 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: theme.colors.textPrimary }}>
                  {item.val}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ActionBtn
            $primary
            onClick={() => routeInfo?.onStart?.()}
            disabled={!routeInfo?.onStart}
          >
            ▶ 開始行駛
          </ActionBtn>
          <ActionBtn $danger onClick={() => { setRouteMode(false); setRouteInfo(null) }}>
            ✕ 取消路徑模式
          </ActionBtn>
        </div>
      </Card>
    )
  } else {
    sidebarPanel = (
      <>
        <div style={{
          background: `linear-gradient(145deg, ${theme.colors.primary}10, ${theme.colors.accent2}08)`,
          border: `1.5px solid ${theme.colors.primary}30`,
          borderRadius: theme.radii.lg,
          padding: '16px 14px',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🗺</div>
          <div style={{
            fontSize: 20, fontWeight: 700,
            color: theme.colors.textPrimary, marginBottom: 6,
          }}>
            路徑模式
          </div>
          <div style={{
            fontSize: 15, color: theme.colors.textSecondary,
            lineHeight: 1.6, marginBottom: 14,
          }}>
            在地圖點選路徑點，自動規劃沿著真實道路行走的路線，支援步行、機車、汽車速度模擬。
          </div>
          <ActionBtn
            $primary
            onClick={() => { setRouteMode(true); setRouteInfo(null) }}
            disabled={!udid}
          >
            開始規劃路線 →
          </ActionBtn>
        </div>

      </>
    )
  }

  const noDevice = devices.length === 0

  return (
    <>
      <GlobalStyle />
      {!onboarded && <Onboarding onDone={handleOnboardingDone} />}
      {onboarded && noDevice && (
        <>
          <ModalOverlay />
          <ModalBox>
            <div style={{ fontSize: 56, marginBottom: 16 }}>📱</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.colors.textPrimary, marginBottom: 10 }}>
              尚未偵測到裝置
            </div>
            <div style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 1.8, marginBottom: 28 }}>
              請用 USB 線將 iPhone 連接到電腦，<br />
              並在手機上點選「信任此電腦」。<br />
              連接成功後此視窗會自動關閉。
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 13,
              color: theme.colors.textMuted,
              background: theme.colors.surfaceHover,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              padding: '10px 18px',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: theme.colors.textMuted,
                display: 'inline-block',
                flexShrink: 0,
              }} />
              等待裝置連線中…
            </div>
          </ModalBox>
        </>
      )}
      <DeviceStatus
        devices={devices}
        selected={selectedDevice}
        onSelect={setSelectedDevice}
        onMount={mountDDI}
        mounting={mounting}
        mounted={!!deviceStatus}
        error={deviceError}
      />
      <Layout>
        <Sidebar>



          {/* 連接手機 */}
          <ActionBtn
            $primary
            onClick={selectedDevice && !deviceStatus && !mounting ? mountDDI : undefined}
            disabled={mounting || !selectedDevice}
            style={{
              opacity: !selectedDevice ? 0.45 : (deviceStatus && !locationError) ? 0.7 : 1,
              cursor: selectedDevice && !deviceStatus && !mounting ? 'pointer' : 'default',
              width: '100%',
              padding: '14px 14px',
              fontSize: '20px',
            }}
          >
            {mounting ? t.mounting : (deviceStatus && !locationError) ? t.mountSuccess : t.mountDDI}
          </ActionBtn>

          {currentSpeedKmh != null && (
            <div style={{
              padding: '7px 12px',
              borderRadius: theme.radii.md,
              background: `linear-gradient(135deg, ${theme.colors.primary}12, ${theme.colors.primary}06)`,
              border: `1.5px solid ${theme.colors.primary}33`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 700,
              color: theme.colors.primary,
            }}>
              🚀 <span>{currentSpeedKmh.toFixed(1)} km/h</span>
            </div>
          )}

          {sidebarPanel}

          {/* 使用須知 */}
          <div style={{ marginTop: 12 }}>
            <div style={{
              background: 'linear-gradient(135deg, #fffbea, #fff8dc)',
              border: '1.5px solid #f0d060',
              borderRadius: theme.radii.lg,
              padding: '12px 14px',
              boxShadow: '0 2px 8px rgba(240,208,96,0.15)',
            }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 15, fontWeight: 700, color: '#92600a',
                  marginBottom: 3,
                }}>
                  ⚠️ 使用前請確認
                </div>
                <div style={{ fontSize: 13, color: '#b07820', fontWeight: 500 }}>
                  以下設定適用於 iPhone 手機
                </div>
              </div>
              {[
                ['🔧', '開啟開發者模式 (iPhone)', '設定 → 隱私權與安全性 → 開發者模式'],
                ['🔓', '保持手機解鎖', '鎖屏時無法接收模擬定位'],
                ['🗺', '開啟地圖 App', '先開啟 Apple 地圖或 Google Maps'],
                ['📍', '定位服務已開啟', '設定 → 隱私權與安全性 → 定位服務'],
              ].map(([icon, title, desc]) => (
                <div key={title} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  marginBottom: 7, fontSize: 11.5,
                }}>
                  <span style={{ flexShrink: 0 }}>{icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#5a3e00', fontSize: 15 }}>{title}</div>
                    <div style={{ color: '#8a6a20', fontSize: 14, marginTop: 3 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, textAlign: 'center', padding: '6px 0 2px' }}>
              iOS Location Master v1.1.8
            </div>
          </div>
        </Sidebar>

        <MapArea>
          <Map
            coord={currentCoord}
            isActive={isActive}
            onMapClick={handleMapClick}
            onStop={stopLocation}
            loading={loading}
            routeMode={routeMode}
            onToggleRouteMode={() => { setRouteMode(v => !v); setRouteInfo(null) }}
            onStartRoute={handleStartRoute}
            currentSpeedKmh={currentSpeedKmh}
            transport={transport}
            onRouteUpdate={handleRouteUpdate}
          />
        </MapArea>
      </Layout>

      {loading && (
        <LoadingToast>
          <Spinner />
          {t.loadingToast}
        </LoadingToast>
      )}
      {locationError && !loading && (
        <ErrorToast>⚠ {locationError}</ErrorToast>
      )}
    </>
  )
}
