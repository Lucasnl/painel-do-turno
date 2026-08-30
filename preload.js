const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  show: () => ipcRenderer.invoke("window:show"),
  hide: () => ipcRenderer.invoke("window:hide"),
  quit: () => ipcRenderer.invoke("app:quit"),
  toggleTop: () => ipcRenderer.invoke("window:toggle-top"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  openReport: (html) => ipcRenderer.invoke("report:open", html),
  getAutostart: () => ipcRenderer.invoke("autostart:get"),
  setAutostart: (on) => ipcRenderer.invoke("autostart:set", on)
});
