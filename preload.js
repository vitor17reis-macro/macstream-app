const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('macstreamApp', {
  isApp: true,
  engineUrl: ipcRenderer.sendSync('engine-url'),
  version: ipcRenderer.sendSync('app-version'),
  cacheDir: ipcRenderer.sendSync('cache-dir'),
  keepAwake: (on) => ipcRenderer.send('keep-awake', !!on),
  cacheSize: () => ipcRenderer.invoke('cache-size'),
  clearCache: () => ipcRenderer.invoke('cache-clear'),
  openBackupsFolder: () => ipcRenderer.invoke('open-backups-folder'),
  icloudBackupInfo: () => ipcRenderer.invoke('icloud-backup-info'),
  icloudChooseFolder: () => ipcRenderer.invoke('icloud-choose-folder'),
  icloudExportBackup: (payload) => ipcRenderer.invoke('icloud-export-backup', payload),
  icloudRestoreBackup: () => ipcRenderer.invoke('icloud-restore-backup'),
  encryptSecret: (s) => ipcRenderer.sendSync('secret-encrypt', String(s || '')),
  decryptSecret: (s) => ipcRenderer.sendSync('secret-decrypt', String(s || ''))
});
