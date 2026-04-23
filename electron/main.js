const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, exec } = require('child_process')
const http = require('http')
const net = require('net')
const { autoUpdater } = require('electron-updater')

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

// Bridge port 檔案路徑（與 Python 端保持一致）
const BRIDGE_PORT_FILE = isWin
  ? path.join(process.env.ALLUSERSPROFILE || 'C:\\ProgramData', 'ios-location-master.port')
  : '/tmp/ios-location-master.port'

let mainWindow
let pythonProcess
let pythonPort
let tunneldStarted = false

const SUDOERS_FILE = '/etc/sudoers.d/ios-location-master'

// ─── 找 Python 執行檔 ─────────────────────────────────
async function findPython() {
  const candidates = isWin
    ? ['python', 'py', 'python3']
    : ['python3', '/opt/anaconda3/bin/python3', '/usr/local/bin/python3']

  for (const p of candidates) {
    const ok = await new Promise((res) => exec(`"${p}" --version`, (e) => res(!e)))
    if (ok) return p
  }
  return isWin ? 'python' : 'python3'
}

// ─── 一次性設定 sudoers（之後永不需要再輸密碼）──────────
async function ensurePrivilegesSetup() {
  if (!isMac) return
  try { fs.accessSync(SUDOERS_FILE, fs.constants.F_OK); return } catch {}

  const python3 = await findPython()
  // 先把內容寫到 /tmp，再用 osascript 搬到 /etc/sudoers.d（避免引號衝突）
  const tmpFile = '/tmp/ios-location-master-sudoers'
  const content = [
    `%admin ALL=(root) NOPASSWD: /tmp/root_bridge_dir/root_bridge`,
    `%admin ALL=(root) NOPASSWD: ${python3} /tmp/root_bridge.py`,
    `%admin ALL=(root) NOPASSWD: /usr/bin/pkill`,
    '',
  ].join('\n')
  fs.writeFileSync(tmpFile, content, { mode: 0o644 })

  const cmd = `cp ${tmpFile} ${SUDOERS_FILE} && chmod 440 ${SUDOERS_FILE}`
  await new Promise((resolve) => {
    exec(`osascript -e 'do shell script "${cmd}" with administrator privileges'`, (err) => {
      if (err) console.warn('[Privileges] one-time setup failed:', err.message)
      try { fs.unlinkSync(tmpFile) } catch {}
      resolve()
    })
  })
}

// ─── 啟動 root_bridge（iOS 17+ 需要管理員）────────────
async function ensureTunneld() {
  if (tunneldStarted) return { ok: true }

  const python3 = await findPython()
  const scriptPath = app.isPackaged
    ? isWin
      ? path.join(process.resourcesPath, 'python', 'root_bridge.exe')
      : path.join(process.resourcesPath, 'python', 'root_bridge')  // onedir: directory
    : path.join(__dirname, '../python/root_bridge.py')

  // 清除舊的 port 檔案
  try { fs.unlinkSync(BRIDGE_PORT_FILE) } catch {}

  return new Promise((resolve) => {
    if (isMac) {
      // Mac: kill + start 合併成一個 osascript 呼叫，只彈一次密碼
      startBridgeMac(python3, scriptPath, resolve)
    } else {
      killOldBridge().then(() => {
        setTimeout(() => startBridgeWin(python3, scriptPath, resolve), 800)
      })
    }
  })
}

function killOldBridge() {
  return new Promise((resolve) => {
    if (isMac) {
      exec(`sudo -n /usr/bin/pkill -f root_bridge 2>/dev/null || true`, () => resolve())
    } else {
      exec(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like \'*root_bridge*\'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
        () => resolve()
      )
    }
  })
}

