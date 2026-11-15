'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const { app, BrowserWindow, session, shell, utilityProcess, screen, ipcMain, powerSaveBlocker, nativeImage, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

app.setName('MacStream');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024));
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check');

const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWinState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch (e) { return null; } }
function saveWinState(win) {
  try {
    const st = { bounds: win.getNormalBounds(), max: win.isMaximized(), zoom: win.webContents.getZoomFactor() };
    fs.writeFileSync(STATE_FILE(), JSON.stringify(st));
  } catch (e) {}
}
function boundsVisible(b) {
  return screen.getAllDisplays().some(d => { const a = d.workArea; return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y < a.y + a.height - 80 && b.y + b.height > a.y + 40; });
}

let awakeId = null;
ipcMain.on('keep-awake', (_e, on) => {
  if (on && awakeId === null) awakeId = powerSaveBlocker.start('prevent-display-sleep');
  else if (!on && awakeId !== null) { try { powerSaveBlocker.stop(awakeId); } catch (x) {} awakeId = null; }
});
ipcMain.handle('cache-size', () => session.defaultSession.getCacheSize().catch(() => 0));
ipcMain.handle('cache-clear', () => session.defaultSession.clearCache().then(() => true).catch(() => false));

const SECRET_PREFIX = 'enc:v1:';
ipcMain.on('secret-encrypt', (e, plain) => {
  try {
    const str = typeof plain === 'string' ? plain : '';
    if (!str || str.startsWith(SECRET_PREFIX)) { e.returnValue = str; return; }
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      e.returnValue = SECRET_PREFIX + safeStorage.encryptString(str).toString('base64');
      return;
    }
  } catch (err) {}
  e.returnValue = typeof plain === 'string' ? plain : '';
});
ipcMain.on('secret-decrypt', (e, payload) => {
  try {
    const str = typeof payload === 'string' ? payload : '';
    if (!str) { e.returnValue = ''; return; }
    if (!str.startsWith(SECRET_PREFIX)) { e.returnValue = str; return; }
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(str.slice(SECRET_PREFIX.length), 'base64');
      e.returnValue = safeStorage.decryptString(buf);
      return;
    }
    e.returnValue = '';
    return;
  } catch (err) {
    e.returnValue = '';
  }
});

let engine = null;
let isQuitting = false;

