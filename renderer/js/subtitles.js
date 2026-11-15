'use strict';
      // =======================================================================
      function convertSrtToVtt(srtText) {
        const normalized = String(srtText)
          .replace(/^﻿/, '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/\{\\[^}]*\}/g, '') // limpa tags ASS/SSA {\an8}, {\pos(...)}
          .replace(/<font[^>]*>/gi, '')
          .replace(/<\/font>/gi, '')
          .replace(/\b(\d):(\d{2}:\d{2})[,.](\d{3})\b/g, '0$1:$2.$3')
          .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        return 'WEBVTT\n\n' + normalized;
      }

      function decodeSubtitleBuffer(buf) {
        let txt = new TextDecoder('utf-8').decode(buf);
        if ((txt.match(/\uFFFD/g) || []).length > 3) {
          try { txt = new TextDecoder('windows-1252').decode(buf); } catch (e) {}
        }
        return txt;
      }

      function shiftVtt(vtt, delta, scale, map, base, dropPast) {
        scale = scale || 1;
        const parse = (s) => {
          const p = s.split(':').map(Number);
          return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
        };
        const fmt = (t) => {
          t = Math.max(0, t);
          const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
          return `${pad2(h)}:${pad2(m)}:${s.toFixed(3).padStart(6, '0')}`;
        };
        if (!dropPast) {
          return vtt.replace(/^(.*?)((?:\d+:)?\d{2}:\d{2}\.\d{3})(\s*-->\s*)((?:\d+:)?\d{2}:\d{2}\.\d{3})(.*)$/gm,
            (m, pre, a, arrow, b, post) => {
              const ta = parse(a), tb = parse(b);
              const d = delta; // desvio individual desta legenda
              return pre + fmt(ta * scale + d) + arrow + fmt(tb * scale + d) + post;
            });
        }
        const blocks = String(vtt || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
        const outBlocks = [];
        const cueRe = /^(.*?)((?:\d+:)?\d{2}:\d{2}\.\d{3})(\s*-->\s*)((?:\d+:)?\d{2}:\d{2}\.\d{3})(.*)$/m;
        for (let i = 0; i < blocks.length; i++) {
          const blk = blocks[i];
          if (i === 0 && /^\s*WEBVTT/i.test(blk)) {
            outBlocks.push(blk);
            continue;
          }
          const m = cueRe.exec(blk);
          if (!m) {
            if (blk.trim()) outBlocks.push(blk);
            continue;
          }
          const ta = parse(m[2]), tb = parse(m[4]);
          const d = delta;
          const tas = ta * scale + d;
          const tbs = tb * scale + d;
          if (tbs <= 0.05) continue; // descarta cues anteriores ao ponto de seek para não acumular em 00:00:00.000
          const replaced = blk.replace(cueRe, (_, pre, a, arrow, b, post) => {
            return pre + fmt(Math.max(0.02, tas)) + arrow + fmt(tbs) + post;
          });
          outBlocks.push(replaced);
        }
        return outBlocks.join('\n\n') + '\n';
      }

      function mountSubtitleTrack(entry, show) {
        if (entry.trackEl) { try { entry.trackEl.remove(); } catch (e) {} }
        if (entry.url) { try { URL.revokeObjectURL(entry.url); } catch (e) {} state.subtitleUrls = (state.subtitleUrls || []).filter(x => x !== entry.url); }
        const baseOff = (entry.code === state.activeSubCode && state.activeSubOffset != null) ? state.activeSubOffset : (entry.offset || 0);
        if (baseOff !== entry.offset) entry.offset = baseOff;
        const eff = baseOff - (state.compat ? state.compat.offset : 0);
        const sc = entry.scale || 1;
        const dropPast = Boolean(state.compat && state.compat.offset > 0.5);
        const vtt = (eff || sc !== 1 || entry.map || dropPast) ? shiftVtt(entry.vtt, eff, sc, entry.map, entry.offset || 0, dropPast) : entry.vtt;
        entry.url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        state.subtitleUrls.push(entry.url);

        const trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = entry.label;
        trackEl.srclang = 'xx';
        trackEl.src = entry.url;
        // Legendas acima da barra de controlos, centradas e sem sobreposição entre linhas/cues simultâneas
        const fixCues = () => {
          try {
            const cs = trackEl.track.cues;
            if (!cs) return;
            let prevEnd = -1, prevLine = -3;
            for (let i = 0; i < cs.length; i++) {
              const c = cs[i];
              c.snapToLines = true;
              if (c.startTime < prevEnd - 0.05) {
                prevLine = prevLine <= -5 ? -3 : prevLine - 1;
              } else {
                prevLine = -3;
              }
              c.line = prevLine;
              c.align = 'center';
              c.position = 'auto';
              c.size = 86;
              if (c.endTime > prevEnd) prevEnd = c.endTime;
            }
          } catch (e) {}
        };
        trackEl.addEventListener('load', fixCues);
        el.cineVideoPlayer.appendChild(trackEl);
        trackEl.track.mode = show ? 'showing' : 'disabled';
        fixCues();
        entry.trackEl = trackEl;
        entry.textTrack = trackEl.track;
      }

      function normSubLang(raw) {
        const s = String(raw || '').toLowerCase().trim();
        if (/^(por|pt|pt-pt|portugues)$/.test(s)) return 'por';
        if (/^(pob|pb|pt-br)$/.test(s)) return 'pob';
        if (/^(eng|en)$/.test(s)) return 'eng';
        if (/^(spa|es|esp)$/.test(s)) return 'spa';
        if (/^(fra|fre|fr)$/.test(s)) return 'fra';
        return s || 'und';
      }

      function appendSubtitleTrack(label, code, vttString, langCode, extraMeta) {
        const lang = normSubLang(langCode || String(code).split('-')[0]);
        const entry = {
          code,
          label,
          lang,
          isEmbedded: Boolean(extraMeta && extraMeta.isEmbedded),
          fromHashMatch: Boolean(extraMeta && extraMeta.fromHashMatch),
          vtt: vttString,
          offset: 0,
          scale: 1,
          map: null,
          trackEl: null,
          textTrack: null,
          url: null
        };
        state.subtitleTracks.push(entry);
        mountSubtitleTrack(entry, false);

        const opt = document.createElement('option');
        opt.value = code;
        opt.className = 'bg-slate-900';
        opt.textContent = label;
        el.subtitleTrackSelect.appendChild(opt);
        return entry;
      }

      function enforceSubtitleSelection(codeArg) {
        const code = codeArg || el.subtitleTrackSelect.value;
        const sel = code && code !== 'off' ? state.subtitleTracks.find(t => t.code === code) : null;
        const list = el.cineVideoPlayer.textTracks;
        for (let i = 0; i < list.length; i++) {
          const want = sel && sel.textTrack === list[i] ? 'showing' : 'disabled';
          if (list[i].mode !== want) list[i].mode = want;
        }
      }

      function getSubEpKey(c) {
        if (!c || !c.item) return '';
        return c.item.type === 'series'
          ? `ms_sub_ep_${c.item.imdbId}_S${c.season || 1}_E${c.episode || 1}`
          : `ms_sub_ep_${c.item.imdbId}`;
      }
      function getSubPref() {
        const c = state.playingContext;
        if (!c || !c.item) return null;
        const base = lsGet('ms_sub_' + c.item.imdbId, {}) || {};
        // Nunca aplica offsets antigos guardados em localStorage no arranque (todas as legendas arrancam a 0,0s como no Stremio Desktop)
        return { lang: base.lang, audioLang: base.audioLang };
      }
      function saveSubPref(patch) {
        const c = state.playingContext;
        if (!c || !c.item || !patch) return;
        const k = 'ms_sub_' + c.item.imdbId;
        const cur = lsGet(k, {}) || {};
        delete cur.offset;
        const nextSeries = { ...cur };
        if (patch.lang !== undefined) nextSeries.lang = patch.lang;
        if (patch.audioLang !== undefined) nextSeries.audioLang = patch.audioLang;
        lsSet(k, nextSeries);
        const ek = getSubEpKey(c);
        if (ek) { try { localStorage.removeItem(ek); } catch (e) {} }
      }

      function applySelectedSubtitleTrack(code, silent) {
        const selEntry = state.subtitleTracks.find(t => t.code === code);
        if (!silent) {
          state.activeSubManual = true;
          // Quando o utilizador muda manualmente de legenda (#1 -> #2 -> #3), arranca essa legenda limpa a 0,0s!
          if (selEntry) {
            selEntry.offset = 0;
            state.activeSubOffset = 0;
            mountSubtitleTrack(selEntry, true);
            setSubCalibBadge(selEntry.fromHashMatch ? '✓ Hash Exato' : (selEntry.isEmbedded ? '✓ Embutida Nativa' : ''), 'ok');
          }
          if (!String(code).startsWith('custom-')) {
            const resolvedLang = code === 'off' ? 'off' : normSubLang((selEntry && selEntry.lang) || String(code).split('-')[0]);
            if (resolvedLang === 'off' || ['por', 'pob', 'eng', 'spa'].includes(resolvedLang)) {
              saveSubPref({ lang: resolvedLang });
            }
          }
        }
        state.subtitleTracks.forEach(t => {
          if (t.textTrack) t.textTrack.mode = (code !== 'off' && t.code === code) ? 'showing' : 'disabled';
        });
        enforceSubtitleSelection(code);
        if (code !== 'off') state.lastSubCode = code;
        if (code === 'off') { state.activeSubCode = null; }
        else { state.activeSubCode = code; if (selEntry) state.activeSubOffset = selEntry.offset || 0; }
      }

      // Volta a montar a legenda escolhida (com o desvio guardado) depois de um seek/reinício, sem verificações de áudio
      function reapplyActiveSubtitle() {
        try {
          const code = state.activeSubCode;
          if (!code) return;
          const en = state.subtitleTracks.find(t => t.code === code);
          if (!en) return;
          if (state.activeSubOffset != null) en.offset = state.activeSubOffset;
          mountSubtitleTrack(en, true);
          el.subtitleTrackSelect.value = code;
          enforceSubtitleSelection(code);
        } catch (e) {}
      }

      function adjustSubtitleOffset(delta) {
        const code = el.subtitleTrackSelect.value;
        const entry = state.subtitleTracks.find(t => t.code === code);
        if (!entry) { showPlayerOsd('💬 Escolhe primeiro uma legenda'); return; }
        entry.offset = Math.round((entry.offset + delta) * 100) / 100;
        state.calibRunId = (state.calibRunId || 0) + 1; state.activeSubCode = code; state.activeSubOffset = entry.offset; state.activeSubManual = true;
        mountSubtitleTrack(entry, true);
        saveSubPref({ offset: entry.offset });
        showPlayerOsd(`💬 Sincronização: ${entry.offset > 0 ? '+' : ''}${entry.offset.toFixed(1)} s`);
      }

      function loadCustomSubtitleFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const raw = decodeSubtitleBuffer(reader.result);
          const vtt = /\.srt$/i.test(file.name) ? convertSrtToVtt(raw) : raw;
          const code = 'custom-' + Date.now();
          appendSubtitleTrack(`Ficheiro: ${file.name}`, code, vtt);
          el.subtitleTrackSelect.value = code;
          applySelectedSubtitleTrack(code);
          showToast(`Legenda carregada: ${file.name}`);
        };
        reader.readAsArrayBuffer(file);
      }

      // =======================================================================
      // ARQUITETURA LIMPA DE LEGENDAS (Baseada em Stremio opensubtitles-v3, Ventic, ffsubsync & FFmpeg silencedetect)
      // 1. Sem timers automáticos em background a mexer nos tempos durante a reprodução (arranca sempre a 0,0s intocado).
      // 2. Seleção determinística: Torrent .srt / Embutida PT -> MovieHash 64-bit (m==='h' / MatchedBy==='moviehash') -> Nome da Release (SubFileName) + Duração (Ventic).
      // 3. Botão manual 🎯 Auto (Tecla A): usa sobreposição binária de intervalos de fala (algoritmo ffsubsync + FFmpeg silencedetect / ReferenceSync) apenas na legenda ativa.
      // =======================================================================
      // @ss-begin
      const SS_STEP = 0.05; // 50ms bin (ffsubsync & plezy#2780)

      function ssParseCues(text, filterNonSpeech = true) {
        const rawAll = [];
        const speechOnly = [];
        const normTxt = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const blocks = normTxt.split(/\n{2,}/);
        const timeRe = /(?:(\d+):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{3})|(?:^|\n)(\d{1,2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2})[.,](\d{3}))/;
        const creditRe = /\b(traducao|tradução|traduzido\s+por|sincronizacao|sincronização|sincronizado\s+por|legendas?\s+por|subtitles?\s+by|synced\s+by|resync\s+by|opensubtitles|addic7ed|subscene|subdivx|www\.|https?:\/\/|\.com\b|\.org\b|\.net\b|vip\s+member|apoie-nos)\b/i;

        for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
          const blk = blocks[bIdx];
          const m = timeRe.exec(blk);
          if (!m) continue;
          const a = m[1] !== undefined
            ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000
            : (+m[9]) * 60 + (+m[10]) + (+m[11]) / 1000;
          const b = m[1] !== undefined
            ? (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000
            : (+m[12]) * 60 + (+m[13]) + (+m[14]) / 1000;
          if (!(b > a)) continue;
          rawAll.push([a, b]);

          if (!filterNonSpeech) continue;
          const dur = b - a;
          if (dur < 0.14 || dur > 14.5) continue;

          const body = blk.slice(m.index + m[0].length).replace(/<[^>]*>/g, ' ').replace(/\{\\[^}]*\}/g, ' ').trim();
          if (!body) continue;
          if (/[♪♫♬]/.test(body) || /^\s*#.*#\s*$/m.test(body)) continue;
          if (creditRe.test(body)) continue;

          const cleaned = body
            .replace(/\[[^\]]*\]/g, ' ')
            .replace(/\([^\)]*\)/g, ' ')
            .replace(/\{[^\}]*\}/g, ' ')
            .replace(/^[A-ZÀ-Ý0-9 _-]{2,20}:\s*/gm, ' ')
            .trim();
          if (!/[a-zA-ZÀ-ÿ0-9]/.test(cleaned)) continue;
          speechOnly.push([a, b]);
        }

        if (!filterNonSpeech) return rawAll;
        return speechOnly.length > 0 ? speechOnly : rawAll;
      }

      // Extrai o título base e a parte (1 ou 2) de episódios divididos no catálogo (ex: "Fun Run (1)" -> { baseTitle: "Fun Run", part: 1 })
      function ssParseSplitEpisodeTitle(title) {
        const raw = String(title || '').trim();
        const m = /^(.*?)(?:\s*[-–—:,]?\s*(?:\(\s*([12])\s*\)|\b(?:part|parte|pt\.?)\s*([12]|i{1,2})\b))\s*$/i.exec(raw);
        if (!m) return { baseTitle: raw, part: null };
        const pStr = (m[2] || m[3] || '').toLowerCase();
        const part = (pStr === '1' || pStr === 'i') ? 1 : ((pStr === '2' || pStr === 'ii') ? 2 : null);
        return { baseTitle: m[1].trim() || raw, part };
      }

      // Resolve automaticamente a diferença de numeração entre o catálogo TVDB/Cinemeta (que divide episódios de 40m em Parte 1 e Parte 2,
      // ex: The Office S04 com 19 episódios onde E01=E02 "Fun Run", E03=E04 "Dunder Mifflin Infinity", E05=E06 "Launch Party", E07=E08 "Money", E18=E19 "Goodbye, Toby")
      // e a numeração IMDb / BluRay / OpenSubtitles (onde cada episódio duplo de 40m conta como 1 único episódio: 1..14)!
      function ssResolveEpisodeMapping(epList, season, episode, episodeTitle, refFileName) {
        const sTarget = Number(season) || 1;
        const eTarget = Number(episode) || 1;
        const norm = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        const list = Array.isArray(epList) ? [...epList].sort((a, b) => Number(a.episode) - Number(b.episode)) : [];

        const units = [];
        for (let i = 0; i < list.length; i++) {
          const cur = list[i];
          const nxt = list[i + 1];
          const p1 = ssParseSplitEpisodeTitle(cur.title);
          const p2 = nxt ? ssParseSplitEpisodeTitle(nxt.title) : null;
          const sameAirDate = !cur.released || !nxt || !nxt.released || cur.released === nxt.released;
          if (p1.part === 1 && p2 && p2.part === 2 && norm(p1.baseTitle) && norm(p1.baseTitle) === norm(p2.baseTitle) && sameAirDate) {
            units.push({
              dvdEp: units.length + 1,
              pairEps: [Number(cur.episode), Number(nxt.episode)],
              baseTitle: p1.baseTitle,
              normTitle: norm(p1.baseTitle)
            });
            i++; // salta a Parte 2 já fundida neste episódio duplo de 40m
          } else {
            units.push({
              dvdEp: units.length + 1,
              pairEps: [Number(cur.episode)],
              baseTitle: p1.baseTitle || cur.title || `Episódio ${cur.episode}`,
              normTitle: norm(p1.baseTitle || cur.title || '')
            });
          }
        }

        // Verifica também se o próprio nome do ficheiro de vídeo tem código multi-episódio explícito (ex: S04E01E02 ou S04E03-E04)
        const fileMultiEps = [];
        const reMulti = /\bs0*(\d{1,2})[._\s-]*e0*(\d{1,3})(?:[._\s-]*(?:e|ep)0*(\d{1,3})|\s*-\s*0*(\d{1,3}))\b/gi;
        let mm;
        while ((mm = reMulti.exec(String(refFileName || '')))) {
          if (parseInt(mm[1], 10) === sTarget) {
            const a = parseInt(mm[2], 10);
            const b = parseInt(mm[3] || mm[4], 10);
            if (a > 0 && b >= a && b - a <= 3) {
              for (let k = a; k <= b; k++) fileMultiEps.push(k);
            }
          }
        }

        const matchedUnit = units.find(u => u.pairEps.includes(eTarget));
        if (!matchedUnit) {
          const fallbackParsed = ssParseSplitEpisodeTitle(episodeTitle);
          const allowed = Array.from(new Set([eTarget, ...fileMultiEps]));
          return {
            dvdEp: eTarget,
            primaryTvdbEp: allowed[0] || eTarget,
            pairEps: allowed,
            allowedEps: allowed,
            isMergedPair: allowed.length > 1,
            isSecondHalf: allowed.length > 1 && eTarget === allowed[1],
            hasSeasonShift: false,
            baseTitle: fallbackParsed.baseTitle || episodeTitle || '',
            otherBaseTitles: []
          };
        }

        const pairEps = Array.from(new Set([...matchedUnit.pairEps, ...fileMultiEps])).sort((a, b) => a - b);
        const dvdEp = matchedUnit.dvdEp;
        const primaryTvdbEp = pairEps[0];
        const hasSeasonShift = Boolean(dvdEp !== eTarget || pairEps.length > 1 || units.some(u => u.pairEps.length > 1));
        const allowedEps = Array.from(new Set([dvdEp, ...pairEps]));
        const otherBaseTitles = units
          .filter(u => u !== matchedUnit && u.normTitle && u.normTitle.length >= 4 && u.normTitle !== matchedUnit.normTitle)
          .map(u => u.baseTitle);

        return {
          dvdEp,
          primaryTvdbEp,
          pairEps,
          allowedEps,
          isMergedPair: matchedUnit.pairEps.length > 1,
          isSecondHalf: matchedUnit.pairEps.length > 1 && eTarget === matchedUnit.pairEps[1],
          hasSeasonShift,
          baseTitle: matchedUnit.baseTitle,
          otherBaseTitles
        };
      }

      // Deteta se o nome do ficheiro ou linha de créditos pertence a outro episódio (suportando episódios duplos S04E01E02 e mapeamento DVD/TVDB)
      // IMPORTANTE: Nunca procura títulos de outros episódios no meio das falas do diálogo (apenas no nome do ficheiro subMetaName)!
      function ssInspectEpisode(subText, subMetaName, season, episode, episodeTitle, otherEpTitles, allowedEpsArg) {
        const sTarget = Number(season);
        const eTarget = Number(episode);
        if (!Number.isInteger(sTarget) || !Number.isInteger(eTarget) || sTarget < 1 || eTarget < 1) {
          return { wrongEpisode: false, exactEpMatch: false, epTitleMatch: false, scoreDelta: 0 };
        }
        const allowedSet = new Set(
          Array.isArray(allowedEpsArg) && allowedEpsArg.length
            ? allowedEpsArg.map(Number).filter(n => Number.isInteger(n) && n > 0)
            : [eTarget]
        );
        const norm = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const metaNorm = norm(String(subMetaName || ''));
        const shortCredits = norm(String(subText || '').slice(0, 280) + ' \n ' + String(subText || '').slice(-280))
          .replace(/\d+:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d+:\d{2}:\d{2}[.,]\d{3}/g, ' ');
        const combined = metaNorm + ' \n ' + shortCredits;

        let exactEpMatch = false;
        let conflictingExplicit = false;

        // Suporta códigos simples e duplos: S04E01, S04E01E02, S04E01-E02, S04E01-02, 4x01-02
        const reSE = /\bs0*(\d{1,2})[._\s-]*e0*(\d{1,3})(?:(?:[._\s-]*(?:e|ep)0*(\d{1,3})|\s*-\s*0*(\d{1,3}))(?:[._\s-]*(?:e|ep)0*(\d{1,3}))?)?\b/gi;
        let m;
        while ((m = reSE.exec(combined))) {
          const s = parseInt(m[1], 10);
          const epsFound = [parseInt(m[2], 10)];
          const e2Str = m[3] || m[4];
          if (e2Str) {
            const e2 = parseInt(e2Str, 10);
            if (e2 >= epsFound[0] && e2 - epsFound[0] <= 4) {
              for (let k = epsFound[0] + 1; k <= e2; k++) epsFound.push(k);
            } else if (e2 > 0) epsFound.push(e2);
          }
          if (m[5]) epsFound.push(parseInt(m[5], 10));
          if (s === sTarget && epsFound.some(e => allowedSet.has(e))) exactEpMatch = true;
          else if (s > 0 && epsFound[0] > 0) conflictingExplicit = true;
        }

        const reX = /\b0*(\d{1,2})x0*(\d{2,3})(?:[._\s-]*(?:x)?0*(\d{2,3}))?\b/gi;
        while ((m = reX.exec(combined))) {
          const s = parseInt(m[1], 10);
          const epsFound = [parseInt(m[2], 10)];
          if (m[3]) epsFound.push(parseInt(m[3], 10));
          if (s === sTarget && epsFound.some(e => allowedSet.has(e))) exactEpMatch = true;
          else if (s > 0 && epsFound[0] > 0) conflictingExplicit = true;
        }

        const reVerbose = /\b(?:season|temporada)\s*0*(\d{1,2})[\s,.:;-]*(?:episode|episodio|ep\.? )\s*0*(\d{1,3})\b/gi;
        while ((m = reVerbose.exec(combined))) {
          const s = parseInt(m[1], 10);
          const e = parseInt(m[2], 10);
          if (s === sTarget && allowedSet.has(e)) exactEpMatch = true;
          else if (s > 0 && e > 0) conflictingExplicit = true;
        }

        let conflictingStandalone = false;
        if (metaNorm && !exactEpMatch && !conflictingExplicit) {
          const reStandalone = /\b(?:episode|episodio|ep\.?)\s*0*(\d{1,3})\b/gi;
          let ms;
          while ((ms = reStandalone.exec(metaNorm))) {
            const e = parseInt(ms[1], 10);
            if (allowedSet.has(e)) exactEpMatch = true;
            else if (e > 0 && e < 200) conflictingStandalone = true;
          }
        }

        // Verifica títulos de episódios ESTRITAMENTE no nome do ficheiro da legenda (metaWords), NUNCA no diálogo!
        let epTitleMatch = false;
        let otherMetaTitleConflict = false;
        const metaWords = metaNorm.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        const parsedTargetTitle = ssParseSplitEpisodeTitle(episodeTitle);
        const cleanEpTitle = norm(parsedTargetTitle.baseTitle || episodeTitle || '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (metaWords && cleanEpTitle.length >= 4 && !/^(?:episodio|episode|ep|parte|part)\s*\d+$/.test(cleanEpTitle)) {
          if (metaWords.includes(cleanEpTitle)) epTitleMatch = true;
        }
        if (metaWords && Array.isArray(otherEpTitles) && otherEpTitles.length) {
          for (const ot of otherEpTitles) {
            const parsedOt = ssParseSplitEpisodeTitle(ot);
            const cleanOt = norm(parsedOt.baseTitle || ot || '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanOt.length >= 5 && cleanOt !== cleanEpTitle && !/^(?:episodio|episode|ep|parte|part)\s*\d+$/.test(cleanOt)) {
              if (metaWords.includes(cleanOt) && !epTitleMatch) {
                otherMetaTitleConflict = true;
                break;
              }
            }
          }
        }

        const wrongEpisode = Boolean(otherMetaTitleConflict || (conflictingExplicit && !exactEpMatch && !epTitleMatch) || (conflictingStandalone && !exactEpMatch && !epTitleMatch));
        const scoreDelta = wrongEpisode ? -1000 : ((exactEpMatch ? 24 : 0) + (epTitleMatch ? 30 : 0));
        return { wrongEpisode, exactEpMatch, epTitleMatch, scoreDelta };
      }

      // Extrai uma etiqueta limpa da release (ex: "AMZN•WEB-DL•NTb", "BluRay") a partir de SubFileName/MovieReleaseName
      function ssExtractReleaseTag(subMetaName) {
        const s = String(subMetaName || '').replace(/\.(srt|vtt|sub|gz)$/i, '').trim();
        if (!s || /^https?:\/\//i.test(s) || /^\d+$/.test(s)) return '';
        const tags = [];
        const plat = /\b(AMZN|PMTP|NF|ATVP|HMAX|DSNP|HULU|PCOK|STAN|BBC|ITV)\b/i.exec(s);
        if (plat) tags.push(plat[1].toUpperCase());
        const srcType = /\b(WEB[-_.]?DL|WEBRip|BluRay|BDRip|BRRip|HDTV|DVDRip)\b/i.exec(s);
        if (srcType) tags.push(srcType[1].replace(/[-_.]/g, '-').toUpperCase());
        const grp = /-([A-Za-z0-9]{2,12})$/.exec(s);
        if (grp && !/^(por|pob|eng|srt|vtt|dl|rip|x264|x265|hevc|h264|1080p|720p|2160p)$/i.test(grp[1])) {
          tags.push(grp[1]);
        }
        return tags.join('•').slice(0, 22);
      }

      // Pontuação determinística estilo Stremio Desktop + Ventic:
      // 1) Hash Binário Exato (m===h / MatchedBy===moviehash) tem prioridade absoluta (+500).
      // 2) Similaridade de Release é comparada APENAS contra subMetaName (nunca contra o texto das falas!).
      // 3) Preserva a ordem nativa devolvida pelo opensubtitles-v3.strem.io (sourceIndex) quando subMetaName está vazio!
      function ssScoreSubtitle(subText, subMetaName, refVideoName, fromFileMatch, season, episode, episodeTitle, otherEpTitles, cues, videoDur = 0, fromHashMatch = false, sourceIndex = 0, allowedEpsArg = null) {
        const epInfo = ssInspectEpisode(subText, subMetaName, season, episode, episodeTitle, otherEpTitles, allowedEpsArg);
        if (epInfo.wrongEpisode) {
          return { ...epInfo, totalScore: -1000, releaseTag: '' };
        }
        // Preserva a ordem oficial do Stremio (sourceIndex = 0 tem o bónus mais alto dentro do mesmo escalão)
        const orderBonus = Math.max(0, 40 - (Number(sourceIndex) || 0) * 3);
        let score = epInfo.scoreDelta + (fromHashMatch ? 500 : 0) + (fromFileMatch ? 25 : 0) + orderBonus;

        const metaLower = String(subMetaName || '').toLowerCase();
        const refLower = String(refVideoName || '').toLowerCase();

        if (metaLower && refLower) {
          // 1. Plataforma e tipo de fonte (AMZN, PMTP, NF, PCOK, WEB-DL vs BluRay vs HDTV) APENAS no nome da release!
          const platforms = ['amzn', 'amazon', 'pmtp', 'paramount', 'nf', 'netflix', 'atvp', 'apple', 'hmax', 'dsnp', 'disney', 'hulu', 'pcok', 'peacock'];
          platforms.forEach(p => {
            if (refLower.includes(p) && metaLower.includes(p)) score += 22;
          });

          const isVideoWeb = /web[-_. ]?dl|webrip|amzn|pmtp|nf|atvp|hmax|dsnp|pcok/i.test(refLower);
          const isSubWeb = /web[-_. ]?dl|webrip|amzn|pmtp|nf|atvp|hmax|dsnp|pcok/i.test(metaLower);
          const isSubHdtvOrBd = /\b(hdtv|bluray|bdrip|brrip|dvdrip)\b/i.test(metaLower) && !isSubWeb;
          const isVideoBd = /\b(bluray|bdrip|brrip)\b/i.test(refLower);
          const isSubBd = /\b(bluray|bdrip|brrip)\b/i.test(metaLower);
          if (isVideoWeb && isSubWeb) score += 18;
          if (isVideoBd && isSubBd) score += 18;
          if (isVideoWeb && isSubHdtvOrBd) score -= 20;

          // Penaliza fortemente legendas Extended / Superfan quando o vídeo não é Extended / Superfan
          const isVideoExt = /\b(extended|superfan|uncut)\b/i.test(refLower);
          const isSubExt = /\b(extended|superfan|uncut)\b/i.test(metaLower);
          if (isVideoExt !== isSubExt) score -= 180;

          // 2. Grupo de release (ex: -NTb, -FLUX, -FENiX, -DEMAND)
          const refGrp = /-([a-z0-9]{2,12})(?:\.[a-z0-9]{2,4})?$/i.exec(refLower);
          if (refGrp && refGrp[1] && metaLower.includes(refGrp[1].toLowerCase())) {
            score += 40;
          }

          const relTokens = refLower.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/^(the|and|mkv|mp4|avi|1080p|2160p|720p|480p|x264|x265|hevc|h264|h265|aac|ddp5|eac3|ac3|web|dl|rip|proper|repack)$/.test(w));
          relTokens.forEach(tk => {
            if (metaLower.includes(tk)) score += 3;
          });
        }

        // 3. Cobertura temporal do vídeo (método Ventic: descarta cortes Extended/Superfan quando a duração real do vídeo é conhecida)
        const cueCount = Array.isArray(cues) ? cues.length : 0;
        if (cueCount < 12) score -= 60;
        else if (cueCount >= 40) score += 6;

        if (videoDur > 300 && cueCount >= 12) {
          const lastCueEnd = cues[cues.length - 1][1];
          const ratio = lastCueEnd / videoDur;
          if (ratio >= 0.80 && ratio <= 1.02) {
            score += 30;
          } else if (ratio > 1.05 || ratio < 0.55) {
            score -= 140;
          }
        }

        return { ...epInfo, totalScore: score, releaseTag: ssExtractReleaseTag(subMetaName) };
      }

      // Algoritmo de sincronização por sobreposição binária de intervalos de fala (smacke/ffsubsync & edde746/plezy#2780):
      // Discretiza em janelas de 50ms e calcula: (# frames fala=1 & legenda=1) - (# frames silêncio=0 & legenda=1).
      function ssSyncToIntervals(cues, speechIntervals, winStart = 0, winDur = 90, maxOffset = 15) {
        if (!Array.isArray(cues) || !Array.isArray(speechIntervals) || cues.length < 5 || speechIntervals.length < 3) {
          return { ok: false, offset: 0, score: 0, confidence: 0 };
        }
        const N = Math.max(100, Math.round(winDur / SS_STEP));
        // speechMask: +1 onde há fala detetada, -1 onde há silêncio (fórmula exata do ffsubsync)
        const speechMask = new Int8Array(N);
        speechMask.fill(-1);
        let activeSpeechBins = 0;
        for (let i = 0; i < speechIntervals.length; i++) {
          const a = speechIntervals[i][0] - winStart;
          const b = speechIntervals[i][1] - winStart;
          if (b <= 0 || a >= winDur) continue;
          const k0 = Math.max(0, Math.floor(a / SS_STEP));
          const k1 = Math.min(N - 1, Math.ceil(b / SS_STEP));
          for (let k = k0; k <= k1; k++) {
            if (speechMask[k] !== 1) {
              speechMask[k] = 1;
              activeSpeechBins++;
            }
          }
        }
        if (activeSpeechBins < N * 0.05 || activeSpeechBins > N * 0.95) {
          return { ok: false, offset: 0, score: 0, confidence: 0 };
        }

        // Pré-filtra apenas as cues que podem cair na janela [winStart - maxOffset, winStart + winDur + maxOffset]
        const winCues = cues.filter(c => c[1] >= winStart - maxOffset - 2 && c[0] <= winStart + winDur + maxOffset + 2);
        if (winCues.length < 8) {
          return { ok: false, offset: 0, score: 0, confidence: 0 };
        }

        const numSteps = Math.round((maxOffset * 2) / SS_STEP) + 1;
        const scores = new Float32Array(numSteps);
        let bestIdx = 0, bestScore = -1e9;

        for (let di = 0; di < numSteps; di++) {
          const d = -maxOffset + di * SS_STEP;
          let rawSum = 0, cueBins = 0;
          for (let i = 0; i < winCues.length; i++) {
            const a = (winCues[i][0] + d) - winStart;
            const b = (winCues[i][1] + d) - winStart;
            if (b <= 0 || a >= winDur) continue;
            const k0 = Math.max(0, Math.floor(a / SS_STEP));
            const k1 = Math.min(N - 1, Math.ceil(b / SS_STEP));
            for (let k = k0; k <= k1; k++) {
              rawSum += speechMask[k];
              cueBins++;
            }
          }
          const sc = cueBins >= 20 ? (rawSum / Math.sqrt(cueBins)) : -1e6;
          scores[di] = sc;
          if (sc > bestScore) {
            bestScore = sc;
            bestIdx = di;
          }
        }

        // Verifica se o melhor pico se destaca claramente do segundo melhor fora de ±1.5s (regra plezy#2780)
        const excl = Math.round(1.5 / SS_STEP);
        let runnerUp = -1e9, bgSum = 0, bgCnt = 0;
        for (let di = 0; di < numSteps; di++) {
          if (Math.abs(di - bestIdx) > excl && scores[di] > -1e5) {
            if (scores[di] > runnerUp) runnerUp = scores[di];
            bgSum += scores[di];
            bgCnt++;
          }
        }
        const bgMean = bgCnt > 0 ? bgSum / bgCnt : 0;
        const confidence = bestScore > 0 ? (bestScore - Math.max(0, runnerUp)) / Math.max(1, bestScore - bgMean) : 0;
        const bestOffset = +((-maxOffset + bestIdx * SS_STEP).toFixed(2));
        const ok = Boolean(bestScore > 1.5 && confidence >= 0.12);
        return { ok, offset: bestOffset, score: +bestScore.toFixed(2), confidence: +confidence.toFixed(3) };
      }
      // @ss-end

      // Carrega legendas de texto embutidas no próprio ficheiro MKV/MP4
      async function loadEmbeddedSubtitlesFromTracks(info, subsList) {
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        if (!E || !info || !Array.isArray(subsList) || !subsList.length) return;
        const myToken = state.subToken;
        const prefOrder = ['por', 'pt', 'pob', 'pb', 'eng', 'en', 'spa', 'es', 'und'];
        const picked = subsList
          .filter(s => !s.forced && (prefOrder.includes(s.lang) || subsList.length <= 4))
          .sort((a, b) => {
            const ia = prefOrder.indexOf(a.lang), ib = prefOrder.indexOf(b.lang);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          })
          .slice(0, 5);
        for (const s of picked) {
          if (myToken !== state.subToken) return;
          const code = `emb-${s.n}`;
          if (state.subtitleTracks.some(t => t.code === code)) continue;
          try {
            const r = await fetch(`${E}/sub/${info.infoHash}/${info.fileIdx}/${s.n}`);
            if (!r.ok || myToken !== state.subToken) continue;
            const raw = await r.text();
            if (!raw || !raw.includes('-->')) continue;
            const vtt = /^\s*WEBVTT/.test(raw) ? raw : convertSrtToVtt(raw);
            const normLang = normSubLang(s.lang);
            const lname = LANG_PT[s.lang] || s.title || s.lang.toUpperCase();
            const label = `📦 Embutida: ${lname}${s.title && s.title !== lname ? ' (' + s.title.slice(0, 18) + ')' : ''}`;
            appendSubtitleTrack(label, code, vtt, normLang, { isEmbedded: true });
            const sp0 = getSubPref() || {};
            if (sp0.lang !== 'off' && !state.activeSubManual && (el.subtitleTrackSelect.value === 'off' || /^eng-/.test(el.subtitleTrackSelect.value)) && (normLang === 'por' || normLang === 'pob')) {
              el.subtitleTrackSelect.value = code;
              applySelectedSubtitleTrack(code, true);
              setSubCalibBadge('✓ Embutida Nativa', 'ok');
              showToast(`💬 ${label} ativada!`);
            }
          } catch (e) {}
        }
      }

      function updateSubtitleOptionLabel(code, newLabel) {
        const tr = state.subtitleTracks.find(t => t.code === code);
        if (tr) tr.label = newLabel;
        const opt = Array.from(el.subtitleTrackSelect.options || []).find(o => o.value === code);
        if (opt) opt.textContent = newLabel;
      }

      // Botão manual 🎯 Auto (Tecla A): usa ffsubsync (sobreposição binária com legenda de referência embutida/Hash Exato ou FFmpeg silencedetect)
      // NUNCA corre sozinho no arranque e NUNCA muda de faixa ou de idioma!
      async function calibrateActiveSubtitleNow() {
        const info = state.engineInfo;
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        const code = el.subtitleTrackSelect.value;
        const entry = state.subtitleTracks.find(t => t.code === code);
        if (!entry || code === 'off') {
          showPlayerOsd('💬 Escolhe primeiro uma legenda para sincronizar');
          return;
        }
        if (!E || !info || !info.infoHash) {
          showPlayerOsd('💬 Usa −0,5s / +0,5s (teclas G / H) para ajustar neste modo');
          return;
        }

        const myToken = state.subToken;
        const cues = ssParseCues(entry.vtt || '');
        if (cues.length < 8) {
          showPlayerOsd('💬 Esta legenda tem poucas linhas para sincronização automática');
          return;
        }

        setSubCalibBadge('🎯 A alinhar com as falas…', 'work');
        showPlayerOsd('🎯 A detetar intervalos de fala (silencedetect)…');

        try {
          const cur = Math.max(10, Math.floor(pbCur() || 30));
          const dur = pbDur() || 2400;
          let winStart = Math.max(10, Math.min(Math.max(15, dur - 100), cur > 45 ? cur - 30 : 30));
          let winDur = 90;

          // 1. Se existir uma legenda embutida (emb-*) ou uma legenda com Hash Exato (m===h) noutra língua,
          // usa os intervalos de fala dela como referência 100% imune a música/genéricos (alass / ffsubsync ReferenceSync)!
          let speechIntervals = null;
          const refTrack = (state.subtitleTracks || []).find(t => t.code !== entry.code && t.vtt && (t.isEmbedded || t.fromHashMatch));
          if (refTrack) {
            const refCues = ssParseCues(refTrack.vtt, true);
            const inWin = refCues.filter(c => c[1] >= winStart && c[0] <= winStart + winDur);
            if (inWin.length >= 10) {
              speechIntervals = refCues;
            }
          }

          // 2. Caso contrário, usa o filtro nativo silencedetect do FFmpeg (que ignora blocos contínuos de música > 8.5s)
          if (!speechIntervals) {
            const audioIdx = (state.compat && state.compat.audio) || state.pendingAudio || 0;
            const r = await fetch(`${E}/silencedetect/${info.infoHash}/${info.fileIdx}?start=${winStart}&dur=${winDur}&audio=${audioIdx}`);
            if (r.ok) {
              const d = await r.json();
              if (d && d.ok && Array.isArray(d.intervals) && d.intervals.length >= 3) {
                speechIntervals = d.intervals;
              }
            }
          }

          if (myToken !== state.subToken) return;
          if (!speechIntervals || speechIntervals.length < 3) {
            setSubCalibBadge('⚠ Pouca fala nesta cena', 'warn');
            showPlayerOsd('💬 Pouca fala nesta cena — avança para um diálogo ou usa G / H (±0,5s)');
            return;
          }

          const syncRes = ssSyncToIntervals(cues, speechIntervals, winStart, winDur, 15);
          if (!syncRes.ok) {
            setSubCalibBadge('⚠ Sem desvio claro', 'warn');
            showPlayerOsd('💬 Não detetei um desvio claro nesta cena — usa G / H (±0,5s)');
            return;
          }

          const newOff = Math.abs(syncRes.offset) >= 0.15 ? syncRes.offset : 0;
          entry.offset = newOff;
          state.activeSubCode = entry.code;
          state.activeSubOffset = newOff;
          state.activeSubManual = true;
          remountAllSubtitles();

          const offTag = newOff !== 0 ? `${newOff > 0 ? '+' : ''}${newOff.toFixed(1)}s` : '0,0s';
          setSubCalibBadge(`✓ Alinhada (${offTag})`, 'ok');
          showPlayerOsd(`🎯 Legenda alinhada com a fala: ${offTag}`);
        } catch (e) {
          setSubCalibBadge('');
          showPlayerOsd('💬 Falha ao analisar áudio — usa G / H (±0,5s)');
        }
      }

      // Carrega as legendas exatamente como o Stremio Desktop (opensubtitles-v3.strem.io + /opensubs REST):
      // 1) Ficheiros .srt dentro do torrent
      // 2) Add-on oficial opensubtitles-v3.strem.io (preservando a ordem exata do Stremio e m===h)
      // 3) API REST direta /opensubs no engine.js (que enriquece SubFileName/MovieReleaseName e MatchedBy=moviehash)
      async function loadOnlineSubtitles(ctx, extra) {
        const { item, season, episode, episodeTitle } = ctx;
        if (!item || !item.imdbId || !item.imdbId.startsWith('tt')) return;
        const engineMode = Boolean(window.macstreamApp && ctx.stream && !ctx.stream.directUrl);
        if (!extra && engineMode) return;
        clearSubtitleTracks();
        const myToken = state.subToken;
        const sNum = item.type === 'series' ? (Number(season) || 1) : null;
        const eNum = item.type === 'series' ? (Number(episode) || 1) : null;
        const vid = item.type === 'series' ? `${item.imdbId}:${sNum}:${eNum}` : item.imdbId;
        const langNames = { por: 'Português (PT)', pob: 'Português (BR)', eng: 'English' };
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        const info = state.engineInfo;

        if (item.type === 'series' && (!state.episodesCache[item.imdbId] || !state.episodesCache[item.imdbId][sNum])) {
          try { await getSeriesEpisodesMap(item); } catch (e) {}
          if (myToken !== state.subToken) return;
        }
        const epMap = item.type === 'series' ? (state.episodesCache[item.imdbId] || (state.cwMaps && state.cwMaps[item.imdbId])) : null;
        const seasonEpList = (epMap && Array.isArray(epMap[sNum])) ? epMap[sNum] : [];
        let resolvedEpTitle = episodeTitle || '';
        if (item.type === 'series' && !resolvedEpTitle && seasonEpList.length) {
          const epFound = seasonEpList.find(ep => Number(ep.episode) === eNum);
          if (epFound && epFound.title) resolvedEpTitle = epFound.title;
        }

        const refName = (extra && extra.filename) || (info && info.name) || (ctx.stream && (ctx.stream.filename || ctx.stream.title)) || '';
        const epMapping = item.type === 'series'
          ? ssResolveEpisodeMapping(seasonEpList, sNum, eNum, resolvedEpTitle, refName)
          : null;
        const openSubsEp = epMapping ? epMapping.dvdEp : eNum;
        const allowedEps = epMapping ? epMapping.allowedEps : (eNum ? [eNum] : []);
        const cleanBaseTitle = epMapping ? epMapping.baseTitle : resolvedEpTitle;
        const otherBaseTitles = epMapping ? epMapping.otherBaseTitles : [];

        // Atualiza o cabeçalho do player quando estamos num episódio duplo fundido (ex: S04E01-E02 — Fun Run)
        if (epMapping && epMapping.isMergedPair && el.playerTitle) {
          const p0 = pad2(epMapping.pairEps[0]);
          const p1 = pad2(epMapping.pairEps[epMapping.pairEps.length - 1]);
          el.playerTitle.textContent = `${item.title} • S${pad2(sNum)}E${p0}-E${p1} — ${epMapping.baseTitle}`;
        }

        const cands = [];

        // 1. Ficheiros .srt/.vtt dentro da pasta do próprio torrent (já cortados para aquela release!)
        if (E && info && extra && Array.isArray(extra.externalSubs) && extra.externalSubs.length) {
          for (const es of extra.externalSubs.slice(0, 6)) {
            if (item.type === 'series') {
              const nameCheck = ssInspectEpisode('', es.name, sNum, openSubsEp, cleanBaseTitle, otherBaseTitles, allowedEps);
              if (nameCheck.wrongEpisode) continue;
            }
            try {
              const r = await fetch(`${E}/extsub/${info.infoHash}/${es.fileIdx}`);
              if (r.ok && myToken === state.subToken) {
                const raw = decodeSubtitleBuffer(await r.arrayBuffer());
                const vtt = /^\s*WEBVTT/.test(raw) ? raw : convertSrtToVtt(raw);
                const cues = ssParseCues(vtt);
                if (cues.length >= 5) {
                  const sc = ssScoreSubtitle(raw, es.name, refName, true, sNum, openSubsEp, cleanBaseTitle, otherBaseTitles, cues, 0, true, 0, allowedEps);
                  if (sc.wrongEpisode) continue;
                  const code = `tor-${es.fileIdx}`;
                  const shortName = es.name.split('/').pop().replace(/\.(srt|vtt)$/i, '').slice(-28);
                  const isPt = /por|portug|pt[-_.]?(?:pt|br)|pob/i.test(es.name);
                  const trLang = isPt ? 'por' : 'eng';
                  const label = `🧲 Torrent: ${shortName}`;
                  appendSubtitleTrack(label, code, vtt, trLang, { fromHashMatch: true });
                  cands.push({ code, lang: trLang, vtt, label, cues, relScore: sc.totalScore + 50, fromFileMatch: true, fromHashMatch: true, wrongEpisode: false });
                }
              }
            } catch (e) {}
          }
        }

        // 2. Obtém o videoHash OSDB de 64 bits (do behaviorHints do stream, da cache em disco ou do endpoint /videohash)
        let vHash = (extra && extra.videoHash) || (info && info.videoHash) || (ctx.stream && ctx.stream.videoHash) || null;
        if (!vHash && E && info && info.infoHash && Number.isInteger(info.fileIdx)) {
          try {
            const hr = await fetch(`${E}/videohash/${info.infoHash}/${info.fileIdx}?timeout=2200`);
            if (hr.ok) {
              const hd = await hr.json();
              if (hd && hd.ok && hd.videoHash) {
                vHash = hd.videoHash;
                info.videoHash = vHash;
              }
            }
          } catch (e) {}
          if (myToken !== state.subToken) return;
        }

        const vSize = (extra && extra.size) || (info && info.length) || (ctx.stream && ctx.stream.videoSize) || 0;
        const cleanFileName = (extra && extra.filename) || (info && info.name) || (ctx.stream && ctx.stream.filename) || '';
        const buildStremioPath = (hashVal, sizeVal, nameVal) => {
          const params = [];
          if (hashVal) params.push(`videoHash=${encodeURIComponent(hashVal)}`);
          if (hashVal && sizeVal > 0) params.push(`videoSize=${encodeURIComponent(String(sizeVal))}`);
          if (nameVal) {
            const fnCheck = item.type === 'series' ? ssInspectEpisode('', nameVal, sNum, openSubsEp, cleanBaseTitle, [], allowedEps) : { wrongEpisode: false };
            if (!fnCheck.wrongEpisode) params.push(`filename=${encodeURIComponent(nameVal)}`);
          }
          return params.length ? `/${params.join('&')}` : '';
        };
        const stremioQueryPath = buildStremioPath(vHash, vSize, cleanFileName);

        try {
          // Usa openSubsEp (numeração colapsada IMDb/DVD quando existem episódios duplos Parte 1 + Parte 2!)
          const openSubsVid = item.type === 'series' ? `${item.imdbId}:${sNum}:${openSubsEp}` : item.imdbId;
          const base = `${OPENSUBS_URL}/subtitles/${item.type}/${openSubsVid}`;
          const getStremioList = async (p) => {
            try { const r = await fetch(`${base}${p}.json`); if (!r.ok) return []; const d = await r.json(); return Array.isArray(d.subtitles) ? d.subtitles : []; } catch (e) { return []; }
          };
          const getDirectRestList = async (hashVal) => {
            if (!E) return [];
            try {
              const q = new URLSearchParams({ imdbId: item.imdbId });
              if (sNum) q.set('season', String(sNum));
              if (openSubsEp) q.set('episode', String(openSubsEp));
              if (allowedEps && allowedEps.length > 1) q.set('altEpisodes', allowedEps.join(','));
              if (hashVal) q.set('videoHash', hashVal);
              if (vSize) q.set('videoSize', String(vSize));
              const r = await fetch(`${E}/opensubs?${q.toString()}`);
              if (!r.ok) return [];
              const d = await r.json();
              return (d && d.ok && Array.isArray(d.subtitles)) ? d.subtitles : [];
            } catch (e) { return []; }
          };

          const [stremioWithParams, directRest, stremioPlain] = await Promise.all([
            stremioQueryPath ? getStremioList(stremioQueryPath) : Promise.resolve([]),
            getDirectRestList(vHash),
            getStremioList('')
          ]);
          if (myToken !== state.subToken) return;

          // Mapeia metadados da API REST por ID para enriquecer os itens do opensubtitles-v3.strem.io sem alterar a ordem oficial do Stremio!
          const restById = new Map();
          directRest.forEach(s => {
            if (s && s.id) restById.set(String(s.id), s);
          });

          const mergedSubs = [];
          const seenIds = new Set();
          const addSubItem = (s, isFromRest) => {
            if (!s || !s.url) return;
            const idKey = String(s.id || s.url);
            if (seenIds.has(idKey)) return;
            seenIds.add(idKey);
            const restMeta = !isFromRest ? restById.get(idKey) : s;
            const subFileName = (restMeta && restMeta.SubFileName) || s.SubFileName || '';
            const movieReleaseName = (restMeta && restMeta.MovieReleaseName) || s.MovieReleaseName || '';
            const isExactHash = isFromRest
              ? (s.MatchedBy === 'moviehash' || Boolean(vHash && s.MovieHash === vHash))
              : (Boolean(vHash && s.m === 'h') || Boolean(restMeta && (restMeta.MatchedBy === 'moviehash' || (vHash && restMeta.MovieHash === vHash))));
            const isFileSuggested = isExactHash || Boolean(subFileName || movieReleaseName);
            mergedSubs.push({
              id: idKey,
              lang: normSubLang(s.lang),
              url: s.url,
              metaName: [subFileName, movieReleaseName].filter(Boolean).join(' '),
              fromHashMatch: isExactHash,
              fromFileMatch: isFileSuggested,
              hearingImpaired: Boolean(s.SubHearingImpaired || (restMeta && restMeta.SubHearingImpaired))
            });
          };

          // Prioriza a lista oficial do opensubtitles-v3.strem.io (na ordem exata do Stremio Desktop!) seguida da REST direta
          stremioWithParams.forEach(s => addSubItem(s, false));
          directRest.forEach(s => addSubItem(s, true));
          stremioPlain.forEach(s => addSubItem(s, false));

          const chosen = [];
          [['por', 10], ['pob', 6], ['eng', 4]].forEach(([lang, n]) => {
            mergedSubs.filter(s => s.lang === lang).slice(0, n).forEach((s, langIdx) => chosen.push({ ...s, langOrderIdx: langIdx }));
          });

          const texts = await Promise.all(chosen.map(async c => {
            try { const r = await fetch(c.url); return r.ok ? decodeSubtitleBuffer(await r.arrayBuffer()) : null; } catch (e) { return null; }
          }));
          if (myToken !== state.subToken) return;

          const sp0 = getSubPref() || {};
          const wantLang = sp0.lang && sp0.lang !== 'off' ? sp0.lang : 'por';
          // Usa apenas a duração real sondada do ficheiro de vídeo (nunca uma estimativa genérica de 22m do catálogo!)
          const probedDur = (state.compat && state.compat.duration > 300)
            ? state.compat.duration
            : ((el.cineVideoPlayer && isFinite(el.cineVideoPlayer.duration) && el.cineVideoPlayer.duration > 300)
              ? el.cineVideoPlayer.duration
              : (state.engineTrackDuration > 300 ? state.engineTrackDuration : 0));

          const rawScored = [];
          chosen.forEach((c, i) => {
            const text = texts[i];
            if (!text) return;
            const vtt = /^\s*WEBVTT/.test(text) ? text : convertSrtToVtt(text);
            const cues = ssParseCues(vtt);
            if (cues.length < 3) return;
            const sc = ssScoreSubtitle(text, c.metaName, refName, c.fromFileMatch, sNum, openSubsEp, cleanBaseTitle, otherBaseTitles, cues, probedDur, c.fromHashMatch, c.langOrderIdx || 0, allowedEps);
            rawScored.push({
              id: c.id,
              lang: c.lang,
              vtt,
              cues,
              releaseTag: sc.releaseTag,
              fromFileMatch: c.fromFileMatch && !sc.wrongEpisode,
              fromHashMatch: c.fromHashMatch && !sc.wrongEpisode,
              wrongEpisode: sc.wrongEpisode,
              exactEpMatch: sc.exactEpMatch,
              relScore: sc.totalScore
            });
          });

          const validScored = rawScored.filter(x => !x.wrongEpisode);
          const finalPool = validScored.length > 0 ? validScored : rawScored;
          finalPool.sort((a, b) => b.relScore - a.relScore);

          const counts = {};
          finalPool.forEach(itemSub => {
            counts[itemSub.lang] = (counts[itemSub.lang] || 0) + 1;
            const idx = counts[itemSub.lang];
            const code = `${itemSub.lang}-${idx}`;
            const tagSuffix = itemSub.fromHashMatch
              ? ' ★ [Hash Exato]'
              : (itemSub.releaseTag ? ` [${itemSub.releaseTag}]` : ((idx === 1 && itemSub.exactEpMatch) ? ' ★' : ''));
            const label = `${langNames[itemSub.lang] || itemSub.lang.toUpperCase()}${idx > 1 ? ' #' + idx : ''}${tagSuffix}`;
            appendSubtitleTrack(label, code, itemSub.vtt, itemSub.lang, { fromHashMatch: itemSub.fromHashMatch });
            cands.push({
              id: itemSub.id,
              code,
              lang: itemSub.lang,
              vtt: itemSub.vtt,
              label,
              cues: itemSub.cues,
              relScore: itemSub.relScore,
              fromFileMatch: itemSub.fromFileMatch,
              fromHashMatch: itemSub.fromHashMatch,
              wrongEpisode: itemSub.wrongEpisode
            });
          });

          state.lastSubCands = cands;

          // Ativa imediatamente a legenda #1 a 0,0s (exatamente como o Stremio Desktop, sem offsets antigos!)
          if (sp0.lang !== 'off' && el.subtitleTrackSelect.value === 'off' && cands.length > 0) {
            const langOrder = wantLang === 'por' ? ['por', 'pob', 'eng'] : (wantLang === 'pob' ? ['pob', 'por', 'eng'] : [wantLang, 'por', 'pob', 'eng']);
            let initialPick = null;
            for (const lg of langOrder) {
              const pool = cands.filter(c => c.lang === lg && !c.wrongEpisode).sort((a, b) => b.relScore - a.relScore);
              if (pool.length) { initialPick = pool[0]; break; }
            }
            if (!initialPick) initialPick = cands[0];
            if (initialPick) {
              el.subtitleTrackSelect.value = initialPick.code;
              applySelectedSubtitleTrack(initialPick.code, true);
              if (initialPick.fromHashMatch) {
                setSubCalibBadge('✓ Hash Exato', 'ok');
              } else {
                setSubCalibBadge('');
              }
            }
          }

          // 3. Em P2P ao vivo, se a última peça de 64 KB ainda não tinha chegado aos 2.2s, verifica aos 6s se o videoHash ficou disponível!
          if (!vHash && E && info && info.infoHash && Number.isInteger(info.fileIdx)) {
            setTimeout(async () => {
              if (myToken !== state.subToken || state.activeSubManual) return;
              const curActive = state.subtitleTracks.find(t => t.code === el.subtitleTrackSelect.value);
              if (curActive && (curActive.fromHashMatch || curActive.isEmbedded)) return;
              try {
                const hr2 = await fetch(`${E}/videohash/${info.infoHash}/${info.fileIdx}?timeout=3500`);
                if (!hr2.ok || myToken !== state.subToken || state.activeSubManual) return;
                const hd2 = await hr2.json();
                if (!hd2 || !hd2.ok || !hd2.videoHash) return;
                const lateHash = hd2.videoHash;
                info.videoHash = lateHash;
                const [lateStremio, lateRest] = await Promise.all([
                  getStremioList(buildStremioPath(lateHash, vSize, cleanFileName)),
                  getDirectRestList(lateHash)
                ]);
                if (myToken !== state.subToken || state.activeSubManual) return;
                const langOrder = wantLang === 'por' ? ['por', 'pob'] : (wantLang === 'pob' ? ['pob', 'por'] : [wantLang, 'por', 'pob']);
                for (const lg of langOrder) {
                  const hashSub = lateStremio.find(s => normSubLang(s.lang) === lg && s.m === 'h')
                    || lateRest.find(s => normSubLang(s.lang) === lg && (s.MatchedBy === 'moviehash' || s.MovieHash === lateHash));
                  if (hashSub && hashSub.url) {
                    const rSub = await fetch(hashSub.url);
                    if (!rSub.ok || myToken !== state.subToken || state.activeSubManual) return;
                    const rawSub = decodeSubtitleBuffer(await rSub.arrayBuffer());
                    const vttSub = /^\s*WEBVTT/.test(rawSub) ? rawSub : convertSrtToVtt(rawSub);
                    const cuesSub = ssParseCues(vttSub);
                    if (cuesSub.length >= 10) {
                      const code = `${lg}-hash`;
                      const label = `${langNames[lg] || lg.toUpperCase()} ★ [Hash Exato]`;
                      appendSubtitleTrack(label, code, vttSub, lg, { fromHashMatch: true });
                      el.subtitleTrackSelect.value = code;
                      applySelectedSubtitleTrack(code, true);
                      setSubCalibBadge('✓ Hash Exato', 'ok');
                      break;
                    }
                  }
                }
              } catch (e) {}
            }, 5500);
          }
        } catch (e) { try { console.error('[legendas]', e); } catch (x) {} }
      }

      // =======================================================================
