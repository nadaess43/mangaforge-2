// MangaForge 2 — настольная версия: та же страница из booklet/ плюс встроенный загрузчик на скриптах FMD.
'use strict';

const { app, BrowserWindow, ipcMain, net, shell, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Downloader } = require('./engine');
const { updateScripts, scriptsPresent, lastCheck } = require('./engine/scripts');
const xquery = require('./engine/xquery');
const { Logger } = require('./logger');
// В установленной программе страница лежит в resources/booklet, при запуске из исходников — рядом с desktop/.
const BOOKLET = app.isPackaged ? path.join(process.resourcesPath, 'booklet') : path.join(__dirname, '..', 'booklet');
const I18N = require(path.join(BOOKLET, 'i18n.js'));

// Язык: выбранный в программе (settings.json) или язык системы. Папки по умолчанию называются по языку системы.
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const systemRu = /^ru/i.test(Intl.DateTimeFormat().resolvedOptions().locale || '');
let savedLang = null;
try { savedLang = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).lang; } catch { /* первый запуск */ }
I18N.setLang(savedLang || (systemRu ? 'ru' : 'en'));

let downloader;

// Журнал: «Документы\MangaForge\Логи», рядом с папкой манги — его легко найти и переслать
const logger = new Logger(path.join(app.getPath('documents'), 'MangaForge', systemRu ? 'Логи' : 'Logs'));
logger.translate = (s) => I18N.tr(s);
// Движок пишет (сообщение, данные, уровень); по умолчанию — подробности уровня DEBUG
const engineLog = (msg, data, level = 'DEBUG') => logger.write(level, 'движок', msg, data);
xquery.setLogger((msg, data) => logger.warn('xpath', msg, data));

process.on('uncaughtException', (e) => { logger.error('main', 'Необработанная ошибка', e); logger.flush(); });
process.on('unhandledRejection', (e) => logger.error('main', 'Необработанный отказ промиса', e));

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
  win.webContents.setWindowOpenHandler(({ url }) => { logger.info('окно', 'Открываю во внешнем браузере: ' + url); shell.openExternal(url); return { action: 'deny' }; });
  // Всё, что страница пишет в консоль, и её падения — тоже в журнал
  const LEVEL = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR', verbose: 'DEBUG', info: 'INFO', warning: 'WARN', error: 'ERROR' };
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    const lvl = LEVEL[e.level ?? level] || 'INFO';
    const msg = e.message ?? message;
    if (/Electron Security Warning/.test(msg)) return;
    const src = e.sourceId ?? sourceId;
    logger.write(lvl, 'консоль', msg + (src && lvl !== 'INFO' && lvl !== 'DEBUG' ? ` (${path.basename(String(src))}:${e.lineNumber ?? line})` : ''));
  });
  win.webContents.on('render-process-gone', (e, d) => logger.error('окно', 'Страница упала', d));
  win.webContents.on('did-fail-load', (e, code, desc, url) => logger.error('окно', `Не загрузилась страница ${url}: ${desc} (${code})`));
  win.webContents.on('did-finish-load', () => logger.info('окно', 'Страница загружена'));
  win.webContents.session.on('will-download', (e, item) => {
    logger.info('pdf', `Сохранение файла «${item.getFilename()}», ${item.getTotalBytes()} байт`);
    item.once('done', (ev, state) => {
      if (state === 'completed') logger.info('pdf', 'Сохранено: ' + item.getSavePath());
      else logger.warn('pdf', `Файл «${item.getFilename()}» не сохранён: ${state === 'cancelled' ? 'отменено' : state}`);
    });
  });
  win.on('unresponsive', () => logger.warn('окно', 'Окно не отвечает'));
  win.on('responsive', () => logger.info('окно', 'Окно снова отвечает'));
  win.loadFile(path.join(BOOKLET, 'index.html'));
  return win;
}

// Обработчик IPC с записью в журнал: что спросили, что ответили, сколько заняло, чем упало
const brief = (v) => {
  if (v === null || v === undefined) return String(v);
  if (v instanceof Uint8Array) return `<${v.length} байт>`;
  if (Array.isArray(v)) return `[${v.length} шт.]`;
  if (typeof v === 'object') return v.bytes ? `{${v.mime || ''} ${v.bytes.length} байт}` : `{${Object.keys(v).slice(0, 8).join(', ')}}`;
  const s = String(v);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
};
function handle(name, fn, { level = 'INFO', describe } = {}) {
  ipcMain.handle(name, async (e, ...args) => {
    const t0 = Date.now();
    try {
      const r = await fn(e, ...args);
      logger.write(level, 'ipc', `${name}(${args.map(brief).join(', ')}) → ${describe ? describe(r, ...args) : brief(r)} за ${Date.now() - t0} мс`);
      return r;
    } catch (err) {
      logger.error('ipc', `${name}(${args.map(brief).join(', ')}) упал через ${Date.now() - t0} мс`, err);
      throw err;
    }
  });
}

