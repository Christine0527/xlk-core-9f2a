import { useState, useCallback, useEffect, useRef } from 'react'
import styled, { createGlobalStyle, keyframes } from 'styled-components'
import { theme } from './theme'
import { useLang } from './LangContext'
import { useDevice } from './hooks/useDevice'
import { useLocation } from './hooks/useLocation'
import { DeviceStatus } from './components/DeviceStatus'
import { Map } from './components/Map'
import { Onboarding } from './components/Onboarding'
import { TRANSPORT_MODES, fmtDist, fmtTime, haversine } from './utils/gps'
import { IS_TRIAL, TRIAL_MINUTES } from './config'

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
  white-space: normal;
  border-radius: ${theme.radii.lg};
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 360px;
  text-align: left;
`

const ErrorSolution = styled.span`
  font-size: 12px;
  font-weight: 400;
  opacity: 0.75;
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

const TrialBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: ${theme.radii.full};
  background: #fff8e1;
  border: 1.5px solid #f59e0b;
  font-size: 12px;
  font-weight: 700;
  color: #b45309;
  font-family: ${theme.fonts.sans};
`

const TrialOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
`

const TrialModal = styled.div`
  background: ${theme.colors.surface};
  border-radius: ${theme.radii.lg};
  padding: 32px 28px;
  max-width: 360px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  text-align: center;
  font-family: ${theme.fonts.sans};
`

function getErrorSolution(msg) {
  if (!msg) return null
  if (msg.includes('取消授權') || msg.includes('啟動失敗')) return '請重新點擊連接按鈕並輸入管理員密碼'
  if (msg.includes('逾時') || msg.includes('root_bridge')) return '請按 Shift+R 重整後再試'
  if (msg.includes('無法連線至路線規劃')) return '請確認網路連線，或按 Shift+R 重整'
  if (msg.includes('路線規劃失敗')) return '請稍後再試，或按 Shift+R 重整'
  if (msg.includes('找不到可行路線')) return '請調整路徑點後重試'
  if (msg.includes('定位失敗') || msg.includes('定位設定失敗')) return '請確認裝置螢幕保持解鎖，如問題持續請按 Shift+R 重整'
  return '如問題持續請按 Shift+R 重整'
}

