// ─── 交通工具設定 ─────────────────────────────────────────────
export const TRANSPORT_MODES = [
  { key: 'walk', label: '🚶 步行', speed: 1.4,  speedKmh: 5  },
  { key: 'moto', label: '🛵 機車', speed: 8.33, speedKmh: 30 },
  { key: 'car',  label: '🚗 汽車', speed: 13.9, speedKmh: 50 },
]

export const SPEED_MODES = [
  { key: 'walk', label: '🚶 步行', multiplier: 0.00000003 },
  { key: 'moto', label: '🛵 機車', multiplier: 0.0000002  },
  { key: 'car',  label: '🚗 汽車', multiplier: 0.0000004  },
]

// ─── 基礎計算 ────────────────────────────────────────────────
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export function fmtDist(m) {
  return m >= 1000 ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`
}

export function fmtTime(sec) {
  if (sec < 60) return `${Math.round(sec)} 秒`
  if (sec < 3600) return `${Math.floor(sec/60)} 分 ${Math.round(sec%60)} 秒`
  return `${Math.floor(sec/3600)} 時 ${Math.floor((sec%3600)/60)} 分`
}

// ─── Catmull-Rom 曲線（讓路徑變自然曲線，不是直線） ──────────
function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  return {
    lat: 0.5 * (2*p1.lat + (-p0.lat+p2.lat)*t + (2*p0.lat-5*p1.lat+4*p2.lat-p3.lat)*t2 + (-p0.lat+3*p1.lat-3*p2.lat+p3.lat)*t3),
    lng: 0.5 * (2*p1.lng + (-p0.lng+p2.lng)*t + (2*p0.lng-5*p1.lng+4*p2.lng-p3.lng)*t2 + (-p0.lng+3*p1.lng-3*p2.lng+p3.lng)*t3),
  }
}

/**
 * 把一組路徑點展開成 Catmull-Rom 平滑曲線
 * samplesPerSegment: 每段取樣點數（越高越平滑，越佔記憶體）
 */
export function smoothPath(waypoints, samplesPerSegment = 20) {
  if (waypoints.length < 2) return [...waypoints]
  // 首尾各補一個點，讓起點和終點的切線自然
  const pts = [waypoints[0], ...waypoints, waypoints[waypoints.length - 1]]
  const result = []
  for (let i = 1; i < pts.length - 2; i++) {
    for (let j = 0; j < samplesPerSegment; j++) {
      result.push(catmullRomPoint(pts[i-1], pts[i], pts[i+1], pts[i+2], j / samplesPerSegment))
    }
  }
  result.push({ ...waypoints[waypoints.length - 1] })
  return result
}

/**
 * 建立弧長查找表：回傳每個平滑點的累積距離
 * 用於把「距離」轉換成「哪個座標點」
 */
export function buildArcTable(smoothPts) {
  const dists = [0]
  for (let i = 1; i < smoothPts.length; i++) {
    dists.push(dists[i-1] + haversine(
      smoothPts[i-1].lat, smoothPts[i-1].lng,
      smoothPts[i].lat,   smoothPts[i].lng
    ))
  }
  return dists
}

/**
 * 給定弧長距離，從查找表找出對應的座標（線性內插）
 */
export function arcLengthToCoord(smoothPts, arcTable, traveled) {
  const total = arcTable[arcTable.length - 1]
  const t = Math.min(traveled, total)
  let lo = 0, hi = arcTable.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (arcTable[mid] <= t) lo = mid; else hi = mid
  }
  const span = arcTable[hi] - arcTable[lo]
  const frac = span > 0 ? (t - arcTable[lo]) / span : 1
  const p0 = smoothPts[lo]
  const p1 = smoothPts[Math.min(hi, smoothPts.length - 1)]
  return {
    lat: p0.lat + (p1.lat - p0.lat) * frac,
    lng: p0.lng + (p1.lng - p0.lng) * frac,
    dirLat: p1.lat - p0.lat,
    dirLng: p1.lng - p0.lng,
  }
}

// ─── 相關性 GPS 漂移（模擬衛星訊號干擾，緩慢偏移而非獨立跳動） ──
/**
 * 回傳一個 tick() 函式，每次呼叫回傳當前的漂移偏移量
 * 偏移量用隨機遊走 + 均值回歸模型，最大約 ±0.3m
 */
export function createDriftModel() {
  let dLat = 0, dLng = 0, vLat = 0, vLng = 0
  return function tick() {
    vLat += (Math.random() - 0.5) * 1.2e-7
    vLng += (Math.random() - 0.5) * 1.2e-7
    const maxV = 2.5e-7
    vLat = Math.max(-maxV, Math.min(maxV, vLat))
    vLng = Math.max(-maxV, Math.min(maxV, vLng))
    // 均值回歸：讓漂移不要無限累積
    dLat = dLat * 0.87 + vLat
    dLng = dLng * 0.87 + vLng
    const maxD = 2.8e-6   // ≈ ±0.31m，真實 GPS 誤差範圍
    dLat = Math.max(-maxD, Math.min(maxD, dLat))
    dLng = Math.max(-maxD, Math.min(maxD, dLng))
    return { dLat, dLng }
  }
}

// ─── 垂直飄移（模擬人類走路不走正中央） ─────────────────────────
/**
 * 回傳一個 tick(dirLat, dirLng) 函式
 * 根據移動方向，在垂直方向緩慢左右飄移（最大 ±1.5m）
 * 速度快的交通工具飄移應設 0（靠近道路中線）
 */
export function createWanderModel() {
  let offset = 0, vel = 0
  return function tick(dirLat, dirLng) {
    vel += (Math.random() - 0.5) * 6e-8
    const maxV = 1.2e-7
    vel = Math.max(-maxV, Math.min(maxV, vel))
    // 均值回歸讓飄移不跑太遠
    offset = offset * 0.94 + vel
    const maxO = 1.4e-5   // ≈ ±1.56m 最大側偏
    offset = Math.max(-maxO, Math.min(maxO, offset))
    // 垂直方向 = 把移動方向旋轉 90°
    const len = Math.sqrt(dirLat**2 + dirLng**2) || 1
    return {
      dLat: (-dirLng / len) * offset,
      dLng: (dirLat  / len) * offset,
    }
  }
}
