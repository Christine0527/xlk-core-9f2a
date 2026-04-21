import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import styled, { keyframes, css } from 'styled-components'
import { theme } from '../../theme'
import { useLang } from '../../LangContext'
import { haversine, fmtDist, fmtTime, smoothPath, TRANSPORT_MODES } from '../../utils/gps'
import { fetchRoute } from '../../utils/routing'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})



const myLocationIcon = L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:36px;height:36px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(26,115,232,0.18);animation:pulse-ring 1.8s ease-out infinite;"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;background:#1A73E8;border:3px solid #fff;box-shadow:0 3px 10px rgba(26,115,232,0.6);"></div>
    </div>
    <style>@keyframes pulse-ring{0%{transform:scale(0.5);opacity:.8}100%{transform:scale(2);opacity:0}}</style>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
})

const dotIcon = L.divIcon({
  className: '',
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#FF5722;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.45)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const startIcon = L.divIcon({
  className: '',
  html: `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="background:#34A853;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.4);white-space:nowrap;">起點</div>
      <div style="width:3px;height:6px;background:#34A853;margin-top:-1px;"></div>
    </div>`,
  iconSize: [40, 30],
  iconAnchor: [20, 30],
})

const endIcon = L.divIcon({
  className: '',
  html: `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="background:#EA4335;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.4);white-space:nowrap;">終點</div>
      <div style="width:3px;height:6px;background:#EA4335;margin-top:-1px;"></div>
    </div>`,
  iconSize: [40, 30],
  iconAnchor: [20, 30],
})

function makeDistLabel(dist) {
  return L.divIcon({
    className: '',
    html: `<div style="background:rgba(255,255,255,0.92);border:1px solid #a8d5b2;border-radius:8px;padding:2px 7px;font-size:11px;font-weight:600;color:#2d7a47;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.15)">${fmtDist(dist)}</div>`,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  })
}

const pulseRing = keyframes`
  0%   { transform: scale(1);    opacity: 0.8; }
  70%  { transform: scale(1.55); opacity: 0.3; }
  100% { transform: scale(1.55); opacity: 0;   }
`

const pulseAnimation = css`
  &::before {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.75);
    animation: ${pulseRing} 1.4s ease-out infinite;
  }
  &::after {
    content: '';
    position: absolute;
    inset: -14px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.35);
    animation: ${pulseRing} 1.4s ease-out 0.35s infinite;
  }
  box-shadow: 0 0 0 4px rgba(255,255,255,0.6), 0 4px 16px rgba(0,0,0,0.18);
`

const LocateBtn = styled.button`
  position: absolute;
  bottom: 64px;
  right: 16px;
  z-index: 1000;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: #fff;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.2s;
  padding: 0;

  ${p => p.$pulse && pulseAnimation}
`

const Wrapper = styled.div`
  flex: 1;
  position: relative;
  border-radius: ${theme.radii.lg};
  overflow: hidden;
  border: 2px solid ${p => p.$routeMode ? theme.colors.accent2 : p.$loading ? theme.colors.primary : theme.colors.border};
  box-shadow: ${theme.shadows.card};
  transition: border-color ${theme.transitions.normal};

  .leaflet-container {
    width: 100%;
    height: 100%;
    font-family: ${theme.fonts.sans};
    cursor: crosshair;
  }
  .leaflet-control-attribution { display: none; }
  .leaflet-control-zoom {
    border: none !important;
    box-shadow: ${theme.shadows.card} !important;
  }
  .leaflet-control-zoom a {
    background: ${theme.colors.surface} !important;
    color: ${theme.colors.textPrimary} !important;
    border: none !important;
    font-size: 16px !important;
    width: 34px !important;
    height: 34px !important;
    line-height: 34px !important;
    font-weight: 400 !important;
    transition: background ${theme.transitions.fast} !important;
  }
  .leaflet-control-zoom a:hover { background: ${theme.colors.surfaceHover} !important; }
  .leaflet-control-zoom-in  { border-radius: ${theme.radii.sm} ${theme.radii.sm} 0 0 !important; }
  .leaflet-control-zoom-out { border-radius: 0 0 ${theme.radii.sm} ${theme.radii.sm} !important; }
`

