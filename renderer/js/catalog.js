'use strict';
      // =======================================================================
      const TMDB_GENRES = {
        28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
        14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller',
        10770: 'TV Movie', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
        10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
      };

      async function syncCatalogFromApis(forceRefresh = false) {
        el.syncIcon.classList.add('animate-spin');
        try {
          if (!forceRefresh) {
            const cached = await CineDB.get('catalog_cache', 'main_feed');
            if (cached && cached.items && (Date.now() - cached.timestamp < 1000 * 60 * 30)) {
              mergeCatalogItems(cached.items);
              return;
            }
          }

          const fetchedItems = [];

          // 1. Se houver chave TMDB v3, vai buscar tendências em pt-PT
          if (state.tmdbApiKey && state.tmdbApiKey.trim().length > 10) {
            el.activeMetadataProviderLabel.textContent = 'TMDB API v3 (pt-PT)';
            const key = encodeURIComponent(state.tmdbApiKey.trim());
            const [movRes, tvRes] = await Promise.all([
              fetch(`https://api.themoviedb.org/3/trending/movie/week?api_key=${key}&language=pt-PT`).catch(() => null),
              fetch(`https://api.themoviedb.org/3/trending/tv/week?api_key=${key}&language=pt-PT`).catch(() => null)
            ]);

            if (movRes && movRes.ok) {
              const data = await movRes.json();
              (data.results || []).slice(0, 15).forEach(m => {
                fetchedItems.push({
                  imdbId: 'tmdb-m-' + m.id,
                  tmdbId: m.id,
                  type: 'movie',
                  title: m.title || m.original_title,
                  year: (m.release_date || '').slice(0, 4) || '—',
                  rating: m.vote_average ? m.vote_average.toFixed(1) : '—',
                  runtime: '',
                  genres: (m.genre_ids || []).map(g => TMDB_GENRES[g]).filter(Boolean),
                  poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
                  backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : '',
                  plot: m.overview || 'Sem sinopse disponível em português.',
                  cast: 'Catálogo TMDB'
                });
              });
            }

            if (tvRes && tvRes.ok) {
              const data = await tvRes.json();
              (data.results || []).slice(0, 15).forEach(t => {
                fetchedItems.push({
                  imdbId: 'tmdb-s-' + t.id,
                  tmdbId: t.id,
                  type: 'series',
                  title: t.name || t.original_name,
                  year: (t.first_air_date || '').slice(0, 4) || '—',
                  rating: t.vote_average ? t.vote_average.toFixed(1) : '—',
                  runtime: '',
                  genres: (t.genre_ids || []).map(g => TMDB_GENRES[g]).filter(Boolean),
                  poster: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : '',
                  backdrop: t.backdrop_path ? `https://image.tmdb.org/t/p/w1280${t.backdrop_path}` : '',
                  plot: t.overview || 'Sem sinopse disponível em português.',
                  cast: 'Catálogo TMDB',
                  seasonsCount: 3
                });
              });
            }
          }

          // 2. Catálogo público Stremio Cinemeta (IDs IMDb reais: tt...)
          const [cinemetaMovies, cinemetaSeries] = await Promise.all([
            fetch('https://v3-cinemeta.strem.io/catalog/movie/top.json').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('https://v3-cinemeta.strem.io/catalog/series/top.json').then(r => r.ok ? r.json() : null).catch(() => null)
          ]);

          if (cinemetaMovies && Array.isArray(cinemetaMovies.metas)) {
            cinemetaMovies.metas.slice(0, 24).forEach(m => {
              if (!m.id) return;
              fetchedItems.push(metaToItem(m, 'movie'));
            });
          }
          if (cinemetaSeries && Array.isArray(cinemetaSeries.metas)) {
            cinemetaSeries.metas.slice(0, 24).forEach(s => {
              if (!s.id) return;
              fetchedItems.push(metaToItem(s, 'series'));
            });
          }

          if (fetchedItems.length > 0) {
            mergeCatalogItems(fetchedItems);
            await CineDB.put('catalog_cache', {
              cacheKey: 'main_feed',
              timestamp: Date.now(),
              items: state.catalog.slice(0, 300)
            });
            if (forceRefresh) {
              showToast(`Catálogo atualizado: ${state.catalog.length} títulos!`);
            }
          } else if (forceRefresh) {
            showToast('Sem ligação ao Cinemeta — a usar o catálogo offline.');
          }
        } catch (e) {
          // Fallback silencioso para o catálogo curado
        } finally {
          el.syncIcon.classList.remove('animate-spin');
          renderAllSections();
        }
      }

      function metaToItem(m, type) {
        return {
          imdbId: m.id,
          type,
          title: m.name,
          year: String(m.releaseInfo || m.year || '').slice(0, 4) || '—',
          rating: m.imdbRating || '—',
          runtime: m.runtime || '',
          genres: Array.isArray(m.genres) && m.genres.length ? m.genres : [type === 'series' ? 'Series' : 'Movie'],
          poster: m.poster || `https://images.metahub.space/poster/medium/${m.id}/img`,
          backdrop: m.background || `https://images.metahub.space/background/medium/${m.id}/img`,
          plot: m.description || 'Sem sinopse disponível.',
          cast: Array.isArray(m.cast) ? m.cast.slice(0, 4).join(', ') : '',
          seasonsCount: type === 'series' ? 3 : undefined
        };
      }

      // Itens novos (mais frescos) substituem os antigos com o mesmo ID, mantendo a ordem
      function mergeCatalogItems(newItems) {
        const map = new Map();
        state.catalog.forEach(item => map.set(item.imdbId, item));
        newItems.forEach(item => {
          if (!item || !item.imdbId) return;
          const old = map.get(item.imdbId);
          map.set(item.imdbId, old ? { ...old, ...item } : item);
        });
        state.catalog = Array.from(map.values());
      }

      // Converte um item TMDB (sem ID IMDb) em ID IMDb real para poder procurar streams
      async function ensureImdbId(item) {
        if (!item || (item.imdbId && item.imdbId.startsWith('tt')) || !item.tmdbId || !state.tmdbApiKey) return;
        try {
          const kind = item.type === 'series' ? 'tv' : 'movie';
          const res = await fetch(`https://api.themoviedb.org/3/${kind}/${item.tmdbId}/external_ids?api_key=${encodeURIComponent(state.tmdbApiKey.trim())}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data && data.imdb_id) {
            item.imdbId = data.imdb_id;
            el.detailImdbIdTag.textContent = item.imdbId;
          }
        } catch (e) {}
      }

      // Live Search via Stremio Cinemeta API when user types in Spotlight Search
      let searchDebounceTimer = null;
      async function performLiveMetaSearch(query) {
        const v = String(query || '').trim();
        if (v.length < 3 || v === state.searchCommitted) return;
        CAT.fallbacks = [];
        state.searchCommitted = v;
        renderCatalogGrid();
        renderHomeRows();
      }

      // =======================================================================
      // 7. RENDER CONTINUAR A VER (INDEXEDDB) & MAIN CATALOG GRID
      // =======================================================================
      function updateDockCounters() {
        const progressList = Object.values(state.watchProgressMap).filter(p => !p.completed && p.currentTime > 5);
        el.dockContinueBadge.textContent = String(progressList.length);
        el.dockContinueBadge.classList.toggle('hidden', progressList.length === 0);

        const libCount = Object.keys(state.libraryMap).length;
        el.dockLibraryBadge.textContent = String(libCount);
        el.dockLibraryBadge.classList.toggle('hidden', libCount === 0);
      }

      function renderContinueWatchingRow() {
        const bySeries = {};
        const cwList = [];
        Object.values(state.watchProgressMap).forEach(r => {
          if (r.type === 'series') {
            const cur = bySeries[r.imdbId];
            if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) bySeries[r.imdbId] = r;
          } else if (r.currentTime > 3 && !r.completed) cwList.push(r);
        });
        state.cwMaps = state.cwMaps || {};
        Object.values(bySeries).forEach(r => {
          if (!r.completed) { if (r.currentTime > 3) cwList.push(r); return; }
          if (r.dismissed) return;
          const map = state.episodesCache[r.imdbId] || state.cwMaps[r.imdbId];
          if (!map) {
            if (state.cwMaps[r.imdbId] === undefined) {
              state.cwMaps[r.imdbId] = null;
              getSeriesEpisodesMap({ imdbId: r.imdbId, backdrop: r.backdrop, poster: r.poster })
                .then(m => { state.cwMaps[r.imdbId] = m; renderContinueWatchingRow(); }).catch(() => {});
            }
            return;
          }
          const next = computeAdjacentEpisode({ item: { imdbId: r.imdbId }, season: r.season, episode: r.episode }, 1, map);
          if (next) cwList.push({ ...r, isNext: true, nextOf: r, season: next.season, episode: next.episode, episodeTitle: next.title, currentTime: 0, duration: 0 });
        });
        const allProgress = cwList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        updateDockCounters();

        if (allProgress.length === 0) {
          el.continueWatchingSection.classList.add('hidden');
          return;
        }

        el.continueWatchingSection.classList.remove('hidden');
        el.continueWatchingGrid.innerHTML = '';

        allProgress.slice(0, 10).forEach(prog => {
          const pct = prog.isNext ? 0 : (prog.duration > 0 ? Math.min(98, Math.round((prog.currentTime / prog.duration) * 100)) : 25);
          const sNum = prog.season || 1, eNum = prog.episode || 1;
          const epCode = `S${pad2(sNum)}E${pad2(eNum)}`;
          const cInfo = findCacheEntryForItem(prog.imdbId, sNum, eNum, prog.infoHash);
          const cachePct = cInfo ? Math.round((cInfo.progress || 0) * 100) : 0;

          // S4: Calcula quantos episódios faltam na temporada atual se o mapa já estiver em memória
          let remEpsLabel = '';
          if (prog.type === 'series') {
            const sMap = state.episodesCache[prog.imdbId] || (state.cwMaps && state.cwMaps[prog.imdbId]);
            if (sMap && Array.isArray(sMap[sNum])) {
              const leftCount = sMap[sNum].filter(x => x.episode >= eNum && !isEpisodeWatched(prog.imdbId, sNum, x.episode)).length;
              if (leftCount > 0) remEpsLabel = `Faltam ${leftCount} ep na T${sNum}`;
            }
          }

          const card = document.createElement('div');
          card.className = 'ms-cw-card group';

          card.innerHTML = `
            <div class="ms-cw-thumb">
              <img src="${esc(prog.backdrop || prog.poster)}" alt="${esc(prog.title)}" loading="lazy" decoding="async" data-fb="${esc(localPosterSvg('Retomar', 480, 270))}" />
              <div class="absolute inset-0 bg-gradient-to-t from-[#0b0f19] via-transparent to-black/35"></div>
              <div class="absolute top-2 left-2.5">
                ${cInfo ? `<span class="px-1.5 py-0.5 rounded bg-emerald-500/90 text-slate-950 font-mono font-bold text-[10px]">⚡ ${cachePct}%</span>` : ''}
              </div>
              <button type="button" class="remove-progress-btn opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2 w-5 h-5 rounded-md bg-black/75 hover:bg-rose-600 text-slate-300 hover:text-white text-[10px] flex items-center justify-center" title="Remover de Continuar a Ver">✕</button>
            </div>
            <div class="p-2.5 space-y-1.5">
              <div class="flex items-center justify-between gap-1.5">
                <h4 class="text-xs font-bold text-white truncate">${esc(prog.title)}</h4>
                ${prog.type === 'series' ? `<button type="button" class="cw-ep-picker-btn px-1.5 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/35 font-mono text-[10px] font-bold shrink-0" title="Escolher outro episódio ou temporada">${epCode} ▾</button>` : ''}
              </div>
              <div class="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span class="truncate">${esc(prog.episodeTitle || prog.streamTitle || (prog.isNext ? 'Próximo episódio' : 'Retomar'))}</span>
                <span class="font-mono text-[10px] text-slate-300 shrink-0">${prog.duration > 0 && !prog.isNext ? Math.max(1, Math.round((prog.duration - prog.currentTime) / 60)) + 'm rest.' : (prog.isNext ? 'Novo' : pct + '%')}</span>
              </div>
              <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                <div class="h-full bg-indigo-500 rounded-full" style="width: ${prog.isNext ? 8 : pct}%"></div>
              </div>
            </div>
            <!-- S1: Mini-seletor de Episódio Inline -->
            <div class="ms-ep-quick-pop hidden">
              <div class="flex items-center justify-between text-[11px] font-bold text-white">
                <span class="truncate">Escolher episódio • ${esc(prog.title)}</span>
                <button type="button" class="cw-pop-close text-slate-400 hover:text-white px-1">✕</button>
              </div>
              <div class="space-y-1.5 my-auto">
                <select class="cw-pop-season w-full bg-[#131825] border mac-border rounded-lg px-2 py-1 text-[11px] text-white"></select>
                <select class="cw-pop-ep w-full bg-[#131825] border mac-border rounded-lg px-2 py-1 text-[11px] text-white"></select>
              </div>
              <div class="flex items-center gap-1.5">
                <button type="button" class="cw-pop-play flex-1 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold">▶ Reproduzir</button>
                <button type="button" class="cw-pop-cache px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-bold" title="Guardar na Cache">⚡ Cache</button>
              </div>
            </div>
          `;

          card.addEventListener('click', async (ev) => {
            if (ev.target.closest('.ms-ep-quick-pop')) {
              ev.stopPropagation();
              return;
            }
            if (ev.target.closest('.remove-progress-btn')) {
              ev.stopPropagation();
              if (prog.type === 'series') {
                Object.values(state.watchProgressMap).filter(r => r.imdbId === prog.imdbId && !r.completed).forEach(r => {
                  delete state.watchProgressMap[r.key]; CineDB.delete('watch_progress', r.key);
                });
                if (prog.isNext && prog.nextOf) { prog.nextOf.dismissed = true; CineDB.put('watch_progress', prog.nextOf); }
              } else {
                delete state.watchProgressMap[prog.key];
                CineDB.delete('watch_progress', prog.key);
              }
              renderContinueWatchingRow();
              renderCatalogGrid();
              showToast('Removido de Continuar a Ver');
              return;
            }
            if (ev.target.closest('.cw-ep-picker-btn')) {
              ev.stopPropagation();
              const pop = card.querySelector('.ms-ep-quick-pop');
              const sSel = card.querySelector('.cw-pop-season');
              const eSel = card.querySelector('.cw-pop-ep');
              pop.classList.remove('hidden');
              sSel.innerHTML = '<option>A carregar…</option>';
              const it = knownItem(prog.imdbId) || { imdbId: prog.imdbId, type: 'series', title: prog.title, poster: prog.poster, backdrop: prog.backdrop, seasonsCount: 4 };
              const map = await getSeriesEpisodesMap(it);
              const seasons = Object.keys(map).map(Number).sort((a, b) => a - b);
              sSel.innerHTML = seasons.map(s => `<option value="${s}" ${s === sNum ? 'selected' : ''}>Temporada ${s}</option>`).join('');
              const fillEps = (sn) => {
                const eps = map[sn] || [];
                eSel.innerHTML = eps.map(e => `<option value="${e.episode}" ${sn === sNum && e.episode === eNum ? 'selected' : ''}>E${pad2(e.episode)} — ${esc(e.title || ('Episódio ' + e.episode))}</option>`).join('');
              };
              fillEps(sNum);
              sSel.onchange = () => fillEps(Number(sSel.value));
              card.querySelector('.cw-pop-close').onclick = (e2) => { e2.stopPropagation(); pop.classList.add('hidden'); };
              card.querySelector('.cw-pop-play').onclick = (e2) => {
                e2.stopPropagation();
                const sn = Number(sSel.value) || 1, en = Number(eSel.value) || 1;
                const epObj = (map[sn] || []).find(x => x.episode === en);
                pop.classList.add('hidden');
                quickPlayItemDirect(it, sn, en, 0, epObj ? epObj.title : '');
              };
              card.querySelector('.cw-pop-cache').onclick = (e2) => {
                e2.stopPropagation();
                const sn = Number(sSel.value) || 1, en = Number(eSel.value) || 1;
                const epObj = (map[sn] || []).find(x => x.episode === en);
                pop.classList.add('hidden');
                preloadItemToCache(it, sn, en, epObj ? epObj.title : '');
              };
              return;
            }
            resumeSavedProgressItem(prog);
          });

          el.continueWatchingGrid.appendChild(card);
        });
      }

      async function resumeSavedProgressItem(prog) {
        const item = state.catalog.find(c => c.imdbId === prog.imdbId) || {
          imdbId: prog.imdbId,
          type: prog.type || 'movie',
          title: prog.title,
          year: '',
          rating: '—',
          poster: prog.poster,
          backdrop: prog.backdrop,
          plot: ''
        };

        // Os links diretos expiram e os seeders mudam: procura sempre uma fonte fresca com a mesma qualidade
        let stream = null;
        try {
          showToast('A procurar fonte para retomar...');
          const streams = await fetchStreamsFor(item, prog.season || 1, prog.episode || 1);
          stream = pickBestStream(streams, prog.streamResolution, Boolean(prog.streamDirect));
        } catch (e) {}

        if (!stream && (prog.magnetUri || prog.infoHash)) {
          stream = {
            addon: 'Fonte guardada',
            title: prog.streamTitle || 'Stream guardado',
            resolution: prog.streamResolution || '1080p',
            seeders: null,
            size: '—',
            magnetUri: prog.magnetUri || '',
            infoHash: prog.infoHash || '',
            fileIdx: prog.fileIdx,
            directUrl: ''
          };
        }

        if (!stream) {
          showToast('Sem fontes disponíveis — escolhe uma no ecrã do título.');
          openDetailDrawer(item);
          return;
        }

        launchVideoPlayer({
          item,
          season: prog.season || 1,
          episode: prog.episode || 1,
          episodeTitle: prog.episodeTitle || '',
          stream,
          resumeSeconds: prog.currentTime || 0
        });
      }

      function getFilteredCatalog() {
        let list = [...state.catalog];

        if (state.activeNav === 'movies') {
          list = list.filter(i => i.type === 'movie');
        } else if (state.activeNav === 'series') {
          list = list.filter(i => i.type === 'series');
        } else if (state.activeNav === 'continue') {
          const activeIds = new Set(Object.values(state.watchProgressMap).filter(p => p.currentTime > 3).map(p => p.imdbId));
          list = list.filter(i => activeIds.has(i.imdbId));
        } else if (state.activeNav === 'library') {
          list = Object.values(state.libraryMap);
        }

        if (state.activeGenre !== 'ALL') {
          list = list.filter(i => Array.isArray(i.genres) && i.genres.some(g => g.toLowerCase().includes(state.activeGenre.toLowerCase())));
        }

        if (state.searchQuery.trim() !== '') {
          const q = state.searchQuery.toLowerCase().trim();
          list = list.filter(i =>
            (i.title && i.title.toLowerCase().includes(q)) ||
            (i.imdbId && i.imdbId.toLowerCase().includes(q)) ||
            (i.cast && i.cast.toLowerCase().includes(q))
          );
        }

        list = catApplyClient(list);

        if (state.sortBy === 'rating') {
          list.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
        } else if (state.sortBy === 'year') {
          list.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
        }

        return list;
      }

      // =======================================================================
      // CATÁLOGO: páginas do Cinemeta (scroll infinito), filtros, temas e pesquisa tolerante
      // =======================================================================
      const GENRES_ALL = [['Action', 'Ação'], ['Adventure', 'Aventura'], ['Animation', 'Animação'], ['Biography', 'Biografia'], ['Comedy', 'Comédia'], ['Crime', 'Crime'], ['Documentary', 'Documentário'], ['Drama', 'Drama'], ['Family', 'Família'], ['Fantasy', 'Fantasia'], ['History', 'História'], ['Horror', 'Terror'], ['Music', 'Música'], ['Mystery', 'Mistério'], ['Romance', 'Romance'], ['Sci-Fi', 'Ficção Científica'], ['Sport', 'Desporto'], ['Thriller', 'Suspense'], ['War', 'Guerra'], ['Western', 'Western']];
      const CAT_YEAR_NOW = new Date().getFullYear();
      const CAT_THEMES = [
        { id: 'hot', label: '🔥 Em alta', sort: 'popular' },
        { id: 'new', label: '🆕 Estreias recentes', sort: 'year', kind: 'year', yearMin: CAT_YEAR_NOW - 1 },
        { id: 'classics', label: '🏆 Clássicos', sort: 'rating', yearMax: 1995, minRating: 7.5 },
        { id: 'gems', label: '💎 Joias escondidas', sort: 'rating', startSkip: 100, minRating: 7.5 },
        { id: 'docs', label: '🎞 Documentários', genre: 'Documentary', sort: 'popular' },
        { id: 'anim', label: '✨ Animação', genre: 'Animation', sort: 'popular' },
        { id: 'family', label: '👨‍👩‍👧 Família', genre: 'Family', sort: 'popular' },
        { id: 'horror', label: '😱 Terror', genre: 'Horror', sort: 'popular' }
      ];
      const CAT = { key: '', gen: 0, src: [], loading: false, done: false, sentVisible: false, chain: 0, note: '', fallbacks: [], err: false, renderedKey: '', rendered: 0, firstId: '' };

      function catFilters() { return state.catFilters || (state.catFilters = lsGet('ms_catfilters', {}) || {}); }
      function saveCatFilters() { lsSet('ms_catfilters', catFilters()); }
      function catFiltersActive() { const f = catFilters(); return !!(f.yearMin || f.yearMax || f.minRating || f.hideSeen || f.theme); }
      function isRemoteCatalog() { return state.appMode === 'cine' && ['discover', 'movies', 'series'].includes(state.activeNav); }
      function catSearch() { return state.searchCommitted || ''; }
      function catNorm(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
      function catParseSearch(q) { const m = /^(.*\S)\s+((?:19|20)\d{2})$/.exec(String(q || '').trim()); return m ? { text: m[1], year: m[2] } : { text: String(q || '').trim(), year: '' }; }
      function catSeenSet() {
        const ids = new Set();
        Object.values(state.watchProgressMap).forEach(r => { if (r && r.imdbId && (r.completed || (r.type === 'series' && r.currentTime > 120))) ids.add(r.imdbId); });
        return ids;
      }
      function catKey() { return JSON.stringify([state.activeNav, state.activeGenre, state.sortBy || 'popular', catSearch(), catFilters().theme || '', CAT.fallbacks.length]); }

      function catBuildSources(override) {
        const types = state.activeNav === 'movies' ? ['movie'] : state.activeNav === 'series' ? ['series'] : ['movie', 'series'];
        const sort = state.sortBy || 'popular';
        const q = catParseSearch(catSearch());
        const text = override || q.text;
        const th = CAT_THEMES.find(t => t.id === catFilters().theme);
        if (text && /^tt\d{6,}$/i.test(text)) return types.map(type => ({ type, special: 'imdb', id: text, items: [], skip: 0, done: false }));
        const kind = text ? 'top' : ((th && th.kind) || (sort === 'rating' ? 'imdbRating' : sort === 'year' ? 'year' : 'top'));
        return types.map(type => ({ type, kind, genre: (!text && state.activeGenre !== 'ALL') ? state.activeGenre : '', search: text, skip: (!text && th && th.startSkip) || 0, items: [], done: false, err: 0 }));
      }
      function catUrl(s) {
        const ex = [];
        if (s.search) ex.push('search=' + encodeURIComponent(s.search));
        if (s.genre) ex.push('genre=' + encodeURIComponent(s.genre));
        if (s.skip) ex.push('skip=' + s.skip);
        return `https://v3-cinemeta.strem.io/catalog/${s.type}/${s.kind}${ex.length ? '/' + ex.join('&') : ''}.json`;
      }
      async function catFetchPage(s) {
        if (s.special === 'imdb') {
          try {
            const r = await fetch(`https://v3-cinemeta.strem.io/meta/${s.type}/${s.id}.json`);
            const d = r.ok ? await r.json() : null;
            return { items: d && d.meta && d.meta.id ? [metaToItem(d.meta, s.type)] : [], raw: 0, last: true };
          } catch (e) { return null; }
        }
        const url = catUrl(s), key = 'cat:' + url;
        try {
          const c = await CineDB.get('catalog_cache', key);
          if (c && c.items && Date.now() - c.timestamp < 6 * 3600e3) return { items: c.items, raw: c.raw || c.items.length };
        } catch (e) {}
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          const d = await r.json();
          const metas = Array.isArray(d.metas) ? d.metas : [];
          const items = metas.filter(m => m && m.id && String(m.id).startsWith('tt')).map(m => metaToItem(m, s.type));
          try { await CineDB.put('catalog_cache', { cacheKey: key, timestamp: Date.now(), items, raw: metas.length }); } catch (e) {}
          return { items, raw: metas.length };
        } catch (e) { return null; }
      }

      function catStatus() {
        const box = document.getElementById('catalogSentinel');
        if (!box) return;
        const n = catView().length;
        if (CAT.loading) box.textContent = 'A carregar mais…';
        else if (CAT.err && !CAT.src.some(s => s.items.length)) box.textContent = 'Sem ligação ao Cinemeta — a mostrar o catálogo guardado.';
        else if (CAT.done && n) box.textContent = `— fim: ${n} títulos —`;
        else box.textContent = CAT.note || '';
        if (CAT.note && !CAT.loading && n) box.textContent = CAT.note;
      }

      function catEnsure() {
        const k = catKey();
        if (k === CAT.key) return;
        CAT.key = k; CAT.gen++;
        CAT.src = catBuildSources(CAT.fallbacks.length ? CAT.fallbacks[CAT.fallbacks.length - 1] : '');
        CAT.done = false; CAT.loading = false; CAT.err = false; CAT.chain = 0; CAT.renderedKey = '';
        if (!CAT.fallbacks.length) CAT.note = '';
        catLoadMore();
      }

      async function catLoadMore() {
        if (CAT.loading || CAT.done) return;
        const gen = CAT.gen;
        CAT.loading = true;
        catStatus();
        try {
          const before = catView().length;
          for (let round = 0; round < 6; round++) {
            const live = CAT.src.filter(s => !s.done);
            if (!live.length) { CAT.done = true; break; }
            const pages = await Promise.all(live.map(s => catFetchPage(s)));
            if (gen !== CAT.gen) return;
            const added = [];
            live.forEach((s, i) => {
              const pg = pages[i];
              if (!pg) { s.err = (s.err || 0) + 1; CAT.err = true; if (s.err >= 2) s.done = true; return; }
              if (!pg.raw && !pg.items.length) { s.done = true; return; }
              const seen = new Set(CAT.src.flatMap(x => x.items.map(it => it.imdbId)));
              pg.items.forEach(it => { if (!seen.has(it.imdbId)) { seen.add(it.imdbId); s.items.push(it); added.push(it); } });
              s.skip += pg.raw || pg.items.length;
              if (pg.last || !(pg.raw || pg.items.length)) s.done = true;
            });
            if (added.length) mergeCatalogItems(added);
            if (CAT.src.every(s => s.done)) CAT.done = true;
            if (CAT.done || catView().length - before >= 24) break;
          }
        } catch (e) {
          CAT.err = true;
        } finally {
          if (gen === CAT.gen) CAT.loading = false;
        }
        if (gen !== CAT.gen) return;
        // pesquisa sem resultados: tenta variantes (sem acentos, palavra mais longa)
        if (CAT.done && catSearch() && !CAT.src.some(s => s.items.length) && !CAT.err) {
          const text = catParseSearch(catSearch()).text;
          const tried = new Set([catNorm(text), ...CAT.fallbacks.map(catNorm)]);
          const cands = [];
          const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
          if (plain !== text) cands.push(plain);
          const longest = text.split(/\s+/).filter(w => w.length >= 4).sort((x, y) => y.length - x.length)[0];
          if (longest) cands.push(longest);
          if (text.length > 5) cands.push(text.slice(0, -1));
          const next = cands.find(c => !tried.has(catNorm(c)));
          if (next) {
            CAT.fallbacks.push(next);
            CAT.note = `Sem resultados para «${text}» — a mostrar «${next}»`;
            CAT.key = ''; // força nova montagem
            CAT.loading = false;
            renderCatalogGrid();
            return;
          }
        }
        renderCatalogGrid();
        catStatus();
      }

      function catApplyClient(list) {
        const f = catFilters();
        const seen = f.hideSeen ? catSeenSet() : null;
        const q = catParseSearch(catSearch());
        const g = state.activeGenre !== 'ALL' ? state.activeGenre.toLowerCase() : '';
        return list.filter(it => {
          const y = parseInt(String(it.year || '').slice(0, 4), 10) || 0;
          if (f.yearMin && y < f.yearMin) return false;
          if (f.yearMax && y > f.yearMax) return false;
          if (f.minRating && (parseFloat(it.rating) || 0) < f.minRating) return false;
          if (q.year && y && String(y) !== q.year) return false;
          if (g && !(Array.isArray(it.genres) && it.genres.some(x => String(x).toLowerCase().includes(g)))) return false;
          if (seen && seen.has(it.imdbId)) return false;
          return true;
        });
      }

      function catView() {
        const sort = state.sortBy || 'popular';
        const per = CAT.src.map(s => s.items);
        let list = [];
        if (sort === 'popular' || catSearch()) {
          const n = Math.max(0, ...per.map(a => a.length));
          for (let i = 0; i < n; i++) per.forEach(a => { if (a[i]) list.push(a[i]); });
        } else {
          list = per.flat();
          if (sort === 'rating') list.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
          else if (sort === 'year') list.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
        }
        if (catSearch()) {
          // atores/realizadores: títulos já conhecidos em que o nome aparece no elenco
          const t = catNorm(catParseSearch(catSearch()).text);
          if (t.length >= 4) {
            const have = new Set(list.map(i => i.imdbId));
            const pool = [...state.catalog, ...Object.values(state.home.known || {})];
            const cast = [];
            pool.forEach(i => { if (i && i.cast && !have.has(i.imdbId) && catNorm(i.cast).includes(t)) { have.add(i.imdbId); cast.push(i); } });
            list = [...list, ...cast];
          }
        }
        return catApplyClient(list);
      }

      function catLev(a, b) {
        if (a === b) return 0;
        const m = a.length, n = b.length;
        if (!m || !n) return Math.max(m, n);
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) {
          const cur = [i];
          for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          prev = cur;
        }
        return prev[n];
      }
      function catDidYouMean(text) {
        const t = catNorm(text);
        if (t.length < 4) return '';
        let best = '', bd = 99;
        const pool = [...state.catalog, ...Object.values(state.home.known || {})];
        pool.forEach(i => {
          if (!i || !i.title) return;
          const n = catNorm(i.title);
          const d = Math.min(catLev(t, n), ...n.split(' ').filter(w => w.length >= 4).map(w => catLev(t, w)));
          if (d < bd) { bd = d; best = i.title; }
        });
        return bd <= Math.max(2, Math.floor(t.length * 0.34)) ? best : '';
      }

      function catCardInfo() {
        const info = {};
        Object.values(state.watchProgressMap).forEach(r => {
          if (!r || !r.imdbId) return;
          const o = info[r.imdbId] || (info[r.imdbId] = { done: false, part: null, ep: null });
          if (r.type === 'series') {
            if ((r.completed || r.currentTime > 60) && (!o.ep || epCmp(r.season || 1, r.episode || 1, o.ep.season || 1, o.ep.episode || 1) > 0)) o.ep = r;
          } else if (r.completed) o.done = true;
          else if (r.currentTime > 60 && r.duration > 0) o.part = r;
        });
        return info;
      }

      function bindCardQuickActions(cardEl, item, epMeta = null) {
        cardEl.addEventListener('click', async (ev) => {
          const qaBtn = ev.target.closest('[data-qa]');
          if (!qaBtn) {
            openDetailDrawer(item);
            return;
          }
          ev.stopPropagation();
          const act = qaBtn.getAttribute('data-qa');
          const sNum = epMeta && epMeta.season ? epMeta.season : undefined;
          const eNum = epMeta && epMeta.episode ? epMeta.episode : undefined;
          const epTitle = epMeta && epMeta.title ? epMeta.title : '';
          if (act === 'play') {
            await quickPlayItemDirect(item, sNum, eNum, 0, epTitle);
          } else if (act === 'cache') {
            await preloadItemToCache(item, sNum, eNum, epTitle);
          } else if (act === 'lib') {
            await toggleLibraryItem(item);
            const inLib = Boolean(state.libraryMap[item.imdbId]);
            qaBtn.textContent = inLib ? '♥' : '＋';
            qaBtn.classList.toggle('active-lib', inLib);
          } else if (act === 'seen') {
            const key = getProgressKey(item.imdbId, item.type, sNum || 1, eNum || 1);
            const cur = state.watchProgressMap[key];
            const nextVal = !(cur && cur.completed);
            const rec = { key, imdbId: item.imdbId, title: item.title, type: item.type, poster: item.poster, backdrop: item.backdrop, season: sNum || 1, episode: eNum || 1, currentTime: nextVal ? 3600 : 0, duration: 3600, completed: nextVal, updatedAt: Date.now() };
            state.watchProgressMap[key] = rec;
            await CineDB.put('watch_progress', rec);
            qaBtn.classList.toggle('active-seen', nextVal);
            showToast(nextVal ? `"${item.title}" marcado como Visto ✓` : `"${item.title}" marcado como por ver`);
            renderContinueWatchingRow();
            renderCatalogGrid();
          }
        });
      }

      function buildCatalogCard(item, info) {
        const st = info[item.imdbId] || {};
        const inLib = Boolean(state.libraryMap[item.imdbId]);
        const cEntry = findCacheEntryForItem(item.imdbId);
        let mark = '';
        if (cEntry) mark = `<div class="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-mono font-bold text-[10px] pointer-events-none">⚡ ${Math.round((cEntry.progress || 0) * 100)}%</div>`;
        else if (item.type === 'series' && st.ep) mark = `<div class="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-indigo-500 text-white font-bold text-[10px] pointer-events-none">▶ S${pad2(st.ep.season || 1)}E${pad2(st.ep.episode || 1)}</div>`;
        else if (st.done) mark = `<div class="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-bold text-[10px] pointer-events-none">✓ VISTO</div>`;

        const card = document.createElement('div');
        card.className = 'poster-card group relative rounded-xl overflow-hidden bg-[#111726] border mac-border cursor-pointer flex flex-col';
        card.innerHTML = `
          <div class="relative aspect-[2/3] w-full bg-slate-900 overflow-hidden">
            <img src="${esc(item.poster)}" alt="${esc(item.title)}" loading="lazy" decoding="async" class="w-full h-full object-cover"
              data-fb="${esc(localPosterSvg(item.title, 300, 450))}" />
            <div class="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
              <span class="px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-bold uppercase ${item.type === 'series' ? 'text-purple-300' : 'text-indigo-300'}">${item.type === 'series' ? 'Série' : 'Filme'}</span>
              <span class="px-1.5 py-0.5 rounded bg-black/80 text-amber-300 font-mono text-[10px] font-bold">★ ${esc(item.rating || '—')}</span>
            </div>
            ${mark}
            <div class="ms-clean-dock">
              <button type="button" data-qa="play" class="ms-qa-play" title="Reproduzir imediatamente">▶ Ver</button>
              <button type="button" data-qa="cache" class="ms-qa-ico ${cEntry ? 'active-cache' : ''}" title="Guardar na pasta de Cache">⚡</button>
              <button type="button" data-qa="lib" class="ms-qa-ico ${inLib ? 'active-lib' : ''}" title="Biblioteca">${inLib ? '♥' : '＋'}</button>
              <button type="button" data-qa="seen" class="ms-qa-ico ${st.done ? 'active-seen' : ''}" title="Marcar Visto">✓</button>
            </div>
          </div>
          <div class="p-2.5 flex-1 flex flex-col justify-between bg-[#111726]">
            <h3 class="text-xs font-bold text-slate-100 group-hover:text-indigo-300 truncate">${esc(item.title)}</h3>
            <div class="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
              <span>${esc(item.year || '—')}</span>
              <span class="truncate max-w-[80px]">${esc(ptG((item.genres && item.genres[0]) || 'HD'))}</span>
            </div>
          </div>`;
        bindCardQuickActions(card, item);
        return card;
      }

      function renderCatalogGrid() {
        const remote = isRemoteCatalog();
        if (remote) catEnsure();
        const ready = remote && CAT.src.some(s => s.items.length) && state.searchQuery.trim() === catSearch();
        const items = ready ? catView() : getFilteredCatalog();
        const sentinel = document.getElementById('catalogSentinel');
        if (sentinel) sentinel.classList.toggle('hidden', !remote);
        el.catalogCountLabel.textContent = `${items.length}${ready && !CAT.done ? '+' : ''} títulos`;

        if (items.length === 0) {
          CAT.renderedKey = '';
          const typed = catParseSearch(state.searchQuery).text;
          const dym = typed.length >= 4 ? catDidYouMean(typed) : '';
          el.catalogGrid.innerHTML = `
            <div class="col-span-full py-14 text-center space-y-2">
              <p class="text-sm font-semibold text-slate-300">${CAT.loading ? 'A procurar…' : 'Nenhum título encontrado para este filtro.'}</p>
              ${dym ? `<p class="text-xs text-slate-400">Querias dizer <button type="button" id="dymBtn" class="text-indigo-300 underline">${esc(dym)}</button>?</p>` : ''}
              <p class="text-xs text-slate-500">Experimenta outro nome, afrouxar os filtros ou colar um Magnet Link no topo.</p>
            </div>`;
          const b = document.getElementById('dymBtn');
          if (b) b.addEventListener('click', () => { el.globalSearchInput.value = dym; el.globalSearchInput.dispatchEvent(new Event('input')); });
          if (remote) catStatus();
          if (remote && !CAT.loading && !CAT.done && CAT.chain < 8) { CAT.chain++; catLoadMore(); }
          return;
        }

        const info = catCardInfo();
        const rk = JSON.stringify([CAT.key, ready, catFilters(), state.activeGenre, state.sortBy]);
        const canAppend = ready && rk === CAT.renderedKey && items.length >= CAT.rendered && el.catalogGrid.children.length === CAT.rendered && items[0].imdbId === CAT.firstId && (state.sortBy || 'popular') === 'popular';
        if (canAppend) {
          const frag = document.createDocumentFragment();
          items.slice(CAT.rendered).forEach(it => frag.appendChild(buildCatalogCard(it, info)));
          el.catalogGrid.appendChild(frag);
        } else {
          const frag = document.createDocumentFragment();
          items.forEach(it => frag.appendChild(buildCatalogCard(it, info)));
          el.catalogGrid.innerHTML = '';
          el.catalogGrid.appendChild(frag);
        }
        CAT.renderedKey = rk; CAT.rendered = items.length; CAT.firstId = items[0].imdbId;

        if (remote) {
          catStatus();
          // filtros apertados deixam poucos resultados: vai buscar mais páginas (com limite)
          if (ready && items.length < 30 && !CAT.loading && !CAT.done && CAT.chain < 8) { CAT.chain++; catLoadMore(); }
          else if (ready && CAT.sentVisible && !CAT.loading && !CAT.done && CAT.chain < 8) { CAT.chain++; catLoadMore(); }
        }
      }

      function syncCatalogFilterUi() {
        const f = catFilters();
        const set = (id, v) => { const n = document.getElementById(id); if (n) n.value = v; };
        set('fltGenre', state.activeGenre === 'ALL' ? '' : state.activeGenre);
        set('fltRating', String(f.minRating || 0));
        set('fltDecade', f.yearMax && !f.yearMin ? (f.yearMax <= 1979 ? 'pre1980' : '') : f.yearMin && (f.yearMax === f.yearMin + 9) ? String(f.yearMin) : '');
        const hs = document.getElementById('fltHideSeen'); if (hs) hs.checked = !!f.hideSeen;
        const rs = document.getElementById('fltReset'); if (rs) rs.classList.toggle('hidden', !(catFiltersActive() || state.activeGenre !== 'ALL'));
        const sort = document.getElementById('catalogSortSelect'); if (sort) sort.value = state.sortBy || 'popular';
        document.querySelectorAll('.genre-pill').forEach(b => {
          const on = b.getAttribute('data-genre') === state.activeGenre;
          b.className = 'genre-pill px-3 py-1.5 rounded-xl text-xs ' + (on ? 'font-semibold bg-indigo-600 text-white' : 'font-medium bg-[#131825] hover:bg-slate-800 text-slate-300 border mac-border') + ' mac-transition';
        });
        document.querySelectorAll('.theme-chip').forEach(b => {
          const on = b.getAttribute('data-theme') === f.theme;
          b.className = 'theme-chip px-3 py-1.5 rounded-xl text-xs ' + (on ? 'font-semibold bg-indigo-600 text-white' : 'font-medium bg-[#131825] hover:bg-slate-800 text-slate-300 border mac-border') + ' mac-transition';
        });
      }
      function catRefresh() { saveCatFilters(); syncCatalogFilterUi(); CAT.chain = 0; renderCatalogGrid(); renderHomeRows(); }

      function initCatalogFilters() {
        const g = document.getElementById('fltGenre');
        if (!g) return;
        g.innerHTML = '<option value="">Todos os géneros</option>' + GENRES_ALL.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        const f = catFilters(); delete f.theme;
        g.addEventListener('change', () => { state.activeGenre = g.value || 'ALL'; delete catFilters().theme; catRefresh(); });
        document.getElementById('fltDecade').addEventListener('change', (ev) => {
          const v = ev.target.value, fl = catFilters();
          delete fl.theme;
          if (!v) { delete fl.yearMin; delete fl.yearMax; }
          else if (v === 'pre1980') { delete fl.yearMin; fl.yearMax = 1979; }
          else { fl.yearMin = parseInt(v, 10); fl.yearMax = fl.yearMin + 9; }
          catRefresh();
        });
        document.getElementById('fltRating').addEventListener('change', (ev) => { const fl = catFilters(); delete fl.theme; const n = parseFloat(ev.target.value) || 0; if (n) fl.minRating = n; else delete fl.minRating; catRefresh(); });
        document.getElementById('fltHideSeen').addEventListener('change', (ev) => { const fl = catFilters(); if (ev.target.checked) fl.hideSeen = true; else delete fl.hideSeen; catRefresh(); });
        document.getElementById('fltReset').addEventListener('click', () => {
          state.catFilters = {}; state.activeGenre = 'ALL'; state.sortBy = 'popular'; catRefresh();
        });
        document.getElementById('catalogSortSelect').addEventListener('change', () => { delete catFilters().theme; setTimeout(catRefresh, 0); });
        const box = document.getElementById('catalogThemes');
        CAT_THEMES.forEach(t => {
          const b = document.createElement('button');
          b.type = 'button'; b.setAttribute('data-theme', t.id); b.textContent = t.label;
          b.addEventListener('click', () => {
            const fl = catFilters();
            if (fl.theme === t.id) { state.catFilters = {}; state.activeGenre = 'ALL'; state.sortBy = 'popular'; return catRefresh(); }
            state.catFilters = { theme: t.id, hideSeen: fl.hideSeen };
            if (t.yearMin) state.catFilters.yearMin = t.yearMin;
            if (t.yearMax) state.catFilters.yearMax = t.yearMax;
            if (t.minRating) state.catFilters.minRating = t.minRating;
            state.activeGenre = t.genre || 'ALL';
            state.sortBy = t.sort || 'popular';
            catRefresh();
          });
          box.appendChild(b);
        });
        syncCatalogFilterUi();
        const sent = document.getElementById('catalogSentinel');
        if (sent && 'IntersectionObserver' in window) {
          new IntersectionObserver((es) => {
            CAT.sentVisible = es.some(e => e.isIntersecting);
            if (CAT.sentVisible && isRemoteCatalog() && !CAT.loading && !CAT.done) { CAT.chain = 0; catLoadMore(); }
          }, { rootMargin: '900px' }).observe(sent);
        }
      }


      // =======================================================================
      // 7b. PÁGINA INICIAL: SUGESTÕES, TENDÊNCIAS E GOSTOS
      // =======================================================================
      const GENRE_PT = { Action: 'Ação', Adventure: 'Aventura', Animation: 'Animação', Comedy: 'Comédia', Crime: 'Crime', Documentary: 'Documentário', Drama: 'Drama', Family: 'Família', Fantasy: 'Fantasia', History: 'História', Horror: 'Terror', Music: 'Música', Musical: 'Musical', Mystery: 'Mistério', Romance: 'Romance', 'Sci-Fi': 'Ficção Científica', 'Science Fiction': 'Ficção Científica', Thriller: 'Suspense', War: 'Guerra', Western: 'Western', Biography: 'Biografia', Sport: 'Desporto' };
      const ptG = (g) => GENRE_PT[g] || g;
      const MOODS = [
        { id: 'rir', emoji: '😂', label: 'Rir', genres: ['Comedy'] },
        { id: 'tensao', emoji: '😱', label: 'Tensão', genres: ['Thriller', 'Horror'] },
        { id: 'pensar', emoji: '🧠', label: 'Pensar', genres: ['Mystery', 'Sci-Fi'] },
        { id: 'romance', emoji: '💞', label: 'Romance', genres: ['Romance'] },
        { id: 'aventura', emoji: '🚀', label: 'Aventura', genres: ['Adventure', 'Action'] },
        { id: 'familia', emoji: '👨‍👩‍👧', label: 'Família', genres: ['Family', 'Animation'] }
      ];
      const TASTE_GENRES = ['Action', 'Comedy', 'Drama', 'Thriller', 'Sci-Fi', 'Romance', 'Horror', 'Animation', 'Crime', 'Fantasy', 'Documentary', 'Adventure'];
      state.home = { mem: {}, known: storage.get('ms_known', {}), token: 0, mood: null, heroList: [], heroIdx: 0, heroTimer: null };

      // Fallback de imagens sem handlers inline (evita injeção no contexto JS do atributo)
      document.addEventListener('error', (ev) => {
        const t = ev.target;
        if (!t || t.tagName !== 'IMG' || !t.dataset) return;
        if (t.dataset.fb && !t.dataset.fbDone) {
          t.dataset.fbDone = '1';
          t.src = t.dataset.fb;
        } else if (t.dataset.mono) {
          t.style.display = 'none';
          if (t.parentElement) t.parentElement.textContent = t.dataset.mono;
        }
      }, true);
      function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
      function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

      function greetingText() {
        const h = new Date().getHours();
        return h < 6 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 20 ? 'Boa tarde' : 'Boa noite';
      }
      function defaultMood() {
        const d = new Date(), h = d.getHours(), wk = d.getDay() === 0 || d.getDay() === 6;
        if (h >= 22 || h < 5) return 'rir';
        if (wk && h >= 9 && h < 18) return 'familia';
        if (wk) return 'aventura';
        return h >= 18 ? 'tensao' : 'pensar';
      }

      async function fetchPool(kind, type, extra) {
        const key = `home:${type}:${kind}:${extra || ''}`;
        if (state.home.mem[key]) return state.home.mem[key];
        const cached = await CineDB.get('catalog_cache', key);
        if (cached && cached.items && Date.now() - cached.timestamp < 6 * 3600e3) return (state.home.mem[key] = cached.items);
        try {
          const r = await fetch(`https://v3-cinemeta.strem.io/catalog/${type}/${kind}${extra ? '/' + extra : ''}.json`);
          if (!r.ok) throw new Error('http');
          const d = await r.json();
          const items = (d.metas || []).filter(m => m && m.id && String(m.id).startsWith('tt')).slice(0, 100).map(m => metaToItem(m, type));
          await CineDB.put('catalog_cache', { cacheKey: key, timestamp: Date.now(), items });
          return (state.home.mem[key] = items);
        } catch (e) {
          return (cached && cached.items) || [];
        }
      }

      function knownItem(id) {
        return state.catalog.find(c => c.imdbId === id) || state.libraryMap[id] || state.home.known[id] || null;
      }
      async function ensureKnown(records) {
        const need = [];
        records.forEach(r => { if (r.imdbId && String(r.imdbId).startsWith('tt') && !knownItem(r.imdbId) && !need.find(n => n.imdbId === r.imdbId)) need.push(r); });
        await Promise.all(need.slice(0, 12).map(async r => {
          try {
            const res = await fetch(`https://v3-cinemeta.strem.io/meta/${r.type === 'series' ? 'series' : 'movie'}/${r.imdbId}.json`);
            if (!res.ok) return;
            const d = await res.json();
            if (d && d.meta) state.home.known[r.imdbId] = metaToItem({ ...d.meta, id: r.imdbId }, r.type === 'series' ? 'series' : 'movie');
          } catch (e) {}
        }));
        if (need.length) {
          const slim = {};
          Object.entries(state.home.known).forEach(([k, v]) => { slim[k] = { imdbId: v.imdbId, type: v.type, title: v.title, year: v.year, rating: v.rating, genres: v.genres, poster: v.poster, backdrop: v.backdrop, plot: (v.plot || '').slice(0, 300) }; });
          lsSet('ms_known', slim);
        }
      }

      function buildTasteProfile() {
        const g = {}, types = { movie: 0, series: 0 }, seen = new Set(), hist = [];
        const now = Date.now(), byId = {};
        Object.values(state.watchProgressMap).forEach(r => { if (r && r.imdbId) (byId[r.imdbId] = byId[r.imdbId] || []).push(r); });
        Object.entries(byId).forEach(([id, recs]) => {
          seen.add(id);
          const last = Math.max(...recs.map(r => r.updatedAt || 0));
          const done = recs.filter(r => r.completed).length;
          const deep = recs.some(r => r.currentTime > 120);
          if (!done && !deep && recs.every(r => r.currentTime < 30)) return;
          const w = (1 + Math.min(done, 6) * 0.5 + (deep ? 1 : 0)) * (now - last < 30 * 864e5 ? 1.5 : 1);
          const it = knownItem(id);
          if (!it) return;
          (it.genres || []).forEach(x => { g[x] = (g[x] || 0) + w; });
          types[it.type] = (types[it.type] || 0) + w;
          hist.push({ item: it, last, w });
        });
        Object.values(state.libraryMap).forEach(it => {
          seen.add(it.imdbId);
          (it.genres || []).forEach(x => { g[x] = (g[x] || 0) + 1.5; });
          types[it.type] = (types[it.type] || 0) + 1.5;
        });
        (lsGet('ms_taste', []) || []).forEach(x => { g[x] = (g[x] || 0) + 2.5; });
        const top = Object.entries(g).sort((a, b) => b[1] - a[1]).map(e => e[0]);
        return { genres: g, maxG: Math.max(1, ...Object.values(g)), types, seen, top, hist: hist.sort((a, b) => b.last - a.last), cold: Object.keys(g).length === 0 };
      }

      function scoreItem(it, prof) {
        const gs = it.genres || [];
        let s = gs.reduce((a, x) => a + (prof.genres[x] || 0) / prof.maxG, 0) / Math.sqrt(Math.max(1, gs.length));
        const r = parseFloat(it.rating) || 6.5;
        s += Math.max(0, r - 6) * 0.25;
        const tt = (prof.types.movie || 0) + (prof.types.series || 0) || 1;
        s += 0.4 * ((prof.types[it.type] || 0) / tt);
        if (parseInt(it.year, 10) >= 2015) s += 0.1;
        return s;
      }
      const matchPct = (s) => Math.max(55, Math.min(99, Math.round(55 + s * 17)));

      // A2: Posters Limpos de 136px × 204px (7 a 8 por fila no MacBook Air 13" — sem sinopse a tapar a capa!)
      function mkItemCard(item, o = {}) {
        const c = document.createElement('div');
        c.className = o.rank ? 'ms-rank-wrap group snap-start' : 'ms-poster-card group snap-start';
        const inLib = Boolean(state.libraryMap[item.imdbId]);
        const cEntry = findCacheEntryForItem(item.imdbId, o.ep && o.ep.season, o.ep && o.ep.episode);
        const playLabel = o.ep ? `▶ S${pad2(o.ep.season)}E${pad2(o.ep.episode)}` : '▶ Ver';
        c.innerHTML = `
          ${o.rank ? `<span class="top10-num">${o.rank}</span>` : ''}
          <div class="${o.rank ? 'ms-rank-card' : ''}">
            <div class="ms-poster-frame">
              <img src="${esc(item.poster)}" alt="${esc(item.title)}" loading="lazy" decoding="async" data-fb="${esc(localPosterSvg(item.title, 300, 450))}" />
              <span class="ms-poster-badge-top">★ ${esc(item.rating || '—')}</span>
              ${cEntry ? `<span class="ms-poster-badge-left">⚡ ${Math.round((cEntry.progress || 0) * 100)}%</span>` : ''}
              ${o.badge ? `<span class="ms-poster-badge-bottom">${esc(o.badge)}</span>` : ''}
              <div class="ms-clean-dock">
                <button type="button" data-qa="play" class="ms-qa-play" title="Reproduzir imediatamente">${esc(playLabel)}</button>
                <button type="button" data-qa="cache" class="ms-qa-ico ${cEntry ? 'active-cache' : ''}" title="Guardar na Cache">⚡</button>
                <button type="button" data-qa="lib" class="ms-qa-ico ${inLib ? 'active-lib' : ''}" title="Biblioteca">${inLib ? '♥' : '＋'}</button>
              </div>
            </div>
            <p class="mt-1.5 text-xs font-bold text-slate-100 truncate group-hover:text-indigo-300">${esc(item.title)}</p>
            <p class="text-[10px] text-slate-400 truncate">${esc(item.year || '')}${item.genres && item.genres[0] ? ' • ' + esc(ptG(item.genres[0])) : ''}</p>
          </div>`;
        bindCardQuickActions(c, item, o.ep || null);
        return c;
      }

      function mkRow(title, subtitle, items, o = {}) {
        if (!items || !items.length) return null;
        const sec = document.createElement('section');
        sec.className = 'space-y-2';
        sec.innerHTML = `
          <div class="flex items-end justify-between gap-3">
            <div><h2 class="text-sm font-bold text-white tracking-tight">${esc(title)}</h2>${subtitle ? `<p class="text-[11px] text-slate-400">${esc(subtitle)}</p>` : ''}</div>
            <div class="flex items-center gap-1.5">
              <div class="row-extra flex items-center gap-1"></div>
              <button type="button" class="row-scroll-btn row-prev-btn" title="Anterior">‹</button>
              <button type="button" class="row-scroll-btn row-next-btn" title="Seguinte">›</button>
            </div>
          </div>
          <div class="home-row snap-x"></div>`;
        const strip = sec.querySelector('.home-row');
        items.slice(0, o.limit || 16).forEach((it, i) => {
          const card = mkItemCard(it.item || it, { rank: o.numbered ? i + 1 : 0, badge: it.badge || '', ep: it.ep || null });
          strip.appendChild(card);
        });
        sec.querySelector('.row-prev-btn').addEventListener('click', () => strip.scrollBy({ left: -580, behavior: 'smooth' }));
        sec.querySelector('.row-next-btn').addEventListener('click', () => strip.scrollBy({ left: 580, behavior: 'smooth' }));
        return sec;
      }

      function dedupe(list) {
        const seen = new Set();
        return list.filter(it => it && it.imdbId && !seen.has(it.imdbId) && seen.add(it.imdbId));
      }

      async function renderHomeRows(forceRebuild) {
        const host = document.getElementById('homeRows');
        const stats = document.getElementById('homeStatsStrip');
        if (!host) return;
        const show = state.appMode === 'cine' && state.activeNav === 'discover' && !state.searchQuery.trim() && state.activeGenre === 'ALL' && !catFiltersActive() && !state.forceShowExplorer;
        host.classList.toggle('hidden', !show);
        if (stats) stats.classList.add('hidden');
        if (!show) return;
        // Otimização 60 FPS MacBook Air 2019: não reconstrói todas as filas se já foram montadas há menos de 45s
        if (!forceRebuild && host.children.length > 2 && Date.now() - (state.home.lastBuiltAt || 0) < 45000) {
          renderHubSpotlightRow();
          return;
        }
        const token = ++state.home.token;
        try {
          await ensureKnown(Object.values(state.watchProgressMap));
          if (token !== state.home.token) return;
          const prof = buildTasteProfile();
          renderStatsStrip(stats, prof);

          const [topM, topS] = await Promise.all([fetchPool('top', 'movie'), fetchPool('top', 'series')]);
          if (token !== state.home.token) return;
          const genrePools = await Promise.all(prof.top.slice(0, 3).flatMap(g => [fetchPool('top', 'movie', 'genre=' + encodeURIComponent(g)), fetchPool('top', 'series', 'genre=' + encodeURIComponent(g))]));
          if (token !== state.home.token) return;
          const pool = dedupe([...topM, ...topS, ...state.catalog.filter(c => String(c.imdbId).startsWith('tt')), ...genrePools.flat()]);
          const unseen = pool.filter(it => !prof.seen.has(it.imdbId));
          state.home.pool = pool;

          const frag = document.createDocumentFragment();
          const add = (n) => { if (n) frag.appendChild(n); };

          // 0) Gostos (arranque a frio)
          if (prof.cold) {
            const box = document.createElement('section');
            box.className = 'p-4 rounded-2xl border mac-border bg-[#131825]/80 space-y-2.5';
            const picks = lsGet('ms_taste', []) || [];
            box.innerHTML = `<h2 class="text-sm font-bold text-white">O que costumas gostar de ver?</h2><p class="text-[11px] text-slate-400">Escolhe alguns géneros e a app começa a sugerir já. Depois aprende sozinha com o que vês.</p><div class="flex flex-wrap gap-1.5 taste-chips"></div>`;
            TASTE_GENRES.forEach(g => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'px-3 py-1.5 rounded-xl text-xs font-medium border mac-border ' + (picks.includes(g) ? 'bg-indigo-600 text-white' : 'bg-[#0b0f19] text-slate-300 hover:text-white');
              b.textContent = ptG(g);
              b.addEventListener('click', () => {
                const cur = lsGet('ms_taste', []) || [];
                lsSet('ms_taste', cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g]);
                renderHomeRows();
              });
              box.querySelector('.taste-chips').appendChild(b);
            });
            add(box);
          }

          // 1) Novos episódios das tuas séries (histórico + biblioteca; só séries que já começaste a ver)
          const seenSer = new Set();
          const seriesHist = [...prof.hist.map(h => h.item), ...Object.values(state.libraryMap)]
            .filter(it => it && it.type === 'series' && it.imdbId && !seenSer.has(it.imdbId) && seenSer.add(it.imdbId)).slice(0, 14);
          const newEps = [];
          const today = new Date().toISOString().slice(0, 10);
          const relDay = (d) => { const n = Math.round((new Date(today) - new Date(d)) / 864e5); return n <= 0 ? 'saiu hoje' : n === 1 ? 'saiu ontem' : `saiu há ${n} dias`; };
          await Promise.all(seriesHist.map(async it => {
            try {
              const f = furthestWatched(it.imdbId);
              if (!f) return;
              const map = state.episodesCache[it.imdbId] || await getSeriesEpisodesMap(it);
              const all = Object.values(map).flat().sort((x, y) => epCmp(x.season, x.episode, y.season, y.episode));
              const next = all.find(e => epCmp(e.season, e.episode, f.season || 1, f.episode || 1) > 0 && (!e.released || e.released <= today) && !isEpisodeWatched(it.imdbId, e.season, e.episode));
              if (next) {
                const age = next.released ? (new Date(today) - new Date(next.released)) / 864e5 : 999;
                const fresh = age <= 14;
                newEps.push({ item: it, fresh, age, ep: next, badge: `${fresh ? '🆕 ' : ''}S${pad2(next.season)}E${pad2(next.episode)}${fresh ? ' · ' + relDay(next.released) : ''}` });
              }
            } catch (e) {}
          }));
          if (token !== state.home.token) return;
          newEps.sort((x, y) => (y.fresh - x.fresh) || (x.age - y.age));
          const freshEps = newEps.filter(x => x.fresh);
          add(mkRow(freshEps.length ? '🆕 Novos episódios' : 'A seguir nas tuas séries', freshEps.length ? 'Saíram há pouco e ainda não viste' : 'O que te falta ver, já disponível', newEps));
          try {
            if (freshEps.length && !sessionStorage.getItem('ms_newep_toast')) {
              sessionStorage.setItem('ms_newep_toast', '1');
              const names = freshEps.slice(0, 2).map(x => `${x.item.title} S${pad2(x.ep.season)}E${pad2(x.ep.episode)}`).join(' e ');
              showToast(`🆕 Novo episódio: ${names}${freshEps.length > 2 ? ' …' : ''}`);
            }
          } catch (e) {}

          // 2) Sugeridas para ti
          if (!prof.cold) {
            const scored = unseen.map(it => ({ it, s: scoreItem(it, prof) })).sort((a, b) => b.s - a.s);
            const recs = scored.slice(0, 16);
            state.home.recs = recs;
            const topG = prof.top.slice(0, 2).map(ptG).join(' e ');
            add(mkRow('Sugeridas para ti', `Com base no que viste: gostas de ${topG}`, recs.map(r => ({ item: r.it, badge: `🎯 ${matchPct(r.s)}% para ti` }))));

            // 3) Porque viste X
            prof.hist.slice(0, 2).forEach(h => {
              const hg = h.item.genres || [];
              const sim = unseen.filter(it => it.type === h.item.type && it.imdbId !== h.item.imdbId)
                .map(it => ({ it, n: (it.genres || []).filter(x => hg.includes(x)).length, r: parseFloat(it.rating) || 0 }))
                .filter(x => x.n >= Math.min(2, hg.length || 1))
                .sort((a, b) => (b.n - a.n) || (b.r - a.r)).map(x => x.it);
              add(mkRow(`Porque viste ${h.item.title}`, hg.slice(0, 3).map(ptG).join(' • '), sim));
            });
          } else {
            add(mkRow('As mais bem avaliadas para começar', '', unseen.filter(it => parseFloat(it.rating) >= 7.8)));
          }

          // 4) Top 10
          add(mkRow('Top 10 filmes hoje', 'O que toda a gente está a ver', topM, { numbered: true, limit: 10 }));
          add(mkRow('Top 10 séries hoje', '', topS, { numbered: true, limit: 10 }));

          // 5) Humor de hoje
          const moodId = state.home.mood || defaultMood();
          const mood = MOODS.find(m => m.id === moodId) || MOODS[0];
          const moodPools = await Promise.all(mood.genres.flatMap(g => [fetchPool('top', 'movie', 'genre=' + encodeURIComponent(g)), fetchPool('top', 'series', 'genre=' + encodeURIComponent(g))]));
          if (token !== state.home.token) return;
          const moodItems = dedupe(moodPools.flat()).filter(it => !prof.seen.has(it.imdbId)).sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
          const d = new Date();
          const dayName = d.toLocaleDateString('pt-PT', { weekday: 'long' });
          const moodRow = mkRow(`Humor de hoje: ${mood.emoji} ${mood.label}`, `${dayName[0].toUpperCase() + dayName.slice(1)}, ${d.getHours() >= 20 ? 'à noite' : d.getHours() >= 12 ? 'à tarde' : 'de manhã'} — escolhe o teu estado`, moodItems);
          if (moodRow) {
            const extra = moodRow.querySelector('.row-extra');
            MOODS.forEach(m => {
              const b = document.createElement('button');
              b.type = 'button';
              b.title = m.label;
              b.className = 'px-2 py-1 rounded-lg text-sm border mac-border ' + (m.id === mood.id ? 'bg-indigo-600' : 'bg-[#131825] hover:bg-slate-800');
              b.textContent = m.emoji;
              b.addEventListener('click', () => { state.home.mood = m.id; renderHomeRows(); });
              extra.appendChild(b);
            });
            add(moodRow);
          }

          // 6) Na tua lista
          const queued = Object.values(state.libraryMap).filter(it => !Object.values(state.watchProgressMap).some(r => r.imdbId === it.imdbId));
          add(mkRow('Na tua lista', 'Guardaste e ainda não começaste', queued));

          // 7) Joias escondidas / Curtos / Clássicos
          const [gemM, gemS, clsM] = await Promise.all([fetchPool('imdbRating', 'movie', 'skip=60'), fetchPool('imdbRating', 'series', 'skip=60'), fetchPool('imdbRating', 'movie')]);
          if (token !== state.home.token) return;
          const topIds = new Set([...topM, ...topS].slice(0, 60).map(i => i.imdbId));
          add(mkRow('Joias escondidas', 'Muito bem avaliadas e fora do radar', dedupe([...gemM, ...gemS]).filter(it => !prof.seen.has(it.imdbId) && !topIds.has(it.imdbId) && parseFloat(it.rating) >= 7.6)));
          const short = dedupe([...pool, ...gemM]).filter(it => it.type === 'movie' && !prof.seen.has(it.imdbId) && parseInt(it.runtime, 10) > 0 && parseInt(it.runtime, 10) <= 100);
          add(mkRow('Curtos para esta noite', 'Filmes até 1h40', short));
          add(mkRow('Clássicos que valem a pena', 'Antes de 2000, nota 8 ou mais', clsM.filter(it => parseInt(it.year, 10) < 2000 && parseFloat(it.rating) >= 8 && !prof.seen.has(it.imdbId))));

          host.innerHTML = '';
          host.appendChild(frag);
          state.home.lastBuiltAt = Date.now();
          renderHubSpotlightRow();

          // Hero rotativo: 1.º a tua melhor sugestão, depois as tendências
          const heroBase = [];
          if (state.home.recs && state.home.recs[0]) heroBase.push({ item: state.home.recs[0].it, tag: `🎯 Escolha para ti • ${matchPct(state.home.recs[0].s)}% compatível` });
          [...topM.slice(0, 3), ...topS.slice(0, 3)].forEach((it, i) => heroBase.push({ item: it, tag: i < 3 ? '🔥 Filme em alta' : '🔥 Série em alta' }));
          setHeroList(heroBase.filter(h => h.item.backdrop));
        } catch (e) { console.error('[home]', e); }
      }

      function renderStatsStrip(stats, prof) {
        const weekAgo = Date.now() - 7 * 864e5;
        const recs = Object.values(state.watchProgressMap).filter(r => (r.updatedAt || 0) > weekAgo);
        const eps = recs.filter(r => r.completed).length;
        const mins = Math.round(recs.reduce((a, r) => a + Math.min(r.currentTime || 0, r.duration || 0), 0) / 60);
        const fav = prof.top[0] ? ptG(prof.top[0]) : '';
        const time = mins >= 60 ? `${Math.floor(mins / 60)}h${pad2(mins % 60)}` : `${mins} min`;
        stats.innerHTML = `
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div><p class="text-lg font-extrabold text-white">${greetingText()} 👋</p>
              <p class="text-[11px] text-slate-400">${recs.length ? `Esta semana: ${eps} ${eps === 1 ? 'concluído' : 'concluídos'} • ${time} a ver${fav ? ' • género favorito: ' + esc(fav) : ''}` : 'Ainda não viste nada esta semana — que tal começar hoje?'}</p></div>
            <button id="surpriseBtn" type="button" class="px-3.5 py-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:brightness-110 text-white text-xs font-bold shadow-lg">🎲 Surpreende-me</button>
          </div>`;
        document.getElementById('surpriseBtn').addEventListener('click', surpriseMe);
      }

      function surpriseMe() {
        const prof = buildTasteProfile();
        const pool = (state.home.pool && state.home.pool.length ? state.home.pool : state.catalog).filter(it => !prof.seen.has(it.imdbId) && parseFloat(it.rating) >= 7);
        if (!pool.length) { showToast('Ainda não tenho títulos para sugerir — atualiza o feed.'); return; }
        const ranked = prof.cold ? pool : pool.map(it => ({ it, s: scoreItem(it, prof) })).sort((a, b) => b.s - a.s).slice(0, 30).map(x => x.it);
        openDetailDrawer(ranked[Math.floor(Math.random() * ranked.length)]);
      }

      // ----- Hero rotativo compacto Apple TV+ -----
      function setHero(h) {
        if (!h) return;
        const it = h.item;
        state.heroItem = it;
        const $ = (id) => document.getElementById(id);
        $('heroBackdropImg').src = it.backdrop || it.poster || '';
        const pThumb = $('heroPosterThumb');
        if (pThumb) pThumb.src = it.poster || it.backdrop || '';
        $('heroTitle').textContent = it.title;
        $('heroOverview').textContent = it.plot || '';
        $('heroImdbBadge').textContent = `★ ${it.rating || '—'} IMDb`;
        $('heroYearGenre').textContent = [it.year, (it.genres || []).slice(0, 3).map(ptG).join(', '), it.runtime || ''].filter(Boolean).join(' • ');
        $('heroTag').textContent = h.tag || 'Em destaque';
        const inLib = Boolean(state.libraryMap[it.imdbId]);
        $('heroLibraryIcon').textContent = inLib ? '♥' : '＋';
        $('heroLibraryLabel').textContent = inLib ? 'Na Biblioteca' : 'Biblioteca';

        const cEntry = findCacheEntryForItem(it.imdbId);
        const hcBadge = $('heroCacheBadge');
        if (hcBadge) {
          if (cEntry) {
            hcBadge.textContent = `⚡ Cache ${Math.round((cEntry.progress || 0) * 100)}%`;
            hcBadge.classList.remove('hidden');
          } else {
            hcBadge.classList.add('hidden');
          }
        }
        const qpLabel = $('heroQuickPlayLabel');
        if (qpLabel) {
          if (it.type === 'series') {
            const fw = furthestWatched(it.imdbId);
            if (fw && !fw.completed && fw.currentTime > 5) qpLabel.textContent = `Retomar S${pad2(fw.season || 1)}E${pad2(fw.episode || 1)}`;
            else if (fw && fw.completed) qpLabel.textContent = 'Ver Seguinte';
            else qpLabel.textContent = 'Ver S01E01';
          } else {
            const pRec = state.watchProgressMap[getProgressKey(it.imdbId, 'movie', 1, 1)];
            qpLabel.textContent = (pRec && !pRec.completed && pRec.currentTime > 10) ? `Retomar (${formatTime(pRec.currentTime)})` : 'Ver Agora';
          }
        }
        const preLbl = $('heroPreloadLabel');
        if (preLbl) preLbl.textContent = cEntry ? `Cache (${Math.round((cEntry.progress || 0) * 100)}%)` : 'Cache';

        const dots = $('heroDots');
        dots.innerHTML = '';
        state.home.heroList.forEach((x, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'w-2 h-2 rounded-full ' + (x.item.imdbId === it.imdbId ? 'bg-white' : 'bg-white/30 hover:bg-white/60');
          b.addEventListener('click', () => { state.home.heroIdx = i; setHero(x); restartHeroTimer(); });
          dots.appendChild(b);
        });
      }
      function setHeroList(list) {
        if (!list.length) return;
        state.home.heroList = list.slice(0, 7);
        state.home.heroIdx = 0;
        setHero(state.home.heroList[0]);
        restartHeroTimer();
      }
      function restartHeroTimer() {
        clearInterval(state.home.heroTimer);
        if (document.hidden || state.appMode !== 'cine' || state.activeNav !== 'discover' || !el.playerModal.classList.contains('hidden')) return;
        state.home.heroTimer = setInterval(() => {
          if (document.hidden || state.activeNav !== 'discover' || state.appMode !== 'cine' || !el.playerModal.classList.contains('hidden') || !el.detailModal.classList.contains('hidden')) return;
          const l = state.home.heroList;
          if (l.length < 2) return;
          state.home.heroIdx = (state.home.heroIdx + 1) % l.length;
          setHero(l[state.home.heroIdx]);
        }, 14000);
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearInterval(state.home.heroTimer);
        else restartHeroTimer();
      });

      // =======================================================================
      // 7c. SKILLS DA HOME v2.3: PAINEL CACHE/A SEGUIR, HUBS, FILTRO DE TEMPO & IPTV
      // =======================================================================
      state.episodeCacheItems = [];
      state.episodeCacheBytes = 0;
      state.localCacheSim = storage.get('ms_local_cache_sim', []);
      state.cacheExitPolicy = localStorage.getItem('ms_cache_exit_policy') || 'pause';
      state.activeHub = 'foryou';
      state.activeTimePill = 'all';
      state.forceShowExplorer = false;

      function getContextStreamsKey(item, season, episode) {
        if (!item || !item.imdbId) return '';
        return item.type === 'series' ? `${item.imdbId}:${Number(season) || 1}:${Number(episode) || 1}` : `${item.imdbId}:movie`;
      }

      function findCacheEntryForItem(imdbId, season, episode, infoHash) {
        const list = state.episodeCacheItems || [];
        if (infoHash) {
          const byH = list.find(x => {
            if (!x.infoHash || x.infoHash.toLowerCase() !== String(infoHash).toLowerCase()) return false;
            if (imdbId && x.imdbId && x.imdbId !== imdbId) return false;
            if (season != null && Number(x.season || 0) !== Number(season)) return false;
            if (episode != null && Number(x.episode || 0) !== Number(episode)) return false;
            return true;
          });
          if (byH) return byH;
        }
        if (!imdbId) return null;
        return list.find(x => {
          if (x.imdbId !== imdbId) return false;
          if (season != null && Number(x.season || 0) !== Number(season)) return false;
          if (episode != null && Number(x.episode || 0) !== Number(episode)) return false;
          return true;
        }) || null;
      }

      async function pollEpisodeCache() {
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        if (E) {
          try {
            const r = await fetch(`${E}/cache-info`);
            if (r.ok) {
              const d = await r.json();
              if (d && d.ok) {
                state.episodeCacheItems = Array.isArray(d.items) ? d.items : [];
                state.episodeCacheBytes = d.bytes || 0;
              }
            }
          } catch (e) {}
        } else {
          state.episodeCacheItems = state.localCacheSim || [];
          state.episodeCacheBytes = state.episodeCacheItems.reduce((acc, x) => acc + Math.round((x.length || 550 * 1048576) * (x.progress || 0)), 0);
        }
        renderEpisodeCacheSection();
        const badge = document.getElementById('sidebarCacheCountBadge');
        if (badge) badge.textContent = `${(state.episodeCacheItems || []).length} ep`;
      }

      function renderEpisodeCacheSection() {
        const grid = document.getElementById('episodeCacheGrid');
        const sizeBadge = document.getElementById('episodeCacheSizeBadge');
        if (!grid) return;

        const items = state.episodeCacheItems || [];
        const mb = (state.episodeCacheBytes || 0) / (1024 * 1024);
        if (sizeBadge) {
          sizeBadge.textContent = items.length
            ? (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB no disco` : `${Math.max(1, Math.round(mb))} MB no disco`)
            : '0 MB no disco';
        }

        grid.innerHTML = '';

        // 1. Se houver episódios na pasta de cache, mostra todos os episódios em cache no painel direito do Dashboard
        items.slice(0, 6).forEach(entry => {
          const pct = Math.min(100, Math.round((entry.progress || 0) * 100));
          const epTag = entry.season ? ` • S${pad2(entry.season)}E${pad2(entry.episode || 1)}` : '';
          const speedMB = ((entry.downloadSpeed || 0) / (1024 * 1024)).toFixed(2);
          let statusLabel = entry.remuxReady ? '⚡ 100% MP4 Pronto (0ms)' : (pct >= 100 ? '✓ 100% em Disco' : (entry.paused ? `⏸ Em Pausa (${pct}%)` : `⬇ ${pct}% (${speedMB} MB/s)`));
          const pMap = Array.isArray(entry.pieceMap) && entry.pieceMap.length ? entry.pieceMap.slice(0, 32) : new Array(32).fill(pct >= 100 ? 1 : (pct / 100));
          const barsHtml = pMap.map(v => `<span style="flex:1;height:100%;background:${v >= 0.85 ? '#10b981' : (v > 0.1 ? '#f59e0b' : 'transparent')}"></span>`).join('');

          const row = document.createElement('div');
          row.className = 'p-2.5 rounded-xl bg-[#151d30] border border-indigo-500/30 space-y-2';
          row.innerHTML = `
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-bold text-white truncate">${esc(entry.title || entry.name || 'Episódio em Cache')}${esc(epTag)}</p>
                <p class="text-[10px] font-mono text-emerald-300 truncate">${esc(statusLabel)}</p>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button type="button" class="cache-play-btn px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold">▶ Abrir</button>
                ${pct < 100 ? `<button type="button" class="cache-toggle-dl-btn px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-[10px] font-semibold" title="Pausar ou Continuar transferência">${entry.paused ? '⬇' : '⏸'}</button>` : ''}
                ${entry.season ? `<button type="button" class="cache-preload-next-btn px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-semibold" title="Pré-carregar episódio seguinte">⏭</button>` : ''}
                <button type="button" class="cache-evict-btn px-1.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[10px]" title="Apagar da cache">✕</button>
              </div>
            </div>
            <div class="piece-map-mini" title="Blocos guardados no disco (${pct}%)">${barsHtml}</div>
          `;

          row.querySelector('.cache-play-btn').addEventListener('click', () => {
            const it = knownItem(entry.imdbId) || { imdbId: entry.imdbId || ('cache-' + entry.infoHash), type: entry.season ? 'series' : 'movie', title: entry.title || entry.name, poster: entry.poster, backdrop: entry.backdrop };
            if (entry.title && it.title !== entry.title) it.title = entry.title;
            const pKey = getProgressKey(it.imdbId, it.type, entry.season || 1, entry.episode || 1);
            const saved = state.watchProgressMap[pKey];
            launchVideoPlayer({
              item: it,
              season: entry.season || 1,
              episode: entry.episode || 1,
              episodeTitle: '',
              stream: { addon: 'Cache em Disco', title: entry.name || entry.title, filename: entry.name || '', resolution: '1080p', seeders: entry.numPeers || 50, infoHash: entry.infoHash, fileIdx: entry.fileIdx, fromCache: true, magnetUri: entry.magnet || buildMagnet(entry.infoHash, it.title, []) },
              resumeSeconds: saved && !saved.completed ? saved.currentTime : 0
            });
          });

          const tBtn = row.querySelector('.cache-toggle-dl-btn');
          if (tBtn) {
            tBtn.addEventListener('click', async () => {
              const E = window.macstreamApp && window.macstreamApp.engineUrl;
              if (E) {
                if (entry.paused) await fetch(`${E}/resume-download?hash=${entry.infoHash}`).catch(() => {});
                else await fetch(`${E}/pause?pauseSwarm=1`).catch(() => {});
                setTimeout(pollEpisodeCache, 200);
              } else {
                entry.paused = !entry.paused;
                renderEpisodeCacheSection();
              }
            });
          }

          const nBtn = row.querySelector('.cache-preload-next-btn');
          if (nBtn) {
            nBtn.addEventListener('click', async () => {
              const it = knownItem(entry.imdbId) || { imdbId: entry.imdbId, type: 'series', title: entry.title, poster: entry.poster, backdrop: entry.backdrop };
              const map = await getSeriesEpisodesMap(it);
              const next = computeAdjacentEpisode({ item: it, season: entry.season || 1, episode: entry.episode || 1 }, 1, map);
              if (next) preloadItemToCache(it, next.season, next.episode, next.title);
              else showToast('Não há episódio seguinte disponível.');
            });
          }

          row.querySelector('.cache-evict-btn').addEventListener('click', async () => {
            const E = window.macstreamApp && window.macstreamApp.engineUrl;
            if (E) await fetch(`${E}/evict?hash=${entry.infoHash}&fileIdx=${entry.fileIdx || 0}`).catch(() => {});
            else {
              state.localCacheSim = (state.localCacheSim || []).filter(x => !(x.infoHash === entry.infoHash && (x.fileIdx || 0) === (entry.fileIdx || 0)));
              storage.set('ms_local_cache_sim', state.localCacheSim);
            }
            showToast('Episódio apagado da cache.');
            pollEpisodeCache();
            renderContinueWatchingRow();
          });

          grid.appendChild(row);
        });

        // 2. Preenche a Central de Séries com até 2 séries ativas do teu histórico (ex: The Office e Tulsa King)
        if (items.length < 2) {
          const cachedIds = new Set(items.map(x => x.imdbId).filter(Boolean));
          const bySeries = {};
          Object.values(state.watchProgressMap).forEach(r => {
            if (!r || !r.imdbId || cachedIds.has(r.imdbId)) return;
            const cur = bySeries[r.imdbId];
            if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) bySeries[r.imdbId] = r;
          });
          let activeQueue = Object.values(bySeries).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 2 - items.length);
          if (activeQueue.length === 0) {
            const def1 = state.catalog.find(c => c.imdbId === 'tt0386676') || state.catalog[0];
            const def2 = state.catalog.find(c => c.imdbId === 'tt16358384') || state.catalog[1];
            activeQueue = [def1, def2].filter(Boolean).slice(0, 2 - items.length).map(it => ({
              imdbId: it.imdbId, title: it.title, type: it.type || 'series', poster: it.poster, backdrop: it.backdrop, season: 1, episode: 1, currentTime: 0, completed: false, isSuggestion: true
            }));
          }
          activeQueue.forEach(pickProg => {
            const fallbackIt = knownItem(pickProg.imdbId) || { imdbId: pickProg.imdbId, type: pickProg.type || 'series', title: pickProg.title, poster: pickProg.poster, backdrop: pickProg.backdrop };
            let sNum = pickProg.season || 1;
            let eNum = pickProg.episode || 1;
            let epSub = '';
            if (pickProg.completed && fallbackIt.type === 'series') {
              const map = state.episodesCache[pickProg.imdbId] || (state.cwMaps && state.cwMaps[pickProg.imdbId]);
              const next = map ? computeAdjacentEpisode({ item: fallbackIt, season: sNum, episode: eNum }, 1, map) : { season: sNum, episode: eNum + 1, title: '' };
              if (next) { sNum = next.season; eNum = next.episode; epSub = next.title || ''; }
            }
            const tagTxt = pickProg.isSuggestion
              ? `⚡ Pré-carrega S${pad2(sNum)}E${pad2(eNum)} no disco`
              : (pickProg.completed
                  ? `▶ Seguinte: S${pad2(sNum)}E${pad2(eNum)}${epSub ? ' — ' + epSub : ''}`
                  : `▶ Retomar S${pad2(sNum)}E${pad2(eNum)} aos ${formatTime(pickProg.currentTime)}`);

            const upRow = document.createElement('div');
            upRow.className = 'p-2 rounded-xl bg-[#131929] border mac-border flex items-center justify-between gap-2';
            upRow.innerHTML = `
              <div class="flex items-center gap-2 min-w-0">
                <img src="${esc(fallbackIt.poster)}" alt="" class="ms-dash-thumb bg-slate-900" style="width:34px!important;height:48px!important;min-width:34px!important" />
                <div class="min-w-0">
                  <span class="text-[9px] font-mono uppercase text-amber-300 block">${pickProg.isSuggestion ? '💡 Sugestão Maratona' : '📺 Série em Curso'}</span>
                  <p class="text-xs font-bold text-white truncate">${esc(fallbackIt.title)}</p>
                  <p class="text-[10px] text-slate-300 truncate">${esc(tagTxt)}</p>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button type="button" class="dash-up-play px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold">▶ Ver</button>
                <button type="button" class="dash-up-cache px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/35 text-[10px] font-bold" title="Guardar episódio no disco para arranque em 0ms">⚡ Cache</button>
              </div>
            `;
            upRow.querySelector('.dash-up-play').addEventListener('click', () => {
              if (!pickProg.isSuggestion && !pickProg.completed) resumeSavedProgressItem(pickProg);
              else quickPlayItemDirect(fallbackIt, sNum, eNum, 0, epSub);
            });
            upRow.querySelector('.dash-up-cache').addEventListener('click', () => {
              preloadItemToCache(fallbackIt, sNum, eNum, epSub);
            });
            grid.appendChild(upRow);
          });
        }
      }

      // S2 & S3: Fila dinâmica de Hubs & Tempo Disponível
      function parseRuntimeMinutes(it) {
        const m = /(\d+)/.exec(String(it.runtime || ''));
        if (m) return parseInt(m[1], 10);
        return it.type === 'series' ? 48 : 115;
      }

      function renderHubSpotlightRow() {
        const box = document.getElementById('hubSpotlightContainer');
        if (!box) return;
        const show = state.appMode === 'cine' && state.activeNav === 'discover' && !state.searchQuery.trim() && !state.forceShowExplorer;
        box.classList.toggle('hidden', !show);
        if (!show) return;

        const poolMap = new Map();
        [...(state.home.pool || []), ...state.catalog, ...Object.values(state.home.known || {})].forEach(it => {
          if (it && it.imdbId && !poolMap.has(it.imdbId)) poolMap.set(it.imdbId, it);
        });
        let list = Array.from(poolMap.values());

        const hub = state.activeHub || 'foryou';
        let hubTitle = '✨ Escolhas em Destaque para Ti';
        let hubSub = 'Filmes e séries adaptados ao teu perfil e tempo disponível';

        if (hub === 'crime') {
          hubTitle = '🕵️ Crime, Máfia & Investigação';
          hubSub = 'Impérios criminosos, thrillers policiais e conspirações (estilo Tulsa King & The Wire)';
          list = list.filter(i => (i.genres || []).some(g => /Crime|Thriller|Mystery/i.test(g)));
        } else if (hub === 'prestige') {
          hubTitle = '👑 Séries & Dramas de Prestígio (HBO / Apple TV+)';
          hubSub = 'As produções mais aclamadas com nota IMDb superior a 8.0';
          list = list.filter(i => (i.genres || []).some(g => /Drama|History|Biography/i.test(g)) && (parseFloat(i.rating) || 0) >= 7.8);
        } else if (hub === 'scifi') {
          hubTitle = '🚀 Ficção Científica, Espaço & Mistério';
          hubSub = 'Futuros distópicos, viagens espaciais e thrillers mentais';
          list = list.filter(i => (i.genres || []).some(g => /Sci-Fi|Science Fiction|Fantasy|Mystery/i.test(g)));
        } else if (hub === 'comedy') {
          hubTitle = '😂 Sitcoms & Comédias para Descontrair';
          hubSub = 'Episódios leves e rápidos para rir';
          list = list.filter(i => (i.genres || []).some(g => /Comedy|Animation|Family/i.test(g)));
        } else if (hub === 'action') {
          hubTitle = '🔥 Ação, Adrenalina & Aventura';
          hubSub = 'Ritmo intenso do primeiro ao último minuto';
          list = list.filter(i => (i.genres || []).some(g => /Action|Adventure|War/i.test(g)));
        }

        const tp = state.activeTimePill || 'all';
        if (tp === '25') {
          list = list.filter(i => i.type === 'series' && (parseRuntimeMinutes(i) <= 35 || (i.genres || []).includes('Comedy')));
          hubSub += ' • ⏱ Episódios curtos (~25 min)';
        } else if (tp === '50') {
          list = list.filter(i => i.type === 'series' && parseRuntimeMinutes(i) > 35);
          hubSub += ' • ⏱ Episódios de série (~50 min)';
        } else if (tp === '95') {
          list = list.filter(i => i.type === 'movie' && parseRuntimeMinutes(i) <= 112);
          hubSub += ' • ⏱ Filmes rápidos (até 1h50)';
        } else if (tp === '120') {
          list = list.filter(i => i.type === 'movie' && parseRuntimeMinutes(i) > 112);
          hubSub += ' • ⏱ Sessão Cinema (+2h)';
        }

        if (!list.length) list = Array.from(poolMap.values()).slice(0, 14);
        list.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));

        box.innerHTML = '';
        const row = mkRow(hubTitle, hubSub, list.slice(0, 16).map(it => ({ item: it, badge: it.runtime ? `⏱ ${it.runtime}` : '' })));
        if (row) box.appendChild(row);
      }

      // S5: Faixa rápida de canais IPTV em direto na Home
      function renderHomeIptvStrip() {
        const sec = document.getElementById('homeIptvQuickStrip');
        const row = document.getElementById('homeIptvChipsRow');
        const lbl = document.getElementById('homeIptvTotalLabel');
        if (!sec || !row) return;
        const show = state.appMode === 'cine' && state.activeNav === 'discover' && !state.searchQuery.trim() && !state.forceShowExplorer && Array.isArray(state.iptvChannels) && state.iptvChannels.length > 0;
        sec.classList.toggle('hidden', !show);
        if (!show) return;

        if (lbl) lbl.textContent = `• ${state.iptvChannels.length} canais disponíveis`;
        const favs = (state.iptvFavorites || []).map(id => findIptvChannel(id)).filter(Boolean);
        const recents = (state.iptvHistory || []).map(id => findIptvChannel(id)).filter(Boolean);
        const combined = [];
        const seen = new Set();
        [...favs, ...recents, ...state.iptvChannels.slice(0, 12)].forEach(ch => {
          if (ch && !seen.has(String(ch.id))) {
            seen.add(String(ch.id));
            combined.push(ch);
          }
        });

        row.innerHTML = '';
        combined.slice(0, 10).forEach(ch => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ms-iptv-chip';
          const isFav = state.iptvFavorites.includes(String(ch.id));
          btn.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>${isFav ? '★ ' : ''}${esc(ch.name)}</span>
            <span class="text-[10px] text-slate-400 font-normal">${esc(cleanCategoryDisplayName(ch.category || 'Direto'))}</span>
          `;
          btn.addEventListener('click', () => {
            setAppMode('iptv');
            playIptvChannelById(ch.id);
          });
          row.appendChild(btn);
        });
      }

      async function preloadItemToCache(item, season, episode, epTitle) {
        if (!item) return;
        await ensureImdbId(item);
        let sNum = season || 1, eNum = episode || 1;
        if (item.type === 'series' && !season) {
          const cp = await continuePoint(item);
          if (cp) { sNum = cp.season; eNum = cp.episode; }
        }
        const label = item.type === 'series' ? `${item.title} S${pad2(sNum)}E${pad2(eNum)}` : item.title;
        showToast(`⚡ A preparar cache para ${label}…`);
        const streams = await fetchStreamsFor(item, sNum, eNum);
        const pick = pickBestStream(streams, '1080p', false) || (streams && streams[0]);
        if (!pick || (!pick.magnetUri && !pick.infoHash)) {
          showToast('Não encontrei torrent ativo para guardar em cache.');
          return;
        }
        const E = window.macstreamApp && window.macstreamApp.engineUrl;
        const magnet = pick.magnetUri || buildMagnet(pick.infoHash, item.title, []);
        if (E) {
          if (pick.infoHash) fetchAndInjectBrowserTorrent(E, pick.infoHash).catch(() => {});
          const q = new URLSearchParams({
            magnet,
            full: '1',
            title: item.title,
            imdbId: item.imdbId,
            poster: item.poster || '',
            backdrop: item.backdrop || ''
          });
          if (Number.isInteger(pick.fileIdx)) q.set('fileIdx', String(pick.fileIdx));
          if (item.type === 'series') {
            q.set('season', String(sNum));
            q.set('episode', String(eNum));
          }
          await fetch(`${E}/preload?${q.toString()}`).catch(() => {});
          showToast(`⚡ "${label}" adicionado à pasta de Cache!`);
          setTimeout(pollEpisodeCache, 400);
        } else {
          const h = (pick.infoHash || hashStr(magnet)).padEnd(40, '0').slice(0, 40);
          const simEntry = {
            infoHash: h,
            fileIdx: pick.fileIdx || 0,
            name: pick.filename || pick.title || `${item.title}.mkv`,
            title: item.title,
            imdbId: item.imdbId,
            season: item.type === 'series' ? sNum : null,
            episode: item.type === 'series' ? eNum : null,
            poster: item.poster,
            backdrop: item.backdrop,
            magnet,
            length: 550 * 1048576,
            progress: 0.24,
            paused: true,
            downloadSpeed: 0,
            numPeers: pick.seeders || 42,
            isPrimary: true,
            updatedAt: Date.now()
          };
          state.localCacheSim = [simEntry, ...(state.localCacheSim || []).filter(x => !(x.infoHash === h && x.imdbId === item.imdbId && Number(x.season || 0) === Number(simEntry.season || 0) && Number(x.episode || 0) === Number(simEntry.episode || 0)))].slice(0, 8);
          storage.set('ms_local_cache_sim', state.localCacheSim);
          pollEpisodeCache();
          showToast(`⚡ "${label}" guardado na pasta de Cache!`);
        }
      }

      async function quickPlayItemDirect(item, season, episode, resumeSec, epTitle) {
        if (!item) return;
        await ensureImdbId(item);
        let sNum = season || 1, eNum = episode || 1;
        if (item.type === 'series' && !season) {
          const cp = await continuePoint(item);
          if (cp) { sNum = cp.season; eNum = cp.episode; }
        }
        const pKey = getProgressKey(item.imdbId, item.type, sNum, eNum);
        const saved = state.watchProgressMap[pKey];
        const startAt = resumeSec != null ? resumeSec : ((saved && !saved.completed) ? saved.currentTime : 0);

        const cached = findCacheEntryForItem(item.imdbId, item.type === 'series' ? sNum : null, item.type === 'series' ? eNum : null);
        if (cached && cached.infoHash) {
          launchVideoPlayer({
            item,
            season: sNum,
            episode: eNum,
            episodeTitle: epTitle || '',
            stream: {
              addon: 'Cache Local MacStream',
              title: cached.name || item.title,
              filename: cached.name || '',
              resolution: '1080p',
              seeders: cached.numPeers || 60,
              infoHash: cached.infoHash,
              fileIdx: cached.fileIdx,
              fromCache: true,
              magnetUri: cached.magnet || buildMagnet(cached.infoHash, item.title, [])
            },
            resumeSeconds: startAt
          });
          return;
        }

        const label = item.type === 'series' ? `${item.title} • S${pad2(sNum)}E${pad2(eNum)}` : item.title;
        showToast(`⚡ A escolher a fonte mais rápida para ${label}…`);
        const streams = await fetchStreamsFor(item, sNum, eNum);
        state.scrapedStreams = streams;
        state.scrapedStreamsKey = getContextStreamsKey(item, sNum, eNum);
        const best = pickBestStream(streams, '1080p', false) || (streams && streams[0]);
        if (!best) {
          showToast('Sem fontes automáticas — escolhe manualmente na gaveta.');
          openDetailDrawer(item);
          return;
        }
        launchVideoPlayer({
          item,
          season: sNum,
          episode: eNum,
          episodeTitle: epTitle || (saved && saved.episodeTitle) || '',
          stream: best,
          resumeSeconds: startAt
        });
      }

      function syncHomeVsExplorerVisibility() {
        const isHomePure = state.appMode === 'cine' && state.activeNav === 'discover' && !state.searchQuery.trim() && state.activeGenre === 'ALL' && !catFiltersActive() && !state.forceShowExplorer;
        const topDash = document.getElementById('homeTopDashboard');
        const hubsBar = document.getElementById('homeHubsAndTimeBar');
        const openBanner = document.getElementById('openExplorerBanner');
        const catSec = document.getElementById('catalogExplorerSection');
        const backBtn = document.getElementById('backToHomeFromCatalogBtn');
        if (topDash) topDash.classList.toggle('hidden', !isHomePure);
        if (hubsBar) hubsBar.classList.toggle('hidden', !isHomePure);
        if (openBanner) openBanner.classList.toggle('hidden', !isHomePure);
        if (catSec) catSec.classList.toggle('hidden', isHomePure);
        if (backBtn) backBtn.classList.toggle('hidden', state.activeNav !== 'discover');
      }

      function renderAllSections() {
        syncHomeVsExplorerVisibility();
        pollEpisodeCache();
        renderContinueWatchingRow();
        renderHubSpotlightRow();
        renderHomeIptvStrip();
        if (!document.getElementById('catalogExplorerSection').classList.contains('hidden')) {
          renderCatalogGrid();
        }
        renderHomeRows();
      }

      // =======================================================================
      // 8. STREMIO DETAIL DRAWER & LIVE TORRENTIO STREAM SCRAPER
      // =======================================================================
      async function openDetailDrawer(item) {
        state.selectedItem = item;
        state.selectedSeason = 1;
        state.selectedEpisode = 1;
        state.continueSel = null;
        state.scrapedStreams = [];
        state.scrapedStreamsKey = '';
        state.activeResFilter = 'ALL';

        document.querySelectorAll('.res-filter-btn').forEach(btn => {
          const isAll = btn.getAttribute('data-resfilter') === 'ALL';
          btn.className = 'res-filter-btn px-2.5 py-1 rounded-lg text-[11px] mac-transition ' +
            (isAll ? 'font-semibold bg-indigo-600 text-white' : 'font-medium bg-[#0b0f19] text-slate-300 hover:text-white border mac-border');
        });

        el.detailBackdrop.src = item.backdrop || item.poster || '';
        el.detailPoster.src = item.poster || '';
        el.detailTypeBadge.textContent = item.type === 'series' ? 'SÉRIE TV' : 'FILME';
        el.detailImdbBadge.textContent = `★ ${item.rating || '—'} IMDb`;
        el.detailYearRuntime.textContent = [item.year, item.runtime].filter(Boolean).join(' • ');
        el.detailImdbIdTag.textContent = item.imdbId;
        el.detailTitle.textContent = item.title;
        el.detailGenres.textContent = Array.isArray(item.genres) ? item.genres.join(' • ') : '';
        el.detailPlot.textContent = item.plot || 'Sem sinopse disponível.';
        el.detailCast.textContent = item.cast || '—';

        updateDetailButtonsState();
        el.detailModal.classList.remove('hidden');

        await ensureImdbId(item);
        if (state.selectedItem !== item) return;

        if (item.type === 'series') {
          el.seriesEpisodesContainer.classList.remove('hidden');
          await loadSeriesEpisodesMetadata(item);
          if (state.selectedItem !== item) return;
          const cp = await continuePoint(item);
          if (state.selectedItem !== item) return;
          if (cp) {
            state.continueSel = cp;
            state.selectedSeason = cp.season;
            state.selectedEpisode = cp.episode;
            renderSeasonTabsAndEpisodes();
            updateDetailButtonsState();
          }
        } else {
          el.seriesEpisodesContainer.classList.add('hidden');
        }

        scrapeStreamsForCurrentSelection();
      }

      function updateDetailButtonsState() {
        const item = state.selectedItem;
        if (!item) return;

        // Library button state
        const inLib = Boolean(state.libraryMap[item.imdbId]);
        el.detailLibIcon.textContent = inLib ? '♥' : '＋';
        el.detailLibText.textContent = inLib ? 'Na Minha Biblioteca' : 'Guardar na Biblioteca';

        // Progress & Watched state
        const key = getProgressKey(item.imdbId, item.type, state.selectedSeason, state.selectedEpisode);
        const prog = state.watchProgressMap[key];

        if (prog && prog.currentTime > 5 && !prog.completed) {
          el.detailResumeBtn.classList.remove('hidden');
          el.detailResumeBtn.classList.add('flex');
          el.detailResumeBtn.innerHTML = `<span>▶ Retomar ${item.type === 'series' ? `S${String(state.selectedSeason).padStart(2,'0')}E${String(state.selectedEpisode).padStart(2,'0')} ` : ''}aos ${formatTime(prog.currentTime)}</span>`;
        } else {
          el.detailResumeBtn.classList.add('hidden');
          el.detailResumeBtn.classList.remove('flex');
        }

        const isWatched = prog && prog.completed;
        el.detailWatchedText.textContent = isWatched ? 'Marcado como Visto ✓' : 'Marcar como Visto';

        const qt = document.getElementById('detailQuickPlayText');
        if (qt) {
          const lab = item.type === 'series' ? ` S${pad2(state.selectedSeason)}E${pad2(state.selectedEpisode)}` : '';
          const cs = state.continueSel;
          const isCont = item.type === 'series' && cs && cs.season === state.selectedSeason && cs.episode === state.selectedEpisode;
          qt.textContent = (prog && prog.currentTime > 5 && !prog.completed) ? `⚡ Retomar${lab} aos ${formatTime(prog.currentTime)}` : (isCont ? `⚡ Continuar${lab}` : `⚡ Ver${lab || ' já'}`);
        }
      }

      async function getSeriesEpisodesMap(item) {
        if (!item) return {};
        if (state.episodesCache[item.imdbId]) return state.episodesCache[item.imdbId];

        const map = {};
        if (item.imdbId && item.imdbId.startsWith('tt')) {
          try {
            const res = await fetch(`https://v3-cinemeta.strem.io/meta/series/${item.imdbId}.json`);
            if (res.ok) {
              const data = await res.json();
              if (data && data.meta && Array.isArray(data.meta.videos)) {
                data.meta.videos.forEach(v => {
                  const sNum = Number(v.season);
                  const eNum = Number(v.episode || v.number);
                  if (!sNum || sNum < 1 || !eNum) return;
                  if (!map[sNum]) map[sNum] = [];
                  map[sNum].push({
                    season: sNum,
                    episode: eNum,
                    title: v.name || v.title || `Episódio ${eNum}`,
                    overview: v.overview || v.description || '',
                    thumbnail: v.thumbnail || item.backdrop,
                    released: v.released ? String(v.released).slice(0, 10) : ''
                  });
                });
                Object.keys(map).forEach(s => map[s].sort((a, b) => a.episode - b.episode));
              }
            }
          } catch (e) {}
        }

        if (Object.keys(map).length > 0) {
          state.episodesCache[item.imdbId] = map;
          return map;
        }

        // Sem dados online: gera uma grelha genérica para continuar a poder escolher episódios
        const totalSeasons = item.seasonsCount || 3;
        for (let s = 1; s <= totalSeasons; s++) {
          map[s] = [];
          for (let e = 1; e <= 10; e++) {
            map[s].push({ season: s, episode: e, title: `Episódio ${e}`, overview: '', thumbnail: item.backdrop || item.poster, released: '' });
          }
        }
        return map;
      }

      async function loadSeriesEpisodesMetadata(item) {
        state.seriesEpisodesBySeason = {};
        el.seasonTabsList.innerHTML = '<span class="text-xs text-slate-400">A carregar temporadas...</span>';
        el.episodesListContainer.innerHTML = '';
        const map = await getSeriesEpisodesMap(item);
        if (state.selectedItem !== item) return;
        state.seriesEpisodesBySeason = map;
        renderSeasonTabsAndEpisodes();
      }

      function renderSeasonTabsAndEpisodes() {
        const seasons = Object.keys(state.seriesEpisodesBySeason).map(Number).sort((a, b) => a - b);
        if (!seasons.includes(state.selectedSeason)) {
          state.selectedSeason = seasons[0] || 1;
        }

        el.seasonTabsList.innerHTML = '';
        seasons.forEach(sNum => {
          const active = sNum === state.selectedSeason;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'px-3 py-1 rounded-xl text-xs font-semibold shrink-0 mac-transition ' +
            (active ? 'bg-indigo-600 text-white' : 'bg-[#131825] text-slate-300 hover:text-white border mac-border');
          btn.textContent = `Temporada ${sNum}`;
          btn.title = 'Clique direito: marcar a temporada toda como vista';
          btn.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            const eps = state.seriesEpisodesBySeason[sNum] || [];
            const allSeen = eps.length && eps.every(e2 => isEpisodeWatched(state.selectedItem.imdbId, e2.season, e2.episode));
            eps.forEach(e2 => setEpisodeWatched(state.selectedItem, e2, !allSeen, true));
            renderSeasonTabsAndEpisodes(); renderContinueWatchingRow(); renderHomeRows();
            showToast(allSeen ? `Temporada ${sNum} marcada como por ver` : `Temporada ${sNum} marcada como vista ✓`);
          });
          btn.addEventListener('click', () => {
            state.selectedSeason = sNum;
            state.selectedEpisode = 1;
            renderSeasonTabsAndEpisodes();
            updateDetailButtonsState();
            scrapeStreamsForCurrentSelection();
          });
          el.seasonTabsList.appendChild(btn);
        });

        const episodes = state.seriesEpisodesBySeason[state.selectedSeason] || [];
        el.seriesActiveEpisodeLabel.textContent = `S${String(state.selectedSeason).padStart(2, '0')}E${String(state.selectedEpisode).padStart(2, '0')}`;
        el.episodesListContainer.innerHTML = '';

        episodes.forEach(ep => {
          const isSelected = ep.episode === state.selectedEpisode;
          const progKey = getProgressKey(state.selectedItem.imdbId, 'series', ep.season, ep.episode);
          const prog = state.watchProgressMap[progKey];
          const isWatched = isEpisodeWatched(state.selectedItem.imdbId, ep.season, ep.episode);
          const pct = (prog && prog.duration > 0) ? Math.min(100, Math.round((prog.currentTime / prog.duration) * 100)) : 0;

          const row = document.createElement('div');
          row.className = 'p-2.5 rounded-xl border mac-transition cursor-pointer flex items-center gap-3 ' +
            (isSelected ? 'bg-indigo-600/20 border-indigo-500/60' : 'bg-[#131825]/80 hover:bg-[#131825] mac-border');

          row.innerHTML = `
            <div class="relative w-28 h-16 rounded-lg overflow-hidden bg-slate-900 shrink-0">
              <img src="${esc(ep.thumbnail)}" alt="" class="w-full h-full object-cover" data-fb="${esc(state.selectedItem.backdrop || '')}" />
              <span class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-white">E${String(ep.episode).padStart(2, '0')}</span>
              ${pct > 0 ? `<div class="absolute bottom-0 inset-x-0 h-1 bg-slate-800"><div class="h-full bg-amber-400" style="width:${pct}%"></div></div>` : ''}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-bold text-white truncate">${ep.episode}. ${esc(ep.title)}</p>
                <div class="flex items-center gap-1 shrink-0">
                  ${(() => {
                    const m = ssResolveEpisodeMapping(episodes, ep.season, ep.episode, ep.title, '');
                    if (!m || !m.isMergedPair) return '';
                    return m.isSecondHalf
                      ? `<span class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[9px] font-mono" title="Este episódio faz parte do ficheiro duplo de 42 min do E${pad2(m.pairEps[0])}">🔗 Unido ao E${pad2(m.pairEps[0])}</span>`
                      : `<span class="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/35 text-[9px] font-mono" title="Episódio duplo de 42 min (inclui E${pad2(m.pairEps[0])}+E${pad2(m.pairEps[1])})">⏱ Duplo E${pad2(m.pairEps[0])}+E${pad2(m.pairEps[1])}</span>`;
                  })()}
                  ${isWatched ? `<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold shrink-0">✓ Visto</span>` : (ep.released && (Date.now() - new Date(ep.released).getTime()) < 14 * 864e5 && new Date(ep.released).getTime() <= Date.now() ? `<span class="px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 text-[10px] font-bold shrink-0">🆕 Novo</span>` : '')}
                </div>
              </div>
              <p class="text-[11px] text-slate-400 line-clamp-1 mt-0.5">${esc(ep.overview)}</p>
            </div>
          `;

          row.title = 'Clique direito: marcar como visto / por ver';
          row.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            setEpisodeWatched(state.selectedItem, ep, !isEpisodeWatched(state.selectedItem.imdbId, ep.season, ep.episode));
          });
          row.addEventListener('click', () => {
            state.selectedEpisode = ep.episode;
            renderSeasonTabsAndEpisodes();
            updateDetailButtonsState();
            scrapeStreamsForCurrentSelection();
          });

          el.episodesListContainer.appendChild(row);
        });
      }

      // =======================================================================
      // 9. TORRENTIO P2P SCRAPER + RESOLUTION & SEEDERS AUTOMATIC SORTING
      // =======================================================================
      function detectResolution(txt) {
        const m = String(txt || '').match(/\b(2160p|4k|uhd|1080p|720p|480p)\b/i);
        if (!m) return 'SD';
        const r = m[1].toLowerCase();
        if (r === '2160p' || r === '4k' || r === 'uhd') return '4K';
        return r;
      }

      function buildMagnet(infoHash, title, sources) {
        let magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title || 'video')}`;
        const trackers = new Set(window.macstreamApp ? [] : WSS_TRACKERS);
        (Array.isArray(sources) ? sources : []).forEach(s => {
          if (typeof s === 'string' && s.startsWith('tracker:')) trackers.add(s.slice(8));
        });
        [
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://open.stealth.si:80/announce',
          'udp://exodus.desync.com:6969/announce',
          'udp://open.demonii.com:1337/announce',
          'udp://tracker.torrent.eu.org:451/announce',
          'udp://explodie.org:6969/announce',
          'udp://tracker.openbittorrent.com:6969/announce',
          'http://tracker.opentrackr.org:1337/announce'
        ].forEach(t => trackers.add(t));
        trackers.forEach(t => { magnet += '&tr=' + encodeURIComponent(t); });
        return magnet;
      }

      function normalizeAddonStream(st, ad, item) {
        const name = String(st.name || '').replace(/\n/g, ' ');
        const rawLines = String(st.title || st.description || '').split('\n').map(s => s.trim()).filter(Boolean);
        const torrentTitle = rawLines[0] || '';
        const rawTitle = String(st.title || st.description || '').replace(/\n/g, ' • ');
        const bhFile = (st.behaviorHints && st.behaviorHints.filename) || '';
        const bhHash = (st.behaviorHints && st.behaviorHints.videoHash) ? String(st.behaviorHints.videoHash).toLowerCase().trim() : '';
        const bhSize = (st.behaviorHints && Number(st.behaviorHints.videoSize) > 0) ? Number(st.behaviorHints.videoSize) : 0;
        const blob = name + ' ' + rawTitle + ' ' + bhFile;
        const seedMatch = rawTitle.match(/👤\s*(\d+)/);
        const sizeMatch = rawTitle.match(/💾\s*([\d.,]+\s*(?:GB|MB|TB))/i);
        const sizeStr = sizeMatch ? sizeMatch[1] : '—';
        const sMB = sizeToMB(sizeStr);
        const directUrl = st.url && /^https?:\/\//i.test(st.url) ? st.url : '';
        const seeders = seedMatch ? parseInt(seedMatch[1], 10) : null;
        const codec = /x265|hevc|h\.?265/i.test(blob) ? 'HEVC x265' : (/x264|h\.?264|avc/i.test(blob) ? 'H.264' : '');
        const isSeries = item && item.type === 'series';
        const isPack = Boolean(isSeries && (
          /\b(complete|season\s*\d+|s\d+\s*complete|pack|temporada\s*\d+|completa)\b/i.test(rawTitle) ||
          /\bs\d+[._\s-]*e\d+\s*-\s*e?\d+\b/i.test(rawTitle) ||
          /\be\d+\s*-\s*e?\d+\b/i.test(torrentTitle) ||
          (rawLines.length >= 3 && !/s\d+[._\s-]*e\d+|\b\d+x\d+\b/i.test(torrentTitle)) ||
          (Number.isInteger(st.fileIdx) && st.fileIdx >= 2 && !/s\d+[._\s-]*e\d+/i.test(torrentTitle))
        ));
        // Versões Superfan / Extended têm cenas extra intercaladas e não batem certo com as legendas padrão do OpenSubtitles!
        const isExtendedCut = /\b(superfan|extended\s*cut|extended\s*edition|uncut|director'?s\s*cut)\b/i.test(blob);
        const hasExplicitIdx = Number.isInteger(st.fileIdx);
        const packFactor = !isPack ? 1.5 : (hasExplicitIdx ? 1.2 : 0.25);
        const cutFactor = isExtendedCut ? 0.12 : 1.0;
        const sizeBonus = isFinite(sMB) ? (sMB <= 1800 ? 1.25 : (sMB > 6000 ? 0.6 : 1.0)) : 1.0;
        const speedScore = (directUrl ? 1000000 : 0) + ((seeders || 0) * packFactor * cutFactor * sizeBonus * (codec === 'H.264' ? 1.1 : 1.0));
        return {
          addon: ad.name,
          title: rawTitle || name || item.title,
          filename: bhFile,
          videoHash: /^[a-f0-9]{16}$/i.test(bhHash) ? bhHash : '',
          videoSize: bhSize,
          resolution: detectResolution(blob),
          seeders,
          size: sizeStr,
          codec,
          isPack,
          isExtendedCut,
          speedScore,
          audioTag: /ddp|eac3|dd\+|atmos|truehd|dts|ac3|dd\s*5\.1|5\.1/i.test(blob) ? '5.1' : (/aac|stereo|2\.0/i.test(blob) ? 'AAC' : ''),
          hdr: /hdr|dolby\s?vision|\bdv\b/i.test(blob) ? 'HDR' : '',
          cached: /\[[A-Z]{2}\+\]/.test(name),
          infoHash: st.infoHash ? String(st.infoHash).toLowerCase() : '',
          fileIdx: hasExplicitIdx ? st.fileIdx : undefined,
          sources: Array.isArray(st.sources) ? st.sources : [],
          magnetUri: st.infoHash ? buildMagnet(String(st.infoHash).toLowerCase(), item.title, st.sources) : '',
          directUrl
        };
      }

      async function fetchStreamsFor(item, season, episode) {
        const out = [];
        if (!item || !item.imdbId || !item.imdbId.startsWith('tt')) return out;
        const vid = item.type === 'series' ? `${item.imdbId}:${season}:${episode}` : item.imdbId;
        const addons = state.addons.filter(a => a.enabled !== false);
        await Promise.all(addons.map(async ad => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 12000);
          try {
            const res = await fetch(`${ad.base}/stream/${item.type}/${vid}.json`, { signal: ctrl.signal });
            if (!res.ok) return;
            const data = await res.json();
            (data.streams || []).forEach(st => {
              if (st && (st.infoHash || st.url)) out.push(normalizeAddonStream(st, ad, item));
            });
          } catch (e) {
          } finally {
            clearTimeout(timer);
          }
        }));
        const rank = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, 'SD': 0 };
        out.sort((a, b) => {
          const r = (rank[b.resolution] || 0) - (rank[a.resolution] || 0);
          if (r !== 0) return r;
          return (b.speedScore || 0) - (a.speedScore || 0);
        });
        return out.slice(0, 60);
      }

      function pickBestStream(streams, prefRes, preferDirect) {
        const rawList = (streams || []).filter(s => !s.isTest);
        if (rawList.length === 0) return null;
        // Evita cortes Extended/Superfan por defeito para garantir que a duração bate 100% com as legendas oficiais
        const stdList = rawList.filter(s => !s.isExtendedCut);
        const list = stdList.length ? stdList : rawList;
        if (preferDirect) {
          const dir = list.find(s => s.directUrl && (!prefRes || s.resolution === prefRes)) || list.find(s => s.directUrl);
          if (dir) return dir;
        }
        const hdHealthy = list.filter(s => (!s.isPack || Number.isInteger(s.fileIdx)) && (s.resolution === '1080p' || s.resolution === '720p') && (s.directUrl || (s.seeders || 0) >= 5));
        if (hdHealthy.length) {
          return [...hdHealthy].sort((a, b) => ((b.speedScore || 0) * (b.resolution === (prefRes || '1080p') ? 1.2 : 1.0)) - ((a.speedScore || 0) * (a.resolution === (prefRes || '1080p') ? 1.2 : 1.0)))[0];
        }
        const targetRes = prefRes || '1080p';
        const sameRes = list.filter(s => s.resolution === targetRes);
        const cand = sameRes.length ? sameRes : list;
        return [...cand].sort((a, b) => (b.speedScore || 0) - (a.speedScore || 0))[0];
      }

      // Obtém o ficheiro .torrent via fetch nativo do Chromium (ultrapassa Cloudflare/TLS) e injeta no motor local!
      const _injectedHashes = new Set();
      async function fetchAndInjectBrowserTorrent(E, infoHash) {
        if (!E || !infoHash || !/^[a-f0-9]{40}$/i.test(infoHash)) return false;
        const h = infoHash.toLowerCase();
        if (_injectedHashes.has(h)) return true;
        const H = h.toUpperCase();
        const urls = [
          `https://itorrents.org/torrent/${H}.torrent`,
          `https://watercache.nanobytes.org/get/${h}`,
          `https://torrage.info/torrent.php?h=${H}`,
          `https://btcache.me/torrent/${H}`
        ];
        return new Promise((resolve) => {
          let settled = false;
          let pending = urls.length;
          const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 4500);
          urls.forEach(async (u) => {
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 4000);
              const r = await fetch(u, { signal: ctrl.signal });
              clearTimeout(t);
              if (r.ok) {
                const ab = await r.arrayBuffer();
                const bytes = new Uint8Array(ab);
                if (bytes.length > 40 && bytes[0] === 0x64) {
                  let bin = '';
                  const chunk = 0x8000;
                  for (let i = 0; i < bytes.length; i += chunk) {
                    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                  }
                  const b64 = btoa(bin);
                  _injectedHashes.add(h);
                  await fetch(`${E}/inject`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ infoHash: h, torrentB64: b64 })
                  }).catch(() => {});
                  if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    return resolve(true);
                  }
                }
              }
            } catch (e) {}
            pending--;
            if (pending <= 0 && !settled) {
              settled = true;
              clearTimeout(timer);
              resolve(false);
            }
          });
        });
      }

      async function scrapeStreamsForCurrentSelection() {
        const item = state.selectedItem;
        if (!item) return;
        const myToken = ++state.scrapeToken;
        const reqSeason = state.selectedSeason;
        const reqEpisode = state.selectedEpisode;

        const targetLabel = item.type === 'series'
          ? `${item.title} • S${pad2(reqSeason)}E${pad2(reqEpisode)}`
          : `${item.title}${item.year ? ' (' + item.year + ')' : ''}`;

        el.streamsSubtitleTarget.textContent = `A procurar fontes para: ${targetLabel}`;
        el.streamsListContainer.innerHTML = `
          <div class="p-8 text-center space-y-2">
            <div class="w-7 h-7 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto"></div>
            <p class="text-xs text-slate-300 font-medium">A consultar os teus add-ons Stremio...</p>
          </div>
        `;

        const collected = await fetchStreamsFor(item, reqSeason, reqEpisode);
        if (myToken !== state.scrapeToken) return;

        state.scrapedStreams = [...collected];
        state.scrapedStreamsKey = getContextStreamsKey(item, reqSeason, reqEpisode);
        el.streamsSubtitleTarget.textContent = collected.length
          ? `${targetLabel} — ordenadas por velocidade e seeders ativos`
          : `${targetLabel} — nenhuma fonte devolvida pelos add-ons ativos`;
        renderScrapedStreamsList();

      }

      function playScrapedStream(st) {
        const epList = state.seriesEpisodesBySeason[state.selectedSeason] || [];
        const epObj = epList.find(e => e.episode === state.selectedEpisode);
        const progKey = getProgressKey(state.selectedItem.imdbId, state.selectedItem.type, state.selectedSeason, state.selectedEpisode);
        const savedProg = state.watchProgressMap[progKey];
        launchVideoPlayer({
          item: state.selectedItem,
          season: state.selectedSeason,
          episode: state.selectedEpisode,
          episodeTitle: epObj ? epObj.title : '',
          stream: st,
          resumeSeconds: (savedProg && !savedProg.completed) ? savedProg.currentTime : 0
        });
      }

      async function quickPlaySelected() {
        const item = state.selectedItem;
        if (!item) return;
        if (!state.scrapedStreams.length) { showToast('A procurar fontes...'); await scrapeStreamsForCurrentSelection(); }
        const st = pickBestStream(state.scrapedStreams, '1080p', false) || pickTopStreams(state.scrapedStreams)[0];
        if (!st) { showToast('Nenhuma fonte disponível para este título.'); return; }
        playScrapedStream(st);
      }

      async function continuePoint(item) {
        const recs = Object.values(state.watchProgressMap).filter(r => r.imdbId === item.imdbId && r.type === 'series' && (r.updatedAt || 0) > 0);
        if (!recs.length) return null;
        const last = recs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (!last.completed && last.currentTime > 3) return { season: last.season || 1, episode: last.episode || 1 };
        const map = await getSeriesEpisodesMap(item);
        const f = furthestWatched(item.imdbId) || last;
        const next = computeAdjacentEpisode({ item, season: f.season || 1, episode: f.episode || 1 }, 1, map);
        return next ? { season: next.season, episode: next.episode } : { season: f.season || 1, episode: f.episode || 1 };
      }

      function sizeToMB(str) {
        const m = /([\d.,]+)\s*(TB|GB|MB)/i.exec(String(str || ''));
        if (!m) return Infinity;
        const n = parseFloat(m[1].replace(',', '.'));
        return n * ({ TB: 1048576, GB: 1024, MB: 1 }[m[2].toUpperCase()]);
      }

      // Por qualidade: a fonte mais rápida (mais seeders / episódio único) e a alternativa leve MAS com seeders ativos!
      function pickTopStreams(all) {
        const rankOrder = ['4K', '1080p', '720p', '480p', 'SD'];
        const groups = {};
        (all || []).filter(s => !s.isTest).forEach(s => { (groups[s.resolution] = groups[s.resolution] || []).push(s); });
        const out = [];
        Object.keys(groups).sort((a, b) => rankOrder.indexOf(a) - rankOrder.indexOf(b)).forEach(res => {
          const g = groups[res];
          const bySpeed = [...g].sort((a, b) => (b.speedScore || 0) - (a.speedScore || 0));
          const best = bySpeed[0];
          best._tag = best.directUrl ? '⚡ Mais rápida' : '🚀 Mais seeders';
          out.push(best);
          // Só considera como "🪶 Mais leve" fontes que tenham pelo menos 12 seeders (ou >= 30% dos seeders da melhor), nunca torrents mortos!
          const minSeeds = Math.max(8, Math.min(20, Math.floor((best.seeders || 0) * 0.3)));
          const healthy = g.filter(s => s !== best && (s.directUrl || (s.seeders || 0) >= minSeeds) && !s.isPack && sizeToMB(s.size) !== Infinity);
          const light = healthy.filter(s => !/HEVC/i.test(s.codec || ''));
          const pool = light.length ? light : healthy;
          let lite = pool.sort((a, b) => sizeToMB(a.size) - sizeToMB(b.size))[0] || bySpeed[1];
          if (lite && lite !== best) { lite._tag = '🪶 Mais leve'; out.push(lite); }
        });
        return out;
      }

      function renderScrapedStreamsList() {
        const top = pickTopStreams(state.scrapedStreams);
        const topSet = new Set(top);
        const rest = (state.scrapedStreams || []).filter(s => !s.isTest && !topSet.has(s));
        const combined = [...top, ...rest];
        const filtered = state.activeResFilter === 'ALL'
          ? combined
          : combined.filter(s => s.resolution.toUpperCase() === state.activeResFilter.toUpperCase());

        el.streamsTotalBadge.textContent = `${filtered.filter(s => !s.isTest).length} streams`;
        el.streamsListContainer.innerHTML = '';

        if (!state.addons.some(a => a.enabled !== false)) {
          const warn = document.createElement('div');
          warn.className = 'p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200';
          warn.textContent = 'Não tens nenhum add-on de streams ativo. Abre ⚙️ TMDB & Add-ons para instalar um.';
          el.streamsListContainer.appendChild(warn);
        }

        filtered.forEach(st => {
          const resColor = st.resolution === '4K'
            ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
            : (st.resolution === '1080p' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40');

          let hint;
          if (st.directUrl) hint = `☁️ Link direto${st.cached ? ' (em cache)' : ''} • reproduz já no browser`;
          else if (st.isWebRtcNative) hint = '🌐 WebRTC direto no browser';
          else hint = window.macstreamApp ? '🧲 Torrent • motor interno da app (TCP/UDP/DHT)' : '🧲 Torrent • Stremio local ou WebTorrent (só peers WebRTC)';

          const card = document.createElement('div');
          card.className = 'p-3 rounded-xl border cursor-pointer mac-transition space-y-2 group bg-[#0b0f19]/90 hover:bg-[#0b0f19] mac-border hover:border-indigo-500/60';

          card.innerHTML = `
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="px-2 py-0.5 rounded-md border font-mono text-[11px] font-bold ${resColor}">${esc(st.resolution)}</span>
                <span class="text-[11px] font-bold text-slate-200">${esc(st.addon)}</span>
                ${st._tag ? `<span class="px-1.5 py-0.5 rounded bg-indigo-500/25 text-indigo-200 text-[10px] font-semibold">${esc(st._tag)}</span>` : ''}
                ${st.hdr ? `<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-semibold">${esc(st.hdr)}</span>` : ''}
                ${st.codec ? `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono">${esc(st.codec)}</span>` : ''}
                ${/HEVC|x265/i.test(st.codec || '') || st.resolution === '4K' ? '<span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-semibold" title="Ficheiro pesado de descodificar: o Mac pode aquecer">⚠ Aquece o Mac</span>' : ''}
              </div>
              <div class="flex items-center gap-2 font-mono text-[11px] shrink-0">
                ${st.seeders != null ? `<span class="${st.seeders < 3 ? 'text-rose-400' : (st.seeders >= 50 ? 'text-emerald-300' : 'text-emerald-400')} font-semibold" title="Segundo o índice de fontes — o número real ligado costuma ser menor">${st.seeders >= 50 ? '🔥' : (st.seeders < 3 ? '💀' : '👤')} ${st.seeders}</span>` : ''}
                <span class="text-slate-400">💾 ${esc(st.size)}</span>
              </div>
            </div>
            <p class="text-[11px] text-slate-300 line-clamp-2 leading-relaxed group-hover:text-white">${esc(st.title)}</p>
            <div class="flex items-center justify-between pt-1 gap-2">
              <span class="text-[10px] font-mono text-indigo-400">${esc(hint)}</span>
              <span class="text-xs font-bold text-indigo-300 group-hover:translate-x-0.5 mac-transition">▶ Ver</span>
            </div>
          `;

          card.addEventListener('click', () => {
            lsSet('ms_pref', { res: st.resolution, tag: st._tag || '' });
            playScrapedStream(st);
          });

          el.streamsListContainer.appendChild(card);
        });
      }

      // =======================================================================
      // 10. MOTORES DE REPRODUÇÃO (SEM PYTHON): LINK DIRETO/DEBRID, STREMIO LOCAL, WEBTORRENT
