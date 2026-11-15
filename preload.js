const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('macstreamApp', {
  isApp: true,
  engineUrl: ipcRenderer.sendSync('engine-url'),
  version: ipcRenderer.sendSync('app-version'),
  cacheDir: ipcRenderer.sendSync('cache-dir'),
  keepAwake: (on) => ipcRenderer.send('keep-awake', !!on),
  cacheSize: () => ipcRenderer.invoke('cache-size'),
  clearCache: () => ipcRenderer.invoke('cache-clear'),
  encryptSecret: (s) => ipcRenderer.sendSync('secret-encrypt', String(s || '')),
  decryptSecret: (s) => ipcRenderer.sendSync('secret-decrypt', String(s || ''))
});