const spin = keyframes`to { transform: rotate(360deg); }`

const CoordBadge = styled.div`
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: ${theme.colors.surface};
  border: 1.5px solid ${p => p.$active ? theme.colors.primary : theme.colors.border};
  border-radius: ${theme.radii.full};
  padding: 9px 22px;
  font-family: ${theme.fonts.mono};
  font-size: 12px;
  font-weight: 500;
  color: ${p => p.$active ? theme.colors.primary : theme.colors.textMuted};
  box-shadow: ${theme.shadows.card};
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all ${theme.transitions.normal};
  pointer-events: none;
  white-space: nowrap;
`

const SpinnerIcon = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid ${theme.colors.primary}33;
  border-top-color: ${theme.colors.primary};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
  flex-shrink: 0;
`

const TopBar = styled.div`
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const HintBadge = styled.div`
  background: ${p => p.$green ? '#e6f4ea' : theme.colors.surface};
  border: 1.5px solid ${p => p.$green ? '#a8d5b2' : theme.colors.border};
  border-radius: ${theme.radii.full};
  padding: 8px 20px;
  font-family: ${theme.fonts.sans};
  font-size: 12px;
  font-weight: 500;
  color: ${p => p.$green ? theme.colors.success : theme.colors.textSecondary};
  box-shadow: ${theme.shadows.soft};
  pointer-events: none;
  white-space: nowrap;
`

const TransportRow = styled.div`
  display: flex;
  gap: 6px;
  background: ${theme.colors.surface};
  border: 1.5px solid ${theme.colors.border};
  border-radius: ${theme.radii.full};
  padding: 4px 6px;
  box-shadow: ${theme.shadows.soft};
`

const TransportBtn = styled.button`
  padding: 5px 14px;
  border-radius: ${theme.radii.full};
  border: none;
  background: ${p => p.$active ? theme.colors.primary : 'transparent'};
  color: ${p => p.$active ? '#fff' : theme.colors.textSecondary};
  font-family: ${theme.fonts.sans};
  font-size: 12px;
  font-weight: ${p => p.$active ? 700 : 400};
  cursor: pointer;
  transition: all ${theme.transitions.fast};
  white-space: nowrap;
  &:hover { background: ${p => p.$active ? theme.colors.primary : theme.colors.surfaceHover}; }
`

const RouteSummary = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  background: ${theme.colors.surface};
  border: 1.5px solid #a8d5b2;
  border-radius: ${theme.radii.lg};
  padding: 8px 18px;
  box-shadow: ${theme.shadows.soft};
  font-family: ${theme.fonts.sans};
  font-size: 12px;
  pointer-events: none;
`

const SummaryItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
`

