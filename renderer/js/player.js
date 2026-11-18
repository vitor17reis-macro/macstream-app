'use strict';
      // =======================================================================
      function teardownMedia() {
        clearTimeout(state.seekTimer); state.seekAcc = null;
        clearTimeout(state.slowTimer);
        clearTimeout(state.startTimer);
        clearTimeout(state.nativeSeekCheckTimer);
        clearTimeout(state.postSeekCalibTimer);
        clearTimeout(state.actOneCalibTimer);
        clearTimeout(state.bufferStatusTimer);
        clearInterval(state.telemetryTimer);
        clearTimeout(state.p2pWatchdogTimer);
        const fBadge = document.getElementById('playerFastSeekBadge');
        if (fBadge) fBadge.classList.add('hidden');
        if (state.activeHls) {
          try { state.activeHls.destroy(); } catch (e) {}
          state.activeHls = null;
        }
        if (state.activeTorrent) {
          try { state.activeTorrent.destroy(); } catch (e) {}
          state.activeTorrent = null;
        }
        const v = el.cineVideoPlayer;
        v.onloadedmetadata = null;
        v.onwaiting = null;
        v.oncanplay = null;
        v.onplaying = null;
        v.onerror = null;
        v.pause();
        v.removeAttribute('src');
        v.load();
      }

      function describePlayerWaitStatus() {
        const ctx = state.playingContext || {};
        const info = state.engineInfo || {};
        const tel = state.lastTel || {};
        const titleHint = `${info.name || ''} ${(ctx.stream && (ctx.stream.title || ctx.stream.audioTag)) || ''}`;
        if (state.compat) {
          if (/\b(eac3|ddp5?\.?1?|dd\+|ac-?3|dts|truehd|atmos)\b/i.test(titleHint)) {
            return '🔊 A converter áudio EAC3/5.1 para AAC...';
          }
          return '🔄 A preparar vídeo (remux em tempo real)...';
        }
        if (tel.remuxing) return '⚡ A otimizar MP4 em cache...';
        if ((tel.downloaded || 0) < 2 * 1024 * 1024 && !tel.remuxReady && !tel.ready) {
          return '⏳ A aguardar início do ficheiro P2P...';
        }
        return '⏳ A carregar buffer de vídeo...';
      }

      function setSubCalibBadge(text, tone) {
        const b = document.getElementById('subCalibStatusBadge');
        if (!b) return;
        if (!text) {
          b.classList.add('hidden');
          b.textContent = '';
          return;
        }
        b.textContent = text;
        b.classList.remove('hidden', 'bg-emerald-500/20', 'border-emerald-500/35', 'text-emerald-300', 'bg-amber-500/20', 'border-amber-500/35', 'text-amber-300', 'bg-indigo-500/20', 'border-indigo-500/35', 'text-indigo-200');
        if (tone === 'warn') b.classList.add('bg-amber-500/20', 'border-amber-500/35', 'text-amber-300');
        else if (tone === 'work') b.classList.add('bg-indigo-500/20', 'border-indigo-500/35', 'text-indigo-200');
        else b.classList.add('bg-emerald-500/20', 'border-emerald-500/35', 'text-emerald-300');
      }

      function clearSubtitleTracks() {
        state.subToken++; state.calibRunId = (state.calibRunId || 0) + 1;
        state.activeSubCode = null; state.activeSubOffset = null; state.activeSubManual = false; state.actOneFollowUpDone = false;
        state.lastSubCands = [];
        setSubCalibBadge('');
        Array.from(el.cineVideoPlayer.querySelectorAll('track')).forEach(t => t.remove());
        state.subtitleUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        state.subtitleUrls = [];
        state.subtitleTracks = [];
        el.subtitleTrackSelect.innerHTML = '<option value="off" class="bg-slate-900">Sem legendas</option>';
        el.subtitleTrackSelect.value = 'off';
      }

      function cleanupActivePlayerSession() {
        clearInterval(state.progressSaveTimer);
        clearInterval(state.upNextTimer);
        clearTimeout(state.slowTimer);
        clearTimeout(state.startTimer);
        clearTimeout(state.postSeekCalibTimer);
        clearTimeout(state.actOneCalibTimer);
        state.playToken++;
        state.seekEpoch = (state.seekEpoch || 0) + 1;
        state.engineTrackDuration = 0;
        state.seekTarget = null;
        state.seekLockUntil = 0;
        state.seekPreviewTime = null;
        el.upNextEpisodeCard.classList.add('hidden');
        el.localEngineMissingCard.classList.add('hidden');
        el.playerLoadingOverlay.classList.add('hidden');
        teardownMedia();
        clearSubtitleTracks();
      }

      function updatePlayModePillsUI(activeMode) {
        state.activePlayMode = activeMode;
        document.querySelectorAll('.play-mode-pill').forEach(btn => {
          const m = btn.getAttribute('data-playmode');
          btn.className = m === activeMode
            ? 'play-mode-pill px-3 py-1 rounded-lg text-[11px] font-bold bg-indigo-600 text-white shadow-sm mac-transition shrink-0'
            : 'play-mode-pill px-3 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:text-white mac-transition shrink-0';
        });
      }

      function friendlyError(msg) {
        const m = String(msg || '');
        if (/metadados|peers|timeout|tempo/i.test(m)) return 'Esta fonte não tem ninguém a partilhar neste momento.';
        if (/ffmpeg/i.test(m)) return 'A conversão de áudio não está disponível nesta instalação.';
        if (/forbidden|Unexpected token/i.test(m)) return 'O motor interno reiniciou a sessão. Clica em "Tentar outra vez".';
        if (/fetch|network|ECONN/i.test(m)) return 'O motor da app não respondeu. Clica em "Tentar outra vez".';
        return m;
      }

      function showEngineHelp(message) {
        const app = Boolean(window.macstreamApp);
        el.engineHelpText.textContent = message;
        el.playerLoadingOverlay.classList.remove('hidden');
        el.localEngineMissingCard.classList.remove('hidden');
        el.playerLoadingText.textContent = app ? 'Não consegui abrir esta fonte' : 'Não foi possível iniciar esta fonte';
        el.playerLoadingSub.textContent = app ? 'Tenta outra vez ou escolhe outra fonte da lista' : 'Escolhe outro motor, outra fonte ou configura um add-on com link direto';
        ['helpTryWebtorrentBtn', 'helpRetryStremioBtn', 'helpOpenSettingsBtn'].forEach(id => { if (el[id]) el[id].classList.toggle('hidden', app); });
        ['helpRetryBtn', 'helpNextSourceBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.classList.toggle('hidden', !app); });
      }

      function getValidAltStreams(ctx, primaryStream) {
        if (!ctx || !ctx.item) return [];
        if (primaryStream && primaryStream.fromCache) return [];
        const wantKey = getContextStreamsKey(ctx.item, ctx.season, ctx.episode);
        if (!wantKey || state.scrapedStreamsKey !== wantKey) return [];
        const primaryHash = ((primaryStream && primaryStream.infoHash) || '').toLowerCase();
        return (state.scrapedStreams || []).filter(s => {
          if (!s || s.isTest || s.directUrl || !s.magnetUri || !s.infoHash || s.isPack) return false;
          if (s.infoHash.toLowerCase() === primaryHash) return false;
          if (ctx.item.type === 'series') {
            const epCheck = ssInspectEpisode('', s.filename || s.title || '', Number(ctx.season) || 1, Number(ctx.episode) || 1, ctx.episodeTitle || '', []);
            if (epCheck.wrongEpisode) return false;
          }
          return true;
        }).sort((a, b) => (b.speedScore || 0) - (a.speedScore || 0));
      }

      // ---- Fonte falhou: tenta a seguinte sozinha (sempre validando o título/episódio atual!) ----
      async function tryNextSource(reason, manual) {
        const ctx = state.playingContext;
        if (!ctx || !ctx.item) return false;
        ctx.tried = ctx.tried || new Set();
        const cur = ctx.stream || {};
        ctx.tried.add(cur.infoHash || cur.directUrl || cur.title);
        if (!manual && ctx.tried.size >= 4) return false;
        const wantKey = getContextStreamsKey(ctx.item, ctx.season, ctx.episode);
        let streams = (state.scrapedStreamsKey === wantKey && Array.isArray(state.scrapedStreams)) ? state.scrapedStreams : [];
        if (!streams.length) {
          try {
            streams = await fetchStreamsFor(ctx.item, ctx.season, ctx.episode);
            state.scrapedStreams = streams;
            state.scrapedStreamsKey = wantKey;
          } catch (e) {}
        }
        const tops = pickTopStreams(streams);
        const allPool = [...tops, ...streams.filter(s => !s.isTest && !tops.includes(s))];
        const cands = allPool.filter(x => !ctx.tried.has(x.infoHash || x.directUrl || x.title));
        cands.sort((a, b) => ((b.speedScore || 0) - (a.speedScore || 0)) || ((b.seeders || 0) - (a.seeders || 0)));
        const next = cands[0];
        if (!next) return false;
        showToast(`Esta fonte falhou — a tentar outra (${ctx.tried.size + 1})…`);
        const pos = pbCur();
        launchVideoPlayer({ ...ctx, stream: next, resumeSeconds: pos > 5 ? pos : (ctx.resumeSeconds || 0), tried: ctx.tried, triedCompat: false });
        return true;
      }

      // ---- Posição e duração reais (suporta MKVs sem duração no <video> e modo compatibilidade) ----
      function pbCur() {
        if (state.seeking && state.seekPreviewTime != null) return state.seekPreviewTime;
        if (state.seekLockUntil && Date.now() < state.seekLockUntil && state.seekTarget != null) return state.seekTarget;
        const v = el.cineVideoPlayer;
        return (state.compat ? state.compat.offset : 0) + (v.currentTime || 0);
      }
      function pbDur() {
        const v = el.cineVideoPlayer;
        if (state.compat && state.compat.duration > 0) return state.compat.duration;
        if (v && isFinite(v.duration) && v.duration > 0) return v.duration;
        if (state.engineTrackDuration > 0) return state.engineTrackDuration;
        const ctx = state.playingContext;
        return (ctx && isFinite(ctx.duration) && ctx.duration > 0) ? ctx.duration : 0;
      }
      function getCachePieceStateAt(sec) {
        const d = pbDur();
        if (!(d > 0)) return 'net';
        const tel = state.lastTel || {};
        if (tel.remuxReady) return 'disk';
        if (Array.isArray(tel.pieceMap) && tel.pieceMap.length) {
          const idx = Math.min(tel.pieceMap.length - 1, Math.max(0, Math.floor((sec / d) * tel.pieceMap.length)));
          const v = tel.pieceMap[idx] || 0;
          if (v >= 0.85) return 'disk';
          if (v > 0.08) return 'part';
        }
        return 'net';
      }

      function remountAllSubtitles() {
        reapplyActiveSubtitle();
        try { (state.subtitleTracks || []).forEach(en => { if (en.trackEl && en.code !== state.activeSubCode) mountSubtitleTrack(en, false); }); } catch (e) {}
      }

      async function syncCompatKeyframeOffset(info, reqAt, token, seekEp) {
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        if (!E || !info || !info.infoHash || !(reqAt > 0) || !state.compat) return;
        try {
          const r = await fetch(`${E}/keyframe/${info.infoHash}/${info.fileIdx}?t=${reqAt}`);
          if (!r.ok) return;
          const d = await r.json();
          if (token !== state.playToken || seekEp !== state.seekEpoch || !state.compat) return;
          const kVal = (d && typeof d.start === 'number') ? d.start : (d && typeof d.t === 'number' ? d.t : null);
          if (d && d.ok && typeof kVal === 'number' && isFinite(kVal) && Math.abs(kVal - reqAt) < 18) {
            const actualK = +(Math.max(0, kVal).toFixed(3));
            if (Math.abs(state.compat.offset - actualK) >= 0.04) {
              state.compat.offset = actualK;
              state.compat.keyframeAligned = true;
              remountAllSubtitles();
            }
          }
        } catch (e) {}
      }

      function fastCompatSeek(targetSec) {
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        const info = state.engineInfo;
        const v = el.cineVideoPlayer;
        if (!E || !info || !state.compat) {
          state.pendingAudio = (state.compat && state.compat.audio) || 0;
          return switchPlayerEngineMode('compat', targetSec);
        }

        const seekEp = (state.seekEpoch = (state.seekEpoch || 0) + 1);
        clearTimeout(state.postSeekCalibTimer);

        if (state.lastTel && state.lastTel.remuxReady && state.lastTel.mp4Url && !(state.compat.audio > 0)) {
          state.compat = null;
          state.seekingExact = true;
          updatePlayModePillsUI('engine');
          el.p2pEngineModeBadge.textContent = '⚡ Cache MP4 (0ms)';
          remountAllSubtitles();
          attachMediaSource(state.lastTel.mp4Url, targetSec, state.playToken);
          return;
        }

        const reqAt = Math.max(0, +(Number(targetSec || 0).toFixed(2)));
        const audioIdx = state.compat.audio || 0;
        const token = ++state.playToken;
        state.compat.offset = reqAt;
        state.compat.requestedOffset = reqAt;
        state.compat.keyframeAligned = (reqAt === 0);

        const badge = document.getElementById('playerFastSeekBadge');
        const badgeTxt = document.getElementById('playerFastSeekText');
        const cState = getCachePieceStateAt(reqAt);
        if (badge && badgeTxt) {
          badgeTxt.textContent = cState === 'disk'
            ? `🟢 A abrir da Cache no Disco (${formatTime(reqAt)})`
            : `⏳ A saltar para ${formatTime(reqAt)}…`;
          badge.classList.remove('hidden');
        }

        remountAllSubtitles();
        if (reqAt > 0) syncCompatKeyframeOffset(info, reqAt, token, seekEp);

        const newUrl = `${E}/transcode/${info.infoHash}/${info.fileIdx}?start=${reqAt}&audio=${audioIdx}&_ts=${Date.now()}`;
        const hideBadge = () => {
          if (badge) badge.classList.add('hidden');
          el.playerLoadingOverlay.classList.add('hidden');
        };
        v.onloadedmetadata = () => {
          if (token !== state.playToken) return;
          el.playerLoadingOverlay.classList.add('hidden');
          if (v.readyState >= 3) {
            if (badge) badge.classList.add('hidden');
          } else if (badge && badgeTxt) {
            badgeTxt.textContent = describePlayerWaitStatus();
            badge.classList.remove('hidden');
          }
          try { const sr = parseFloat(localStorage.getItem('macstream_rate')); if (sr > 0) { v.defaultPlaybackRate = sr; v.playbackRate = sr; } } catch (e) {}
          v.play().catch(() => {});
        };
        v.addEventListener('playing', hideBadge, { once: true });
        v.src = newUrl;
        v.load();
        if (reqAt > 0) {
          setTimeout(() => {
            if (token !== state.playToken || v.readyState >= 2) return;
            state.compatBaseSec = 0;
            v.src = `${E}/transcode/${info.infoHash}/${info.fileIdx}?start=0&audio=${audioIdx}&_ts=${Date.now()}`;
            v.load();
            if (typeof showToast === 'function') showToast('A retomar do início para garantir reprodução estável.');
          }, 6500);
        }
      }

      function pbSeek(t) {
        const v = el.cineVideoPlayer;
        const d = pbDur();
        t = Math.max(0, d > 0 ? Math.min(d - 0.5, t) : t);
        state.seekTarget = t;
        state.seekLockUntil = Date.now() + 2400;
        if (d > 0) {
          const frac = Math.max(0, Math.min(1, t / d));
          el.playerCurrentTime.textContent = formatTime(t);
          el.playerSeekInput.value = String(Math.round(frac * 1000));
          document.getElementById('playerPlayedBar').style.width = (frac * 100) + '%';
        }
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        if (E && state.engineInfo && d > 0) {
          fetch(`${E}/focus/${state.engineInfo.infoHash}/${state.engineInfo.fileIdx}?frac=${(t / d).toFixed(4)}`).catch(() => {});
        }
        const seekEp = (state.seekEpoch = (state.seekEpoch || 0) + 1);
        clearTimeout(state.postSeekCalibTimer);
        if (state.compat) {
          const rel = t - state.compat.offset;
          try {
            for (let i = 0; i < v.buffered.length; i++) {
              if (rel >= v.buffered.start(i) - 0.25 && rel <= v.buffered.end(i) - 0.15) {
                v.currentTime = Math.max(0, rel);
                state.seekLockUntil = Date.now() + 300;
                reapplyActiveSubtitle();
                return;
              }
            }
          } catch (e) {}
          fastCompatSeek(t);
        } else {
          try { v.currentTime = t; } catch (e) {}
          if (window.macstreamApp && state.activePlayMode === 'engine' && t > 20) {
            clearTimeout(state.nativeSeekCheckTimer);
            state.nativeSeekCheckTimer = setTimeout(() => {
              if (state.compat || state.activePlayMode !== 'engine') return;
              if (Math.abs((v.currentTime || 0) - t) > 15 && (v.currentTime || 0) < 3 && !v.seeking) {
                showToast('⚡ A ativar procura rápida para este ficheiro…');
                state.pendingAudio = 0;
                switchPlayerEngineMode('compat', t);
              }
            }, 2200);
          }
        }
      }

      // ---- Faixas de áudio e legendas embutidas (ffmpeg faz a leitura do cabeçalho) ----
      const LANG_PT = { eng: 'Inglês', en: 'Inglês', por: 'Português (PT)', pt: 'Português', pob: 'Português (BR)', pb: 'Português (BR)', spa: 'Espanhol', es: 'Espanhol', fra: 'Francês', fre: 'Francês', deu: 'Alemão', ger: 'Alemão', ita: 'Italiano', jpn: 'Japonês', kor: 'Coreano', rus: 'Russo', und: 'Original' };
      async function getTracks(info) {
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        if (!E || !info) return null;
        state.tracks = state.tracks || {};
        const k = info.infoHash + ':' + info.fileIdx;
        if (state.tracks[k]) {
          if (state.tracks[k].duration > 0) {
            state.engineTrackDuration = state.tracks[k].duration;
            el.playerDurationTime.textContent = formatTime(pbDur());
          }
          return state.tracks[k];
        }
        try {
          const r = await fetch(`${E}/tracks/${info.infoHash}/${info.fileIdx}`);
          const d = await r.json();
          if (d && d.ok) {
            state.tracks[k] = d;
            if (d.duration > 0) {
              state.engineTrackDuration = d.duration;
              el.playerDurationTime.textContent = formatTime(pbDur());
            }

            try { // memória de idioma de áudio por série + deteção rápida de codecs sem suporte nativo (EAC3/DTS/TrueHD)
              const pref = getSubPref(); const want = pref && pref.audioLang;
              const i = want && d.audio ? d.audio.findIndex(a => a.lang === want) : -1;
              const ctx = state.playingContext;
              const defAudio = d.audio && (d.audio.find(a => a.def) || d.audio[0]);
              const needsCompatCodec = defAudio && /^(eac3|ac3|dts|truehd|mlp|pcm_s24le)$/i.test(defAudio.codec || '');
              if (i > 0 && !state.compat && ctx && !ctx.audioPrefTried) {
                ctx.audioPrefTried = true;
                showToast('🔊 Faixa de áudio preferida disponível — a mudar…');
                state.pendingAudio = i; setTimeout(() => switchPlayerEngineMode('compat', pbCur()), 0);
              } else if (needsCompatCodec && !state.compat && ctx && !ctx.autoCompat && state.activePlayMode === 'engine') {
                setTimeout(() => {
                  const v = el.cineVideoPlayer;
                  if (ctx !== state.playingContext || ctx.autoCompat || state.compat) return;
                  if (typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0 && (v.currentTime > 0.5 || /^(dts|truehd|mlp)$/i.test(defAudio.codec || ''))) {
                    ctx.autoCompat = true;
                    state.pendingAudio = 0;
                    showToast(`🔊 A converter áudio ${defAudio.codec.toUpperCase()} para o teu Mac…`);
                    const resumePos = pbCur();
                    switchPlayerEngineMode('compat', resumePos < 4.5 ? 0 : resumePos);
                  }
                }, 1400);
              }
            } catch (e) {}
            return d;
          }
        } catch (e) {}
        return null;
      }
      function populateAudioSelect(tr, selected) {
        const wrap = document.getElementById('playerAudioWrap');
        const sel = document.getElementById('playerAudioSelect');
        if (!wrap || !sel) return;
        if (!tr || !tr.audio || tr.audio.length < 2) { wrap.classList.add('hidden'); wrap.classList.remove('flex'); return; }
        sel.innerHTML = tr.audio.map((a, i) => `<option value="${i}">${esc((LANG_PT[a.lang] || a.title || ('Faixa ' + (i + 1))) + ' • ' + a.codec.toUpperCase() + (a.ch ? ' ' + a.ch : ''))}</option>`).join('');
        sel.value = String(selected || 0);
        wrap.classList.remove('hidden');
        wrap.classList.add('flex');
      }

      async function preloadNextEpisode(ctx) {
        try {
          const map = await getSeriesEpisodesMap(ctx.item);
          const next = computeAdjacentEpisode(ctx, 1, map);
          if (!next) return;
          const badge = document.getElementById('playerPreloadStatusBadge');
          const nextCode = `S${pad2(next.season)}E${pad2(next.episode)}`;
          if (badge) {
            badge.textContent = `⏳ A pré-carregar ${nextCode}…`;
            badge.classList.remove('hidden');
          }
          const streams = await fetchStreamsFor(ctx.item, next.season, next.episode);
          const pick = pickBestStream(streams, ctx.stream && ctx.stream.resolution, Boolean(ctx.stream && ctx.stream.directUrl));
          if (!pick) return;
          ctx.nextPick = { target: next, stream: pick, preloadedAt: Date.now() };
          const E = window.macstreamApp && window.macstreamApp.engineUrl;
          const magnet = (typeof pick.magnetUri === 'string' && pick.magnetUri) || (pick.infoHash ? buildMagnet(pick.infoHash, ctx.item.title, []) : '');
          if (E && magnet && !pick.directUrl) {
            const q = new URLSearchParams({
              magnet,
              full: '1',
              title: ctx.item.title || '',
              imdbId: ctx.item.imdbId || '',
              poster: ctx.item.poster || '',
              backdrop: ctx.item.backdrop || '',
              season: String(next.season || 1),
              episode: String(next.episode || 1)
            });
            if (Number.isInteger(pick.fileIdx)) q.set('fileIdx', String(pick.fileIdx));
            await fetch(`${E}/preload?${q.toString()}`).catch(() => {});
          }
          // Pré-aquece também o manifesto de legendas do próximo episódio em background
          if (ctx.item && ctx.item.imdbId && ctx.item.imdbId.startsWith('tt')) {
            const sList = (map && map[next.season]) || [];
            const epMapNext = ssResolveEpisodeMapping(sList, next.season, next.episode, next.title || '', pick.filename || pick.title || '');
            const openEp = epMapNext ? epMapNext.dvdEp : next.episode;
            fetch(`${OPENSUBS_URL}/subtitles/series/${ctx.item.imdbId}:${next.season}:${openEp}.json`).catch(() => {});
          }
          if (badge) {
            badge.textContent = `⚡ ${nextCode} Pré-Carregado (0ms)`;
            badge.classList.remove('hidden');
          }
        } catch (e) {}
      }

      async function probeAutoSkipIntro(ctx, info) {
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        if (!E || !ctx || !ctx.item || ctx.item.type !== 'series' || !info || !info.infoHash) return;
        try {
          const r = await fetch(`${E}/detect-intro/${info.infoHash}/${info.fileIdx || 0}`);
          if (!r.ok || ctx !== state.playingContext) return;
          const det = await r.json();
          if (det && det.ok && isFinite(det.startSec) && isFinite(det.endSec) && det.endSec > det.startSec) {
            ctx.detectedIntro = det;
          }
        } catch (e) {}
      }

      async function probeStremioServer() {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1200);
        try {
          const res = await fetch(`${STREMIO_SERVER_URL}/settings`, { signal: ctrl.signal });
          return res.ok;
        } catch (e) {
          return false;
        } finally {
          clearTimeout(timer);
        }
      }

      function launchVideoPlayer(ctx) {
        try {
          if ('mediaSession' in navigator && ctx.item) {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: ctx.item.type === 'series' ? `S${pad2(ctx.season)}E${pad2(ctx.episode)} ${ctx.episodeTitle || ''}`.trim() : ctx.item.title,
              artist: ctx.item.title,
              artwork: ctx.item.poster ? [{ src: ctx.item.poster, sizes: '300x450', type: 'image/jpeg' }] : []
            });
          }
        } catch (e) {}
        document.getElementById('skipIntroBtn').classList.add('hidden');
        cleanupActivePlayerSession();
        clearInterval(state.home.heroTimer);
        if (document.pictureInPictureElement === el.iptvPrimaryVideo) {
          document.exitPictureInPicture().catch(() => {});
        }
        destroyPrimaryIptvEngines();
        destroySecondaryIptvEngines();
        state.playingContext = ctx;
        el.iptvPrimaryVideo.pause();
        el.iptvSecondaryVideo.pause();

        const { item, season, episode, episodeTitle, stream, resumeSeconds } = ctx;
        const epBadge = item.type === 'series'
          ? ` • S${pad2(season || 1)}E${pad2(episode || 1)}${episodeTitle ? ' — ' + episodeTitle : ''}`
          : '';
        el.playerTitle.textContent = `${item.title}${epBadge}`;

        if (item.type === 'series') {
          el.playerEpisodeNavGroup.classList.remove('hidden');
          el.playerEpisodeNavGroup.classList.add('flex');
          getSeriesEpisodesMap(item); // pré-carrega a lista para o botão "próximo episódio"
        } else {
          el.playerEpisodeNavGroup.classList.add('hidden');
          el.playerEpisodeNavGroup.classList.remove('flex');
        }

        const progKey = getProgressKey(item.imdbId, item.type, season, episode);
        const existingProg = state.watchProgressMap[progKey];
        el.playerWatchedPill.classList.toggle('hidden', !(existingProg && existingProg.completed));

        el.playerModal.classList.remove('hidden');
        loadOnlineSubtitles(ctx);

        const initialMode = stream && stream.directUrl ? 'direct' : (stream && stream.isWebRtcNative && !window.macstreamApp ? 'webtorrent' : 'auto');
        switchPlayerEngineMode(initialMode, resumeSeconds || 0);
        startProgressAndAutomationLoop();
      }

      function attachMediaSource(url, resumeSeconds, token) {
        const v = el.cineVideoPlayer;
        const isHls = /\.m3u8(\?|$)/i.test(url);

        v.onloadedmetadata = () => {
          if (token !== state.playToken) return;
          clearTimeout(state.startTimer);
          clearTimeout(state.slowTimer);
          el.playerLoadingOverlay.classList.add('hidden');
          el.localEngineMissingCard.classList.add('hidden');
          if (v.readyState < 3) {
            const b = document.getElementById('playerFastSeekBadge');
            const bt = document.getElementById('playerFastSeekText');
            if (b && bt) { bt.textContent = describePlayerWaitStatus(); b.classList.remove('hidden'); }
          }
          try { const sr = parseFloat(localStorage.getItem('macstream_rate')); if (sr > 0) { v.defaultPlaybackRate = sr; v.playbackRate = sr; } } catch (e) {}
          if (resumeSeconds && resumeSeconds > 5) {
            const exact = Boolean(state.seekingExact);
            state.seekingExact = false;
            const back = exact ? Math.max(0, resumeSeconds) : Math.max(0, resumeSeconds - 5);
            try { v.currentTime = back; } catch (e) {}
            if (!exact) showPlayerOsd(`▶ Retomado aos ${formatTime(back)}`);
          }
          v.play().catch(() => {});
        };
        v.onwaiting = () => {
          if (token !== state.playToken || v.paused) return;
          clearTimeout(state.bufferStatusTimer);
          state.bufferStatusTimer = setTimeout(() => {
            if (token !== state.playToken || v.paused || v.readyState >= 3) return;
            const b = document.getElementById('playerFastSeekBadge');
            const bt = document.getElementById('playerFastSeekText');
            if (b && bt) { bt.textContent = describePlayerWaitStatus(); b.classList.remove('hidden'); }
          }, 650);
        };
        const hideWaitStatus = () => {
          clearTimeout(state.bufferStatusTimer);
          const b = document.getElementById('playerFastSeekBadge');
          if (b) b.classList.add('hidden');
          el.playerLoadingOverlay.classList.add('hidden');
        };
        v.oncanplay = hideWaitStatus;
        v.onplaying = hideWaitStatus;
        clearTimeout(state.startTimer);
        clearTimeout(state.slowTimer);
        state.slowTimer = setTimeout(async () => {
          // fonte sem peers ou sem dados suficientes ao fim de 8 s: passa automaticamente à fonte seguinte!
          if (token !== state.playToken || v.readyState >= 1) return;
          const t = state.lastTel || {};
          if ((t.peers === 0 || (t.downloaded || 0) < 64 * 1024 || (t.mbps != null && t.mbps < 0.10)) && (await tryNextSource('lenta'))) return;
        }, 8000);
        state.startTimer = setTimeout(async () => {
          if (token !== state.playToken || v.readyState >= 1) return;
          if (await tryNextSource('arranque')) return;
          showEngineHelp('Esta fonte não arrancou a tempo. Tenta outra vez ou escolhe outra fonte da lista.');
        }, 25000);
        v.onerror = async () => {
          if (token !== state.playToken) return;
          const ctx = state.playingContext || {};
          if (window.macstreamApp && state.activePlayMode === 'engine' && !ctx.triedCompat) {
            ctx.triedCompat = true;
            state.pendingAudio = 0;
            showToast('A converter o ficheiro para o teu Mac…');
            switchPlayerEngineMode('compat', pbCur());
            return;
          }
          if (await tryNextSource('erro')) return;
          showEngineHelp(window.macstreamApp ? 'Este ficheiro não abre neste Mac. Tenta outra fonte da lista (de preferência H.264).' : 'O browser não conseguiu reproduzir este ficheiro (formato/codec não suportado, ou o link expirou). Experimenta uma fonte MP4/H.264 ou outra resolução.');
        };

        if (isHls && !v.canPlayType('application/vnd.apple.mpegurl') && window.Hls && window.Hls.isSupported()) {
          const hls = new window.Hls({ enableWorker: true });
          state.activeHls = hls;
          hls.loadSource(url);
          hls.attachMedia(v);
          hls.on(window.Hls.Events.ERROR, (ev, data) => {
            if (data && data.fatal && token === state.playToken) showEngineHelp('Falha ao carregar o stream HLS.');
          });
        } else {
          v.src = url;
          v.load();
        }
      }

      async function switchPlayerEngineMode(mode, resumeSeconds = 0) {
        const ctx = state.playingContext;
        if (!ctx) return;
        const stream = ctx.stream || {};
        const token = ++state.playToken;

        teardownMedia();
        // Durante o reinício da conversão a origem já é a do novo ponto (senão pbCur() = origem antiga + 0 e o progresso guardado "volta atrás")
        if (mode === 'compat') { const prev = state.compat; state.compat = { offset: Math.floor(resumeSeconds || 0), duration: prev ? prev.duration : 0, audio: state.pendingAudio || 0 }; }
        el.localEngineMissingCard.classList.add('hidden');
        el.p2pDownSpeed.textContent = '↓ 0.00 MB/s';
        el.p2pPeersCount.textContent = '👤 0 Peers';
        el.p2pBufferPct.textContent = '0%';
        el.p2pStatusDot.className = 'w-2 h-2 rounded-full bg-amber-400';
        el.playerLoadingOverlay.classList.remove('hidden');
        el.playerLoadingText.textContent = 'A preparar a fonte...';
        el.playerLoadingSub.textContent = 'A escolher o melhor motor disponível';

        if (mode === 'auto') {
          if (stream.directUrl) mode = 'direct';
          else if (window.macstreamApp && ((typeof stream.magnetUri === 'string' && stream.magnetUri) || stream.infoHash || stream.torrentB64)) mode = 'engine';
          else if (stream.infoHash && await probeStremioServer()) mode = 'stremio';
          else mode = 'webtorrent';
          if (token !== state.playToken) return;
        }
        updatePlayModePillsUI(mode);
        if (mode !== 'compat') { state.compat = null; state.pendingAudio = 0; }

        // ---------- MODO 1: LINK DIRETO (Debrid / HTTP) ----------
        if (mode === 'direct') {
          el.p2pEngineModeBadge.textContent = 'Link Direto';
          el.playerStreamSubtitle.textContent = `☁️ Link direto • ${(stream.title || '').slice(0, 70)}`;
          if (!stream.directUrl) {
            showEngineHelp('Esta fonte é um torrent e não tem link direto. Usa "Stremio Local" ou "WebTorrent", ou instala um add-on com Debrid (⚙️ TMDB & Add-ons) para obteres links diretos.');
            return;
          }
          el.playerLoadingText.textContent = 'A abrir o link direto...';
          el.p2pStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
          attachMediaSource(stream.directUrl, resumeSeconds, token);
          try {
            const fname = decodeURIComponent(stream.directUrl.split('?')[0].split('/').pop() || '');
            if (/\.(mkv|mp4|avi|m4v)$/i.test(fname)) { if (ctx.subsKey !== stream.directUrl) { ctx.subsKey = stream.directUrl; loadOnlineSubtitles(ctx, { filename: fname }); } else reapplyActiveSubtitle(); }
          } catch (e) {}
          return;
        }

        // ---------- MOTOR INTERNO DA APP (TCP/UDP/DHT) + MODO COMPATIBILIDADE ----------
        if (mode === 'engine' || mode === 'compat') {
          const E = window.macstreamApp && window.macstreamApp.engineUrl;
          el.p2pEngineModeBadge.textContent = mode === 'compat' ? 'Áudio convertido' : 'A transmitir';
          el.playerStreamSubtitle.textContent = `⚡ ${mode === 'compat' ? 'Áudio convertido' : 'A transmitir'} • ${(stream.title || '').slice(0, 70)}`;
          const magnet = (typeof stream.magnetUri === 'string' && stream.magnetUri) || (stream.infoHash ? buildMagnet(stream.infoHash, ctx.item.title, []) : '');
          if (!E || (!magnet && !stream.torrentB64)) {
            showEngineHelp(!E ? 'O motor interno só existe dentro da app MacStream.' : 'Esta fonte não tem magnet — usa uma fonte com torrent ou link direto.');
            return;
          }
          el.playerLoadingText.textContent = 'A ligar aos peers e caches de metadados...';
          el.playerLoadingSub.textContent = 'A procurar a fonte mais rápida em paralelo (TCP/UDP/DHT + HTTPS Cache)';

          // Telemetria em tempo real desde o instante 0
          clearInterval(state.telemetryTimer);
          const pollTelemetry = async () => {
            try {
              const inf = state.engineInfo;
              const qStr = inf && inf.infoHash ? `?hash=${inf.infoHash}&fileIdx=${inf.fileIdx}` : (stream.infoHash ? `?hash=${stream.infoHash}` : '');
              const r = await fetch(`${E}/status${qStr}`);
              const d = await r.json();
              const mbps = ((d.downloadSpeed || 0) / (1024 * 1024)).toFixed(2);
              const dlMB = ((d.downloaded || 0) / (1024 * 1024)).toFixed(1);
              el.p2pDownSpeed.textContent = `↓ ${mbps} MB/s`;
              el.p2pPeersCount.textContent = `👤 ${d.numPeers || 0} ${(d.numPeers || 0) === 1 ? 'fonte' : 'fontes'}`;
              state.lastTel = { mbps: parseFloat(mbps), peers: d.numPeers || 0, downloaded: d.downloaded || 0, ready: !!d.ready, remuxReady: !!d.remuxReady, remuxing: !!d.remuxing, mp4Url: d.mp4Url || null, pieceMap: d.pieceMap || [], progress: d.progress || 0, muxStartSec: d.muxStartSec, muxStartResolved: !!d.muxStartResolved };
              if (state.compat && d.muxStartResolved && typeof d.muxStartSec === 'number' && isFinite(d.muxStartSec)) {
                const reqRef = state.compat.requestedOffset != null ? state.compat.requestedOffset : state.compat.offset;
                if (Math.abs(d.muxStartSec - reqRef) < 18 && Math.abs(state.compat.offset - d.muxStartSec) >= 0.04) {
                  state.compat.offset = +(Math.max(0, d.muxStartSec).toFixed(3));
                  state.compat.keyframeAligned = true;
                  remountAllSubtitles();
                }
              }
              const pctVal = Math.round((d.progress || 0) * 100);
              el.p2pBufferPct.textContent = d.remuxReady ? `⚡ Cache 100%` : `💾 Cache ${pctVal}%`;
              el.ecoHudLabel.textContent = `↓ ${mbps} MB/s`;
              renderPlayerCacheMapBar(d.pieceMap);
              if (!el.playerLoadingOverlay.classList.contains('hidden')) {
                if (state.compat) el.playerLoadingText.textContent = describePlayerWaitStatus();
                if (d.numPeers > 0) {
                  el.p2pStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
                  el.playerLoadingSub.textContent = d.ready
                    ? `Ligado a ${d.numPeers} ${d.numPeers === 1 ? 'fonte' : 'fontes'} • ↓ ${mbps} MB/s (${dlMB} MB recebidos)`
                    : `Ligado a ${d.numPeers} ${d.numPeers === 1 ? 'fonte' : 'fontes'} • a obter metadados via TCP/HTTPS...`;
                }
              }
            } catch (e) {}
          };
          state.telemetryTimer = setInterval(pollTelemetry, 500);

          // Dispara em paralelo no browser a recolha e injeção do .torrent da fonte principal e apenas de alternativas válidas do MESMO episódio!
          if (stream.infoHash) fetchAndInjectBrowserTorrent(E, stream.infoHash).catch(() => {});
          const isCachedTarget = Boolean(stream.fromCache || findCacheEntryForItem(ctx.item && ctx.item.imdbId, ctx.season, ctx.episode, stream.infoHash)?.completed);
          const altPool = isCachedTarget ? [] : getValidAltStreams(ctx, stream).slice(0, 3);
          altPool.forEach(a => fetchAndInjectBrowserTorrent(E, a.infoHash).catch(() => {}));

          let info;
          const reuseInfo = Boolean(
            state.engineInfo &&
            state.engineInfo.infoHash &&
            stream.infoHash &&
            state.engineInfo.infoHash.toLowerCase() === stream.infoHash.toLowerCase() &&
            !stream.torrentB64 &&
            (!Number.isInteger(stream.fileIdx) || state.engineInfo.fileIdx === stream.fileIdx) &&
            state.engineInfo.imdbId === (ctx.item && ctx.item.imdbId) &&
            (!ctx.item || ctx.item.type !== 'series' || (Number(state.engineInfo.season) === Number(ctx.season || 1) && Number(state.engineInfo.episode) === Number(ctx.episode || 1)))
          );
          if (reuseInfo) {
            info = state.engineInfo;
          } else {
            try {
              const q = new URLSearchParams({ magnet });
              if (Number.isInteger(stream.fileIdx)) q.set('fileIdx', String(stream.fileIdx));
              if (ctx.item) {
                q.set('title', ctx.item.title || '');
                q.set('imdbId', ctx.item.imdbId || '');
                q.set('poster', ctx.item.poster || '');
                q.set('backdrop', ctx.item.backdrop || '');
              }
              if (ctx.item && ctx.item.type === 'series') {
                q.set('season', String(ctx.season || 1));
                q.set('episode', String(ctx.episode || 1));
              }
              altPool.forEach(a => q.append('alt', a.magnetUri));
              const r = stream.torrentB64
                ? await fetch(`${E}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ torrentB64: stream.torrentB64, fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : undefined }) })
                : await fetch(`${E}/start?${q.toString()}`);
              const rawTxt = await r.text();
              try { info = JSON.parse(rawTxt); } catch (je) { throw new Error('Resposta inválida do motor (' + r.status + ')'); }
              if (!r.ok || !info.ok) throw new Error(info.error || ('HTTP ' + r.status));
            } catch (e) {
              if (token !== state.playToken) return;
              if (await tryNextSource('start')) return;
              showEngineHelp(friendlyError(e && e.message ? e.message : e));
              return;
            }
          }
          if (token !== state.playToken) return;
          if (info) {
            info.imdbId = ctx.item && ctx.item.imdbId;
            info.season = ctx.season || 1;
            info.episode = ctx.episode || 1;
          }
          state.engineInfo = info;
          if (info && info.infoHash) {
            stream.infoHash = info.infoHash;
            if (Number.isInteger(info.fileIdx)) stream.fileIdx = info.fileIdx;
            delete stream.torrentB64;
          }
          // Se já existir MP4 otimizado em cache (remuxReady), reproduz direto com seek 0ms; caso contrário usa remux contínuo para MKV/EAC3
          const audioHint = `${info.name || ''} ${(stream && stream.title) || ''} ${(stream && stream.audioTag) || ''}`;
          const hasReadyMp4 = Boolean(info && info.remuxReady && info.mp4Url && !(state.pendingAudio > 0));
          if (mode === 'engine' && !hasReadyMp4 && info && info.ffmpeg && (/\.(mkv|avi|ts|m2ts)$/i.test(info.name || '') || /\b(eac3|ddp5?\.?1?|dd\+|ac-?3|dts|truehd|atmos)\b/i.test(audioHint))) {
            mode = 'compat';
            updatePlayModePillsUI('compat');
          }
          // Carrega as legendas imediatamente via HTTPS (com chave única por episódio!)
          const preBadge = document.getElementById('playerPreloadStatusBadge');
          if (preBadge) preBadge.classList.add('hidden');
          if (ctx.item && ctx.item.type === 'series') {
            setTimeout(() => probeAutoSkipIntro(ctx, info), 2800);
          }
          const sk = `${info.infoHash}:${info.fileIdx}:${ctx.item ? ctx.item.imdbId : ''}:${ctx.season || 1}:${ctx.episode || 1}`;
          if (ctx.subsKey !== sk) { ctx.subsKey = sk; loadOnlineSubtitles(ctx, { filename: info.name, size: info.length, videoHash: info.videoHash || null, externalSubs: info.externalSubs }); } else reapplyActiveSubtitle();
          el.p2pStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
          el.playerLoadingText.textContent = 'A carregar os primeiros segundos do vídeo...';
          if (mode === 'compat') {
            el.playerLoadingText.textContent = reuseInfo && resumeSeconds > 0 ? `A avançar para ${formatTime(resumeSeconds)}…` : 'A carregar os primeiros segundos do vídeo...';
            const rawResume = Number(resumeSeconds || 0);
            const reqAt = (!state.seeking && rawResume < 4.5) ? 0 : Math.max(0, +(rawResume.toFixed(2)));
            const seekEp = (state.seekEpoch = (state.seekEpoch || 0) + 1);
            state.compat = { offset: reqAt, requestedOffset: reqAt, keyframeAligned: (reqAt === 0), duration: (state.compat && state.compat.duration) || state.engineTrackDuration || 0, audio: state.pendingAudio || 0 };
            remountAllSubtitles();
            if (reqAt > 0) syncCompatKeyframeOffset(info, reqAt, token, seekEp);
            attachMediaSource(`${E}/transcode/${info.infoHash}/${info.fileIdx}?start=${reqAt}&audio=${state.compat.audio}`, 0, token);
            // Lê a duração e faixas de áudio (já guardadas em cache pelo próprio serveTranscode a partir do cabeçalho da Peça #0)
            const syncTracks = () => {
              if (token !== state.playToken || !state.compat) return;
              getTracks(info).then((tr) => {
                if (token !== state.playToken || !state.compat || !tr) return;
                if (tr.duration > 0) {
                  state.compat.duration = tr.duration;
                  state.engineTrackDuration = tr.duration;
                  el.playerDurationTime.textContent = formatTime(pbDur());
                }
                populateAudioSelect(tr, state.compat.audio);
                if (Array.isArray(tr.subs) && tr.subs.length) loadEmbeddedSubtitlesFromTracks(info, tr.subs).catch(() => {});
              });
            };
            setTimeout(syncTracks, 1200);
            setTimeout(syncTracks, 3500);
          } else {
            if (hasReadyMp4) {
              el.p2pEngineModeBadge.textContent = 'MP4 0ms';
              el.playerStreamSubtitle.textContent = `⚡ Cache MP4 Pronto • ${(stream.title || '').slice(0, 70)}`;
            }
            attachMediaSource(hasReadyMp4 ? info.mp4Url : `${E}/stream/${info.infoHash}/${info.fileIdx}`, resumeSeconds, token);
            // Se o ficheiro MKV já descarregou > 4 MB mas o demuxer nativo do Chromium ficar à espera do fim do ficheiro, muda para o remuxer -seekable 0!
            setTimeout(() => {
              const v = el.cineVideoPlayer;
              if (token !== state.playToken || state.compat || v.readyState >= 1) return;
              if (state.lastTel && state.lastTel.downloaded > 4 * 1024 * 1024 && !ctx.triedCompat) {
                ctx.triedCompat = true;
                state.pendingAudio = 0;
                switchPlayerEngineMode('compat', resumeSeconds || 0);
              }
            }, 5000);
            // Só lê as faixas com o ffmpeg quando o vídeo já está a reproduzir para nunca competir no arranque!
            el.cineVideoPlayer.addEventListener('playing', () => {
              setTimeout(() => {
                if (token === state.playToken) getTracks(info).then(tr => { if (token === state.playToken) populateAudioSelect(tr, 0); });
              }, 3000);
            }, { once: true });
          }
          return;
        }

        // ---------- MODO 2: SERVIDOR LOCAL DO STREMIO DESKTOP (127.0.0.1:11470) ----------
        if (mode === 'stremio') {
          el.p2pEngineModeBadge.textContent = 'Stremio Local';
          el.playerStreamSubtitle.textContent = `🖥️ Stremio Desktop • ${(stream.title || '').slice(0, 70)}`;
          if (!stream.infoHash) {
            showEngineHelp('Esta fonte não tem infoHash, por isso não pode ser aberta pelo Stremio local.');
            return;
          }
          el.playerLoadingText.textContent = 'A contactar o Stremio Desktop (127.0.0.1:11470)...';
          if (!(await probeStremioServer())) {
            if (token !== state.playToken) return;
            showEngineHelp('Não encontrei o servidor do Stremio Desktop. Abre a aplicação Stremio no teu Mac (ela inicia o servidor sozinha) e tenta de novo — ou usa "Link Direto"/"WebTorrent".');
            return;
          }
          if (token !== state.playToken) return;

          const fileIdx = Number.isInteger(stream.fileIdx) ? stream.fileIdx : 0;
          try {
            await fetch(`${STREMIO_SERVER_URL}/${stream.infoHash}/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ torrent: { infoHash: stream.infoHash }, peerSearch: { sources: ['dht:' + stream.infoHash], min: 40, max: 150 } })
            });
          } catch (e) {}
          if (token !== state.playToken) return;

          el.p2pStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
          attachMediaSource(`${STREMIO_SERVER_URL}/${stream.infoHash}/${fileIdx}`, resumeSeconds, token);

          state.telemetryTimer = setInterval(async () => {
            try {
              const res = await fetch(`${STREMIO_SERVER_URL}/${stream.infoHash}/stats.json`);
              if (!res.ok) return;
              const d = await res.json();
              const mbps = ((d.downloadSpeed || 0) / (1024 * 1024)).toFixed(2);
              el.p2pDownSpeed.textContent = `↓ ${mbps} MB/s`;
              el.p2pPeersCount.textContent = `👤 ${d.swarmConnections || d.peers || 0} Peers`;
              el.ecoHudLabel.textContent = `↓ ${mbps} MB/s`;
            } catch (e) {}
          }, 1500);
          return;
        }

        // ---------- MODO 3: WEBTORRENT NO BROWSER (apenas peers WebRTC) ----------
        startPureBrowserWebTorrent(stream.magnetUri || stream.infoHash && buildMagnet(stream.infoHash, ctx.item.title, []) || '', resumeSeconds, token);
      }

      function startPureBrowserWebTorrent(source, resumeSeconds, token) {
        token = token || state.playToken;
        const ctx = state.playingContext || {};
        const stream = ctx.stream || {};

        updatePlayModePillsUI('webtorrent');
        el.p2pEngineModeBadge.textContent = 'WebTorrent WebRTC';
        el.playerStreamSubtitle.textContent = '🌐 WebTorrent (WebRTC) • download sequencial em RAM';
        el.playerLoadingOverlay.classList.remove('hidden');
        el.localEngineMissingCard.classList.add('hidden');
        el.playerLoadingText.textContent = 'A ligar ao enxame WebTorrent (WebRTC)...';
        el.playerLoadingSub.textContent = 'Os browsers só falam com peers WebRTC — torrents normais (TCP/UDP) costumam não ter nenhum';

        if (!window.WebTorrent) {
          showEngineHelp('A biblioteca WebTorrent não carregou (sem internet ou CDN bloqueada).');
          return;
        }
        if (!source) {
          showEngineHelp('Esta fonte não tem magnet nem ficheiro .torrent.');
          return;
        }

        try {
          if (!state.webTorrentClient) {
            state.webTorrentClient = new window.WebTorrent({ maxConns: state.ecoMode ? 25 : 55 });
            state.webTorrentClient.on('error', (err) => {
              showEngineHelp('Erro WebTorrent: ' + (err && err.message ? err.message : err));
            });
          }

          const torrent = state.webTorrentClient.add(source, { announce: WSS_TRACKERS }, (t) => {
            if (token !== state.playToken) { try { t.destroy(); } catch (e) {} return; }
            clearTimeout(state.p2pWatchdogTimer);

            const vidRe = /\.(mp4|m4v|webm|mov|mkv|avi|ogv)$/i;
            let file = null;
            if (Number.isInteger(stream.fileIdx) && t.files[stream.fileIdx] && vidRe.test(t.files[stream.fileIdx].name)) {
              file = t.files[stream.fileIdx];
            }
            if (!file) {
              const vids = t.files.filter(f => vidRe.test(f.name));
              const playable = vids.filter(f => /\.(mp4|m4v|webm|mov)$/i.test(f.name));
              const pool = playable.length ? playable : (vids.length ? vids : t.files);
              file = pool.reduce((a, b) => (a.length > b.length ? a : b), pool[0]);
            }
            if (!file) { showEngineHelp('O torrent não contém ficheiros de vídeo.'); return; }

            t.files.forEach(f => { if (f !== file) { try { f.deselect(); } catch (e) {} } });
            if (/\.(mkv|avi)$/i.test(file.name)) showToast('Ficheiro MKV/AVI: o browser pode não o conseguir reproduzir.');

            el.p2pStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
            file.renderTo(el.cineVideoPlayer, { autoplay: true }, (err) => {
              if (token !== state.playToken) return;
              if (err) {
                showEngineHelp('O browser não conseguiu reproduzir este ficheiro (' + (err.message || err) + '). Prefere uma fonte MP4/H.264 com link direto.');
                return;
              }
              el.playerLoadingOverlay.classList.add('hidden');
              if (resumeSeconds && resumeSeconds > 5) {
                const v = el.cineVideoPlayer;
                const seek = () => { try { v.currentTime = resumeSeconds; } catch (e) {} };
                if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
                showPlayerOsd(`▶ Retomado aos ${formatTime(resumeSeconds)}`);
              }
            });
          });
          state.activeTorrent = torrent;
          torrent.on('error', (err) => {
            if (token === state.playToken) showEngineHelp('Erro no torrent: ' + (err && err.message ? err.message : err));
          });

          // Se passados 30s ainda não há metadados/peers, explica o que se passa
          state.p2pWatchdogTimer = setTimeout(() => {
            if (token !== state.playToken) return;
            const t = state.activeTorrent;
            if (!t || !t.ready || t.numPeers === 0) {
              showEngineHelp('Sem peers WebRTC ao fim de 30s. Os torrents "normais" (TCP/UDP) não são acessíveis a partir de um browser. Usa uma fonte com Link Direto (Debrid), o Stremio Desktop, ou testa o torrent Sintel.');
            }
          }, 30000);

          clearInterval(state.telemetryTimer);
          state.telemetryTimer = setInterval(() => {
            const t = state.activeTorrent;
            if (!t) return;
            const mbps = (t.downloadSpeed / (1024 * 1024)).toFixed(2);
            el.p2pDownSpeed.textContent = `↓ ${mbps} MB/s`;
            el.p2pPeersCount.textContent = `👤 ${t.numPeers} Peers`;
            el.p2pBufferPct.textContent = `${Math.round((t.progress || 0) * 100)}%`;
            el.ecoHudLabel.textContent = `WebRTC ↓ ${mbps} MB/s`;
          }, 1000);
        } catch (err) {
          showEngineHelp('Erro ao adicionar o torrent no browser: ' + (err && err.message ? err.message : err));
        }
      }

      // =======================================================================
      // 11. LEGENDAS REAIS (OpenSubtitles via Stremio) + .SRT/.VTT LOCAL
      // 12. PROGRESSO (INDEXEDDB), AUTO-"VISTO" AOS -2 MIN E PRÓXIMO EPISÓDIO
      // =======================================================================
      function startProgressAndAutomationLoop() {
        clearInterval(state.progressSaveTimer);
        state.progressSaveTimer = setInterval(() => {
          saveCurrentPlaybackProgress();
        }, 10000);
      }

      async function saveCurrentPlaybackProgress() {
        const video = el.cineVideoPlayer;
        const ctx = state.playingContext;
        if (!ctx || !ctx.item || !video) return;

        if (!video.currentSrc || video.readyState < 1) return; // a recarregar (seek/reinício): não guardar posição provisória
        const cur = pbCur();
        const dur = pbDur();
        if (cur < 2 || !isFinite(dur) || dur <= 0) return;

        const { item, season, episode, episodeTitle, stream } = ctx;
        if (item.type === 'series' && cur >= 10 && !ctx._prevCacheCleaned) {
          ctx._prevCacheCleaned = true;
          const app = window.macstreamApp;
          if (app && app.engineUrl) {
            const curHash = stream && stream.infoHash ? String(stream.infoHash).toLowerCase() : '';
            const curIdx = stream && Number.isInteger(stream.fileIdx) ? stream.fileIdx : 0;
            Object.values(state.watchProgressMap || {}).forEach((r) => {
              if (!r || r.imdbId !== item.imdbId || !r.completed) return;
              if (r.season === season && r.episode === episode) return;
              const rh = r.infoHash ? String(r.infoHash).toLowerCase() : '';
              const rIdx = Number.isInteger(r.fileIdx) && r.fileIdx >= 0 ? r.fileIdx : 0;
              if (/^[a-f0-9]{40}$/.test(rh) && (rh !== curHash || rIdx !== curIdx)) {
                fetch(`${app.engineUrl}/cache-remove/${encodeURIComponent(rh)}/${rIdx}`, { method: 'POST' })
                  .then(() => { if (typeof refreshEpisodeCacheList === 'function') refreshEpisodeCacheList(); })
                  .catch(() => {});
              }
            });
          }
        }
        const key = getProgressKey(item.imdbId, item.type, season, episode);
        const remaining = dur - cur;

        // Quando faltam <= 2 minutos (ou >= 90% em vídeos curtos) marca como "Visto"
        const isNearEnd = (dur > 180 && remaining <= 120) || (dur <= 180 && (cur / dur) >= 0.90);

        const prevRecord = state.watchProgressMap[key];
        const newlyCompleted = isNearEnd && !(prevRecord && prevRecord.completed);

        const record = {
          key,
          imdbId: item.imdbId,
          title: item.title,
          type: item.type,
          poster: item.poster,
          backdrop: item.backdrop,
          season: season || 1,
          episode: episode || 1,
          episodeTitle: episodeTitle || '',
          currentTime: cur,
          duration: dur,
          completed: Boolean(isNearEnd || (prevRecord && prevRecord.completed)),
          updatedAt: Date.now(),
          streamTitle: stream ? stream.title : '',
          streamResolution: stream ? stream.resolution : '',
          streamDirect: Boolean(stream && stream.directUrl),
          magnetUri: stream && typeof stream.magnetUri === 'string' ? stream.magnetUri : '',
          infoHash: stream ? (stream.infoHash || '') : '',
          fileIdx: stream ? stream.fileIdx : undefined
        };

        state.watchProgressMap[key] = record;
        await CineDB.put('watch_progress', record);
        syncUserStateToDisk();
        if (item.type === 'series' && record.completed) {
          const epMapCur = state.episodesCache[item.imdbId];
          const sList = epMapCur && epMapCur[season || 1];
          if (Array.isArray(sList) && sList.length) {
            const mInfo = ssResolveEpisodeMapping(sList, season || 1, episode || 1, episodeTitle || '', (stream && (stream.filename || stream.title)) || '');
            if (mInfo && mInfo.isMergedPair) {
              for (const pEp of mInfo.pairEps) {
                if (pEp !== (episode || 1)) {
                  const pk2 = getProgressKey(item.imdbId, item.type, season || 1, pEp);
                  const rec2 = { ...record, key: pk2, episode: pEp, completed: true };
                  state.watchProgressMap[pk2] = rec2;
                  CineDB.put('watch_progress', rec2).catch(() => {});
                }
              }
            }
          }
        }
        if (item.type === 'series' && cur > 60) markEarlierEpisodesWatched(record);

        if (record.completed) el.playerWatchedPill.classList.remove('hidden');

        if (newlyCompleted) {
          showToast(`✓ "${item.title}" marcado automaticamente como Visto (faltam ≤ 2 min)!`);
          renderContinueWatchingRow();
          renderCatalogGrid();
          updateDetailButtonsState();
        }
      }

      function computeAdjacentEpisode(ctx, delta, mapArg) {
        const map = mapArg || state.episodesCache[ctx.item.imdbId];
        if (!map) return null;
        const seasons = Object.keys(map).map(Number).sort((a, b) => a - b);
        const sCur = Number(ctx.season) || 1;
        const eCur = Number(ctx.episode) || 1;
        const eps = map[sCur] || [];
        const idx = eps.findIndex(e => Number(e.episode) === eCur);
        if (idx >= 0) {
          // Se o episódio atual faz parte de um episódio duplo fundido de 40m (ex: S04E01 "Fun Run (1)" + S04E02 "Fun Run (2)"),
          // o botão "Próx. Ep" avança diretamente para o S04E03 sem repetir o mesmo ficheiro de 40m!
          const curMap = ssResolveEpisodeMapping(eps, sCur, eCur, (eps[idx] && eps[idx].title) || ctx.episodeTitle || '', (ctx.stream && (ctx.stream.filename || ctx.stream.title)) || '');
          let targetIdx = idx + delta;
          if (delta > 0 && curMap && curMap.isMergedPair && eps[targetIdx] && curMap.pairEps.includes(Number(eps[targetIdx].episode))) {
            targetIdx++;
          } else if (delta < 0 && eps[targetIdx]) {
            const prevMap = ssResolveEpisodeMapping(eps, sCur, Number(eps[targetIdx].episode), eps[targetIdx].title || '', '');
            if (prevMap && prevMap.isMergedPair && prevMap.isSecondHalf && targetIdx - 1 >= 0) {
              targetIdx--;
            }
          }
          if (eps[targetIdx]) return eps[targetIdx];
        }
        const si = seasons.indexOf(ctx.season || 1);
        if (delta > 0 && si >= 0 && si < seasons.length - 1) {
          const next = map[seasons[si + 1]];
          if (next && next.length) return next[0];
        }
        if (delta < 0 && si > 0) {
          const prev = map[seasons[si - 1]];
          if (prev && prev.length) return prev[prev.length - 1];
        }
        return null;
      }

      function triggerUpNextEpisodePrompt() {
        const ctx = state.playingContext;
        if (!ctx || ctx.item.type !== 'series') return;
        const next = computeAdjacentEpisode(ctx, 1);
        if (!next) return; // último episódio conhecido

        const hasPre = Boolean(ctx.nextPick && ctx.nextPick.target && ctx.nextPick.target.episode === next.episode);
        el.upNextEpisodeTitle.textContent = `S${pad2(next.season)}E${pad2(next.episode)} — ${next.title}${hasPre ? ' ⚡ [Pronto em Cache]' : ''}`;
        el.upNextEpisodeCard.classList.remove('hidden');

        state.upNextCountdown = 10;
        el.upNextCountdownBadge.textContent = `Auto em ${state.upNextCountdown}s`;

        clearInterval(state.upNextTimer);
        state.upNextTimer = setInterval(() => {
          state.upNextCountdown--;
          if (state.upNextCountdown <= 0) {
            clearInterval(state.upNextTimer);
            jumpToEpisode(1);
          } else {
            el.upNextCountdownBadge.textContent = `Auto em ${state.upNextCountdown}s`;
          }
        }, 1000);
      }

      async function jumpToEpisode(delta) {
        clearInterval(state.upNextTimer);
        el.upNextEpisodeCard.classList.add('hidden');
        const ctx = state.playingContext;
        if (!ctx || ctx.item.type !== 'series') return;

        const map = await getSeriesEpisodesMap(ctx.item);
        const target = computeAdjacentEpisode(ctx, delta, map);
        if (!target) {
          showToast(delta > 0 ? 'Chegaste ao último episódio disponível 🎉' : 'Este é o primeiro episódio');
          return;
        }

        return playEpisodeTarget(ctx, target);
      }

      async function playEpisodeTarget(ctx, target) {
        clearInterval(state.upNextTimer);
        el.upNextEpisodeCard.classList.add('hidden');
        const epPanel = document.getElementById('playerEpisodesPanel');
        if (epPanel) epPanel.classList.add('hidden');
        saveCurrentPlaybackProgress();
        const label = `S${pad2(target.season)}E${pad2(target.episode)}`;
        showToast(`A procurar fonte para ${label}...`);
        el.playerLoadingOverlay.classList.remove('hidden');
        el.playerLoadingText.textContent = `A procurar fonte para ${label}...`;
        el.playerLoadingSub.textContent = 'A consultar os add-ons com a mesma qualidade do episódio anterior';

        let pick;
        if (ctx.nextPick && ctx.nextPick.target.season === target.season && ctx.nextPick.target.episode === target.episode) pick = ctx.nextPick.stream;
        else {
          const streams = await fetchStreamsFor(ctx.item, target.season, target.episode);
          pick = pickBestStream(streams, ctx.stream && ctx.stream.resolution, Boolean(ctx.stream && ctx.stream.directUrl));
        }
        if (!pick) {
          el.playerLoadingOverlay.classList.add('hidden');
          showToast(`Nenhuma fonte encontrada para ${label}.`);
          return;
        }

        if (state.selectedItem && state.selectedItem.imdbId === ctx.item.imdbId) {
          state.selectedSeason = target.season;
          state.selectedEpisode = target.episode;
        }
        const saved = state.watchProgressMap[getProgressKey(ctx.item.imdbId, 'series', target.season, target.episode)];
        launchVideoPlayer({
          item: ctx.item,
          season: target.season,
          episode: target.episode,
          episodeTitle: target.title,
          stream: pick,
          resumeSeconds: saved && !saved.completed ? saved.currentTime : 0
        });
      }

      function jumpToNextEpisodeNow() { return jumpToEpisode(1); }

      // ----- Vistos por episódio: tudo o que vem antes do ponto mais avançado conta como visto -----
      function epCmp(s1, e1, s2, e2) { return s1 !== s2 ? s1 - s2 : e1 - e2; }
      function furthestWatched(imdbId) {
        let best = null;
        Object.values(state.watchProgressMap).forEach(r => {
          if (r.imdbId !== imdbId || r.type !== 'series') return;
          if (!(r.completed || r.currentTime > 60)) return;
          if (!best || epCmp(r.season || 1, r.episode || 1, best.season || 1, best.episode || 1) > 0) best = r;
        });
        return best;
      }
      function setEpisodeWatched(item, ep, val, quiet) {
        const key = getProgressKey(item.imdbId, 'series', ep.season, ep.episode);
        const old = state.watchProgressMap[key] || {};
        const rec = {
          key, imdbId: item.imdbId, type: 'series', title: item.title, poster: item.poster, backdrop: item.backdrop,
          season: ep.season, episode: ep.episode, episodeTitle: ep.title || '',
          currentTime: val ? (old.currentTime || 0) : 0, duration: old.duration || 0,
          completed: val, manual: val ? 'watched' : 'unwatched',
          updatedAt: val ? Date.now() : 0
        };
        state.watchProgressMap[key] = rec;
        CineDB.put('watch_progress', rec);
        if (!quiet) { renderSeasonTabsAndEpisodes(); renderContinueWatchingRow(); renderHomeRows(); showToast(val ? `S${pad2(ep.season)}E${pad2(ep.episode)} marcado como visto ✓` : `S${pad2(ep.season)}E${pad2(ep.episode)} marcado como por ver`); }
      }
      function isEpisodeWatched(imdbId, s, e) {
        const r = state.watchProgressMap[getProgressKey(imdbId, 'series', s, e)];
        if (r && r.manual === 'unwatched') return false;
        if (r && (r.completed || r.manual === 'watched')) return true;
        const f = furthestWatched(imdbId);
        return !!f && epCmp(s, e, f.season || 1, f.episode || 1) < 0;
      }
      function isSeriesFullyWatched(imdbId, mapArg) {
        const map = mapArg || state.episodesCache[imdbId] || (state.cwMaps && state.cwMaps[imdbId]);
        if (!map) return false;
        const seasons = Object.keys(map).map(Number).filter(s => s > 0);
        if (!seasons.length) return false;
        return seasons.every(s => {
          const eps = map[s] || [];
          return eps.length > 0 && eps.every(e => isEpisodeWatched(imdbId, e.season || s, e.episode));
        });
      }
      function markEarlierEpisodesWatched(rec) {
        Object.values(state.watchProgressMap).forEach(r => {
          if (r.imdbId !== rec.imdbId || r.type !== 'series' || r.completed || r.manual === 'unwatched') return;
          if (epCmp(r.season || 1, r.episode || 1, rec.season || 1, rec.episode || 1) < 0) {
            r.completed = true;
            CineDB.put('watch_progress', r);
          }
        });
      }

      // ----- Painel de episódios dentro do player -----
      function renderPlayerCacheMapBar(pieceMap) {
        const host = document.getElementById('playerCacheMapBar');
        if (!host) return;
        if (!Array.isArray(pieceMap) || !pieceMap.length) { host.innerHTML = ''; return; }
        host.innerHTML = pieceMap.map(v => `<span style="flex:1;height:100%;background:${v >= 0.85 ? '#10b981' : (v > 0.08 ? '#f59e0b' : 'transparent')}"></span>`).join('');
      }

      async function renderPlayerEpisodes(season) {
        const ctx = state.playingContext;
        if (!ctx || !ctx.item) return;
        const map = await getSeriesEpisodesMap(ctx.item);
        const sel = document.getElementById('playerEpSeasonSelect');
        const list = document.getElementById('playerEpList');
        const seasons = Object.keys(map).map(Number).sort((a, b) => a - b);
        const targetSeason = seasons.includes(Number(season)) ? Number(season) : (seasons[0] || 1);
        sel.innerHTML = seasons.map(n => `<option value="${n}" ${n === targetSeason ? 'selected' : ''}>Temporada ${n} (${(map[n] || []).length} ep)</option>`).join('');
        sel.value = String(targetSeason);
        list.innerHTML = '';
        season = targetSeason;
        (map[season] || []).forEach(ep => {
          const isCur = ep.season === ctx.season && ep.episode === ctx.episode;
          const rec = state.watchProgressMap[getProgressKey(ctx.item.imdbId, 'series', ep.season, ep.episode)];
          const pct = rec && rec.duration > 0 && !rec.completed ? Math.min(100, Math.round(rec.currentTime / rec.duration * 100)) : 0;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'w-full text-left p-2.5 rounded-xl border flex items-center gap-2 ' + (isCur ? 'bg-indigo-600/25 border-indigo-500/60' : 'bg-white/5 hover:bg-white/10 border-white/10');
          row.innerHTML = `
            <span class="font-mono text-[11px] text-slate-400 w-7 shrink-0">E${pad2(ep.episode)}</span>
            <span class="flex-1 min-w-0">
              <span class="block text-xs font-semibold text-white truncate">${esc(ep.title)}</span>
              ${pct ? `<span class="block h-1 mt-1 bg-slate-800 rounded"><span class="block h-full bg-amber-400 rounded" style="width:${pct}%"></span></span>` : ''}
            </span>
            ${isCur ? '<span class="text-[10px] text-indigo-300 font-bold">▶ A ver</span>' : (isEpisodeWatched(ctx.item.imdbId, ep.season, ep.episode) ? '<span class="text-[10px] text-emerald-300 font-bold">✓</span>' : '')}`;
          row.addEventListener('click', () => { if (!isCur) playEpisodeTarget(ctx, ep); });
          list.appendChild(row);
        });
      }
      function togglePlayerEpisodesPanel() {
        const ctx = state.playingContext;
        const panel = document.getElementById('playerEpisodesPanel');
        if (!ctx || ctx.item.type !== 'series') return;
        if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
        panel.classList.remove('hidden');
        renderPlayerEpisodes(ctx.season || 1);
      }

      function initSearchSuggest() {
        const input = el.globalSearchInput, box = document.getElementById('searchSuggest');
        const render = () => {
          const q = input.value.trim().toLowerCase();
          const recent = lsGet('ms_recent', []) || [];
          if (!q) {
            if (!recent.length) { box.classList.add('hidden'); return; }
            box.innerHTML = recent.map((r, i) => `<button type="button" data-i="${i}" class="w-full text-left px-3 py-2 hover:bg-indigo-600/30 text-slate-200">🕘 ${esc(r)}</button>`).join('');
            box.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', (ev) => {
              ev.preventDefault();
              input.value = recent[parseInt(b.getAttribute('data-i'), 10)];
              input.dispatchEvent(new Event('input'));
              box.classList.add('hidden');
            }));
            box.classList.remove('hidden');
            return;
          }
          const cineMatches = state.catalog.filter(c => String(c.title).toLowerCase().includes(q) || String(c.cast || '').toLowerCase().includes(q)).slice(0, 5);
          const iptvMatches = (state.iptvChannels || []).filter(ch =>
            String(ch.name || '').toLowerCase().includes(q) ||
            String(ch.category || '').toLowerCase().includes(q) ||
            (ch.epgNow && String(ch.epgNow.title || '').toLowerCase().includes(q))
          ).slice(0, 4);
          const cachedMatches = (state.episodeCacheItems || []).filter(ci =>
            String(ci.title || '').toLowerCase().includes(q) ||
            String(ci.name || '').toLowerCase().includes(q)
          ).slice(0, 3);
          const quickCmds = [
            { id: 'cmd-ws', label: '🖥 Abrir Vista Workspace IPTV (Portais + Grelha)', keywords: 'workspace iptv portais grelha zeus', run: () => { setAppMode('iptv'); setIptvViewMode('workspace'); } },
            { id: 'cmd-cards', label: '🗂 Abrir Vista Cartões IPTV (EPG Visual)', keywords: 'cartoes cards iptv epg', run: () => { setAppMode('iptv'); setIptvViewMode('cards'); } },
            { id: 'cmd-multi', label: '📺 Ativar/Desativar Duplo Ecrã Multiview', keywords: 'duplo ecra multiview pip desporto', run: () => { el.headerMultiViewBtn.click(); } },
            { id: 'cmd-addons', label: '🏪 Abrir Loja Curada de Add-ons & Configurador Debrid', keywords: 'addons loja torrentio debrid stremio configuracoes', run: () => { el.openSettingsModalBtn.click(); } }
          ].filter(cmd => cmd.keywords.includes(q.replace(/^>\s*/, '')) || cmd.label.toLowerCase().includes(q.replace(/^>\s*/, ''))).slice(0, 3);

          if (!cineMatches.length && !iptvMatches.length && !cachedMatches.length && !quickCmds.length) { box.classList.add('hidden'); return; }
          let out = '';
          if (quickCmds.length) {
            out += `<div class="px-3 py-1 bg-[#090d16] text-[10px] font-bold uppercase text-emerald-300">⚡ Comandos Rápidos (Command-K)</div>`;
            quickCmds.forEach((cmd, idx) => {
              out += `<div data-qcmd="${idx}" class="px-3 py-2 hover:bg-emerald-600/25 flex items-center justify-between gap-2 cursor-pointer border-b border-white/5"><span class="truncate text-slate-100 font-medium">${esc(cmd.label)}</span><span class="text-[10px] text-emerald-300 font-mono">⏎ Executar</span></div>`;
            });
          }
          if (cachedMatches.length) {
            out += `<div class="px-3 py-1 bg-[#090d16] text-[10px] font-bold uppercase text-amber-300">⚡ Episódios em Cache no Disco (0ms)</div>`;
            cachedMatches.forEach((ci, idx) => {
              const epTag = (ci.season && ci.episode) ? ` S${pad2(ci.season)}E${pad2(ci.episode)}` : '';
              out += `<div data-cacheidx="${idx}" class="px-3 py-2 hover:bg-amber-600/25 flex items-center justify-between gap-2 cursor-pointer border-b border-white/5"><span class="truncate text-slate-100 font-semibold">⚡ ${esc((ci.title || ci.name) + epTag)}</span><span class="text-[10px] text-amber-300 font-bold">▶ Disco ${Math.round((ci.progress || 0) * 100)}%</span></div>`;
            });
          }
          if (cineMatches.length) {
            out += `<div class="px-3 py-1 bg-[#090d16] text-[10px] font-bold uppercase text-indigo-300">🍿 Filmes e Séries</div>`;
            cineMatches.forEach((c, idx) => {
              out += `<div data-cidx="${idx}" class="px-3 py-2 hover:bg-indigo-600/25 flex items-center justify-between gap-2 cursor-pointer border-b border-white/5"><span class="truncate text-slate-100 font-semibold">${c.type === 'series' ? '📺' : '🎬'} ${esc(c.title)} <span class="text-slate-400 font-normal">(${esc(c.year || '')}) ★ ${esc(c.rating || '')}</span></span><button type="button" data-splay="${idx}" class="px-2 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold">▶ Ver</button></div>`;
            });
          }
          if (iptvMatches.length) {
            out += `<div class="px-3 py-1 bg-[#090d16] text-[10px] font-bold uppercase text-blue-300">📡 Canais IPTV &amp; EPG em Direto</div>`;
            iptvMatches.forEach((ch, idx) => {
              const epgSub = (ch.epgNow && ch.epgNow.title && ch.epgNow.title !== ch.name) ? ` • <span class="text-emerald-300">${esc(ch.epgNow.title)}</span>` : '';
              out += `<div data-iidx="${idx}" class="px-3 py-2 hover:bg-blue-600/25 flex items-center justify-between gap-2 cursor-pointer border-b border-white/5"><span class="truncate text-slate-100">📡 ${esc(ch.name)}${epgSub}</span><span class="text-[10px] text-blue-300 font-bold">▶ Direto</span></div>`;
            });
          }
          box.innerHTML = out;
          box.querySelectorAll('[data-qcmd]').forEach(row => {
            const cmd = quickCmds[parseInt(row.getAttribute('data-qcmd'), 10)];
            row.addEventListener('mousedown', (ev) => {
              ev.preventDefault();
              box.classList.add('hidden');
              if (cmd && cmd.run) cmd.run();
            });
          });
          box.querySelectorAll('[data-cacheidx]').forEach(row => {
            const ci = cachedMatches[parseInt(row.getAttribute('data-cacheidx'), 10)];
            row.addEventListener('mousedown', (ev) => {
              ev.preventDefault();
              box.classList.add('hidden');
              if (ci) playCachedEpisodeDirect(ci);
            });
          });
          box.querySelectorAll('[data-cidx]').forEach(row => {
            const it = cineMatches[parseInt(row.getAttribute('data-cidx'), 10)];
            row.addEventListener('mousedown', (ev) => {
              ev.preventDefault();
              box.classList.add('hidden');
              if (state.appMode !== 'cine') setAppMode('cine');
              if (ev.target.closest('[data-splay]')) quickPlayItemDirect(it);
              else openDetailDrawer(it);
            });
          });
          box.querySelectorAll('[data-iidx]').forEach(row => {
            const ch = iptvMatches[parseInt(row.getAttribute('data-iidx'), 10)];
            row.addEventListener('mousedown', (ev) => {
              ev.preventDefault();
              box.classList.add('hidden');
              if (state.appMode !== 'iptv') setAppMode('iptv');
              playIptvChannelById(ch.id);
            });
          });
          box.classList.remove('hidden');
          return;
        };
        const _unused_old = () => {
          const q = input.value.trim().toLowerCase();
          const recent = lsGet('ms_recent', []) || [];
          const rows = [];
          if (!q) recent.forEach(r => rows.push({ t: r, label: '🕘 ' + r }));
          else {
            recent.filter(r => r.toLowerCase().includes(q) && r.toLowerCase() !== q).slice(0, 2).forEach(r => rows.push({ t: r, label: '🕘 ' + r }));
            state.catalog.filter(c => String(c.title).toLowerCase().includes(q)).slice(0, 6).forEach(c => rows.push({ t: c.title, label: `${c.type === 'series' ? '📺' : '🎬'} ${esc(c.title)} <span class="text-slate-500">${esc(c.year || '')}</span>`, raw: true }));
          }
          if (!rows.length) { box.classList.add('hidden'); return; }
          box.innerHTML = rows.map((r, i) => `<button type="button" data-i="${i}" class="w-full text-left px-3 py-2 hover:bg-indigo-600/30 text-slate-200">${r.raw ? r.label : esc(r.label)}</button>`).join('');
          box.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            input.value = rows[parseInt(b.getAttribute('data-i'), 10)].t;
            input.dispatchEvent(new Event('input'));
            box.classList.add('hidden');
          }));
          box.classList.remove('hidden');
        };
        input.addEventListener('focus', render);
        input.addEventListener('input', render);
        input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 120));
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') box.classList.add('hidden');
          if (ev.key === 'Enter' && input.value.trim().length >= 2 && !input.value.startsWith('magnet:')) {
            if (!state.privateMode) {
              const list = [input.value.trim(), ...(lsGet('ms_recent', []) || []).filter(x => x.toLowerCase() !== input.value.trim().toLowerCase())].slice(0, 6);
              lsSet('ms_recent', list);
            }
            box.classList.add('hidden');
          }
        });
      }

      async function copyDiagnosticReport() {
        const app = window.macstreamApp;
        const L = [];
        L.push(`MacStream ${(app && app.version) || '(browser)'} — ${new Date().toISOString()}`);
        L.push(navigator.userAgent);
        if (app && app.engineUrl) {
          try { L.push('--- motor', JSON.stringify(await fetch(`${app.engineUrl}/report`).then(r => r.json()), null, 1)); }
          catch (e) { L.push('--- motor: sem resposta (' + (e && e.message) + ')'); }
        }
        try {
          const ctx = state.playingContext;
          if (ctx && ctx.item) {
            const v = el.cineVideoPlayer;
            L.push('--- reprodução', JSON.stringify({
              titulo: ctx.item.title, temporada: ctx.season, episodio: ctx.episode,
              fonte: ctx.stream && ctx.stream.title, modoCompat: !!state.compat,
              compat: state.compat ? { offset: state.compat.offset, audio: state.compat.audio } : null,
              tempo: Math.round(pbCur()), duracao: Math.round(pbDur()),
              video: v ? { w: v.videoWidth, h: v.videoHeight, readyState: v.readyState, erro: v.error && v.error.code } : null,
              legendas: (state.subtitleTracks || []).map(t => ({ cod: t.code, off: t.offset, esc: t.scale }))
            }));
          }
        } catch (e) {}
        L.push('--- consola', (window.__msLog || []).slice(-150).join('\n'));
        let text = L.join('\n');
        try { const tk = String((app && app.engineUrl) || '').split('/').filter(Boolean).pop(); if (tk && tk.length >= 16) text = text.split(tk).join('<TOKEN>'); } catch (e) {}
        try {
          const secrets = [
            state.xtreamConfig && state.xtreamConfig.password,
            state.xtreamConfig && state.xtreamConfig.password ? encodeURIComponent(state.xtreamConfig.password) : '',
            state.debridApiKey,
            state.debridApiKey ? encodeURIComponent(state.debridApiKey) : '',
            state.tmdbApiKey,
            state.tmdbApiKey ? encodeURIComponent(state.tmdbApiKey) : ''
          ];
          for (const sec of secrets) {
            if (sec && String(sec).length >= 3) text = text.split(String(sec)).join('<REDACTED>');
          }
          text = text.replace(/([?&](?:password|api_key|token)=)[^&\s"'`]+/gi, '$1<REDACTED>');
          text = text.replace(/(\/(?:live|movie|series)\/[^/\s]+\/)([^/\s]+)(\/)/gi, '$1<REDACTED>$3');
          text = text.replace(/(\|(?:realdebrid|alldebrid|premiumize|debridlink|torbox)=)[^|\s/"'`]+/gi, '$1<REDACTED>');
        } catch (e) {}
        try { await navigator.clipboard.writeText(text); showToast('📋 Relatório copiado — cola-o na conversa.'); }
        catch (e) { showToast('Não consegui copiar o relatório.'); }
      }

      async function refreshCacheLabel() {
        const btn = document.getElementById('clearCacheBtn');
        const app = window.macstreamApp;
        if (!btn || !app || !app.cacheSize) return;
        btn.classList.remove('hidden');
        try {
          const r = await fetch(`${app.engineUrl}/cache`).then(x => x.json()).catch(() => ({ bytes: 0 }));
          const chromium = await app.cacheSize();
          const total = (r.bytes || 0) + (chromium || 0);
          btn.textContent = `🧹 Libertar espaço (${total > 1073741824 ? (total / 1073741824).toFixed(1) + ' GB' : Math.round(total / 1048576) + ' MB'})`;
        } catch (e) {}
      }
      async function clearAppCache() {
        const app = window.macstreamApp;
        if (!app) return;
        try { await fetch(`${app.engineUrl}/clear`).catch(() => {}); await app.clearCache(); showToast('Espaço libertado.'); } catch (e) {}
        refreshCacheLabel();
      }

      function onPlayerTimeUpdate() {
        const v = el.cineVideoPlayer;
        const rawCur = (state.compat ? state.compat.offset : 0) + (v.currentTime || 0);
        if (state.seekLockUntil && state.seekTarget != null) {
          if (Math.abs(rawCur - state.seekTarget) < 2.2 || Date.now() >= state.seekLockUntil) {
            state.seekLockUntil = 0;
          }
        }
        const cur = pbCur(), dur = pbDur();
        el.playerCurrentTime.textContent = formatTime(cur);
        el.playerDurationTime.textContent = formatTime(dur);
        if (dur > 0) {
          const frac = Math.max(0, Math.min(1, cur / dur));
          if (!state.seeking) el.playerSeekInput.value = String(Math.round(frac * 1000));
          document.getElementById('playerPlayedBar').style.width = (frac * 100) + '%';
        }
        updateBufferBar();
        const now = Date.now();
        if (now - (state.lastTick || 0) < 3000) return;
        state.lastTick = now;
        const ctx = state.playingContext;
        if (!ctx || !ctx.item) return;
        // ponto guardado de forma síncrona (sobrevive a fechar a app de repente)
        try { localStorage.setItem('ms_lastpos', JSON.stringify({ key: getProgressKey(ctx.item.imdbId, ctx.item.type, ctx.season, ctx.episode), currentTime: cur, duration: dur, updatedAt: now })); } catch (e) {}
        // Saltar Intro Inteligente (usa deteção acústica/capítulos de /detect-intro ou preferência guardada por série)
        const btn = document.getElementById('skipIntroBtn');
        if (ctx.item.type === 'series') {
          const det = ctx.detectedIntro;
          const pref = lsGet('ms_intro_' + ctx.item.imdbId, null);
          let vis = false;
          if (det && det.ok && det.endSec > det.startSec) {
            vis = (cur >= Math.max(0, det.startSec - 2) && cur <= det.endSec - 2);
            if (vis) btn.textContent = `⏭ Saltar Intro (${formatTime(det.endSec)})`;
          } else if (pref) {
            vis = (cur >= pref.at - 12 && cur <= pref.at + 35);
            if (vis) btn.textContent = `⏭ Saltar Intro (+${pref.len || 32}s)`;
          } else {
            vis = (cur >= 3 && cur <= 210);
            if (vis) btn.textContent = '⏭ Saltar Intro';
          }
          btn.classList.toggle('hidden', !vis);
        } else btn.classList.add('hidden');
        // Cartão "A seguir": nos últimos 25 s
        if (ctx.item.type === 'series' && dur > 600 && dur - cur <= 25 && !ctx.upNextShown) { ctx.upNextShown = true; triggerUpNextEpisodePrompt(); }
        // Auto-Preload do Próximo Episódio aos 75% do episódio (ou últimos 5 min) para Binge-Watching em 0ms!
        if (ctx.item.type === 'series' && dur > 300 && ((cur / dur) >= 0.75 || (dur - cur) < 300) && !ctx.preloadStarted) {
          ctx.preloadStarted = true;
          preloadNextEpisode(ctx);
        }
      }

      function updateBufferBar() {
        const v = el.cineVideoPlayer;
        const dur = pbDur();
        const bar = document.getElementById('playerBufferBar');
        if (!bar || !(dur > 0)) return;
        const off = state.compat ? state.compat.offset : 0;
        let end = 0;
        for (let i = 0; i < v.buffered.length; i++) { if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) end = v.buffered.end(i); }
        bar.style.width = Math.min(100, ((off + end) / dur) * 100) + '%';
      }

      function skipIntro() {
        const ctx = state.playingContext;
        if (!ctx || !ctx.item) return;
        const pos = pbCur();
        const det = ctx.detectedIntro;
        if (det && det.ok && det.endSec > pos + 2) {
          pbSeek(det.endSec);
          lsSet('ms_intro_' + ctx.item.imdbId, { at: det.startSec, len: Math.round(det.endSec - det.startSec) });
          syncUserStateToDisk();
          showPlayerOsd(`⏭ Intro saltada para ${formatTime(det.endSec)}`);
          document.getElementById('skipIntroBtn').classList.add('hidden');
          return;
        }
        const pref = lsGet('ms_intro_' + ctx.item.imdbId, null);
        const isSitcom = /office|bear|parks|friends|seinfeld|brooklyn|lasso/i.test(ctx.item.title || '');
        const len = pref ? pref.len : (isSitcom ? 32 : 75);
        pbSeek(pos + len);
        lsSet('ms_intro_' + ctx.item.imdbId, { at: pos, len });
        syncUserStateToDisk();
        showPlayerOsd(`⏭ Intro saltada (+${len}s)`);
        document.getElementById('skipIntroBtn').classList.add('hidden');
      }

      // Tamanho da imagem: 0 Ajustar (barras pretas), 1 Ampliar (cresce p/ cima e baixo, corta pouco), 2 Preencher (sem barras)
      const FIT_NAMES = ['Ajustar', 'Ampliar', 'Preencher'];
      function getFitMode() { const n = parseInt(lsGet('ms_fit', 1), 10); return n >= 0 && n <= 2 ? n : 1; }
      function applyVideoFit() {
        // Recorta os lados (object-view-box) para a imagem crescer para cima e para baixo; as legendas ficam fixas no fundo
        const v = el.cineVideoPlayer, mode = getFitMode();
        const W = v.clientWidth, H = v.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
        let inset = 0;
        if (W && H && vw && vh && mode > 0 && W / vw <= H / vh) {
          const c = W / vw;
          const Hd = mode === 1 ? Math.min(H, vh * c * 1.15) : H;
          const wCrop = vh * (W / Hd); // largura de origem visível
          inset = Math.max(0, (1 - wCrop / vw) / 2 * 100);
        }
        v.style.objectViewBox = inset > 0.2 ? `inset(0 ${inset.toFixed(2)}% 0 ${inset.toFixed(2)}%)` : '';
        const b = document.getElementById('playerFitBtn');
        if (b) b.textContent = '⤢ ' + FIT_NAMES[mode];
      }
      function cycleVideoFit() {
        const m = (getFitMode() + 1) % 3;
        lsSet('ms_fit', m);
        applyVideoFit();
        showPlayerOsd('⤢ Imagem: ' + FIT_NAMES[m]);
      }

      function initPlayerExtras() {
        document.body.classList.toggle('is-app', Boolean(window.macstreamApp));
        el.cineVideoPlayer.addEventListener('loadedmetadata', applyVideoFit);
        el.cineVideoPlayer.addEventListener('resize', applyVideoFit);
        window.addEventListener('resize', applyVideoFit);
        document.addEventListener('fullscreenchange', () => setTimeout(applyVideoFit, 100));
        document.getElementById('playerFitBtn').addEventListener('click', cycleVideoFit);
        applyVideoFit();
        // --- Áudio ---
        document.getElementById('playerAudioSelect').addEventListener('change', (ev) => {
          state.pendingAudio = parseInt(ev.target.value, 10) || 0;
          try { const tr = state.tracks && state.engineInfo && state.tracks[state.engineInfo.infoHash + ':' + state.engineInfo.fileIdx]; const a = tr && tr.audio && tr.audio[state.pendingAudio]; if (a && a.lang) saveSubPref({ audioLang: a.lang }); } catch (e) {}
          showToast('A mudar a faixa de áudio…');
          switchPlayerEngineMode('compat', pbCur());
        });
        el.cineVideoPlayer.addEventListener('playing', () => {
          const v = el.cineVideoPlayer, ctx = state.playingContext;
          if (!ctx || ctx.autoCompat || state.compat || state.activePlayMode !== 'engine') return;
          setTimeout(() => {
            if (ctx !== state.playingContext || ctx.autoCompat || state.compat || v.paused) return;
            if (!v.muted && v.volume > 0 && typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0 && v.currentTime > 2) {
              ctx.autoCompat = true;
              state.pendingAudio = 0;
              showToast('O áudio deste ficheiro não é suportado — a converter…');
              const resumePos = pbCur();
              switchPlayerEngineMode('compat', resumePos < 4.5 ? 0 : resumePos);
            }
          }, 2000);
        });
        // --- Saltar intro / velocidade / dica da barra ---
        document.getElementById('skipIntroBtn').addEventListener('click', skipIntro);
        const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        window.addEventListener('keydown', (ev) => {
          if (el.playerModal.classList.contains('hidden')) return;
          const tag = (ev.target && ev.target.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          const v = el.cineVideoPlayer;
          if (ev.key === ']' || ev.key === '[' || ev.key === '\\') {
            let i = RATES.indexOf(v.playbackRate); if (i < 0) i = 2;
            i = ev.key === ']' ? Math.min(RATES.length - 1, i + 1) : (ev.key === '[' ? Math.max(0, i - 1) : 2);
            v.playbackRate = v.defaultPlaybackRate = RATES[i];
            try { localStorage.setItem('macstream_rate', String(RATES[i])); } catch (e) {}
            showPlayerOsd(`⏱ Velocidade ${RATES[i]}x`);
          } else if (ev.key.toLowerCase() === 'i' && !ev.metaKey && !ev.ctrlKey) {
            if (!document.getElementById('skipIntroBtn').classList.contains('hidden')) skipIntro();
          }
        });
        const wrap = document.getElementById('playerSeekWrap'), tip = document.getElementById('playerSeekTip');
        wrap.addEventListener('mousemove', (ev) => {
          const r = wrap.getBoundingClientRect(), d = pbDur();
          if (!(d > 0)) return;
          const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
          const hoverSec = (x / r.width) * d;
          const cState = getCachePieceStateAt(hoverSec);
          const cTag = cState === 'disk' ? ' • 🟢 Em Cache no Disco' : (cState === 'part' ? ' • 🟠 A transferir' : ' • ⚪ Na rede');
          tip.textContent = `${formatTime(hoverSec)}${cTag}`;
          tip.style.left = x + 'px';
          tip.classList.remove('hidden');
        });
        wrap.addEventListener('mouseleave', () => tip.classList.add('hidden'));
        // --- A carregar devagar? Diz porquê ---
        const v0 = el.cineVideoPlayer, box = document.getElementById('playerStallBox');
        let stallT = null, stallHard = null;
        const clearStall = () => { clearTimeout(stallT); clearTimeout(stallHard); box.classList.add('hidden'); };
        v0.addEventListener('waiting', () => {
          if (!v0.currentTime) return;
          clearTimeout(stallT); clearTimeout(stallHard);
          stallT = setTimeout(() => {
            if (v0.readyState >= 3) return;
            const t = state.lastTel || {};
            document.getElementById('playerStallText').textContent = t.peers === 0 ? 'Ninguém está a partilhar esta fonte agora.' : `A carregar… ${t.mbps != null ? t.mbps + ' MB/s' : ''}${t.peers != null ? ' • ' + t.peers + ' fontes' : ''}. Pode ser uma fonte lenta.`;
            box.classList.remove('hidden');
          }, 2500);
          stallHard = setTimeout(() => { if (v0.readyState < 3 && !v0.paused && (!state.lastTel || state.lastTel.mbps < 0.15)) tryNextSource('travou'); }, 45000);
        });
        ['playing', 'canplay', 'seeked', 'pause'].forEach(e => v0.addEventListener(e, clearStall));
        ['seeked', 'loadedmetadata'].forEach(e => v0.addEventListener(e, () => { try { if (state.activeSubCode) enforceSubtitleSelection(state.activeSubCode); } catch (x) {} }));
        document.getElementById('playerStallNextBtn').addEventListener('click', () => { clearStall(); tryNextSource('manual', true).then(ok => { if (!ok) showToast('Não há outra fonte disponível.'); }); });
        document.getElementById('helpRetryBtn').addEventListener('click', () => { state.pendingAudio = 0; switchPlayerEngineMode(state.activePlayMode === 'compat' ? 'compat' : 'auto', pbCur()); });
        document.getElementById('helpNextSourceBtn').addEventListener('click', () => { tryNextSource('manual', true).then(ok => { if (!ok) showToast('Não há outra fonte disponível.'); }); });
        const lns = document.getElementById('loadingNextSourceBtn');
        if (lns) lns.addEventListener('click', () => { tryNextSource('manual', true).then(ok => { if (!ok) showToast('Não há outra fonte disponível.'); }); });
        // --- Teclas de media do Mac / Centro de Controlo ---
        try {
          if ('mediaSession' in navigator) {
            const ms = navigator.mediaSession;
            ms.setActionHandler('play', () => v0.play());
            ms.setActionHandler('pause', () => v0.pause());
            ms.setActionHandler('seekbackward', () => seekRelative(-10));
            ms.setActionHandler('seekforward', () => seekRelative(10));
            ms.setActionHandler('previoustrack', () => jumpToEpisode(-1));
            ms.setActionHandler('nexttrack', () => jumpToEpisode(1));
          }
        } catch (e) {}
        // --- Não deixar o Mac adormecer a ver ---
        const keep = (on) => { try { window.macstreamApp && window.macstreamApp.keepAwake && window.macstreamApp.keepAwake(on); } catch (e) {} };
        v0.addEventListener('play', () => keep(true));
        v0.addEventListener('pause', () => keep(false));
        v0.addEventListener('ended', () => keep(false));
        // --- Guardar o ponto ao fechar ---
        const flush = () => {
          const ctx = state.playingContext; const v = el.cineVideoPlayer;
          if (!ctx || !ctx.item || el.playerModal.classList.contains('hidden')) return;
          try { localStorage.setItem('ms_lastpos', JSON.stringify({ key: getProgressKey(ctx.item.imdbId, ctx.item.type, ctx.season, ctx.episode), currentTime: pbCur(), duration: pbDur(), updatedAt: Date.now() })); } catch (e) {}
        };
        window.addEventListener('beforeunload', flush);
        window.addEventListener('pagehide', flush);
        initSearchSuggest();
        const crb = document.getElementById('copyReportBtn'); if (crb) crb.addEventListener('click', copyDiagnosticReport);
        const ccb = document.getElementById('clearCacheBtn'); if (ccb) ccb.addEventListener('click', clearAppCache);
        const pmb = document.getElementById('privateModeBtn');
        if (pmb) pmb.addEventListener('click', () => {
          state.privateMode = !state.privateMode;
          pmb.textContent = state.privateMode ? '🕵️ Modo Privado: ON' : '🕵️ Modo Privado: OFF';
          pmb.classList.toggle('border-emerald-500/60', state.privateMode);
          pmb.classList.toggle('text-emerald-300', state.privateMode);
          showToast(state.privateMode ? '🕵️ Modo Privado ativo: histórico e pesquisas não serão gravados.' : 'Modo Privado desativado.');
        });
        const chb = document.getElementById('clearHistoryBtn');
        if (chb) chb.addEventListener('click', async () => {
          state.watchProgressMap = {};
          state.iptvHistory = [];
          try { await CineDB.clearStore('watch_progress'); } catch (e) {}
          try { localStorage.removeItem('macstream_history'); localStorage.removeItem('ms_recent'); } catch (e) {}
          if (!state.privateMode) syncUserStateToDisk(true);
          renderAllSections();
          if (state.appMode === 'iptv') renderIptvChannelList();
          showToast('🗑️ Histórico de visualização, IPTV e pesquisas limpo!');
        });
        refreshCacheLabel();

        const v = el.cineVideoPlayer;
        const modal = el.playerModal;
        const epPanelEl = document.getElementById('playerEpisodesPanel');
        if (epPanelEl) {
          epPanelEl.addEventListener('click', (ev) => ev.stopPropagation());
          epPanelEl.addEventListener('mousedown', (ev) => ev.stopPropagation());
        }
        document.getElementById('playerEpisodesBtn').addEventListener('click', (ev) => {
          ev.stopPropagation();
          togglePlayerEpisodesPanel();
        });
        document.getElementById('playerEpCloseBtn').addEventListener('click', (ev) => {
          ev.stopPropagation();
          document.getElementById('playerEpisodesPanel').classList.add('hidden');
        });
        document.getElementById('playerEpSeasonSelect').addEventListener('change', (ev) => {
          ev.stopPropagation();
          renderPlayerEpisodes(parseInt(ev.target.value, 10));
        });
        window.addEventListener('keydown', (ev) => {
          if (modal.classList.contains('hidden')) return;
          const tag = (ev.target && ev.target.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (ev.key.toLowerCase() === 'e' && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); togglePlayerEpisodesPanel(); }
        });

        // Legendas: nunca mais do que uma visível
        v.textTracks.addEventListener('addtrack', () => enforceSubtitleSelection());
        v.textTracks.addEventListener('change', () => enforceSubtitleSelection());
        v.addEventListener('loadedmetadata', () => enforceSubtitleSelection());

        // Barras escondem-se sozinhas durante a reprodução
        let hudT;
        const showHud = () => {
          modal.classList.remove('hud-hidden');
          clearTimeout(hudT);
          hudT = setTimeout(() => {
            const panelOpen = !document.getElementById('playerEpisodesPanel').classList.contains('hidden');
            if (!v.paused && !panelOpen && el.playerLoadingOverlay.classList.contains('hidden') && !modal.classList.contains('hidden')) modal.classList.add('hud-hidden');
          }, 3000);
        };
        ['mousemove', 'mousedown', 'keydown'].forEach(evt => (evt === 'keydown' ? window : modal).addEventListener(evt, showHud));
        v.addEventListener('pause', showHud);
        v.addEventListener('play', showHud);

        // Duplo clique = ecrã inteiro; volume lembrado
        v.addEventListener('dblclick', () => togglePlayerFullscreen());
        try {
          const sv = parseFloat(localStorage.getItem('macstream_volume'));
          if (isFinite(sv)) { v.volume = Math.min(1, Math.max(0, sv)); el.playerVolumeSlider.value = String(v.volume); }
        } catch (e) {}
        v.addEventListener('volumechange', () => { try { localStorage.setItem('macstream_volume', String(v.volume)); } catch (e) {} });
      }
      setTimeout(initPlayerExtras, 0);
      setTimeout(initCatalogFilters, 0);

      // =======================================================================
      // 13. PLAYER UI CONTROLS & KEYBOARD SHORTCUTS (Space, F, Arrows, M, C)
