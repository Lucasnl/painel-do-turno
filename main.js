const { app, BrowserWindow, ipcMain, Tray, Menu, shell, Notification, screen, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

app.setAppUserModelId("br.hostel.trellofloat"); // necessário para notificações no Windows
app.disableHardwareAcceleration(); // evita tela branca em PCs com GPU/driver problemáticos

// Instância única: segundo clique no .exe só traz a janela existente para frente
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}

let win, tray, pendingUpdate = false;
const boundsFile = () => path.join(app.getPath("userData"), "bounds.json");
const configFile = () => path.join(app.getPath("userData"), "config.json");

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), "utf8")); } catch { return {}; }
}
function writeConfig(obj) {
  try { fs.writeFileSync(configFile(), JSON.stringify(obj, null, 2)); return true; } catch { return false; }
}

function loadBounds() {
  try { return JSON.parse(fs.readFileSync(boundsFile(), "utf8")); } catch { return {}; }
}
function saveBounds() {
  if (!win || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
  try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds())); } catch {}
}

// Sanea bounds salvos: nunca abrir ocupando a tela inteira nem fora dos monitores
function safeBounds() {
  const b = loadBounds();
  const wa = screen.getPrimaryDisplay().workAreaSize;
  let width = b.width || 380, height = b.height || 620;
  if (width > wa.width * 0.9 || height > wa.height * 0.95) { width = 380; height = 620; }
  width = Math.max(320, Math.min(width, wa.width));
  height = Math.max(420, Math.min(height, wa.height));
  let { x, y } = b;
  if (typeof x === "number" && typeof y === "number") {
    const visible = screen.getAllDisplays().some(d =>
      x + 80 > d.workArea.x && x < d.workArea.x + d.workArea.width - 80 &&
      y >= d.workArea.y - 10 && y < d.workArea.y + d.workArea.height - 60);
    if (!visible) { x = undefined; y = undefined; }
  } else { x = undefined; y = undefined; }
  return { width, height, x, y };
}

function createWindow() {
  const b = safeBounds();
  win = new BrowserWindow({
    width: b.width, height: b.height,
    x: b.x, y: b.y,
    minWidth: 320, minHeight: 420,
    frame: false,
    transparent: false, // janela transparente não redimensiona no Windows
    backgroundColor: "#f7f8fa",
    resizable: true,
    maximizable: false, // sem borda não tem botão de restaurar; maximizada "prende"
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile("index.html");
  win.setMenuBarVisibility(false);

  // Links externos abrem no navegador, nunca em outra janela do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("move", saveBounds);
  win.on("resize", saveBounds);
  win.on("maximize", () => win.unmaximize()); // Win+Seta/duplo clique não prendem mais
  // Renderer morreu (raro) → recarrega em vez de ficar branco
  win.webContents.on("render-process-gone", () => win?.webContents.reload());
  win.webContents.on("did-fail-load", () => setTimeout(() => win?.loadFile("index.html"), 1000));
  win.on("closed", () => { win = null; });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function buildTray() {
  try {
    let img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  } catch (e) { tray = null; return; }
  tray.setToolTip("Painel do Turno");
  const menu = Menu.buildFromTemplate([
    { label: "Mostrar painel", click: showWindow },
    { label: "Sempre no topo", type: "checkbox", checked: true,
      click: (item) => win?.setAlwaysOnTop(item.checked) },
    { label: "Iniciar com o Windows", type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: "separator" },
    { label: "Sair", click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", showWindow);
}

app.whenReady().then(() => {
  createWindow();
  buildTray();
  setupAutoUpdate();
});

// ---------- auto-update (GitHub Releases) ----------
function setupAutoUpdate() {
  if (!app.isPackaged) return; // em desenvolvimento não tem release
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", () => {}); // sem internet/GitHub fora: segue a vida
  autoUpdater.on("update-downloaded", () => {
    pendingUpdate = true; // renderer mostra o botão "Atualizar agora"; instala só no clique
    if (Notification.isSupported())
      new Notification({ title: "Painel do Turno", body: "Nova atualização pronta — clique em Atualizar agora no painel." }).show();
    win?.webContents.send("update-ready");
  });
  ipcMain.handle("update:install", () => { app.isQuitting = true; autoUpdater.quitAndInstall(true, true); });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);                 // 15 s depois de abrir
  setInterval(check, 4 * 60 * 60 * 1000);   // e a cada 4 h
}

ipcMain.handle("window:minimize", () => win?.minimize());
ipcMain.handle("window:show", () => showWindow());
// Sem bandeja funcionando, esconder deixaria o app "imortal": aí o × fecha de verdade
ipcMain.handle("window:hide", () => { if (tray) win?.hide(); else app.quit(); });
ipcMain.handle("app:quit", () => app.quit());
ipcMain.handle("window:toggle-top", () => {
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next);
  return next;
});
ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.handle("notify", (_e, { title, body }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: path.join(__dirname, "icon.png") });
    n.on("click", showWindow);
    n.show();
  }
});
ipcMain.handle("config:get", () => readConfig());
ipcMain.handle("config:set", (_e, patch) => {
  const cur = readConfig();
  for (const [k, v] of Object.entries(patch || {})) if (typeof k === "string") cur[k] = v;
  return writeConfig(cur);
});
ipcMain.handle("report:open", (_e, html) => {
  const f = path.join(app.getPath("userData"), "relatorio.html");
  fs.writeFileSync(f, String(html), "utf8");
  return shell.openPath(f);
});
ipcMain.handle("app:info", () => {
  let releasedAt = "";
  try { releasedAt = require("./package.json").releasedAt || ""; } catch {}
  return { version: app.getVersion(), releasedAt, updateReady: pendingUpdate };
});
ipcMain.handle("autostart:get", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("autostart:set", (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); return !!on; });

app.on("window-all-closed", () => { /* fica na bandeja */ });