export default function App() {
  const { t, lang, toggle: toggleLang } = useLang()
  const [onboarded, setOnboarded] = useState(() => !!localStorage.getItem('cm_onboarded'))
  const {
    devices, selectedDevice, setSelectedDevice,
    mounting, mountDDI, deviceStatus, error: deviceError, initialized: deviceInitialized
  } = useDevice()
  const udid = selectedDevice?.udid
  const [routeMode, setRouteMode] = useState(false)
  const [transport, setTransport] = useState('walk')
  const [routeInfo, setRouteInfo] = useState(null)
  const [activeRoute, setActiveRoute] = useState(null)

  // ─── Trial ────────────────────────────────────────────────────
  const TRIAL_SECS = TRIAL_MINUTES * 60
  const [trialSecsLeft, setTrialSecsLeft] = useState(TRIAL_SECS)
  const [trialExpired, setTrialExpired] = useState(false)
  const trialTimerRef = useRef(null)

  const handleRouteUpdate = useCallback((info) => setRouteInfo(info), [])
  const {
    currentCoord, setCurrentCoord, isActive, loading, error: locationError,
    currentSpeedKmh, setLocation, stopLocation, startRoute,
  } = useLocation(udid, true, true)

  const isRouting = currentSpeedKmh != null

  // 試用計時器：isActive 時倒數，停止時暫停
  useEffect(() => {
    if (!IS_TRIAL) return
    if (isActive && !trialExpired) {
      trialTimerRef.current = setInterval(() => {
        setTrialSecsLeft(s => {
          if (s <= 1) {
            clearInterval(trialTimerRef.current)
            setTrialExpired(true)
            stopLocation()
            setRouteMode(false)
            setRouteInfo(null)
            return 0
          }
          return s - 1
        })
      }, 1000)
    } else {
      clearInterval(trialTimerRef.current)
    }
    return () => clearInterval(trialTimerRef.current)
  }, [isActive, trialExpired, stopLocation])

  const handleStartRoute = useCallback((path, speed, opts) => {
    // 試用版速度上限 30 km/h (8.33 m/s)
    const cappedSpeed = IS_TRIAL ? Math.min(speed, 8.33) : speed
    setActiveRoute({
      path,
      routedDist: routeInfo?.routedDist ?? 0,
      etaSec:     routeInfo?.etaSec ?? 0,
      speedKmh:   Math.round(speed * 3.6),
    })
    // routeMode 由 Map 的 onToggleRouteMode 負責關閉，這裡不重複設定
    setRouteInfo(null)
    startRoute(path, cappedSpeed, opts)
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
        <CardLabel style={{ color: theme.colors.primary }}>{t.drivingLabel}</CardLabel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {[
            { label: t.currentSpeedLabel, val: `${currentSpeedKmh != null ? currentSpeedKmh.toFixed(1) : '—'} km/h` },
            { label: t.remainDistLabel,   val: fmtDist(remainingDist) },
            { label: t.remainTimeLabel,   val: fmtTime(remainingEta) },
            { label: t.plannedSpeedLabel, val: `${activeRoute.speedKmh} km/h` },
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
          {t.cancelRoute}
        </ActionBtn>
      </Card>
    )
  } else if (routeMode) {
    sidebarPanel = (
      <Card>
        <CardLabel>{t.routeModeCardLabel}</CardLabel>

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
              <span>{lang === 'en' ? m.nameEn : m.label.split(' ')[1]}</span>
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
          {routeInfo?.routeLoading ? t.routePlanning
            : routeInfo?.routeError ? (
              <span>
                <span>⚠ {routeInfo.routeError}</span>
                {getErrorSolution(routeInfo.routeError) && (
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
                    → {getErrorSolution(routeInfo.routeError)}
                  </span>
                )}
              </span>
            )
            : routeInfo?.hasPath ? t.routeReady
            : routeInfo?.waypointCount >= 1
              ? t.waypointAdded.replace('{n}', routeInfo.waypointCount)
              : t.waypointHint}
        </div>

        {routeInfo?.waypointCount >= 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {[
              { label: t.distanceLabel, val: fmtDist(routeInfo.routedDist) },
              { label: t.timeLabel,     val: fmtTime(routeInfo.etaSec) },
              { label: t.speedLabel,    val: `${TRANSPORT_MODES.find(m => m.key === transport)?.speedKmh} km/h` },
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
            {t.startDrive}
          </ActionBtn>
          <ActionBtn $danger onClick={() => { setRouteMode(false); setRouteInfo(null) }}>
            {t.cancelRouteMode}
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
            {t.routeModeTitle}
          </div>
          <div style={{
            fontSize: 15, color: theme.colors.textSecondary,
            lineHeight: 1.6, marginBottom: 14,
          }}>
            {t.routeModeDesc}
          </div>
          <ActionBtn
            $primary
            onClick={() => { setRouteMode(true); setRouteInfo(null) }}
            disabled={!udid}
          >
            {t.startPlanRoute}
          </ActionBtn>
        </div>

      </>
    )
  }

  const noDevice = deviceInitialized && devices.length === 0

  // Shift+R 全域重整
  useEffect(() => {
    const onKey = (e) => {
      if (e.shiftKey && e.key === 'R') window.location.reload()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <GlobalStyle />
      {!onboarded && <Onboarding onDone={handleOnboardingDone} />}
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

          {IS_TRIAL && (
            <TrialBadge>
              <span>⏱</span>
              <span>{t.trialBadge}</span>
              <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                {String(Math.floor(trialSecsLeft / 60)).padStart(2, '0')}:
                {String(trialSecsLeft % 60).padStart(2, '0')}
              </span>
            </TrialBadge>
          )}

          <div style={{ fontSize: 11, color: theme.colors.textMuted, textAlign: 'center', padding: '14px 0 2px' }}>
            iOS Location Master v1.2.0
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
        <ErrorToast>
          <span>⚠ {locationError}</span>
          {getErrorSolution(locationError) && (
            <ErrorSolution>→ {getErrorSolution(locationError)}</ErrorSolution>
          )}
        </ErrorToast>
      )}

      {IS_TRIAL && trialExpired && (
        <TrialOverlay>
          <TrialModal>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⏰</div>
            <div style={{
              fontSize: 18, fontWeight: 700,
              color: theme.colors.textPrimary, marginBottom: 10,
            }}>
              {t.trialExpiredTitle}
            </div>
            <div style={{
              fontSize: 14, color: theme.colors.textSecondary,
              lineHeight: 1.7, marginBottom: 24,
            }}>
              {t.trialExpiredDesc}
            </div>
            <ActionBtn
              $primary
              style={{ width: '100%', marginBottom: 10 }}
              onClick={() => {
                // 換成你的 Gumroad 或購買頁連結
                window.open('https://your-purchase-link.com', '_blank')
              }}
            >
              {t.buyNow}
            </ActionBtn>
            <ActionBtn
              style={{ width: '100%' }}
              onClick={() => {
                setTrialExpired(false)
                setTrialSecsLeft(TRIAL_SECS)
              }}
            >
              {t.continueTrial}
            </ActionBtn>
          </TrialModal>
        </TrialOverlay>
      )}
    </>
  )
}
