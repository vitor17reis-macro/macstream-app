'use strict';
// Opcional (macOS): muda o nome "Electron" e o ícone quando corres com `npm start`.
// Uso: npm run brand
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
if (process.platform !== 'darwin') { console.log('Só faz sentido no macOS.'); process.exit(0); }
try {
  const appPath = path.join(path.dirname(require.resolve('electron/package.json')), 'dist', 'Electron.app');
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  let t = fs.readFileSync(plist, 'utf8');
  t = t.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*/, '$1MacStream').replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]*/, '$1MacStream');
  fs.writeFileSync(plist, t);
  const png = path.join(__dirname, '..', 'build', 'icon.png');
  const set = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-icon-')), 'icon.iconset');
  fs.mkdirSync(set);
  [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'], [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'], [512, 'icon_512x512'], [1024, 'icon_512x512@2x']]
    .forEach(([sz, n]) => cp.execFileSync('sips', ['-z', String(sz), String(sz), png, '--out', path.join(set, n + '.png')], { stdio: 'ignore' }));
  cp.execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(appPath, 'Contents', 'Resources', 'electron.icns')]);
  cp.execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'ignore' });
  console.log('MacStream: nome e ícone aplicados. Corre "npm start".');
} catch (e) { console.log('Não consegui aplicar (não é grave):', e.message); }