app.whenReady().then(async () => {
  logger.info('старт', '══════════ MangaForge 2 запущен ══════════', {
    версия: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    система: `${os.type()} ${os.release()} ${os.arch()}`, память: `${Math.round(os.totalmem() / 2 ** 30)} ГБ`,
    процессор: (os.cpus()[0] || {}).model, язык: app.getLocale(), папка_программы: __dirname, данные: app.getPath('userData'),
    журнал: logger.dir, аргументы: process.argv.slice(1),
  });

  // Сетевой стек Chromium: те же сертификаты, прокси и сжатие, что у браузера
  const fetchImpl = (url, opts) => net.fetch(url, { ...opts, bypassCustomProtocolHandlers: true });
  const scriptsDir = path.join(app.getPath('userData'), 'lua');
  downloader = new Downloader({ scriptsDir, fetchImpl, manualRedirects: false, log: engineLog });

  // Скрипты сайтов: при первом запуске скачать, потом раз в сутки обновлять в фоне
  const scripts = { ready: scriptsPresent(scriptsDir), done: 0, total: 0, error: '' };
  const updating = (async () => {
    const last = lastCheck(scriptsDir);
    if (scripts.ready && Date.now() - last < 24 * 3600 * 1000) {
      logger.info('скрипты', `Скрипты сайтов на месте, проверены ${new Date(last).toLocaleString('ru-RU')}`);
      return;
    }
    logger.info('скрипты', scripts.ready ? 'Проверяю обновления скриптов сайтов FMD' : 'Скачиваю скрипты сайтов FMD (первый запуск)');
    const t0 = Date.now();
    try {
      await updateScripts({ dir: scriptsDir, fetchImpl, log: (m) => logger.info('скрипты', m), onProgress: (d, t) => { scripts.done = d; scripts.total = t; } });
      logger.info('скрипты', `Готово за ${Math.round((Date.now() - t0) / 1000)} с`);
    } catch (e) {
      scripts.error = e.message;
      logger.error('скрипты', 'Обновление скриптов не удалось', e);
    }
    if (!scripts.ready) downloader.index = null;
    scripts.ready = scriptsPresent(scriptsDir);
  })();
  const whenReady = () => (scripts.ready ? Promise.resolve() : updating);

  handle('dl:status', () => scripts, { level: 'DEBUG' });
  handle('dl:info', async (e, url) => { await whenReady(); return downloader.info(url); }, {
    describe: (r) => `${r.site}: «${r.title}», ${r.chapters.length} глав${r.chapters.length ? ` (первая «${r.chapters[0].name}», последняя «${r.chapters[r.chapters.length - 1].name}»)` : ''}, код ${r.code}`,
  });
  handle('dl:pages', async (e, url, link) => { await whenReady(); return downloader.pages(url, link); }, {
    describe: (r) => `${r.pages.length} страниц${r.ok ? '' : ', скрипт вернул false'}${r.pages[0] ? `, первая ${r.pages[0]}` : ''}`,
  });
  handle('dl:image', async (e, url, link, img) => {
    await whenReady();
    const r = await downloader.image(url, link, img);
    return r && r.bytes.length ? { bytes: new Uint8Array(r.bytes), mime: r.mime } : null;
  }, { level: 'DEBUG', describe: (r) => (r ? `${r.mime} ${r.bytes.length} байт` : 'НЕТ КАРТИНКИ') });
  handle('dl:sites', async () => { await whenReady(); return scripts.ready ? downloader.sites() : []; }, { describe: (r) => `${r.length} сайтов` });

  // Папка для скачанной манги: выбранная человеком или «Документы\MangaForge\Манга»
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
  const downloadDir = () => readSettings().downloadDir || path.join(app.getPath('documents'), 'MangaForge', systemRu ? 'Манга' : 'Manga');
  logger.info('старт', 'Папка загрузок: ' + downloadDir());
  // Путь внутри папки загрузок; выйти за её пределы нельзя
  const inside = (rel) => {
    const root = path.resolve(downloadDir());
    const full = path.resolve(root, ...String(rel || '').split('/').filter(Boolean));
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Путь вне папки загрузок');
    return full;
  };
  const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

  handle('dl:folder', () => downloadDir(), { level: 'DEBUG' });
  handle('dl:pickFolder', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: I18N.t('Куда скачивать мангу'), defaultPath: downloadDir(), properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), downloadDir: r.filePaths[0] }));
    return r.filePaths[0];
  });
  handle('dl:openFolder', (e, rel) => {
    const p = inside(rel);
    fs.mkdirSync(p, { recursive: true });
    return shell.openPath(p);
  });
  handle('dl:save', (e, rel, bytes) => {
    const p = inside(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(bytes));
  }, { level: 'DEBUG', describe: () => 'записано' });
  // Уже скачанная глава: картинки из её папки
  handle('dl:readChapter', (e, rel) => {
    const dir = inside(rel);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => IMAGE_RE.test(n)).sort().map((name) => ({ name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
  }, { describe: (r) => `${r.length} картинок с диска` });
  handle('dl:hasChapters', (e, rels) => rels.map((rel) => {
    try { const d = inside(rel); return fs.existsSync(d) && fs.readdirSync(d).some((n) => IMAGE_RE.test(n)); } catch { return false; }
  }), { describe: (r) => `уже скачано ${r.filter(Boolean).length} из ${r.length}` });

  // Журнал для страницы: запись, последние строки, открыть файл или папку
  ipcMain.on('log:write', (e, level, source, msg, data) => logger.write(level, source, msg, data));
  // Язык интерфейса: журнал и диалоги переходят на него, выбор запоминается
  ipcMain.on('app:lang', (e, lang) => {
    if (lang === I18N.lang && lang === readSettings().lang) return;
    I18N.setLang(lang);
    try { fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), lang })); } catch { /* не страшно */ }
    logger.info('старт', 'Язык интерфейса: ' + lang);
  });
  ipcMain.handle('log:recent', () => logger.lines);
  ipcMain.handle('log:openFile', () => { logger.open(); return logger.flush().then(() => shell.openPath(logger.file)); });
  ipcMain.handle('log:openFolder', () => shell.openPath(logger.dir));
  ipcMain.handle('log:path', () => logger.file || logger.dir);
  logger.listeners.add((entry) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('log:entry', entry);
  });

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
    await logger.flush();
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('child-process-gone', (e, d) => logger.error('main', 'Упал служебный процесс', d));
app.on('before-quit', () => { logger.info('старт', '══════════ Выход ══════════'); logger.flush(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
