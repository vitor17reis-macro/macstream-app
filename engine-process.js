'use strict';
// Corre o motor de torrents num processo separado, para o hashing/rede
// não bloquearem a janela (processo principal do Electron).
const { startEngine } = require('./engine');
const engine = startEngine({
  port: parseInt(process.env.MS_PORT || '11471', 10),
  ffmpegPath: process.env.MS_FFMPEG || null,
  cacheDir: process.env.MS_CACHE_DIR || undefined,
  token: process.env.MS_TOKEN || '',
  onRequestTorrentBuf: (hash) => {
    try {
      if (process.parentPort) process.parentPort.postMessage({ type: 'fetch-torrent', hash });
    } catch (e) {}
  }
});
function shutdown() { try { engine.stop(); } catch (e) {} process.exit(0); }
if (process.parentPort) {
  process.parentPort.on('message', (e) => {
    const d = e && e.data !== undefined ? e.data : e;
    if (d === 'stop') shutdown();
    else if (d && d.type === 'torrent-buf' && d.hash && d.b64) {
      try { engine.injectTorrent(d.hash, Buffer.from(d.b64, 'base64')); } catch (x) {}
    } else if (d && d.battery !== undefined) {
      engine.setBattery(d.battery);
    }
  });
}
process.on('SIGTERM', shutdown);
