    // Anel de logs (últimos 300) para o relatório de diagnóstico
    window.__msLog = [];
    ['log', 'warn', 'error'].forEach((k) => {
      const o = console[k].bind(console);
      console[k] = (...a) => {
        try {
          window.__msLog.push(new Date().toISOString().slice(11, 19) + ' ' + k + ' ' + a.map(x => typeof x === 'string' ? x : ((x && x.message) || JSON.stringify(x))).join(' ').slice(0, 300));
          if (window.__msLog.length > 300) window.__msLog.shift();
        } catch (e) {}
        o(...a);
      };
    });
    window.addEventListener('error', (e) => console.error('erro:', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
    window.addEventListener('unhandledrejection', (e) => console.error('promessa:', (e.reason && e.reason.message) || e.reason));
'use strict';
      // =======================================================================
      // 1. CURATED HIGH-RES CATALOG (Instant Zero-Latency + Offline/Fallback)
      //    Combined dynamically with Live Stremio Cinemeta & TMDB API
      // =======================================================================
      const CURATED_CATALOG = [
        { imdbId: 'tt15239678', type: 'movie', title: 'Dune: Parte Dois', year: 2024, rating: '8.5', runtime: '166 min', genres: ['Sci-Fi', 'Adventure', 'Action'],
          plot: 'Paul Atreides une-se a Chani e aos Fremen enquanto procura vingança contra os conspiradores que destruíram a sua família. Enfrentando uma escolha entre o amor da sua vida e o destino do universo, tenta evitar um futuro terrível.',
          cast: 'Timothée Chalamet, Zendaya, Rebecca Ferguson • Realização: Denis Villeneuve' },
        { imdbId: 'tt15398776', type: 'movie', title: 'Oppenheimer', year: 2023, rating: '8.3', runtime: '180 min', genres: ['Drama', 'History', 'Thriller'],
          plot: 'A história do físico J. Robert Oppenheimer e do seu papel no desenvolvimento da bomba atómica durante a Segunda Guerra Mundial.',
          cast: 'Cillian Murphy, Emily Blunt, Robert Downey Jr. • Realização: Christopher Nolan' },
        { imdbId: 'tt0816692', type: 'movie', title: 'Interstellar', year: 2014, rating: '8.7', runtime: '169 min', genres: ['Sci-Fi', 'Adventure', 'Drama'],
          plot: 'Com a Terra a morrer, uma equipa de exploradores viaja através de um buraco de minhoca em busca de um novo lar para a humanidade.',
          cast: 'Matthew McConaughey, Anne Hathaway, Jessica Chastain • Realização: Christopher Nolan' },
        { imdbId: 'tt1375666', type: 'movie', title: 'Inception', year: 2010, rating: '8.8', runtime: '148 min', genres: ['Sci-Fi', 'Action', 'Thriller'],
          plot: 'Um ladrão que rouba segredos através da partilha de sonhos recebe a tarefa inversa: plantar uma ideia na mente de um líder empresarial.',
          cast: 'Leonardo DiCaprio, Joseph Gordon-Levitt, Elliot Page • Realização: Christopher Nolan' },
        { imdbId: 'tt0468569', type: 'movie', title: 'The Dark Knight', year: 2008, rating: '9.0', runtime: '152 min', genres: ['Action', 'Crime', 'Drama'],
          plot: 'Batman enfrenta o Joker, um criminoso anárquico que mergulha Gotham no caos e testa os limites do herói.',
          cast: 'Christian Bale, Heath Ledger, Aaron Eckhart • Realização: Christopher Nolan' },
        { imdbId: 'tt1856101', type: 'movie', title: 'Blade Runner 2049', year: 2017, rating: '8.0', runtime: '164 min', genres: ['Sci-Fi', 'Drama', 'Thriller'],
          plot: 'Um jovem blade runner descobre um segredo enterrado que pode lançar a sociedade no caos e leva-o à procura de Rick Deckard.',
          cast: 'Ryan Gosling, Harrison Ford, Ana de Armas • Realização: Denis Villeneuve' },
        { imdbId: 'tt4633694', type: 'movie', title: 'Spider-Man: Into the Spider-Verse', year: 2018, rating: '8.4', runtime: '117 min', genres: ['Animation', 'Action', 'Adventure'],
          plot: 'Miles Morales torna-se o Homem-Aranha do seu universo e cruza-se com versões do herói vindas de outras dimensões.',
          cast: 'Shameik Moore, Jake Johnson, Hailee Steinfeld' },
        { imdbId: 'tt0903747', type: 'series', title: 'Breaking Bad', year: 2008, rating: '9.5', runtime: '49 min / ep', genres: ['Crime', 'Drama', 'Thriller'], seasonsCount: 5,
          plot: 'Um professor de química com cancro terminal alia-se a um antigo aluno para produzir metanfetamina e garantir o futuro da família.',
          cast: 'Bryan Cranston, Aaron Paul, Anna Gunn' },
        { imdbId: 'tt0944947', type: 'series', title: 'Game of Thrones', year: 2011, rating: '9.2', runtime: '57 min / ep', genres: ['Drama', 'Action', 'Adventure'], seasonsCount: 8,
          plot: 'Famílias nobres disputam o Trono de Ferro dos Sete Reinos enquanto uma ameaça antiga desperta no Norte.',
          cast: 'Emilia Clarke, Kit Harington, Peter Dinklage' },
        { imdbId: 'tt4574334', type: 'series', title: 'Stranger Things', year: 2016, rating: '8.6', runtime: '51 min / ep', genres: ['Sci-Fi', 'Drama', 'Thriller'], seasonsCount: 5,
          plot: 'Quando um rapaz desaparece, uma pequena cidade descobre experiências secretas, forças sobrenaturais e uma menina com poderes estranhos.',
          cast: 'Millie Bobby Brown, Finn Wolfhard, Winona Ryder' },
        { imdbId: 'tt11280740', type: 'series', title: 'Severance', year: 2022, rating: '8.7', runtime: '50 min / ep', genres: ['Sci-Fi', 'Drama', 'Thriller'], seasonsCount: 2,
          plot: 'Funcionários submetem-se a um procedimento que separa as memórias do trabalho das da vida pessoal.',
          cast: 'Adam Scott, Britt Lower, Patricia Arquette' },
        { imdbId: 'tt3581920', type: 'series', title: 'The Last of Us', year: 2023, rating: '8.7', runtime: '55 min / ep', genres: ['Drama', 'Action', 'Sci-Fi'], seasonsCount: 2,
          plot: 'Vinte anos após o colapso da civilização, um sobrevivente é contratado para escoltar uma jovem através de um país devastado.',
          cast: 'Pedro Pascal, Bella Ramsey, Gabriel Luna' },
        { imdbId: 'tt16358384', type: 'series', title: 'Tulsa King', year: 2022, rating: '8.0', runtime: '42 min / ep', genres: ['Crime', 'Drama', 'Action'], seasonsCount: 3,
          plot: 'Depois de 25 anos na prisão, o capo da máfia de Nova Iorque Dwight Manfredi é exilado pelo seu chefe para Tulsa, Oklahoma, onde constrói um novo império.',
          cast: 'Sylvester Stallone, Andrea Savage, Martin Starr' },
        { imdbId: 'tt7660850', type: 'series', title: 'Succession', year: 2018, rating: '8.8', runtime: '60 min / ep', genres: ['Drama', 'Comedy'], seasonsCount: 4,
          plot: 'A família Roy controla um dos maiores conglomerados de media do mundo, mas tudo muda quando o patriarca envelhecido começa a afastar-se.',
          cast: 'Brian Cox, Jeremy Strong, Sarah Snook, Kieran Culkin' },
        { imdbId: 'tt14452776', type: 'series', title: 'The Bear', year: 2022, rating: '8.5', runtime: '28 min / ep', genres: ['Comedy', 'Drama'], seasonsCount: 3,
          plot: 'Um jovem chef da alta gastronomia regressa a Chicago para gerir a modesta loja de sandes da sua família.',
          cast: 'Jeremy Allen White, Ayo Edebiri, Ebon Moss-Bachrach' },
        { imdbId: 'tt0306414', type: 'series', title: 'The Wire', year: 2002, rating: '9.3', runtime: '59 min / ep', genres: ['Crime', 'Drama', 'Thriller'], seasonsCount: 5,
          plot: 'O submundo do narcotráfico de Baltimore visto através dos olhos tanto dos detetives da polícia como dos traficantes.',
          cast: 'Dominic West, Idris Elba, Michael K. Williams' },
        { imdbId: 'tt0386676', type: 'series', title: 'The Office', year: 2005, rating: '9.0', runtime: '22 min / ep', genres: ['Comedy'], seasonsCount: 9,
          plot: 'O quotidiano cómico e absurdo dos empregados de escritório da empresa de papel Dunder Mifflin em Scranton.',
          cast: 'Steve Carell, John Krasinski, Jenna Fischer, Rainn Wilson' },
        { imdbId: 'tt2442560', type: 'series', title: 'Peaky Blinders', year: 2013, rating: '8.8', runtime: '58 min / ep', genres: ['Crime', 'Drama'], seasonsCount: 6,
          plot: 'Um gangue familiar liderado pelo ambicioso Tommy Shelby ascende ao poder em Birmingham logo após a Primeira Guerra Mundial.',
          cast: 'Cillian Murphy, Paul Anderson, Sophie Rundle' },
        { imdbId: 'tt10986410', type: 'series', title: 'Ted Lasso', year: 2020, rating: '8.8', runtime: '32 min / ep', genres: ['Comedy', 'Drama', 'Sport'], seasonsCount: 3,
          plot: 'Um treinador de futebol americano universitário é contratado para treinar uma equipa da Premier League inglesa apesar de não saber nada de futebol.',
          cast: 'Jason Sudeikis, Hannah Waddingham, Brett Goldstein' },
        { imdbId: 'tt17279496', type: 'movie', title: 'Civil War', year: 2024, rating: '7.0', runtime: '109 min', genres: ['Action', 'Thriller', 'Drama'],
          plot: 'Uma equipa de fotojornalistas atravessa uns Estados Unidos divididos por uma guerra civil intensa numa corrida contra o tempo até Washington D.C.',
          cast: 'Kirsten Dunst, Wagner Moura, Cailee Spaeny' },
        { imdbId: 'tt2948356', type: 'movie', title: 'Zootopia', year: 2016, rating: '8.0', runtime: '98 min', genres: ['Animation', 'Comedy', 'Adventure'],
          plot: 'Numa metrópole de mamíferos, uma coelha polícia novata e uma raposa vigarista têm de trabalhar juntas para desvendar uma conspiração.',
          cast: 'Ginnifer Goodwin, Jason Bateman, Idris Elba' }
      ].map(i => ({
        ...i,
        poster: `https://images.metahub.space/poster/medium/${i.imdbId}/img`,
        backdrop: `https://images.metahub.space/background/medium/${i.imdbId}/img`
      }));

      // Torrent WebRTC de teste (Sintel, domínio público) com WebSeeds — serve apenas para testar o motor WebTorrent do browser
      const VERIFIED_TEST_MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.webtorrent.dev&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F';

      const WSS_TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz', 'wss://tracker.webtorrent.dev'];
      // Servidor de streaming local do Stremio Desktop (opcional — não é preciso Python nem Terminal)
      const STREMIO_SERVER_URL = 'http://127.0.0.1:11470';
      const OPENSUBS_URL = 'https://opensubtitles-v3.strem.io';
      const DEFAULT_ADDONS = [
        { id: 'builtin-torrentio', manifestId: 'com.stremio.torrentio.addon', name: 'Torrentio (Oficial P2P + Debrid)', base: 'https://torrentio.strem.fun', enabled: true, builtin: true },
        { id: 'builtin-mediafusion', manifestId: 'org.stremio.mediafusion', name: 'MediaFusion ElfHosted', base: 'https://mediafusion.elfhosted.com', enabled: true, builtin: true },
        { id: 'builtin-comet', manifestId: 'stremio.comet.fast', name: 'Comet ElfHosted', base: 'https://comet.elfhosted.com', enabled: true, builtin: true },
        { id: 'builtin-tpbplus', manifestId: 'com.stremio.thepiratebayplus.addon', name: 'ThePirateBay+', base: 'https://thepiratebay-plus.strem.fun', enabled: true, builtin: true },
        { id: 'builtin-peerflix', manifestId: 'org.peerflix.addon', name: 'Peerflix Torrents', base: 'https://peerflix.mov', enabled: true, builtin: true }
      ];

      // Loja Curada de Add-ons Stremio Verificados (Inspirado no addons-seed do Zeus + Verificação de Latência)
      const CURATED_ADDON_CATALOG = [
        { id: 'store-torrentio', manifestId: 'com.stremio.torrentio.addon', name: 'Torrentio (Oficial P2P + Debrid)', category: 'Streams 4K/1080p', desc: 'Motor principal multi-tracker (1337x, RARBG, YTS, EZTV, Rutracker)', base: 'https://torrentio.strem.fun' },
        { id: 'store-tpbplus', manifestId: 'com.stremio.thepiratebayplus.addon', name: 'ThePirateBay+', category: 'Streams P2P', desc: 'Catálogo P2P clássico para filmes e séries com milhares de seeds', base: 'https://thepiratebay-plus.strem.fun' },
        { id: 'store-mediafusion', manifestId: 'org.stremio.mediafusion', name: 'MediaFusion ElfHosted', category: 'Streams & Desporto', desc: 'Streams P2P, eventos em direto e catálogos globais', base: 'https://mediafusion.elfhosted.com' },
        { id: 'store-comet', manifestId: 'stremio.comet.fast', name: 'Comet ElfHosted', category: 'Debrid & Torrents', desc: 'Indexador ultrarrápido de torrents e caches Debrid', base: 'https://comet.elfhosted.com' },
        { id: 'store-peerflix', manifestId: 'org.peerflix.addon', name: 'Peerflix Torrents', category: 'Streams P2P', desc: 'Fontes alternativas P2P em Inglês, Espanhol e Português', base: 'https://peerflix.mov' },
        { id: 'store-cyberflix', manifestId: 'ick.stremio.cyberflix', name: 'Cyberflix Catalogs', category: 'Catálogos Streaming', desc: 'Catálogos por plataforma (Netflix, HBO Max, Apple TV+, Disney+, Prime)', base: 'https://cyberflix.elfhosted.com' },
        { id: 'store-kitsu', manifestId: 'com.stremio.anime-kitsu.addon', name: 'Anime Kitsu', category: 'Anime', desc: 'Catálogo oficial de Anime com metadados e temporadas completas', base: 'https://anime-kitsu.strem.fun' },
        { id: 'store-opensubs', manifestId: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3 Oficial', category: 'Legendas PT/EN', desc: 'Sincronização por videoHash OSDB 64-bit e catálogo global de legendas', base: 'https://opensubtitles-v3.strem.io' }
      ];

      // ---- Helpers globais ----
      function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      }
      function encQ(s) {
        return encodeURIComponent(String(s == null ? '' : s)).replace(/'/g, '%27');
      }
      function localPosterSvg(text, w = 300, h = 450) {
        const label = esc(String(text || 'MacStream').slice(0, 26));
        const fs = w > 500 ? 28 : 18;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#131825"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6366f1" font-family="-apple-system,sans-serif" font-size="${fs}" font-weight="700">${label}</text></svg>`;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      }
      const SECRET_PREFIX = 'enc:v1:';
      const DEBRID_CRED_RE = /(\|(?:realdebrid|alldebrid|premiumize|debridlink|torbox)=|\/(?:realdebrid|alldebrid|premiumize|debridlink|torbox)\b|[?&](?:api_?key|token)=)/i;
      function encSecret(val) {
        const s = typeof val === 'string' ? val : '';
        if (!s || s.startsWith(SECRET_PREFIX)) return s;
        try {
          if (window.macstreamApp && typeof window.macstreamApp.encryptSecret === 'function') {
            return window.macstreamApp.encryptSecret(s);
          }
        } catch (e) {}
        return s;
      }
      function decSecret(val) {
        const s = typeof val === 'string' ? val : '';
        if (!s || !s.startsWith(SECRET_PREFIX)) return s;
        try {
          if (window.macstreamApp && typeof window.macstreamApp.decryptSecret === 'function') {
            return window.macstreamApp.decryptSecret(s);
          }
        } catch (e) {}
        return '';
      }
      function readSecret(key) {
        try {
          const raw = localStorage.getItem(key) || '';
          if (!raw) return '';
          if (!raw.startsWith(SECRET_PREFIX)) {
            const encrypted = encSecret(raw);
            if (encrypted && encrypted !== raw) localStorage.setItem(key, encrypted);
            return raw;
          }
          return decSecret(raw);
        } catch (e) {
          return '';
        }
      }
      function writeSecret(key, val) {
        try {
          const clean = typeof val === 'string' ? val : '';
          if (!clean) { localStorage.removeItem(key); return; }
          localStorage.setItem(key, encSecret(clean));
        } catch (e) {}
      }
      function hashStr(s) {
        let h = 5381;
        const str = String(s);
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
      }
      function pad2(n) { return String(n).padStart(2, '0'); }
      function mergeEssentialAddons(list) {
        const out = Array.isArray(list) ? list.map(a => ({ ...a })) : [];
        try {
          if (localStorage.getItem('macstream_addons_v2_seeded') === '1' && out.length > 1) {
            return out;
          }
          let changed = false;
          DEFAULT_ADDONS.forEach((def) => {
            const exists = out.some(a =>
              a && (a.id === def.id || a.manifestId === def.manifestId || (a.base && a.base.replace(/\/+$/, '') === def.base))
            );
            if (!exists) {
              out.push({ ...def });
              changed = true;
            }
          });
          localStorage.setItem('macstream_addons_v2_seeded', '1');
          if (changed) saveAddons(out);
        } catch (e) {}
        return out;
      }

      function loadAddons() {
        try {
          const raw = JSON.parse(localStorage.getItem('macstream_addons') || 'null');
          if (Array.isArray(raw) && raw.length) {
            let migrated = false;
            const out = raw.map((a) => {
              if (!a || typeof a !== 'object') return a;
              const baseStr = typeof a.base === 'string' ? a.base : '';
              if (baseStr.startsWith(SECRET_PREFIX)) {
                return { ...a, base: decSecret(baseStr) };
              }
              if (DEBRID_CRED_RE.test(baseStr) && window.macstreamApp && typeof window.macstreamApp.encryptSecret === 'function') {
                migrated = true;
              }
              return a;
            });
            if (migrated) saveAddons(out);
            return mergeEssentialAddons(out);
          }
        } catch (e) {}
        const initial = DEFAULT_ADDONS.map(a => ({ ...a }));
        try { localStorage.setItem('macstream_addons_v2_seeded', '1'); } catch (e) {}
        return initial;
      }
      function saveAddons(list) {
        try {
          const prepared = (Array.isArray(list) ? list : []).map((a) => {
            if (a && typeof a.base === 'string' && DEBRID_CRED_RE.test(a.base)) {
              return { ...a, base: encSecret(a.base) };
            }
            return a;
          });
          localStorage.setItem('macstream_addons', JSON.stringify(prepared));
        } catch (e) {}
      }

      // LocalStorage Helper compatible with existing MacStream Pro keys
      const storage = {
        get(key, fallback) {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            if (key === 'macstream_xtream' && parsed && typeof parsed === 'object' && parsed.password) {
              const pw = String(parsed.password);
              if (pw.startsWith(SECRET_PREFIX)) {
                return { ...parsed, password: decSecret(pw) };
              }
              const encPw = encSecret(pw);
              if (encPw && encPw !== pw) {
                try { localStorage.setItem(key, JSON.stringify({ ...parsed, password: encPw })); } catch (e) {}
              }
            }
            return parsed;
          } catch (e) {
            return fallback;
          }
        },
        set(key, val) {
          if (typeof state !== 'undefined' && state.privateMode && key === 'macstream_history') return;
          try {
            let toStore = val;
            if (key === 'macstream_xtream' && val && typeof val === 'object' && val.password) {
              toStore = { ...val, password: encSecret(String(val.password)) };
            }
            localStorage.setItem(key, JSON.stringify(toStore));
          } catch (e) {}
        }
      };

      const _nowSec = Math.floor(Date.now() / 1000);
      const DEMO_IPTV_CHANNELS = [
        {
          id: 'demo-pt-1-fhd',
          name: 'RTP 1 FHD',
          category: '🇵🇹 Portugal Generalistas',
          section: 'live',
          logo: '',
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          format: 'm3u8',
          epgNow: { time: '20:00 – 21:00', start: _nowSec - 1500, end: _nowSec + 2100, title: 'Telejornal (Emissão Direta)', desc: 'Informação nacional e internacional em direto.' },
          epgNext: { time: 'Às 21:00', title: ' Linha da Frente — Reportagem Especial', desc: 'Grande reportagem.' }
        },
        {
          id: 'demo-pt-1-hd',
          name: 'RTP 1 HD',
          category: '🇵🇹 Portugal Generalistas',
          section: 'live',
          logo: '',
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          format: 'm3u8',
          epgNow: { time: '20:00 – 21:00', start: _nowSec - 1500, end: _nowSec + 2100, title: 'Telejornal (Emissão Direta)', desc: 'Informação nacional e internacional em direto.' }
        },
        {
          id: 'demo-pt-1-low',
          name: 'RTP 1 LOW',
          category: '🇵🇹 Portugal Generalistas',
          section: 'live',
          logo: '',
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          format: 'm3u8',
          epgNow: { time: '20:00 – 21:00', start: _nowSec - 1500, end: _nowSec + 2100, title: 'Telejornal (Emissão Direta)', desc: 'Sinal estável de baixo consumo.' }
        },
        {
          id: 'demo-sport-1-fhd',
          name: 'Mux Sports 1 FHD',
          category: '⚽ Desporto Premium',
          section: 'live',
          logo: '',
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          format: 'm3u8',
          epgNow: { time: '20:15 – 22:15', start: _nowSec - 1800, end: _nowSec + 5400, title: 'Liga dos Campeões — Direto Especial', desc: 'Transmissão desportiva em alta definição 60fps.' },
          epgNext: { time: 'Às 22:15', title: 'Resumo da Jornada & Análise Tática', desc: 'Pós-jogo em estúdio.' }
        },
        {
          id: 'demo-sport-1-hd',
          name: 'Mux Sports 1 HD',
          category: '⚽ Desporto Premium',
          section: 'live',
          logo: '',
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          format: 'm3u8',
          epgNow: { time: '20:15 – 22:15', start: _nowSec - 1800, end: _nowSec + 5400, title: 'Liga dos Campeões — Direto Especial', desc: 'Transmissão desportiva HD.' }
        },
        {
          id: 'demo-sport-1-low',
          name: 'Mux Sports 1 SD LOW',
          category: '⚽ Desporto Premium',
          section: 'live',
          logo: '',
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          format: 'm3u8',
          epgNow: { time: '20:15 – 22:15', start: _nowSec - 1800, end: _nowSec + 5400, title: 'Liga dos Campeões — Direto Especial', desc: 'Variante otimizada para Duplo Ecrã no MacBook Air.' }
        },
        {
          id: 'demo-cine-1-fhd',
          name: 'Cine Open Movie Channel FHD',
          category: '🎬 Cinema & Séries',
          section: 'live',
          logo: '',
          url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
          format: 'mp4',
          epgNow: { time: '21:00 – 22:45', start: _nowSec - 900, end: _nowSec + 4500, title: 'Tears of Steel (Sci-Fi 4K Master)', desc: 'Sessão de cinema Sci-Fi sem intervalos.' },
          epgNext: { time: 'Às 22:45', title: 'Especial Realizadores Sci-Fi', desc: 'Documentário.' }
        }
      ];

      // =======================================================================
      // 2. INDEXEDDB PERSISTENCE ENGINE (MacStreamCineDB)
      //    Stores: watch_progress, library, catalog_cache, settings
      // =======================================================================
      const CineDB = {
        db: null,
        init() {
          return new Promise((resolve) => {
            if (!window.indexedDB) {
              resolve(false);
              return;
            }
            const req = window.indexedDB.open('MacStreamCineDB', 3);
            req.onupgradeneeded = (ev) => {
              const db = ev.target.result;
              if (!db.objectStoreNames.contains('watch_progress')) {
                db.createObjectStore('watch_progress', { keyPath: 'key' });
              }
              if (!db.objectStoreNames.contains('library')) {
                db.createObjectStore('library', { keyPath: 'imdbId' });
              }
              if (!db.objectStoreNames.contains('kv')) {
                db.createObjectStore('kv', { keyPath: 'key' });
              }
              if (!db.objectStoreNames.contains('catalog_cache')) {
                db.createObjectStore('catalog_cache', { keyPath: 'cacheKey' });
              }
            };
            req.onsuccess = (ev) => {
              this.db = ev.target.result;
              resolve(true);
            };
            req.onerror = () => resolve(false);
          });
        },
        put(storeName, item) {
          if (typeof state !== 'undefined' && state.privateMode && storeName === 'watch_progress') return Promise.resolve(false);
          return new Promise((resolve) => {
            if (!this.db) return resolve(false);
            try {
              const tx = this.db.transaction(storeName, 'readwrite');
              tx.objectStore(storeName).put(item);
              tx.oncomplete = () => resolve(true);
              tx.onerror = () => resolve(false);
            } catch (e) {
              resolve(false);
            }
          });
        },
        get(storeName, key) {
          return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            try {
              const tx = this.db.transaction(storeName, 'readonly');
              const req = tx.objectStore(storeName).get(key);
              req.onsuccess = () => resolve(req.result || null);
              req.onerror = () => resolve(null);
            } catch (e) {
              resolve(null);
            }
          });
        },
        getAll(storeName) {
          return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            try {
              const tx = this.db.transaction(storeName, 'readonly');
              const req = tx.objectStore(storeName).getAll();
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => resolve([]);
            } catch (e) {
              resolve([]);
            }
          });
        },
        delete(storeName, key) {
          return new Promise((resolve) => {
            if (!this.db) return resolve(false);
            try {
              const tx = this.db.transaction(storeName, 'readwrite');
              tx.objectStore(storeName).delete(key);
              tx.oncomplete = () => resolve(true);
              tx.onerror = () => resolve(false);
            } catch (e) {
              resolve(false);
            }
          });
        },
        clearStore(storeName) {
          return new Promise((resolve) => {
            if (!this.db) return resolve(false);
            try {
              const tx = this.db.transaction(storeName, 'readwrite');
              tx.objectStore(storeName).clear();
              tx.oncomplete = () => resolve(true);
              tx.onerror = () => resolve(false);
            } catch (e) {
              resolve(false);
            }
          });
        }
      };

      // =======================================================================
      // 3. APPLICATION STATE (UNIFIED CINE P2P + IPTV PRO)
      // =======================================================================
      const state = {
        appMode: 'cine', // 'cine' | 'iptv'
        // Stremio / Cine State
        catalog: [...CURATED_CATALOG],
        watchProgressMap: {},
        libraryMap: {},
        activeNav: 'discover',
        activeGenre: 'ALL',
        sortBy: 'popular',
        searchQuery: '',
        tmdbApiKey: readSecret('macstream_tmdb_key'),
        ecoMode: true,
        selectedItem: null,
        selectedSeason: 1,
        selectedEpisode: 1,
        seriesEpisodesBySeason: {},
        scrapedStreams: [],
        activeResFilter: 'ALL',
        playingContext: null,
        activePlayMode: 'auto',
        webTorrentClient: null,
        activeTorrent: null,
        activeHls: null,
        progressSaveTimer: null,
        telemetryTimer: null,
        upNextTimer: null,
        upNextCountdown: 10,
        // MacStream Pro IPTV State (Preserves user's saved localStorage keys)
        iptvChannels: DEMO_IPTV_CHANNELS,
        iptvFavorites: storage.get('macstream_favs', []),
        iptvHistory: storage.get('macstream_history', []),
        xtreamConfig: storage.get('macstream_xtream', {
          profileName: 'Servidor Principal Mac',
          server: '',
          username: '',
          password: '',
          maxConnections: ''
        }),
        iptvActiveSection: 'live',
        iptvSelectedCategory: 'ALL',
        iptvCurrentChannelId: '',
        iptvSecondaryChannelId: '',
        multiViewActive: false,
        iptvEngineMode: 'auto',
        autoReconnect: true,
        autoFailoverVariant: false,
        macAirMultiViewOpt: true,
        retryCount: 0,
        iptvRenderLimit: 300,
        objectFitMode: 'contain',
        imageBoost: false
      };

      Object.assign(state, {
        addons: loadAddons(), episodesCache: {}, playToken: 0, scrapeToken: 0, subToken: 0,
        iptvExtra: {}, iptvSeriesDrill: null, subtitleUrls: [], subtitleTracks: [], lastSubCode: null, p2pWatchdogTimer: null,
        iptvViewMode: localStorage.getItem('ms_iptv_view_mode_v25') || 'workspace',
        iptvGroupVariants: localStorage.getItem('ms_iptv_group_variants') !== '0',
        iptvActivePortal: localStorage.getItem('ms_iptv_portal') || 'ALL',
        iptvPinnedCategories: storage.get('ms_iptv_pinned_cats', []),
        iptvLocalFilter: '',
        iptvPortalFilter: '',
        addonPingMap: {},
        debridProvider: localStorage.getItem('ms_debrid_provider') || 'none',
        debridApiKey: readSecret('ms_debrid_key')
      });

      // Per-Screen Watchdog State for IPTV Live Mode
      const iptvMon = {
        screen1: { lastTime: -1, stallSeconds: 0, consecutiveHeals: 0, healingLockUntil: 0 },
        screen2: { lastTime: -1, stallSeconds: 0, consecutiveHeals: 0, healingLockUntil: 0 }
      };

      let primaryIptvHls = null;
      let primaryIptvMpegts = null;
      let secondaryIptvHls = null;
      let secondaryIptvMpegts = null;
      let iptvWatchdogInterval = null;
      let sleepTimerTimeout = null;

      // =======================================================================
      // 4. DOM REFERENCES
      // =======================================================================
      const el = {
        brandHomeBtn: document.getElementById('brandHomeBtn'),
        toggleIptvSidebarBtn: document.getElementById('toggleIptvSidebarBtn'),
        headerSubStatus: document.getElementById('headerSubStatus'),
        switchModeCineBtn: document.getElementById('switchModeCineBtn'),
        switchModeIptvBtn: document.getElementById('switchModeIptvBtn'),
        headerIptvCountBadge: document.getElementById('headerIptvCountBadge'),
        globalSearchInput: document.getElementById('globalSearchInput'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        openMagnetModalBtn: document.getElementById('openMagnetModalBtn'),
        headerMultiViewBtn: document.getElementById('headerMultiViewBtn'),
        headerMultiViewLabel: document.getElementById('headerMultiViewLabel'),
        openXtreamModalBtn: document.getElementById('openXtreamModalBtn'),
        syncCatalogBtn: document.getElementById('syncCatalogBtn'),
        syncIcon: document.getElementById('syncIcon'),
        ecoHudLabel: document.getElementById('ecoHudLabel'),
        openSettingsModalBtn: document.getElementById('openSettingsModalBtn'),
        cineWorkspaceView: document.getElementById('cineWorkspaceView'),
        iptvWorkspaceView: document.getElementById('iptvWorkspaceView'),
        dockJumpToLiveTvBtn: document.getElementById('dockJumpToLiveTvBtn'),
        dockContinueBadge: document.getElementById('dockContinueBadge'),
        dockLibraryBadge: document.getElementById('dockLibraryBadge'),
        activeMetadataProviderLabel: document.getElementById('activeMetadataProviderLabel'),
        heroBannerSection: document.getElementById('heroBannerSection'),
        heroBackdropImg: document.getElementById('heroBackdropImg'),
        heroImdbBadge: document.getElementById('heroImdbBadge'),
        heroYearGenre: document.getElementById('heroYearGenre'),
        heroTitle: document.getElementById('heroTitle'),
        heroOverview: document.getElementById('heroOverview'),
        heroWatchBtn: document.getElementById('heroWatchBtn'),
        heroLibraryBtn: document.getElementById('heroLibraryBtn'),
        heroLibraryIcon: document.getElementById('heroLibraryIcon'),
        heroLibraryLabel: document.getElementById('heroLibraryLabel'),
        continueWatchingSection: document.getElementById('continueWatchingSection'),
        continueWatchingGrid: document.getElementById('continueWatchingGrid'),
        clearHistoryBtn: document.getElementById('clearHistoryBtn'),
        catalogSortSelect: document.getElementById('catalogSortSelect'),
        catalogSectionHeading: document.getElementById('catalogSectionHeading'),
        catalogCountLabel: document.getElementById('catalogCountLabel'),
        catalogGrid: document.getElementById('catalogGrid'),
        // IPTV Workspace Elements
        iptvSidebarPanel: document.getElementById('iptvSidebarPanel'),
        countLiveBadge: document.getElementById('countLiveBadge'),
        countVodBadge: document.getElementById('countVodBadge'),
        countSeriesBadge: document.getElementById('countSeriesBadge'),
        countFavsBadge: document.getElementById('countFavsBadge'),
        countHistoryBadge: document.getElementById('countHistoryBadge'),
        iptvCategorySelect: document.getElementById('iptvCategorySelect'),
        refreshIptvPlaylistBtn: document.getElementById('refreshIptvPlaylistBtn'),
        iptvChannelListContainer: document.getElementById('iptvChannelListContainer'),
        iptvLoadMoreWrapper: document.getElementById('iptvLoadMoreWrapper'),
        iptvLoadMoreBtn: document.getElementById('iptvLoadMoreBtn'),
        iptvAccountStatusFooter: document.getElementById('iptvAccountStatusFooter'),
        exportM3uBtn: document.getElementById('exportM3uBtn'),
        iptvQuickFavsList: document.getElementById('iptvQuickFavsList'),
        iptvVideoStageWrapper: document.getElementById('iptvVideoStageWrapper'),
        iptvPlayersGrid: document.getElementById('iptvPlayersGrid'),
        iptvPrimaryVideo: document.getElementById('iptvPrimaryVideo'),
        screen1HealthDot: document.getElementById('screen1HealthDot'),
        osdChannelName: document.getElementById('osdChannelName'),
        osdEngineTag: document.getElementById('osdEngineTag'),
        screen1HealBadge: document.getElementById('screen1HealBadge'),
        screen1HealText: document.getElementById('screen1HealText'),
        safariBlockBanner: document.getElementById('safariBlockBanner'),
        tryTsEngineBtn: document.getElementById('tryTsEngineBtn'),
        switchScreen1LighterVariantBtn: document.getElementById('switchScreen1LighterVariantBtn'),
        dismissSafariBannerBtn: document.getElementById('dismissSafariBannerBtn'),
        iptvSecondaryPlayerCard: document.getElementById('iptvSecondaryPlayerCard'),
        iptvSecondaryVideo: document.getElementById('iptvSecondaryVideo'),
        screen2HealthDot: document.getElementById('screen2HealthDot'),
        secondaryChannelTitle: document.getElementById('secondaryChannelTitle'),
        secondaryChannelSelect: document.getElementById('secondaryChannelSelect'),
        reloadSecondaryBtn: document.getElementById('reloadSecondaryBtn'),
        optimizeSecondaryVariantBtn: document.getElementById('optimizeSecondaryVariantBtn'),
        swapAudioSecondaryBtn: document.getElementById('swapAudioSecondaryBtn'),
        screen2HealBadge: document.getElementById('screen2HealBadge'),
        screen2HealText: document.getElementById('screen2HealText'),
        iptvPrevChannelBtn: document.getElementById('iptvPrevChannelBtn'),
        iptvNextChannelBtn: document.getElementById('iptvNextChannelBtn'),
        iptvFavCurrentBtn: document.getElementById('iptvFavCurrentBtn'),
        iptvFavCurrentStar: document.getElementById('iptvFavCurrentStar'),
        iptvFavCurrentLabel: document.getElementById('iptvFavCurrentLabel'),
        iptvReloadChannelBtn: document.getElementById('iptvReloadChannelBtn'),
        iptvSwitchBackupSignalBtn: document.getElementById('iptvSwitchBackupSignalBtn'),
        iptvEngineModeSelect: document.getElementById('iptvEngineModeSelect'),
        iptvAspectRatioBtn: document.getElementById('iptvAspectRatioBtn'),
        iptvImageBoostBtn: document.getElementById('iptvImageBoostBtn'),
        iptvPipBtn: document.getElementById('iptvPipBtn'),
        iptvFullscreenBtn: document.getElementById('iptvFullscreenBtn'),
        iptvInfoCategoryBadge: document.getElementById('iptvInfoCategoryBadge'),
        iptvInfoStreamIdBadge: document.getElementById('iptvInfoStreamIdBadge'),
        iptvInfoChannelTitle: document.getElementById('iptvInfoChannelTitle'),
        copyStreamUrlBtn: document.getElementById('copyStreamUrlBtn'),
        copyM3uPlaylistUrlBtn: document.getElementById('copyM3uPlaylistUrlBtn'),
        siblingVariantsList: document.getElementById('siblingVariantsList'),
        epgNowTime: document.getElementById('epgNowTime'),
        epgNowTitle: document.getElementById('epgNowTitle'),
        epgNowDesc: document.getElementById('epgNowDesc'),
        epgNextTime: document.getElementById('epgNextTime'),
        epgNextTitle: document.getElementById('epgNextTitle'),
        epgNextDesc: document.getElementById('epgNextDesc'),
        engineBadge: document.getElementById('engineBadge'),
        metricBuffer: document.getElementById('metricBuffer'),
        metricResolution: document.getElementById('metricResolution'),
        metricRetries: document.getElementById('metricRetries'),
        autoReconnectToggle: document.getElementById('autoReconnectToggle'),
        autoFailoverVariantToggle: document.getElementById('autoFailoverVariantToggle'),
        macAirMultiViewOptToggle: document.getElementById('macAirMultiViewOptToggle'),
        sleepTimerSelect: document.getElementById('sleepTimerSelect'),
        // Xtream Modal Elements
        xtreamModal: document.getElementById('xtreamModal'),
        closeXtreamModalBtn: document.getElementById('closeXtreamModalBtn'),
        tabXtreamLoginBtn: document.getElementById('tabXtreamLoginBtn'),
        tabM3uImportBtn: document.getElementById('tabM3uImportBtn'),
        xtreamForm: document.getElementById('xtreamForm'),
        m3uImportPanel: document.getElementById('m3uImportPanel'),
        xtreamProfileName: document.getElementById('xtreamProfileName'),
        xtreamServerInput: document.getElementById('xtreamServerInput'),
        xtreamUserInput: document.getElementById('xtreamUserInput'),
        xtreamPassInput: document.getElementById('xtreamPassInput'),
        xtreamFeedbackBox: document.getElementById('xtreamFeedbackBox'),
        m3uFileInput: document.getElementById('m3uFileInput'),
        m3uRawTextarea: document.getElementById('m3uRawTextarea'),
        parseM3uBtn: document.getElementById('parseM3uBtn'),
        // Detail Drawer
        detailModal: document.getElementById('detailModal'),
        closeDetailModalBtn: document.getElementById('closeDetailModalBtn'),
        detailBackdrop: document.getElementById('detailBackdrop'),
        detailPoster: document.getElementById('detailPoster'),
        detailTypeBadge: document.getElementById('detailTypeBadge'),
        detailImdbBadge: document.getElementById('detailImdbBadge'),
        detailYearRuntime: document.getElementById('detailYearRuntime'),
        detailImdbIdTag: document.getElementById('detailImdbIdTag'),
        detailTitle: document.getElementById('detailTitle'),
        detailGenres: document.getElementById('detailGenres'),
        detailResumeBtn: document.getElementById('detailResumeBtn'),
        detailToggleLibraryBtn: document.getElementById('detailToggleLibraryBtn'),
        detailLibIcon: document.getElementById('detailLibIcon'),
        detailLibText: document.getElementById('detailLibText'),
        detailMarkWatchedBtn: document.getElementById('detailMarkWatchedBtn'),
        detailWatchedIcon: document.getElementById('detailWatchedIcon'),
        detailWatchedText: document.getElementById('detailWatchedText'),
        detailPlot: document.getElementById('detailPlot'),
        detailCast: document.getElementById('detailCast'),
        seriesEpisodesContainer: document.getElementById('seriesEpisodesContainer'),
        seriesActiveEpisodeLabel: document.getElementById('seriesActiveEpisodeLabel'),
        seasonTabsList: document.getElementById('seasonTabsList'),
        episodesListContainer: document.getElementById('episodesListContainer'),
        streamsSubtitleTarget: document.getElementById('streamsSubtitleTarget'),
        streamsTotalBadge: document.getElementById('streamsTotalBadge'),
        inlineMagnetInput: document.getElementById('inlineMagnetInput'),
        inlineMagnetPlayBtn: document.getElementById('inlineMagnetPlayBtn'),
        streamsListContainer: document.getElementById('streamsListContainer'),
        // Video Player Overlay
        playerModal: document.getElementById('playerModal'),
        closePlayerBtn: document.getElementById('closePlayerBtn'),
        playerTitle: document.getElementById('playerTitle'),
        playerWatchedPill: document.getElementById('playerWatchedPill'),
        playerStreamSubtitle: document.getElementById('playerStreamSubtitle'),
        p2pStatusDot: document.getElementById('p2pStatusDot'),
        p2pEngineModeBadge: document.getElementById('p2pEngineModeBadge'),
        p2pDownSpeed: document.getElementById('p2pDownSpeed'),
        p2pPeersCount: document.getElementById('p2pPeersCount'),
        p2pBufferPct: document.getElementById('p2pBufferPct'),
        playerEpisodeNavGroup: document.getElementById('playerEpisodeNavGroup'),
        playerPrevEpBtn: document.getElementById('playerPrevEpBtn'),
        playerNextEpBtn: document.getElementById('playerNextEpBtn'),
        videoDropZone: document.getElementById('videoDropZone'),
        cineVideoPlayer: document.getElementById('cineVideoPlayer'),
        playerCenterOsd: document.getElementById('playerCenterOsd'),
        playerLoadingOverlay: document.getElementById('playerLoadingOverlay'),
        playerLoadingText: document.getElementById('playerLoadingText'),
        playerLoadingSub: document.getElementById('playerLoadingSub'),
        localEngineMissingCard: document.getElementById('localEngineMissingCard'),
        upNextEpisodeCard: document.getElementById('upNextEpisodeCard'),
        upNextCountdownBadge: document.getElementById('upNextCountdownBadge'),
        upNextEpisodeTitle: document.getElementById('upNextEpisodeTitle'),
        playNextEpisodeNowBtn: document.getElementById('playNextEpisodeNowBtn'),
        dismissUpNextBtn: document.getElementById('dismissUpNextBtn'),
        playerBottomHud: document.getElementById('playerBottomHud'),
        playerCurrentTime: document.getElementById('playerCurrentTime'),
        playerSeekInput: document.getElementById('playerSeekInput'),
        playerDurationTime: document.getElementById('playerDurationTime'),
        playerPlayPauseBtn: document.getElementById('playerPlayPauseBtn'),
        playerPlayPauseIcon: document.getElementById('playerPlayPauseIcon'),
        playerRewindBtn: document.getElementById('playerRewindBtn'),
        playerForwardBtn: document.getElementById('playerForwardBtn'),
        playerMuteBtn: document.getElementById('playerMuteBtn'),
        playerVolumeSlider: document.getElementById('playerVolumeSlider'),
        subtitleTrackSelect: document.getElementById('subtitleTrackSelect'),
        customSrtFileInput: document.getElementById('customSrtFileInput'),
        playerPipBtn: document.getElementById('playerPipBtn'),
        playerFullscreenBtn: document.getElementById('playerFullscreenBtn'),
        // Modals
        magnetModal: document.getElementById('magnetModal'),
        closeMagnetModalBtn: document.getElementById('closeMagnetModalBtn'),
        directMagnetTextarea: document.getElementById('directMagnetTextarea'),
        fillSampleMagnetBtn: document.getElementById('fillSampleMagnetBtn'),
        torrentFileInput: document.getElementById('torrentFileInput'),
        startDirectMagnetBtn: document.getElementById('startDirectMagnetBtn'),
        settingsModal: document.getElementById('settingsModal'),
        closeSettingsModalBtn: document.getElementById('closeSettingsModalBtn'),
        tmdbApiKeyInput: document.getElementById('tmdbApiKeyInput'),
        saveTmdbKeyBtn: document.getElementById('saveTmdbKeyBtn'),
        customAddonUrlInput: document.getElementById('customAddonUrlInput'),
        installAddonBtn: document.getElementById('installAddonBtn'),
        ecoModeToggle: document.getElementById('ecoModeToggle'),
        toastBanner: document.getElementById('toastBanner'),
        toastMessage: document.getElementById('toastMessage'),
        epgProgressBar: document.getElementById('epgProgressBar'),
        addonsListContainer: document.getElementById('addonsListContainer'),
        engineHelpText: document.getElementById('engineHelpText'),
        helpTryWebtorrentBtn: document.getElementById('helpTryWebtorrentBtn'),
        helpRetryStremioBtn: document.getElementById('helpRetryStremioBtn'),
        helpOpenSettingsBtn: document.getElementById('helpOpenSettingsBtn')
      };

      // =======================================================================
      // 5. UTILITY HELPERS
      // =======================================================================
      function showToast(msg) {
        el.toastMessage.textContent = msg;
        el.toastBanner.classList.remove('hidden');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => {
          el.toastBanner.classList.add('hidden');
        }, 3200);
      }

      function formatTime(sec) {
        if (!sec || !isFinite(sec) || sec < 0) return '00:00';
        const s = Math.floor(sec);
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const rem = s % 60;
        if (hrs > 0) {
          return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
        }
        return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
      }

      function getProgressKey(imdbId, type, season, episode) {
        if (type === 'series') {
          return `${imdbId}_S${season || 1}_E${episode || 1}`;
        }
        return String(imdbId);
      }

      function copyTextSafe(text, label) {
        if (!text) return;
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          showToast(label || 'Copiado para a área de transferência!');
        } catch (e) {}
        document.body.removeChild(ta);
      }

      // =======================================================================
      // 5A. PRIVACIDADE 100% LOCAL & ESPELHO EM DISCO (user-state.json)
      // =======================================================================
      let _diskSyncTimer = null;
      function buildLocalUserStatePayload(replaceLibrary = false) {
        const introMap = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('ms_intro_')) {
              introMap[k] = JSON.parse(localStorage.getItem(k) || 'null');
            }
          }
        } catch (e) {}
        const encAddons = (state.addons || []).map((a) => {
          if (a && typeof a.base === 'string' && DEBRID_CRED_RE.test(a.base)) {
            return { ...a, base: encSecret(a.base) };
          }
          return a;
        });
        return {
          replaceLibrary,
          watchProgressMap: state.watchProgressMap || {},
          libraryMap: state.libraryMap || {},
          iptvFavorites: state.iptvFavorites || [],
          iptvHistory: state.iptvHistory || [],
          iptvPinnedCategories: state.iptvPinnedCategories || [],
          addons: encAddons,
          debridProvider: state.debridProvider || 'none',
          tmdbApiKey: encSecret(state.tmdbApiKey || ''),
          introMap,
          updatedAt: Date.now()
        };
      }

      function syncUserStateToDisk(immediate = false, replaceLibrary = false) {
        if (state.privateMode) return;
        const app = window.macstreamApp;
        if (!app || !app.engineUrl) return;
        clearTimeout(_diskSyncTimer);
        const run = async () => {
          try {
            const payload = buildLocalUserStatePayload(replaceLibrary);
            const r = await fetch(`${app.engineUrl}/user-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (r.ok) {
              const b1 = document.getElementById('diskMirrorStatusBadge');
              const b2 = document.getElementById('headerBackupStatusLabel');
              const hh = new Date().toTimeString().slice(0, 5);
              if (b1) b1.textContent = `✓ Guardado no Disco (${hh})`;
              if (b2) b2.textContent = `🔒 Disco Local (${hh})`;
            }
          } catch (e) {}
        };
        if (immediate) run();
        else _diskSyncTimer = setTimeout(run, 650);
      }

      async function hydrateUserStateFromDisk() {
        const app = window.macstreamApp;
        if (!app || !app.engineUrl) return;
        try {
          const r = await fetch(`${app.engineUrl}/user-state`);
          if (!r.ok) return;
          const data = await r.json();
          const st = data && data.state;
          if (!st || typeof st !== 'object') return;

          if (st.watchProgressMap && typeof st.watchProgressMap === 'object') {
            for (const [k, rec] of Object.entries(st.watchProgressMap)) {
              if (!rec || !rec.key) continue;
              const cur = state.watchProgressMap[k];
              if (!cur || (rec.updatedAt || 0) > (cur.updatedAt || 0)) {
                state.watchProgressMap[k] = rec;
                CineDB.put('watch_progress', rec).catch(() => {});
              }
            }
          }
          if (st.libraryMap && typeof st.libraryMap === 'object') {
            for (const [imdbId, item] of Object.entries(st.libraryMap)) {
              if (!item || !item.imdbId) continue;
              if (!state.libraryMap[imdbId]) {
                state.libraryMap[imdbId] = item;
                CineDB.put('library', item).catch(() => {});
              }
            }
          }
          if (Array.isArray(st.iptvFavorites) && st.iptvFavorites.length && !state.iptvFavorites.length) {
            state.iptvFavorites = st.iptvFavorites;
            storage.set('macstream_favs', state.iptvFavorites);
          }
          if (Array.isArray(st.iptvPinnedCategories) && st.iptvPinnedCategories.length && !state.iptvPinnedCategories.length) {
            state.iptvPinnedCategories = st.iptvPinnedCategories;
            storage.set('ms_iptv_pinned_cats', state.iptvPinnedCategories);
          }
          if (st.introMap && typeof st.introMap === 'object') {
            for (const [ik, iv] of Object.entries(st.introMap)) {
              if (ik && iv && !localStorage.getItem(ik)) {
                try { localStorage.setItem(ik, JSON.stringify(iv)); } catch (e) {}
              }
            }
          }
          if (st.tmdbApiKey && !state.tmdbApiKey) {
            const decTmdb = decSecret(String(st.tmdbApiKey));
            if (decTmdb) {
              state.tmdbApiKey = decTmdb;
              writeSecret('macstream_tmdb_key', decTmdb);
            }
          }
          if (Array.isArray(st.addons) && st.addons.length && localStorage.getItem('macstream_addons') === null) {
            state.addons = mergeEssentialAddons(st.addons.map((a) => {
              if (a && typeof a.base === 'string' && a.base.startsWith(SECRET_PREFIX)) {
                return { ...a, base: decSecret(a.base) };
              }
              return a;
            }));
            saveAddons(state.addons);
          }
        } catch (e) {}
      }

      function exportUserBackupJson() {
        const payload = buildLocalUserStatePayload(true);
        delete payload.tmdbApiKey;
        delete payload.debridProvider;
        if (Array.isArray(payload.addons)) {
          payload.addons = payload.addons.map((a) => {
            if (!a || typeof a !== 'object') return a;
            let base = typeof a.base === 'string' ? a.base : '';
            if (base.startsWith(SECRET_PREFIX)) base = decSecret(base);
            if (DEBRID_CRED_RE.test(base)) {
              try {
                const u = new URL(base);
                base = `${u.protocol}//${u.host}`;
              } catch (e) {
                base = 'https://torrentio.strem.fun';
              }
              return { ...a, base, name: (a.name || 'Torrentio').replace(/\s*\([^)]*⚡\)/, '') };
            }
            return { ...a, base };
          });
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MacStream_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('💾 Backup Local (.json) exportado com sucesso!');
      }

      function importUserBackupJson(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const st = JSON.parse(String(reader.result || '{}'));
            if (!st || typeof st !== 'object') throw new Error('Formato inválido');
            if (st.watchProgressMap && typeof st.watchProgressMap === 'object') {
              for (const [k, rec] of Object.entries(st.watchProgressMap)) {
                if (rec && rec.key) {
                  state.watchProgressMap[k] = rec;
                  await CineDB.put('watch_progress', rec);
                }
              }
            }
            if (st.libraryMap && typeof st.libraryMap === 'object') {
              for (const [id, it] of Object.entries(st.libraryMap)) {
                if (it && it.imdbId) {
                  state.libraryMap[id] = it;
                  await CineDB.put('library', it);
                }
              }
            }
            if (Array.isArray(st.iptvFavorites)) {
              state.iptvFavorites = st.iptvFavorites;
              storage.set('macstream_favs', state.iptvFavorites);
            }
            if (Array.isArray(st.iptvPinnedCategories)) {
              state.iptvPinnedCategories = st.iptvPinnedCategories;
              storage.set('ms_iptv_pinned_cats', state.iptvPinnedCategories);
            }
            syncUserStateToDisk(true, true);
            renderAllSections();
            if (state.appMode === 'iptv') renderIptvChannelList();
            showToast('📂 Backup Local restaurado com sucesso!');
          } catch (e) {
            showToast('Ficheiro de backup inválido.');
          }
        };
        reader.readAsText(file);
      }

      // =======================================================================
      // 5B. HYBRID WORKSPACE SWITCHER (CINE STREMIO <-> LIVE TV IPTV)
      // =======================================================================
      function setAppMode(mode) {
        state.appMode = mode;
        if (mode === 'iptv') {
          el.cineWorkspaceView.classList.add('hidden');
          el.iptvWorkspaceView.classList.remove('hidden');
          el.toggleIptvSidebarBtn.classList.remove('hidden');

          el.switchModeIptvBtn.className = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white shadow-sm mac-transition flex items-center gap-1.5';
          el.switchModeCineBtn.className = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white mac-transition flex items-center gap-1.5';
          clearInterval(state.home.heroTimer);

          populateIptvCategories();
          setIptvViewMode(state.iptvViewMode || 'workspace', true);
          renderIptvChannelList();
          if (!state.iptvCurrentChannelId && state.iptvChannels.length > 0) {
            state.iptvCurrentChannelId = state.iptvChannels[0].id;
          }
          if (state.iptvCurrentChannelId && !el.iptvPrimaryVideo.getAttribute('src')) {
            playIptvChannelById(state.iptvCurrentChannelId);
          }
        } else {
          // Liberta imediatamente streams e processos FFmpeg remux ao voltar para Séries/Filmes
          destroyPrimaryIptvEngines();
          destroySecondaryIptvEngines();
          el.iptvPrimaryVideo.pause();
          el.iptvSecondaryVideo.pause();
          const sigPop = document.getElementById('iptvSignalPopover');
          if (sigPop) sigPop.classList.add('hidden');

          el.iptvWorkspaceView.classList.add('hidden');
          el.cineWorkspaceView.classList.remove('hidden');
          el.toggleIptvSidebarBtn.classList.add('hidden');

          el.switchModeCineBtn.className = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow-sm mac-transition flex items-center gap-1.5';
          el.switchModeIptvBtn.className = 'px-2.5 sm:px-3 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white mac-transition flex items-center gap-1.5';
          renderAllSections();
          restartHeroTimer();
        }
      }

