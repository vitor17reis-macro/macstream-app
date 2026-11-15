# MacStream v3.0.0

Aplicação nativa para **macOS** (Electron) que combina streaming P2P de filmes e séries (WebTorrent + Add-ons Stremio + OpenSubtitles v3) com um leitor completo de **IPTV** (Xtream Codes & M3U, EPG em tempo real, Multi-View e Auto-Remux FFmpeg), otimizada para correr a **60 FPS** no MacBook Air 13".

---

## Instalação / Execução

- **App empacotada (`.dmg` / `.app`)**:
  - Abre [dist/MacStream-3.0.0.dmg](dist/MacStream-3.0.0.dmg) e arrasta **MacStream** para a pasta **Aplicações** (ou executa diretamente `dist/mac/MacStream.app`).
- **Modo de desenvolvimento**:
  ```bash
  npm install
  npm start
  ```

---

## Funcionalidades Principais

- **Cine (Filmes & Séries)**:
  - Catálogo TMDB / Cinemeta com pesquisa global (`⌘K`), filtros por género/duração, **Continuar a ver** e Biblioteca pessoal.
  - 5 add-ons P2P ativos por defeito (*Torrentio*, *MediaFusion*, *Comet*, *ThePirateBay+*, *Peerflix*) + suporte a Magnet links, `.torrent` locais e serviços Debrid.
  - Cache em disco isolada por episódio/série (`Auto-75%`) e sincronização inteligente de legendas (`OpenSubtitles v3` + `ffsubsync`).
- **TV Direto (IPTV)**:
  - Suporte a **Xtream Codes** e listas **.M3U** com agrupamento automático de qualidades (`4K`, `FHD`, `HD`, `LOW`).
  - Auto-Remux FFmpeg (`.ts` → MP4), fallback automático `.m3u8` → `.ts`, Guia EPG em tempo real, **Duplo Ecrã (Multi-View)** e **Modo Teatro**.
- **Privacidade & Segurança**:
  - Cifragem de credenciais via Keychain do macOS (`safeStorage`), servidor local autenticado por token, proteção SSRF e **Modo Privado** na barra lateral.

---

## Build macOS

```bash
# Intel (x64) — MacStream.app
npm run dist

# Intel (x64) — Instalador .dmg
npx electron-builder --mac dmg --x64

# Apple Silicon (arm64)
npm run dist:arm
```

---

## Testes Automatizados (147 testes)

```bash
npm test            # 41 testes base (Motor, Segurança, Legendas, IPTV, Privacidade)
npm run test:extra  # 43 testes complementares (IPC, P2P, Quotas, Codecs, Cleanup)
npm run test:suite50 # 50 testes (P2P, Streaming/FFmpeg, Legendas, IPTV/EPG, UI)
npm run test:e2e    # 13 testes End-to-End na janela Electron
```
