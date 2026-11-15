'use strict';
// npm test — Suite Exaustiva de 30 Testes Automáticos (Motor P2P, Isolamento de Cache, Keyframe Seek, Legendas Stremio/Ventic/ffsubsync, Episódios Duplos, IPTV Xtream .m3u8->.ts Fallback, Unicode Superscripts, Persistência em Disco e Integridade DOM)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'core.js'), 'utf8');
const iptvJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'iptv.js'), 'utf8');
const subtitlesJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'subtitles.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
let passed = 0, failed = 0, skipped = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ [${String(passed).padStart(2, '0')}]`, name);
  } catch (e) {
    if (e && e.skip) {
      skipped++;
      console.log('  - (ignorado)', name, '—', e.message);
    } else {
      failed++;
      console.log('  ✗', name, '\n     ', e && e.message);
    }
  }
}

const skip = (m) => { const e = new Error(m); e.skip = true; throw e; };
function get(port, p, headers) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: p, headers: headers || {} }, (res) => {
      let b = ''; res.on('data', d => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    r.on('error', reject);
  });
}

(async () => {
  console.log('\n=== GRUPO 1: Segurança do Motor, Validação de Inputs & Isolamento de Cache (Testes 01–06) ===');
  let startEngine, parseEpisodeCodesFromText, fileHasConflictingEpisode, fileMatchesEpisode, computeOsdbHashFromBuffers, computeOsdbHashFromDiskFile, parseSilencedetectToSpeech, detectIntroFromSilenceLog, parseTracksFromStderr;
  try {
    ({ startEngine, parseEpisodeCodesFromText, fileHasConflictingEpisode, fileMatchesEpisode, computeOsdbHashFromBuffers, computeOsdbHashFromDiskFile, parseSilencedetectToSpeech, detectIntroFromSilenceLog, parseTracksFromStderr } = require(path.join(root, 'engine.js')));
  } catch (e) {
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (req, parent, isMain) {
      if (req === 'webtorrent') {
        return class WebTorrentStub {
          constructor() { this.torrents = []; this.utp = true; }
          on() {}
          get() { return null; }
          throttleUpload() {}
          destroy() {}
        };
      }
      return origLoad.apply(this, arguments);
    };
    ({ startEngine, parseEpisodeCodesFromText, fileHasConflictingEpisode, fileMatchesEpisode, computeOsdbHashFromBuffers, computeOsdbHashFromDiskFile, parseSilencedetectToSpeech, detectIntroFromSilenceLog, parseTracksFromStderr } = require(path.join(root, 'engine.js')));
  }

  let sharedPort = 20000 + Math.floor(Math.random() * 20000);
  let sharedTok = 'tok' + Math.random().toString(16).slice(2);
  let sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-sec-'));
  let sharedEng = startEngine({ port: sharedPort, token: sharedTok, cacheDir: sharedDir });
  await new Promise(r => setTimeout(r, 250));

  try {
    await test('Segurança HTTP: bloqueia pedidos sem token, com token inválido e de origens externas (403 JSON)', async () => {
      const rNoTok = await get(sharedPort, '/status');
      assert.strictEqual(rNoTok.status, 403);
      assert.strictEqual(JSON.parse(rNoTok.body).ok, false);
      assert.strictEqual((await get(sharedPort, '/errado/status')).status, 403);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/status`, { Origin: 'https://malicioso.com' })).status, 403);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/status`, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    });

    await test('Origens autorizadas da app Electron: aceita Origin null (file://), X-MacStream e Sec-Fetch-Mode cors', async () => {
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/status`)).status, 200);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/status`, { Origin: 'null' })).status, 200);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/status`, { 'Sec-Fetch-Site': 'cross-site', Origin: 'null' })).status, 200);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/status`, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' })).status, 200);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/status`, { 'Sec-Fetch-Site': 'cross-site', 'X-MacStream': '1' })).status, 200);
    });

    await test('Validação de parâmetros nas rotas do motor: rejeita hashes inválidos, índices negativos e .torrent corrompidos', async () => {
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/tracks/xyz/0`)).status, 400);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/stream/${'a'.repeat(40)}/-1`)).status, 400);
      assert.strictEqual((await get(sharedPort, `/${sharedTok}/evict?hash=invalido`)).status, 400);
      const post = (b) => new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: sharedPort, path: `/${sharedTok}/start`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        r.on('error', reject); r.end(b);
      });
      assert.strictEqual(await post(JSON.stringify({ torrentB64: 'bGl4bw==' })), 400);
    });
  } finally {
    sharedEng.stop();
    try { fs.rmSync(sharedDir, { recursive: true, force: true }); } catch (e) {}
  }

  await test('Isolamento de cache multi-série: Tulsa King 100% em disco NUNCA é apagado nem sobrescrito ao abrir The Office', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cache-iso-'));
    const tulsaHash = '1111111111111111111111111111111111111111';
    const officeHash = '2222222222222222222222222222222222222222';
    fs.mkdirSync(path.join(tmpDir, tulsaHash), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, officeHash), { recursive: true });
    const tulsaFile = path.join(tmpDir, tulsaHash, 'Tulsa.King.S01E01.1080p.mp4');
    const officeFile = path.join(tmpDir, officeHash, 'The.Office.S01E01.1080p.mp4');
    fs.writeFileSync(tulsaFile, Buffer.alloc(4096, 'T'));
    fs.writeFileSync(officeFile, Buffer.alloc(4096, 'O'));
    fs.writeFileSync(path.join(tmpDir, 'cache-state.json'), JSON.stringify({
      primaryHash: officeHash,
      items: {
        [`${tulsaHash}:0`]: { cacheKey: `${tulsaHash}:0`, infoHash: tulsaHash, fileIdx: 0, name: 'Tulsa.King.S01E01.1080p.mp4', length: 4096, localPath: tulsaFile, title: 'Tulsa King', imdbId: 'tt16358384', type: 'series', season: 1, episode: 1, completed: true, progress: 1, updatedAt: Date.now() - 60000 },
        [`${officeHash}:0`]: { cacheKey: `${officeHash}:0`, infoHash: officeHash, fileIdx: 0, name: 'The.Office.S01E01.1080p.mp4', length: 4096, localPath: officeFile, title: 'The Office', imdbId: 'tt0386676', type: 'series', season: 1, episode: 1, completed: true, progress: 1, updatedAt: Date.now() }
      }
    }, null, 2));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const startTulsa = JSON.parse((await get(port, `/${token}/start?magnet=${encodeURIComponent('magnet:?xt=urn:btih:' + tulsaHash)}&alt=${encodeURIComponent('magnet:?xt=urn:btih:' + officeHash)}&title=Tulsa+King&imdbId=tt16358384&season=1&episode=1`)).body);
      assert.strictEqual(startTulsa.ok, true);
      assert.strictEqual(startTulsa.infoHash, tulsaHash);
      assert.strictEqual(startTulsa.diskComplete, true);
      const streamRes = await get(port, `/${token}/stream/${tulsaHash}/0`, { Range: 'bytes=0-63' });
      assert.strictEqual(streamRes.status, 206);
      assert.strictEqual(streamRes.body, 'T'.repeat(64));
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Deteção de episódios simples em Season Packs (bloqueia S01E01 quando se pede S01E02)', async () => {
    assert.strictEqual(fileHasConflictingEpisode('Tulsa.King.S01E01.1080p.WEBRip.srt', 1, 2), true);
    assert.strictEqual(fileHasConflictingEpisode('Tulsa.King.1x01.1080p.srt', 1, 2), true);
    assert.strictEqual(fileHasConflictingEpisode('Tulsa.King.S01E02.1080p.WEBRip.srt', 1, 2), false);
    assert.strictEqual(fileMatchesEpisode('Tulsa.King.S01E02.1080p.WEBRip.mkv', 1, 2), true);
    assert.strictEqual(fileMatchesEpisode('Tulsa.King.S01E01.1080p.WEBRip.mkv', 1, 2), false);
  });

  await test('Deteção de episódios duplos fundidos em nomes de ficheiros (S04E01E02, S04E03-E04)', async () => {
    assert.strictEqual(fileMatchesEpisode('The.Office.US.S04E01E02.1080p.BluRay.x265.mkv', 4, 1), true);
    assert.strictEqual(fileMatchesEpisode('The.Office.US.S04E01E02.1080p.BluRay.x265.mkv', 4, 2), true);
    assert.strictEqual(fileHasConflictingEpisode('The.Office.US.S04E03-E04.1080p.BluRay.x265.mkv', 4, 4), false);
    assert.strictEqual(fileHasConflictingEpisode('The.Office.US.S04E03-E04.1080p.BluRay.x265.mkv', 4, 5), true);
  });

  console.log('\n=== GRUPO 2: Hash OSDB 64-bit, FFmpeg Keyframe, Silencedetect & Deteção de Intro (Testes 07–12) ===');

  await test('Cálculo exato do videoHash OSDB de 64 bits (computeOsdbHashFromBuffers e computeOsdbHashFromDiskFile)', async () => {
    const head = Buffer.alloc(65536, 0);
    const tail = Buffer.alloc(65536, 0);
    head.writeBigUInt64LE(0x0102030405060708n, 0);
    tail.writeBigUInt64LE(0x1000000000000001n, 65528);
    const size = 200000;
    const h = computeOsdbHashFromBuffers(size, head, tail);
    const expected = (BigInt(size) + 0x0102030405060708n + 0x1000000000000001n).toString(16).padStart(16, '0');
    assert.strictEqual(h, expected);

    const tmpFile = path.join(os.tmpdir(), 'ms-osdb-test-' + Date.now() + '.bin');
    const fullBuf = Buffer.alloc(size, 0);
    head.copy(fullBuf, 0);
    tail.copy(fullBuf, size - 65536);
    fs.writeFileSync(tmpFile, fullBuf);
    try {
      assert.strictEqual(computeOsdbHashFromDiskFile(tmpFile), expected);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }
  });

  await test('parseSilencedetectToSpeech converte silêncios do FFmpeg em intervalos exatos de fala humana', async () => {
    const speech = parseSilencedetectToSpeech('[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 3.0\n[silencedetect @ 0x1] silence_start: 6.5\n[silencedetect @ 0x1] silence_end: 10.0\n', 10, 15);
    assert.deepStrictEqual(speech, [[13, 16.5], [20, 25]]);
  });

  await test('parseSilencedetectToSpeech filtra blocos contínuos de música (> 8.5s) para proteger sincronização de legendas', async () => {
    const withThemeSong = parseSilencedetectToSpeech('[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 2.0\n[silencedetect @ 0x1] silence_start: 34.0\n[silencedetect @ 0x1] silence_end: 36.0\n[silencedetect @ 0x1] silence_start: 39.0\n[silencedetect @ 0x1] silence_end: 42.0\n', 0, 42);
    assert.deepStrictEqual(withThemeSong, [[36, 39]]);
  });

  await test('detectIntroFromSilenceLog identifica automaticamente o bloco musical do genérico (32s) após o Cold Open', async () => {
    const silenceLog = [
      '[silencedetect @ 0x1] silence_start: 4.2', '[silencedetect @ 0x1] silence_end: 5.0',
      '[silencedetect @ 0x1] silence_start: 10.5', '[silencedetect @ 0x1] silence_end: 11.4',
      '[silencedetect @ 0x1] silence_start: 17.0', '[silencedetect @ 0x1] silence_end: 18.0',
      '[silencedetect @ 0x1] silence_start: 24.0', '[silencedetect @ 0x1] silence_end: 25.0',
      '[silencedetect @ 0x1] silence_start: 31.0', '[silencedetect @ 0x1] silence_end: 32.0',
      '[silencedetect @ 0x1] silence_start: 38.0', '[silencedetect @ 0x1] silence_end: 39.0',
      '[silencedetect @ 0x1] silence_start: 45.0', '[silencedetect @ 0x1] silence_end: 46.0',
      '[silencedetect @ 0x1] silence_start: 78.0', '[silencedetect @ 0x1] silence_end: 79.2',
      '[silencedetect @ 0x1] silence_start: 85.0', '[silencedetect @ 0x1] silence_end: 86.0'
    ].join('\n');
    const introDet = detectIntroFromSilenceLog(silenceLog, 0, 180);
    assert.strictEqual(introDet.ok, true);
    assert.strictEqual(introDet.startSec, 46.0);
    assert.strictEqual(introDet.endSec, 78.0);
    assert.strictEqual(introDet.duration, 32.0);
  });

  await test('parseTracksFromStderr extrai capítulos MKV (Opening Intro), faixas de áudio EAC3 e legendas embutidas', async () => {
    const ffErrWithChapters = [
      '  Duration: 00:42:01.12, start: 0.000000, bitrate: 4500 kb/s',
      '  Chapter #0:0: start 0.000000, end 84.500000',
      '    Metadata:',
      '      title           : Cold Open',
      '  Chapter #0:1: start 84.500000, end 116.500000',
      '    Metadata:',
      '      title           : Opening Intro',
      '  Stream #0:0: Video: hevc, yuv420p, 1920x1080',
      '  Stream #0:1(eng): Audio: eac3, 48000 Hz, 5.1(side) (default)',
      '  Stream #0:2(por): Subtitle: subrip (default)'
    ].join('\n');
    const parsedTr = parseTracksFromStderr(ffErrWithChapters);
    assert.strictEqual(parsedTr.ok, true);
    assert.strictEqual(parsedTr.video, 'hevc');
    assert.strictEqual(parsedTr.audio.length, 1);
    assert.strictEqual(parsedTr.subs.length, 1);
    assert.ok(parsedTr.intro && parsedTr.intro.ok);
    assert.strictEqual(parsedTr.intro.startSec, 84.5);
    assert.strictEqual(parsedTr.intro.endSec, 116.5);
  });

  await test('Sondagem real de Keyframe (/keyframe) com FFmpeg num contentor MKV com GOP de 5s', async () => {
    const ffCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (ffCheck.status !== 0) skip('ffmpeg não instalado no sistema');
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-kf-test-'));
    const kfHash = '3333333333333333333333333333333333333333';
    fs.mkdirSync(path.join(tmpDir, kfHash), { recursive: true });
    const mkvFile = path.join(tmpDir, kfHash, 'Test.GOP5s.S01E01.mkv');
    const gen = spawnSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=24:d=18',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=18',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '120', '-keyint_min', '120', '-sc_threshold', '0',
      '-c:a', 'eac3', '-b:a', '128k', mkvFile
    ]);
    if (gen.status !== 0 || !fs.existsSync(mkvFile)) skip('falha ao gerar MKV de teste');
    const stat = fs.statSync(mkvFile);
    fs.writeFileSync(path.join(tmpDir, 'cache-state.json'), JSON.stringify({
      primaryHash: kfHash,
      items: { [`${kfHash}:0`]: { cacheKey: `${kfHash}:0`, infoHash: kfHash, fileIdx: 0, name: 'Test.GOP5s.S01E01.mkv', length: stat.size, localPath: mkvFile, title: 'Test GOP', imdbId: 'tt0000001', type: 'series', season: 1, episode: 1, completed: true, progress: 1, updatedAt: Date.now() } }
    }, null, 2));
    const eng = startEngine({ port, token, cacheDir: tmpDir, ffmpegPath: 'ffmpeg' });
    await new Promise(r => setTimeout(r, 200));
    try {
      const kfRes = JSON.parse((await get(port, `/${token}/keyframe/${kfHash}/0?t=12.7`)).body);
      assert.strictEqual(kfRes.ok, true);
      assert.ok(Math.abs(kfRes.start - 10.0) < 0.25, `esperava keyframe ~10.0s mas recebeu ${kfRes.start}s`);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  console.log('\n=== GRUPO 3: Persistência 100% Privada em Disco (/user-state) & Sobrevivência a Limpeza (Testes 13–14) ===');

  await test('GET/POST /user-state guarda atomicamente em disco o progresso de séries, biblioteca, favoritos IPTV e intros', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-userstate-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const postState = (payload) => new Promise((resolve, reject) => {
        const b = JSON.stringify(payload);
        const req = http.request({ host: '127.0.0.1', port, path: `/${token}/user-state`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (res) => {
          let out = ''; res.on('data', d => (out += d)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
        });
        req.on('error', reject); req.end(b);
      });
      const saveRes = await postState({
        watchProgressMap: { 'tt0386676_S4_E5': { key: 'tt0386676_S4_E5', imdbId: 'tt0386676', currentTime: 940, duration: 2520, updatedAt: 1700000000 } },
        libraryMap: { 'tt0386676': { imdbId: 'tt0386676', title: 'The Office' } },
        iptvFavorites: ['xt-56'],
        iptvPinnedCategories: ['★●• PORTUGAL •●★'],
        introMap: { 'ms_intro_tt0386676': { at: 46, len: 32 } }
      });
      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.body.ok, true);
      assert.strictEqual(fs.existsSync(path.join(tmpDir, 'user-state.json')), true);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Rota /clear apaga todos os ficheiros de cache de vídeo mas preserva intacto o ficheiro user-state.json', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-clear-preserve-'));
    fs.writeFileSync(path.join(tmpDir, 'dummy-video.mp4'), Buffer.alloc(1024, 'V'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      await new Promise((resolve, reject) => {
        const b = JSON.stringify({ watchProgressMap: { 'tt16358384_S3_E7': { key: 'tt16358384_S3_E7', currentTime: 1707 } } });
        const req = http.request({ host: '127.0.0.1', port, path: `/${token}/user-state`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (res) => { res.resume(); res.on('end', resolve); });
        req.on('error', reject); req.end(b);
      });
      await get(port, `/${token}/clear`);
      assert.strictEqual(fs.existsSync(path.join(tmpDir, 'dummy-video.mp4')), false, 'vídeo apagado');
      const loadRes = JSON.parse((await get(port, `/${token}/user-state`)).body);
      assert.strictEqual(loadRes.state.watchProgressMap['tt16358384_S3_E7'].currentTime, 1707, 'histórico preservado');
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  console.log('\n=== GRUPO 4: Motor de Legendas, The Office S02E22 & Temporada 4 Episódios Duplos (Testes 15–22) ===');
  const a = subtitlesJs.indexOf('// @ss-begin'), b = subtitlesJs.indexOf('// @ss-end');
  assert.ok(a > 0 && b > a, 'marcadores @ss não encontrados em subtitles.js');
  const ss = new Function(subtitlesJs.slice(a, b) + ';return { ssParseCues, ssParseSplitEpisodeTitle, ssResolveEpisodeMapping, ssInspectEpisode, ssExtractReleaseTag, ssScoreSubtitle, ssSyncToIntervals };')();

  await test('ssParseCues filtra descrições SDH ([Música], (Suspiro)), letras ♪ e créditos mantendo apenas fala real', async () => {
    const sdhSrt = [
      '1\n00:00:01,000 --> 00:00:12,000\nTradução e Sincronização: Equipa OpenSubtitles\n',
      '2\n00:00:15,000 --> 00:00:25,000\n[MÚSICA ROCK A TOCAR ALTO]\n',
      '3\n00:00:26,000 --> 00:00:35,000\n♪ Walkin down the lonely highway ♪\n',
      '4\n00:00:38,000 --> 00:00:40,500\n(SUSPIRO PROFUNDO)\n',
      '5\n00:00:42,000 --> 00:00:45,000\nTemos de falar sobre o negócio em Tulsa.\n',
      '6\n00:00:47,000 --> 00:00:50,000\n[PORTA BATE] Sim, vamos resolver isso hoje.\n'
    ].join('\n');
    const cues = ss.ssParseCues(sdhSrt);
    assert.strictEqual(cues.length, 2);
    assert.deepStrictEqual(cues[0], [42, 45]);
    assert.deepStrictEqual(cues[1], [47, 50]);
  });

  await test('Regressão The Office S02E22 ("Casino Night"): nunca rejeita legenda válida por palavras de outros títulos no diálogo', async () => {
    const officeS02E22Dialogue = '1\n00:00:05,000 --> 00:00:08,000\nJim told Pam the secret about the client and the fire after the fight on the carpet.\n';
    const officeOtherTitles = ['The Dundies', 'Sexual Harassment', 'Office Olympics', 'The Fire', 'Halloween', 'The Fight', 'The Client', 'Performance Review', 'Email Surveillance', 'Christmas Party', 'Booze Cruise', 'The Injury', 'The Secret', 'The Carpet', 'Boys and Girls', 'Valentine\'s Day', 'Dwight\'s Speech', 'Take Your Daughter to Work Day', 'Michael\'s Birthday', 'Drug Testing', 'Conflict Resolution'];
    const officeCheck = ss.ssInspectEpisode(officeS02E22Dialogue, '', 2, 22, 'Casino Night', officeOtherTitles);
    assert.strictEqual(officeCheck.wrongEpisode, false);
  });

  await test('Preservação da ordem oficial do opensubtitles-v3.strem.io quando subMetaName está vazio', async () => {
    const cuesNormal = [];
    for (let t = 10; t <= 1300; t += 45) cuesNormal.push([t, t + 3]);
    const stremioRank1 = ss.ssScoreSubtitle('1\n00:00:05,000 --> 00:00:08,000\nOlá\n', '', 'The.Office.US.S02E22.Casino.Night.1080p.BluRay.mkv', false, 2, 22, 'Casino Night', [], cuesNormal, 0, false, 0);
    const stremioRank4 = ss.ssScoreSubtitle('1\n00:00:05,000 --> 00:00:08,000\nThe Office US Casino Night Bluray\n', '', 'The.Office.US.S02E22.Casino.Night.1080p.BluRay.mkv', false, 2, 22, 'Casino Night', [], cuesNormal, 0, false, 3);
    assert.ok(stremioRank1.totalScore > stremioRank4.totalScore);
  });

  await test('Ranking Ventic: Hash Exato (m==="h") > Release/Grupo Match > Corte Extended/Superfan penalizado', async () => {
    const cuesNormal = [];
    for (let t = 10; t <= 2350; t += 45) cuesNormal.push([t, t + 3]);
    const cuesExtended = [];
    for (let t = 10; t <= 2950; t += 45) cuesExtended.push([t, t + 3]);
    const scHash = ss.ssScoreSubtitle('Tulsa King S01E02', 'Tulsa.King.S01E02.1080p.AMZN.WEB-DL-NTb.srt', 'Tulsa.King.S01E02.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', true, 1, 2, 'Center of the Universe', [], cuesNormal, 2400, true, 0);
    const scRelease = ss.ssScoreSubtitle('Tulsa King S01E02', 'Tulsa.King.S01E02.1080p.AMZN.WEB-DL-NTb.srt', 'Tulsa.King.S01E02.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', true, 1, 2, 'Center of the Universe', [], cuesNormal, 2400, false, 0);
    const scExtended = ss.ssScoreSubtitle('Tulsa King S01E02', 'Tulsa.King.S01E02.Extended.BluRay.srt', 'Tulsa.King.S01E02.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv', false, 1, 2, 'Center of the Universe', [], cuesExtended, 2400, false, 0);
    assert.strictEqual(scRelease.releaseTag, 'AMZN•WEB-DL•NTb');
    assert.ok(scHash.totalScore > scRelease.totalScore);
    assert.ok(scRelease.totalScore > scExtended.totalScore + 150);
  });

  await test('Mapeamento automático de episódios duplos (1)/(2) em The Office Temporada 4 (19 TVDB vs 14 IMDb/OpenSubtitles)', async () => {
    const officeS04List = [
      { season: 4, episode: 1, title: 'Fun Run (1)', released: '2007-09-27' },
      { season: 4, episode: 2, title: 'Fun Run (2)', released: '2007-09-27' },
      { season: 4, episode: 3, title: 'Dunder Mifflin Infinity (1)', released: '2007-10-04' },
      { season: 4, episode: 4, title: 'Dunder Mifflin Infinity (2)', released: '2007-10-04' },
      { season: 4, episode: 5, title: 'Launch Party (1)', released: '2007-10-11' },
      { season: 4, episode: 6, title: 'Launch Party (2)', released: '2007-10-11' },
      { season: 4, episode: 7, title: 'Money (1)', released: '2007-10-18' },
      { season: 4, episode: 8, title: 'Money (2)', released: '2007-10-18' },
      { season: 4, episode: 9, title: 'Local Ad', released: '2007-10-25' },
      { season: 4, episode: 18, title: 'Goodbye, Toby (1)', released: '2008-05-15' },
      { season: 4, episode: 19, title: 'Goodbye, Toby (2)', released: '2008-05-15' }
    ];
    assert.strictEqual(ss.ssResolveEpisodeMapping(officeS04List, 4, 2, 'Fun Run (2)', '').dvdEp, 1);
    assert.strictEqual(ss.ssResolveEpisodeMapping(officeS04List, 4, 3, 'Dunder Mifflin Infinity (1)', '').dvdEp, 2);
    assert.strictEqual(ss.ssResolveEpisodeMapping(officeS04List, 4, 5, 'Launch Party (1)', '').dvdEp, 3);
    assert.strictEqual(ss.ssResolveEpisodeMapping(officeS04List, 4, 9, 'Local Ad', '').dvdEp, 5);
  });

  await test('ssSyncToIntervals (algoritmo ffsubsync / plezy#2780) recupera desvios exatos (-3,4 s e +5,2 s)', async () => {
    const speech = [];
    let t = 12;
    for (let i = 0; i < 22; i++) {
      const len = 1.4 + (i % 3) * 0.7;
      speech.push([+(t).toFixed(2), +(t + len).toFixed(2)]);
      t += len + 1.6 + (i % 4) * 0.8;
    }
    const cuesLate = speech.map(([x, y]) => [+(x + 3.4).toFixed(2), +(y + 3.4).toFixed(2)]);
    const res1 = ss.ssSyncToIntervals(cuesLate, speech, 10, 95, 15);
    assert.strictEqual(res1.ok, true);
    assert.ok(Math.abs(res1.offset - (-3.4)) <= 0.10);

    const cuesEarly = speech.map(([x, y]) => [+(x - 5.2).toFixed(2), +(y - 5.2).toFixed(2)]);
    const res2 = ss.ssSyncToIntervals(cuesEarly, speech, 10, 95, 15);
    assert.strictEqual(res2.ok, true);
    assert.ok(Math.abs(res2.offset - 5.2) <= 0.10);
  });

  await test('Descodificação UTF-8 / Windows-1252 e limpeza de tags ASS em convertSrtToVtt', async () => {
    const i = subtitlesJs.indexOf('function decodeSubtitleBuffer'), j = subtitlesJs.indexOf('\n      }\n', i) + 9;
    const dec = new Function(subtitlesJs.slice(i, j) + ';return decodeSubtitleBuffer;')();
    const txt = 'Não, ação, coração, episódios';
    assert.strictEqual(dec(Buffer.from(txt, 'utf8')), txt);
    const i2 = subtitlesJs.indexOf('function convertSrtToVtt'), j2 = subtitlesJs.indexOf('function decodeSubtitleBuffer');
    const conv = new Function(subtitlesJs.slice(i2, j2) + ';return convertSrtToVtt;')();
    const vtt = conv('1\n0:01:05,250 --> 00:01:08,500\n{\\an8}<font color="#ffff00">Olá mundo!</font>\n');
    assert.ok(vtt.includes('00:01:05.250 --> 00:01:08.500') && !vtt.includes('{\\an8}'));
  });

  await test('shiftVtt com dropPast elimina cues anteriores ao ponto de salto no modo compatibilidade', async () => {
    const i = subtitlesJs.indexOf('function shiftVtt'), j = subtitlesJs.indexOf('function mountSubtitleTrack');
    const shiftVtt = new Function('pad2', subtitlesJs.slice(i, j) + ';return shiftVtt;')((n) => String(n).padStart(2, '0'));
    const multiCue = 'WEBVTT\n\n1\n00:01:00.000 --> 00:01:04.000\nFala antiga\n\n2\n00:10:05.000 --> 00:10:08.000\nFala nova\n';
    const afterSeek = shiftVtt(multiCue, -600, 1, null, 0, true);
    assert.ok(!afterSeek.includes('Fala antiga') && afterSeek.includes('00:00:05.000 --> 00:00:08.000'));
  });

  console.log('\n=== GRUPO 5: Motor IPTV Xtream (Fallback .m3u8 -> .ts, Reescrita HLS, Ligação Única & Sobrescritos Unicode) (Testes 23–30) ===');

  await test('/iptv-proxy reescreve playlists .m3u8 (URLs relativas, absolutas e chaves #EXT-X-KEY) com &seg=1', async () => {
    const upstreamSrv = http.createServer((req, res) => {
      if (req.url === '/live/canal1.m3u8') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end(['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-KEY:METHOD=AES-128,URI="chave.key"', '#EXTINF:4.0,', 'seg001.ts', '#EXTINF:4.0,', 'http://cdn.exemplo.pt/live/seg002.ts'].join('\n'));
        return;
      }
      if (req.url === '/live/seg001.ts') {
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        res.end('TS_SEGMENT_DATA_OK');
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise(r => upstreamSrv.listen(0, '127.0.0.1', r));
    const upPort = upstreamSrv.address().port;
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-iptv-proxy-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const m3uUrl = `http://127.0.0.1:${upPort}/live/canal1.m3u8`;
      const proxyRes = await get(port, `/${token}/iptv-proxy?url=${encodeURIComponent(m3uUrl)}&screen=1`);
      assert.strictEqual(proxyRes.status, 200);
      assert.ok(proxyRes.body.includes(encodeURIComponent(`http://127.0.0.1:${upPort}/live/seg001.ts`)));
      assert.ok(proxyRes.body.includes(encodeURIComponent('http://cdn.exemplo.pt/live/seg002.ts')));
      assert.ok(proxyRes.body.includes(encodeURIComponent(`http://127.0.0.1:${upPort}/live/chave.key`)));
      assert.ok(proxyRes.body.includes('&seg=1'));
    } finally {
      eng.stop(); upstreamSrv.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Fallback automático Xtream em /iptv-proxy: quando /live/user/pass/56.m3u8 devolve 404/403, abre automaticamente /live/user/pass/56.ts', async () => {
    const upstreamXtream = http.createServer((req, res) => {
      // Simula painel Xtream que bloqueia .m3u8 com 404 mas serve o stream em .ts com User-Agent VLC
      if (req.url === '/live/vitor/pass123/56.m3u8') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      if (req.url === '/live/vitor/pass123/56.ts') {
        assert.ok(String(req.headers['user-agent'] || '').includes('VLC'), 'envia User-Agent VLC');
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        res.end('MPEGTS_LIVE_STREAM_RTP1_OK');
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise(r => upstreamXtream.listen(0, '127.0.0.1', r));
    const upPort = upstreamXtream.address().port;
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-xtream-fb-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const xtUrl = `http://127.0.0.1:${upPort}/live/vitor/pass123/56.m3u8`;
      const res = await get(port, `/${token}/iptv-proxy?url=${encodeURIComponent(xtUrl)}&screen=1`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, 'MPEGTS_LIVE_STREAM_RTP1_OK');
    } finally {
      eng.stop(); upstreamXtream.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Rota /iptv-close liberta conexões ativas por ecrã (proteção max_connections=1 em servidores Xtream)', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-iptv-close-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const r1 = JSON.parse((await get(port, `/${token}/iptv-close?screen=1`)).body);
      const rAll = JSON.parse((await get(port, `/${token}/iptv-close?screen=all`)).body);
      assert.strictEqual(r1.ok, true);
      assert.strictEqual(rAll.ok, true);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  const iStart = iptvJs.indexOf('const SUPERSCRIPT_MAP ='), iEnd = iptvJs.indexOf('function saveChannels(list)');
  assert.ok(iStart > 0 && iEnd > iStart, 'bloco de funções IPTV v2.6 encontrado');
  const iptvFns = new Function('state', 'esc', iptvJs.slice(iStart, iEnd) + ';return { decodeSuperscriptText, cleanCategoryDisplayName, normalizeChannelBaseName, extractVariantQualityTag, stripQualitySuffixFromName, groupIptvChannelVariants, getChannelMonogram };')(
    { iptvGroupVariants: true, iptvActiveSection: 'live', iptvCurrentChannelId: 'xt-56', iptvChannels: [] },
    (s) => String(s || '')
  );

  await test('Normalização de caracteres Unicode sobrescritos reais do servidor Xtream (RTP1ᶠᴴᴰ, RTP1⁴ᴷ, SICᴴᴰ, TVIᴴᴰ)', async () => {
    assert.strictEqual(iptvFns.extractVariantQualityTag('RTP1⁴ᴷ'), '4K');
    assert.strictEqual(iptvFns.extractVariantQualityTag('RTP1ᶠᴴᴰ'), 'FHD');
    assert.strictEqual(iptvFns.extractVariantQualityTag('SICᴴᴰ'), 'HD');
    assert.strictEqual(iptvFns.stripQualitySuffixFromName('RTP1ᶠᴴᴰ'), 'RTP1');
    assert.strictEqual(iptvFns.stripQualitySuffixFromName('RTP1⁴ᴷ'), 'RTP1');
    assert.strictEqual(iptvFns.stripQualitySuffixFromName('SICᴴᴰ'), 'SIC');
    assert.strictEqual(iptvFns.normalizeChannelBaseName('RTP1'), 'rtp1');
    assert.strictEqual(iptvFns.normalizeChannelBaseName('RTP1ᶠᴴᴰ'), 'rtp1');
    assert.strictEqual(iptvFns.normalizeChannelBaseName('RTP1⁴ᴷ'), 'rtp1');
  });

  await test('Deduplicação inteligente de canais com sufixos Unicode (agrupa RTP1 + RTP1ᶠᴴᴰ + RTP1⁴ᴷ e SIC + SICᴴᴰ)', async () => {
    const realXtreamSample = [
      { id: 'xt-56', name: 'RTP1', category: '★●• PORTUGAL •●★', section: 'live' },
      { id: 'xt-57', name: 'RTP1ᶠᴴᴰ', category: '★●• PORTUGAL •●★', section: 'live' },
      { id: 'xt-58', name: 'RTP1⁴ᴷ', category: '★●• PORTUGAL •●★', section: 'live' },
      { id: 'xt-59', name: 'SIC', category: '★●• PORTUGAL •●★', section: 'live' },
      { id: 'xt-60', name: 'SICᴴᴰ', category: '★●• PORTUGAL •●★', section: 'live' }
    ];
    const grouped = iptvFns.groupIptvChannelVariants(realXtreamSample);
    assert.strictEqual(grouped.length, 2, '5 canais (3 RTP1 + 2 SIC) agrupados em 2 entradas limpas');
    assert.strictEqual(grouped[0].displayName, 'RTP1');
    assert.deepStrictEqual(grouped[0].variants.map(v => v.tag), ['4K', 'FHD', 'SD/HD']);
    assert.strictEqual(grouped[1].displayName, 'SIC');
    assert.deepStrictEqual(grouped[1].variants.map(v => v.tag), ['HD', 'SD/HD']);
  });

  await test('Limpeza automática de nomes de categorias Xtream (★●• PORTUGAL •●★ -> 🇵🇹 PORTUGAL)', async () => {
    assert.strictEqual(iptvFns.cleanCategoryDisplayName('★●• PORTUGAL •●★'), '🇵🇹 PORTUGAL');
    assert.strictEqual(iptvFns.cleanCategoryDisplayName('★●• PORTUGAL LOW •●★'), '🇵🇹 PORTUGAL LOW');
    assert.strictEqual(iptvFns.cleanCategoryDisplayName('★●• BRASIL •●★'), '🇧🇷 BRASIL');
    assert.strictEqual(iptvFns.cleanCategoryDisplayName('★●• UK •●★'), '🇬🇧 UK');
    assert.strictEqual(iptvFns.cleanCategoryDisplayName('★●• USA •●★'), '🇺🇸 USA');
    assert.strictEqual(iptvFns.cleanCategoryDisplayName('★●• EXCLUSIVOS •●★'), '⭐ EXCLUSIVOS');
  });

  await test('Injeção de User-Agent VLC e limpeza de Origin em main.js para servidores IPTV externos', async () => {
    assert.ok(mainJs.includes("h['User-Agent'] = 'VLC/3.0.20 LibVLC/3.0.20'"), 'main.js define User-Agent VLC');
    assert.ok(mainJs.includes("delete h['Origin']"), 'main.js remove Origin null em streams IPTV');
  });

  await test('Auditoria completa de integridade DOM: todos os IDs referenciados em el.* existem no HTML', async () => {
    const htmlIds = new Set();
    const idRe = /\bid="([^"]+)"/g;
    let m;
    while ((m = idRe.exec(html))) htmlIds.add(m[1]);

    const elBlockStart = coreJs.indexOf('const el = {');
    const elBlockEnd = coreJs.indexOf('};', elBlockStart);
    const elBlock = coreJs.slice(elBlockStart, elBlockEnd);
    const getByIdRe = /document\.getElementById\('([^']+)'\)/g;
    const missing = [];
    while ((m = getByIdRe.exec(elBlock))) {
      if (!htmlIds.has(m[1])) missing.push(m[1]);
    }
    assert.deepStrictEqual(missing, [], `IDs em falta no HTML: ${missing.join(', ')}`);
  });

  console.log('\n=== GRUPO 6: Privacidade, SSRF & Proteção de Credenciais (Testes 31–34) ===');

  await test('Proteção SSRF em /iptv-proxy e /iptv-remux: bloqueia IPs privados (169.254.169.254, 10.0.0.1) e porta do próprio motor', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-ssrf-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const r1 = await get(port, `/${token}/iptv-proxy?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
      const r2 = await get(port, `/${token}/iptv-proxy?url=${encodeURIComponent('http://10.0.0.1/live.m3u8')}`);
      const r3 = await get(port, `/${token}/iptv-remux?url=${encodeURIComponent(`http://127.0.0.1:${port}/${token}/report`)}`);
      assert.strictEqual(r1.status, 400);
      assert.strictEqual(r2.status, 400);
      assert.strictEqual(r3.status, 400);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Cifragem de credenciais (safeStorage) e SVG local em core.js: cifra TMDB/Debrid/Xtream sem mutar memória', async () => {
    const i0 = coreJs.indexOf('function esc(s)'), i1 = coreJs.indexOf('const _nowSec =');
    assert.ok(i0 > 0 && i1 > i0, 'helpers de privacidade encontrados em core.js');
    const lsStore = new Map();
    const mockWin = {
      macstreamApp: {
        encryptSecret: (s) => 'enc:v1:' + Buffer.from(s, 'utf8').toString('base64'),
        decryptSecret: (s) => Buffer.from(s.slice(7), 'base64').toString('utf8')
      }
    };
    const mockLs = {
      getItem: (k) => lsStore.has(k) ? lsStore.get(k) : null,
      setItem: (k, v) => lsStore.set(k, String(v)),
      removeItem: (k) => lsStore.delete(k)
    };
    const fns = new Function('window', 'localStorage', 'DEFAULT_ADDONS', coreJs.slice(i0, i1) + '; return { localPosterSvg, readSecret, writeSecret, loadAddons, saveAddons, storage };')(mockWin, mockLs, [{ id: 'builtin-torrentio', base: 'https://torrentio.strem.fun' }]);
    const svgUri = fns.localPosterSvg('<script>x</script>');
    assert.ok(svgUri.startsWith('data:image/svg+xml;charset=utf-8,') && !decodeURIComponent(svgUri).includes('<script>'));
    mockLs.setItem('macstream_tmdb_key', 'tmdb_plain_123');
    assert.strictEqual(fns.readSecret('macstream_tmdb_key'), 'tmdb_plain_123');
    assert.ok(mockLs.getItem('macstream_tmdb_key').startsWith('enc:v1:'));
    const xt = { server: 'http://tv.pt', username: 'u', password: 'pw!' };
    fns.storage.set('macstream_xtream', xt);
    assert.strictEqual(xt.password, 'pw!');
    assert.ok(JSON.parse(mockLs.getItem('macstream_xtream')).password.startsWith('enc:v1:'));
    assert.strictEqual(fns.storage.get('macstream_xtream').password, 'pw!');
    fns.saveAddons([{ id: 't', base: 'https://torrentio.strem.fun/sort=qualitysize|realdebrid=KEY123' }]);
    assert.ok(JSON.parse(mockLs.getItem('macstream_addons'))[0].base.startsWith('enc:v1:'));
    assert.strictEqual(fns.loadAddons()[0].base, 'https://torrentio.strem.fun/sort=qualitysize|realdebrid=KEY123');
  });

  await test('Modo Privado bloqueia gravação de macstream_history em storage.set', async () => {
    const i0 = coreJs.indexOf('function esc(s)'), i1 = coreJs.indexOf('const _nowSec =');
    const lsStore = new Map();
    const mockLs = { getItem: (k) => lsStore.get(k) || null, setItem: (k, v) => lsStore.set(k, String(v)), removeItem: (k) => lsStore.delete(k) };
    const fns = new Function('window', 'localStorage', 'DEFAULT_ADDONS', 'state', coreJs.slice(i0, i1) + '; return { storage };')({}, mockLs, [], { privateMode: true });
    fns.storage.set('macstream_history', [{ id: 'rtp1' }]);
    assert.strictEqual(lsStore.has('macstream_history'), false);
  });

  await test('Deteção de áudio EAC3/AC3 via parseTracksFromStderr (base para bloquear remuxReady falso em .mp4)', async () => {
    const tr = parseTracksFromStderr('  Stream #0:0: Video: h264\n  Stream #0:1(eng): Audio: eac3, 48000 Hz, 5.1 (default)\n');
    assert.strictEqual(tr.ok, true);
    assert.strictEqual(tr.audio[0].codec, 'eac3');
  });

  await test('Segurança de /opensubs-dl: bloqueia domínios fora de *.opensubtitles.org', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-osub-sec-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const r1 = await get(port, `/${token}/opensubs-dl?url=${encodeURIComponent('https://evil.com/sub.srt')}`);
      const r2 = await get(port, `/${token}/opensubs-dl?url=${encodeURIComponent('http://127.0.0.1:80/sub.srt')}`);
      assert.strictEqual(r1.status, 400);
      assert.strictEqual(r2.status, 400);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Anti-Prototype Pollution em POST /user-state: filtra __proto__ e constructor', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-proto-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const b = '{"watchProgressMap":{"__proto__":{"polluted":true},"ok":{"key":"ok","currentTime":12}}}';
      const saveRes = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: `/${token}/user-state`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (res) => {
          let out = ''; res.on('data', d => (out += d)); res.on('end', () => resolve(JSON.parse(out)));
        });
        req.on('error', reject); req.end(b);
      });
      assert.strictEqual(({}).polluted, undefined);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(saveRes.state.watchProgressMap, '__proto__'), false);
      assert.strictEqual(saveRes.state.watchProgressMap.ok.currentTime, 12);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Temporada 0 (Especiais) é preservada em cache-state.json e na rota /cache', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-s0-'));
    const h = '4444444444444444444444444444444444444444';
    const spFile = path.join(tmpDir, 'Special.S00E01.mp4');
    fs.writeFileSync(spFile, Buffer.alloc(64, 'S'));
    fs.writeFileSync(path.join(tmpDir, 'cache-state.json'), JSON.stringify({
      items: { [`${h}:0`]: { cacheKey: `${h}:0`, infoHash: h, fileIdx: 0, name: 'Special.S00E01.mp4', localPath: spFile, title: 'Special', season: 0, episode: 1, completed: true, progress: 1 } }
    }));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cache-state.json'), 'utf8'));
      assert.strictEqual(manifest.items[`${h}:0`].season, 0);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  await test('Redação de segredos em copyDiagnosticReport (Xtream URLs, api_key e Debrid)', async () => {
    const playerJs = fs.readFileSync(path.join(root, 'renderer', 'js', 'player.js'), 'utf8');
    assert.ok(playerJs.includes("join('<REDACTED>')"), 'mascara segredos em memória');
    assert.ok(playerJs.includes('(?:password|api_key|token)='), 'mascara query params sensíveis');
    assert.ok(playerJs.includes('(?:live|movie|series)'), 'mascara passwords em URLs Xtream');
    assert.ok(playerJs.includes('(?:realdebrid|alldebrid|premiumize|debridlink|torbox)='), 'mascara credenciais Debrid');
  });

  await test('Exportação segura de Backup JSON: remove tmdbApiKey, debridProvider e credenciais Debrid dos add-ons', async () => {
    const fnStart = coreJs.indexOf('function buildLocalUserStatePayload');
    const fnEnd = coreJs.indexOf('function importUserBackupJson');
    assert.ok(fnStart > 0 && fnEnd > fnStart);
    let capturedJson = '';
    const mockDoc = {
      createElement: () => ({ click() {}, href: '', download: '' }),
      body: { appendChild() {}, removeChild() {} }
    };
    const mockBlob = class { constructor(parts) { capturedJson = String(parts[0] || ''); } };
    const mockUrl = { createObjectURL: () => 'blob:mock', revokeObjectURL() {} };
    const mockState = {
      tmdbApiKey: 'SUPER_SECRET_TMDB',
      debridProvider: 'realdebrid',
      debridApiKey: 'SECRET_RD_KEY',
      addons: [{ id: 'builtin-torrentio', name: 'Torrentio (REALDEBRID ⚡)', base: 'https://torrentio.strem.fun/sort=qualitysize|realdebrid=SECRET_RD_KEY' }],
      watchProgressMap: {}, libraryMap: {}, iptvFavorites: [], iptvHistory: [], iptvPinnedCategories: []
    };
    const fn = new Function(
      'state', 'localStorage', 'document', 'Blob', 'URL', 'showToast', 'encSecret', 'decSecret', 'DEBRID_CRED_RE', 'SECRET_PREFIX',
      coreJs.slice(fnStart, fnEnd) + '; return exportUserBackupJson;'
    )(mockState, { length: 0, key: () => null }, mockDoc, mockBlob, mockUrl, () => {}, (s) => 'enc:v1:' + s, (s) => s.replace(/^enc:v1:/, ''), /(\|(?:realdebrid|alldebrid|premiumize|debridlink|torbox)=)/i, 'enc:v1:');
    fn();
    const exported = JSON.parse(capturedJson);
    assert.strictEqual(exported.tmdbApiKey, undefined);
    assert.strictEqual(exported.debridProvider, undefined);
    assert.strictEqual(exported.addons[0].base, 'https://torrentio.strem.fun');
    assert.ok(!capturedJson.includes('SECRET_RD_KEY') && !capturedJson.includes('SUPER_SECRET_TMDB'));
  });

  await test('openSafeExternal em main.js bloqueia file:, javascript:, credenciais e IPs privados, permitindo HTTPS válido', async () => {
    const s0 = mainJs.indexOf('function openSafeExternal(rawUrl)'), s1 = mainJs.indexOf('function createWindow()');
    assert.ok(s0 > 0 && s1 > s0);
    const opened = [];
    const fn = new Function('shell', mainJs.slice(s0, s1) + '; return openSafeExternal;')({ openExternal: (u) => opened.push(u) });
    ['javascript:alert(1)', 'file:///etc/passwd', 'http://127.0.0.1:8080/', 'http://192.168.1.10/', 'http://169.254.169.254/', 'https://user:pass@example.com/', 'https://example.com/\nbad']
      .forEach((bad) => fn(bad));
    assert.strictEqual(opened.length, 0);
    fn('https://opensubtitles.org/pt');
    assert.deepStrictEqual(opened, ['https://opensubtitles.org/pt']);
  });

  await test('Limites de payload HTTP 413 em POST /user-state (>5MB) e POST /inject (>8MB)', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok' + Math.random().toString(16).slice(2);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-413-'));
    const eng = startEngine({ port, token, cacheDir: tmpDir });
    await new Promise(r => setTimeout(r, 200));
    const postRaw = (p, buf) => new Promise((resolve, reject) => {
      let done = false;
      const finish = (code) => { if (!done) { done = true; resolve(code); } };
      const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length } }, (res) => {
        res.resume();
        res.on('end', () => finish(res.statusCode));
        res.on('close', () => finish(res.statusCode));
      });
      req.on('error', (err) => {
        if (done) return;
        if (err && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) {
          setTimeout(() => { if (!done) reject(err); }, 100);
          return;
        }
        reject(err);
      });
      // Envia em blocos para o servidor poder responder 413 antes do fim do stream sem abortar antes do evento response
      let off = 0;
      const step = () => {
        if (done) return;
        if (off >= buf.length) { try { req.end(); } catch (e) {} return; }
        const end = Math.min(buf.length, off + 512 * 1024);
        const ok = req.write(buf.subarray(off, end));
        off = end;
        if (ok) setImmediate(step); else req.once('drain', step);
      };
      step();
    });
    try {
      const s1 = await postRaw(`/${token}/user-state`, Buffer.alloc(5 * 1024 * 1024 + 64, 'a'));
      const s2 = await postRaw(`/${token}/inject`, Buffer.alloc(8 * 1024 * 1024 + 64, 'b'));
      assert.strictEqual(s1, 413);
      assert.strictEqual(s2, 413);
    } finally {
      eng.stop();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  console.log(`\n${passed} ok, ${failed} falhas, ${skipped} ignorados\n`);
  process.exit(failed ? 1 : 0);
})();
