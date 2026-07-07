// index.js — Electron main process: creates windows, detects the projector,
// starts servers, routes state changes to the output window.
// FIX APPLIED (see wargames/07-bugs.md): S1 — creating a window already
// fullscreen at a secondary display's coordinates is unreliable on some
// Electron/OS combos (it can land on the primary display). We now size the
// window to the target display's bounds first, then request fullscreen.
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { startServers } = require('./server');
const { createState } = require('./state');

let outputWin, controlWin, servers, state;

function pickProjectorDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const secondary = displays.find((d) => d.id !== primary.id);
  if (secondary) return secondary;
  // Dev/test convenience only (see blueprint §7.2): with no second monitor
  // plugged in, opt in to previewing the output on the primary display via
  // an env var, instead of hand-editing source before every test run.
  if (process.env.LUMEN_FORCE_PRIMARY_DISPLAY === '1') return primary;
  return null; // null = no projector plugged in yet
}

function createOutputWindow(display) {
  if (outputWin && !outputWin.isDestroyed()) outputWin.destroy();
  outputWin = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y,
    width: display.bounds.width, height: display.bounds.height,
    frame: false, fullscreen: false, backgroundColor: '#000000', show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  outputWin.loadFile(path.join(__dirname, '..', 'output', 'output.html'));
  outputWin.once('ready-to-show', () => {
    // S1 fix: pin bounds to the target display, THEN fullscreen, then show.
    outputWin.setBounds(display.bounds);
    outputWin.setFullScreen(true);
    outputWin.show();
  });
  outputWin.webContents.on('did-finish-load', pushState);
}

function pushState() {
  if (outputWin && !outputWin.isDestroyed())
    outputWin.webContents.send('state', state.snapshot());
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData');
  const mediaDir = path.join(dataDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  state = createState(dataDir);

  servers = startServers(state, mediaDir, (msg) => {
    if (msg.type === 'corner.move') {
      if (outputWin && !outputWin.isDestroyed())
        outputWin.webContents.send('corner', { ...msg, state: state.snapshot() });
    } else {
      pushState();
    }
  });

  // Control window on the PC's own screen: shows the pairing QR.
  controlWin = new BrowserWindow({
    width: 520, height: 640, resizable: false, title: 'Lumen',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  controlWin.loadFile(path.join(__dirname, '..', 'control', 'control.html'));
  const url = `http://${servers.lanIp}:8090`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 360, margin: 1 });
  controlWin.webContents.on('did-finish-load', () =>
    controlWin.webContents.send('pairing', { url, qrDataUrl }));

  // Projector detection + hot-plug
  const proj = pickProjectorDisplay();
  if (proj) createOutputWindow(proj);
  screen.on('display-added', () => {
    const d = pickProjectorDisplay();
    if (d) createOutputWindow(d);
  });
  screen.on('display-removed', () => {
    if (outputWin && !outputWin.isDestroyed()) outputWin.destroy();
    outputWin = null;
  });

  ipcMain.on('request-state', pushState);
});

app.on('window-all-closed', () => app.quit());
