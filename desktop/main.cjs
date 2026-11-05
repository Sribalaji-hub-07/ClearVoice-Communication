// Electron shell. The web app is unchanged: this process starts the same Express +
// Socket.IO server the repository runs on Render, then points a Chromium window at it,
// so the desktop build keeps Web Audio, AudioWorklet and WebRTC in a secure context.
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HEADLESS = process.env.CV_HEADLESS === '1';
const PREFERRED_PORT = Number(process.env.PORT || 3001);

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

// A second instance, or a `npm start` already running in a terminal, takes 3001.
async function pickPort() {
  for (let offset = 0; offset < 25; offset++) {
    const port = PREFERRED_PORT + offset;
    if (await portIsFree(port)) return port;
  }
  throw new Error(`no free port in ${PREFERRED_PORT}-${PREFERRED_PORT + 24}`);
}

async function startServer(port) {
  const appDir = app.getAppPath();
  process.env.PORT = String(port);
  process.env.STATIC_DIR = path.join(appDir, 'dist');
  await import(pathToFileURL(path.join(appDir, 'server', 'index.js')).href);
}

function readHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve(res.statusCode === 200 ? body : null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const body = await readHealth(port);
    if (body) return body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('the embedded signaling server never answered /health');
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 660,
    title: 'ClearVoice',
    backgroundColor: '#0a1120',
    autoHideMenuBar: true,
    webPreferences: {
      // The renderer is the built SPA over http://127.0.0.1; it gets no Node access.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Electron 45 keeps this on webContents; BrowserWindow no longer exposes it.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void win.loadURL(`http://127.0.0.1:${port}/`);
  return win;
}

app.whenReady()
  .then(async () => {
    // Microphone is the only permission the app asks for, and it is asked for when the
    // user presses Start processing - never on launch.
    const allow = (permission) => permission === 'media';
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allow(permission)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => allow(permission));

    const port = await pickPort();
    await startServer(port);
    const health = await waitForServer(port);

    if (HEADLESS) {
      console.log(`[clearvoice-desktop] embedded server healthy on ${port}: ${health}`);
      app.quit();
      return;
    }

    createWindow(port);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  })
  .catch((err) => {
    console.error('[clearvoice-desktop] startup failed:', err);
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
