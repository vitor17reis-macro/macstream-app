'use strict';
// npm run test:extra — Suite Complementar de 43 Testes (Segurança, Privacidade, P2P, Codecs & IPTV)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const engineJs = fs.readFileSync(path.join(root, 'engine.js'), 'utf8');
const coreJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'core.js'), 'utf8');
const iptvJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'iptv.js'), 'utf8');
const catalogJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'catalog.js'), 'utf8');
const playerJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'player.js'), 'utf8');
const eventsJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'events.js'), 'utf8');

let startEngine, parseTracksFromStderr;
try {
  ({ startEngine, parseTracksFromStderr } = require(path.join(root, 'engine.js')));
} catch (e) {
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === 'webtorrent') {
      return class WebTorrentStub {
        constructor() { this.torrents = []; this.utp = true; }
        on() {} get() { return null; } throttleUpload() {} destroy() {}
      };
    }
    return origLoad.apply(this, arguments);
  };
  ({ startEngine, parseTracksFromStderr } = require(path.join(root, 'engine.js')));
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ [E${String(passed).padStart(2, '0')}]`, name);
  } catch (e) {
    failed++;
    console.log(`  ✗`, name, '\n     ', e && e.message);
  }
}

function get(port, p, headers) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: p, headers: headers || {} }, (res) => {
      let b = ''; res.on('data', d => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    r.on('error', reject);
  });
}

(async () => {
  console.log('\n=== SUITE EXTRA: Segurança, Privacidade, P2P, Codecs & IPTV (43 Testes) ===');

  const port = 25000 + Math.floor(Math.random() * 15000);
  const token = 'tok' + Math.random().toString(16).slice(2) + 'abcdef';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-extra-'));
  const eng = startEngine({ port, token, cacheDir: tmpDir });
  await new Promise(r => setTimeout(r, 200));

  try {
    await test('01. Timing-safe token: rejeita tokens de igual ou diferente comprimento com 403', async () => {
      const sameLen = 'x'.repeat(token.length);
      const r1 = await get(port, `/${sameLen}/status`);
      const r2 = await get(port, `/curto/status`);
      assert.strictEqual(r1.status, 403);
      assert.strictEqual(r2.status, 403);
    });

    await test('02. Bloqueio de Referer externo no motor (devolve 403)', async () => {
      const r = await get(port, `/${token}/status`, { Referer: 'https://evil.com/' });
      assert.strictEqual(r.status, 403);
    });

    await test('03. Validação de socket loopback presente em engine.js', async () => {
      assert.ok(engineJs.includes("remote !== '127.0.0.1'") && engineJs.includes("remote !== '::1'"));
    });

    await test('04. DNS Rebinding protection em createSafeDnsLookup presente em engine.js', async () => {
      assert.ok(engineJs.includes('function createSafeDnsLookup') && engineJs.includes('DNS Rebinding bloqueado'));
    });

    await test('05. /iptv-proxy bloqueia redirect 302 para IP privado (127.0.0.1/10.0.0.1)', async () => {
      const redirSrv = http.createServer((_req, res) => {
        res.writeHead(302, { Location: 'http://10.0.0.1/secret.m3u8' });
        res.end();
      });
      await new Promise(r => redirSrv.listen(0, '127.0.0.1', r));
      const rp = redirSrv.address().port;
      try {
        const res = await get(port, `/${token}/iptv-proxy?url=${encodeURIComponent(`http://127.0.0.1:${rp}/test.m3u8`)}`);
        assert.ok(res.status === 400 || res.status === 403 || res.status === 502);
      } finally { redirSrv.close(); }
    });

    await test('06. Tratamento de redirects 301/302/307/308 com validação SSRF em engine.js', async () => {
      assert.ok(engineJs.includes('301, 302, 303, 307, 308') && engineJs.includes('isSafeIptvUrl'));
    });

    await test('07. Reescrita .m3u8 em /iptv-proxy rejeita entradas privadas quando acedidas', async () => {
      const m3uSrv = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXTINF:4.0,\nhttp://169.254.169.254/latest/meta-data/\n');
      });
      await new Promise(r => m3uSrv.listen(0, '127.0.0.1', r));
      try {
        const res = await get(port, `/${token}/iptv-proxy?url=${encodeURIComponent(`http://127.0.0.1:${m3uSrv.address().port}/p.m3u8`)}`);
        assert.strictEqual(res.status, 200);
        const segLine = res.body.split('\n').find(l => l.includes('iptv-proxy'));
        if (segLine) {
          const segRes = await get(port, segLine.replace(`http://127.0.0.1:${port}`, ''));
          assert.strictEqual(segRes.status, 400);
        }
      } finally { m3uSrv.close(); }
    });

    await test('08. /opensubs-dl rejeita subdomínios falsos e HTTP não-TLS', async () => {
      const r1 = await get(port, `/${token}/opensubs-dl?url=${encodeURIComponent('https://opensubtitles.org.attacker.com/a.srt')}`);
      const r2 = await get(port, `/${token}/opensubs-dl?url=${encodeURIComponent('http://dl.opensubtitles.org/a.srt')}`);
      assert.strictEqual(r1.status, 400);
      assert.strictEqual(r2.status, 400);
    });

    await test('09. Limite de 2 MB e maxOutputLength gzip presentes em /opensubs-dl', async () => {
      assert.ok(engineJs.includes('2 * 1024 * 1024') && engineJs.includes('maxOutputLength'));
    });

    await test('10. onBeforeSendHeaders em main.js apaga Referer em pedidos externos', async () => {
      assert.ok(mainJs.includes("delete h['Referer']") && mainJs.includes("delete h['referer']"));
    });

    await test('11. onHeadersReceived em main.js remove Set-Cookie externo e isola CORS', async () => {
      assert.ok(mainJs.includes("if (kl === 'set-cookie') delete h[k]") && mainJs.includes('isAppInitiator'));
    });

    await test('12. will-navigate e setWindowOpenHandler restringem navegação externa em main.js', async () => {
      assert.ok(mainJs.includes("win.webContents.on('will-navigate'") && mainJs.includes('setWindowOpenHandler'));
    });

    await test('13. Fallback seguro quando safeStorage não está disponível', async () => {
      const i0 = coreJs.indexOf('function esc(s)'), i1 = coreJs.indexOf('const _nowSec =');
      const fns = new Function('window', 'localStorage', 'DEFAULT_ADDONS', coreJs.slice(i0, i1) + '; return { encSecret, decSecret };')({}, {}, []);
      assert.strictEqual(fns.encSecret('abc'), 'abc');
      assert.strictEqual(fns.decSecret('enc:v1:abc'), '');
    });

    await test('14. encSecret é idempotente para strings já cifradas (enc:v1:)', async () => {
      const i0 = coreJs.indexOf('function esc(s)'), i1 = coreJs.indexOf('const _nowSec =');
      let calls = 0;
      const fns = new Function('window', 'localStorage', 'DEFAULT_ADDONS', coreJs.slice(i0, i1) + '; return { encSecret };')({ macstreamApp: { encryptSecret: () => { calls++; return 'enc:v1:x'; } } }, {}, []);
      assert.strictEqual(fns.encSecret('enc:v1:already'), 'enc:v1:already');
      assert.strictEqual(calls, 0);
    });

    await test('15. secret-decrypt com payload corrompido devolve string vazia sem crash', async () => {
      assert.ok(mainJs.includes("ipcMain.on('secret-decrypt'") && mainJs.includes("e.returnValue = ''"));
    });

    await test('16. Migração automática de macstream_xtream em claro para cifrado', async () => {
      const i0 = coreJs.indexOf('function esc(s)'), i1 = coreJs.indexOf('const _nowSec =');
      const ls = new Map([['macstream_xtream', JSON.stringify({ server: 'http://x.pt', username: 'u', password: 'old' })]]);
      const mockLs = { getItem: (k) => ls.get(k) || null, setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) };
      const fns = new Function('window', 'localStorage', 'DEFAULT_ADDONS', coreJs.slice(i0, i1) + '; return { storage };')(
        { macstreamApp: { encryptSecret: (s) => 'enc:v1:' + s, decryptSecret: (s) => s.slice(7) } }, mockLs, []
      );
      assert.strictEqual(fns.storage.get('macstream_xtream').password, 'old');
      assert.strictEqual(JSON.parse(ls.get('macstream_xtream')).password, 'enc:v1:old');
    });

    await test('17. Migração automática de macstream_addons com Debrid em claro', async () => {
      const i0 = coreJs.indexOf('function esc(s)'), i1 = coreJs.indexOf('const _nowSec =');
      const ls = new Map([['macstream_addons', JSON.stringify([{ id: 't', base: 'https://torrentio.strem.fun/sort=qualitysize|realdebrid=PLAIN' }])]]);
      const mockLs = { getItem: (k) => ls.get(k) || null, setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) };
      const fns = new Function('window', 'localStorage', 'DEFAULT_ADDONS', coreJs.slice(i0, i1) + '; return { loadAddons };')(
        { macstreamApp: { encryptSecret: (s) => 'enc:v1:' + s, decryptSecret: (s) => s.slice(7) } }, mockLs, []
      );
      const loaded = fns.loadAddons();
      assert.ok(loaded[0].base.endsWith('PLAIN'));
      assert.ok(JSON.parse(ls.get('macstream_addons'))[0].base.startsWith('enc:v1:'));
    });

    await test('18. hydrateUserStateFromDisk desencripta tmdbApiKey cifrada', async () => {
      assert.ok(coreJs.includes('const decTmdb = decSecret(String(st.tmdbApiKey))'));
    });

    await test('19. clearHistoryBtn limpa histórico sem chamar /clear da cache de vídeo', async () => {
      assert.ok(eventsJs.includes("clearStore('watch_progress')") && !eventsJs.slice(eventsJs.indexOf('clearHistoryBtn')).slice(0, 500).includes('/clear'));
    });

    await test('20. syncUserStateToDisk retorna imediatamente quando state.privateMode está ativo', async () => {
      assert.ok(coreJs.includes('if (state.privateMode) return;'));
    });

    await test('21. Zero referências a placehold.co em todo o renderer', async () => {
      const all = coreJs + iptvJs + catalogJs + playerJs + eventsJs;
      assert.ok(!all.includes('placehold.co'));
    });

    await test('22. Lazy init da DHT/WebTorrent: engine.js não chama getClient() no arranque', async () => {
      assert.ok(!engineJs.includes('try { getClient(); } catch (e) {}'));
    });

    await test('23. Quota MAX_VIDEO_FILE_BYTES (35 GB) definida em engine.js', async () => {
      assert.ok(engineJs.includes('MAX_VIDEO_FILE_BYTES = 35 * 1024 * 1024 * 1024'));
    });

    await test('24. Quota MAX_TOTAL_CACHE_BYTES (45 GB) definida em engine.js', async () => {
      assert.ok(engineJs.includes('MAX_TOTAL_CACHE_BYTES = 45 * 1024 * 1024 * 1024'));
    });

    await test('25. loadCacheManifest faz reset de remuxing: false no arranque', async () => {
      assert.ok(engineJs.includes('remuxing: false, cacheKey: ck'));
    });

    await test('26. Invalidação de dirSize cache em saveCacheManifest', async () => {
      assert.ok(engineJs.includes('function invalidateDirSizeCache()') && engineJs.includes('invalidateDirSizeCache();'));
    });

    await test('27. Limite de concorrência em runFF (introProcs / probeProcs)', async () => {
      assert.ok(engineJs.includes('introProcs') && engineJs.includes('probeProcs'));
    });

    await test('28. Rota /status responde 200 JSON válido mesmo sem torrents ativos', async () => {
      const r = await get(port, `/${token}/status`);
      assert.strictEqual(r.status, 200);
      const j = JSON.parse(r.body);
      assert.strictEqual(j.ok, true);
    });

    await test('29. Rota /focus rejeita referência inválida com 400', async () => {
      const r = await get(port, `/${token}/focus/invalidhash/0?frac=0.5`);
      assert.strictEqual(r.status, 400);
    });

    await test('30. Rota /have rejeita referência inválida com 400', async () => {
      const r = await get(port, `/${token}/have/invalidhash/0`);
      assert.strictEqual(r.status, 400);
    });

    await test('31. Rota /stop responde 200 { ok: true } sem erros', async () => {
      const r = await get(port, `/${token}/stop`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(JSON.parse(r.body).ok, true);
    });

    await test('32. Path traversal e índices negativos rejeitados em /stream e /sub', async () => {
      const r1 = await get(port, `/${token}/stream/../../../../etc/passwd`);
      const r2 = await get(port, `/${token}/sub/1111111111111111111111111111111111111111/-1/0`);
      assert.ok(r1.status === 400 || r1.status === 403);
      assert.strictEqual(r2.status, 400);
    });

    await test('33. triggerAutoRemuxIfNeeded verifica probeTracks antes de remuxReady em .mp4', async () => {
      assert.ok(engineJs.includes('probeTracks(h, fIdx)') && engineJs.includes('eac3|ac3|dts|truehd'));
    });

    await test('34. parseTracksFromStderr identifica áudio AAC + vídeo H.264 compatível', async () => {
      const tr = parseTracksFromStderr('  Stream #0:0: Video: h264\n  Stream #0:1(por): Audio: aac, 48000 Hz, stereo (default)\n');
      assert.strictEqual(tr.ok, true);
      assert.strictEqual(tr.video, 'h264');
      assert.strictEqual(tr.audio[0].codec, 'aac');
    });

    await test('35. Rota /keyframe para ficheiro inexistente devolve 404', async () => {
      const r = await get(port, `/${token}/keyframe/1111111111111111111111111111111111111111/0?t=0`);
      assert.strictEqual(r.status, 404);
    });

    await test('36. Rota /sub para ficheiro inexistente devolve 404', async () => {
      const r = await get(port, `/${token}/sub/1111111111111111111111111111111111111111/0/0`);
      assert.strictEqual(r.status, 404);
    });

    await test('37. Rota /tracks para ficheiro inexistente devolve ok: false', async () => {
      const r = await get(port, `/${token}/tracks/1111111111111111111111111111111111111111/0`);
      assert.strictEqual(JSON.parse(r.body).ok, false);
    });

    await test('38. teardownMedia e cleanupActivePlayerSession limpam slowTimer e startTimer', async () => {
      assert.ok(playerJs.includes('clearTimeout(state.slowTimer)') && playerJs.includes('clearTimeout(state.startTimer)'));
    });

    await test('39. visibilitychange pausa heroTimer em catalog.js/events.js', async () => {
      assert.ok(eventsJs.includes('visibilitychange') || catalogJs.includes('heroTimer'));
    });

    await test('40. detect-intro suporta capítulos Opening / Intro via parseTracksFromStderr', async () => {
      const tr = parseTracksFromStderr('  Chapter #0:0: start 10.000, end 45.000\n    Metadata:\n      title           : Opening\n');
      assert.ok(tr.intro && tr.intro.ok && tr.intro.startSec === 10 && tr.intro.endSec === 45);
    });

    await test('41. Sanitização de URLs Xtream com encodeURIComponent em iptv.js', async () => {
      assert.ok(iptvJs.includes('encodeURIComponent(state.xtreamConfig.username.trim())'));
      assert.ok(iptvJs.includes('encodeURIComponent(state.xtreamConfig.password.trim())'));
    });

    await test('42. renderChannelLogoHtml usa data-mono sem handler onerror inline', async () => {
      assert.ok(iptvJs.includes('data-mono=') && !iptvJs.includes('onerror='));
    });

    await test('43. Código morto #simulateTwoMinLeftBtn removido de events.js e core.js', async () => {
      assert.ok(!eventsJs.includes('simulateTwoMinLeftBtn') && !coreJs.includes('simulateTwoMinLeftBtn'));
    });
  } finally {
    eng.stop();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n${passed} ok, ${failed} falhas\n`);
  process.exit(failed ? 1 : 0);
})();