function startBridgeMac(python3, scriptPath, resolve) {
  // scriptPath: packaged = root_bridge/ 目錄 (onedir), dev = root_bridge.py 檔案
  const tmpDir = '/tmp/root_bridge_dir'
  const tmpBin = `${tmpDir}/root_bridge`

  if (app.isPackaged) {
    // 複製整個 onedir 目錄到 /tmp，讓 sudo 有固定路徑可執行
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    fs.cpSync(scriptPath, tmpDir, { recursive: true })
    fs.chmodSync(tmpBin, '755')
  } else {
    try { fs.unlinkSync('/tmp/root_bridge.py') } catch {}
    fs.copyFileSync(scriptPath, '/tmp/root_bridge.py')
  }

  const sudoKill  = `sudo -n /usr/bin/pkill -f root_bridge 2>/dev/null || true`
  const sudoStart = app.isPackaged
    ? `sudo -n ${tmpBin} > /tmp/root_bridge.log 2>&1 &`
    : `sudo -n ${python3} /tmp/root_bridge.py > /tmp/root_bridge.log 2>&1 &`

  // 先探測 sudo 是否可無密碼執行
  exec('sudo -n /usr/bin/true 2>/dev/null', (probeErr) => {
    if (!probeErr) {
      // sudoers 已設定：無密碼啟動
      exec(sudoKill, () => {
        setTimeout(() => {
          exec(sudoStart, (err) => {
            if (err) { resolve({ ok: false, error: `Bridge 啟動失敗: ${err.message}` }); return }
            waitForBridgeReady(resolve)
          })
        }, 800)
      })
    } else {
      // 退回 osascript（會彈一次密碼，並順便補設 sudoers）
      const rawStart = app.isPackaged
        ? `${tmpBin} > /tmp/root_bridge.log 2>&1 &`
        : `${python3} /tmp/root_bridge.py > /tmp/root_bridge.log 2>&1 &`
      const combined = `pkill -f root_bridge || true; sleep 1; ${rawStart}`
      exec(`osascript -e 'do shell script "${combined}" with administrator privileges'`, (err) => {
        if (err) { resolve({ ok: false, error: '啟動失敗' }); return }
        ensurePrivilegesSetup().catch(() => {})
        waitForBridgeReady(resolve)
      })
    }
  })
}

function startBridgeWin(python3, scriptPath, resolve) {
  // 打包模式直接執行 .exe，開發模式用 Python 跑腳本
  const filePath = app.isPackaged ? scriptPath : python3
  const args = app.isPackaged ? '' : `'${scriptPath}'`
  const psCmd = args
    ? `Start-Process -FilePath '${filePath}' -ArgumentList ${args} -Verb RunAs -WindowStyle Hidden`
    : `Start-Process -FilePath '${filePath}' -Verb RunAs -WindowStyle Hidden`
  const ps = spawn('powershell', ['-NoProfile', '-Command', psCmd])

  ps.on('close', (code) => {
    if (code !== 0) {
      resolve({ ok: false, error: '用戶取消 UAC 授權或啟動失敗' })
      return
    }
    waitForBridgeReady(resolve)
  })
}

function waitForBridgeReady(resolve) {
  let attempts = 0
  const check = setInterval(() => {
    attempts++
    try {
      const portStr = fs.readFileSync(BRIDGE_PORT_FILE, 'utf8').trim()
      const port = parseInt(portStr)
      if (port > 0) {
        const s = net.createConnection({ host: '127.0.0.1', port })
        s.on('connect', () => {
          s.destroy()
          clearInterval(check)
          tunneldStarted = true
          resolve({ ok: true })
        })
        s.on('error', () => s.destroy())
      }
    } catch {}

    if (attempts > 40) {
      clearInterval(check)
      const logHint = isMac ? '請查看 /tmp/root_bridge.log' : '請查看 %TEMP%\\root_bridge.log'
      resolve({ ok: false, error: `Bridge 啟動逾時，${logHint}` })
    }
  }, 500)
}

// ─── 找空閒 port ─────────────────────────────────────
function findFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// ─── 等待 Python 服務啟動 ─────────────────────────────
function waitForPython(port, timeout = 40000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) resolve()
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Python server failed to start within 40s'))
        } else {
          setTimeout(check, 400)
        }
      })
    }
    setTimeout(check, 800)
  })
}

