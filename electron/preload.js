const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getPythonPort: () => ipcRenderer.invoke('python:port'),
  listDevices: () => ipcRenderer.invoke('device:list'),
  getDeviceStatus: (udid) => ipcRenderer.invoke('device:status', udid),
  mountDDI: (udid) => ipcRenderer.invoke('device:mount', udid),
  startTunneld: () => ipcRenderer.invoke('tunneld:start'),
  setLocation: (udid, lat, lng, jitter) => ipcRenderer.invoke('location:set', { udid, lat, lng, jitter }),
  stopLocation: (udid) => ipcRenderer.invoke('location:stop', udid),
  startRoute: (udid, waypoints, speed) => ipcRenderer.invoke('location:route', { udid, waypoints, speed }),
})
