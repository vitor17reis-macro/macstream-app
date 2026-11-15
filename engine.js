'use strict';
// Motor de streaming P2P MacStream v3.0 (TCP + uTP + DHT + Cache Persistente Isolada + Fast Seek Direto em Disco + Auto-Remux MP4 + Calibração de Áudio)
const http = require('http');
const https = require('https');
const dns = require('dns');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebTorrent = require('webtorrent');

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://udp.tracker.projectk.org:23333/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://retracker.lanta-net.ru:2710/announce',
  'udp://bt1.archive.org:6969/announce',
  'https://tracker.tamersunion.org:443/announce',
  'https://tracker.loligirl.cn:443/announce'
];

const VIDEO_RE = /\.(mp4|m4v|webm|mov|mkv|avi|ogv|ts|m2ts)$/i;
const SUB_FILE_RE = /\.(srt|vtt|ass|ssa)$/i;
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg', ts: 'video/mp2t', m2ts: 'video/mp2t'
};

function extractInfoHash(input) {
  if (typeof input !== 'string') return null;
  const m40 = input.match(/(?:btih:|^)([a-fA-F0-9]{40})(?:&|$)/i);
  if (m40) return m40[1].toLowerCase();
  return null;
}

function parseEpisodeCodesFromText(str) {
  const s = String(str || '');
  const out = [];
  // Suporta códigos simples e episódios duplos/múltiplos: S04E01, S04E01E02, S04E01-E02, S04E01-02, S04E03.E04
  const reSE = /\bs0*(\d{1,2})[._\s-]*e0*(\d{1,3})(?:(?:[._\s-]*(?:e|ep)0*(\d{1,3})|\s*-\s*0*(\d{1,3}))(?:[._\s-]*(?:e|ep)0*(\d{1,3}))?)?\b/gi;
  let m;
  while ((m = reSE.exec(s))) {
    const sea = parseInt(m[1], 10);
    const ep1 = parseInt(m[2], 10);
    const ep2Str = m[3] || m[4];
    const isMulti = Boolean(ep2Str);
    out.push({ season: sea, episode: ep1, explicitSeason: true, isMulti });
    if (ep2Str) {
      const ep2 = parseInt(ep2Str, 10);
      if (ep2 >= ep1 && ep2 - ep1 <= 4) {
        for (let e = ep1 + 1; e <= ep2; e++) {
          out.push({ season: sea, episode: e, explicitSeason: true, isMulti: true });
        }
      } else if (ep2 > 0) {
        out.push({ season: sea, episode: ep2, explicitSeason: true, isMulti: true });
      }
    }
    if (m[5]) {
      out.push({ season: sea, episode: parseInt(m[5], 10), explicitSeason: true, isMulti: true });
    }
  }
  const reX = /\b0*(\d{1,2})x0*(\d{2,3})(?:[._\s-]*(?:x)?0*(\d{2,3}))?\b/gi;
  while ((m = reX.exec(s))) {
    const sea = parseInt(m[1], 10);
    const ep1 = parseInt(m[2], 10);
    const isMulti = Boolean(m[3]);
    out.push({ season: sea, episode: ep1, explicitSeason: true, isMulti });
    if (m[3]) {
      const ep2 = parseInt(m[3], 10);
      if (ep2 > 0) out.push({ season: sea, episode: ep2, explicitSeason: true, isMulti: true });
    }
  }
  if (!out.length) {
    const reEpOnly = /\b(?:ep(?:isode|isodio)?[._\s-]*|e)0*(\d{1,3})\b/gi;
    while ((m = reEpOnly.exec(s))) {
      const ep = parseInt(m[1], 10);
      if (ep > 0 && ep < 200 && !/^(264|265|720|480)$/.test(m[1])) {
        out.push({ season: null, episode: ep, explicitSeason: false, isMulti: false });
      }
    }
  }
  return out;
}

function fileHasConflictingEpisode(fileName, season, episode) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return false;
  const codes = parseEpisodeCodesFromText(fileName);
  if (!codes.length) return false;
  // Se algum código explícito coincidir com o episódio pedido, não há conflito (ex: ficheiro multi-ep S01E01-E02)
  if (codes.some(c => (c.season === null || c.season === season) && c.episode === episode)) return false;
  return codes.some(c => (c.explicitSeason && (c.season !== season || c.episode !== episode)) || (!c.explicitSeason && c.episode !== episode));
}

// Calcula o hash oficial de 64 bits do OpenSubtitles (OSDB MovieHash usado pelo Stremio):
// soma uint64 little-endian do tamanho total do ficheiro + primeiros 64 KB + últimos 64 KB.
// Converte o output do filtro nativo silencedetect do FFmpeg em intervalos de fala [início, fim]
// Método comprovado: yama6a/subtitle-toolbox-php (SpeechReference::fromFfmpegSilencedetect) & edde746/plezy#2780
function parseSilencedetectToSpeech(stderrText, winStart = 0, winDur = 90) {
  const silences = [];
  let curStart = null;
  const lines = String(stderrText || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ms = /silence_start:\s*(-?[\d.]+)/.exec(lines[i]);
    if (ms) {
      curStart = Math.max(0, parseFloat(ms[1]));
      continue;
    }
    const me = /silence_end:\s*(-?[\d.]+)/.exec(lines[i]);
    if (me && curStart !== null) {
      const endVal = Math.min(winDur, Math.max(curStart, parseFloat(me[1])));
      silences.push([curStart, endVal]);
      curStart = null;
    }
  }
  if (curStart !== null && curStart < winDur) {
    silences.push([curStart, winDur]);
  }
  const speech = [];
  let prev = 0;
  for (let i = 0; i < silences.length; i++) {
    const [s, e] = silences[i];
    const segLen = s - prev;
    // Ignora blocos contínuos > 8.5s sem nenhuma pausa de respiração (ex: genérico musical de 32s de The Office)
    if (segLen >= 0.22 && segLen <= 8.5) {
      speech.push([+(winStart + prev).toFixed(2), +(winStart + s).toFixed(2)]);
    }
    if (e > prev) prev = e;
  }
  const tailLen = winDur - prev;
  if (tailLen >= 0.22 && tailLen <= 8.5) {
    speech.push([+(winStart + prev).toFixed(2), +(winStart + winDur).toFixed(2)]);
  }
  return speech;
}

// Deteta automaticamente o bloco musical contínuo do genérico (Intro / Theme Song, ex: 15s a 90s sem pausas de fala nos primeiros 3.5 min)
function detectIntroFromSilenceLog(stderrText, winStart = 0, winDur = 210) {
  const silences = [];
  let curStart = null;
  const lines = String(stderrText || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ms = /silence_start:\s*(-?[\d.]+)/.exec(lines[i]);
    if (ms) {
      curStart = Math.max(0, parseFloat(ms[1]));
      continue;
    }
    const me = /silence_end:\s*(-?[\d.]+)/.exec(lines[i]);
    if (me && curStart !== null) {
      const endVal = Math.min(winDur, Math.max(curStart, parseFloat(me[1])));
      silences.push([curStart, endVal]);
      curStart = null;
    }
  }
  if (curStart !== null && curStart < winDur) {
    silences.push([curStart, winDur]);
  }
  const candidates = [];
  let prev = 0;
  for (let i = 0; i < silences.length; i++) {
    const [st, en] = silences[i];
    const segLen = st - prev;
    if (segLen >= 14.0 && segLen <= 92.0 && (winStart + prev) <= 210) {
      candidates.push({
        startSec: +(winStart + prev).toFixed(1),
        endSec: +(winStart + st).toFixed(1),
        duration: +segLen.toFixed(1)
      });
    }
    if (en > prev) prev = en;
  }
  const tailLen = winDur - prev;
  if (tailLen >= 14.0 && tailLen <= 92.0 && (winStart + prev) <= 210) {
    candidates.push({
      startSec: +(winStart + prev).toFixed(1),
      endSec: +(winStart + winDur).toFixed(1),
      duration: +tailLen.toFixed(1)
    });
  }
  if (!candidates.length) return { ok: false };
  // Escolhe o bloco musical contínuo mais representativo (preferindo 20s..50s típico de sitcoms/séries)
  candidates.sort((a, b) => {
    const aIdeal = (a.duration >= 18 && a.duration <= 55) ? 1 : 0;
    const bIdeal = (b.duration >= 18 && b.duration <= 55) ? 1 : 0;
    if (aIdeal !== bIdeal) return bIdeal - aIdeal;
    return b.duration - a.duration;
  });
  return { ok: true, ...candidates[0], source: 'acoustic-theme' };
}

// Consulta direta à API REST do OpenSubtitles.org (devolve SubFileName, MovieReleaseName e MatchedBy='moviehash')
function httpsJsonGet(urlStr, headers = {}, timeoutMs = 4500, redirectsLeft = 4) {
  return new Promise((resolve) => {
    if (redirectsLeft < 0) return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      const req = https.get(urlStr, {
        headers: {
          'User-Agent': 'TemporaryUserAgent',
          'X-User-Agent': 'TemporaryUserAgent',
          'Accept': 'application/json',
          ...headers
        },
        timeout: timeoutMs
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          clearTimeout(timer);
          let nextUrl = res.headers.location;
          try { nextUrl = new URL(nextUrl, urlStr).toString(); } catch (e) { return finish(null); }
          return httpsJsonGet(nextUrl, headers, timeoutMs, redirectsLeft - 1).then(finish);
        }
        if (res.statusCode !== 200) {
          res.resume();
          clearTimeout(timer);
          return finish(null);
        }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const raw = Buffer.concat(chunks);
            const txt = (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b)
              ? zlib.gunzipSync(raw, { maxOutputLength: 10 * 1024 * 1024 }).toString('utf8')
              : raw.toString('utf8');
            finish(JSON.parse(txt));
          } catch (e) { finish(null); }
        });
      });
      req.on('error', () => { clearTimeout(timer); finish(null); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); finish(null); });
    } catch (e) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

function computeOsdbHashFromBuffers(fileSize, headBuf, tailBuf) {
  const CHUNK = 65536;
  if (!headBuf || !tailBuf || headBuf.length < CHUNK || tailBuf.length < CHUNK || !(fileSize >= CHUNK * 2)) {
    return null;
  }
  const MASK64 = 0xFFFFFFFFFFFFFFFFn;
  let hash = BigInt(fileSize) & MASK64;
  const addChunk = (buf) => {
    const dv = new DataView(buf.buffer, buf.byteOffset, CHUNK);
    for (let i = 0; i < CHUNK; i += 8) {
      hash = (hash + dv.getBigUint64(i, true)) & MASK64;
    }
  };
  addChunk(headBuf);
  addChunk(tailBuf);
  return hash.toString(16).padStart(16, '0');
}

function computeOsdbHashFromDiskFile(diskPath) {
  const CHUNK = 65536;
  let fd = null;
  try {
    const st = fs.statSync(diskPath);
    if (!st || st.size < CHUNK * 2) return null;
    fd = fs.openSync(diskPath, 'r');
    const head = Buffer.allocUnsafe(CHUNK);
    const tail = Buffer.allocUnsafe(CHUNK);
    const r1 = fs.readSync(fd, head, 0, CHUNK, 0);
    const r2 = fs.readSync(fd, tail, 0, CHUNK, st.size - CHUNK);
    fs.closeSync(fd);
    fd = null;
    if (r1 < CHUNK || r2 < CHUNK) return null;
    return computeOsdbHashFromBuffers(st.size, head, tail);
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch (x) {} }
    return null;
  }
}

function fileMatchesEpisode(fileName, season, episode) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return false;
  if (fileHasConflictingEpisode(fileName, season, episode)) return false;
  const codes = parseEpisodeCodesFromText(fileName);
  return codes.some(c => (c.season === season && c.episode === episode) || (c.season === null && c.episode === episode));
}

