export const translations = {
  zh: {
    // DeviceStatus
    noDevice:       '請接上 USB 連接 iPhone',
    mountDDI:       '連接手機',
    mounting:       '連接中…',
    mountSuccess:   '✓ 連接成功',
    errorPrefix:    '⚠',

    // Sidebar
    statusLabel:    '連線狀態',
    statusActive:   '定位模擬中',
    statusIdle:     '未啟動',
    lat:            '緯度',
    lng:            '經度',
    joystickLabel:  '虛擬搖桿',
    joystickHint:   '先點地圖設定定位後啟用',
    actionsLabel:   '快速操作',
    gameModeLabel:  '🎮 遊戲模式',
    gameModeHint:   'GPS 漂移 + 自動步行速移動（1.4m/s）',
    gameModeOn:     '已啟用',
    gameModeOff:    '已關閉',
    reapply:        '🔄 重新套用定位',
    applying:       '設定中…',
    stopSim:        '⏹ 停止模擬',

    // Map
    clickHint:      '點擊地圖即可傳送定位 📍',
    setting:        '定位設定中，請稍候…',
    noCoord:        '點擊地圖設定定位',
    stopBtn:        '⏹ 停止模擬',

    // Toast
    loadingToast:   '正在設定定位，請稍候（約 10–15 秒）…',

    // Route Mode — idle card
    routeModeTitle:    '路徑模式',
    routeModeDesc:     '在地圖點選路徑點，自動規劃沿著真實道路行走的路線，支援步行、機車、汽車速度模擬。',
    startPlanRoute:    '開始規劃路線 →',

    // Route Mode — active panel
    routeModeCardLabel:'🗺 路徑模式',
    routePlanning:     '⏳ 規劃道路路線中…',
    routeReady:        '✓ 已規劃道路路線',
    waypointAdded:     '📍 已加入 {n} 個點，再點地圖繼續',
    waypointHint:      '點地圖開始加入路徑點',
    distanceLabel:     '距離',
    timeLabel:         '時間',
    speedLabel:        '速度',
    startDrive:        '▶ 開始行駛',
    cancelRouteMode:   '✕ 取消路徑模式',

    // Driving panel
    drivingLabel:      '🚦 行駛中',
    currentSpeedLabel: '即時速度',
    remainDistLabel:   '剩餘距離',
    remainTimeLabel:   '剩餘時間',
    plannedSpeedLabel: '計畫速度',
    cancelRoute:       '⏹ 取消路線',

    // Map route hints
    routePlanningHint: '⏳ 規劃路線中…',
    routeReadyHint:    '🛣 路線已規劃，點地圖繼續加點',
    addWaypointHint:   '🗺 點地圖加入路徑點',

    // Lang toggle
    langToggle:     'EN',
  },
  en: {
    noDevice:       'Connect iPhone via USB',
    mountDDI:       'Connect Phone',
    mounting:       'Connecting…',
    mountSuccess:   '✓ Connected',
    errorPrefix:    '⚠',

    statusLabel:    'Status',
    statusActive:   'Spoofing Active',
    statusIdle:     'Inactive',
    lat:            'Lat',
    lng:            'Lng',
    joystickLabel:  'Joystick',
    joystickHint:   'Set a location first to enable',
    actionsLabel:   'Actions',
    gameModeLabel:  '🎮 Game Mode',
    gameModeHint:   'GPS jitter + smooth walk at 1.4m/s',
    gameModeOn:     'ON',
    gameModeOff:    'OFF',
    reapply:        '🔄 Re-apply Location',
    applying:       'Applying…',
    stopSim:        '⏹ Stop Spoof',

    clickHint:      'Click map to spoof location 📍',
    setting:        'Setting location, please wait…',
    noCoord:        'Click map to set location',
    stopBtn:        '⏹ Stop Spoof',

    loadingToast:   'Setting location, please wait (~10–15 sec)…',

    // Route Mode — idle card
    routeModeTitle:    'Route Mode',
    routeModeDesc:     'Click waypoints on the map to auto-plan a road route. Supports walk, scooter, and car speed simulation.',
    startPlanRoute:    'Plan a Route →',

    // Route Mode — active panel
    routeModeCardLabel:'🗺 Route Mode',
    routePlanning:     '⏳ Planning route…',
    routeReady:        '✓ Route planned',
    waypointAdded:     '📍 {n} point(s) added, click map to continue',
    waypointHint:      'Click map to add waypoints',
    distanceLabel:     'Distance',
    timeLabel:         'Time',
    speedLabel:        'Speed',
    startDrive:        '▶ Start Driving',
    cancelRouteMode:   '✕ Cancel Route Mode',

    // Driving panel
    drivingLabel:      '🚦 Driving',
    currentSpeedLabel: 'Current Speed',
    remainDistLabel:   'Remaining',
    remainTimeLabel:   'ETA',
    plannedSpeedLabel: 'Planned Speed',
    cancelRoute:       '⏹ Stop Route',

    // Map route hints
    routePlanningHint: '⏳ Planning route…',
    routeReadyHint:    '🛣 Route planned, click to add more',
    addWaypointHint:   '🗺 Click map to add waypoints',

    langToggle:     '中',
  },
}
