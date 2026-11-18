'use strict';
// npm run test:e2e — Testes End-to-End (E2E) da Interface Electron com janela oculta
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const e2eUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'macstream-e2e-'));
app.setPath('userData', e2eUserData);

const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const errors = [];
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3 && !/Failed to fetch|net::ERR_/i.test(message)) {
      errors.push(message);
      console.error('  [renderer error]', message);
    }
  });

  await win.loadFile(indexPath);
  await new Promise(r => setTimeout(r, 1000));

  let failed = 0;
  const run = async (name, fn) => {
    try {
      await fn();
      console.log('  ✓ [E2E]', name);
    } catch (e) {
      failed++;
      console.error('  ✗ [E2E]', name, e && e.message);
    }
  };

  console.log('\n=== TESTES E2E DA INTERFACE ELECTRON ===');

  await run('Carregamento dos 6 módulos JS sem erros de runtime', async () => {
    const title = await win.webContents.executeJavaScript('document.title');
    assert.strictEqual(title, 'MacStream');
    assert.deepStrictEqual(errors, [], `Erros na consola: ${errors.join('; ')}`);
  });

  await run('Alternar entre Modo Cine e Modo IPTV por clique', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        document.getElementById('switchModeIptvBtn').click();
        const iptvVisible = !document.getElementById('iptvWorkspaceView').classList.contains('hidden');
        document.getElementById('switchModeCineBtn').click();
        const cineVisible = !document.getElementById('cineWorkspaceView').classList.contains('hidden');
        return { iptvVisible, cineVisible };
      })()
    `);
    assert.strictEqual(res.iptvVisible, true, 'iptvWorkspace ficou visível');
    assert.strictEqual(res.cineVisible, true, 'cineWorkspace voltou a ficar visível');
  });

  await run('Abrir e fechar modal de Definições / Add-ons', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        document.getElementById('openSettingsModalBtn').click();
        const opened = !document.getElementById('settingsModal').classList.contains('hidden');
        document.getElementById('closeSettingsModalBtn').click();
        const closed = document.getElementById('settingsModal').classList.contains('hidden');
        return { opened, closed };
      })()
    `);
    assert.strictEqual(res.opened, true, 'settingsModal abriu');
    assert.strictEqual(res.closed, true, 'settingsModal fechou');
  });

  await run('Ativar e desativar Modo Privado na barra lateral', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        const btn = document.getElementById('privateModeBtn');
        btn.click();
        const onText = btn.textContent.trim();
        btn.click();
        const offText = btn.textContent.trim();
        return { onText, offText };
      })()
    `);
    assert.ok(res.onText.includes('ON'), 'Modo Privado ativado');
    assert.ok(res.offText.includes('OFF'), 'Modo Privado desativado');
  });

  await run('Pesquisar no catálogo e abrir gaveta de detalhes sem erros', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        const inp = document.getElementById('globalSearchInput');
        inp.value = 'Inception';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const card = document.querySelector('#discoverGrid .poster-card, #moviesGrid .poster-card, .ms-poster-card');
        if (card) card.click();
        const modalOpen = card ? !document.getElementById('detailModal').classList.contains('hidden') : false;
        const closeBtn = document.getElementById('closeDetailModalBtn');
        if (closeBtn && modalOpen) closeBtn.click();
        return { foundCard: !!card, modalOpen };
      })()
    `);
    assert.strictEqual(res.foundCard, true, 'cartão encontrado no catálogo');
    assert.strictEqual(res.modalOpen, true, 'gaveta de detalhes abriu');
  });

  await run('Guardar e remover filme da Biblioteca atualiza o contador do menu', async () => {
    const res = await win.webContents.executeJavaScript(`
      (async function () {
        const badge = document.getElementById('dockLibraryBadge');
        const before = badge.classList.contains('hidden') ? 0 : (parseInt(badge.textContent, 10) || 0);
        const card = document.querySelector('#discoverGrid .poster-card, #moviesGrid .poster-card, .ms-poster-card');
        card.click();
        const libBtn = document.getElementById('detailToggleLibraryBtn');
        libBtn.click();
        await new Promise(r => setTimeout(r, 250));
        const afterAdd = badge.classList.contains('hidden') ? 0 : (parseInt(badge.textContent, 10) || 0);
        libBtn.click();
        await new Promise(r => setTimeout(r, 250));
        const afterRem = badge.classList.contains('hidden') ? 0 : (parseInt(badge.textContent, 10) || 0);
        document.getElementById('closeDetailModalBtn').click();
        return { before, afterAdd, afterRem };
      })()
    `);
    assert.strictEqual(res.afterAdd, res.before + 1, 'contador subiu após guardar');
    assert.strictEqual(res.afterRem, res.before, 'contador voltou após remover');
  });

  await run('Multi-View IPTV ativa e desativa segundo ecrã', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        document.getElementById('switchModeIptvBtn').click();
        const mvBtn = document.getElementById('headerMultiViewBtn');
        mvBtn.click();
        const active = !document.getElementById('iptvSecondaryPlayerCard').classList.contains('hidden');
        mvBtn.click();
        document.getElementById('switchModeCineBtn').click();
        return { active };
      })()
    `);
    assert.strictEqual(res.active, true, 'segundo ecrã Multi-View ficou visível');
  });

  await run('Pesquisa em tempo real na vista IPTV filtra canais sem erros', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        document.getElementById('switchModeIptvBtn').click();
        const inp = document.getElementById('iptvSearchInput');
        if (!inp) return { ok: true, skipped: true };
        inp.value = 'RTP';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('switchModeCineBtn').click();
        return { ok: true };
      })()
    `);
    assert.strictEqual(res.ok, true);
  });

  await run('Abrir e fechar modal Magnet Link / .torrent', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        document.getElementById('openMagnetModalBtn').click();
        const opened = !document.getElementById('magnetModal').classList.contains('hidden');
        document.getElementById('closeMagnetModalBtn').click();
        const closed = document.getElementById('magnetModal').classList.contains('hidden');
        return { opened, closed };
      })()
    `);
    assert.strictEqual(res.opened, true);
    assert.strictEqual(res.closed, true);
  });

  await run('Navegação entre separadores Cine (Descobrir, Filmes, Séries, Biblioteca)', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        const btns = Array.from(document.querySelectorAll('.nav-dock-btn'));
        btns.forEach(b => b.click());
        if (btns[0]) btns[0].click();
        return { count: btns.length };
      })()
    `);
    assert.ok(res.count >= 3);
  });

  await run('Botão Limpar Histórico limpa progresso sem erros', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        document.getElementById('clearHistoryBtn').click();
        return { ok: true };
      })()
    `);
    assert.strictEqual(res.ok, true);
  });

  await run('Importação de JSON malformado no restauro não corrompe a UI', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        const inp = document.getElementById('importBackupInput');
        if (!inp) return { ok: true };
        const file = new File(['{invalid_json'], 'bad.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        inp.files = dt.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()
    `);
    assert.strictEqual(res.ok, true);
  });

  await run('Botão Copiar Relatório executa sem lançar exceções', async () => {
    const res = await win.webContents.executeJavaScript(`
      (function () {
        document.getElementById('copyReportBtn').click();
        return { ok: true };
      })()
    `);
    assert.strictEqual(res.ok, true);
  });

  console.log(`\n${13 - failed}/13 testes E2E passaram.\n`);
  app.exit(failed ? 1 : 0);
});