const SummaryVal = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: ${theme.colors.textPrimary};
`

const SummaryLbl = styled.span`
  font-size: 10px;
  font-weight: 500;
  color: ${theme.colors.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
`

const Divider = styled.div`
  width: 1px;
  height: 28px;
  background: ${theme.colors.border};
`

const MapBtn = styled.button`
  padding: 8px 18px;
  border-radius: ${theme.radii.full};
  border: none;
  background: ${p => p.$danger ? theme.colors.error : p.$green ? theme.colors.success : theme.colors.surface};
  color: ${p => (p.$danger || p.$green) ? '#fff' : theme.colors.textSecondary};
  font-family: ${theme.fonts.sans};
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: ${p => p.$danger ? '0 4px 14px rgba(234,67,53,0.4)' : p.$green ? '0 4px 14px rgba(52,168,83,0.4)' : theme.shadows.soft};
  transition: all ${theme.transitions.normal};
  white-space: nowrap;

  &:hover { transform: translateY(-1px); opacity: 0.9; }
  &:active { transform: translateY(0); }
  &:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
`

function ClickHandler({ onMapClick, onDrag }) {
  useMapEvents({
    click(e) { onMapClick(e.latlng.lat, e.latlng.lng) },
    dragstart() { onDrag() },
  })
  return null
}

function MapController({ coord, shouldFollow, flyTarget }) {
  const map = useMap()
  const prevCoord = useRef(null)

  useEffect(() => {
    if (!coord) return
    const isFirst = !prevCoord.current
    prevCoord.current = coord
    if (isFirst || shouldFollow) {
      map.flyTo([coord.lat, coord.lng], isFirst ? 16 : map.getZoom(), {
        animate: true, duration: isFirst ? 1.2 : 0.6
      })
    }
  }, [coord?.lat, coord?.lng])

  useEffect(() => {
    if (!flyTarget) return
    map.flyTo([flyTarget.lat, flyTarget.lng], 16, { animate: true, duration: 1.2 })
  }, [flyTarget?.lat, flyTarget?.lng])

  return null
}

export function Map({
  coord, isActive, onMapClick, onStop, loading,
  onStartRoute, routeMode, onToggleRouteMode, currentSpeedKmh,
  transport, onRouteUpdate,
}) {
  const { t } = useLang()
  const [waypoints, setWaypoints] = useState([])
  const [follow, setFollow] = useState(true)

  // ─── 地圖搜尋 ─────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [flyTarget, setFlyTarget] = useState(null)

  const handleSearch = useCallback(async (q) => {
    const query = q ?? searchQuery
    if (!query.trim()) { setSearchResults([]); return }
    setSearchLoading(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&accept-language=zh-TW,zh,en`
      )
      setSearchResults(await res.json())
    } catch { setSearchResults([]) }
    finally { setSearchLoading(false) }
  }, [searchQuery])

  const handleSelectResult = (result) => {
    setFlyTarget({ lat: parseFloat(result.lat), lng: parseFloat(result.lon) })
    setSearchResults([])
    setSearchQuery(result.display_name.split(',')[0])
  }

  // 行駛中的路線路徑（虛線覆蓋）
  const [activeRoutePath, setActiveRoutePath] = useState(null)

  // OSRM 路線規劃狀態
  const [routedPath, setRoutedPath]     = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError]     = useState(null)
  const routeDebounce = useRef(null)

  // 重置路線資料
  useEffect(() => {
    if (!routeMode) {
      setWaypoints([])
      setRoutedPath(null)
      setRouteError(null)
    }
  }, [routeMode])

  // 路線結束後清除虛線覆蓋
  useEffect(() => {
    if (currentSpeedKmh == null) setActiveRoutePath(null)
  }, [currentSpeedKmh])

  // 每次路徑點或交通工具改變，延遲 700ms 後自動規劃道路路線
  useEffect(() => {
    if (waypoints.length < 2) {
      setRoutedPath(null)
      setRouteError(null)
      return
    }
    clearTimeout(routeDebounce.current)
    setRouteLoading(true)
    setRouteError(null)
    routeDebounce.current = setTimeout(async () => {
      try {
        const path = await fetchRoute(waypoints, transport)
        setRoutedPath(path)
      } catch (e) {
        setRouteError(e.message)
        setRoutedPath(null)
      } finally {
        setRouteLoading(false)
      }
    }, 700)
    return () => clearTimeout(routeDebounce.current)
  }, [waypoints, transport])

  // 計算路線資訊，往上傳給 App（供側邊欄顯示）
  const transportMode = TRANSPORT_MODES.find(m => m.key === transport) ?? TRANSPORT_MODES[0]
  const segDists = waypoints.length >= 2
    ? waypoints.slice(1).map((p, i) => haversine(waypoints[i].lat, waypoints[i].lng, p.lat, p.lng))
    : []
  const routedDist = routedPath && routedPath.length >= 2
    ? routedPath.slice(1).reduce((sum, p, i) =>
        sum + haversine(routedPath[i].lat, routedPath[i].lng, p.lat, p.lng), 0)
    : segDists.reduce((a, b) => a + b, 0)
  const etaSec = routedDist / transportMode.speed

  useEffect(() => {
    onRouteUpdate?.({
      waypointCount: waypoints.length,
      routedDist,
      etaSec,
      routeLoading,
      routeError,
      hasPath: !!routedPath,
      onStart: waypoints.length >= 2 && !routeLoading
        ? () => {
            const path = routedPath ?? waypoints
            setActiveRoutePath(path)
            onStartRoute(path, transportMode.speed, { preRouted: !!routedPath })
            setWaypoints([])
            setRoutedPath(null)
            onToggleRouteMode()
          }
        : null,
    })
  }, [waypoints.length, routedDist, etaSec, routeLoading, routeError, routedPath])

  // 路徑曲線預覽
  const curvedPreview = !routedPath && waypoints.length >= 2
    ? smoothPath(waypoints, 14)
    : null

  const handleClick = (lat, lng) => {
    if (routeMode) {
      setWaypoints(prev => [...prev, { lat, lng }])
    } else {
      onMapClick(lat, lng)
    }
  }

  const handleStartRoute = () => {
    if (waypoints.length < 2) return
    // 優先用 OSRM 真實道路路線；若規劃失敗則 fallback 到 Catmull-Rom 曲線
    const path = routedPath ?? waypoints
    const isPreRouted = !!routedPath
    onStartRoute(path, transportMode.speed, { preRouted: isPreRouted })
    setWaypoints([])
    setRoutedPath(null)
    onToggleRouteMode()
  }

  return (
    <Wrapper $loading={loading} $routeMode={routeMode}>
      <MapContainer
        center={[25.0478, 121.5319]}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          url="https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          subdomains={['0', '1', '2', '3']}
          maxZoom={20}
          attribution="&copy; Google Maps"
        />
        <ClickHandler onMapClick={handleClick} onDrag={() => setFollow(false)} />
        <MapController coord={coord} shouldFollow={follow} flyTarget={flyTarget} />

        {coord && <Marker position={[coord.lat, coord.lng]} icon={myLocationIcon} />}

        {/* 控制點底線（灰色虛線） */}
        {routeMode && waypoints.length >= 2 && (
          <Polyline
            positions={waypoints.map(p => [p.lat, p.lng])}
            color={theme.colors.textMuted}
            weight={1}
            opacity={0.3}
            dashArray="4 6"
          />
        )}
        {/* OSRM 真實道路路線 */}
        {routeMode && routedPath && (
          <Polyline
            positions={routedPath.map(p => [p.lat, p.lng])}
            color={theme.colors.success}
            weight={4}
          />
        )}
        {/* Catmull-Rom 暫時預覽（OSRM 尚未回應時） */}
        {routeMode && curvedPreview && (
          <Polyline
            positions={curvedPreview.map(p => [p.lat, p.lng])}
            color={theme.colors.success}
            weight={3}
            opacity={0.5}
            dashArray="7 4"
          />
        )}

        {/* 行駛中虛線路徑 */}
        {!routeMode && activeRoutePath && activeRoutePath.length >= 2 && (
          <Polyline
            positions={activeRoutePath.map(p => [p.lat, p.lng])}
            color={theme.colors.primary}
            weight={4}
            opacity={0.45}
            dashArray="10 8"
          />
        )}

        {/* 路徑點 */}
        {routeMode && waypoints.map((p, i) => {
          const icon = i === 0 ? startIcon : i === waypoints.length - 1 ? endIcon : dotIcon
          return <Marker key={i} position={[p.lat, p.lng]} icon={icon} />
        })}

        {/* 每段距離 label（中間點） */}
        {routeMode && waypoints.length >= 2 && waypoints.slice(1).map((p, i) => {
          const midLat = (waypoints[i].lat + p.lat) / 2
          const midLng = (waypoints[i].lng + p.lng) / 2
          return (
            <Marker
              key={`dist-${i}`}
              position={[midLat, midLng]}
              icon={makeDistLabel(segDists[i])}
            />
          )
        })}
      </MapContainer>

      {/* 頂部提示（路徑模式時只顯示簡單提示） */}
      <TopBar>
        {routeMode ? (
          <HintBadge $green>
            {routeLoading ? t.routePlanningHint
              : routeError ? `⚠ ${routeError}`
              : routedPath ? t.routeReadyHint
              : t.addWaypointHint}
          </HintBadge>
        ) : !coord && !loading && !isActive ? (
          <HintBadge>{t.clickHint}</HintBadge>
        ) : null}
      </TopBar>

      <CoordBadge $active={isActive || loading}>
        {loading ? (
          <><SpinnerIcon />{t.setting}</>
        ) : coord ? (
          <>📍 {coord.lat.toFixed(6)}, {coord.lng.toFixed(6)}</>
        ) : (
          t.noCoord
        )}
      </CoordBadge>

      {/* 進行中顯示即時時速 */}
      {isActive && currentSpeedKmh != null && !routeMode && (
        <div style={{
          position: 'absolute', bottom: 64, left: 16, zIndex: 1000,
          background: theme.colors.surface,
          border: `1.5px solid ${theme.colors.primary}44`,
          borderRadius: theme.radii.full,
          padding: '8px 18px',
          fontFamily: theme.fonts.sans,
          fontSize: 13,
          fontWeight: 700,
          color: theme.colors.primary,
          boxShadow: theme.shadows.soft,
          pointerEvents: 'none',
        }}>
          🚀 {currentSpeedKmh.toFixed(1)} km/h
        </div>
      )}

      {/* 右上角搜尋列 */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="🔍 搜尋地點…"
            style={{
              width: 220, padding: '9px 14px',
              borderRadius: theme.radii.full,
              border: `1.5px solid ${theme.colors.border}`,
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(8px)',
              fontFamily: theme.fonts.sans,
              fontSize: 13, color: theme.colors.textPrimary,
              outline: 'none',
              boxShadow: theme.shadows.card,
            }}
            onFocus={e => e.target.style.borderColor = theme.colors.primary}
            onBlur={e => e.target.style.borderColor = theme.colors.border}
          />
          <button
            onClick={() => handleSearch()}
            disabled={searchLoading}
            style={{
              padding: '9px 16px',
              borderRadius: theme.radii.full,
              border: 'none',
              background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight})`,
              color: '#fff',
              fontFamily: theme.fonts.sans,
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              boxShadow: theme.shadows.button,
            }}
          >
            {searchLoading ? '…' : '搜'}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div style={{
            marginTop: 6,
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(8px)',
            border: `1.5px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            boxShadow: theme.shadows.pop,
            overflow: 'hidden',
            width: 290,
          }}>
            {searchResults.map((r, i) => (
              <button
                key={i}
                onClick={() => handleSelectResult(r)}
                style={{
                  display: 'block', width: '100%',
                  padding: '10px 14px', textAlign: 'left',
                  border: 'none',
                  borderBottom: i < searchResults.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                  background: 'transparent',
                  fontFamily: theme.fonts.sans, fontSize: 13,
                  color: theme.colors.textPrimary,
                  cursor: 'pointer', lineHeight: 1.4,
                }}
                onMouseEnter={e => e.currentTarget.style.background = theme.colors.surfaceHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ fontWeight: 600 }}>{r.display_name.split(',')[0]}</div>
                <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>
                  {r.display_name.split(',').slice(1, 3).join(',').trim()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {isActive && !routeMode && (
        <MapBtn $danger onClick={onStop} style={{ position: 'absolute', top: 64, right: 16, zIndex: 1000 }}>
          {t.stopBtn}
        </MapBtn>
      )}

      {coord && (
        <LocateBtn
          onClick={() => setFollow(true)}
          title="回到我的位置"
          $pulse={routeMode}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L4.5 20.5L12 17L19.5 20.5L12 2Z"
              fill={follow ? '#1A73E8' : '#9aa0a6'}
              stroke={follow ? '#1A73E8' : '#9aa0a6'}
              strokeWidth="0.5"
              strokeLinejoin="round"
            />
          </svg>
        </LocateBtn>
      )}
    </Wrapper>
  )
}
