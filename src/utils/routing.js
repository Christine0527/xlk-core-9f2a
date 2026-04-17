/**
 * 使用 OSRM 公共路線規劃 API（OpenStreetMap 道路資料）
 * 免費、不需要 API Key，支援台灣
 *
 * 步行：routing.openstreetmap.de (foot profile)
 * 機車：routing.openstreetmap.de (bike profile)
 * 汽車：router.project-osrm.org  (driving profile)
 */

const ENDPOINTS = {
  walk:    'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  moto:    'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
  car:     'https://router.project-osrm.org/route/v1/driving',
}

/**
 * 向 OSRM 請求路線
 * @param {Array<{lat, lng}>} waypoints  - 使用者點的路徑點
 * @param {'walk'|'moto'|'car'} mode     - 交通工具
 * @returns {Promise<Array<{lat, lng}>>} - 沿著真實道路的座標序列
 */
export async function fetchRoute(waypoints, mode = 'car') {
  if (waypoints.length < 2) throw new Error('至少需要 2 個路徑點')

  const base = ENDPOINTS[mode] ?? ENDPOINTS.car
  // OSRM 格式：lng,lat;lng,lat;...
  const coords = waypoints.map(p => `${p.lng},${p.lat}`).join(';')
  const url = `${base}/${coords}?overview=full&geometries=geojson`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)  // 10 秒 timeout

  let res
  try {
    res = await fetch(url, { signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    if (e.name === 'AbortError') throw new Error('路線規劃逾時，請稍後再試')
    throw new Error('無法連線至路線規劃服務')
  }
  clearTimeout(timer)

  if (!res.ok) throw new Error(`路線規劃失敗（HTTP ${res.status}）`)

  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error('找不到可行路線，請嘗試調整路徑點')
  }

  // GeoJSON coordinates 是 [lng, lat]，轉成 {lat, lng}
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
}
