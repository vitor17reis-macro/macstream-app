'use strict';
      // =======================================================================
      // 5C. MACSTREAM PRO IPTV LIVE ENGINE v2.5 (LOGOS + VARIANT GROUPING + 4 VISTAS)
      // =======================================================================
      function findIptvChannel(id) {
        if (id === undefined || id === null || id === '') return null;
        const s = String(id);
        return state.iptvChannels.find(c => String(c.id) === s) || state.iptvExtra[s] || null;
      }

      function getCurrentIptvChannel() {
        return findIptvChannel(state.iptvCurrentChannelId) || state.iptvChannels[0] || null;
      }

      function getSecondaryIptvChannel() {
        return findIptvChannel(state.iptvSecondaryChannelId);
      }

      // Converte caracteres Unicode sobrescritos/modificadores (ex: RTP1ᶠᴴᴰ, RTP1⁴ᴷ, SICᴴᴰ) para ASCII normal
      const SUPERSCRIPT_MAP = {
        'ᴬ':'A','ᴮ':'B','ᴰ':'D','ᴱ':'E','ᴳ':'G','ᴴ':'H','ᴵ':'I','ᴶ':'J','ᴷ':'K','ᴸ':'L','ᴹ':'M','ᴺ':'N','ᴼ':'O','ᴾ':'P','ᴿ':'R','ᵀ':'T','ᵁ':'U','ⱽ':'V','ᵂ':'W',
        'ᵃ':'a','ᵇ':'b','ᶜ':'c','ᵈ':'d','ᵉ':'e','ᶠ':'f','ᵍ':'g','ʰ':'h','ⁱ':'i','ʲ':'j','ᵏ':'k','ˡ':'l','ᵐ':'m','ⁿ':'n','ᵒ':'o','ᵖ':'p','ʳ':'r','ˢ':'s','ᵗ':'t','ᵘ':'u','ᵛ':'v','ʷ':'w','ˣ':'x','ʸ':'y','ᶻ':'z',
        '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁺':'+','⁻':'-'
      };
      function decodeSuperscriptText(str) {
        if (!str) return '';
        return String(str).replace(/[ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (seq) => {
          return ' ' + seq.split('').map(c => SUPERSCRIPT_MAP[c] || c).join('');
        });
      }

      // Limpa símbolos decorativos das pastas Xtream (ex: "★●• PORTUGAL •●★" -> "🇵🇹 Portugal")
      function cleanCategoryDisplayName(rawCat) {
        if (!rawCat || rawCat === 'ALL') return 'Todos os Canais';
        let c = decodeSuperscriptText(rawCat)
          .replace(/^[★☆●•▪▫◆◇▶►|_=\-\s]+/g, '')
          .replace(/[★☆●•▪▫◆◇◀◄|_=\-\s]+$/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (!c) c = String(rawCat).trim();
        const low = c.toLowerCase();
        // Adiciona bandeira se ainda não tiver emoji
        if (!/[\u{1F1E6}-\u{1F1FF}]/u.test(c)) {
          if (/^portugal|\bpt\b/.test(low)) c = '🇵🇹 ' + c;
          else if (/^brasil|\bbr\b/.test(low)) c = '🇧🇷 ' + c;
          else if (/^spain|espanha|\bes\b/.test(low)) c = '🇪🇸 ' + c;
          else if (/^uk\b|united kingdom|england/.test(low)) c = '🇬🇧 ' + c;
          else if (/^usa\b|united states/.test(low)) c = '🇺🇸 ' + c;
          else if (/^france|fran[cç]a/.test(low)) c = '🇫🇷 ' + c;
          else if (/^germany|alemanha/.test(low)) c = '🇩🇪 ' + c;
          else if (/^italy|it[aá]lia/.test(low)) c = '🇮🇹 ' + c;
          else if (/^holanda|netherlands/.test(low)) c = '🇳🇱 ' + c;
          else if (/^belgium|b[eé]lgica/.test(low)) c = '🇧🇪 ' + c;
          else if (/^suisse|switzerland|su[ií][cç]a/.test(low)) c = '🇨🇭 ' + c;
          else if (/^t[uü]rkiye|turkey/.test(low)) c = '🇹🇷 ' + c;
          else if (/desporto|sport/.test(low)) c = '⚽ ' + c;
          else if (/exclusiv|vip/.test(low)) c = '⭐ ' + c;
        }
        return c;
      }

      function normalizeChannelBaseName(name) {
        if (!name) return '';
        return decodeSuperscriptText(name)
          .toLowerCase()
          .replace(/\(.*?\)/g, '')
          .replace(/\[.*?\]/g, '')
          .replace(/^(pt|br|es|uk|us|fr|de|it)\s*[:|\-]\s*/i, '')
          .replace(/\b(4k|uhd|fhd|fullhd|hd|sd|low|h265|hevc|vip|pt|bkp|backup|1080p|720p|50fps|60fps|raw)\b/gi, '')
          .replace(/[^a-z0-9]/g, '');
      }

      function channelBase(ch) {
        if (ch._base === undefined) ch._base = normalizeChannelBaseName(ch.name);
        return ch._base;
      }

      function extractVariantQualityTag(name) {
        const n = decodeSuperscriptText(String(name || ''));
        if (/\b(4k|uhd)\b/i.test(n)) return '4K';
        if (/\b(h265|hevc)\b/i.test(n)) return 'H265';
        if (/\b(fhd|fullhd|1080p)\b/i.test(n)) return 'FHD';
        if (/\b(low|480p|360p)\b/i.test(n)) return 'LOW';
        if (/\bsd\b/i.test(n)) return 'SD';
        if (/\b(hd|720p)\b/i.test(n)) return 'HD';
        return 'SD/HD';
      }

      function stripQualitySuffixFromName(name) {
        const cleaned = decodeSuperscriptText(String(name || ''))
          .replace(/\s*\([^)]*\)\s*$/g, '')
          .replace(/\s*\[[^\]]*\]\s*$/g, '')
          .replace(/^(pt|br|es|uk|us|fr|de|it)\s*[:|\-]\s*/i, '')
          .replace(/\b(4k|uhd|fhd|fullhd|hd|sd|low|h265|hevc|1080p|720p|bkp|backup|50fps|60fps)\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .replace(/[\s\-|•:]+$/g, '')
          .trim();
        return cleaned.length >= 2 ? cleaned : String(name || 'Canal');
      }

      function getChannelMonogram(name) {
        const clean = stripQualitySuffixFromName(name).replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
        const parts = clean.split(/\s+/).filter(Boolean);
        if (!parts.length) return 'TV';
        if (parts.length === 1) return parts[0].slice(0, 4).toUpperCase();
        const last = parts[parts.length - 1];
        if (/^\d+$/.test(last)) {
          return (parts[0].slice(0, 3) + last).toUpperCase();
        }
        return (parts[0].slice(0, 2) + parts[1].slice(0, 2)).toUpperCase();
      }

      function renderChannelLogoHtml(ch) {
        const mono = esc(getChannelMonogram(ch && ch.name));
        const logoUrl = ch && ch.logo && /^https?:\/\//i.test(ch.logo) ? ch.logo : '';
        if (logoUrl) {
          return `<div class="ms-ch-logo"><img src="${esc(logoUrl)}" alt="${mono}" loading="lazy" data-mono="${mono}" /></div>`;
        }
        return `<div class="ms-ch-logo">${mono}</div>`;
      }

      function getVariantWeight(name) {
        const n = decodeSuperscriptText(name || '').toLowerCase();
        if (/\b(low|480p|360p)\b/.test(n)) return 1;
        if (/\bsd\b/.test(n)) return 2;
        if (/\b(h265|hevc)\b/.test(n)) return 3;
        if (/\b(hd|720p)\b/.test(n)) return 4;
        if (/\b(fhd|fullhd|1080p)\b/.test(n)) return 5;
        if (/\b(4k|uhd)\b/.test(n)) return 6;
        return 3;
      }

      function findSiblingVariants(channel) {
        if (!channel || !channel.name) return [];
        const base = channelBase(channel);
        if (!base || base.length < 3) return [channel];
        const sec = channel.section || 'live';
        const matches = state.iptvChannels.filter(c => (c.section || 'live') === sec && channelBase(c) === base);
        return matches.length > 0 ? matches : [channel];
      }

      function findLighterOrAlternativeVariant(channel) {
        const siblings = findSiblingVariants(channel).filter(c => String(c.id) !== String(channel.id));
        if (siblings.length === 0) return null;
        siblings.sort((a, b) => getVariantWeight(a.name) - getVariantWeight(b.name));
        return siblings[0];
      }

      // Agrupa automaticamente variantes repetidas do mesmo canal (FHD / HD / H265 / LOW) num único registo limpo
      function groupIptvChannelVariants(flatList) {
        if (!state.iptvGroupVariants || state.iptvActiveSection === 'series') {
          return flatList.map(ch => ({
            primary: ch,
            displayName: ch.name,
            variants: [{ ch, tag: extractVariantQualityTag(ch.name) }]
          }));
        }
        const groupsMap = new Map();
        const orderedGroups = [];
        flatList.forEach(ch => {
          const b = channelBase(ch);
          const sec = ch.section || 'live';
          const key = (b && b.length >= 3 && sec === 'live') ? `${sec}:${ch.category || ''}:${b}` : `id:${ch.id}`;
          let g = groupsMap.get(key);
          if (!g) {
            g = {
              key,
              primary: ch,
              displayName: stripQualitySuffixFromName(ch.name),
              variants: []
            };
            groupsMap.set(key, g);
            orderedGroups.push(g);
          }
          g.variants.push({ ch, tag: extractVariantQualityTag(ch.name), weight: getVariantWeight(ch.name) });
          // Se uma das variantes é o canal atualmente selecionado ou tem EPG/logo mais rico, promove a primary
          if (String(ch.id) === String(state.iptvCurrentChannelId)) {
            g.primary = ch;
          } else if (!g.primary.epgNow && ch.epgNow) {
            g.primary = ch;
          } else if (!g.primary.logo && ch.logo) {
            g.primary.logo = ch.logo;
          }
        });
        orderedGroups.forEach(g => {
          g.variants.sort((a, b) => b.weight - a.weight);
        });
        return orderedGroups;
      }

      function saveChannels(list) {
        CineDB.put('kv', { key: 'channels', value: list });
        try { localStorage.removeItem('macstream_channels'); } catch (e) {}
      }

      function buildIptvStreamUrl(ch, extOverride) {
        if (!ch) return '';
        let url = ch.url || '';
        if (ch.xtreamStreamId && state.xtreamConfig.server) {
          let base = state.xtreamConfig.server.trim().replace(/\/+$/, '');
          if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
          const u = encodeURIComponent(state.xtreamConfig.username.trim());
          const p = encodeURIComponent(state.xtreamConfig.password.trim());
          const sid = encodeURIComponent(String(ch.xtreamStreamId));
          const safeExt = (ext) => String(ext || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
          if (ch.section === 'vod') {
            url = `${base}/movie/${u}/${p}/${sid}.${safeExt(ch.format)}`;
          } else if (ch.section === 'series') {
            url = `${base}/series/${u}/${p}/${sid}.${safeExt(ch.format)}`;
          } else {
            const ext = safeExt(extOverride || (state.iptvEngineMode === 'ts' ? 'ts' : 'm3u8'));
            url = `${base}/live/${u}/${p}/${sid}.${ext}`;
          }
        }
        return url;
      }

      function updateIptvCounts() {
        const liveCount = state.iptvChannels.filter(c => (c.section || 'live') === 'live').length;
        const vodCount = state.iptvChannels.filter(c => c.section === 'vod').length;
        const seriesCount = state.iptvChannels.filter(c => c.section === 'series').length;
        el.countLiveBadge.textContent = liveCount;
        el.countVodBadge.textContent = vodCount;
        el.countSeriesBadge.textContent = seriesCount;
        el.countFavsBadge.textContent = state.iptvFavorites.length;
        el.countHistoryBadge.textContent = state.iptvHistory.length;
        el.headerIptvCountBadge.textContent = String(state.iptvChannels.length);
      }

      function getIptvSectionChannels() {
        if (state.iptvSeriesDrill && state.iptvActiveSection === 'series') {
          return state.iptvSeriesDrill.episodes;
        }
        if (state.iptvActiveSection === 'favs') {
          return state.iptvChannels.filter(c => state.iptvFavorites.includes(String(c.id)));
        }
        if (state.iptvActiveSection === 'history') {
          return state.iptvHistory.map(id => findIptvChannel(id)).filter(Boolean);
        }
        return state.iptvChannels.filter(c => (c.section || 'live') === state.iptvActiveSection);
      }

      function matchesIptvPortal(catName, chName, portalCode) {
        if (!portalCode || portalCode === 'ALL') return true;
        const cat = String(catName || 'Geral');
        const combined = `${cat} ${chName || ''}`.toLowerCase();
        if (portalCode === 'PINNED') {
          return Array.isArray(state.iptvPinnedCategories) && state.iptvPinnedCategories.includes(cat);
        }
        if (portalCode === 'PT') {
          return /(\bpt\b|portugal|portug|tuga|rtp|sic|tvi|cmt|porto canal|sport ?tv|eleven|bnt|benfica|sporting|lusit)/i.test(combined);
        }
        if (portalCode === 'SPORT') {
          return /(desporto|sport|futebol|soccer|dazn|eleven|eurosport|nba|f1|motor|ufc|combat|bola|premier|champions)/i.test(combined);
        }
        if (portalCode === 'CINE') {
          return /(cinema|filme|movie|series|séries|tvcine|hollywood|hbo|axn|fox|star|syfy|amc|disney|kids|infantil|doc)/i.test(combined);
        }
        if (portalCode === 'INTL') {
          return /(\buk\b|\bus\b|\busa\b|\bes\b|\bbr\b|\bfr\b|brasil|espanha|english|france|deutsch|italia|internacional|world|news|bbc|cnn|sky)/i.test(combined);
        }
        return true;
      }

      function togglePinIptvCategory(catName) {
        const target = catName || state.iptvSelectedCategory;
        if (!target || target === 'ALL') {
          showToast('Seleciona primeiro uma pasta na coluna da esquerda para a fixares 📌');
          return;
        }
        const list = Array.isArray(state.iptvPinnedCategories) ? [...state.iptvPinnedCategories] : [];
        const idx = list.indexOf(target);
        if (idx >= 0) {
          list.splice(idx, 1);
          showToast(`Pasta "${target}" desafixada`);
        } else {
          list.unshift(target);
          showToast(`Pasta "${target}" fixada no topo 📌`);
        }
        state.iptvPinnedCategories = list;
        storage.set('ms_iptv_pinned_cats', list);
        syncUserStateToDisk();
        populateIptvCategories();
        renderIptvChannelList();
      }

      function populateIptvCategories() {
        const secList = getIptvSectionChannels().filter(c => matchesIptvPortal(c.category, c.name, state.iptvActivePortal));
        const pinnedSet = new Set(state.iptvPinnedCategories || []);
        const rawCats = Array.from(new Set(secList.map(c => c.category || 'Geral')));
        rawCats.sort((a, b) => {
          const ap = pinnedSet.has(a) ? 0 : 1;
          const bp = pinnedSet.has(b) ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return a.localeCompare(b);
        });
        const prev = state.iptvSelectedCategory;
        el.iptvCategorySelect.innerHTML = `<option value="ALL">Todas as Pastas (${secList.length})</option>`;
        rawCats.forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = (pinnedSet.has(cat) ? '📌 ' : '') + cleanCategoryDisplayName(cat);
          el.iptvCategorySelect.appendChild(opt);
        });
        if (rawCats.includes(prev)) {
          el.iptvCategorySelect.value = prev;
        } else {
          state.iptvSelectedCategory = 'ALL';
          el.iptvCategorySelect.value = 'ALL';
        }
        const pinBtn = document.getElementById('pinCurrentIptvCategoryBtn');
        if (pinBtn) {
          const isPinned = pinnedSet.has(state.iptvSelectedCategory);
          pinBtn.className = 'hidden';
          pinBtn.setAttribute('data-pinned', isPinned ? '1' : '0');
        }
      }

      function getFilteredIptvChannels() {
        let list = (state.searchQuery.trim() !== '')
          ? state.iptvChannels
          : getIptvSectionChannels();

        if (state.iptvActivePortal && state.iptvActivePortal !== 'ALL') {
          list = list.filter(c => matchesIptvPortal(c.category, c.name, state.iptvActivePortal));
        }
        if (state.iptvSelectedCategory !== 'ALL') {
          list = list.filter(c => (c.category || 'Geral') === state.iptvSelectedCategory);
        }
        const combinedQuery = (state.searchQuery.trim() + ' ' + (state.iptvLocalFilter || '').trim()).trim().toLowerCase();
        if (combinedQuery) {
          list = list.filter(c =>
            (c.name && c.name.toLowerCase().includes(combinedQuery)) ||
            (c.category && c.category.toLowerCase().includes(combinedQuery)) ||
            (c.epgNow && c.epgNow.title && c.epgNow.title.toLowerCase().includes(combinedQuery))
          );
        }
        return list;
      }

      // Lazy-Fetch automático do EPG (get_short_epg) para os canais Xtream visíveis no ecrã
      let _epgBatchTimer = null;
      const _epgFetchedAt = {};
      function scheduleVisibleChannelsEpgFetch(groupsSlice) {
        if (!state.xtreamConfig || !state.xtreamConfig.server) return;
        clearTimeout(_epgBatchTimer);
        _epgBatchTimer = setTimeout(async () => {
          const now = Date.now();
          const candidates = [];
          for (const g of (groupsSlice || [])) {
            const ch = g.primary || g;
            if (!ch || !ch.xtreamStreamId || (ch.section || 'live') !== 'live') continue;
            if (ch.epgNow && (_epgFetchedAt[ch.id] && now - _epgFetchedAt[ch.id] < 600000)) continue;
            _epgFetchedAt[ch.id] = now;
            candidates.push(ch);
            if (candidates.length >= 6) break;
          }
          if (!candidates.length) return;
          await Promise.all(candidates.map(ch => fetchXtreamShortEpg(ch, true)));
          renderIptvRichExplorer();
        }, 450);
      }

      // Seletor de 4 Vistas IPTV Zero-Scroll: Workspace · Cartões · Guia EPG · Teatro
      function setIptvViewMode(mode, quiet) {
        const norm = mode === 'list' ? 'workspace' : mode;
        const valid = ['workspace', 'cards', 'epg', 'theater'].includes(norm) ? norm : 'workspace';
        state.iptvViewMode = valid;
        try {
          localStorage.setItem('ms_iptv_view_mode_v25', valid);
          localStorage.setItem('ms_iptv_view_mode', valid);
        } catch (e) {}

        el.iptvWorkspaceView.setAttribute('data-view', valid);

        document.querySelectorAll('.iptv-view-mode-btn').forEach(btn => {
          const m = btn.getAttribute('data-iptv-view');
          btn.className = 'iptv-view-mode-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold mac-transition ' +
            (m === valid ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:text-white');
        });

        const listBox = el.iptvChannelListContainer;
        const cardsBox = document.getElementById('iptvCardsGridContainer');
        const epgBox = document.getElementById('iptvEpgTimelineContainer');
        const thBtn = document.getElementById('iptvExpandTheaterBtn');

        if (listBox && cardsBox && epgBox) {
          listBox.classList.toggle('hidden', valid !== 'workspace');
          cardsBox.classList.toggle('hidden', valid !== 'cards');
          epgBox.classList.toggle('hidden', valid !== 'epg');
        }
        if (thBtn) {
          thBtn.textContent = valid === 'theater' ? '🖥 Voltar ao Workspace' : '🎬 Teatro';
        }
        renderIptvChannelList();

        if (!quiet) {
          const labels = {
            workspace: '🖥 Vista Workspace (Portais + Canais Deduplicados + Player)',
            cards: '🗂 Vista Cartões EPG + Mini-Player Flutuante',
            epg: '📅 Vista Guia de Programação EPG em Tempo Real',
            theater: '🎬 Modo Teatro (Janela Inteira sem Scroll)'
          };
          showToast(labels[valid]);
        }
      }

      function renderIptvPortalsSidebar() {
        const wsPortals = document.getElementById('iptvWorkspacePortalsList');
        if (!wsPortals) return;
        const secList = getIptvSectionChannels().filter(c => matchesIptvPortal(c.category, c.name, state.iptvActivePortal));
        const countsByCat = {};
        secList.forEach(c => {
          const k = c.category || 'Geral';
          countsByCat[k] = (countsByCat[k] || 0) + 1;
        });
        const pinnedSet = new Set(state.iptvPinnedCategories || []);
        const pFilter = (state.iptvPortalFilter || '').trim().toLowerCase();
        const cats = Object.keys(countsByCat)
          .filter(c => !pFilter || c.toLowerCase().includes(pFilter))
          .sort((a, b) => {
            const ap = pinnedSet.has(a) ? 0 : 1;
            const bp = pinnedSet.has(b) ? 0 : 1;
            return ap !== bp ? ap - bp : a.localeCompare(b);
          });

        wsPortals.innerHTML = '';
        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = 'w-full text-left px-3 py-2 flex items-center justify-between text-xs font-semibold ' +
          (state.iptvSelectedCategory === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-200 hover:bg-white/5');
        allBtn.innerHTML = `<span>🌐 Todas as Pastas</span><span class="text-[10px] font-mono opacity-85">${secList.length}</span>`;
        allBtn.addEventListener('click', () => {
          state.iptvSelectedCategory = 'ALL';
          el.iptvCategorySelect.value = 'ALL';
          renderIptvChannelList();
        });
        wsPortals.appendChild(allBtn);

        cats.forEach(cat => {
          const isSel = state.iptvSelectedCategory === cat;
          const isPin = pinnedSet.has(cat);
          const row = document.createElement('div');
          row.className = 'group px-2.5 py-2 flex items-center justify-between gap-1.5 cursor-pointer text-xs ' +
            (isSel ? 'bg-indigo-600/20 text-indigo-200 font-semibold border-l-2 border-indigo-500' : 'text-slate-300 hover:bg-white/5');
          row.innerHTML = `
            <span class="truncate flex-1">${isPin ? '📌 ' : ''}${esc(cleanCategoryDisplayName(cat))}</span>
            <span class="text-[10px] font-mono text-slate-500">${countsByCat[cat]}</span>
            <button type="button" data-pin-cat="${esc(cat)}" class="${isPin ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover:opacity-100 text-slate-500 hover:text-amber-300'} transition-opacity px-1 text-[10px]" title="Fixar pasta no topo">📌</button>
          `;
          row.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-pin-cat]')) {
              ev.stopPropagation();
              togglePinIptvCategory(cat);
              return;
            }
            state.iptvSelectedCategory = cat;
            el.iptvCategorySelect.value = cat;
            populateIptvCategories();
            renderIptvChannelList();
          });
          wsPortals.appendChild(row);
        });
      }

      function computeChannelEpgPct(ch) {
        const now = ch && ch.epgNow;
        if (now && now.start && now.end && now.end > now.start) {
          return Math.max(4, Math.min(100, Math.round(((Date.now() / 1000 - now.start) / (now.end - now.start)) * 100)));
        }
        return 0;
      }

      function renderIptvRichExplorer() {
        const filtered = getFilteredIptvChannels();
        const groups = groupIptvChannelVariants(filtered);
        const cardsBox = document.getElementById('iptvCardsGridContainer');
        const epgBox = document.getElementById('iptvEpgTimelineContainer');
        const countBadge = document.getElementById('iptvRichExplorerCountBadge');
        const headerCount = document.getElementById('iptvRichExplorerCount');
        const activeLabel = document.getElementById('iptvWorkspaceActivePortalLabel');

        if (activeLabel) {
          activeLabel.textContent = state.iptvSelectedCategory === 'ALL' ? 'Todos os Canais' : cleanCategoryDisplayName(state.iptvSelectedCategory);
        }
        const summaryTxt = state.iptvGroupVariants && groups.length !== filtered.length
          ? `${groups.length} canais (${filtered.length} sinais)`
          : `${filtered.length} canais`;
        if (countBadge) countBadge.textContent = summaryTxt;
        if (headerCount) headerCount.textContent = `• ${summaryTxt}`;

        if (state.iptvViewMode === 'cards' && cardsBox) {
          cardsBox.innerHTML = '';
          const slice = groups.slice(0, 120);
          if (!slice.length) {
            cardsBox.innerHTML = '<div class="col-span-full p-8 text-center text-xs text-slate-400">Nenhum canal encontrado para este filtro.</div>';
            return;
          }
          slice.forEach((grp) => {
            const ch = grp.primary;
            const isCur = grp.variants.some(v => String(v.ch.id) === String(state.iptvCurrentChannelId));
            const isFav = state.iptvFavorites.includes(String(ch.id));
            const epgTitle = (ch.epgNow && ch.epgNow.title) ? ch.epgNow.title : 'Emissão em direto';
            const epgTime = (ch.epgNow && ch.epgNow.time) ? ch.epgNow.time : 'DIRETO';
            const epgPct = computeChannelEpgPct(ch);

            const varPillsHtml = grp.variants.slice(0, 4).map(v => {
              const vAct = String(v.ch.id) === String(state.iptvCurrentChannelId);
              return `<button type="button" data-var-id="${esc(v.ch.id)}" class="ms-q-pill ${vAct ? 'active' : ''}">${esc(v.tag)}</button>`;
            }).join('');

            const card = document.createElement('div');
            card.className = 'ms-iptv-card ' + (isCur ? 'active' : '');
            card.innerHTML = `
              <div class="flex items-start justify-between gap-2.5">
                <div class="flex items-center gap-2.5 min-w-0">
                  ${renderChannelLogoHtml(ch)}
                  <div class="min-w-0">
                    <span class="inline-block text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800/90 text-indigo-300 border border-white/5 truncate max-w-[145px]">${esc(cleanCategoryDisplayName(ch.category || 'Direto'))}</span>
                    <h4 class="text-xs font-bold text-white truncate mt-0.5" title="${esc(grp.displayName)}">${esc(grp.displayName)}</h4>
                  </div>
                </div>
                <button type="button" data-fav-card="${esc(ch.id)}" class="text-sm ${isFav ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'}">${isFav ? '★' : '☆'}</button>
              </div>
              <div class="flex items-center gap-1 flex-wrap">${varPillsHtml}</div>
              <div class="p-2 rounded-xl bg-[#090d16] border border-white/5 space-y-1">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="font-mono text-emerald-400 font-semibold">● ${esc(epgTime)}</span>
                  <span class="text-slate-400 font-mono">${epgPct > 0 ? epgPct + '%' : 'LIVE'}</span>
                </div>
                <p class="text-[11px] font-medium text-slate-200 truncate">${esc(epgTitle)}</p>
                <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div class="h-full bg-gradient-to-r from-indigo-500 to-emerald-400" style="width:${epgPct || 25}%"></div>
                </div>
              </div>
              <div class="flex items-center justify-between gap-1.5">
                <button type="button" data-play1="${esc(ch.id)}" class="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold">▶ 1.º Ecrã</button>
                <button type="button" data-play2="${esc(ch.id)}" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white text-[10px] font-semibold border border-white/10" title="Abrir no 2.º Ecrã Multiview">2.º Ecrã</button>
              </div>
            `;
            card.addEventListener('click', (ev) => {
              const varBtn = ev.target.closest('[data-var-id]');
              if (varBtn) {
                ev.stopPropagation();
                playIptvChannelById(varBtn.getAttribute('data-var-id'));
                return;
              }
              if (ev.target.closest('[data-fav-card]')) {
                ev.stopPropagation();
                toggleIptvFavorite(ch.id);
                return;
              }
              if (ev.target.closest('[data-play2]')) {
                ev.stopPropagation();
                if (!state.multiViewActive) el.headerMultiViewBtn.click();
                playSecondaryIptvChannelById(ch.id);
                return;
              }
              playIptvChannelById(ch.id);
            });
            cardsBox.appendChild(card);
          });
        } else if (state.iptvViewMode === 'epg' && epgBox) {
          epgBox.innerHTML = '';
          const slice = groups.slice(0, 120);
          if (!slice.length) {
            epgBox.innerHTML = '<div class="p-8 text-center text-xs text-slate-400">Nenhum canal encontrado no Guia EPG.</div>';
            return;
          }
          slice.forEach((grp) => {
            const ch = grp.primary;
            const isCur = grp.variants.some(v => String(v.ch.id) === String(state.iptvCurrentChannelId));
            const epgNow = ch.epgNow || { time: 'AGORA', title: 'Emissão Direta', desc: ch.category || 'Sem sinopse EPG.' };
            const epgNext = ch.epgNext || { time: 'A SEGUIR', title: 'Programação Contínua' };
            const epgPct = computeChannelEpgPct(ch) || 35;

            const row = document.createElement('div');
            row.className = 'p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:bg-white/5 mac-transition ' +
              (isCur ? 'channel-active' : '');
            row.innerHTML = `
              <div class="flex items-center gap-3 w-full md:w-56 shrink-0">
                ${renderChannelLogoHtml(ch)}
                <div class="min-w-0">
                  <p class="text-xs font-bold text-white truncate">${esc(grp.displayName)}</p>
                  <span class="text-[10px] text-slate-400 truncate block">${esc(cleanCategoryDisplayName(ch.category || 'Direto'))}</span>
                </div>
              </div>
              <div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div class="p-2 rounded-xl bg-[#0c1220] border border-white/5">
                  <div class="flex items-center justify-between text-[10px] text-emerald-400 font-mono">
                    <span>● ${esc(epgNow.time || 'AGORA')}</span>
                    <span>${epgPct}%</span>
                  </div>
                  <p class="text-xs font-semibold text-white truncate mt-0.5">${esc(epgNow.title)}</p>
                  <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                    <div class="h-full bg-gradient-to-r from-indigo-500 to-emerald-400" style="width:${epgPct}%"></div>
                  </div>
                </div>
                <div class="p-2 rounded-xl bg-[#0c1220]/60 border border-white/5">
                  <span class="text-[10px] text-indigo-300 font-mono block">⏭ ${esc(epgNext.time || 'A SEGUIR')}</span>
                  <p class="text-xs font-medium text-slate-300 truncate mt-0.5">${esc(epgNext.title)}</p>
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button type="button" data-epg-play="${esc(ch.id)}" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold">▶ Ver</button>
                <button type="button" data-epg-2nd="${esc(ch.id)}" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-blue-600 text-slate-200 text-[10px] font-mono">2.º Ecrã</button>
              </div>
            `;
            row.addEventListener('click', (ev) => {
              if (ev.target.closest('[data-epg-2nd]')) {
                ev.stopPropagation();
                if (!state.multiViewActive) el.headerMultiViewBtn.click();
                playSecondaryIptvChannelById(ch.id);
                return;
              }
              playIptvChannelById(ch.id);
            });
            epgBox.appendChild(row);
          });
        }
      }

      function renderIptvQuickFavsBar() {
        el.iptvQuickFavsList.innerHTML = '';
        const favChannels = state.iptvFavorites
          .map(id => findIptvChannel(id))
          .filter(Boolean);

        const wrap = document.getElementById('iptvQuickFavsRowWrap');
        if (favChannels.length === 0) {
          if (wrap) { wrap.classList.add('hidden'); wrap.classList.remove('flex'); }
          return;
        }
        if (wrap) { wrap.classList.remove('hidden'); wrap.classList.add('flex'); }

        favChannels.forEach(ch => {
          const isCur = String(ch.id) === String(state.iptvCurrentChannelId);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'px-2.5 py-0.5 rounded-lg text-[11px] font-medium mac-transition flex items-center gap-1.5 shrink-0 ' +
            (isCur
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border mac-border');
          const starSpan = document.createElement('span'); starSpan.className = 'text-amber-400'; starSpan.textContent = '★';
          const nameSpan = document.createElement('span'); nameSpan.textContent = stripQualitySuffixFromName(ch.name);
          btn.appendChild(starSpan); btn.appendChild(nameSpan);
          btn.addEventListener('click', () => playIptvChannelById(ch.id));
          el.iptvQuickFavsList.appendChild(btn);
        });
      }

      function renderSiblingVariantsBar() {
        el.siblingVariantsList.innerHTML = '';
        const cur = getCurrentIptvChannel();
        if (!cur) return;
        const siblings = findSiblingVariants(cur);
        siblings.slice(0, 10).forEach(v => {
          const isCur = String(v.id) === String(cur.id);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold mac-transition shrink-0 ' +
            (isCur
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border mac-border');
          btn.textContent = `${extractVariantQualityTag(v.name)} • ${v.name}`;
          btn.addEventListener('click', () => playIptvChannelById(v.id));
          el.siblingVariantsList.appendChild(btn);
        });
      }

      function renderIptvChannelList() {
        updateIptvCounts();
        renderIptvQuickFavsBar();
        renderSiblingVariantsBar();
        renderIptvPortalsSidebar();
        renderIptvRichExplorer();

        const filtered = getFilteredIptvChannels();
        const groups = groupIptvChannelVariants(filtered);
        el.iptvChannelListContainer.innerHTML = '';

        if (state.iptvSeriesDrill && state.iptvActiveSection === 'series') {
          const back = document.createElement('div');
          back.className = 'px-3 py-2.5 cursor-pointer bg-indigo-600/15 hover:bg-indigo-600/25 text-xs font-semibold text-indigo-300 mac-transition';
          back.textContent = '← Voltar às séries • ' + state.iptvSeriesDrill.title;
          back.addEventListener('click', () => {
            state.iptvSeriesDrill = null;
            state.iptvSelectedCategory = 'ALL';
            populateIptvCategories();
            renderIptvChannelList();
          });
          el.iptvChannelListContainer.appendChild(back);
        }

        if (groups.length === 0) {
          el.iptvChannelListContainer.innerHTML = '<div class="p-6 text-center text-xs text-slate-400">Nenhum canal encontrado.</div>';
          el.iptvLoadMoreWrapper.classList.add('hidden');
          return;
        }

        const slice = groups.slice(0, state.iptvRenderLimit);
        scheduleVisibleChannelsEpgFetch(slice.slice(0, 12));

        slice.forEach((grp, idx) => {
          const ch = grp.primary;
          const isCurrent = grp.variants.some(v => String(v.ch.id) === String(state.iptvCurrentChannelId));
          const isFav = state.iptvFavorites.includes(String(ch.id));
          const epgPct = computeChannelEpgPct(ch);
          const epgSubText = (ch.epgNow && ch.epgNow.title && ch.epgNow.title !== ch.name)
            ? `● ${ch.epgNow.title}`
            : cleanCategoryDisplayName(ch.category || 'Emissão Direta');

          const activeVar = grp.variants.find(v => String(v.ch.id) === String(state.iptvCurrentChannelId)) || grp.variants[0];
          const varPillsHtml = activeVar
            ? `<button type="button" data-var-id="${esc(activeVar.ch.id)}" class="ms-q-pill ${isCurrent ? 'active' : ''}" title="${esc(activeVar.ch.name)}">${esc(activeVar.tag)}</button>`
            : '';

          const row = document.createElement('div');
          row.className = 'group px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-white/5 mac-transition ' + (isCurrent ? 'channel-active' : '');
          row.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              ${renderChannelLogoHtml(ch)}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <p class="text-xs font-semibold truncate ${isCurrent ? 'text-indigo-300' : 'text-slate-100'}">${esc(grp.displayName)}</p>
                  <div class="shrink-0">${varPillsHtml}</div>
                </div>
                <div class="flex items-center gap-2 mt-0.5">
                  <p class="text-[11px] ${ch.epgNow ? 'text-slate-400' : 'text-slate-500'} truncate flex-1">${esc(epgSubText)}</p>
                  ${epgPct > 0 ? `<div class="w-10 h-1 bg-slate-800 rounded-full overflow-hidden shrink-0"><div class="h-full bg-indigo-400" style="width:${epgPct}%"></div></div>` : ''}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" data-row-2nd="${esc(ch.id)}" class="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded bg-white/10 hover:bg-indigo-600 text-[10px] font-mono text-slate-300 hover:text-white" title="Abrir no 2.º Ecrã (Multiview)">2.º</button>
              <button type="button" data-row-fav="${esc(ch.id)}" class="${isFav ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-200'} transition-opacity p-1 rounded-lg text-xs">${isFav ? '★' : '☆'}</button>
            </div>
          `;
          row.addEventListener('click', (ev) => {
            const varBtn = ev.target.closest('[data-var-id]');
            if (varBtn) {
              ev.stopPropagation();
              playIptvChannelById(varBtn.getAttribute('data-var-id'));
              return;
            }
            if (ev.target.closest('[data-row-2nd]')) {
              ev.stopPropagation();
              if (!state.multiViewActive) el.headerMultiViewBtn.click();
              playSecondaryIptvChannelById(ch.id);
              return;
            }
            if (ev.target.closest('[data-row-fav]')) {
              ev.stopPropagation();
              toggleIptvFavorite(ch.id);
              return;
            }
            playIptvChannelById(ch.id);
          });
          el.iptvChannelListContainer.appendChild(row);
        });

        if (groups.length > state.iptvRenderLimit) {
          el.iptvLoadMoreWrapper.classList.remove('hidden');
          el.iptvLoadMoreBtn.textContent = `Mostrar mais canais (${groups.length - state.iptvRenderLimit} restantes)...`;
        } else {
          el.iptvLoadMoreWrapper.classList.add('hidden');
        }

        el.secondaryChannelSelect.innerHTML = '<option value="">Escolher 2.º Canal...</option>';
        filtered.slice(0, 250).forEach(ch => {
          const opt = document.createElement('option');
          opt.value = ch.id;
          opt.textContent = ch.name;
          if (String(ch.id) === String(state.iptvSecondaryChannelId)) opt.selected = true;
          el.secondaryChannelSelect.appendChild(opt);
        });
      }

      function toggleIptvFavorite(channelId) {
        const idStr = String(channelId);
        const idx = state.iptvFavorites.indexOf(idStr);
        if (idx >= 0) {
          state.iptvFavorites.splice(idx, 1);
          showToast('Canal removido dos Favoritos');
        } else {
          state.iptvFavorites.unshift(idStr);
          showToast('Canal adicionado aos Favoritos ★');
        }
        storage.set('macstream_favs', state.iptvFavorites);
        syncUserStateToDisk();
        updateCurrentIptvChannelInfoUI();
        renderIptvChannelList();
      }

      function pushIptvHistory(channelId) {
        const idStr = String(channelId);
        state.iptvHistory = [idStr, ...state.iptvHistory.filter(x => x !== idStr)].slice(0, 40);
        storage.set('macstream_history', state.iptvHistory);
      }

      function destroyPrimaryIptvEngines() {
        if (primaryIptvHls) { try { primaryIptvHls.destroy(); } catch (e) {} primaryIptvHls = null; }
        if (primaryIptvMpegts) { try { primaryIptvMpegts.destroy(); } catch (e) {} primaryIptvMpegts = null; }
      }

      function destroySecondaryIptvEngines() {
        if (secondaryIptvHls) { try { secondaryIptvHls.destroy(); } catch (e) {} secondaryIptvHls = null; }
        if (secondaryIptvMpegts) { try { secondaryIptvMpegts.destroy(); } catch (e) {} secondaryIptvMpegts = null; }
      }

      function resetIptvScreenMonitor(key) {
        iptvMon[key].lastTime = -1;
        iptvMon[key].stallSeconds = 0;
        iptvMon[key].healingLockUntil = Date.now() + 3500;
      }

      function playIptvChannelById(channelId) {
        const ch = findIptvChannel(channelId);
        if (!ch) return;

        // Séries Xtream: abrir lista de episódios em vez de tentar reproduzir a série
        if (ch.section === 'series' && ch.xtreamStreamId && !ch.url) {
          openXtreamSeries(ch);
          return;
        }

        state.iptvCurrentChannelId = ch.id;
        iptvMon.screen1.consecutiveHeals = 0;
        resetIptvScreenMonitor('screen1');
        pushIptvHistory(ch.id);
        updateCurrentIptvChannelInfoUI();
        renderIptvChannelList();

        if (ch.xtreamStreamId && state.xtreamConfig.server && (ch.section || 'live') === 'live') {
          fetchXtreamShortEpg(ch);
        }
        loadIptvStreamOnVideo(el.iptvPrimaryVideo, ch, true);
      }

      function playSecondaryIptvChannelById(channelId) {
        const ch = findIptvChannel(channelId);
        if (!ch || (ch.section === 'series' && ch.xtreamStreamId && !ch.url)) return;
        state.iptvSecondaryChannelId = ch.id;
        iptvMon.screen2.consecutiveHeals = 0;
        resetIptvScreenMonitor('screen2');
        el.secondaryChannelSelect.value = ch.id;
        el.secondaryChannelTitle.textContent = ch.name;
        loadIptvStreamOnVideo(el.iptvSecondaryVideo, ch, false);
      }

      function showIptvPlaybackProblem(isPrimary) {
        const ch = isPrimary ? getCurrentIptvChannel() : getSecondaryIptvChannel();
        const videoElem = isPrimary ? el.iptvPrimaryVideo : el.iptvSecondaryVideo;
        clearTimeout(videoElem && videoElem._startupTimer);
        const app = window.macstreamApp;

        // Escalada Automática Rápida (Respeitando max_connections=1 do Xtream):
        // Stage 0 -> Stage 1 (Remux FFmpeg .ts -> MP4) -> Stage 2 (Proxy VLC + MPEG-TS) -> Stage 3 (Proxy VLC + HLS.js) -> Stage 4 (Variante Irmã mais leve)
        if (ch && (ch.section || 'live') === 'live') {
          const stageKey = isPrimary ? '_autoStage1' : '_autoStage2';
          const curStage = ch[stageKey] || 0;
          if (app && app.engineUrl) {
            if (curStage === 0) {
              ch[stageKey] = 1;
              showScreenHealStatus(isPrimary, '🔥 A ligar via Remux FFmpeg H.264/AAC...', 2600);
              loadIptvStreamOnVideo(videoElem, ch, isPrimary, 'remux');
              return;
            }
            if (curStage === 1) {
              ch[stageKey] = 2;
              showScreenHealStatus(isPrimary, '🛡️ A ligar via Proxy Local VLC (MPEG-TS)...', 2600);
              loadIptvStreamOnVideo(videoElem, ch, isPrimary, 'proxy-ts');
              return;
            }
            if (curStage === 2) {
              ch[stageKey] = 3;
              showScreenHealStatus(isPrimary, '⚡ A ligar via Proxy Local VLC (HLS)...', 2600);
              loadIptvStreamOnVideo(videoElem, ch, isPrimary, 'proxy-hls');
              return;
            }
          }
          if (curStage <= 3) {
            ch[stageKey] = 4;
            const alt = findLighterOrAlternativeVariant(ch);
            if (alt && String(alt.id) !== String(ch.id)) {
              showScreenHealStatus(isPrimary, `🔀 A mudar para sinal alternativo (${stripQualitySuffixFromName(alt.name)} ${extractVariantQualityTag(alt.name)})...`, 3000);
              if (isPrimary) playIptvChannelById(alt.id);
              else playSecondaryIptvChannelById(alt.id);
              return;
            }
          }
        }
        if (isPrimary) el.safariBlockBanner.classList.remove('hidden');
        else showScreenHealStatus(false, '⚠ Falha no sinal do 2.º Ecrã', 3500);
      }

      function loadIptvStreamOnVideo(videoElem, ch, isPrimary, modeOverride) {
        if (!ch || !videoElem) return;
        clearTimeout(videoElem._startupTimer);
        if (!modeOverride) {
          ch[isPrimary ? '_autoStage1' : '_autoStage2'] = 0;
        }
        if (isPrimary) {
          destroyPrimaryIptvEngines();
          el.safariBlockBanner.classList.add('hidden');
          resetIptvScreenMonitor('screen1');
        } else {
          destroySecondaryIptvEngines();
          resetIptvScreenMonitor('screen2');
        }

        videoElem.onerror = null;
        videoElem.pause();
        videoElem.removeAttribute('src');
        videoElem.load();

        const app = window.macstreamApp;
        const screenNum = isPrimary ? 1 : 2;
        const wanted = modeOverride || state.iptvEngineMode || 'auto';
        const isLive = (ch.section || 'live') === 'live';
        const isXtreamLive = Boolean(ch.xtreamStreamId && state.xtreamConfig && state.xtreamConfig.server && isLive);

        // Determina o motor ideal:
        // Na app Desktop Electron, canais Xtream em direto usam o Proxy VLC / Remux FFmpeg local para evitar bloqueios CORS, User-Agent e codecs AC3/MP2!
        let effectiveMode = wanted;
        if (wanted === 'auto') {
          if (app && app.engineUrl && isLive) {
            // Para servidores Xtream em direto, começa com Remux FFmpeg (.ts -> MP4 H.264/AAC) ou Proxy HLS
            effectiveMode = isXtreamLive ? 'remux' : 'proxy-hls';
            ch[isPrimary ? '_autoStage1' : '_autoStage2'] = isXtreamLive ? 1 : 0;
          } else {
            effectiveMode = 'hlsjs';
          }
        } else if (wanted === 'proxy') {
          effectiveMode = isXtreamLive ? 'proxy-ts' : 'proxy-hls';
        }

        const wantTsExt = (effectiveMode === 'ts' || effectiveMode === 'remux' || effectiveMode === 'proxy-ts');
        const rawUrl = buildIptvStreamUrl(ch, wantTsExt ? 'ts' : 'm3u8');
        if (!rawUrl) {
          showToast('Este canal não tem URL de reprodução.');
          return;
        }

        let streamUrl = rawUrl;
        let engine = 'native';

        if (effectiveMode === 'remux' && app && app.engineUrl) {
          streamUrl = `${app.engineUrl}/iptv-remux?url=${encodeURIComponent(rawUrl)}&screen=${screenNum}&_t=${Date.now()}`;
          engine = 'remux';
        } else if ((effectiveMode === 'proxy-ts' || effectiveMode === 'proxy-hls') && app && app.engineUrl) {
          streamUrl = `${app.engineUrl}/iptv-proxy?url=${encodeURIComponent(rawUrl)}&screen=${screenNum}&_t=${Date.now()}`;
          if (effectiveMode === 'proxy-ts' || /\.ts(\?|$)/i.test(rawUrl)) {
            engine = (window.mpegts && window.mpegts.isSupported()) ? 'ts' : 'native';
          } else {
            engine = (window.Hls && window.Hls.isSupported()) ? 'hls' : 'native';
          }
        } else {
          // Fecha qualquer stream antigo no motor local se mudou para modo direto
          if (app && app.engineUrl) {
            fetch(`${app.engineUrl}/iptv-close?screen=${screenNum}`).catch(() => {});
          }
          const isHls = /\.m3u8(\?|$)/i.test(streamUrl);
          const isTs = /\.ts(\?|$)/i.test(streamUrl);
          const nativeHls = Boolean(videoElem.canPlayType('application/vnd.apple.mpegurl'));
          if (!isHls && !isTs) engine = 'native';
          else if (isTs) engine = 'ts';
          else if (effectiveMode === 'hlsjs' || !nativeHls) engine = 'hls';
          else engine = 'native';
        }

        const labels = {
          native: ['Nativo HTML5', 'Nativo'],
          hls: [streamUrl.includes('/iptv-proxy') ? 'Proxy VLC + HLS' : 'HLS.js Buffer', streamUrl.includes('/iptv-proxy') ? 'Proxy HLS' : 'HLS.js'],
          ts: [streamUrl.includes('/iptv-proxy') ? 'Proxy VLC + MPEG-TS' : 'MPEG-TS (.ts)', streamUrl.includes('/iptv-proxy') ? 'Proxy TS' : 'MPEG-TS'],
          remux: ['FFmpeg Live Remux (H.264/AAC)', 'Auto Remux']
        };
        if (isPrimary && labels[engine]) {
          el.engineBadge.textContent = labels[engine][0];
          el.osdEngineTag.textContent = labels[engine][1];
        }

        // Watchdog de Arranque Rápido (5.2s): se o vídeo continuar a 0:00 (readyState < 2), escala automaticamente para o motor seguinte!
        if (isLive) {
          videoElem._startupTimer = setTimeout(() => {
            if (state.appMode !== 'iptv') return;
            const curCh = isPrimary ? getCurrentIptvChannel() : getSecondaryIptvChannel();
            if (!curCh || String(curCh.id) !== String(ch.id)) return;
            if (videoElem.readyState < 2 && (videoElem.currentTime || 0) < 0.1) {
              showIptvPlaybackProblem(isPrimary);
            }
          }, 5200);
          videoElem.addEventListener('playing', () => clearTimeout(videoElem._startupTimer), { once: true });
        }

        if (engine === 'ts') {
          if (!(window.mpegts && window.mpegts.isSupported())) { showIptvPlaybackProblem(isPrimary); return; }
          try {
            const player = window.mpegts.createPlayer(
              { type: 'mse', isLive, url: streamUrl },
              { enableWorker: false, enableStashBuffer: false, stashInitialSize: 128 * 1024 }
            );
            player.attachMediaElement(videoElem);
            player.load();
            const p = player.play();
            if (p && p.catch) p.catch(() => { videoElem.muted = true; videoElem.play().catch(() => {}); });
            player.on(window.mpegts.Events.ERROR, () => { showIptvPlaybackProblem(isPrimary); });
            if (isPrimary) primaryIptvMpegts = player; else secondaryIptvMpegts = player;
          } catch (e) {
            showIptvPlaybackProblem(isPrimary);
          }
          return;
        }

        if (engine === 'hls' && window.Hls && window.Hls.isSupported()) {
          const hls = new window.Hls({ enableWorker: false, maxBufferLength: 20, manifestLoadingTimeOut: 7000 });
          if (isPrimary) primaryIptvHls = hls; else secondaryIptvHls = hls;
          let recoveries = 0;
          hls.on(window.Hls.Events.ERROR, (ev, data) => {
            if (!data || !data.fatal) return;
            if (recoveries++ >= 1) { showIptvPlaybackProblem(isPrimary); return; }
            if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else showIptvPlaybackProblem(isPrimary);
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(videoElem);
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            const p = videoElem.play();
            if (p && p.catch) p.catch(() => { videoElem.muted = true; videoElem.play().catch(() => {}); });
          });
          return;
        }

        // Reprodução direta / Remux MP4 contínuo
        videoElem.onerror = () => { showIptvPlaybackProblem(isPrimary); };
        videoElem.src = streamUrl;
        const p = videoElem.play();
        if (p && p.catch) {
          p.catch(() => {
            videoElem.muted = true;
            videoElem.play().catch(() => {});
          });
        }
      }

      function formatClock(ts) {
        if (!ts) return '';
        const d = new Date(ts * 1000);
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      }

      function updateEpgProgress() {
        const bar = el.epgProgressBar;
        if (!bar) return;
        const ch = getCurrentIptvChannel();
        const now = ch && ch.epgNow;
        const wrap = bar.parentElement;
        if (now && now.start && now.end && now.end > now.start) {
          const pct = Math.max(0, Math.min(100, ((Date.now() / 1000 - now.start) / (now.end - now.start)) * 100));
          bar.style.width = pct.toFixed(1) + '%';
          wrap.classList.remove('hidden');
        } else {
          wrap.classList.add('hidden');
        }
      }

      function updateCurrentIptvChannelInfoUI() {
        const ch = getCurrentIptvChannel();
        if (!ch) return;
        el.osdChannelName.textContent = ch.name;
        el.iptvInfoChannelTitle.textContent = ch.name;
        el.iptvInfoCategoryBadge.textContent = cleanCategoryDisplayName(ch.category || 'Direto');
        el.iptvInfoStreamIdBadge.textContent = 'ID #' + ch.id;

        const isFav = state.iptvFavorites.includes(String(ch.id));
        el.iptvFavCurrentStar.textContent = isFav ? '★' : '☆';
        el.iptvFavCurrentLabel.textContent = isFav ? 'Nos Favoritos' : 'Favorito';

        const now = ch.epgNow || { time: 'AGORA', title: ch.name, desc: 'Transmissão em direto.' };
        const next = ch.epgNext || { time: 'A SEGUIR', title: 'Sem informação', desc: 'O guia de programação aparece quando o servidor o fornece.' };

        el.epgNowTime.textContent = now.time || 'AGORA';
        el.epgNowTitle.textContent = now.title || ch.name;
        el.epgNowDesc.textContent = now.desc || '';
        el.epgNextTime.textContent = next.time || 'A SEGUIR';
        el.epgNextTitle.textContent = next.title || 'Próximo Programa';
        el.epgNextDesc.textContent = next.desc || '';
        updateEpgProgress();
        renderSiblingVariantsBar();
      }

      function getBufferAhead(videoElem) {
        if (!videoElem || !videoElem.buffered || videoElem.buffered.length === 0) return 0;
        try {
          return Math.max(0, videoElem.buffered.end(videoElem.buffered.length - 1) - videoElem.currentTime);
        } catch (e) {
          return 0;
        }
      }

      function showScreenHealStatus(isPrimary, text, autoHideMs) {
        const badge = isPrimary ? el.screen1HealBadge : el.screen2HealBadge;
        const label = isPrimary ? el.screen1HealText : el.screen2HealText;
        const dot = isPrimary ? el.screen1HealthDot : el.screen2HealthDot;

        label.textContent = text;
        badge.classList.remove('hidden');
        dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping shrink-0';

        clearTimeout(badge._hideTimer);
        badge._hideTimer = setTimeout(() => {
          badge.classList.add('hidden');
          dot.className = 'w-2 h-2 rounded-full bg-emerald-400 shrink-0';
        }, autoHideMs || 3000);
      }

      function watchIptvScreen(key, videoElem, isPrimary) {
        const m = iptvMon[key];
        if (Date.now() < m.healingLockUntil) return;

        const ch = isPrimary ? getCurrentIptvChannel() : getSecondaryIptvChannel();
        // Só faz auto-cura em emissões em direto (recarregar um filme VOD faria perder a posição)
        if (!ch || (ch.section || 'live') !== 'live' || videoElem.paused || videoElem.ended) {
          m.stallSeconds = 0;
          m.lastTime = videoElem.currentTime || 0;
          return;
        }

        const cur = videoElem.currentTime || 0;
        const buf = getBufferAhead(videoElem);
        const frozen = cur > 1 && Math.abs(cur - m.lastTime) < 0.005 && buf < 0.3;
        const neverStarted = cur <= 1 && videoElem.readyState < 2;
        m.lastTime = cur;

        if (!(frozen || neverStarted)) {
          m.stallSeconds = 0;
          return;
        }

        m.stallSeconds++;
        if (m.stallSeconds < 14) return;

        m.stallSeconds = 0;
        m.healingLockUntil = Date.now() + 35000;
        m.consecutiveHeals++;
        state.retryCount++;
        el.metricRetries.textContent = String(state.retryCount);

        if (m.consecutiveHeals > 6) {
          showScreenHealStatus(isPrimary, '⚠ Sem sinal estável — tenta outro canal', 4000);
          return;
        }

        if (m.consecutiveHeals >= 2 && state.autoFailoverVariant) {
          const lighter = findLighterOrAlternativeVariant(ch);
          if (lighter) {
            m.consecutiveHeals = 0;
            showScreenHealStatus(isPrimary, `🔀 Auto-Failover para ${lighter.name}...`, 3500);
            if (isPrimary) playIptvChannelById(lighter.id);
            else playSecondaryIptvChannelById(lighter.id);
            return;
          }
        }
        showScreenHealStatus(isPrimary, '↻ Auto-Cura: A reconectar emissão...', 3000);
        loadIptvStreamOnVideo(videoElem, ch, isPrimary);
      }

      function startIptvWatchdogLoop() {
        clearInterval(iptvWatchdogInterval);
        iptvWatchdogInterval = setInterval(() => {
          if (state.appMode !== 'iptv') return;

          const buf1 = getBufferAhead(el.iptvPrimaryVideo);
          if (state.multiViewActive) {
            const buf2 = getBufferAhead(el.iptvSecondaryVideo);
            el.metricBuffer.textContent = `${buf1.toFixed(1)}s / ${buf2.toFixed(1)}s`;
          } else {
            el.metricBuffer.textContent = `${buf1.toFixed(1)}s`;
          }

          if (el.iptvPrimaryVideo.videoHeight > 0) {
            const h1 = el.iptvPrimaryVideo.videoHeight + 'p';
            const h2 = (state.multiViewActive && el.iptvSecondaryVideo.videoHeight > 0)
              ? ` • ${el.iptvSecondaryVideo.videoHeight}p`
              : '';
            el.metricResolution.textContent = h1 + h2;
          }

          updateEpgProgress();

          if (state.autoReconnect) {
            watchIptvScreen('screen1', el.iptvPrimaryVideo, true);
            if (state.multiViewActive) watchIptvScreen('screen2', el.iptvSecondaryVideo, false);
          }
        }, 1000);
      }

      function buildXtreamApiUrl(action, extra = '') {
        let base = state.xtreamConfig.server.trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
        const u = encodeURIComponent(state.xtreamConfig.username.trim());
        const p = encodeURIComponent(state.xtreamConfig.password.trim());
        const act = action ? '&action=' + encodeURIComponent(String(action)) : '';
        return `${base}/player_api.php?username=${u}&password=${p}${act}${extra}`;
      }

      async function fetchXtreamShortEpg(ch) {
        try {
          const res = await fetch(buildXtreamApiUrl('get_short_epg', `&stream_id=${encodeURIComponent(String(ch.xtreamStreamId || ''))}&limit=2`));
          if (!res.ok) return;
          const data = await res.json();
          if (data && Array.isArray(data.epg_listings) && data.epg_listings.length > 0) {
            const decodeB64 = (str) => {
              if (!str) return '';
              try { return decodeURIComponent(escape(atob(str))); } catch (e) { return str; }
            };
            const first = data.epg_listings[0];
            const start = Number(first.start_timestamp) || 0;
            const end = Number(first.stop_timestamp) || 0;
            ch.epgNow = {
              time: start && end ? `${formatClock(start)} – ${formatClock(end)}` : 'AGORA',
              start, end,
              title: decodeB64(first.title) || ch.name,
              desc: decodeB64(first.description) || 'Emissão em direto.'
            };
            if (data.epg_listings[1]) {
              const second = data.epg_listings[1];
              const s2 = Number(second.start_timestamp) || 0;
              ch.epgNext = {
                time: s2 ? `Às ${formatClock(s2)}` : 'A SEGUIR',
                title: decodeB64(second.title) || 'Seguinte',
                desc: decodeB64(second.description) || ''
              };
            }
            if (String(ch.id) === String(state.iptvCurrentChannelId)) updateCurrentIptvChannelInfoUI();
          }
        } catch (e) {}
      }

      async function openXtreamSeries(ch) {
        if (!state.xtreamConfig.server) { showToast('Configura primeiro o Servidor Xtream.'); return; }
        showToast('A carregar episódios de "' + ch.name + '"...');
        try {
          const res = await fetch(buildXtreamApiUrl('get_series_info', `&series_id=${encodeURIComponent(String(ch.xtreamStreamId || ''))}`));
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          let base = state.xtreamConfig.server.trim().replace(/\/+$/, '');
          if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
          const u = encodeURIComponent(state.xtreamConfig.username.trim());
          const p = encodeURIComponent(state.xtreamConfig.password.trim());
          const episodes = [];
          const seasons = data && data.episodes ? data.episodes : {};
          Object.keys(seasons).sort((a, b) => Number(a) - Number(b)).forEach(sn => {
            (seasons[sn] || []).forEach(ep => {
              const ext = String(ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
              const id = 'sep-' + ep.id;
              const obj = {
                id,
                name: `S${pad2(sn)}E${pad2(ep.episode_num || 0)} • ${ep.title || ch.name}`,
                category: `Temporada ${sn}`,
                section: 'seriesep',
                format: ext,
                url: `${base}/series/${u}/${p}/${encodeURIComponent(String(ep.id || ''))}.${ext}`
              };
              episodes.push(obj);
              state.iptvExtra[id] = obj;
            });
          });
          if (episodes.length === 0) { showToast('Esta série não devolveu episódios.'); return; }
          state.iptvSeriesDrill = { title: ch.name, episodes };
          state.iptvSelectedCategory = 'ALL';
          state.iptvRenderLimit = 300;
          populateIptvCategories();
          renderIptvChannelList();
          showToast(`${episodes.length} episódios — escolhe um para reproduzir`);
        } catch (e) {
          showToast('Não foi possível obter os episódios (CORS/servidor).');
        }
      }

      function showXtreamModalFeedback(msg, type) {
        el.xtreamFeedbackBox.classList.remove('hidden', 'bg-rose-500/15', 'text-rose-300', 'border-rose-500/30', 'bg-emerald-500/15', 'text-emerald-300', 'border-emerald-500/30', 'bg-indigo-500/15', 'text-indigo-300', 'border-indigo-500/30');
        el.xtreamFeedbackBox.classList.add('border');
        if (type === 'error') el.xtreamFeedbackBox.classList.add('bg-rose-500/15', 'text-rose-300', 'border-rose-500/30');
        else if (type === 'success') el.xtreamFeedbackBox.classList.add('bg-emerald-500/15', 'text-emerald-300', 'border-emerald-500/30');
        else el.xtreamFeedbackBox.classList.add('bg-indigo-500/15', 'text-indigo-300', 'border-indigo-500/30');
        el.xtreamFeedbackBox.textContent = msg;
      }

      async function syncXtreamServer(ev) {
        if (ev) ev.preventDefault();
        const profileName = el.xtreamProfileName.value.trim() || 'Servidor Principal Mac';
        const server = el.xtreamServerInput.value.trim().replace(/\/+$/, '');
        const username = el.xtreamUserInput.value.trim();
        const password = el.xtreamPassInput.value.trim();

        if (!server || !username || !password) {
          showXtreamModalFeedback('Preenche o servidor, utilizador e password.', 'error');
          return;
        }

        state.xtreamConfig = { profileName, server, username, password };
        storage.set('macstream_xtream', state.xtreamConfig);
        showXtreamModalFeedback('A sincronizar canais em direto, filmes e séries do servidor...', 'info');

        try {
          const authRes = await fetch(buildXtreamApiUrl(''));
          if (!authRes.ok) throw new Error('HTTP ' + authRes.status);
          const authData = await authRes.json();
          if (!authData || !authData.user_info || Number(authData.user_info.auth) === 0) {
            showXtreamModalFeedback('Utilizador ou password incorretos.', 'error');
            return;
          }

          const maxCons = authData.user_info.max_connections || '1';
          const activeCons = authData.user_info.active_cons || '0';
          state.xtreamConfig.maxConnections = maxCons;
          storage.set('macstream_xtream', state.xtreamConfig);

          const [liveCatsRes, liveStreamsRes, vodCatsRes, vodStreamsRes, seriesCatsRes, seriesRes] = await Promise.all([
            fetch(buildXtreamApiUrl('get_live_categories')).catch(() => null),
            fetch(buildXtreamApiUrl('get_live_streams')).catch(() => null),
            fetch(buildXtreamApiUrl('get_vod_categories')).catch(() => null),
            fetch(buildXtreamApiUrl('get_vod_streams')).catch(() => null),
            fetch(buildXtreamApiUrl('get_series_categories')).catch(() => null),
            fetch(buildXtreamApiUrl('get_series')).catch(() => null)
          ]);

          const liveCats = (liveCatsRes && liveCatsRes.ok) ? await liveCatsRes.json() : [];
          const liveStreams = (liveStreamsRes && liveStreamsRes.ok) ? await liveStreamsRes.json() : [];
          const vodCats = (vodCatsRes && vodCatsRes.ok) ? await vodCatsRes.json() : [];
          const vodStreams = (vodStreamsRes && vodStreamsRes.ok) ? await vodStreamsRes.json() : [];
          const seriesCats = (seriesCatsRes && seriesCatsRes.ok) ? await seriesCatsRes.json() : [];
          const seriesList = (seriesRes && seriesRes.ok) ? await seriesRes.json() : [];

          const catMap = {};
          [].concat(liveCats || [], vodCats || [], seriesCats || []).forEach(c => {
            if (c && c.category_id) catMap[String(c.category_id)] = c.category_name;
          });

          let cleanBase = /^https?:\/\//i.test(server) ? server : 'http://' + server;
          cleanBase = cleanBase.replace(/\/+$/, '');
          const u = encodeURIComponent(username);
          const p = encodeURIComponent(password);

          const allMapped = [];
          if (Array.isArray(liveStreams)) {
            liveStreams.forEach(st => {
              allMapped.push({
                id: 'xt-' + st.stream_id,
                xtreamStreamId: st.stream_id,
                name: st.name || ('Canal ' + st.stream_id),
                category: catMap[String(st.category_id)] || 'TV em Direto',
                logo: st.stream_icon || '',
                section: 'live',
                format: 'm3u8',
                url: `${cleanBase}/live/${u}/${p}/${st.stream_id}.m3u8`
              });
            });
          }

          if (Array.isArray(vodStreams)) {
            vodStreams.slice(0, 8000).forEach(vd => {
              const ext = vd.container_extension || 'mp4';
              allMapped.push({
                id: 'vod-' + vd.stream_id,
                xtreamStreamId: vd.stream_id,
                name: vd.name || ('Filme ' + vd.stream_id),
                category: catMap[String(vd.category_id)] || 'Filmes VOD',
                section: 'vod',
                format: ext,
                url: `${cleanBase}/movie/${u}/${p}/${vd.stream_id}.${ext}`
              });
            });
          }

          if (Array.isArray(seriesList)) {
            seriesList.slice(0, 4000).forEach(sr => {
              allMapped.push({
                id: 'ser-' + (sr.series_id || sr.num),
                xtreamStreamId: sr.series_id,
                name: sr.name || 'Série',
                category: catMap[String(sr.category_id)] || 'Séries',
                section: 'series',
                format: 'mp4',
                url: ''
              });
            });
          }

          if (allMapped.length > 0) {
            state.iptvChannels = allMapped;
            saveChannels(allMapped);
            state.iptvCurrentChannelId = allMapped[0].id;
            el.headerSubStatus.textContent = `${profileName} • ${allMapped.length} canais IPTV + Cine P2P`;
            el.iptvAccountStatusFooter.textContent = `Watchdog Ativo • Ligações: ${activeCons}/${maxCons}`;
            updateIptvCounts();
            setAppMode('iptv');
            playIptvChannelById(allMapped[0].id);
            showXtreamModalFeedback(`Sincronizado! ${allMapped.length} canais carregados.`, 'success');
            setTimeout(() => el.xtreamModal.classList.add('hidden'), 650);
          } else {
            showXtreamModalFeedback('Ligado, mas não foram devolvidos canais.', 'error');
          }
        } catch (err) {
          showXtreamModalFeedback('Erro ao comunicar com o servidor Xtream. No Safari, confirma se "Disable Cross-Origin Restrictions" está ativo no menu Develop.', 'error');
        }
      }

      // =======================================================================
      // 6. METADATA ENGINE: CINEMETA + TMDB API + INDEXEDDB SMART CACHE
