'use strict';
      // =======================================================================
      function showPlayerOsd(text) {
        el.playerCenterOsd.textContent = text;
        el.playerCenterOsd.classList.remove('hidden');
        clearTimeout(showPlayerOsd._t);
        showPlayerOsd._t = setTimeout(() => {
          el.playerCenterOsd.classList.add('hidden');
        }, 1100);
      }

      function togglePlayPause() {
        const epPanel = document.getElementById('playerEpisodesPanel');
        if (epPanel && !epPanel.classList.contains('hidden')) {
          epPanel.classList.add('hidden');
          return;
        }
        const v = el.cineVideoPlayer;
        if (v.paused) {
          v.play().catch(() => {});
          showPlayerOsd('▶ Reproduzir');
        } else {
          v.pause();
          showPlayerOsd('⏸ Pausa');
        }
      }

      function seekRelative(deltaSeconds) {
        const d = pbDur();
        const base = (state.seekAcc != null) ? state.seekAcc : pbCur();
        const t = Math.max(0, d > 0 ? Math.min(d - 0.5, base + deltaSeconds) : (base + deltaSeconds));
        state.seekAcc = t;
        state.seekTarget = t;
        state.seekLockUntil = Date.now() + 2800;
        el.playerCurrentTime.textContent = formatTime(t);
        if (d > 0) {
          const frac = Math.max(0, Math.min(1, t / d));
          el.playerSeekInput.value = String(Math.round(frac * 1000));
          document.getElementById('playerPlayedBar').style.width = (frac * 100) + '%';
        }
        clearTimeout(state.seekTimer);
        const v = el.cineVideoPlayer;
        let inBuffer = false;
        try {
          const rel = state.compat ? (t - state.compat.offset) : t;
          for (let i = 0; i < v.buffered.length; i++) {
            if (rel >= v.buffered.start(i) - 0.15 && rel <= v.buffered.end(i) - 0.15) { inBuffer = true; break; }
          }
        } catch (e) {}
        if (inBuffer) {
          state.seekAcc = null;
          pbSeek(t);
        } else {
          // vários toques seguidos acumulam o alvo e só o último dispara o salto / conversão
          state.seekTimer = setTimeout(() => { const x = state.seekAcc; state.seekAcc = null; if (x != null) pbSeek(x); }, state.compat ? 260 : 140);
        }
        showPlayerOsd(deltaSeconds > 0 ? `⏩ +${deltaSeconds}s (${formatTime(t)})` : `⏪ ${deltaSeconds}s (${formatTime(t)})`);
      }

      function togglePlayerFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          if (el.playerModal.requestFullscreen) el.playerModal.requestFullscreen().catch(() => {});
          else if (el.playerModal.webkitRequestFullscreen) el.playerModal.webkitRequestFullscreen();
          showPlayerOsd('⛶ Ecrã Inteiro');
        } else {
          if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
          showPlayerOsd('⛶ Sair de Ecrã Inteiro');
        }
      }

      // =======================================================================
      // 14. EVENT LISTENERS & INTERACTION BINDINGS
      // =======================================================================
      function bindEvents() {
        // Hybrid Mode Switcher (Cine Stremio <-> TV Direto IPTV)
        el.switchModeCineBtn.addEventListener('click', () => setAppMode('cine'));
        el.switchModeIptvBtn.addEventListener('click', () => setAppMode('iptv'));
        el.dockJumpToLiveTvBtn.addEventListener('click', () => setAppMode('iptv'));

        el.toggleIptvSidebarBtn.addEventListener('click', () => {
          el.iptvSidebarPanel.classList.toggle('hidden');
          const isHidden = el.iptvSidebarPanel.classList.contains('hidden');
          showToast(isHidden ? 'Painel de Pastas oculto (Tecla S para abrir)' : 'Pastas & Países visíveis');
        });
        const iptvHeaderFoldersBtn = document.getElementById('iptvHeaderFoldersTrigger');
        if (iptvHeaderFoldersBtn) {
          iptvHeaderFoldersBtn.addEventListener('click', () => el.toggleIptvSidebarBtn.click());
        }

        // Header Multi-View Duplo Ecrã Toggle
        el.headerMultiViewBtn.addEventListener('click', () => {
          if (state.appMode !== 'iptv') {
            setAppMode('iptv');
          }
          state.multiViewActive = !state.multiViewActive;
          if (state.multiViewActive) {
            el.iptvPlayersGrid.classList.remove('grid-cols-1');
            el.iptvPlayersGrid.classList.add('grid-cols-1', 'lg:grid-cols-2');
            el.iptvSecondaryPlayerCard.classList.remove('hidden');
            el.iptvSecondaryPlayerCard.classList.add('flex');
            el.headerMultiViewLabel.textContent = 'Fechar Duplo';

            const list = getFilteredIptvChannels();
            let secondCh = list.find(c => String(c.id) !== String(state.iptvCurrentChannelId)) || list[0];
            if (secondCh && state.macAirMultiViewOpt && getVariantWeight(secondCh.name) >= 3) {
              const lighter = findLighterOrAlternativeVariant(secondCh);
              if (lighter) secondCh = lighter;
            }
            if (secondCh) playSecondaryIptvChannelById(secondCh.id);
            renderIptvChannelList();
            showToast('Duplo Ecrã Ativado!');
          } else {
            el.iptvPlayersGrid.classList.remove('lg:grid-cols-2');
            el.iptvSecondaryPlayerCard.classList.add('hidden');
            el.iptvSecondaryPlayerCard.classList.remove('flex');
            el.headerMultiViewLabel.textContent = 'Duplo Ecrã';
            destroySecondaryIptvEngines();
            el.iptvSecondaryVideo.pause();
            el.iptvSecondaryVideo.removeAttribute('src');
            renderIptvChannelList();
          }
        });

        // IPTV Section Tabs
        document.querySelectorAll('.iptv-tab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.iptv-tab-btn').forEach(b => {
              b.className = 'iptv-tab-btn px-1.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-300 hover:bg-slate-800 mac-transition flex flex-col items-center gap-0.5';
            });
            btn.className = 'iptv-tab-btn px-1.5 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white mac-transition flex flex-col items-center gap-0.5';
            state.iptvActiveSection = btn.getAttribute('data-iptv-section');
            state.iptvSeriesDrill = null;
            state.iptvSelectedCategory = 'ALL';
            state.iptvRenderLimit = 300;
            populateIptvCategories();
            renderIptvChannelList();
          });
        });

        el.iptvCategorySelect.addEventListener('change', () => {
          state.iptvSelectedCategory = el.iptvCategorySelect.value;
          state.iptvRenderLimit = 300;
          populateIptvCategories();
          renderIptvChannelList();
        });

        // Zeus v1.2.9 Style: Portais por País / Desporto / Pastas Fixadas
        document.querySelectorAll('.iptv-portal-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.iptv-portal-pill').forEach(b => {
              b.className = 'iptv-portal-pill px-2 py-1 rounded-lg text-[10px] font-medium bg-[#0b0f19] text-slate-300 hover:text-white border mac-border shrink-0';
            });
            btn.className = 'iptv-portal-pill px-2 py-1 rounded-lg text-[10px] font-semibold bg-indigo-600 text-white shrink-0';
            state.iptvActivePortal = btn.getAttribute('data-portal') || 'ALL';
            try { localStorage.setItem('ms_iptv_portal', state.iptvActivePortal); } catch (e) {}
            state.iptvSelectedCategory = 'ALL';
            state.iptvRenderLimit = 300;
            populateIptvCategories();
            renderIptvChannelList();
          });
        });

        const pinCatBtn = document.getElementById('pinCurrentIptvCategoryBtn');
        if (pinCatBtn) {
          pinCatBtn.addEventListener('click', () => togglePinIptvCategory(state.iptvSelectedCategory));
        }

        const localFilterInp = document.getElementById('iptvLocalFilterInput');
        if (localFilterInp) {
          localFilterInp.addEventListener('input', () => {
            state.iptvLocalFilter = localFilterInp.value;
            state.iptvRenderLimit = 300;
            renderIptvChannelList();
          });
        }

        // Selector de 4 Vistas IPTV (Workspace · Cartões · Guia EPG · Teatro)
        document.querySelectorAll('.iptv-view-mode-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            setIptvViewMode(btn.getAttribute('data-iptv-view') || 'workspace');
          });
        });

        const grpVarBtn = document.getElementById('iptvGroupVariantsBtn');
        if (grpVarBtn) {
          const updateGrpBtnUi = () => {
            grpVarBtn.className = 'px-2.5 py-1 rounded-lg text-[11px] font-medium border mac-transition ' +
              (state.iptvGroupVariants
                ? 'bg-white/10 text-slate-100 border-white/15'
                : 'bg-transparent text-slate-400 border-white/5');
            grpVarBtn.textContent = state.iptvGroupVariants ? '🔗 Agrupados' : '☰ Separados';
          };
          updateGrpBtnUi();
          grpVarBtn.addEventListener('click', () => {
            state.iptvGroupVariants = !state.iptvGroupVariants;
            try { localStorage.setItem('ms_iptv_group_variants', state.iptvGroupVariants ? '1' : '0'); } catch (e) {}
            updateGrpBtnUi();
            renderIptvChannelList();
            showToast(state.iptvGroupVariants ? 'Variantes (FHD/HD/LOW) agrupadas num único canal!' : 'Todos os sinais listados individualmente.');
          });
        }

        const portalSearchInp = document.getElementById('iptvPortalSearchInput');
        if (portalSearchInp) {
          portalSearchInp.addEventListener('input', () => {
            state.iptvPortalFilter = portalSearchInp.value;
            renderIptvPortalsSidebar();
          });
        }

        const expTheaterBtn = document.getElementById('iptvExpandTheaterBtn');
        if (expTheaterBtn) {
          expTheaterBtn.addEventListener('click', () => {
            setIptvViewMode(state.iptvViewMode === 'theater' ? 'workspace' : 'theater');
          });
        }

        const sigPopBtn = document.getElementById('toggleIptvSignalPopoverBtn');
        const sigPop = document.getElementById('iptvSignalPopover');
        if (sigPopBtn && sigPop) {
          sigPopBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            sigPop.classList.toggle('hidden');
          });
          document.addEventListener('click', (ev) => {
            if (!sigPop.classList.contains('hidden') && !sigPop.contains(ev.target) && ev.target !== sigPopBtn) {
              sigPop.classList.add('hidden');
            }
          });
        }

        const hdrBkpBtn = document.getElementById('headerBackupStatusBtn');
        if (hdrBkpBtn) {
          hdrBkpBtn.addEventListener('click', () => el.openSettingsModalBtn.click());
        }
        const dashStoreBtn = document.getElementById('dashOpenAddonStoreBtn');
        if (dashStoreBtn) {
          dashStoreBtn.addEventListener('click', () => el.openSettingsModalBtn.click());
        }
        const dashBkpBtn = document.getElementById('dashQuickBackupBtn');
        if (dashBkpBtn) {
          dashBkpBtn.addEventListener('click', exportUserBackupJson);
        }
        const expBkpBtn = document.getElementById('exportUserBackupBtn');
        if (expBkpBtn) {
          expBkpBtn.addEventListener('click', exportUserBackupJson);
        }
        const impBkpInp = document.getElementById('importUserBackupInput');
        if (impBkpInp) {
          impBkpInp.addEventListener('change', (ev) => {
            const f = ev.target.files && ev.target.files[0];
            if (f) importUserBackupJson(f);
          });
        }

        el.iptvLoadMoreBtn.addEventListener('click', () => {
          state.iptvRenderLimit += 400;
          renderIptvChannelList();
        });

        el.refreshIptvPlaylistBtn.addEventListener('click', () => {
          if (state.xtreamConfig.server && state.xtreamConfig.username) {
            el.xtreamProfileName.value = state.xtreamConfig.profileName || 'Servidor Principal Mac';
            el.xtreamServerInput.value = state.xtreamConfig.server;
            el.xtreamUserInput.value = state.xtreamConfig.username;
            el.xtreamPassInput.value = state.xtreamConfig.password;
            syncXtreamServer();
          } else {
            el.xtreamModal.classList.remove('hidden');
          }
        });

        // IPTV Secondary Screen & Toolbar Controls
        el.secondaryChannelSelect.addEventListener('change', () => {
          if (el.secondaryChannelSelect.value) {
            playSecondaryIptvChannelById(el.secondaryChannelSelect.value);
          }
        });

        el.reloadSecondaryBtn.addEventListener('click', () => {
          const ch2 = getSecondaryIptvChannel();
          if (ch2) {
            showScreenHealStatus(false, '↻ A destravar 2.º Ecrã...', 2500);
            loadIptvStreamOnVideo(el.iptvSecondaryVideo, ch2, false);
          }
        });

        el.optimizeSecondaryVariantBtn.addEventListener('click', () => {
          const ch2 = getSecondaryIptvChannel();
          if (!ch2) return;
          const lighter = findLighterOrAlternativeVariant(ch2);
          if (lighter) {
            playSecondaryIptvChannelById(lighter.id);
            showToast(`2.º Ecrã mudado para sinal leve: ${lighter.name}`);
          } else {
            loadIptvStreamOnVideo(el.iptvSecondaryVideo, ch2, false);
            showToast('Sinal do 2.º Ecrã recarregado!');
          }
        });

        el.swapAudioSecondaryBtn.addEventListener('click', () => {
          el.iptvSecondaryVideo.muted = !el.iptvSecondaryVideo.muted;
          if (!el.iptvSecondaryVideo.muted) {
            el.iptvPrimaryVideo.muted = true;
            el.swapAudioSecondaryBtn.textContent = '🔊 Som 2 Ativo';
            showToast('Áudio focado no 2.º Ecrã (Direita)');
          } else {
            el.iptvPrimaryVideo.muted = false;
            el.swapAudioSecondaryBtn.textContent = '🔇 Ouvir Ecrã 2';
            showToast('Áudio focado no 1.º Ecrã (Esquerda)');
          }
        });

        el.iptvPrevChannelBtn.addEventListener('click', () => {
          const list = getFilteredIptvChannels();
          const idx = list.findIndex(c => String(c.id) === String(state.iptvCurrentChannelId));
          if (idx > 0) playIptvChannelById(list[idx - 1].id);
          else if (list.length > 0) playIptvChannelById(list[list.length - 1].id);
        });

        el.iptvNextChannelBtn.addEventListener('click', () => {
          const list = getFilteredIptvChannels();
          const idx = list.findIndex(c => String(c.id) === String(state.iptvCurrentChannelId));
          if (idx >= 0 && idx < list.length - 1) playIptvChannelById(list[idx + 1].id);
          else if (list.length > 0) playIptvChannelById(list[0].id);
        });

        el.iptvFavCurrentBtn.addEventListener('click', () => {
          if (state.iptvCurrentChannelId) toggleIptvFavorite(state.iptvCurrentChannelId);
        });

        el.iptvReloadChannelBtn.addEventListener('click', () => {
          const cur = getCurrentIptvChannel();
          if (cur) {
            showScreenHealStatus(true, '↻ A recarregar emissão...', 2500);
            loadIptvStreamOnVideo(el.iptvPrimaryVideo, cur, true);
          }
          if (state.multiViewActive) {
            const ch2 = getSecondaryIptvChannel();
            if (ch2) loadIptvStreamOnVideo(el.iptvSecondaryVideo, ch2, false);
          }
        });

        const switchPrimaryBackupVariant = () => {
          const cur = getCurrentIptvChannel();
          if (!cur) return;
          const siblings = findSiblingVariants(cur);
          if (siblings.length <= 1) {
            showToast('A recarregar sinal atual...');
            loadIptvStreamOnVideo(el.iptvPrimaryVideo, cur, true);
            return;
          }
          const idx = siblings.findIndex(c => String(c.id) === String(cur.id));
          const nextVariant = siblings[(idx + 1) % siblings.length];
          playIptvChannelById(nextVariant.id);
          showToast(`Sinal alterado para: ${nextVariant.name}`);
        };

        el.iptvSwitchBackupSignalBtn.addEventListener('click', switchPrimaryBackupVariant);
        el.switchScreen1LighterVariantBtn.addEventListener('click', switchPrimaryBackupVariant);

        el.iptvEngineModeSelect.addEventListener('change', () => {
          state.iptvEngineMode = el.iptvEngineModeSelect.value;
          const cur = getCurrentIptvChannel();
          if (cur) loadIptvStreamOnVideo(el.iptvPrimaryVideo, cur, true);
          if (state.multiViewActive) {
            const ch2 = getSecondaryIptvChannel();
            if (ch2) loadIptvStreamOnVideo(el.iptvSecondaryVideo, ch2, false);
          }
          showToast('Motor IPTV alterado.');
        });

        el.iptvAspectRatioBtn.addEventListener('click', () => {
          const modes = ['contain', 'cover', 'fill'];
          const labels = { contain: '📐 Ajustar', cover: '📐 Preencher', fill: '📐 16:9 Cheio' };
          state.objectFitMode = modes[(modes.indexOf(state.objectFitMode) + 1) % modes.length];
          el.iptvPrimaryVideo.style.objectFit = state.objectFitMode;
          el.iptvSecondaryVideo.style.objectFit = state.objectFitMode;
          el.iptvAspectRatioBtn.textContent = labels[state.objectFitMode];
        });

        el.iptvImageBoostBtn.addEventListener('click', () => {
          state.imageBoost = !state.imageBoost;
          const filterVal = state.imageBoost ? 'contrast(1.08) saturate(1.12) brightness(1.03)' : 'none';
          el.iptvPrimaryVideo.style.filter = filterVal;
          el.iptvSecondaryVideo.style.filter = filterVal;
          showToast(state.imageBoost ? 'Nitidez MacBook Ativada ✨' : 'Imagem Original');
        });

        el.iptvPipBtn.addEventListener('click', async () => {
          try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else if (el.iptvPrimaryVideo.requestPictureInPicture) await el.iptvPrimaryVideo.requestPictureInPicture();
          } catch (e) {}
        });

        el.iptvFullscreenBtn.addEventListener('click', () => {
          if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (el.iptvVideoStageWrapper.requestFullscreen) el.iptvVideoStageWrapper.requestFullscreen().catch(() => {});
            else if (el.iptvVideoStageWrapper.webkitRequestFullscreen) el.iptvVideoStageWrapper.webkitRequestFullscreen();
          } else {
            if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
          }
        });

        el.tryTsEngineBtn.addEventListener('click', () => {
          state.iptvEngineMode = 'ts';
          el.iptvEngineModeSelect.value = 'ts';
          const cur = getCurrentIptvChannel();
          if (cur) loadIptvStreamOnVideo(el.iptvPrimaryVideo, cur, true);
        });

        el.dismissSafariBannerBtn.addEventListener('click', () => {
          el.safariBlockBanner.classList.add('hidden');
        });

        el.copyStreamUrlBtn.addEventListener('click', () => {
          const cur = getCurrentIptvChannel();
          if (cur) copyTextSafe(buildIptvStreamUrl(cur), 'URL direto do canal copiado!');
        });

        el.copyM3uPlaylistUrlBtn.addEventListener('click', () => {
          if (!state.xtreamConfig.server || !state.xtreamConfig.username) {
            showToast('Configura primeiro o Servidor Xtream.');
            return;
          }
          let srv = state.xtreamConfig.server.trim().replace(/\/+$/, '');
          if (!/^https?:\/\//i.test(srv)) srv = 'http://' + srv;
          const url = `${srv}/get.php?username=${encodeURIComponent(state.xtreamConfig.username)}&password=${encodeURIComponent(state.xtreamConfig.password)}&type=m3u_plus&output=m3u8`;
          copyTextSafe(url, 'URL da Lista M3U copiado!');
        });

        el.exportM3uBtn.addEventListener('click', () => {
          let m3u = '#EXTM3U\n';
          state.iptvChannels.slice(0, 3000).forEach(ch => {
            m3u += `#EXTINF:-1 group-title="${String(ch.category || 'Geral').replace(/"/g, "'")}",${ch.name}\n${buildIptvStreamUrl(ch)}\n`;
          });
          const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'MacStream_Lista.m3u';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('Ficheiro .M3U exportado!');
        });

        el.autoReconnectToggle.addEventListener('change', () => {
          state.autoReconnect = el.autoReconnectToggle.checked;
        });
        el.autoFailoverVariantToggle.addEventListener('change', () => {
          state.autoFailoverVariant = el.autoFailoverVariantToggle.checked;
        });
        el.macAirMultiViewOptToggle.addEventListener('change', () => {
          state.macAirMultiViewOpt = el.macAirMultiViewOptToggle.checked;
        });
        el.sleepTimerSelect.addEventListener('change', () => {
          clearTimeout(sleepTimerTimeout);
          const mins = parseInt(el.sleepTimerSelect.value, 10) || 0;
          if (mins > 0) {
            sleepTimerTimeout = setTimeout(() => {
              el.iptvPrimaryVideo.pause();
              el.iptvSecondaryVideo.pause();
              el.cineVideoPlayer.pause();
              showToast('Sleep Timer concluído — Reprodução em pausa.');
            }, mins * 60 * 1000);
            showToast(`Sleep Timer ativado: ${mins} min.`);
          }
        });

        // Xtream & M3U Modal Bindings
        el.openXtreamModalBtn.addEventListener('click', () => {
          el.xtreamProfileName.value = state.xtreamConfig.profileName || 'Servidor Principal Mac';
          el.xtreamServerInput.value = state.xtreamConfig.server || '';
          el.xtreamUserInput.value = state.xtreamConfig.username || '';
          el.xtreamPassInput.value = state.xtreamConfig.password || '';
          el.xtreamModal.classList.remove('hidden');
        });
        el.closeXtreamModalBtn.addEventListener('click', () => el.xtreamModal.classList.add('hidden'));

        el.tabXtreamLoginBtn.addEventListener('click', () => {
          el.xtreamForm.classList.remove('hidden');
          el.m3uImportPanel.classList.add('hidden');
          el.tabXtreamLoginBtn.className = 'pb-2.5 px-2 text-xs font-semibold border-b-2 border-indigo-500 text-indigo-400';
          el.tabM3uImportBtn.className = 'pb-2.5 px-2 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200';
        });

        el.tabM3uImportBtn.addEventListener('click', () => {
          el.xtreamForm.classList.add('hidden');
          el.m3uImportPanel.classList.remove('hidden');
          el.tabM3uImportBtn.className = 'pb-2.5 px-2 text-xs font-semibold border-b-2 border-indigo-500 text-indigo-400';
          el.tabXtreamLoginBtn.className = 'pb-2.5 px-2 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200';
        });

        el.xtreamForm.addEventListener('submit', syncXtreamServer);

        const parseM3uText = (rawText, label) => {
          const lines = rawText.split(/\r?\n/);
          const parsed = [];
          let meta = null;
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i].trim();
            if (!l) continue;
            if (l.startsWith('#EXTINF:')) {
              const ci = l.indexOf(',', Math.max(l.lastIndexOf('"'), 0));
              const name = ((ci >= 0 ? l.slice(ci + 1) : '') || 'Canal').trim();
              const grp = l.match(/group-title="([^"]+)"/i);
              const lg = l.match(/tvg-logo="([^"]+)"/i);
              meta = { name, category: grp ? grp[1] : 'Geral', logo: lg ? lg[1] : '' };
            } else if (!l.startsWith('#')) {
              parsed.push({
                id: 'm3u-' + (parsed.length + 1),
                name: meta ? meta.name : ('Canal ' + (parsed.length + 1)),
                category: meta ? meta.category : 'Geral',
                logo: meta ? (meta.logo || '') : '',
                section: /\.(mp4|mkv|avi)($|\?)/i.test(l) ? 'vod' : 'live',
                format: /\.ts($|\?)/i.test(l) ? 'ts' : 'm3u8',
                url: l
              });
              meta = null;
            }
          }
          if (parsed.length > 0) {
            state.iptvChannels = parsed;
            saveChannels(parsed);
            state.iptvCurrentChannelId = parsed[0].id;
            el.headerSubStatus.textContent = `${label} • ${parsed.length} canais IPTV + Cine P2P`;
            updateIptvCounts();
            setAppMode('iptv');
            playIptvChannelById(parsed[0].id);
            el.xtreamModal.classList.add('hidden');
            showToast(`${parsed.length} canais importados!`);
          }
        };

        el.m3uFileInput.addEventListener('change', (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => parseM3uText(String(r.result || ''), f.name);
          r.readAsText(f);
        });

        el.parseM3uBtn.addEventListener('click', () => {
          const txt = el.m3uRawTextarea.value.trim();
          if (txt) parseM3uText(txt, 'Lista M3U');
        });

        // Collapsible Sidebar Toggle (A3)
        const colBtn = document.getElementById('collapseSidebarBtn');
        if (colBtn) {
          if (localStorage.getItem('ms_sidebar_collapsed') === '1') {
            el.cineWorkspaceView.classList.add('sidebar-collapsed');
          }
          colBtn.addEventListener('click', () => {
            el.cineWorkspaceView.classList.toggle('sidebar-collapsed');
            const isCol = el.cineWorkspaceView.classList.contains('sidebar-collapsed');
            localStorage.setItem('ms_sidebar_collapsed', isCol ? '1' : '0');
          });
        }

        // Hubs & Time Filter Pills (S2 & S3)
        document.querySelectorAll('[data-hub]').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('[data-hub]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeHub = btn.getAttribute('data-hub');
            renderHubSpotlightRow();
          });
        });
        document.querySelectorAll('[data-timepill]').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('[data-timepill]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTimePill = btn.getAttribute('data-timepill');
            renderHubSpotlightRow();
          });
        });

        const sBtn = document.getElementById('surpriseBtn');
        if (sBtn) sBtn.addEventListener('click', surpriseMe);

        const homeIptvBtn = document.getElementById('homeOpenIptvBtn');
        if (homeIptvBtn) homeIptvBtn.addEventListener('click', () => setAppMode('iptv'));

        const showFullCatBtn = document.getElementById('showFullCatalogBtn');
        if (showFullCatBtn) {
          showFullCatBtn.addEventListener('click', () => {
            state.forceShowExplorer = true;
            syncHomeVsExplorerVisibility();
            renderCatalogGrid();
            document.getElementById('mainCatalogViewport').scrollTo({ top: 0, behavior: 'smooth' });
          });
        }
        const backHomeBtn = document.getElementById('backToHomeFromCatalogBtn');
        if (backHomeBtn) {
          backHomeBtn.addEventListener('click', () => {
            state.forceShowExplorer = false;
            state.activeGenre = 'ALL';
            state.catFilters = {};
            saveCatFilters();
            syncCatalogFilterUi();
            renderAllSections();
            document.getElementById('mainCatalogViewport').scrollTo({ top: 0, behavior: 'smooth' });
          });
        }

        // Navigation Dock (Cine Mode)
        document.querySelectorAll('.nav-dock-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-dock-btn').forEach(b => {
              b.className = 'nav-dock-btn w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white mac-transition';
            });
            btn.className = 'nav-dock-btn w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white shadow-md shadow-indigo-600/20 mac-transition';

            state.activeNav = btn.getAttribute('data-nav');
            state.forceShowExplorer = false;
            const headings = {
              discover: 'Explorar todo o catálogo',
              movies: 'Filmes para Streaming P2P (4K / 1080p)',
              series: 'Séries de TV e Temporadas Completas',
              continue: 'Continuar a ver',
              library: 'A Minha Biblioteca & Favoritos'
            };
            el.catalogSectionHeading.textContent = headings[state.activeNav] || 'Catálogo';
            renderAllSections();
            document.getElementById('mainCatalogViewport').scrollTo({ top: 0, behavior: 'smooth' });
          });
        });

        el.brandHomeBtn.addEventListener('click', () => {
          state.forceShowExplorer = false;
          const firstDock = document.querySelector('[data-nav="discover"]');
          if (firstDock) firstDock.click();
        });

        // Genre Filter Pills
        document.querySelectorAll('.genre-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            state.activeGenre = btn.getAttribute('data-genre');
            delete catFilters().theme;
            catRefresh();
          });
        });

        // Global Spotlight Search + Direct Magnet detection (Filters BOTH Cine & IPTV)
        el.globalSearchInput.addEventListener('input', () => {
          const val = el.globalSearchInput.value;
          el.clearSearchBtn.classList.toggle('hidden', val === '');

          // If user pasted a magnet:? link directly into the search bar, open it!
          if (val.trim().startsWith('magnet:?')) {
            el.directMagnetTextarea.value = val.trim();
            el.magnetModal.classList.remove('hidden');
            return;
          }

          state.searchQuery = val;
          if (val.trim().length < 3 && state.searchCommitted) { state.searchCommitted = ''; CAT.fallbacks = []; }
          if (state.appMode === 'iptv') {
            state.iptvRenderLimit = 300;
            renderIptvChannelList();
          } else {
            renderCatalogGrid();
            renderHomeRows();
            clearTimeout(searchDebounceTimer);
            if (val.trim().length >= 3) {
              searchDebounceTimer = setTimeout(() => performLiveMetaSearch(val.trim()), 420);
            }
          }
        });

        el.clearSearchBtn.addEventListener('click', () => {
          el.globalSearchInput.value = '';
          state.searchQuery = '';
          state.searchCommitted = ''; CAT.fallbacks = [];
          el.clearSearchBtn.classList.add('hidden');
          if (state.appMode === 'iptv') renderIptvChannelList();
          else { renderCatalogGrid(); renderHomeRows(); }
        });

        // Hero Banner Buttons (Quick Play, Details, Cache Preload, Library, Prev/Next)
        const hQuickBtn = document.getElementById('heroQuickPlayBtn');
        if (hQuickBtn) hQuickBtn.addEventListener('click', () => quickPlayItemDirect(state.heroItem || state.catalog[0]));

        el.heroWatchBtn.addEventListener('click', () => {
          openDetailDrawer(state.heroItem || state.catalog[0]);
        });

        const hPreloadBtn = document.getElementById('heroPreloadBtn');
        if (hPreloadBtn) hPreloadBtn.addEventListener('click', () => preloadItemToCache(state.heroItem || state.catalog[0]));

        const hPrevBtn = document.getElementById('heroPrevBtn');
        const hNextBtn = document.getElementById('heroNextBtn');
        if (hPrevBtn) {
          hPrevBtn.addEventListener('click', () => {
            const l = state.home.heroList || [];
            if (l.length < 2) return;
            state.home.heroIdx = (state.home.heroIdx - 1 + l.length) % l.length;
            setHero(l[state.home.heroIdx]);
            restartHeroTimer();
          });
        }
        if (hNextBtn) {
          hNextBtn.addEventListener('click', () => {
            const l = state.home.heroList || [];
            if (l.length < 2) return;
            state.home.heroIdx = (state.home.heroIdx + 1) % l.length;
            setHero(l[state.home.heroIdx]);
            restartHeroTimer();
          });
        }

        el.heroLibraryBtn.addEventListener('click', () => {
          const heroItem = state.heroItem || state.catalog[0];
          if (!heroItem) return;
          toggleLibraryItem(heroItem);
          const inLib = Boolean(state.libraryMap[heroItem.imdbId]);
          el.heroLibraryIcon.textContent = inLib ? '♥' : '＋';
          el.heroLibraryLabel.textContent = inLib ? 'Na Biblioteca' : 'Biblioteca';
        });

        const clrEpCacheBtn = document.getElementById('clearAllEpisodeCacheBtn');
        if (clrEpCacheBtn) {
          clrEpCacheBtn.addEventListener('click', async () => {
            const app = window.macstreamApp;
            if (app && app.engineUrl) await fetch(`${app.engineUrl}/clear`).catch(() => {});
            state.localCacheSim = [];
            storage.set('ms_local_cache_sim', []);
            state.engineInfo = null;
            showToast('🧹 Pasta de Cache limpa!');
            pollEpisodeCache();
            refreshCacheLabel();
            renderContinueWatchingRow();
          });
        }

        const exitPolSel = document.getElementById('cacheExitPolicySelect');
        if (exitPolSel) {
          exitPolSel.value = state.cacheExitPolicy || 'pause';
          exitPolSel.addEventListener('change', () => {
            state.cacheExitPolicy = exitPolSel.value;
            localStorage.setItem('ms_cache_exit_policy', state.cacheExitPolicy);
            showToast(state.cacheExitPolicy === 'pause' ? 'Ao sair do player: Pausa download (60 FPS no menu)' : 'Ao sair do player: Continua download até 100%');
          });
        }

        // Clear History
        el.clearHistoryBtn.addEventListener('click', async () => {
          state.watchProgressMap = {};
          await CineDB.clearStore('watch_progress');
          renderAllSections();
          showToast('Histórico de visualização limpo.');
        });

        // Sync Catalog Button
        el.syncCatalogBtn.addEventListener('click', () => {
          syncCatalogFromApis(true);
        });

        // Detail Drawer Actions
        el.closeDetailModalBtn.addEventListener('click', () => {
          el.detailModal.classList.add('hidden');
        });


        document.getElementById('detailQuickPlayBtn').addEventListener('click', quickPlaySelected);
        const dpCacheBtn = document.getElementById('detailPreloadCacheBtn');
        if (dpCacheBtn) {
          dpCacheBtn.addEventListener('click', () => {
            if (state.selectedItem) preloadItemToCache(state.selectedItem, state.selectedSeason, state.selectedEpisode);
          });
        }
        el.detailResumeBtn.addEventListener('click', () => {
          if (!state.selectedItem) return;
          const key = getProgressKey(state.selectedItem.imdbId, state.selectedItem.type, state.selectedSeason, state.selectedEpisode);
          const prog = state.watchProgressMap[key];
          if (prog) resumeSavedProgressItem(prog);
        });

        el.detailToggleLibraryBtn.addEventListener('click', () => {
          if (state.selectedItem) {
            toggleLibraryItem(state.selectedItem);
            updateDetailButtonsState();
            renderCatalogGrid();
          }
        });

        el.detailMarkWatchedBtn.addEventListener('click', async () => {
          const item = state.selectedItem;
          if (!item) return;
          const key = getProgressKey(item.imdbId, item.type, state.selectedSeason, state.selectedEpisode);
          const current = state.watchProgressMap[key];
          const newCompleted = !(current && current.completed);

          const rec = {
            key,
            imdbId: item.imdbId,
            title: item.title,
            type: item.type,
            poster: item.poster,
            backdrop: item.backdrop,
            season: state.selectedSeason,
            episode: state.selectedEpisode,
            currentTime: newCompleted ? 3600 : 0,
            duration: 3600,
            completed: newCompleted,
            updatedAt: Date.now()
          };
          state.watchProgressMap[key] = rec;
          await CineDB.put('watch_progress', rec);
          updateDetailButtonsState();
          if (item.type === 'series') renderSeasonTabsAndEpisodes();
          renderAllSections();
          showToast(newCompleted ? 'Marcado como Visto ✓' : 'Desmarcado como Visto');
        });

        // Resolution Filter Pills inside Detail Drawer
        document.querySelectorAll('.res-filter-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.res-filter-btn').forEach(b => {
              b.className = 'res-filter-btn px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#0b0f19] text-slate-300 hover:text-white border mac-border mac-transition';
            });
            btn.className = 'res-filter-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white mac-transition';
            state.activeResFilter = btn.getAttribute('data-resfilter');
            renderScrapedStreamsList();
          });
        });

        // Inline Magnet Link Play inside Detail Drawer
        el.inlineMagnetPlayBtn.addEventListener('click', () => {
          const mag = el.inlineMagnetInput.value.trim();
          if (!mag) {
            showToast('Cola primeiro um link magnet:?xt=urn:btih:...');
            return;
          }
          launchVideoPlayer({
            item: state.selectedItem || state.catalog[0],
            season: state.selectedSeason,
            episode: state.selectedEpisode,
            episodeTitle: 'Custom Magnet Stream',
            stream: {
              addon: 'Magnet Link P2P Sequencial',
              title: mag,
              resolution: '1080p',
              seeders: 100,
              magnetUri: mag
            },
            resumeSeconds: 0
          });
        });

        // Video Player Controls — Ao voltar ao menu principal, pausa o swarm por defeito (60 FPS na Home!) e mantém o episódio na pasta de Cache!
        el.closePlayerBtn.addEventListener('click', () => {
          if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
          saveCurrentPlaybackProgress();
          const fBadge = document.getElementById('playerFastSeekBadge');
          if (fBadge) fBadge.classList.add('hidden');
          document.getElementById('playerEpisodesPanel').classList.add('hidden');
          cleanupActivePlayerSession();
          const pauseSwarm = state.cacheExitPolicy === 'continue' ? '0' : '1';
          if (window.macstreamApp) {
            try { fetch(`${window.macstreamApp.engineUrl}/pause?pauseSwarm=${pauseSwarm}`).catch(() => {}); } catch (e) {}
            if (pauseSwarm === '1') el.ecoHudLabel.textContent = 'Em pausa (Cache)';
          }
          el.playerModal.classList.add('hidden');
          restartHeroTimer();
          renderAllSections();
          refreshCacheLabel();
          if (!el.detailModal.classList.contains('hidden')) {
            updateDetailButtonsState();
            if (state.selectedItem && state.selectedItem.type === 'series') {
              renderSeasonTabsAndEpisodes();
            }
          }
        });

        el.playerPlayPauseBtn.addEventListener('click', togglePlayPause);
        el.cineVideoPlayer.addEventListener('click', togglePlayPause);

        el.cineVideoPlayer.addEventListener('play', () => {
          el.playerPlayPauseIcon.textContent = '⏸ Pausa';
        });
        el.cineVideoPlayer.addEventListener('pause', () => {
          el.playerPlayPauseIcon.textContent = '▶ Reproduzir';
          saveCurrentPlaybackProgress();
        });

        el.cineVideoPlayer.addEventListener('timeupdate', onPlayerTimeUpdate);
        el.cineVideoPlayer.addEventListener('progress', updateBufferBar);

        el.playerSeekInput.addEventListener('input', () => {
          const d = pbDur();
          if (!(d > 0)) return;
          const frac = Math.max(0, Math.min(1, parseFloat(el.playerSeekInput.value) / 1000));
          const t = frac * d;
          state.seeking = true;
          state.seekPreviewTime = t;
          el.playerCurrentTime.textContent = formatTime(t);
          document.getElementById('playerPlayedBar').style.width = (frac * 100) + '%';
        });
        el.playerSeekInput.addEventListener('change', () => {
          const d = pbDur();
          const frac = Math.max(0, Math.min(1, parseFloat(el.playerSeekInput.value) / 1000));
          state.seeking = false;
          state.seekPreviewTime = null;
          if (d > 0) pbSeek(frac * d);
        });

        el.playerRewindBtn.addEventListener('click', () => seekRelative(-10));
        el.playerForwardBtn.addEventListener('click', () => seekRelative(10));

        el.playerMuteBtn.addEventListener('click', () => {
          el.cineVideoPlayer.muted = !el.cineVideoPlayer.muted;
          el.playerMuteBtn.textContent = el.cineVideoPlayer.muted ? '🔇' : '🔊';
        });

        el.playerVolumeSlider.addEventListener('input', () => {
          el.cineVideoPlayer.volume = parseFloat(el.playerVolumeSlider.value);
          el.cineVideoPlayer.muted = el.cineVideoPlayer.volume === 0;
          el.playerMuteBtn.textContent = el.cineVideoPlayer.muted ? '🔇' : '🔊';
        });

        // Bind Pure P2P Mode Switcher Pills (Local P2P :8888 vs Browser WebRTC)
        document.querySelectorAll('.play-mode-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-playmode');
            const curSec = pbCur() || 0;
            switchPlayerEngineMode(mode, curSec);
          });
        });

        // Ajuda quando uma fonte não arranca
        el.helpTryWebtorrentBtn.addEventListener('click', () => {
          switchPlayerEngineMode('webtorrent', el.cineVideoPlayer.currentTime || (state.playingContext && state.playingContext.resumeSeconds) || 0);
        });
        el.helpRetryStremioBtn.addEventListener('click', () => {
          switchPlayerEngineMode('stremio', el.cineVideoPlayer.currentTime || 0);
        });
        el.helpOpenSettingsBtn.addEventListener('click', () => {
          el.tmdbApiKeyInput.value = state.tmdbApiKey;
          renderAddonsList();
          el.settingsModal.classList.remove('hidden');
        });

        // Episódio anterior / seguinte
        el.playerPrevEpBtn.addEventListener('click', () => jumpToEpisode(-1));
        el.playerNextEpBtn.addEventListener('click', () => jumpToEpisode(1));

        el.playNextEpisodeNowBtn.addEventListener('click', () => jumpToEpisode(1));
        el.dismissUpNextBtn.addEventListener('click', () => {
          clearInterval(state.upNextTimer);
          el.upNextEpisodeCard.classList.add('hidden');
        });

        // Subtitles Selector & Drag-and-Drop .SRT/.VTT
        el.subtitleTrackSelect.addEventListener('change', () => {
          applySelectedSubtitleTrack(el.subtitleTrackSelect.value);
          showPlayerOsd(`💬 Legendas: ${el.subtitleTrackSelect.options[el.subtitleTrackSelect.selectedIndex].text}`);
        });

        const autoCalBtn = document.getElementById('subAutoCalibrateBtn');
        if (autoCalBtn) autoCalBtn.addEventListener('click', () => calibrateActiveSubtitleNow());
        document.getElementById('subDelayMinusBtn').addEventListener('click', () => adjustSubtitleOffset(-0.5));
        document.getElementById('subDelayPlusBtn').addEventListener('click', () => adjustSubtitleOffset(0.5));
        el.customSrtFileInput.addEventListener('change', (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (f) loadCustomSubtitleFile(f);
        });

        el.videoDropZone.addEventListener('dragover', (ev) => {
          ev.preventDefault();
        });
        el.videoDropZone.addEventListener('drop', (ev) => {
          ev.preventDefault();
          const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
          if (f && /\.(srt|vtt)$/i.test(f.name)) {
            loadCustomSubtitleFile(f);
          } else if (f && /\.torrent$/i.test(f.name)) {
            if (window.macstreamApp) launchTorrentFile(f); else startPureBrowserWebTorrent(f, 0);
          }
        });

        el.playerPipBtn.addEventListener('click', async () => {
          try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else if (el.cineVideoPlayer.requestPictureInPicture) await el.cineVideoPlayer.requestPictureInPicture();
          } catch (e) {}
        });

        el.playerFullscreenBtn.addEventListener('click', togglePlayerFullscreen);

        // Direct Magnet Modal
        el.openMagnetModalBtn.addEventListener('click', () => {
          el.magnetModal.classList.remove('hidden');
        });
        el.closeMagnetModalBtn.addEventListener('click', () => {
          el.magnetModal.classList.add('hidden');
        });
        el.fillSampleMagnetBtn.addEventListener('click', () => {
          el.directMagnetTextarea.value = VERIFIED_TEST_MAGNET;
          showToast('Magnet Link WebTorrent oficial carregado!');
        });
        el.startDirectMagnetBtn.addEventListener('click', () => {
          const raw = el.directMagnetTextarea.value.trim();
          if (!raw) {
            showToast('Cola um Magnet Link ou escolhe o teste P2P.');
            return;
          }
          el.magnetModal.classList.add('hidden');
          launchVideoPlayer({
            item: {
              imdbId: 'custom-magnet-' + hashStr(raw),
              type: 'movie',
              title: 'Stream Magnet P2P Sequencial',
              poster: localPosterSvg('Magnet P2P', 400, 600),
              backdrop: localPosterSvg('WebTorrent P2P', 1280, 720)
            },
            season: 1,
            episode: 1,
            stream: {
              addon: 'WebTorrent Magnet',
              title: raw,
              resolution: '1080p',
              seeders: 215,
              magnetUri: raw,
              isWebRtcNative: raw === VERIFIED_TEST_MAGNET,
              directUrl: (/^https?:\/\//i.test(raw) && !/\.torrent(\?|$)/i.test(raw)) ? raw : '',
              infoHash: ((raw.match(/btih:([a-fA-F0-9]{40})/) || [])[1] || '')
            },
            resumeSeconds: 0
          });
        });

        // .torrent local: com a app usa o motor interno (envia o ficheiro em base64); no browser usa o WebTorrent
        async function launchTorrentFile(f) {
          el.magnetModal.classList.add('hidden');
          let torrentB64 = '';
          if (window.macstreamApp) {
            try {
              const u8 = new Uint8Array(await f.arrayBuffer());
              let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
              torrentB64 = btoa(bin);
            } catch (e) { showToast('Não consegui ler o ficheiro .torrent.'); return; }
          }
          launchVideoPlayer({
            item: {
              imdbId: 'torrent-file-' + hashStr(f.name + f.size),
              type: 'movie',
              title: f.name.replace(/\.torrent$/i, ''),
              poster: localPosterSvg('Torrent', 400, 600)
            },
            season: 1,
            episode: 1,
            stream: {
              addon: 'Ficheiro .Torrent Local',
              title: f.name,
              resolution: '1080p',
              seeders: 120,
              magnetUri: torrentB64 ? '' : f,
              torrentB64,
              isWebRtcNative: !torrentB64
            },
            resumeSeconds: 0
          });
        }
        el.torrentFileInput.addEventListener('change', (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (f) launchTorrentFile(f);
        });

        // Settings & TMDB Modal
        el.openSettingsModalBtn.addEventListener('click', () => {
          el.tmdbApiKeyInput.value = state.tmdbApiKey;
          renderAddonsList();
          el.settingsModal.classList.remove('hidden');
        });
        el.closeSettingsModalBtn.addEventListener('click', () => {
          el.settingsModal.classList.add('hidden');
        });
        el.saveTmdbKeyBtn.addEventListener('click', () => {
          state.tmdbApiKey = el.tmdbApiKeyInput.value.trim();
          writeSecret('macstream_tmdb_key', state.tmdbApiKey);
          showToast(state.tmdbApiKey ? 'Chave API TMDB guardada! A atualizar catálogo...' : 'Modo Cinemeta Padrão ativo.');
          syncCatalogFromApis(true);
          el.settingsModal.classList.add('hidden');
        });

        const pingBtn = document.getElementById('pingAllAddonsBtn');
        if (pingBtn) pingBtn.addEventListener('click', pingAllAddons);

        const debridBtn = document.getElementById('applyTorrentioConfigBtn');
        if (debridBtn) debridBtn.addEventListener('click', applyTorrentioDebridConfig);

        el.installAddonBtn.addEventListener('click', async () => {
          const url = el.customAddonUrlInput.value.trim();
          if (!url) return;
          el.installAddonBtn.disabled = true;
          try {
            await installAddonFromUrl(url);
            el.customAddonUrlInput.value = '';
          } catch (e) {
            showToast('Add-on inválido: ' + (e && e.message ? e.message : e));
          } finally {
            el.installAddonBtn.disabled = false;
          }
        });

        el.ecoModeToggle.addEventListener('change', () => {
          state.ecoMode = el.ecoModeToggle.checked;
          showToast(state.ecoMode ? 'Modo Eco MacBook Air 2019 Ativado' : 'Modo Performance Máxima Ativado');
        });

        // Global Keyboard Shortcuts (macOS + Full Video Player Controls)
        window.addEventListener('keydown', (ev) => {
          const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
          const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

          // Cmd+K or Ctrl+K for Spotlight Search
          if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
            ev.preventDefault();
            el.globalSearchInput.focus();
            el.globalSearchInput.select();
            return;
          }

          if (ev.key === 'Escape') {
            if (!el.playerModal.classList.contains('hidden')) {
              const epPanel = document.getElementById('playerEpisodesPanel');
              if (epPanel && !epPanel.classList.contains('hidden')) {
                epPanel.classList.add('hidden');
                return;
              }
              el.closePlayerBtn.click();
              return;
            }
            if (!el.detailModal.classList.contains('hidden')) {
              el.detailModal.classList.add('hidden');
              return;
            }
            el.magnetModal.classList.add('hidden');
            el.xtreamModal.classList.add('hidden');
            el.settingsModal.classList.add('hidden');
            return;
          }

          if (isInput) return;

          // IPTV Mode Shortcuts when Cine Player Modal is closed
          if (state.appMode === 'iptv' && el.playerModal.classList.contains('hidden')) {
            const k = ev.key.toLowerCase();
            if (ev.key === 'Backspace') {
              ev.preventDefault();
              const prev = state.iptvHistory && state.iptvHistory[1];
              if (prev && typeof playIptvChannelById === 'function') { playIptvChannelById(prev); showToast('↩ Canal anterior'); }
            } else if (k === 's') {
              ev.preventDefault();
              el.toggleIptvSidebarBtn.click();
            } else if (k === 'r') {
              ev.preventDefault();
              el.iptvReloadChannelBtn.click();
            } else if (k === 'b') {
              ev.preventDefault();
              el.iptvSwitchBackupSignalBtn.click();
            } else if (k === 'l') {
              ev.preventDefault();
              el.iptvFavCurrentBtn.click();
            } else if (k === 'f') {
              ev.preventDefault();
              el.iptvFullscreenBtn.click();
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault();
              el.iptvPrevChannelBtn.click();
            } else if (ev.key === 'ArrowDown') {
              ev.preventDefault();
              el.iptvNextChannelBtn.click();
            }
            return;
          }

          // Video Player Active Shortcuts
          if (!el.playerModal.classList.contains('hidden')) {
            const k = ev.key.toLowerCase();
            if (ev.code === 'Space' || k === ' ') {
              ev.preventDefault();
              if (tag === 'button' && document.activeElement) document.activeElement.blur();
              togglePlayPause();
            } else if (k === 'f') {
              ev.preventDefault();
              togglePlayerFullscreen();
            } else if (ev.key === 'ArrowRight') {
              ev.preventDefault();
              seekRelative(10);
            } else if (ev.key === 'ArrowLeft') {
              ev.preventDefault();
              seekRelative(-10);
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault();
              el.cineVideoPlayer.volume = Math.min(1, (el.cineVideoPlayer.volume || 0) + 0.1);
              el.playerVolumeSlider.value = String(el.cineVideoPlayer.volume);
              showPlayerOsd(`🔊 Volume ${Math.round(el.cineVideoPlayer.volume * 100)}%`);
            } else if (ev.key === 'ArrowDown') {
              ev.preventDefault();
              el.cineVideoPlayer.volume = Math.max(0, (el.cineVideoPlayer.volume || 0) - 0.1);
              el.playerVolumeSlider.value = String(el.cineVideoPlayer.volume);
              showPlayerOsd(`🔉 Volume ${Math.round(el.cineVideoPlayer.volume * 100)}%`);
            } else if (k === 'm') {
              ev.preventDefault();
              el.playerMuteBtn.click();
            } else if (k === 'a') {
              ev.preventDefault();
              calibrateActiveSubtitleNow();
            } else if (k === 'g') {
              ev.preventDefault();
              adjustSubtitleOffset(-0.5);
            } else if (k === 'h') {
              ev.preventDefault();
              adjustSubtitleOffset(0.5);
            } else if (k === 'c') {
              ev.preventDefault();
              const wasOff = el.subtitleTrackSelect.value === 'off';
              const target = wasOff ? (state.lastSubCode || (state.subtitleTracks[0] && state.subtitleTracks[0].code) || 'off') : 'off';
              el.subtitleTrackSelect.value = target;
              applySelectedSubtitleTrack(target);
              showPlayerOsd(target === 'off' ? '💬 Legendas Desativadas' : '💬 Legendas Ativas');
            } else if (k === 'z') {
              ev.preventDefault();
              cycleVideoFit();
            } else if (k === 'p') {
              ev.preventDefault();
              el.playerPipBtn.click();
            }
          }
        });
      }

      function renderCuratedAddonsStore() {
        const grid = document.getElementById('curatedAddonsStoreGrid');
        if (!grid) return;
        grid.innerHTML = '';
        CURATED_ADDON_CATALOG.forEach(item => {
          const installed = state.addons.some(a => a.manifestId === item.manifestId || a.base === item.base);
          const card = document.createElement('div');
          card.className = 'p-2.5 rounded-xl bg-[#131825] border mac-border flex flex-col justify-between gap-1.5';
          card.innerHTML = `
            <div>
              <div class="flex items-center justify-between gap-1">
                <span class="font-bold text-slate-100 text-[11px] truncate">${esc(item.name)}</span>
                <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shrink-0">${esc(item.category)}</span>
              </div>
              <p class="text-[10px] text-slate-400 mt-0.5 line-clamp-2">${esc(item.desc)}</p>
            </div>
            <div class="flex items-center justify-end pt-1">
              <button type="button" data-store-install="${esc(item.id)}" class="px-2.5 py-1 rounded-lg text-[10px] font-bold mac-transition ${installed ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}">
                ${installed ? '✓ Instalado' : '+ Instalar 1-Clique'}
              </button>
            </div>
          `;
          const btn = card.querySelector('[data-store-install]');
          btn.addEventListener('click', async () => {
            if (installed) {
              showToast(`"${item.name}" já está instalado.`);
              return;
            }
            btn.disabled = true;
            btn.textContent = 'A instalar...';
            try {
              await installAddonFromUrl(item.base + '/manifest.json');
            } catch (e) {
              // Fallback direto caso o servidor do add-on bloqueie CORS no manifesto mas suporte streams
              const entry = { id: item.id, manifestId: item.manifestId, name: item.name, base: item.base, enabled: true, builtin: false };
              state.addons.push(entry);
              saveAddons(state.addons);
              renderAddonsList();
              showToast(`Add-on "${item.name}" adicionado!`);
            }
          });
          grid.appendChild(card);
        });
      }

      async function pingAllAddons() {
        const btn = document.getElementById('pingAllAddonsBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ A medir latência...'; }
        await Promise.all(state.addons.map(async (ad) => {
          const t0 = performance.now();
          try {
            const c = new AbortController();
            const timer = setTimeout(() => c.abort(), 4500);
            const res = await fetch(ad.base.replace(/\/+$/, '') + '/manifest.json', { signal: c.signal });
            clearTimeout(timer);
            const ms = Math.round(performance.now() - t0);
            state.addonPingMap[ad.id] = res.ok ? { ok: true, ms } : { ok: false, ms };
          } catch (e) {
            state.addonPingMap[ad.id] = { ok: false, ms: 0 };
          }
        }));
        if (btn) { btn.disabled = false; btn.textContent = '⚡ Testar Ligação (Ping ms)'; }
        renderAddonsList();
        showToast('Latência dos add-ons verificada!');
      }

      function applyTorrentioDebridConfig() {
        const provSel = document.getElementById('debridProviderSelect');
        const keyInp = document.getElementById('debridApiKeyInput');
        if (!provSel || !keyInp) return;
        const prov = provSel.value;
        const apiKey = keyInp.value.trim();
        state.debridProvider = prov;
        state.debridApiKey = apiKey;
        try {
          localStorage.setItem('ms_debrid_provider', prov);
          writeSecret('ms_debrid_key', apiKey);
        } catch (e) {}

        let base = 'https://torrentio.strem.fun';
        let name = 'Torrentio';
        if (prov !== 'none' && apiKey) {
          base = `https://torrentio.strem.fun/sort=qualitysize|${prov}=${encodeURIComponent(apiKey)}`;
          name = `Torrentio (${prov.toUpperCase()} ⚡)`;
        }
        const idx = state.addons.findIndex(a => a.manifestId === 'com.stremio.torrentio.addon' || a.id === 'builtin-torrentio');
        const entry = { id: 'builtin-torrentio', manifestId: 'com.stremio.torrentio.addon', name, base, enabled: true, builtin: true };
        if (idx >= 0) state.addons[idx] = entry;
        else state.addons.unshift(entry);
        saveAddons(state.addons);
        renderAddonsList();
        showToast(prov !== 'none' && apiKey ? `Torrentio configurado com ${prov.toUpperCase()}!` : 'Torrentio configurado em modo P2P Direto.');
      }

      function renderAddonsList() {
        const box = el.addonsListContainer;
        box.innerHTML = '';
        if (state.addons.length === 0) {
          box.innerHTML = '<p class="text-[11px] text-slate-400">Nenhum add-on instalado.</p>';
        }
        state.addons.forEach((ad, idx) => {
          let host = ad.base;
          try { host = new URL(ad.base).host + (new URL(ad.base).pathname.length > 1 ? '/•••' : ''); } catch (e) {}
          const ping = state.addonPingMap[ad.id];
          const pingBadge = ping
            ? (ping.ok
                ? `<span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">🟢 ${ping.ms}ms</span>`
                : `<span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">🔴 Offline</span>`)
            : '';

          const row = document.createElement('div');
          row.className = 'p-2.5 rounded-xl bg-[#131825] border mac-border flex items-center justify-between gap-2';

          const info = document.createElement('div');
          info.className = 'min-w-0 flex-1';
          info.innerHTML = `
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-mono text-indigo-400">#${idx + 1}</span>
              <p class="font-semibold text-slate-100 truncate">${esc(ad.name)}</p>
              ${pingBadge}
            </div>
            <p class="text-[10px] font-mono text-slate-400 truncate">${esc(host)}</p>
          `;

          const actions = document.createElement('div');
          actions.className = 'flex items-center gap-1.5 shrink-0';

          const upBtn = document.createElement('button');
          upBtn.type = 'button';
          upBtn.className = 'px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]';
          upBtn.textContent = '↑';
          upBtn.title = 'Subir prioridade';
          upBtn.disabled = idx === 0;
          upBtn.addEventListener('click', () => {
            if (idx <= 0) return;
            const tmp = state.addons[idx - 1];
            state.addons[idx - 1] = state.addons[idx];
            state.addons[idx] = tmp;
            saveAddons(state.addons);
            renderAddonsList();
          });

          const downBtn = document.createElement('button');
          downBtn.type = 'button';
          downBtn.className = 'px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]';
          downBtn.textContent = '↓';
          downBtn.title = 'Descer prioridade';
          downBtn.disabled = idx === state.addons.length - 1;
          downBtn.addEventListener('click', () => {
            if (idx >= state.addons.length - 1) return;
            const tmp = state.addons[idx + 1];
            state.addons[idx + 1] = state.addons[idx];
            state.addons[idx] = tmp;
            saveAddons(state.addons);
            renderAddonsList();
          });

          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.checked = ad.enabled !== false;
          toggle.className = 'w-4 h-4 accent-indigo-500 cursor-pointer';
          toggle.title = 'Ativar / desativar';
          toggle.addEventListener('change', () => {
            ad.enabled = toggle.checked;
            saveAddons(state.addons);
          });

          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white text-[11px]';
          del.textContent = '✕';
          del.title = 'Remover add-on';
          del.addEventListener('click', () => {
            state.addons = state.addons.filter(a => a.id !== ad.id);
            saveAddons(state.addons);
            renderAddonsList();
          });

          actions.appendChild(upBtn);
          actions.appendChild(downBtn);
          actions.appendChild(toggle);
          actions.appendChild(del);

          row.appendChild(info);
          row.appendChild(actions);
          box.appendChild(row);
        });

        const provSel = document.getElementById('debridProviderSelect');
        const keyInp = document.getElementById('debridApiKeyInput');
        if (provSel) provSel.value = state.debridProvider || 'none';
        if (keyInp) keyInp.value = state.debridApiKey || '';
        renderCuratedAddonsStore();
      }

      async function installAddonFromUrl(raw) {
        let url = String(raw || '').trim().replace(/^stremio:\/\//i, 'https://');
        if (!/^https?:\/\//i.test(url)) throw new Error('o URL tem de começar por https://');
        if (!/manifest\.json(\?.*)?$/i.test(url)) url = url.replace(/\/+$/, '') + '/manifest.json';

        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const manifest = await res.json();
        if (!manifest || !manifest.id) throw new Error('manifesto sem id');
        const resources = (manifest.resources || []).map(r => (typeof r === 'string' ? r : r && r.name));
        if (!resources.includes('stream')) throw new Error('este add-on não fornece streams');

        const base = url.replace(/\/manifest\.json.*$/i, '');
        const entry = { id: 'addon-' + hashStr(base), manifestId: manifest.id, name: manifest.name || manifest.id, base, enabled: true, builtin: false };
        const existing = state.addons.findIndex(a => a.manifestId === manifest.id || a.base === base);
        if (existing >= 0) state.addons[existing] = entry; else state.addons.push(entry);
        saveAddons(state.addons);
        renderAddonsList();
        showToast(`Add-on "${entry.name}" instalado!`);
        if (state.selectedItem && !el.detailModal.classList.contains('hidden')) scrapeStreamsForCurrentSelection();
      }

      async function toggleLibraryItem(item) {
        if (state.libraryMap[item.imdbId]) {
          delete state.libraryMap[item.imdbId];
          await CineDB.delete('library', item.imdbId);
          showToast(`"${item.title}" removido da Biblioteca`);
        } else {
          state.libraryMap[item.imdbId] = item;
          await CineDB.put('library', item);
          showToast(`"${item.title}" guardado na Biblioteca ♥`);
        }
        updateDockCounters();
        syncUserStateToDisk(false, true);
      }

      // =======================================================================
      // 15. INITIALIZATION
      // =======================================================================
      async function init() {
        await CineDB.init();

        // Hydrate Saved Watch Progress & Library from IndexedDB
        const savedProgress = await CineDB.getAll('watch_progress');
        savedProgress.forEach(p => {
          if (p && p.key) state.watchProgressMap[p.key] = p;
        });

        try {
          const lp = JSON.parse(localStorage.getItem('ms_lastpos') || 'null');
          const r = lp && state.watchProgressMap[lp.key];
          if (r && lp.updatedAt > (r.updatedAt || 0) && !r.completed) {
            r.currentTime = lp.currentTime; if (lp.duration) r.duration = lp.duration; r.updatedAt = lp.updatedAt;
            CineDB.put('watch_progress', r);
          }
          localStorage.removeItem('ms_lastpos');
        } catch (e) {}

        const savedLibrary = await CineDB.getAll('library');
        savedLibrary.forEach(item => {
          if (item && item.imdbId) state.libraryMap[item.imdbId] = item;
        });

        const kvCh = await CineDB.get('kv', 'channels');
        if (kvCh && Array.isArray(kvCh.value) && kvCh.value.length) {
          state.iptvChannels = kvCh.value;
        } else {
          const legacy = storage.get('macstream_channels', null);
          if (Array.isArray(legacy) && legacy.length) {
            state.iptvChannels = legacy;
            saveChannels(legacy);
          }
        }
        if (state.xtreamConfig.server) {
          el.headerSubStatus.textContent = `${state.xtreamConfig.profileName || 'Xtream'} • ${state.iptvChannels.length} canais IPTV + Cine`;
        }

        updateIptvCounts();
        if (!state.iptvCurrentChannelId && state.iptvChannels.length > 0) {
          state.iptvCurrentChannelId = state.iptvChannels[0].id;
        }

        if (window.macstreamApp) {
          const pills = document.querySelector('.play-mode-pill').parentElement;
          const wtPill = pills && pills.querySelector('[data-playmode="webtorrent"]');
          if (wtPill) wtPill.classList.add('hidden');
          const helpWtBtn = document.getElementById('helpTryWebtorrentBtn');
          if (helpWtBtn) helpWtBtn.classList.add('hidden');
          const enginePill = document.createElement('button');
          enginePill.type = 'button';
          enginePill.setAttribute('data-playmode', 'engine');
          enginePill.className = 'play-mode-pill px-3 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:text-white mac-transition shrink-0';
          enginePill.title = 'Motor P2P interno da app (TCP/UDP/DHT) — não precisa do Stremio';
          enginePill.textContent = '⚡ Motor da App';
          pills.insertBefore(enginePill, pills.firstChild);
          document.getElementById('helpCompatBtn').classList.remove('hidden');
          document.getElementById('helpCompatBtn').addEventListener('click', () => {
            switchPlayerEngineMode('compat', pbCur() || 0);
          });
        }
        await hydrateUserStateFromDisk();
        bindEvents();
        renderAllSections();
        syncUserStateToDisk(true);
        syncCatalogFromApis(false);
        startIptvWatchdogLoop();
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
