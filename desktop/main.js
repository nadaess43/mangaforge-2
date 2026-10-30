// MangaForge 2 — настольная версия: та же страница из booklet/ плюс встроенный загрузчик на скриптах FMD.
'use strict';

const { app, BrowserWindow, ipcMain, net, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { Downloader } = require('./engine');
const { updateScripts, scriptsPresent, lastCheck } = require('./engine/scripts');

let downloader;

function log(m) { if (process.env.MF_DEBUG) console.log(m); }

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'MangaForge 2',
    autoHideMenuBar: true,
    backgroundColor: '#f4f2ee',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  // Ссылки наружу — в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, '..', 'booklet', 'index.html'));
  return win;
}

app.whenReady().then(async () => {
  // Сетевой стек Chromium: те же сертификаты, прокси и сжатие, что у браузера
  const fetchImpl = (url, opts) => net.fetch(url, { ...opts, bypassCustomProtocolHandlers: true });
  const scriptsDir = path.join(app.getPath('userData'), 'lua');
  downloader = new Downloader({ scriptsDir, fetchImpl, manualRedirects: false, log });

  // Скрипты сайтов: при первом запуске скачать, потом раз в сутки обновлять в фоне
  const scripts = { ready: scriptsPresent(scriptsDir), done: 0, total: 0, error: '' };
  const updating = (async () => {
    if (scripts.ready && Date.now() - lastCheck(scriptsDir) < 24 * 3600 * 1000) return;
    try {
      await updateScripts({ dir: scriptsDir, fetchImpl, log, onProgress: (d, t) => { scripts.done = d; scripts.total = t; } });
    } catch (e) {
      scripts.error = e.message;
      log('Обновление скриптов: ' + e.message);
    }
    if (!scripts.ready) downloader.index = null;
    scripts.ready = scriptsPresent(scriptsDir);
  })();
  const whenReady = () => (scripts.ready ? Promise.resolve() : updating);

  ipcMain.handle('dl:status', () => scripts);
  ipcMain.handle('dl:info', async (e, url) => { await whenReady(); return downloader.info(url); });
  ipcMain.handle('dl:pages', async (e, url, link) => { await whenReady(); return downloader.pages(url, link); });
  ipcMain.handle('dl:image', async (e, url, link, img) => {
    await whenReady();
    const r = await downloader.image(url, link, img);
    return r && r.bytes.length ? { bytes: new Uint8Array(r.bytes), mime: r.mime } : null;
  });
  ipcMain.handle('dl:sites', async () => { await whenReady(); return scripts.ready ? downloader.sites() : []; });

  // Папка для скачанной манги: выбранная человеком или «Документы\MangaForge\Манга»
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
  const downloadDir = () => readSettings().downloadDir || path.join(app.getPath('documents'), 'MangaForge', 'Манга');
  // Путь внутри папки загрузок; выйти за её пределы нельзя
  const inside = (rel) => {
    const root = path.resolve(downloadDir());
    const full = path.resolve(root, ...String(rel || '').split('/').filter(Boolean));
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Путь вне папки загрузок');
    return full;
  };
  const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

  ipcMain.handle('dl:folder', () => downloadDir());
  ipcMain.handle('dl:pickFolder', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Куда скачивать мангу', defaultPath: downloadDir(), properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), downloadDir: r.filePaths[0] }));
    return r.filePaths[0];
  });
  ipcMain.handle('dl:openFolder', (e, rel) => {
    const p = inside(rel);
    fs.mkdirSync(p, { recursive: true });
    return shell.openPath(p);
  });
  ipcMain.handle('dl:save', (e, rel, bytes) => {
    const p = inside(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(bytes));
  });
  // Уже скачанная глава: картинки из её папки
  ipcMain.handle('dl:readChapter', (e, rel) => {
    const dir = inside(rel);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => IMAGE_RE.test(n)).sort().map((name) => ({ name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
  });
  ipcMain.handle('dl:hasChapters', (e, rels) => rels.map((rel) => {
    try { const d = inside(rel); return fs.existsSync(d) && fs.readdirSync(d).some((n) => IMAGE_RE.test(n)); } catch { return false; }
  }));

  // Проверка без окна: electron . --selftest <ссылка>
  const i = process.argv.indexOf('--selftest');
  if (i > 0) {
    const url = process.argv[i + 1];
    try {
      await whenReady();
      const info = await downloader.info(url);
      console.log(JSON.stringify({ site: info.site, title: info.title, chapters: info.chapters.length, first: info.chapters[0] }));
      if (info.chapters[0]) {
        const p = await downloader.pages(url, info.chapters[0].link);
        console.log('pages', p.pages.length, p.pages[0]);
        if (p.pages[0]) { const img = await downloader.image(url, info.chapters[0].link, p.pages[0]); console.log('image', img && img.mime, img && img.bytes.length); }
      }
    } catch (e) { console.log('ERR', e.message); }
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