// ─── 呼叫 Python RPC ──────────────────────────────────
function callPython(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params })
    const options = {
      hostname: '127.0.0.1',
      port: pythonPort,
      path: '/rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (result.error) reject(new Error(result.error))
          else resolve(result.data)
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── 啟動 Python 後端 ─────────────────────────────────
async function startPython() {
  pythonPort = await findFreePort()

  let spawnCmd, spawnArgs
  if (app.isPackaged) {
    // 打包模式：Windows onefile (.exe)，Mac onedir (子目錄內的執行檔)
    spawnCmd = isWin
      ? path.join(process.resourcesPath, 'python', 'server.exe')
      : path.join(process.resourcesPath, 'python', 'server', 'server')
    spawnArgs = ['--port', pythonPort]
  } else {
    // 開發模式：直接跑 Python 腳本
    spawnCmd = await findPython()
    spawnArgs = [path.join(__dirname, '../python/server.py'), '--port', pythonPort]
  }

  pythonProcess = spawn(spawnCmd, spawnArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  pythonProcess.stdout.on('data', (d) => console.log('[Python]', d.toString().trim()))
  pythonProcess.stderr.on('data', (d) => console.error('[Python ERR]', d.toString().trim()))
  pythonProcess.on('exit', (code) => console.log(`[Python] exited ${code}`))

  await waitForPython(pythonPort)
  console.log(`[Python] ready on port ${pythonPort}`)
}

// ─── 建立視窗 ─────────────────────────────────────────
async function createWindow() {
  // 先建視窗，讓用戶看到 app 在啟動，不要等 Python 才開視窗
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#F5ECD7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  setupAutoUpdater()

  // 背景初始化（不阻塞視窗顯示）
  try {
    if (isMac) await ensurePrivilegesSetup()
    await startPython()
    console.log('[App] Python ready, notifying renderer')
    mainWindow?.webContents.send('python:ready', pythonPort)
  } catch (err) {
    console.error('[App] Startup error:', err.message)
    dialog.showErrorBox(
      '啟動失敗',
      `後端服務未能啟動，請重新開啟程式。\n\n詳細錯誤：${err.message}`
    )
  }
}

// ─── IPC 路由 ─────────────────────────────────────────
ipcMain.handle('python:port', () => pythonPort)
ipcMain.handle('device:list', () => callPython('device.list'))
ipcMain.handle('device:status', (_, udid) => callPython('device.status', { udid }))
ipcMain.handle('device:mount', (_, udid) => callPython('device.mount', { udid }))
ipcMain.handle('tunneld:start', () => ensureTunneld())
ipcMain.handle('location:set', (_, { udid, lat, lng, jitter }) => callPython('location.set', { udid, lat, lng, jitter: !!jitter }))
ipcMain.handle('location:stop', (_, udid) => callPython('location.stop', { udid }))
ipcMain.handle('location:route', (_, { udid, waypoints, speed }) =>
  callPython('location.route', { udid, waypoints, speed })
)

// ─── 自動更新 ─────────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '發現新版本',
      message: `新版本 ${info.version} 已發布！`,
      detail: '是否現在下載並更新？下載完成後重新啟動即可完成安裝。',
      buttons: ['立即更新', '稍後再說'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate()
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已下載完成',
      message: '新版本已下載完成',
      detail: '點擊「立即重啟」完成安裝，或下次啟動時自動安裝。',
      buttons: ['立即重啟', '下次再說'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Already up to date.')
  })

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message)
  })

  // app 啟動 3 秒後靜默檢查
  setTimeout(() => autoUpdater.checkForUpdates(), 3000)
}

// ─── App 生命週期 ─────────────────────────────────────
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM')
    pythonProcess = null
    pythonPort = null
  }
  if (!isMac) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
