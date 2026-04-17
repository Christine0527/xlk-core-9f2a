const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, exec } = require('child_process')
const http = require('http')
const net = require('net')

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

// ─── 啟動 root_bridge（iOS 17+ 需要管理員）────────────
async function ensureTunneld() {
  if (tunneldStarted) return { ok: true }

  const python3 = await findPython()
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'python', isWin ? 'root_bridge.exe' : 'root_bridge')
    : path.join(__dirname, '../python/root_bridge.py')

  // 殺掉舊的 bridge 程序
  await killOldBridge()
  await new Promise(r => setTimeout(r, 800))

  // 清除舊的 port 檔案
  try { fs.unlinkSync(BRIDGE_PORT_FILE) } catch {}

  return new Promise((resolve) => {
    if (isMac) {
      startBridgeMac(python3, scriptPath, resolve)
    } else {
      startBridgeWin(python3, scriptPath, resolve)
    }
  })
}

function killOldBridge() {
  return new Promise((resolve) => {
    if (isMac) {
      exec(`osascript -e 'do shell script "pkill -f root_bridge || true" with administrator privileges'`,
        () => resolve())
    } else {
      exec(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like \'*root_bridge*\'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
        () => resolve()
      )
    }
  })
}

function startBridgeMac(python3, scriptPath, resolve) {
  let cmd
  if (app.isPackaged) {
    // 打包模式：直接執行 PyInstaller 包好的 binary
    const tmpBin = '/tmp/root_bridge_bin'
    try { fs.unlinkSync(tmpBin) } catch {}
    fs.copyFileSync(scriptPath, tmpBin)
    fs.chmodSync(tmpBin, '755')
    cmd = `${tmpBin} > /tmp/root_bridge.log 2>&1 &`
  } else {
    // 開發模式：跑 Python 腳本
    try { fs.unlinkSync('/tmp/root_bridge.py') } catch {}
    fs.copyFileSync(scriptPath, '/tmp/root_bridge.py')
    cmd = `${python3} /tmp/root_bridge.py > /tmp/root_bridge.log 2>&1 &`
  }

  const osascriptCmd = `do shell script "${cmd}" with administrator privileges`

  exec(`osascript -e '${osascriptCmd}'`, (err) => {
    if (err) {
      resolve({ ok: false, error: '用戶取消授權或啟動失敗' })
      return
    }
    waitForBridgeReady(resolve)
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
function waitForPython(port, timeout = 15000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) resolve()
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Python server failed to start'))
        } else {
          setTimeout(check, 400)
        }
      })
    }
    setTimeout(check, 600)
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
    // 打包模式：使用 PyInstaller 打包的可執行檔（不需要用戶安裝 Python）
    const exeName = isWin ? 'server.exe' : 'server'
    spawnCmd = path.join(process.resourcesPath, 'python', exeName)
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
  await startPython()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    // macOS 用 hiddenInset（膠囊按鈕嵌入標題列），Windows 用預設框架
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

// ─── App 生命週期 ─────────────────────────────────────
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (pythonProcess) pythonProcess.kill('SIGTERM')
  if (!isMac) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