function resolveFfmpeg() {
  try {
    let p = require('ffmpeg-static');
    if (p && p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
    return p;
  } catch (e) {
    return null;
  }
}

// Usa a pilha de rede Chromium nativa do Electron (net.fetch) para obter o .torrent sem bloqueios TLS/Cloudflare nem CORS
const netFetchedHashes = new Map();
async function fetchTorrentViaChromiumNet(infoHash) {
  if (!infoHash || !/^[a-f0-9]{40}$/i.test(infoHash) || !net || typeof net.fetch !== 'function') return null;
  const h = infoHash.toLowerCase();
  if (netFetchedHashes.has(h)) return netFetchedHashes.get(h);
  const H = h.toUpperCase();
  const urls = [
    `https://itorrents.org/torrent/${H}.torrent`,
    `https://watercache.nanobytes.org/get/${h}`,
    `https://torrage.info/torrent.php?h=${H}`,
    `https://btcache.me/torrent/${H}`
  ];
  const prom = new Promise((resolve) => {
    let settled = false;
    let pending = urls.length;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 4500);
    urls.forEach(async (u) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = await net.fetch(u, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': '*/*'
          }
        });
        clearTimeout(t);
        if (r && r.ok) {
          let buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            try { buf = zlib.gunzipSync(buf, { maxOutputLength: 10 * 1024 * 1024 }); } catch (e) {}
          }
          if (buf.length > 40 && buf[0] === 0x64 && buf.includes(Buffer.from('4:infod'))) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              return resolve(buf);
            }
          }
        }
      } catch (e) {}
      pending--;
      if (pending <= 0 && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    });
  }).then((buf) => {
    if (!buf) netFetchedHashes.delete(h);
    return buf;
  });
  netFetchedHashes.set(h, prom);
  return prom;
}

function triggerNetTorrentInject(hash) {
  if (!hash || !/^[a-f0-9]{40}$/i.test(hash)) return;
  fetchTorrentViaChromiumNet(hash).then((buf) => {
    if (buf && engine) {
      try { engine.postMessage({ type: 'torrent-buf', hash: hash.toLowerCase(), b64: buf.toString('base64') }); } catch (e) {}
    }
  }).catch(() => {});
}

function openSafeExternal(rawUrl) {
  if (typeof rawUrl !== 'string' || /[\x00-\x1f\x7f]/.test(rawUrl)) return;
  try {
    const u = new URL(rawUrl);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || /^127\.|^0\.|^169\.254\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return;
    shell.openExternal(u.toString());
  } catch (e) {}
}

function createWindow() {
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const saved = loadWinState();
  const useSaved = saved && saved.bounds && boundsVisible(saved.bounds);
  const b0 = useSaved ? saved.bounds : { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  const win = new BrowserWindow({
    x: b0.x, y: b0.y, width: b0.width, height: b0.height,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#070a12',
    title: 'MacStream',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try { win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch (e) {}

  win.webContents.on('did-finish-load', () => {
    // Escala 1.0 nativa Retina para MacBook Air 13" (evita cartões e fontes artificialmente ampliados)
    win.webContents.setZoomFactor(1.0);
    win.webContents.insertCSS(`
      [title="Controlos de Janela macOS"] { visibility: hidden; }
      header { -webkit-app-region: drag; }
      header button, header button *, header input, header select, header kbd, header a, #iptvSignalPopover, #iptvSignalPopover *,
      #searchSuggest, #searchSuggest *,
      #playerEpisodesPanel, #playerEpisodesPanel *,
      #playerBottomHud, #playerBottomHud *,
      #upNextEpisodeCard, #upNextEpisodeCard *,
      #detailModal, #detailModal * { -webkit-app-region: no-drag !important; }
    `);
  });

  const appIndexPath = path.join(__dirname, 'renderer', 'index.html');
  const appIndexUrl = pathToFileURL(appIndexPath).href;

  win.webContents.on('will-navigate', (e, url) => {
    if (url !== appIndexUrl && !url.startsWith(appIndexUrl + '#') && !url.startsWith(appIndexUrl + '?')) {
      e.preventDefault();
      openSafeExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: 'deny' };
  });

  if (useSaved && saved.max) win.maximize();
  win.on('close', () => saveWinState(win));
  win.loadFile(appIndexPath);
}

app.whenReady().then(() => {
  try {
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: 'automatic',
      secureDnsServers: ['https://dns.quad9.net/dns-query', 'https://cloudflare-dns.com/dns-query']
    });
  } catch (e) {}
  const engineToken = crypto.randomBytes(16).toString('hex');
  const episodeCacheDir = path.join(app.getPath('userData'), 'episode-cache');
  try { fs.mkdirSync(episodeCacheDir, { recursive: true }); } catch (e) {}

  ipcMain.on('engine-url', (e) => { e.returnValue = `http://127.0.0.1:11471/${engineToken}`; });
  ipcMain.on('app-version', (e) => { e.returnValue = app.getVersion(); });
  ipcMain.on('cache-dir', (e) => { e.returnValue = episodeCacheDir; });

  const spawnEngine = () => {
    if (isQuitting) return;
    engine = utilityProcess.fork(path.join(__dirname, 'engine-process.js'), [], {
      env: {
        ...process.env,
        MS_PORT: '11471',
        MS_TOKEN: engineToken,
        MS_FFMPEG: resolveFfmpeg() || '',
        MS_CACHE_DIR: episodeCacheDir
      },
      serviceName: 'MacStream Engine'
    });
    engine.on('message', (msg) => {
      const d = msg && msg.data ? msg.data : msg;
      if (d && d.type === 'fetch-torrent' && d.hash) {
        triggerNetTorrentInject(d.hash);
      }
    });
    engine.on('exit', () => {
      if (!isQuitting) {
        engine = null;
        setTimeout(spawnEngine, 600);
      }
    });
  };
  spawnEngine();

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders || {};
    const u = details.url || '';
    if (u.startsWith('http://127.0.0.1:11471/')) {
      if (!h.Origin && !h.origin) h.Origin = 'null';
      h['X-MacStream'] = '1';
      try {
        if (u.includes('/start') || u.includes('/preload')) {
          const decoded = decodeURIComponent(u);
          const re = /btih:([a-fA-F0-9]{40})/g;
          let match;
          while ((match = re.exec(decoded))) triggerNetTorrentInject(match[1]);
        }
      } catch (e) {}
      return callback({ requestHeaders: h });
    }
    delete h['Referer'];
    delete h['referer'];
    // Para servidores IPTV Xtream Codes / M3U / HLS (.m3u8 / .ts / player_api.php):
    // Envia User-Agent compatível com VLC/Smarters e remove Origin: null que bloqueia painéis Xtream
    if (/(\/live\/|\/movie\/|\/series\/|player_api\.php|get\.php|\.m3u8|\.ts(\?|$))/i.test(u) && !/strem\.io|strem\.fun|opensubtitles|themoviedb|metahub/i.test(u)) {
      h['User-Agent'] = 'VLC/3.0.20 LibVLC/3.0.20';
      delete h['Origin'];
      delete h['origin'];
    }
    callback({ requestHeaders: h });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('http://127.0.0.1:11471/')) return callback({});
    const h = details.responseHeaders || {};
    const initiator = details.initiator || '';
    const isAppInitiator = !initiator || initiator === 'null' || initiator.startsWith('file://');
    for (const k of Object.keys(h)) {
      const kl = k.toLowerCase();
      if (kl === 'set-cookie') delete h[k];
      if (isAppInitiator && kl.startsWith('access-control-allow-')) delete h[k];
    }
    if (isAppInitiator) {
      h['Access-Control-Allow-Origin'] = ['*'];
      h['Access-Control-Allow-Headers'] = ['Content-Type, Range, Accept, X-Requested-With'];
      h['Access-Control-Allow-Methods'] = ['GET, HEAD, POST, OPTIONS'];
    }
    const out = { responseHeaders: h };
    if (isAppInitiator && details.method === 'OPTIONS') out.statusLine = 'HTTP/1.1 200 OK';
    callback(out);
  });

  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
    if (!icon.isEmpty() && app.dock) app.dock.setIcon(icon);
  } catch (e) {}

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', (ev) => {
  if (engine && !isQuitting) {
    ev.preventDefault();
    isQuitting = true;
    const e = engine; engine = null;
    const finish = () => app.quit();
    e.once('exit', finish);
    try { e.postMessage('stop'); } catch (x) { finish(); }
    setTimeout(() => { try { e.kill(); } catch (x) {} finish(); }, 2500);
  }
});