function buildCleanInput(magnetOrBuf) {
  if (typeof magnetOrBuf !== 'string') return { target: magnetOrBuf, announce: TRACKERS };
  const extra = [];
  const re = /[?&]tr=([^&]+)/gi;
  let m;
  while ((m = re.exec(magnetOrBuf))) {
    try {
      const tr = decodeURIComponent(m[1]).trim();
      if (/^(udp|https?):\/\//i.test(tr)) extra.push(tr);
    } catch (e) {}
  }
  const announce = Array.from(new Set([...extra, ...TRACKERS]));
  const hash = extractInfoHash(magnetOrBuf);
  const dnMatch = /[?&]dn=([^&]+)/i.exec(magnetOrBuf);
  const dn = dnMatch ? dnMatch[1] : 'video';
  let cleanMagnet = hash ? `magnet:?xt=urn:btih:${hash}&dn=${dn}` : magnetOrBuf.replace(/&tr=wss?%3A[^&]*/gi, '').replace(/&tr=wss?:[^&]*/gi, '');
  if (hash) {
    announce.forEach(tr => { cleanMagnet += '&tr=' + encodeURIComponent(tr); });
  }
  return { target: cleanMagnet, announce };
}

function isValidTorrentBuffer(buf) {
  return Boolean(buf && buf.length > 40 && buf[0] === 0x64 && buf.includes(Buffer.from('4:infod')));
}

function httpGetFollowRedirects(urlStr, timeoutMs = 3500, redirectsLeft = 5) {
  return new Promise((resolve) => {
    if (redirectsLeft < 0) return resolve(null);
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      const mod = urlStr.startsWith('https:') ? https : http;
      const req = mod.get(urlStr, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': '*/*'
        },
        timeout: timeoutMs
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          clearTimeout(timer);
          let nextUrl = res.headers.location;
          try { nextUrl = new URL(nextUrl, urlStr).toString(); } catch (e) { return done(null); }
          return httpGetFollowRedirects(nextUrl, timeoutMs, redirectsLeft - 1).then(done);
        }
        if (res.statusCode !== 200) {
          res.resume();
          clearTimeout(timer);
          return done(null);
        }
        const chunks = [];
        let len = 0;
        res.on('data', (d) => {
          len += d.length;
          if (len > 6 * 1024 * 1024) { req.destroy(); clearTimeout(timer); return done(null); }
          chunks.push(d);
        });
        res.on('end', () => {
          clearTimeout(timer);
          try {
            let buf = Buffer.concat(chunks);
            if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
              buf = zlib.gunzipSync(buf, { maxOutputLength: 10 * 1024 * 1024 });
            }
            done(isValidTorrentBuffer(buf) ? buf : null);
          } catch (e) {
            done(null);
          }
        });
      });
      req.on('error', () => { clearTimeout(timer); done(null); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); done(null); });
    } catch (e) {
      clearTimeout(timer);
      done(null);
    }
  });
}

const torrentBufCache = new Map();
const pendingBufWaiters = new Map();

function notifyTorrentBufWaiters(hash, buf) {
  if (!hash || !isValidTorrentBuffer(buf)) return;
  const key = hash.toLowerCase();
  torrentBufCache.set(key, buf);
  const waiters = pendingBufWaiters.get(key);
  if (waiters) {
    pendingBufWaiters.delete(key);
    waiters.forEach(fn => { try { fn(buf); } catch (e) {} });
  }
}

function fetchCachedTorrentBuffer(infoHash, timeoutMs = 4000, onRequestTorrentBuf = null) {
  if (!infoHash || !/^[a-f0-9]{40}$/i.test(infoHash)) return Promise.resolve(null);
  const key = infoHash.toLowerCase();
  if (torrentBufCache.has(key)) return Promise.resolve(torrentBufCache.get(key));
  if (typeof onRequestTorrentBuf === 'function') {
    try { onRequestTorrentBuf(key); } catch (e) {}
  }
  const H = infoHash.toUpperCase();
  const urls = [
    `https://itorrents.org/torrent/${H}.torrent`,
    `https://watercache.nanobytes.org/get/${key}`,
    `https://torrage.info/torrent.php?h=${H}`,
    `https://btcache.me/torrent/${H}`
  ];
  return new Promise((resolve) => {
    let settled = false;
    let pending = urls.length;
    const finish = (buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const list = pendingBufWaiters.get(key);
      if (list) list.delete(onInjected);
      if (isValidTorrentBuffer(buf)) torrentBufCache.set(key, buf);
      resolve(isValidTorrentBuffer(buf) ? buf : null);
    };
    const onInjected = (buf) => {
      if (isValidTorrentBuffer(buf)) finish(buf);
    };
    if (!pendingBufWaiters.has(key)) pendingBufWaiters.set(key, new Set());
    pendingBufWaiters.get(key).add(onInjected);

    const timer = setTimeout(() => finish(null), timeoutMs);
    const onResult = (buf) => {
      if (settled) return;
      if (isValidTorrentBuffer(buf)) return finish(buf);
      pending--;
      if (pending <= 0) finish(null);
    };
    urls.forEach(u => httpGetFollowRedirects(u, timeoutMs).then(onResult));
  });
}

function parseTracksFromStderr(err) {
  const dm = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0;
  const audio = [];
  const subs = [];
  let video = '';
  err.split(/\n(?=\s+Stream #)/).forEach(block => {
    const head = block.split('\n')[0];
    const vm = /Stream #\d+:\d+[^:]*: Video: (\w+)/.exec(head);
    if (vm && !video) video = vm[1].toLowerCase();
    const am = /Stream #\d+:\d+(?:\((\w+)\))?[^:]*: Audio: (\w+)[^,]*, (\d+) Hz, ([^,]+)/.exec(head);
    if (am) {
      const tm = /title\s*:\s*(.+)/.exec(block);
      audio.push({
        n: audio.length,
        lang: (am[1] || 'und').toLowerCase(),
        codec: (am[2] || '').toLowerCase(),
        ch: am[4].replace(/\(.*\)/, '').trim(),
        title: tm ? tm[1].trim() : '',
        def: /\(default\)/.test(head)
      });
    }
    const sm = /Stream #\d+:\d+(?:\(([\w-]+)\))?[^:]*: Subtitle: (\w+)/.exec(head);
    if (sm) {
      const sCodec = (sm[2] || '').toLowerCase();
      if (['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'].includes(sCodec)) {
        const tm = /title\s*:\s*(.+)/.exec(block);
        subs.push({
          n: subs.length,
          lang: (sm[1] || 'und').toLowerCase(),
          codec: sCodec,
          title: tm ? tm[1].trim() : '',
          def: /\(default\)/i.test(head),
          forced: /\(forced\)/i.test(head) || (tm ? /forced/i.test(tm[1]) : false)
        });
      }
    }
  });
  const chapters = [];
  const chRe = /Chapter #\d+:\d+:\s*start\s*([\d.]+),\s*end\s*([\d.]+)[\s\S]*?(?:title\s*:\s*([^\r\n]+))?(?=\r?\n\s*(?:Chapter #|Stream #|$))/gi;
  let cm;
  while ((cm = chRe.exec(err))) {
    const cStart = parseFloat(cm[1]);
    const cEnd = parseFloat(cm[2]);
    const cTitle = (cm[3] || '').trim();
    if (isFinite(cStart) && isFinite(cEnd) && cEnd > cStart) {
      chapters.push({ startSec: +cStart.toFixed(1), endSec: +cEnd.toFixed(1), duration: +(cEnd - cStart).toFixed(1), title: cTitle });
    }
  }
  let intro = null;
  const namedIntro = chapters.find(c => c.startSec <= 240 && c.duration >= 10 && c.duration <= 110 && /\b(intro|opening|op|theme|abertura|gen[eé]rico|credits)\b/i.test(c.title || ''));
  if (namedIntro) {
    intro = { ok: true, startSec: namedIntro.startSec, endSec: namedIntro.endSec, duration: namedIntro.duration, source: 'chapter-title' };
  } else {
    const durIntro = chapters.find(c => c.startSec <= 210 && c.duration >= 18 && c.duration <= 50);
    if (durIntro && chapters.length >= 3) {
      intro = { ok: true, startSec: durIntro.startSec, endSec: durIntro.endSec, duration: durIntro.duration, source: 'chapter-length' };
    }
  }
  return { ok: duration > 0 || audio.length > 0, duration, audio, subs, video, chapters, intro };
}

function startEngine({ port = 11471, ffmpegPath = null, cacheDir, token = '', onRequestTorrentBuf = null } = {}) {
  const SELF = `http://127.0.0.1:${port}${token ? '/' + token : ''}`;
  const LOG = [];
  const activeProcs = new Set();
  const transcodeProcs = new Set();
  const envelopeProcs = new Set();
  const introProcs = new Set();
  const probeProcs = new Set();
  const remuxProcs = new Map();
  const iptvProcs = new Map();
  const iptvProxyReqs = new Map();
  const closeIptvScreen = (screenId) => {
    const sid = String(screenId || '1');
    if (iptvProcs.has(sid)) {
      const oldP = iptvProcs.get(sid);
      try { oldP.kill('SIGKILL'); } catch (x) {}
      activeProcs.delete(oldP);
      iptvProcs.delete(sid);
    }
    if (iptvProxyReqs.has(sid)) {
      const oldReq = iptvProxyReqs.get(sid);
      try { oldReq.destroy(); } catch (x) {}
      iptvProxyReqs.delete(sid);
    }
  };

  const runFF = (args, opts, group) => {
    if (group === probeProcs && probeProcs.size >= 4) {
      const oldest = probeProcs.values().next().value;
      if (oldest) {
        try { oldest.kill('SIGKILL'); } catch (e) {}
        probeProcs.delete(oldest);
        activeProcs.delete(oldest);
      }
    }
    const p = spawn(ffmpegPath, args, opts);
    activeProcs.add(p);
    if (group) group.add(p);
    const clean = () => { activeProcs.delete(p); if (group) group.delete(p); };
    p.on('close', clean);
    p.on('error', clean);
    return p;
  };
  const killGroup = (group) => {
    for (const p of group) { try { p.kill('SIGKILL'); } catch (e) {} activeProcs.delete(p); }
    group.clear();
  };
  const killPlaybackProcs = () => {
    killGroup(transcodeProcs);
    killGroup(envelopeProcs);
    killGroup(introProcs);
    for (const [, p] of iptvProcs) { try { p.kill("SIGKILL"); } catch (e) {} activeProcs.delete(p); }
    iptvProcs.clear();
  };
  const killAllProcs = () => {
    for (const p of activeProcs) { try { p.kill('SIGKILL'); } catch (e) {} }
    for (const [, p] of remuxProcs) { try { p.kill('SIGKILL'); } catch (e) {} }
    activeProcs.clear();
    transcodeProcs.clear();
    envelopeProcs.clear();
    introProcs.clear();
    probeProcs.clear();
    remuxProcs.clear();
  };

  const origErr = console.error.bind(console);
  console.error = (...a) => {
    try {
      LOG.push(new Date().toISOString().slice(11, 19) + ' ' + a.map(x => (typeof x === 'string' ? x : (x && x.message) || String(x))).join(' ').slice(0, 300));
      if (LOG.length > 150) LOG.shift();
    } catch (e) {}
    origErr(...a);
  };

  const DL_DIR = cacheDir || process.env.MS_CACHE_DIR || path.join(os.tmpdir(), 'macstream-episode-cache');
  const isTempTestDir = path.basename(DL_DIR).startsWith('ms-test-');
  fs.mkdirSync(DL_DIR, { recursive: true });

  // Cada torrent é guardado na sua própria subpasta isolada DL_DIR/<infoHash> para nunca sobrepor ficheiros de séries diferentes!
  function getTorrentDir(hash) {
    if (!hash || !/^[a-f0-9]{40}$/i.test(hash)) return DL_DIR;
    const d = path.join(DL_DIR, hash.toLowerCase());
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
    return d;
  }

  // =========================================================================
  // GESTOR DE CACHE PERSISTENTE E ISOLADA DE EPISÓDIOS (cache-state.json)
  // Mantém até 8 episódios em cache com isolamento por (infoHash, fileIdx) e
  // proteção estrita contra substituição acidental entre títulos diferentes!
  // =========================================================================
  const CACHE_STATE_PATH = path.join(DL_DIR, 'cache-state.json');
  const USER_STATE_PATH = path.join(DL_DIR, 'user-state.json');

  function loadUserStateFromDisk() {
    try {
      if (fs.existsSync(USER_STATE_PATH)) {
        const raw = JSON.parse(fs.readFileSync(USER_STATE_PATH, 'utf8'));
        if (raw && typeof raw === 'object') return raw;
      }
    } catch (e) {}
    return {
      watchProgressMap: {},
      libraryMap: {},
      iptvFavorites: [],
      iptvHistory: [],
      iptvPinnedCategories: [],
      introMap: {},
      updatedAt: 0
    };
  }

  function sanitizeStateMap(obj, maxKeys = 5000) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    let count = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (++count > maxKeys) break;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const cleanVal = {};
        for (const [vk, vv] of Object.entries(v)) {
          if (vk === '__proto__' || vk === 'constructor' || vk === 'prototype') continue;
          cleanVal[vk] = vv;
        }
        out[k] = cleanVal;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function saveUserStateToDisk(patch) {
    const current = loadUserStateFromDisk();
    const p = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
    const merged = {
      watchProgressMap: { ...sanitizeStateMap(current.watchProgressMap), ...sanitizeStateMap(p.watchProgressMap) },
      libraryMap: p.replaceLibrary
        ? sanitizeStateMap(p.libraryMap)
        : { ...sanitizeStateMap(current.libraryMap), ...sanitizeStateMap(p.libraryMap) },
      iptvFavorites: Array.isArray(p.iptvFavorites) ? p.iptvFavorites.slice(0, 5000) : (Array.isArray(current.iptvFavorites) ? current.iptvFavorites : []),
      iptvHistory: Array.isArray(p.iptvHistory) ? p.iptvHistory.slice(0, 5000) : (Array.isArray(current.iptvHistory) ? current.iptvHistory : []),
      iptvPinnedCategories: Array.isArray(p.iptvPinnedCategories) ? p.iptvPinnedCategories.slice(0, 5000) : (Array.isArray(current.iptvPinnedCategories) ? current.iptvPinnedCategories : []),
      introMap: { ...sanitizeStateMap(current.introMap), ...sanitizeStateMap(p.introMap) },
      updatedAt: Date.now()
    };
    if (Array.isArray(p.addons)) merged.addons = p.addons.slice(0, 500);
    else if (Array.isArray(current.addons)) merged.addons = current.addons;
    try {
      const tmp = USER_STATE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
      fs.renameSync(tmp, USER_STATE_PATH);
    } catch (e) {}
    return merged;
  }
  const MAX_CACHED_EPISODES = 8;
  const MAX_VIDEO_FILE_BYTES = 35 * 1024 * 1024 * 1024;
  const MAX_TOTAL_CACHE_BYTES = 45 * 1024 * 1024 * 1024;
  const cacheManifest = { items: {}, primaryHash: null, preloadHash: null };

  function makeCacheKey(hash, idx) {
    const h = String(hash || '').toLowerCase();
    const i = Number.isInteger(idx) && idx >= 0 ? idx : 0;
    return `${h}:${i}`;
  }

  // Verifica se um ficheiro em disco está realmente completo (e não é um ficheiro sparse do WebTorrent
  // onde apenas a primeira e a última peça de 64 KB foram escritas para o cálculo do videoHash!)
  function isDiskFileTrulyComplete(localPath, expectedLength, torrentFile, prevCompleted) {
    if (!localPath || !fs.existsSync(localPath)) return false;
    try {
      const st = fs.statSync(localPath);
      const minSize = Math.max(1024, (expectedLength || 1024) * 0.98);
      if (st.size < minSize) return false;
      if (typeof st.blocks === 'number' && st.blocks > 0 && st.size > 2 * 1024 * 1024) {
        const allocatedBytes = st.blocks * 512;
        if (allocatedBytes < st.size * 0.90) return false;
      }
      if (torrentFile && typeof torrentFile.progress === 'number' && torrentFile.progress < 0.995 && !prevCompleted) {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function getCacheEntry(hash, idx, season, episode, imdbId) {
    if (!hash) return null;
    const h = String(hash).toLowerCase();
    const hasIdx = Number.isInteger(idx) && idx >= 0;
    const hasEp = Number.isInteger(season) && Number.isInteger(episode);
    const epMatches = (e) => {
      if (!e) return false;
      if (imdbId && e.imdbId && e.imdbId !== imdbId) return false;
      if (hasEp && e.season != null && e.episode != null) {
        if (Number(e.season) !== Number(season) || Number(e.episode) !== Number(episode)) return false;
      }
      if (hasEp && (e.name || e.localPath) && fileHasConflictingEpisode(e.name || e.localPath, season, episode)) {
        return false;
      }
      return true;
    };

    if (hasIdx) {
      const exact = cacheManifest.items[`${h}:${idx}`];
      if (exact && epMatches(exact)) return exact;
      if (cacheManifest.items[h] && cacheManifest.items[h].fileIdx === idx && epMatches(cacheManifest.items[h])) {
        return cacheManifest.items[h];
      }
      const allForHash = Object.values(cacheManifest.items).filter(e => e && e.infoHash === h);
      const byIdx = allForHash.find(e => e.fileIdx === idx && epMatches(e));
      // NUNCA faz fallback para outro fileIdx de um Season Pack quando idx foi explicitamente pedido!
      return byIdx || null;
    }

    const allForHash = Object.values(cacheManifest.items).filter(e => e && e.infoHash === h);
    if (!allForHash.length) return null;

    if (hasEp) {
      const byEp = allForHash.find(e => Number(e.season) === Number(season) && Number(e.episode) === Number(episode) && epMatches(e));
      // NUNCA devolve outro episódio da mesma série (ex: S02E21 quando se pediu S02E22)!
      return byEp || null;
    }

    if (imdbId) {
      const byImdb = allForHash.find(e => e.imdbId === imdbId);
      if (byImdb) return byImdb;
    }
    return allForHash[0];
  }

  function hasAnyCacheForHash(hash) {
    if (!hash) return false;
    const h = String(hash).toLowerCase();
    return Boolean(cacheManifest.items[h] || Object.values(cacheManifest.items).some(e => e && e.infoHash === h));
  }

  function loadCacheManifest() {
    try {
      if (fs.existsSync(CACHE_STATE_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CACHE_STATE_PATH, 'utf8'));
        if (raw && typeof raw.items === 'object') {
          cacheManifest.items = {};
          for (const [k, v] of Object.entries(raw.items)) {
            if (!v || !v.infoHash) continue;
            const ck = makeCacheKey(v.infoHash, v.fileIdx || 0);
            cacheManifest.items[ck] = { ...v, remuxing: false, cacheKey: ck, infoHash: v.infoHash.toLowerCase(), fileIdx: v.fileIdx || 0 };
          }
          cacheManifest.primaryHash = raw.primaryHash || null;
          cacheManifest.preloadHash = raw.preloadHash || null;
        }
      }
    } catch (e) {}
  }
  let cachedDirBytes = -1;
  let cachedDirBytesAt = 0;
  function invalidateDirSizeCache() {
    cachedDirBytes = -1;
    cachedDirBytesAt = 0;
  }
  function saveCacheManifest() {
    invalidateDirSizeCache();
    if (isTempTestDir) return;
    try {
      fs.writeFileSync(CACHE_STATE_PATH, JSON.stringify(cacheManifest, null, 2));
    } catch (e) {}
  }
  loadCacheManifest();

  function getRemuxMp4Path(hash, idx) {
    return path.join(DL_DIR, `${String(hash).toLowerCase()}_${idx || 0}.remux.mp4`);
  }

  function resolveLocalFilePath(torrent, file, hash, idx) {
    if (torrent && file && file.path) {
      const p1 = path.join(torrent.path || getTorrentDir(hash), file.path);
      if (fs.existsSync(p1)) return p1;
      const p2 = path.join(DL_DIR, file.path);
      if (fs.existsSync(p2)) return p2;
    }
    const entry = getCacheEntry(hash, idx);
    if (entry && entry.localPath && fs.existsSync(entry.localPath)) {
      if (idx === undefined || entry.fileIdx === idx) return entry.localPath;
    }
    return null;
  }

  function computePieceMap(torrent, file, buckets = 64) {
    const h = torrent && torrent.infoHash ? torrent.infoHash.toLowerCase() : '';
    const idx = torrent && file && Array.isArray(torrent.files) ? torrent.files.indexOf(file) : undefined;
    const entry = getCacheEntry(h, idx >= 0 ? idx : undefined);
    if (entry && (entry.completed || entry.remuxReady) && entry.localPath && fs.existsSync(entry.localPath)) {
      return new Array(buckets).fill(1);
    }
    if (!torrent || !file || !torrent.bitfield || !torrent.pieceLength) {
      return new Array(buckets).fill(0);
    }
    const pl = torrent.pieceLength;
    const out = new Array(buckets).fill(0);
    for (let b = 0; b < buckets; b++) {
      const byteA = Math.floor((b / buckets) * file.length);
      const byteB = Math.max(byteA + 1, Math.floor(((b + 1) / buckets) * file.length));
      const p0 = Math.floor(((file.offset || 0) + byteA) / pl);
      const p1 = Math.floor(((file.offset || 0) + byteB - 1) / pl);
      let have = 0, tot = 0;
      for (let p = p0; p <= p1; p++) {
        tot++;
        try { if (torrent.bitfield.get(p)) have++; } catch (e) {}
      }
      out[b] = tot > 0 ? +(have / tot).toFixed(2) : 0;
    }
    return out;
  }

  function isFileRangeOnDisk(torrent, file, hash, idx, byteStart, byteWindow = 2 * 1024 * 1024) {
    const localPath = resolveLocalFilePath(torrent, file, hash, idx);
    if (!localPath || !fs.existsSync(localPath)) return null;
    const entry = getCacheEntry(hash, idx);
    if (entry && entry.completed && isDiskFileTrulyComplete(localPath, entry.length || (file && file.length), file, entry.completed)) {
      return localPath;
    }
    if (!torrent || !file || !torrent.bitfield || !torrent.pieceLength) return null;
    if (file.progress >= 0.998) return localPath;
    const pl = torrent.pieceLength;
    const fStart = Math.floor((file.offset || 0) / pl);
    try {
      if (!torrent.bitfield.get(fStart)) return null;
      const targetStart = Math.max(0, Math.min(file.length - 1, byteStart));
      const targetEnd = Math.min(file.length - 1, targetStart + byteWindow);
      const p0 = Math.floor(((file.offset || 0) + targetStart) / pl);
      const p1 = Math.floor(((file.offset || 0) + targetEnd) / pl);
      for (let p = p0; p <= p1; p++) {
        if (!torrent.bitfield.get(p)) return null;
      }
      return localPath;
    } catch (e) {
      return null;
    }
  }

  // Quando o ficheiro atinge 100% em disco, faz remux rápido (-c:v copy -c:a aac -movflags +faststart)
  // para um ficheiro .mp4 nativo na pasta de cache, permitindo seek 0ms instantâneo!
  function triggerAutoRemuxIfNeeded(hash, idx, localPath, fileName) {
    if (!ffmpegPath || !hash || !localPath || !fs.existsSync(localPath)) return;
    const h = hash.toLowerCase();
    const fIdx = Number.isInteger(idx) ? idx : 0;
    const key = makeCacheKey(h, fIdx);
    const mp4Path = getRemuxMp4Path(h, fIdx);
    const entry = getCacheEntry(h, fIdx) || {};
    if (fs.existsSync(mp4Path)) {
      try {
        if (fs.statSync(mp4Path).size > 64 * 1024) {
          entry.remuxMp4Path = mp4Path;
          entry.remuxReady = true;
          entry.remuxing = false;
          saveCacheManifest();
          return;
        }
      } catch (e) {}
    }
    if (remuxProcs.has(key)) return;
    const cachedTracks = tracksCache[key];
    const nameHasIncompatAudio = /\b(eac3|ddp|dd\+|ac-?3|dts|truehd|atmos)\b/i.test(fileName || localPath || '');
    const defAudio = cachedTracks && cachedTracks.audio && (cachedTracks.audio.find(a => a.def) || cachedTracks.audio[0]);
    const hasIncompatAudio = defAudio && /^(eac3|ac3|dts|truehd|mlp|pcm_s24le)$/i.test(defAudio.codec || '');
    if (/\.(mp4|m4v)$/i.test(fileName || localPath) && !cachedTracks && !nameHasIncompatAudio) {
      probeTracks(h, fIdx).then((tr) => {
        if (!tracksCache[key]) tracksCache[key] = tr || { ok: false, audio: [] };
        triggerAutoRemuxIfNeeded(h, fIdx, localPath, fileName);
      }).catch(() => {});
      return;
    }
    if (/\.(mp4|m4v)$/i.test(fileName || localPath) && !hasIncompatAudio && !nameHasIncompatAudio) {
      entry.remuxMp4Path = localPath;
      entry.remuxReady = true;
      entry.remuxing = false;
      saveCacheManifest();
      return;
    }

    entry.remuxing = true;
    saveCacheManifest();
    const tmpPath = mp4Path + '.tmp';
    try { fs.rmSync(tmpPath, { force: true }); } catch (e) {}

    const isHevc = (cachedTracks && /hevc|h265/i.test(cachedTracks.video || '')) || /x265|hevc|h\.?265/i.test(fileName || '');
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', localPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy'
    ];
    if (isHevc) args.push('-tag:v', 'hvc1');
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', tmpPath);

    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    remuxProcs.set(key, p);
    p.on('close', (code) => {
      remuxProcs.delete(key);
      const curEntry = getCacheEntry(h, fIdx);
      if (code === 0 && fs.existsSync(tmpPath)) {
        try {
          fs.renameSync(tmpPath, mp4Path);
          if (curEntry) {
            curEntry.remuxMp4Path = mp4Path;
            curEntry.remuxReady = true;
            curEntry.remuxing = false;
            saveCacheManifest();
          }
        } catch (e) {}
      } else {
        try { fs.rmSync(tmpPath, { force: true }); } catch (e) {}
        if (curEntry) { curEntry.remuxing = false; saveCacheManifest(); }
      }
    });
    p.on('error', () => {
      remuxProcs.delete(key);
      try { fs.rmSync(tmpPath, { force: true }); } catch (e) {}
      const curEntry = getCacheEntry(h, fIdx);
      if (curEntry) curEntry.remuxing = false;
    });
  }

  let client = null;
  let batteryMode = false;
  function getClient() {
    if (!client) {
      client = new WebTorrent({ maxConns: 100 });
      client.on('error', (e) => console.error('[engine] erro WebTorrent:', e && e.message));
    }
    return client;
  }

  function evictCacheEntry(hashOrKey, specificFileIdx) {
    if (!hashOrKey) return;
    const raw = String(hashOrKey).toLowerCase();
    const h = raw.includes(':') ? raw.split(':')[0] : raw;
    const targetIdx = specificFileIdx !== undefined ? specificFileIdx : (raw.includes(':') ? parseInt(raw.split(':')[1], 10) : undefined);

    const keysToDelete = Object.keys(cacheManifest.items).filter(k => {
      const item = cacheManifest.items[k];
      if (!item || item.infoHash !== h) return false;
      if (Number.isInteger(targetIdx) && item.fileIdx !== targetIdx) return false;
      return true;
    });

    for (const k of keysToDelete) {
      if (remuxProcs.has(k)) {
        try { remuxProcs.get(k).kill('SIGKILL'); } catch (e) {}
        remuxProcs.delete(k);
      }
      const entry = cacheManifest.items[k];
      if (entry) {
        if (entry.remuxMp4Path && entry.remuxMp4Path !== entry.localPath) {
          try { fs.rmSync(entry.remuxMp4Path, { force: true }); } catch (e) {}
        }
        delete cacheManifest.items[k];
      }
    }

    const stillHasOtherFiles = hasAnyCacheForHash(h);
    if (!stillHasOtherFiles) {
      for (const [k, p] of remuxProcs) {
        if (k.startsWith(h + ':')) {
          try { p.kill('SIGKILL'); } catch (e) {}
          remuxProcs.delete(k);
        }
      }
      if (client) {
        const t = client.torrents.find(x => x.infoHash && x.infoHash.toLowerCase() === h);
        if (t) {
          try { t.destroy({ destroyStore: true }); } catch (e) {}
        }
      }
      try {
        const tDir = path.join(DL_DIR, h);
        if (fs.existsSync(tDir)) fs.rmSync(tDir, { recursive: true, force: true });
      } catch (e) {}
      try {
        for (const f of fs.readdirSync(DL_DIR)) {
          if (f.toLowerCase().startsWith(h + '_')) {
            fs.rmSync(path.join(DL_DIR, f), { force: true });
          }
        }
      } catch (e) {}
      if (cacheManifest.primaryHash === h) cacheManifest.primaryHash = null;
      if (cacheManifest.preloadHash === h) cacheManifest.preloadHash = null;
    }
    invalidateDirSizeCache();
    saveCacheManifest();
  }

  // Mantém até MAX_CACHED_EPISODES (8) episódios na cache sem NUNCA apagar episódios já descarregados
  // quando o utilizador vê outro episódio (ex: ver The Office depois de descarregar Tulsa King).
  function enforceCachePolicy(activeHash, keepPreloadHash = null) {
    const act = activeHash ? activeHash.toLowerCase() : null;
    if (act && cacheManifest.preloadHash === act) {
      cacheManifest.preloadHash = null;
    }
    const pre = keepPreloadHash ? keepPreloadHash.toLowerCase() : (cacheManifest.preloadHash !== act ? cacheManifest.preloadHash : null);

    const allKeys = Object.keys(cacheManifest.items);
    const keepKeys = new Set();

    allKeys.forEach(k => {
      const it = cacheManifest.items[k];
      if (it && (it.infoHash === act || it.infoHash === pre)) keepKeys.add(k);
    });

    let totalKeepBytes = 0;
    keepKeys.forEach(k => { totalKeepBytes += (cacheManifest.items[k] && cacheManifest.items[k].length) || 0; });

    if (keepKeys.size < MAX_CACHED_EPISODES) {
      const remaining = allKeys
        .filter(k => !keepKeys.has(k))
        .sort((a, b) => {
          const ia = cacheManifest.items[a] || {};
          const ib = cacheManifest.items[b] || {};
          // Prioriza sempre episódios 100% completos ou marcados como cache explícita
          if (Boolean(ib.completed) !== Boolean(ia.completed)) return ib.completed ? 1 : -1;
          if (Boolean(ib.explicitCache) !== Boolean(ia.explicitCache)) return ib.explicitCache ? 1 : -1;
          return (ib.updatedAt || 0) - (ia.updatedAt || 0);
        });
      for (const k of remaining) {
        if (keepKeys.size >= MAX_CACHED_EPISODES) break;
        const itemLen = (cacheManifest.items[k] && cacheManifest.items[k].length) || 0;
        if (totalKeepBytes + itemLen > MAX_TOTAL_CACHE_BYTES) continue;
        keepKeys.add(k);
        totalKeepBytes += itemLen;
      }
    }

    for (const k of allKeys) {
      if (!keepKeys.has(k)) {
        evictCacheEntry(k);
      }
    }

    const keepHashes = new Set(Array.from(keepKeys).map(k => (cacheManifest.items[k] && cacheManifest.items[k].infoHash) || k.split(':')[0]));
    if (act) keepHashes.add(act);
    if (pre) keepHashes.add(pre);

    if (client) {
      for (const t of [...client.torrents]) {
        const th = t.infoHash ? t.infoHash.toLowerCase() : '';
        if (!th) continue;
        if (!keepHashes.has(th)) {
          try { t.destroy({ destroyStore: true }); } catch (e) {}
        } else if (th !== act && th !== pre) {
          // Mantém os ficheiros em disco intactos (destroyStore: false), libertando apenas as ligações de rede P2P!
          const entry = getCacheEntry(th);
          if (entry && entry.completed) {
            try { t.destroy({ destroyStore: false }); } catch (e) {}
          } else {
            try { if (typeof t.pause === 'function') t.pause(); } catch (e) {}
          }
        }
      }
    }
    if (act) cacheManifest.primaryHash = act;
    saveCacheManifest();
  }

  function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, X-MacStream');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-MacStream-Source');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  function json(res, code, obj) {
    cors(res);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  function pickFile(torrent, idx, season, episode) {
    const vids = torrent.files.filter(f => VIDEO_RE.test(f.name) && !/\bsample\b/i.test(f.name));
    const allVids = vids.length ? vids : torrent.files.filter(f => VIDEO_RE.test(f.name));
    const pool = allVids.length ? allVids : torrent.files;

    // Se temos temporada e episódio pedidos num torrent com vários ficheiros, valida se idx corresponde ao episódio certo!
    if (Number.isInteger(season) && Number.isInteger(episode) && pool.length > 1) {
      if (Number.isInteger(idx) && torrent.files[idx] && VIDEO_RE.test(torrent.files[idx].name)) {
        const cand = torrent.files[idx];
        if (!fileHasConflictingEpisode(cand.path || cand.name, season, episode)) {
          return cand;
        }
      }
      const matchEp = pool.find(f => fileMatchesEpisode(f.path || f.name, season, episode));
      if (matchEp) return matchEp;
    }

    if (Number.isInteger(idx) && torrent.files[idx] && VIDEO_RE.test(torrent.files[idx].name)) {
      return torrent.files[idx];
    }
    return pool.reduce((a, b) => (a.length > b.length ? a : b), pool[0]);
  }

  function collectMatchingExternalSubs(torrent, videoFile, season, episode) {
    if (!torrent || !Array.isArray(torrent.files)) return [];
    const vidStem = videoFile ? path.basename(videoFile.name, path.extname(videoFile.name)).toLowerCase() : '';
    const candidates = [];
    torrent.files.forEach((f, i) => {
      if (!SUB_FILE_RE.test(f.name) || f.length <= 50 || f.length >= 2 * 1024 * 1024) return;
      const fullRef = f.path || f.name;
      // NUNCA carrega legendas de outros episódios (ex: S01E01.srt quando se vê S01E02)
      if (Number.isInteger(season) && Number.isInteger(episode) && fileHasConflictingEpisode(fullRef, season, episode)) {
        return;
      }
      let score = 0;
      if (Number.isInteger(season) && Number.isInteger(episode) && fileMatchesEpisode(fullRef, season, episode)) score += 10;
      if (vidStem && f.name.toLowerCase().includes(vidStem)) score += 8;
      if (/por|portug|pt[-_.]?(?:pt|br)|pob/i.test(fullRef)) score += 5;
      candidates.push({ fileIdx: i, name: f.name, length: f.length, score });
    });
    candidates.sort((a, b) => b.score - a.score);
    return candidates.map(({ fileIdx, name, length }) => ({ fileIdx, name, length }));
  }

  function prioritizeFilePieces(torrent, file, byteOffset = 0, windowBytes = 2048 * 1024) {
    if (!torrent || !file || !torrent.pieces) return;
    try {
      const per = torrent.pieceLength || 262144;
      const fStart = Number.isInteger(file._startPiece) ? file._startPiece : Math.floor((file.offset || 0) / per);
      const fEnd = Number.isInteger(file._endPiece) ? file._endPiece : Math.floor(((file.offset || 0) + file.length - 1) / per);

      if (byteOffset === 0) {
        const headCount = Math.max(2, Math.min(8, Math.ceil((2048 * 1024) / per)));
        try { torrent.critical(fStart, Math.min(fEnd, fStart + headCount)); } catch (e) {}
        try { torrent.critical(Math.max(fStart, fEnd - 1), fEnd); } catch (e) {}
      } else if (byteOffset > 0 && byteOffset < file.length) {
        const p0 = Math.max(fStart, Math.floor(((file.offset || 0) + byteOffset) / per));
        const p1 = Math.min(fEnd, p0 + Math.max(2, Math.min(8, Math.ceil(windowBytes / per))));
        try { torrent.critical(p0, p1); } catch (e) {}
      }
    } catch (e) {}
  }

  const activePumps = new Map();
  function startReadAheadPump(infoHash, file, startByte = 0, spanBytes = 2 * 1024 * 1024) {
    if (!file) return;
    const pumpKey = `${infoHash}:${startByte > 0 ? 'seek' : 'head'}`;
    if (activePumps.has(pumpKey)) {
      try { activePumps.get(pumpKey).destroy(); } catch (e) {}
      activePumps.delete(pumpKey);
    }
    try {
      const sByte = Math.max(0, Math.min(file.length - 1, startByte));
      const endByte = Math.min(file.length - 1, sByte + spanBytes);
      if (endByte <= sByte) return;
      const sHead = file.createReadStream({ start: sByte, end: endByte });
      activePumps.set(pumpKey, sHead);
      const clean = () => {
        if (activePumps.get(pumpKey) === sHead) activePumps.delete(pumpKey);
        try { sHead.destroy(); } catch (e) {}
      };
      sHead.on('data', () => {});
      sHead.on('end', clean);
      sHead.on('error', clean);
      setTimeout(clean, 15000);
    } catch (e) {}
  }

  function findExistingTorrent(c, magnetOrBuf) {
    const hash = extractInfoHash(magnetOrBuf);
    if (hash) {
      const byHash = c.torrents.find(t => t.infoHash && t.infoHash.toLowerCase() === hash);
      if (byHash) return byHash;
    }
    try {
      const got = c.get(magnetOrBuf);
      if (got && typeof got.then !== 'function') return got;
    } catch (e) {}
    return null;
  }

  function kickTorrentWires(t) {
    if (!t) return;
    try {
      if (t.paused && typeof t.resume === 'function') t.resume();
      (t.wires || []).forEach(w => {
        try { w.interested(); } catch (e) {}
      });
      if (typeof t._update === 'function') t._update();
    } catch (e) {}
  }

  function injectMetadataIntoTorrent(c, hash, buf) {
    if (!hash || !isValidTorrentBuffer(buf)) return false;
    notifyTorrentBufWaiters(hash, buf);
    const t = findExistingTorrent(c, hash);
    if (!t || t.ready) return Boolean(t && t.ready);
    const savedPeers = [];
    try {
      (t.wires || []).forEach(w => {
        if (w && w.remoteAddress && w.remotePort) savedPeers.push(`${w.remoteAddress}:${w.remotePort}`);
      });
    } catch (e) {}
    const savedAnnounce = Array.from(new Set([...(Array.isArray(t.announce) ? t.announce : []), ...TRACKERS]));
    const tPath = t.path || getTorrentDir(hash);
    try {
      if (typeof t._onMetadata === 'function') {
        t._onMetadata(buf);
        t.once('ready', () => kickTorrentWires(t));
        if (t.ready) {
          kickTorrentWires(t);
          return true;
        }
      }
    } catch (e) {}
    setTimeout(() => {
      try {
        const cur = findExistingTorrent(c, hash);
        if (cur && !cur.ready) {
          try { cur.destroy({ destroyStore: false }); } catch (e) {}
          const nt = c.add(buf, { path: tPath, announce: savedAnnounce });
          savedPeers.forEach(addr => { try { nt.addPeer(addr); } catch (e) {} });
          nt.once('ready', () => kickTorrentWires(nt));
        }
      } catch (e) {}
    }, 180);
    return true;
  }

  function attachWireMetadataHelper(t, c, hash) {
    if (!t || t._msHooked) return;
    t._msHooked = true;
    if (hash) {
      fetchCachedTorrentBuffer(hash, 5000, onRequestTorrentBuf).then((buf) => {
        if (buf && !t.ready && !t.destroyed) {
          injectMetadataIntoTorrent(c, hash, buf);
        }
      }).catch(() => {});
    }
    t.on('wire', (wire) => {
      try {
        if (t.ready) {
          wire.interested();
          if (typeof t._updateWire === 'function') t._updateWire(wire);
        } else if (wire.ut_metadata && typeof wire.ut_metadata.fetch === 'function') {
          wire.ut_metadata.fetch();
        }
      } catch (e) {}
    });
  }

  function registerCacheWatchers(torrent, file, idx, meta = {}) {
    if (!torrent || !file || !torrent.infoHash) return;
    const h = torrent.infoHash.toLowerCase();
    const fIdx = Number.isInteger(idx) && idx >= 0 ? idx : 0;
    const cKey = makeCacheKey(h, fIdx);
    const localPath = path.join(torrent.path || getTorrentDir(h), file.path);
    const prev = cacheManifest.items[cKey] || cacheManifest.items[h] || {};
    if (cacheManifest.items[h] && cKey !== h) delete cacheManifest.items[h];

    // PROTEÇÃO CRÍTICA: Nunca permite que metadados de outra série/filme (ex: Tulsa King vs The Office)
    // sobrescrevam um ficheiro que já pertence a outro imdbId na cache!
    const hasConflictImdb = Boolean(prev.imdbId && meta.imdbId && prev.imdbId !== meta.imdbId);
    const safeTitle = hasConflictImdb ? prev.title : (meta.title || prev.title || file.name);
    const safeImdbId = hasConflictImdb ? prev.imdbId : (meta.imdbId || prev.imdbId || '');
    const hasMetaSeason = meta.season !== undefined && meta.season !== null;
    const hasMetaEpisode = meta.episode !== undefined && meta.episode !== null;
    const safeType = hasConflictImdb ? prev.type : (meta.type || prev.type || (hasMetaSeason ? 'series' : 'movie'));
    const safeSeason = hasConflictImdb ? prev.season : (hasMetaSeason ? meta.season : (prev.season !== undefined ? prev.season : null));
    const safeEpisode = hasConflictImdb ? prev.episode : (hasMetaEpisode ? meta.episode : (prev.episode !== undefined ? prev.episode : null));
    const safePoster = hasConflictImdb ? prev.poster : (meta.poster || prev.poster || '');
    const safeBackdrop = hasConflictImdb ? prev.backdrop : (meta.backdrop || prev.backdrop || '');

    const prevTrulyComplete = Boolean(prev.completed && isDiskFileTrulyComplete(localPath, file.length, file, true));
    const diskComplete = isDiskFileTrulyComplete(localPath, file.length, file, prevTrulyComplete);

    const externalSubs = collectMatchingExternalSubs(torrent, file, safeSeason, safeEpisode);

    const entry = {
      ...prev,
      cacheKey: cKey,
      infoHash: h,
      fileIdx: fIdx,
      name: file.name,
      length: file.length,
      localPath,
      title: safeTitle,
      imdbId: safeImdbId,
      type: safeType,
      season: safeSeason,
      episode: safeEpisode,
      poster: safePoster,
      backdrop: safeBackdrop,
      magnet: meta.magnet || prev.magnet || '',
      explicitCache: Boolean(meta.explicitCache || prev.explicitCache),
      externalSubs,
      progress: diskComplete ? 1 : +(Math.max(file.progress || 0, prevTrulyComplete ? 1 : 0)).toFixed(4),
      completed: Boolean(diskComplete || file.progress >= 0.999),
      updatedAt: Date.now()
    };
    const mp4Path = getRemuxMp4Path(h, fIdx);
    if (fs.existsSync(mp4Path)) {
      entry.remuxMp4Path = mp4Path;
      entry.remuxReady = true;
    }
    cacheManifest.items[cKey] = entry;
    saveCacheManifest();

    if (entry.completed) {
      triggerAutoRemuxIfNeeded(h, fIdx, localPath, file.name);
    }

    const hookProp = `_msCacheHooked_${fIdx}`;
    if (!torrent[hookProp]) {
      torrent[hookProp] = true;
      let lastSave = 0;
      torrent.on('download', () => {
        const now = Date.now();
        const cur = cacheManifest.items[cKey];
        if (!cur) return;
        cur.progress = cur.completed ? 1 : +(file.progress || torrent.progress || 0).toFixed(4);
        cur.downloaded = torrent.downloaded || 0;
        cur.updatedAt = now;
        if (file.progress >= 0.999 && !cur.completed) {
          cur.completed = true;
          cur.progress = 1;
          saveCacheManifest();
          triggerAutoRemuxIfNeeded(h, fIdx, localPath, file.name);
        } else if (now - lastSave > 4000) {
          lastSave = now;
          saveCacheManifest();
        }
      });
      torrent.on('done', () => {
        const cur = cacheManifest.items[cKey];
        if (cur) {
          cur.completed = true;
          cur.progress = 1;
          cur.updatedAt = Date.now();
          saveCacheManifest();
        }
        triggerAutoRemuxIfNeeded(h, fIdx, localPath, file.name);
      });
    }
  }

  const activeAltMap = new Map();

  async function startTorrent(magnet, fileIdx, altMagnets = [], season, episode, meta = {}) {
    const c = getClient();
    const reqHash = extractInfoHash(magnet);

    // 1. CURTO-CIRCUITO DE CACHE EM DISCO: Se o episódio pedido já está 100% descarregado em disco,
    // serve-o IMEDIATAMENTE do disco sem esperar por peers e SEM NUNCA lançar altMagnets que o possam substituir!
    if (reqHash) {
      const cachedEntry = getCacheEntry(reqHash, fileIdx, season, episode, meta.imdbId);
      if (cachedEntry && cachedEntry.completed && cachedEntry.localPath && fs.existsSync(cachedEntry.localPath)) {
        const sameImdb = !cachedEntry.imdbId || !meta.imdbId || cachedEntry.imdbId === meta.imdbId;
        const noEpConflict = !(Number.isInteger(season) && Number.isInteger(episode) && fileHasConflictingEpisode(cachedEntry.name || cachedEntry.localPath, season, episode));
        const sizeOk = isDiskFileTrulyComplete(cachedEntry.localPath, cachedEntry.length, null, cachedEntry.completed);
        if (!sizeOk && cachedEntry.completed) {
          cachedEntry.completed = false;
          cachedEntry.progress = 0;
          saveCacheManifest();
        }

        if (sameImdb && noEpConflict && sizeOk) {
          // Pausa outros torrents no enxame sem apagar nada do disco (destroyStore: false)
          for (const t of [...c.torrents]) {
            const th = t.infoHash ? t.infoHash.toLowerCase() : '';
            if (th !== reqHash && th !== cacheManifest.preloadHash) {
              try {
                if (hasAnyCacheForHash(th)) t.destroy({ destroyStore: false });
                else t.destroy({ destroyStore: true });
              } catch (e) {}
            }
          }
          cachedEntry.updatedAt = Date.now();
          cachedEntry.progress = 1;
          enforceCachePolicy(reqHash, cacheManifest.preloadHash);
          triggerAutoRemuxIfNeeded(reqHash, cachedEntry.fileIdx || 0, cachedEntry.localPath, cachedEntry.name);
          const remuxReady = Boolean(cachedEntry.remuxReady && cachedEntry.remuxMp4Path && fs.existsSync(cachedEntry.remuxMp4Path));
          return {
            ok: true,
            infoHash: reqHash,
            fileIdx: cachedEntry.fileIdx || 0,
            name: cachedEntry.name || path.basename(cachedEntry.localPath),
            length: cachedEntry.length || fs.statSync(cachedEntry.localPath).size,
            progress: 1,
            diskComplete: true,
            remuxReady,
            videoHash: cachedEntry.videoHash || computeOsdbHashFromDiskFile(cachedEntry.localPath) || null,
            externalSubs: Array.isArray(cachedEntry.externalSubs) ? cachedEntry.externalSubs : [],
            ffmpeg: !!ffmpegPath
          };
        }
      }
    }

    let torrent = findExistingTorrent(c, magnet);

    // Pausa ou liberta outros torrents ativos sem NUNCA destruir os ficheiros em disco dos episódios em cache!
    for (const t of [...c.torrents]) {
      const th = t.infoHash ? t.infoHash.toLowerCase() : '';
      if (t !== torrent && th !== cacheManifest.preloadHash) {
        try {
          if (hasAnyCacheForHash(th)) t.destroy({ destroyStore: false });
          else t.destroy({ destroyStore: true });
        } catch (e) {}
      }
    }

    const { target, announce } = buildCleanInput(magnet);
    const hash = extractInfoHash(magnet);
    const torrentStorageDir = getTorrentDir(hash);

    if (!torrent) {
      let fastBuf = hash ? torrentBufCache.get(hash) : null;
      if (!fastBuf && hash) {
        const cacheProm = fetchCachedTorrentBuffer(hash, 5000, onRequestTorrentBuf);
        fastBuf = await Promise.race([
          cacheProm,
          new Promise(r => setTimeout(() => r(null), 1100))
        ]);
      }
      torrent = c.add(fastBuf || target, { path: torrentStorageDir, announce });
    } else if (torrent.paused && typeof torrent.resume === 'function') {
      try { torrent.resume(); } catch (e) {}
    }

    attachWireMetadataHelper(torrent, c, hash);

    if (!torrent.ready) {
      const startedAt = Date.now();
      let altsLaunched = false;
      const altHashes = [];

      await new Promise((resolve, reject) => {
        const cleanupLosers = (winner) => {
          if (hash) activeAltMap.delete(hash);
          for (const t of [...c.torrents]) {
            const th = t.infoHash ? t.infoHash.toLowerCase() : '';
            if (t !== winner && th !== cacheManifest.preloadHash) {
              try {
                if (hasAnyCacheForHash(th)) t.destroy({ destroyStore: false });
                else t.destroy({ destroyStore: true });
              } catch (e) {}
            }
          }
        };
        const check = setInterval(() => {
          const curPrimary = hash ? findExistingTorrent(c, hash) : torrent;
          const cachedOk = hash && getCacheEntry(hash, fileIdx, season, episode, meta.imdbId)?.completed;
          if (curPrimary && curPrimary.ready && (curPrimary.numPeers > 0 || cachedOk || !altsLaunched)) {
            torrent = curPrimary;
            clearInterval(check);
            clearTimeout(to);
            cleanupLosers(torrent);
            return resolve();
          }
          if (!altsLaunched && Date.now() - startedAt >= 3500 && (!curPrimary || (!curPrimary.ready && curPrimary.numPeers === 0))) {
            altsLaunched = true;
            (altMagnets || []).slice(0, 2).forEach(altMag => {
              const ah = extractInfoHash(altMag);
              if (!ah || ah === hash || findExistingTorrent(c, ah)) return;
              // NUNCA lança como alt um torrent que pertença a outra série guardada na cache!
              const existingAltEntry = getCacheEntry(ah);
              if (existingAltEntry && existingAltEntry.imdbId && meta.imdbId && existingAltEntry.imdbId !== meta.imdbId) {
                return;
              }
              altHashes.push(ah);
              if (hash) activeAltMap.set(hash, altHashes);
              const { target: aTarget, announce: aAnn } = buildCleanInput(altMag);
              const cachedAlt = torrentBufCache.get(ah);
              const at = c.add(cachedAlt || aTarget, { path: getTorrentDir(ah), announce: aAnn });
              attachWireMetadataHelper(at, c, ah);
            });
          }
          for (const ah of altHashes) {
            const at = findExistingTorrent(c, ah);
            if (at && at.ready && at.numPeers > 0) {
              const candFile = pickFile(at, undefined, season, episode);
              if (!candFile) continue;
              if (Number.isInteger(season) && Number.isInteger(episode) && fileHasConflictingEpisode(candFile.path || candFile.name, season, episode)) {
                continue;
              }
              torrent = at;
              fileIdx = undefined;
              clearInterval(check);
              clearTimeout(to);
              cleanupLosers(torrent);
              return resolve();
            }
          }
          if (curPrimary && curPrimary.ready) {
            torrent = curPrimary;
            clearInterval(check);
            clearTimeout(to);
            cleanupLosers(torrent);
            return resolve();
          }
        }, 120);
        const to = setTimeout(() => {
          if (hash) activeAltMap.delete(hash);
          clearInterval(check);
          reject(new Error('Esta fonte não enviou metadados a tempo — a tentar outra fonte.'));
        }, 20000);
        torrent.once('ready', () => {
          if (!altsLaunched || torrent.numPeers > 0) {
            clearInterval(check);
            clearTimeout(to);
            cleanupLosers(torrent);
            resolve();
          }
        });
        torrent.once('error', (e) => {
          if (hash) activeAltMap.delete(hash);
          clearInterval(check);
          clearTimeout(to);
          reject(e);
        });
      });
    }

    const file = pickFile(torrent, fileIdx, season, episode);
    if (!file) throw new Error('O torrent não tem ficheiros de vídeo.');
    if (file.length > MAX_VIDEO_FILE_BYTES) throw new Error('Ficheiro excede o limite de segurança de 35 GB.');
    const idx = torrent.files.indexOf(file);
    const externalSubs = collectMatchingExternalSubs(torrent, file, season, episode);
    const allowedSubIdxs = new Set(externalSubs.map(s => s.fileIdx));

    if (torrent._selectedFileIdx !== idx) {
      torrent._selectedFileIdx = idx;
      if (torrent.files.length > 1) {
        try { torrent.deselect(0, torrent.pieces.length - 1, false); } catch (e) {}
        torrent.files.forEach((f, i) => {
          if (allowedSubIdxs.has(i)) {
            try { f.select(); } catch (e) {}
          }
        });
        file.select();
      } else {
        file.select();
      }
    }

    const winHash = torrent.infoHash.toLowerCase();
    enforceCachePolicy(winHash, cacheManifest.preloadHash === winHash ? null : cacheManifest.preloadHash);
    registerCacheWatchers(torrent, file, idx, { ...meta, season, episode, magnet: typeof magnet === 'string' ? magnet : '' });

    prioritizeFilePieces(torrent, file, 0, 2048 * 1024);
    startReadAheadPump(torrent.infoHash, file, 0, 2 * 1024 * 1024);
    kickTorrentWires(torrent);

    const entry = getCacheEntry(winHash, idx, season, episode, meta.imdbId) || {};
    computeFileVideoHash(winHash, idx, 6000).catch(() => {});
    return {
      ok: true,
      infoHash: torrent.infoHash,
      fileIdx: idx,
      name: file.name,
      length: file.length,
      progress: +(file.progress || entry.progress || 0).toFixed(4),
      remuxReady: Boolean(entry.remuxReady && entry.remuxMp4Path && fs.existsSync(entry.remuxMp4Path)),
      videoHash: videoHashCache[makeCacheKey(winHash, idx)] || entry.videoHash || null,
      externalSubs,
      ffmpeg: !!ffmpegPath
    };
  }

  async function preloadTorrent(magnet, fileIdx, season, episode, meta = {}) {
    const c = getClient();
    const hash = extractInfoHash(magnet);
    if (!hash) return { ok: false };
    cacheManifest.preloadHash = hash.toLowerCase();
    saveCacheManifest();

    // Se o episódio já estiver 100% em cache no disco, não precisa de reiniciar o download
    const existingCache = getCacheEntry(hash, fileIdx, season, episode, meta.imdbId);
    if (existingCache && existingCache.completed && isDiskFileTrulyComplete(existingCache.localPath, existingCache.length, null, existingCache.completed)) {
      if (meta.fullPreload) existingCache.explicitCache = true;
      existingCache.updatedAt = Date.now();
      saveCacheManifest();
      triggerAutoRemuxIfNeeded(hash, existingCache.fileIdx || 0, existingCache.localPath, existingCache.name);
      return {
        ok: true,
        infoHash: hash,
        fileIdx: existingCache.fileIdx || 0,
        name: existingCache.name,
        length: existingCache.length,
        cached: true
      };
    }

    let torrent = findExistingTorrent(c, magnet);
    const alreadyActive = Boolean(torrent);
    if (!torrent) {
      if (c.torrents.length >= MAX_CACHED_EPISODES) {
        for (const t of [...c.torrents]) {
          const th = t.infoHash ? t.infoHash.toLowerCase() : '';
          if (th !== cacheManifest.primaryHash && th !== hash.toLowerCase()) {
            try {
              if (hasAnyCacheForHash(th)) t.destroy({ destroyStore: false });
              else t.destroy({ destroyStore: true });
            } catch (e) {}
          }
        }
      }
      const { target, announce } = buildCleanInput(magnet);
      let fastBuf = torrentBufCache.get(hash);
      if (!fastBuf) {
        fastBuf = await Promise.race([
          fetchCachedTorrentBuffer(hash, 4000, onRequestTorrentBuf),
          new Promise(r => setTimeout(() => r(null), 900))
        ]);
      }
      torrent = c.add(fastBuf || target, { path: getTorrentDir(hash), announce });
    }
    attachWireMetadataHelper(torrent, c, hash);
    if (!torrent.ready) {
      await new Promise((resolve, reject) => {
        const check = setInterval(() => {
          const cur = findExistingTorrent(c, hash) || torrent;
          if (cur && cur.ready) { torrent = cur; clearInterval(check); clearTimeout(to); resolve(); }
        }, 150);
        const to = setTimeout(() => { clearInterval(check); reject(new Error('timeout')); }, 15000);
        torrent.once('ready', () => { clearInterval(check); clearTimeout(to); resolve(); });
        torrent.once('error', (e) => { clearInterval(check); clearTimeout(to); reject(e); });
      });
    }
    const file = pickFile(torrent, fileIdx, season, episode);
    if (!file || file.length > MAX_VIDEO_FILE_BYTES) return { ok: false };
    const idx = torrent.files.indexOf(file);
    try {
      if (!alreadyActive && torrent.files.length > 1) {
        torrent.deselect(0, torrent.pieces.length - 1, false);
        if (meta.fullPreload) {
          file.select();
        } else {
          const per = torrent.pieceLength || 262144;
          const s0 = file._startPiece;
          const e0 = Math.min(file._endPiece, s0 + Math.ceil((12 * 1024 * 1024) / per));
          torrent.select(s0, e0, 0, false);
        }
      } else if (meta.fullPreload) {
        file.select();
      }
      registerCacheWatchers(torrent, file, idx, { ...meta, explicitCache: Boolean(meta.fullPreload), season, episode, magnet });
      enforceCachePolicy(cacheManifest.primaryHash || hash, hash);
      prioritizeFilePieces(torrent, file, 0, 2048 * 1024);
      startReadAheadPump(torrent.infoHash, file, 0, 2 * 1024 * 1024);
      kickTorrentWires(torrent);
    } catch (e) {}
    return { ok: true, infoHash: torrent.infoHash, fileIdx: idx, name: file.name, length: file.length };
  }

  const tracksCache = {};
  const tracksInFlight = {};
  function probeTracks(hash, idx) {
    const key = makeCacheKey(hash, idx);
    if (tracksCache[key]) return Promise.resolve(tracksCache[key]);
    if (tracksInFlight[key]) return tracksInFlight[key];
    const prom = new Promise((resolve) => {
      if (!ffmpegPath) return resolve({ ok: false, error: 'ffmpeg não disponível.' });
      const found = findFile(hash, idx);
      const localPath = isFileRangeOnDisk(found && found.torrent, found && found.file, hash, idx, 0, 2 * 1024 * 1024);
      const inputTarget = localPath || `${SELF}/stream/${hash}/${idx}`;
      let err = '';
      const ffArgs = ['-hide_banner'];
      if (!localPath) ffArgs.push('-seekable', '0');
      ffArgs.push('-probesize', '1M', '-analyzeduration', '1000000', '-i', inputTarget);
      const ff = runFF(ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] }, probeProcs);
      const to = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (e) {} }, 10000);
      ff.stderr.on('data', d => { err += d; if (err.length > 80000) { try { ff.kill('SIGKILL'); } catch (e) {} } });
      ff.on('error', () => { clearTimeout(to); resolve({ ok: false }); });
      ff.on('close', () => {
        clearTimeout(to);
        const out = parseTracksFromStderr(err);
        if (out.ok) tracksCache[key] = out;
        resolve(out);
      });
    }).finally(() => { delete tracksInFlight[key]; });
    tracksInFlight[key] = prom;
    return prom;
  }

  const extractedSubCache = {};
  function serveEmbeddedSub(req, res, hash, idx, subIdx) {
    const key = `${hash.toLowerCase()}:${idx}:s:${subIdx}`;
    if (extractedSubCache[key]) {
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });
      return res.end(extractedSubCache[key]);
    }
    if (!ffmpegPath) return json(res, 501, { ok: false, error: 'ffmpeg não disponível.' });
    const found = findFile(hash, idx);
    const localPath = isFileRangeOnDisk(found && found.torrent, found && found.file, hash, idx, 0, 4 * 1024 * 1024);
    const ff = runFF([
      '-hide_banner', '-loglevel', 'error', '-probesize', '2M', '-analyzeduration', '2000000',
      '-i', localPath || `${SELF}/stream/${hash}/${idx}`,
      '-map', `0:s:${subIdx}`, '-f', 'webvtt', 'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] }, probeProcs);
    const chunks = [];
    const to = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (e) {} }, 25000);
    ff.stdout.on('data', d => chunks.push(d));
    ff.on('error', () => { clearTimeout(to); if (!res.headersSent) json(res, 502, { ok: false }); });
    ff.on('close', () => {
      clearTimeout(to);
      const vtt = Buffer.concat(chunks).toString('utf8');
      if (vtt && vtt.includes('-->')) {
        extractedSubCache[key] = vtt;
        if (!res.headersSent) {
          cors(res);
          res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });
          res.end(vtt);
        }
      } else if (!res.headersSent) {
        json(res, 404, { ok: false, error: 'Legenda embutida vazia ou baseada em imagem.' });
      }
    });
    res.on('close', () => { try { ff.kill('SIGKILL'); } catch (e) {} });
  }

  function findFile(hash, idx) {
    const h = String(hash || '').toLowerCase();
    if (client) {
      const t = client.torrents.find(x => x.infoHash && x.infoHash.toLowerCase() === h);
      if (t && t.files && t.files[idx]) return { torrent: t, file: t.files[idx] };
    }
    // Fallback se o ficheiro já estiver 100% em cache no disco mesmo sem torrent ativo
    const entry = getCacheEntry(h, idx);
    if (entry && entry.localPath && fs.existsSync(entry.localPath) && (idx === undefined || entry.fileIdx === idx)) {
      return {
        torrent: null,
        file: {
          name: entry.name || path.basename(entry.localPath),
          length: entry.length || fs.statSync(entry.localPath).size,
          path: path.relative(DL_DIR, entry.localPath),
          progress: 1,
          createReadStream: (opts) => fs.createReadStream(entry.localPath, opts)
        }
      };
    }
    return null;
  }

  function dirSize(dir, isRoot = true) {
    if (isRoot && cachedDirBytes >= 0 && (Date.now() - cachedDirBytesAt) < 4000) {
      return cachedDirBytes;
    }
    let total = 0;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'cache-state.json' || e.name === 'user-state.json') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) total += dirSize(p, false);
        else try { total += fs.statSync(p).size; } catch (x) {}
      }
    } catch (e) {}
    if (isRoot) {
      cachedDirBytes = total;
      cachedDirBytesAt = Date.now();
    }
    return total;
  }

  function serveDiskFileRange(req, res, diskPath, mimeType) {
    let stat;
    try { stat = fs.statSync(diskPath); } catch (e) { return json(res, 404, { ok: false }); }
    const total = stat.size;
    const range = req.headers.range;
    let start = 0, end = total - 1, partial = false;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        partial = true;
        if (m[1] === '' && m[2] !== '') {
          start = Math.max(0, total - parseInt(m[2], 10));
        } else {
          start = m[1] ? parseInt(m[1], 10) : 0;
          end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
        }
      }
      if (start > end || start >= total) {
        cors(res);
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
    }
    cors(res);
    const headers = {
      'Content-Type': mimeType || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-store',
      'X-MacStream-Source': 'disk-cache'
    };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    res.writeHead(partial ? 206 : 200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(diskPath, { start, end });
    stream.on('error', () => { try { res.destroy(); } catch (e) {} });
    stream.pipe(res);
    res.on('close', () => { try { stream.destroy(); } catch (e) {} });
  }

  function serveFile(req, res, file, torrent, hash, idx) {
    const total = file.length;
    const range = req.headers.range;
    let start = 0, end = total - 1, partial = false;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        partial = true;
        if (m[1] === '' && m[2] !== '') {
          start = Math.max(0, total - parseInt(m[2], 10));
        } else {
          start = m[1] ? parseInt(m[1], 10) : 0;
          end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
        }
      }
      if (start > end || start >= total) {
        cors(res);
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    // Se o ficheiro já estiver 100% em disco na pasta de cache, serve diretamente do sistema de ficheiros APFS (seek em 0ms!)
    const h = String(hash || (torrent && torrent.infoHash) || '').toLowerCase();
    const entry = getCacheEntry(h, idx);
    if (entry && entry.completed && isDiskFileTrulyComplete(entry.localPath, total, file, entry.completed)) {
      return serveDiskFileRange(req, res, entry.localPath, MIME[ext] || 'application/octet-stream');
    }

    const isBgRead = Boolean(req.url && req.url.includes('bg=1'));
    if (torrent && req.method !== 'HEAD' && !isBgRead) {
      const isTailProbe = start > total - 2 * 1024 * 1024;
      prioritizeFilePieces(torrent, file, start, isTailProbe ? 512 * 1024 : 2048 * 1024);
      kickTorrentWires(torrent);
    }
    cors(res);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-store'
    };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    res.writeHead(partial ? 206 : 200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = file.createReadStream({ start, end });
    stream.on('error', () => { try { res.destroy(); } catch (e) {} });
    stream.pipe(res);
    res.on('close', () => { try { stream.destroy(); } catch (e) {} });
  }

  const keyframeCache = {};
  const keyframeInFlight = {};
  const activeMuxStart = {};
  const videoHashCache = {};
  const videoHashInFlight = {};

  function computeFileVideoHash(hash, idx, timeoutMs = 3000) {
    const h = String(hash || '').toLowerCase();
    const ck = makeCacheKey(h, idx);
    if (videoHashCache[ck]) return Promise.resolve(videoHashCache[ck]);
    if (videoHashInFlight[ck]) return videoHashInFlight[ck];

    const prom = new Promise((resolve) => {
      const CHUNK = 65536;
      const found = findFile(h, idx);
      if (!found || !found.file || !(found.file.length >= CHUNK * 2)) return resolve(null);
      const total = found.file.length;

      // 1. Se o episódio já está 100% consolidado em disco (não sparse), calcula em < 1ms!
      const entDisk = getCacheEntry(h, idx);
      const fullDiskPath = resolveLocalFilePath(found.torrent, found.file, h, idx);
      if (fullDiskPath && isDiskFileTrulyComplete(fullDiskPath, total, found.file, Boolean(entDisk && entDisk.completed))) {
        const vh = computeOsdbHashFromDiskFile(fullDiskPath);
        if (vh) {
          videoHashCache[ck] = vh;
          if (entDisk) entDisk.videoHash = vh;
          return resolve(vh);
        }
      }

      if (!found.torrent || timeoutMs <= 0) return resolve(null);

      // 2. Prioriza a primeira e a última peça do ficheiro no enxame P2P e lê os dois blocos de 64 KB
      try {
        const per = found.torrent.pieceLength || 262144;
        const fStart = Number.isInteger(found.file._startPiece) ? found.file._startPiece : Math.floor((found.file.offset || 0) / per);
        const fEnd = Number.isInteger(found.file._endPiece) ? found.file._endPiece : Math.floor(((found.file.offset || 0) + total - 1) / per);
        found.torrent.critical(fStart, Math.min(fEnd, fStart + 1));
        found.torrent.critical(Math.max(fStart, fEnd - 1), fEnd);
      } catch (e) {}

      const readSlice = (startByte, endByte) => new Promise((resSlice) => {
        let s = null;
        const chunks = [];
        let len = 0, done = false;
        const finish = (buf) => {
          if (done) return;
          done = true;
          try { if (s) s.destroy(); } catch (e) {}
          resSlice(buf);
        };
        const to = setTimeout(() => finish(null), timeoutMs);
        try {
          s = found.file.createReadStream({ start: startByte, end: endByte });
          s.on('data', d => {
            chunks.push(d);
            len += d.length;
            if (len >= CHUNK) {
              clearTimeout(to);
              finish(Buffer.concat(chunks, len).subarray(0, CHUNK));
            }
          });
          s.on('end', () => {
            clearTimeout(to);
            finish(len >= CHUNK ? Buffer.concat(chunks, len).subarray(0, CHUNK) : null);
          });
          s.on('error', () => { clearTimeout(to); finish(null); });
        } catch (e) {
          clearTimeout(to);
          finish(null);
        }
      });

      Promise.all([
        readSlice(0, CHUNK - 1),
        readSlice(total - CHUNK, total - 1)
      ]).then(([headBuf, tailBuf]) => {
        const vh = computeOsdbHashFromBuffers(total, headBuf, tailBuf);
        if (vh) {
          videoHashCache[ck] = vh;
          const ent = getCacheEntry(h, idx);
          if (ent) ent.videoHash = vh;
        }
        resolve(vh || null);
      }).catch(() => resolve(null));
    }).finally(() => { delete videoHashInFlight[ck]; });

    videoHashInFlight[ck] = prom;
    return prom;
  }

  function probeKeyframe(hash, idx, startSec) {
    if (!ffmpegPath || !(startSec > 0)) return Promise.resolve(startSec > 0 ? startSec : 0);
    const h = String(hash || '').toLowerCase();
    const ck = `${h}:${idx}:${Math.round(startSec * 20)}`;
    if (keyframeCache[ck] !== undefined) return Promise.resolve(keyframeCache[ck]);
    if (keyframeInFlight[ck]) return keyframeInFlight[ck];

    const prom = new Promise((resolve) => {
      const found = findFile(h, idx);
      const cached = tracksCache[makeCacheKey(h, idx)];
      let approxByte = 0;
      if (found && found.file && startSec > 0 && cached && cached.duration > 0) {
        approxByte = Math.floor(Math.min(0.995, startSec / cached.duration) * found.file.length);
      }
      const directDiskPath = isFileRangeOnDisk(found && found.torrent, found && found.file, h, idx, approxByte, 2560 * 1024);
      const ff = runFF([
        '-hide_banner', '-loglevel', 'debug', '-debug_ts',
        '-probesize', directDiskPath ? '512K' : '1M',
        '-analyzeduration', directDiskPath ? '500000' : '1000000',
        '-ss', String(startSec), '-noaccurate_seek',
        '-i', directDiskPath || `${SELF}/stream/${h}/${idx}`,
        '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
        '-frames:v', '2', '-f', 'null', '-'
      ], { stdio: ['ignore', 'ignore', 'pipe'] }, probeProcs);
      let buf = '', done = false;
      const calc = () => {
        const first = (type, key) => {
          const m = new RegExp('demuxer\\s*->\\s*ist_index:\\d+[^\\n]*?type:' + type + '[^\\n]*?' + key + ':(-?[\\d.]+)').exec(buf);
          return m ? parseFloat(m[1]) : null;
        };
        const vals = [
          first('video', 'pkt_pts_time'),
          first('video', 'pkt_dts_time'),
          first('audio', 'pkt_pts_time'),
          first('audio', 'pkt_dts_time')
        ].filter(v => v !== null && isFinite(v) && v >= 0);
        const k = vals.length ? Math.min(...vals) : startSec;
        const res = (k >= 0 && k <= startSec + 2.5 && startSec - k <= 25) ? +k.toFixed(3) : startSec;
        if (vals.length) keyframeCache[ck] = res;
        return res;
      };
      const fin = () => {
        if (done) return;
        done = true;
        clearTimeout(to);
        try { ff.kill('SIGKILL'); } catch (e) {}
        resolve(calc());
      };
      const to = setTimeout(fin, 6000);
      let vidAt = 0;
      ff.stderr.on('data', d => {
        buf += String(d);
        if (buf.length > 600000) buf = buf.slice(0, 200000) + '\n' + buf.slice(-200000);
        const has = (type) => new RegExp('demuxer\\s*->\\s*ist_index:\\d+[^\\n]*?type:' + type + '[^\\n]*?pkt_(?:pts|dts)_time:-?[\\d.]+').test(buf);
        const v = has('video'), a = has('audio');
        if (v && !vidAt) vidAt = buf.length;
        if (v && (a || buf.length - vidAt > 180000)) fin();
      });
      ff.on('close', fin);
      ff.on('error', fin);
    }).finally(() => { delete keyframeInFlight[ck]; });

    keyframeInFlight[ck] = prom;
    return prom;
  }

  function hasAudioSignal(buf) {
    if (!buf || buf.length < 16000 * 15) return false;
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    let active = 0;
    const step = Math.max(1, Math.floor(samples.length / 4000));
    for (let i = 0; i < samples.length; i += step) {
      if (Math.abs(samples[i]) > 24) {
        active++;
        if (active > 40) return true;
      }
    }
    return false;
  }

  const envelopeCache = {};
  function serveEnvelope(req, res, hash, idx, startSec, durSec, audioN = 0) {
    if (!ffmpegPath) return json(res, 501, { ok: false, error: 'ffmpeg não disponível.' });
    const dur = Math.min(360, Math.max(30, durSec || 180));
    const aIdx = Math.max(0, parseInt(audioN, 10) || 0);
    const envKey = `${hash.toLowerCase()}:${idx}:${aIdx}:${Math.round(startSec)}:${Math.round(dur)}`;
    if (envelopeCache[envKey]) {
      return json(res, 200, { ok: true, rate: 100, start: startSec, env: envelopeCache[envKey], cached: true });
    }
    killGroup(envelopeProcs);
    const found = findFile(hash, idx);
    const cacheKey = makeCacheKey(hash, idx);

    (async () => {
      let cached = tracksCache[cacheKey];
      if (!cached || !(cached.duration > 0)) {
        try { cached = await probeTracks(hash, idx); } catch (e) {}
      }
      let approxByte = 0;
      if (found && found.file && startSec > 0 && cached && cached.duration > 0) {
        approxByte = Math.floor(Math.min(0.99, startSec / cached.duration) * found.file.length);
      }
      const directDiskPath = isFileRangeOnDisk(found && found.torrent, found && found.file, hash, idx, approxByte, 3 * 1024 * 1024);

      const run = (af) => new Promise((resolve) => {
        const args = ['-hide_banner', '-loglevel', 'error', '-probesize', directDiskPath ? '1M' : '2M', '-analyzeduration', directDiskPath ? '1000000' : '1500000'];
        if (startSec > 0) args.push('-ss', String(startSec), '-accurate_seek');
        else if (!directDiskPath) args.push('-seekable', '0');
        args.push('-i', directDiskPath || `${SELF}/stream/${hash}/${idx}?bg=1`, '-t', String(dur), '-vn', '-map', `0:a:${aIdx}?`, '-af', af, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1');
        const ff = runFF(args, { stdio: ['ignore', 'pipe', 'pipe'] }, envelopeProcs);
        const chunks = []; let err = '';
        const to = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (e) {} }, 35000);
        ff.stdout.on('data', d => chunks.push(d));
        ff.stderr.on('data', d => { err += String(d); });
        ff.on('error', () => { clearTimeout(to); resolve({ buf: Buffer.alloc(0), err: 'spawn' }); });
        ff.on('close', () => { clearTimeout(to); resolve({ buf: Buffer.concat(chunks), err }); });
        res.on('close', () => { try { ff.kill('SIGKILL'); } catch (e) {} });
      });

      const band = 'highpass=f=250,lowpass=f=3400';
      const audioTrack = (cached && cached.audio && (cached.audio[aIdx] || cached.audio[0])) || null;
      const chInfo = audioTrack ? (audioTrack.ch || '') : '';
      const isSurround = /5\.1|7\.1|6\.1|quad|5\.0|side/i.test(chInfo);
      let r = null;
      if (isSurround) {
        r = await run('pan=mono|c0=FC,' + band);
      }
      if (!r || !hasAudioSignal(r.buf)) {
        r = await run(band);
      }
      if (!hasAudioSignal(r.buf)) return json(res, 502, { ok: false, error: 'Sem áudio suficiente para analisar.' });
      const x = new Int16Array(r.buf.buffer, r.buf.byteOffset, Math.floor(r.buf.length / 2));
      const fr = 80, n = Math.floor(x.length / fr), out = Buffer.alloc(n);
      for (let k = 0; k < n; k++) {
        let sum = 0;
        for (let i = 0; i < fr; i++) { const v = x[k * fr + i] / 32768; sum += v * v; }
        const lg = Math.log(Math.sqrt(sum / fr) + 1e-4);
        out[k] = Math.max(0, Math.min(255, Math.round((lg + 9.21) / 9.21 * 255)));
      }
      const b64 = out.toString('base64');
      envelopeCache[envKey] = b64;
      json(res, 200, { ok: true, rate: 100, start: startSec, env: b64 });
    })().catch((e) => { try { json(res, 500, { ok: false, error: String(e && e.message || e) }); } catch (x) {} });
  }

  const silenceCache = {};
  function serveSilencedetect(req, res, hash, idx, startSec, durSec, audioN = 0) {
    if (!ffmpegPath) return json(res, 501, { ok: false, error: 'ffmpeg não disponível.' });
    const dur = Math.min(240, Math.max(30, durSec || 90));
    const aIdx = Math.max(0, parseInt(audioN, 10) || 0);
    const sKey = `${hash.toLowerCase()}:${idx}:${aIdx}:${Math.round(startSec)}:${Math.round(dur)}`;
    if (silenceCache[sKey]) {
      return json(res, 200, { ok: true, start: startSec, dur, intervals: silenceCache[sKey], cached: true });
    }
    killGroup(envelopeProcs);
    const found = findFile(hash, idx);
    const cacheKey = makeCacheKey(hash, idx);

    (async () => {
      let cached = tracksCache[cacheKey];
      if (!cached || !(cached.duration > 0)) {
        try { cached = await probeTracks(hash, idx); } catch (e) {}
      }
      let approxByte = 0;
      if (found && found.file && startSec > 0 && cached && cached.duration > 0) {
        approxByte = Math.floor(Math.min(0.99, startSec / cached.duration) * found.file.length);
      }
      const directDiskPath = isFileRangeOnDisk(found && found.torrent, found && found.file, hash, idx, approxByte, 3 * 1024 * 1024);
      const audioTrack = (cached && cached.audio && (cached.audio[aIdx] || cached.audio[0])) || null;
      const isSurround = /5\.1|7\.1|6\.1|quad|5\.0|side/i.test(audioTrack ? (audioTrack.ch || '') : '');
      const afChain = (isSurround ? 'pan=mono|c0=FC,' : '') + 'highpass=f=200,lowpass=f=3400,silencedetect=n=-30dB:d=0.30';

      const args = ['-hide_banner', '-nostats', '-loglevel', 'info', '-probesize', directDiskPath ? '1M' : '2M', '-analyzeduration', directDiskPath ? '1000000' : '1500000'];
      if (startSec > 0) args.push('-ss', String(startSec), '-accurate_seek');
      else if (!directDiskPath) args.push('-seekable', '0');
      args.push('-i', directDiskPath || `${SELF}/stream/${hash}/${idx}?bg=1`, '-t', String(dur), '-vn', '-map', `0:a:${aIdx}?`, '-af', afChain, '-f', 'null', '-');

      const stderrLog = await new Promise((resolve) => {
        const ff = runFF(args, { stdio: ['ignore', 'ignore', 'pipe'] }, envelopeProcs);
        let err = '';
        const to = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (e) {} }, 25000);
        ff.stderr.on('data', d => { err += String(d); });
        ff.on('error', () => { clearTimeout(to); resolve(''); });
        ff.on('close', () => { clearTimeout(to); resolve(err); });
        res.on('close', () => { try { ff.kill('SIGKILL'); } catch (e) {} });
      });

      const intervals = parseSilencedetectToSpeech(stderrLog, startSec, dur);
      if (intervals.length >= 3) {
        silenceCache[sKey] = intervals;
      }
      json(res, 200, { ok: intervals.length >= 2, start: startSec, dur, intervals });
    })().catch((e) => { try { json(res, 500, { ok: false, error: String(e && e.message || e) }); } catch (x) {} });
  }

  function serveTranscode(req, res, hash, idx, startSec, audioN, found) {
    if (!ffmpegPath) { return json(res, 501, { ok: false, error: 'ffmpeg não disponível nesta instalação.' }); }
    killGroup(transcodeProcs);

    const cacheKey = makeCacheKey(hash, idx);
    const cached = tracksCache[cacheKey];
    let approxByte = 0;
    if (found && found.file && startSec > 0 && cached && cached.duration > 0) {
      approxByte = Math.floor(Math.min(0.995, startSec / cached.duration) * found.file.length);
      if (found.torrent) {
        prioritizeFilePieces(found.torrent, found.file, approxByte, 3 * 1024 * 1024);
        startReadAheadPump(found.torrent.infoHash, found.file, approxByte, 3 * 1024 * 1024);
        kickTorrentWires(found.torrent);
      }
    }

    const directDiskPath = isFileRangeOnDisk(found && found.torrent, found && found.file, hash, idx, approxByte, 2560 * 1024);
    activeMuxStart[cacheKey] = { requested: startSec, actual: startSec, resolved: !(startSec > 0) };
    if (startSec > 0) {
      probeKeyframe(hash, idx, startSec).then((k) => {
        const cur = activeMuxStart[cacheKey];
        if (cur && Math.abs(cur.requested - startSec) < 0.05) {
          cur.actual = k;
          cur.resolved = true;
        }
      }).catch(() => {});
    }

    cors(res);
    res.setHeader('X-MacStream-Source', directDiskPath ? 'disk-cache-direct' : 'p2p-stream');
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();

    const args = ['-hide_banner', '-nostats', '-loglevel', 'info', '-fflags', '+genpts+discardcorrupt', '-probesize', directDiskPath ? '512K' : '1M', '-analyzeduration', directDiskPath ? '500000' : '1000000'];
    if (startSec > 0) {
      args.push('-ss', String(startSec), '-noaccurate_seek');
    } else if (!directDiskPath) {
      args.push('-seekable', '0');
    }
    args.push('-i', directDiskPath || `${SELF}/stream/${hash}/${idx}`,
      '-map', '0:v:0', '-map', `0:a:${audioN || 0}?`, '-c:v', 'copy');
    const isHevc = (cached && /hevc|h265/i.test(cached.video || '')) || (found && found.file && /x265|hevc|h\.?265/i.test(found.file.name || ''));
    if (isHevc) {
      args.push('-tag:v', 'hvc1');
    }
    args.push('-avoid_negative_ts', 'make_zero', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');
    const ff = runFF(args, { stdio: ['ignore', 'pipe', 'pipe'] }, transcodeProcs);
    let hdrStderr = '';
    let hdrParsed = Boolean(tracksCache[cacheKey]);
    ff.stderr.on('data', d => {
      const s = String(d);
      if (!hdrParsed && hdrStderr.length < 65536) {
        hdrStderr += s;
        if (hdrStderr.includes('Output #0') || hdrStderr.includes('Press [q]')) {
          hdrParsed = true;
          const parsed = parseTracksFromStderr(hdrStderr);
          if (parsed.ok) tracksCache[cacheKey] = parsed;
        }
      }
      if (/error|invalid|failed/i.test(s) && !/decode_slice_header|non-existing PPS|Last message repeated/i.test(s)) {
        console.error('[ffmpeg]', s.trim().slice(0, 220));
      }
    });
    ff.on('error', (e) => { console.error('[ffmpeg] falhou:', e.message); try { res.destroy(); } catch (x) {} });
    ff.stdout.pipe(res);
    res.on('close', () => { try { ff.kill('SIGKILL'); } catch (e) {} });
  }

  const isTestEnv = path.basename(DL_DIR).startsWith('ms-');
  function isPrivateOrLoopbackIp(ipStr, allowTestLoopback = false) {
    let ip = String(ipStr || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (!ip) return true;
    if (ip === '0.0.0.0' || ip === '255.255.255.255' || ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
    if (/^(fe80:|fc00:|fd00:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i.test(ip)) return true;
    if (/^(10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)) return true;
    if (/^127\./.test(ip)) return !allowTestLoopback;
    return false;
  }

  function createSafeDnsLookup(allowTestLoopback) {
    return (hostname, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      const opts = typeof options === 'object' && options !== null ? options : {};
      dns.lookup(hostname, opts, (err, address, family) => {
        if (err) return cb(err);
        if (Array.isArray(address)) {
          if (address.some(a => isPrivateOrLoopbackIp(a && a.address, allowTestLoopback))) {
            return cb(new Error('DNS Rebinding bloqueado para IP privado/loopback.'));
          }
          return cb(null, address);
        }
        if (isPrivateOrLoopbackIp(address, allowTestLoopback)) {
          return cb(new Error('DNS Rebinding bloqueado para IP privado/loopback.'));
        }
        return cb(null, address, family);
      });
    };
  }

  function isSafeIptvUrl(rawUrl, isRedirect = false) {
    let parsed = null;
    try { parsed = new URL(rawUrl); } catch (e) { return false; }
    if (!parsed || !/^https?:$/i.test(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    let host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host.startsWith('::ffff:')) host = host.slice(7);
    if (!host) return false;
    if (/\.(local|internal|localhost)$/i.test(host)) return false;
    const isLoopback = host === 'localhost' || /^127\./.test(host);
    if (isLoopback) {
      const targetPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
      if (targetPort === Number(port) || isRedirect || !isTestEnv) return false;
      return true;
    }
    if (/^[\da-f:.]+$/i.test(host) && (host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host))) {
      return !isPrivateOrLoopbackIp(host, false);
    }
    return true;
  }

  function readBodyWithLimit(req, maxBytes) {
    return new Promise((resolve, reject) => {
      const hardCap = maxBytes + 8 * 1024 * 1024;
      const cl = parseInt(req.headers['content-length'] || '0', 10);
      if (cl > hardCap) return resolve({ tooBig: true, body: '' });
      const chunks = [];
      let total = 0;
      let over = cl > maxBytes;
      let settled = false;
      const done = (val) => { if (!settled) { settled = true; resolve(val); } };
      req.on('data', (ch) => {
        total += ch.length;
        if (total > maxBytes) {
          over = true;
          chunks.length = 0;
          if (total > hardCap) {
            try { req.destroy(); } catch (e) {}
            done({ tooBig: true, body: '' });
          }
          return;
        }
        if (!over) chunks.push(ch);
      });
      req.on('end', () => done(over ? { tooBig: true, body: '' } : { tooBig: false, body: Buffer.concat(chunks).toString('utf8') }));
      req.on('error', (err) => {
        if (over) return done({ tooBig: true, body: '' });
        if (!settled) { settled = true; reject(err); }
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    const remote = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
    if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      return json(res, 403, { ok: false, error: 'forbidden' });
    }
    const referer = req.headers.referer;
    if (referer && !/^file:/i.test(referer) && !/^http:\/\/127\.0\.0\.1:/i.test(referer)) {
      return json(res, 403, { ok: false, error: 'forbidden' });
    }
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch (e) { return json(res, 400, { ok: false }); }
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !/^file:/i.test(origin)) { return json(res, 403, { ok: false, error: 'forbidden' }); }
    let parts = u.pathname.split('/').filter(Boolean);
    if (token) {
      const candidate = String(parts[0] || '');
      const a = Buffer.from(candidate);
      const b = Buffer.from(String(token));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return json(res, 403, { ok: false, error: 'forbidden' });
      }
      parts = parts.slice(1);
    }

    const sfs = req.headers['sec-fetch-site'];
    const sfm = req.headers['sec-fetch-mode'];
    const sfd = req.headers['sec-fetch-dest'];
    const isMedia = parts[0] === 'stream' || parts[0] === 'stream-mp4' || parts[0] === 'transcode' || parts[0] === 'iptv-proxy' || parts[0] === 'iptv-remux' || parts[0] === 'sub' || parts[0] === 'extsub' || sfd === 'video' || sfd === 'track';
    const isAppOrigin = origin === 'null' || /^file:/i.test(origin || '') || req.headers['x-macstream'] === '1' || sfm === 'cors';
    const HASH_RE = /^[a-f0-9]{40}$/i;
    const validRef = (h, i) => HASH_RE.test(h || '') && Number.isInteger(i) && i >= 0 && i < 500;
    if (sfs && sfs !== 'none' && sfs !== 'same-origin' && sfs !== 'same-site' && !isMedia && !isAppOrigin) {
      return json(res, 403, { ok: false, error: 'forbidden' });
    }
    if (['have', 'envelope', 'silencedetect', 'detect-intro', 'keyframe', 'videohash', 'tracks', 'stream', 'stream-mp4', 'transcode', 'sub', 'extsub', 'focus'].includes(parts[0]) && !validRef(parts[1], /^\d+$/.test(parts[2] || '') ? parseInt(parts[2], 10) : -1)) {
      return json(res, 400, { ok: false, error: 'Referência inválida.' });
    }

    if (parts[0] === 'report') {
      const ts = client ? client.torrents.map(t => ({ name: t.name, peers: t.numPeers, down: Math.round(t.downloadSpeed), up: Math.round(t.uploadSpeed), progress: +t.progress.toFixed(3), ready: t.ready })) : [];
      return json(res, 200, { ok: true, node: process.version, platform: process.platform + ' ' + process.arch, ffmpeg: !!ffmpegPath, utp: !!(client && client.utp), battery: batteryMode, cacheDir: DL_DIR, cachedItems: Object.keys(cacheManifest.items).length, torrents: ts, log: LOG.slice(-80) });
    }

    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

    if (parts[0] === 'inject' && req.method === 'POST') {
      let parsedBody = '';
      try {
        const rb = await readBodyWithLimit(req, 8e6);
        if (rb.tooBig) return json(res, 413, { ok: false });
        parsedBody = rb.body;
      } catch (e) { return json(res, 413, { ok: false }); }
      try {
        const j = JSON.parse(parsedBody || '{}');
        const hash = String(j.infoHash || '').toLowerCase();
        const buf = Buffer.from(String(j.torrentB64 || ''), 'base64');
        if (!HASH_RE.test(hash) || !isValidTorrentBuffer(buf)) return json(res, 400, { ok: false });
        const ok = injectMetadataIntoTorrent(getClient(), hash, buf);
        return json(res, 200, { ok });
      } catch (e) { return json(res, 400, { ok: false }); }
    }

    if (parts[0] === 'have' && parts.length >= 3) {
      const h = parts[1].toLowerCase();
      const idx = parseInt(parts[2], 10);
      const found = findFile(h, idx);
      if (!found) return json(res, 404, { ok: false });
      const f = found.file, t = found.torrent;
      const entry = getCacheEntry(h, idx);
      if (!t || (entry && entry.completed)) {
        return json(res, 200, { ok: true, have: 1, diskComplete: true, remuxReady: Boolean(entry && entry.remuxReady) });
      }
      const f0 = Math.max(0, Math.min(1, parseFloat(u.searchParams.get('from') || '0') || 0)), f1 = Math.max(f0, Math.min(1, parseFloat(u.searchParams.get('to') || 1) || 1));
      const a = Math.floor(f.length * f0), b = Math.max(a + 1, Math.ceil(f.length * f1));
      const pl = t.pieceLength, p0 = Math.floor((f.offset + a) / pl), p1 = Math.floor((f.offset + b - 1) / pl);
      let n = 0, tot = 0;
      for (let i = p0; i <= p1; i++) { tot++; try { if (t.bitfield.get(i)) n++; } catch (e) {} }
      return json(res, 200, { ok: true, have: tot ? n / tot : 0, remuxReady: Boolean(entry && entry.remuxReady) });
    }

    if (parts[0] === 'focus' && parts.length >= 3) {
      const h = parts[1].toLowerCase();
      const idx = parseInt(parts[2], 10);
      const found = findFile(h, idx);
      if (!found) return json(res, 404, { ok: false });
      const frac = Math.max(0, Math.min(0.995, parseFloat(u.searchParams.get('frac') || '0') || 0));
      const bytePos = Math.floor(frac * found.file.length);
      if (found.torrent) {
        prioritizeFilePieces(found.torrent, found.file, bytePos, 2560 * 1024);
        startReadAheadPump(found.torrent.infoHash, found.file, bytePos, 2560 * 1024);
        kickTorrentWires(found.torrent);
      }
      const onDisk = Boolean(isFileRangeOnDisk(found.torrent, found.file, h, idx, bytePos, 2048 * 1024));
      return json(res, 200, { ok: true, onDisk });
    }

    if (parts[0] === 'envelope' && parts.length >= 3) {
      const found = findFile(parts[1], parseInt(parts[2], 10));
      if (!found) return json(res, 404, { ok: false });
      return serveEnvelope(req, res, parts[1], parseInt(parts[2], 10), parseFloat(u.searchParams.get('start') || '0') || 0, parseFloat(u.searchParams.get('dur') || '180') || 180, parseInt(u.searchParams.get('audio') || '0', 10) || 0);
    }

    if (parts[0] === 'user-state') {
      if (req.method === 'POST') {
        let parsedBody = '';
        try {
          const rb = await readBodyWithLimit(req, 5e6);
          if (rb.tooBig) return json(res, 413, { ok: false });
          parsedBody = rb.body;
        } catch (e) { return json(res, 413, { ok: false }); }
        try {
          const patch = JSON.parse(parsedBody || '{}');
          const saved = saveUserStateToDisk(patch);
          return json(res, 200, { ok: true, state: saved });
        } catch (e) {
          return json(res, 400, { ok: false, error: 'JSON inválido.' });
        }
      }
      return json(res, 200, { ok: true, state: loadUserStateFromDisk() });
    }

    if (parts[0] === 'detect-intro' && parts.length >= 3) {
      const h = parts[1].toLowerCase();
      const idx = parseInt(parts[2], 10);
      const found = findFile(h, idx);
      if (!found) return json(res, 404, { ok: false });
      const tr = await probeTracks(h, idx).catch(() => null);
      if (tr && tr.intro && tr.intro.ok) {
        return json(res, 200, tr.intro);
      }
      if (!ffmpegPath) return json(res, 200, { ok: false });
      const directDiskPath = isFileRangeOnDisk(found.torrent, found.file, h, idx, 0, 3 * 1024 * 1024);
      const args = ['-hide_banner', '-nostats', '-loglevel', 'info', '-probesize', directDiskPath ? '1M' : '2M', '-analyzeduration', '1000000'];
      if (!directDiskPath) args.push('-seekable', '0');
      args.push('-i', directDiskPath || `${SELF}/stream/${h}/${idx}?bg=1`, '-t', '195', '-vn', '-map', '0:a:0?', '-af', 'silencedetect=n=-30dB:d=0.35', '-f', 'null', '-');
      killGroup(introProcs);
      const stderrLog = await new Promise((resolve) => {
        const ff = runFF(args, { stdio: ['ignore', 'ignore', 'pipe'] }, introProcs);
        let err = '';
        const to = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (e) {} }, 18000);
        ff.stderr.on('data', d => { err += String(d); });
        ff.on('error', () => { clearTimeout(to); resolve(''); });
        ff.on('close', () => { clearTimeout(to); resolve(err); });
        res.on('close', () => { try { ff.kill('SIGKILL'); } catch (e) {} });
      });
      const det = detectIntroFromSilenceLog(stderrLog, 0, 195);
      if (det && det.ok && tr) tr.intro = det;
      return json(res, 200, det);
    }

    if (parts[0] === 'silencedetect' && parts.length >= 3) {
      const found = findFile(parts[1], parseInt(parts[2], 10));
      if (!found) return json(res, 404, { ok: false });
      return serveSilencedetect(req, res, parts[1], parseInt(parts[2], 10), parseFloat(u.searchParams.get('start') || '0') || 0, parseFloat(u.searchParams.get('dur') || '90') || 90, parseInt(u.searchParams.get('audio') || '0', 10) || 0);
    }

    if (parts[0] === 'opensubs') {
      const imdbDigits = String(u.searchParams.get('imdbId') || '').replace(/^tt/i, '').replace(/\D/g, '');
      const imdbRaw = imdbDigits ? imdbDigits.padStart(7, '0') : '';
      const season = parseInt(u.searchParams.get('season') || '0', 10);
      const episode = parseInt(u.searchParams.get('episode') || '0', 10);
      const altEpsRaw = String(u.searchParams.get('altEpisodes') || '')
        .split(',')
        .map(x => parseInt(x.trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0);
      const allowedEpSet = new Set([episode, ...altEpsRaw].filter(n => n > 0));
      const vHash = String(u.searchParams.get('videoHash') || '').toLowerCase().trim();
      const vSize = parseInt(u.searchParams.get('videoSize') || '0', 10);
      const langs = ['por', 'pob', 'eng'];
      const queries = [];
      if (/^[a-f0-9]{16}$/.test(vHash) && vSize > 0) {
        queries.push(`https://rest.opensubtitles.org/search/moviebytesize-${vSize}/moviehash-${vHash}/sublanguageid-${langs.join(',')}`);
      }
      if (imdbRaw) {
        if (season > 0 && episode > 0) {
          queries.push(`https://rest.opensubtitles.org/search/episode-${episode}/imdbid-${imdbRaw}/season-${season}/sublanguageid-${langs.join(',')}`);
        } else {
          queries.push(`https://rest.opensubtitles.org/search/imdbid-${imdbRaw}/sublanguageid-${langs.join(',')}`);
        }
      }
      const results = await Promise.all(queries.map(q => httpsJsonGet(q, {}, 4000)));
      const merged = [];
      const seen = new Set();
      for (const arr of results) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (!item || !item.IDSubtitleFile) continue;
          const fmt = String(item.SubFormat || '').toLowerCase();
          if (fmt && fmt !== 'srt' && fmt !== 'vtt') continue;
          const isHashItem = String(item.MatchedBy || '').toLowerCase() === 'moviehash' || (vHash && String(item.MovieHash || '').toLowerCase() === vHash);
          if (!isHashItem && season > 0 && episode > 0) {
            const iSeason = parseInt(item.SeriesSeason || '0', 10);
            const iEpisode = parseInt(item.SeriesEpisode || '0', 10);
            if (iSeason > 0 && iSeason !== season) continue;
            if (iEpisode > 0 && !allowedEpSet.has(iEpisode)) continue;
            const metaNames = `${item.SubFileName || ''} ${item.MovieReleaseName || ''}`;
            const matchesAnyAllowed = Array.from(allowedEpSet).some(ep => !fileHasConflictingEpisode(metaNames, season, ep));
            if (!matchesAnyAllowed) continue;
          }
          if (seen.has(item.IDSubtitleFile)) continue;
          seen.add(item.IDSubtitleFile);
          const gzUrl = item.SubDownloadLink || '';
          if (!gzUrl) continue;
          merged.push({
            id: String(item.IDSubtitleFile),
            lang: String(item.ISO639 === 'pb' || item.SubLanguageID === 'pob' ? 'pob' : (item.SubLanguageID || 'por')).toLowerCase(),
            SubFileName: item.SubFileName || '',
            MovieReleaseName: item.MovieReleaseName || '',
            MatchedBy: String(item.MatchedBy || '').toLowerCase(),
            MovieHash: String(item.MovieHash || '').toLowerCase(),
            SubHearingImpaired: item.SubHearingImpaired === '1',
            SubDownloadsCnt: parseInt(item.SubDownloadsCnt || '0', 10) || 0,
            url: `${SELF}/opensubs-dl?url=${encodeURIComponent(gzUrl)}`
          });
        }
      }
      return json(res, 200, { ok: true, subtitles: merged });
    }

    if (parts[0] === 'opensubs-dl') {
      const targetUrl = String(u.searchParams.get('url') || '');
      let parsedSubUrl = null;
      try { parsedSubUrl = new URL(targetUrl); } catch (e) {}
      const subHost = parsedSubUrl ? parsedSubUrl.hostname.toLowerCase() : '';
      if (!parsedSubUrl || parsedSubUrl.protocol !== 'https:' || parsedSubUrl.username || parsedSubUrl.password || (subHost !== 'opensubtitles.org' && !subHost.endsWith('.opensubtitles.org'))) {
        return json(res, 400, { ok: false, error: 'URL inválido.' });
      }
      try {
        const buf = await new Promise((resolve) => {
          let done = false;
          const fin = (b) => { if (!done) { done = true; resolve(b); } };
          const to = setTimeout(() => fin(null), 6000);
          https.get(targetUrl, { headers: { 'User-Agent': 'TemporaryUserAgent' }, timeout: 6000 }, (r) => {
            if (r.statusCode !== 200) { r.resume(); clearTimeout(to); return fin(null); }
            const ch = [];
            let len = 0;
            r.on('data', d => {
              len += d.length;
              if (len > 2 * 1024 * 1024) { r.destroy(); clearTimeout(to); return fin(null); }
              ch.push(d);
            });
            r.on('end', () => { clearTimeout(to); fin(Buffer.concat(ch)); });
          }).on('error', () => { clearTimeout(to); fin(null); });
        });
        if (!buf || !buf.length) return json(res, 502, { ok: false });
        const outBuf = (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) ? zlib.gunzipSync(buf, { maxOutputLength: 5 * 1024 * 1024 }) : buf;
        cors(res);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=3600' });
        return res.end(outBuf);
      } catch (e) {
        return json(res, 502, { ok: false });
      }
    }

    if (parts[0] === 'iptv-close') {
      const screenId = String(u.searchParams.get('screen') || 'all');
      if (screenId === 'all') {
        closeIptvScreen('1');
        closeIptvScreen('2');
      } else {
        closeIptvScreen(screenId);
      }
      return json(res, 200, { ok: true });
    }

    if (parts[0] === 'iptv-proxy') {
      const rawTarget = String(u.searchParams.get('url') || '').trim();
      const screenId = String(u.searchParams.get('screen') || '1');
      const isSeg = u.searchParams.get('seg') === '1';
      if (!isSafeIptvUrl(rawTarget, false)) {
        return json(res, 400, { ok: false, error: 'URL IPTV inválido.' });
      }
      // Se não for um segmento HLS individual, fecha qualquer processo FFmpeg anterior deste ecrã para respeitar max_connections=1 do Xtream
      if (!isSeg && iptvProcs.has(screenId)) {
        const oldP = iptvProcs.get(screenId);
        try { oldP.kill('SIGKILL'); } catch (x) {}
        activeProcs.delete(oldP);
        iptvProcs.delete(screenId);
      }
      const proxyFetch = (urlStr, redirectsLeft = 6, triedTsFallback = false, isRedirect = false) => {
        if (redirectsLeft < 0) { if (!res.headersSent) json(res, 502, { ok: false }); return; }
        let uObj;
        try { uObj = new URL(urlStr); } catch (err) { if (!res.headersSent) json(res, 400, { ok: false }); return; }
        const mod = uObj.protocol === 'https:' ? https : http;
        const headers = {
          'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
          'Accept': '*/*',
          'Connection': 'keep-alive'
        };
        if (req.headers.range) headers['Range'] = req.headers.range;
        const upReq = mod.get(urlStr, { headers, timeout: 12000, lookup: createSafeDnsLookup(isTestEnv && !isRedirect) }, (upRes) => {
          if ([301, 302, 303, 307, 308].includes(upRes.statusCode) && upRes.headers.location) {
            upRes.resume();
            let nextUrl = upRes.headers.location;
            try { nextUrl = new URL(nextUrl, urlStr).toString(); } catch (err) { if (!res.headersSent) json(res, 502, { ok: false }); return; }
            if (!isSafeIptvUrl(nextUrl, true)) { if (!res.headersSent) json(res, 400, { ok: false }); return; }
            return proxyFetch(nextUrl, redirectsLeft - 1, triedTsFallback, true);
          }
          if (upRes.statusCode !== 200 && upRes.statusCode !== 206) {
            upRes.resume();
            // Se o servidor Xtream bloquear .m3u8 (404/403), tenta automaticamente o stream .ts equivalente!
            if (!triedTsFallback && /\/live\/[^/]+\/[^/]+\/\d+\.m3u8/i.test(urlStr)) {
              const tsUrl = urlStr.replace(/\.m3u8(\?|$)/i, '.ts$1');
              return proxyFetch(tsUrl, 5, true);
            }
            if (!res.headersSent) json(res, upRes.statusCode || 502, { ok: false });
            return;
          }
          const ct = String(upRes.headers['content-type'] || '').toLowerCase();
          const isM3u8 = (/mpegurl|m3u8/i.test(ct) || /\.m3u8(\?|$)/i.test(uObj.pathname)) && !triedTsFallback;
          if (isM3u8) {
            const chunks = [];
            let len = 0;
            upRes.on('data', d => {
              len += d.length;
              if (len <= 4 * 1024 * 1024) chunks.push(d);
            });
            upRes.on('end', () => {
              try {
                const rawBuf = Buffer.concat(chunks);
                // Se o servidor devolveu bytes MPEG-TS binários (0x47) mesmo num URL .m3u8, serve como stream TS!
                if (rawBuf.length > 188 && rawBuf[0] === 0x47 && rawBuf[188] === 0x47) {
                  cors(res);
                  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
                  res.end(rawBuf);
                  return;
                }
                const rawM3u = rawBuf.toString('utf8');
                if (!rawM3u.includes('#EXTM3U') && !triedTsFallback && /\/live\/[^/]+\/[^/]+\/\d+\.m3u8/i.test(urlStr)) {
                  const tsUrl = urlStr.replace(/\.m3u8(\?|$)/i, '.ts$1');
                  return proxyFetch(tsUrl, 5, true);
                }
                const rewritten = rawM3u.split(/\r?\n/).map(line => {
                  const trimmed = line.trim();
                  if (!trimmed) return line;
                  if (trimmed.startsWith('#')) {
                    return line.replace(/URI="([^"]+)"/gi, (_, uriVal) => {
                      try {
                        const abs = new URL(uriVal, urlStr).toString();
                        if (!isSafeIptvUrl(abs, false)) return _;
                        return `URI="${SELF}/iptv-proxy?url=${encodeURIComponent(abs)}&screen=${screenId}&seg=1"`;
                      } catch (err) { return _; }
                    });
                  }
                  try {
                    const abs = new URL(trimmed, urlStr).toString();
                    if (!isSafeIptvUrl(abs, false)) return line;
                    return `${SELF}/iptv-proxy?url=${encodeURIComponent(abs)}&screen=${screenId}&seg=1`;
                  } catch (err) {
                    return line;
                  }
                }).join('\n');
                cors(res);
                res.writeHead(200, {
                  'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                  'Cache-Control': 'no-store'
                });
                res.end(rewritten);
              } catch (err) {
                if (!res.headersSent) json(res, 502, { ok: false });
              }
            });
            return;
          }
          if (!isSeg) iptvProxyReqs.set(screenId, upReq);
          cors(res);
          const outHeaders = {
            'Content-Type': upRes.headers['content-type'] || 'video/mp2t',
            'Cache-Control': 'no-store'
          };
          if (upRes.headers['content-length']) outHeaders['Content-Length'] = upRes.headers['content-length'];
          if (upRes.headers['content-range']) outHeaders['Content-Range'] = upRes.headers['content-range'];
          res.writeHead(upRes.statusCode, outHeaders);
          upRes.pipe(res);
          res.on('close', () => {
            if (iptvProxyReqs.get(screenId) === upReq) iptvProxyReqs.delete(screenId);
            try { upReq.destroy(); upRes.destroy(); } catch (err) {}
          });
        });
        upReq.on('error', () => { if (!res.headersSent) json(res, 502, { ok: false }); });
        upReq.on('timeout', () => { upReq.destroy(); if (!res.headersSent) json(res, 504, { ok: false }); });
        res.on('close', () => { try { upReq.destroy(); } catch (err) {} });
      };
      proxyFetch(rawTarget);
      return;
    }

    if (parts[0] === 'iptv-remux') {
      const rawTarget = String(u.searchParams.get('url') || '').trim();
      const screenId = String(u.searchParams.get('screen') || '1');
      if (!isSafeIptvUrl(rawTarget, false)) {
        return json(res, 400, { ok: false, error: 'URL IPTV inválido.' });
      }
      if (!ffmpegPath) return json(res, 501, { ok: false, error: 'ffmpeg não disponível.' });
      // Fecha imediatamente qualquer ligação anterior neste ecrã (respeita max_connections=1 nos painéis Xtream!)
      closeIptvScreen(screenId);
      // Em servidores Xtream, o endpoint .ts direto é muito mais rápido e estável no FFmpeg do que .m3u8
      const inputUrl = /\/live\/[^/]+\/[^/]+\/\d+\.m3u8/i.test(rawTarget)
        ? rawTarget.replace(/\.m3u8(\?|$)/i, '.ts$1')
        : rawTarget;
      cors(res);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      const ff = runFF([
        '-hide_banner', '-nostats', '-loglevel', 'error',
        '-user_agent', 'VLC/3.0.20 LibVLC/3.0.20',
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
        '-fflags', '+genpts+discardcorrupt+nobuffer',
        '-flags', 'low_delay',
        '-probesize', '512K', '-analyzeduration', '600000',
        '-i', inputUrl,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4', 'pipe:1'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      iptvProcs.set(screenId, ff);
      ff.stdout.pipe(res);
      const cleanIptv = () => {
        if (iptvProcs.get(screenId) === ff) iptvProcs.delete(screenId);
        try { ff.kill('SIGKILL'); } catch (err) {}
      };
      ff.on('close', cleanIptv);
      ff.on('error', cleanIptv);
      res.on('close', cleanIptv);
      return;
    }

    if (parts[0] === 'keyframe' && parts.length >= 3) {
      const found = findFile(parts[1], parseInt(parts[2], 10));
      if (!found) return json(res, 404, { ok: false });
      const S = parseFloat(u.searchParams.get('t') || '0') || 0;
      const k = await probeKeyframe(parts[1], parseInt(parts[2], 10), S);
      return json(res, 200, { ok: true, t: k, start: k });
    }

    if (parts[0] === 'videohash' && parts.length >= 3) {
      const h = parts[1].toLowerCase();
      const idx = parseInt(parts[2], 10);
      const found = findFile(h, idx);
      if (!found || !found.file) return json(res, 404, { ok: false });
      const toMs = Math.max(0, Math.min(8000, parseInt(u.searchParams.get('timeout') || '2500', 10) || 2500));
      const vh = await computeFileVideoHash(h, idx, toMs);
      return json(res, 200, { ok: Boolean(vh), videoHash: vh || null, videoSize: found.file.length });
    }

    if (parts[0] === 'sub' && parts.length >= 4) {
      const found = findFile(parts[1], parseInt(parts[2], 10));
      if (!found) return json(res, 404, { ok: false });
      const subN = Math.max(0, parseInt(parts[3], 10) || 0);
      return serveEmbeddedSub(req, res, parts[1], parseInt(parts[2], 10), subN);
    }

    if (parts[0] === 'extsub' && parts.length >= 3) {
      const found = findFile(parts[1], parseInt(parts[2], 10));
      if (!found) return json(res, 404, { ok: false });
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      const s = found.file.createReadStream();
      s.on('error', () => { try { res.destroy(); } catch (e) {} });
      s.pipe(res);
      res.on('close', () => { try { s.destroy(); } catch (e) {} });
      return;
    }

    if (parts[0] === 'status') {
      const hash = (u.searchParams.get('hash') || '').toLowerCase();
      const fi = parseInt(u.searchParams.get('fileIdx') || '-1', 10);
      let t = null;
      if (client && client.torrents.length) {
        if (hash) {
          t = client.torrents.find(x => x.infoHash && x.infoHash.toLowerCase() === hash) || null;
          // Se estiver em curso uma corrida legítima de altMagnets para este hash, pode mostrar o progresso desse alt
          if ((!t || t.numPeers === 0) && activeAltMap.has(hash)) {
            const alts = activeAltMap.get(hash) || [];
            const altT = client.torrents.find(x => x.infoHash && alts.includes(x.infoHash.toLowerCase()) && x.numPeers > 0);
            if (altT) t = altT;
          }
        } else {
          const sorted = [...client.torrents].sort((a, b) => ((b.downloadSpeed || 0) - (a.downloadSpeed || 0)) || ((b.numPeers || 0) - (a.numPeers || 0)));
          t = sorted[0] || null;
        }
      }
      const ff = t && t.files && (fi >= 0 ? t.files[fi] : t.files[t._selectedFileIdx || 0]) ? (fi >= 0 ? t.files[fi] : t.files[t._selectedFileIdx || 0]) : null;
      // NUNCA mistura o hash pedido com outro episódio diferente que esteja em primaryHash!
      const activeHash = hash || (t && t.infoHash ? t.infoHash.toLowerCase() : '') || cacheManifest.primaryHash || '';
      const entry = getCacheEntry(activeHash, fi >= 0 ? fi : undefined);
      const prog = (entry && entry.completed) ? 1 : (ff ? ff.progress : (t ? t.progress : (entry ? entry.progress : 0)));
      const remuxReady = Boolean(entry && entry.remuxReady && entry.remuxMp4Path && fs.existsSync(entry.remuxMp4Path));
      const pieceMap = (entry && entry.completed) ? new Array(64).fill(1) : (ff && t ? computePieceMap(t, ff, 64) : []);

      return json(res, 200, {
        ok: true,
        active: Boolean(t || entry),
        ready: Boolean((t && t.ready) || (entry && entry.completed)),
        paused: Boolean(t && t.paused),
        infoHash: t ? t.infoHash : (entry ? entry.infoHash : (hash || null)),
        fileIdx: ff && t ? t.files.indexOf(ff) : (entry ? entry.fileIdx : (fi >= 0 ? fi : 0)),
        downloadSpeed: t ? t.downloadSpeed : 0,
        uploadSpeed: t ? t.uploadSpeed : 0,
        numPeers: t ? t.numPeers : 0,
        progress: prog,
        torrentProgress: t ? t.progress : (entry ? entry.progress : 0),
        downloaded: t ? t.downloaded : (entry && entry.length ? Math.round(entry.length * (entry.progress || 0)) : 0),
        remuxReady,
        remuxing: Boolean(entry && entry.remuxing),
        mp4Url: remuxReady && entry ? `${SELF}/stream-mp4/${entry.infoHash}/${entry.fileIdx || 0}` : null,
        muxStartSec: (activeMuxStart[makeCacheKey(activeHash, ff && t ? t.files.indexOf(ff) : (entry ? entry.fileIdx : (fi >= 0 ? fi : 0)))] || {}).actual ?? null,
        muxStartResolved: Boolean((activeMuxStart[makeCacheKey(activeHash, ff && t ? t.files.indexOf(ff) : (entry ? entry.fileIdx : (fi >= 0 ? fi : 0)))] || {}).resolved),
        pieceMap,
        ffmpeg: !!ffmpegPath,
        utp: !!(client && client.utp)
      });
    }

    if (parts[0] === 'cache-info') {
      const items = Object.values(cacheManifest.items).map(entry => {
        const t = client ? client.torrents.find(x => x.infoHash && x.infoHash.toLowerCase() === entry.infoHash) : null;
        const ff = t && t.files && t.files[entry.fileIdx || 0] ? t.files[entry.fileIdx || 0] : null;
        const exists = Boolean(entry.localPath && fs.existsSync(entry.localPath));
        const diskFull = isDiskFileTrulyComplete(entry.localPath, entry.length, ff, entry.completed);
        const completed = Boolean(diskFull || (ff && ff.progress >= 0.999));
        const prog = completed ? 1 : (ff ? ff.progress : (t ? t.progress : (entry.progress || 0)));
        const remuxReady = Boolean(entry.remuxReady && entry.remuxMp4Path && fs.existsSync(entry.remuxMp4Path));
        return {
          ...entry,
          progress: +prog.toFixed(4),
          completed,
          downloadSpeed: t ? t.downloadSpeed : 0,
          numPeers: t ? t.numPeers : 0,
          paused: Boolean(t && t.paused),
          activeInSwarm: Boolean(t),
          existsOnDisk: exists,
          remuxReady,
          remuxing: Boolean(entry.remuxing),
          isPrimary: cacheManifest.primaryHash === entry.infoHash,
          isPreload: cacheManifest.preloadHash === entry.infoHash,
          pieceMap: completed ? new Array(48).fill(1) : (ff && t ? computePieceMap(t, ff, 48) : [])
        };
      }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      return json(res, 200, {
        ok: true,
        cacheDir: DL_DIR,
        bytes: dirSize(DL_DIR),
        primaryHash: cacheManifest.primaryHash,
        preloadHash: cacheManifest.preloadHash,
        items
      });
    }

    if (parts[0] === 'pause' || (parts[0] === 'stop' && u.searchParams.get('destroy') !== '1')) {
      killPlaybackProcs();
      for (const [, s] of activePumps) { try { s.destroy(); } catch (e) {} }
      activePumps.clear();
      const pauseSwarm = u.searchParams.get('pauseSwarm') !== '0';
      if (client && pauseSwarm) {
        for (const t of client.torrents) {
          try { if (typeof t.pause === 'function') t.pause(); } catch (e) {}
        }
      }
      saveCacheManifest();
      return json(res, 200, { ok: true, cached: true, items: Object.keys(cacheManifest.items).length });
    }

    if (parts[0] === 'resume-download') {
      const hash = (u.searchParams.get('hash') || cacheManifest.primaryHash || '').toLowerCase();
      const fi = u.searchParams.get('fileIdx');
      const idx = fi !== null && fi !== '' ? parseInt(fi, 10) : undefined;
      if (client) {
        const t = client.torrents.find(x => x.infoHash && x.infoHash.toLowerCase() === hash);
        if (t) {
          kickTorrentWires(t);
          return json(res, 200, { ok: true, active: true });
        }
      }
      const entry = getCacheEntry(hash, idx);
      if (entry && entry.magnet) {
        preloadTorrent(entry.magnet, entry.fileIdx, entry.season, entry.episode, { ...entry, fullPreload: true }).catch(() => {});
        return json(res, 200, { ok: true, restarted: true });
      }
      return json(res, 404, { ok: false });
    }

    if (parts[0] === 'evict') {
      const hash = (u.searchParams.get('hash') || '').toLowerCase();
      const fi = u.searchParams.get('fileIdx');
      if (!HASH_RE.test(hash)) return json(res, 400, { ok: false });
      evictCacheEntry(hash, fi !== null && fi !== '' ? parseInt(fi, 10) : undefined);
      return json(res, 200, { ok: true, bytes: dirSize(DL_DIR) });
    }

    if (parts[0] === 'stop') {
      killAllProcs();
      for (const [, s] of activePumps) { try { s.destroy(); } catch (e) {} }
      activePumps.clear();
      if (client) for (const t of [...client.torrents]) { try { t.destroy({ destroyStore: true }); } catch (e) {} }
      return json(res, 200, { ok: true });
    }

    if (parts[0] === 'preload') {
      const magnet = u.searchParams.get('magnet');
      if (!magnet || !/^magnet:\?/i.test(magnet)) return json(res, 400, { ok: false });
      const fi = u.searchParams.get('fileIdx');
      const sNum = u.searchParams.get('season');
      const eNum = u.searchParams.get('episode');
      const fullPreload = u.searchParams.get('full') === '1';
      const meta = {
        title: u.searchParams.get('title') || '',
        imdbId: u.searchParams.get('imdbId') || '',
        poster: u.searchParams.get('poster') || '',
        backdrop: u.searchParams.get('backdrop') || '',
        fullPreload
      };
      preloadTorrent(
        magnet,
        fi === null || fi === '' ? undefined : parseInt(fi, 10),
        sNum ? parseInt(sNum, 10) : undefined,
        eNum ? parseInt(eNum, 10) : undefined,
        meta
      ).catch(() => {});
      return json(res, 200, { ok: true, preloadHash: extractInfoHash(magnet) });
    }

    if (parts[0] === 'tracks' && parts.length >= 3) {
      const r = await probeTracks(parts[1], parseInt(parts[2], 10));
      return json(res, 200, r);
    }

    if (parts[0] === 'cache') {
      return json(res, 200, { ok: true, bytes: dirSize(DL_DIR), items: Object.keys(cacheManifest.items).length });
    }

    if (parts[0] === 'clear') {
      killAllProcs();
      for (const [, s] of activePumps) { try { s.destroy(); } catch (e) {} }
      activePumps.clear();
      if (client) for (const t of [...client.torrents]) { try { t.destroy({ destroyStore: true }); } catch (e) {} }
      cacheManifest.items = {};
      cacheManifest.primaryHash = null;
      cacheManifest.preloadHash = null;
      invalidateDirSizeCache();
      try {
        for (const ent of fs.readdirSync(DL_DIR)) {
          if (ent === 'user-state.json') continue;
          fs.rmSync(path.join(DL_DIR, ent), { recursive: true, force: true });
        }
      } catch (e) {}
      return json(res, 200, { ok: true });
    }

    if (parts[0] === 'start' && req.method === 'POST') {
      let body = '';
      try { for await (const ch of req) { body += ch; if (body.length > 8e6) throw new Error('grande'); } } catch (e) { return json(res, 413, { ok: false }); }
      try {
        const j = JSON.parse(body || '{}');
        const buf = Buffer.from(String(j.torrentB64 || ''), 'base64');
        if (buf.length < 20 || buf[0] !== 0x64) return json(res, 400, { ok: false, error: '.torrent inválido.' });
        const fi = Number.isInteger(j.fileIdx) ? j.fileIdx : undefined;
        return json(res, 200, await startTorrent(buf, fi, [], undefined, undefined, { title: j.title || '' }));
      } catch (e) { return json(res, 504, { ok: false, error: e && e.message ? e.message : String(e) }); }
    }

    if (parts[0] === 'start') {
      const magnet = u.searchParams.get('magnet');
      if (!magnet || !/^magnet:\?/i.test(magnet)) return json(res, 400, { ok: false, error: 'Magnet inválido.' });
      const fi = u.searchParams.get('fileIdx');
      const alt = u.searchParams.getAll('alt').filter(m => /^magnet:\?/i.test(m));
      const sNum = u.searchParams.get('season');
      const eNum = u.searchParams.get('episode');
      const meta = {
        title: u.searchParams.get('title') || '',
        imdbId: u.searchParams.get('imdbId') || '',
        poster: u.searchParams.get('poster') || '',
        backdrop: u.searchParams.get('backdrop') || ''
      };
      try {
        const info = await startTorrent(
          magnet,
          fi === null || fi === '' ? undefined : parseInt(fi, 10),
          alt,
          sNum ? parseInt(sNum, 10) : undefined,
          eNum ? parseInt(eNum, 10) : undefined,
          meta
        );
        return json(res, 200, info);
      } catch (e) {
        return json(res, 504, { ok: false, error: e && e.message ? e.message : String(e) });
      }
    }

    if (parts[0] === 'stream-mp4' && parts.length >= 3) {
      const h = parts[1].toLowerCase();
      const idx = parseInt(parts[2], 10);
      const entry = getCacheEntry(h, idx);
      const mp4Path = (entry && entry.remuxMp4Path && fs.existsSync(entry.remuxMp4Path)) ? entry.remuxMp4Path : getRemuxMp4Path(h, idx);
      if (fs.existsSync(mp4Path)) {
        return serveDiskFileRange(req, res, mp4Path, 'video/mp4');
      }
      const found = findFile(h, idx);
      if (found) return serveFile(req, res, found.file, found.torrent, h, idx);
      return json(res, 404, { ok: false, error: 'MP4 em cache ainda não disponível.' });
    }

    if ((parts[0] === 'stream' || parts[0] === 'transcode') && parts.length >= 3) {
      const h = parts[1].toLowerCase();
      const idx = parseInt(parts[2], 10);
      const found = findFile(h, idx);
      if (!found) return json(res, 404, { ok: false, error: 'Torrent não está ativo.' });
      if (parts[0] === 'stream') return serveFile(req, res, found.file, found.torrent, h, idx);
      return serveTranscode(req, res, h, idx, parseFloat(u.searchParams.get('start') || '0') || 0, parseInt(u.searchParams.get('audio') || '0', 10) || 0, found);
    }

    json(res, 200, { ok: true, engine: 'MacStream interno v3.0' });
  });

  server.on('error', (e) => console.error('[engine] servidor:', e.message));
  server.listen(port, '127.0.0.1');

  return {
    port,
    server,
    injectTorrent(hash, buf) {
      return injectMetadataIntoTorrent(getClient(), hash, buf);
    },
    setBattery(on) { batteryMode = !!on; },
    stop() {
      console.error = origErr;
      killAllProcs();
      for (const [, s] of activePumps) { try { s.destroy(); } catch (e) {} }
      activePumps.clear();
      saveCacheManifest();
      try { server.close(); } catch (e) {}
      if (client) { try { client.destroy(); } catch (e) {} client = null; }
      if (isTempTestDir) {
        try { fs.rmSync(DL_DIR, { recursive: true, force: true }); } catch (e) {}
      }
    }
  };
}

module.exports = { startEngine, parseEpisodeCodesFromText, fileHasConflictingEpisode, fileMatchesEpisode, computeOsdbHashFromBuffers, computeOsdbHashFromDiskFile, parseSilencedetectToSpeech, detectIntroFromSilenceLog, parseTracksFromStderr };
