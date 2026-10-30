// Выполнение скриптов сайтов FMD (Lua 5.4 через wasmoon) с API, совместимым с FMD.
'use strict';

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const vm = require('vm');
const { LuaFactory } = require('wasmoon');
const { createTXQuery } = require('./xquery');
const { createHttp, valuesMap } = require('./http');

// wasmoon падает на не-ASCII переменных окружения (путь к программе с кириллицей)
const factory = new LuaFactory(undefined, { _: 'lua', HOME: '/', PWD: '/' });

// ---------- TStrings ----------
// wasmoon передаёт индекс Lua n как ключ n-1; в FMD списки индексируются с 0.
function stringList() {
  const items = [];
  const api = {
    Add: (s) => { items.push(s === undefined || s === null ? '' : String(s)); return items.length - 1; },
    AddText: (s) => { for (const l of String(s ?? '').split(/\r?\n/)) items.push(l); },
    Get: (i) => items[Number(i)] ?? '',
    Set: (i, s) => { items[Number(i)] = String(s ?? ''); },
    Delete: (i) => { items.splice(Number(i), 1); },
    Clear: () => { items.length = 0; },
    Reverse: () => { items.reverse(); },
    Sort: () => { items.sort(); },
    IndexOf: (s) => items.indexOf(String(s)),
    GetCount: () => items.length,
    get Count() { return items.length; },
    get Text() { return items.join('\r\n'); },
    set Text(t) { items.length = 0; if (t !== '') for (const l of String(t ?? '').split(/\r?\n/)) items.push(l); },
    get CommaText() { return items.join(','); },
    toArray: () => items.slice(),
  };
  return new Proxy(api, {
    get: (t, k) => {
      if (typeof k === 'string' && /^-?\d+$/.test(k)) return items[Number(k) + 1] ?? '';
      return t[k];
    },
    set: (t, k, v) => {
      if (typeof k === 'string' && /^-?\d+$/.test(k)) { items[Number(k) + 1] = String(v ?? ''); return true; }
      t[k] = v;
      return true;
    },
  });
}

// Хранилище как TStringsStorage: отсутствующее значение — ''
function storage() {
  return new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : t[k] ?? ''), set: (t, k, v) => { t[k] = v === null || v === undefined ? '' : String(v); return true; } });
}

// ---------- Вспомогательные функции FMD ----------
// Порт SplitURL из httpsendthread.pas
function splitURL(aurl) {
  let url = String(aurl ?? '').trim();
  if (!url) return { host: '', path: '' };
  if (url[0] === '/') {
    if (url.length === 1) return { host: '', path: '' };
    if (url[1] !== '/') return { host: '', path: url };
  }
  const posChar = (c, s, from = 0, esc = '') => { for (let i = from; i < s.length; i++) { if (esc.includes(s[i])) break; if (s[i] === c) return i; } return -1; };
  const clean = (s) => s.replace(/^[.:/]+/, '');
  let proto = '', port = '', host = '';
  let p = posChar(':', url, 0, '/');
  if (p >= 0 && p + 2 < url.length && url.substr(p + 1, 2) === '//') { proto = url.slice(0, p); url = url.slice(p + 3); p = posChar(':', url, 0, '/'); }
  if (p >= 0 && p < url.length - 1 && /\d/.test(url[p + 1])) {
    let q = p + 1;
    while (q < url.length && /\d/.test(url[q])) q++;
    port = url.slice(p + 1, q);
    url = url.slice(0, p) + url.slice(q);
  }
  url = clean(url);
  p = posChar('.', url, 0, '/');
  let q = posChar('/', url);
  if (p >= 0 && p < url.length - 1) {
    if (q >= 0 && p < q) { host = url.slice(0, q); url = clean(url.slice(q)); }
    else if (q < 0) { const q2 = posChar('.', url, p + 1); if (q2 >= 0 && q2 < url.length - 1) { host = url; url = ''; } }
  }
  if (!host && url && (proto || port)) { host = url; url = ''; }
  if (host) { host = (proto || 'https') + '://' + host + (port ? ':' + port : ''); }
  return { host, path: url ? '/' + url : '' };
}

const removeURLDelim = (s) => String(s).replace(/\/+$/, '');
function maybeFillHost(host, url) {
  const { host: h, path: p } = splitURL(url);
  return !h && p ? removeURLDelim(host) + p : String(url ?? '');
}

function mangaInfoStatusIfPos(s, ongoing = 'ongoing', completed = 'complete', hiatus = 'hiatus', cancelled = 'cancel') {
  const has = (pat) => pat && String(pat).split('|').some((w) => w && String(s).toLowerCase().includes(w.toLowerCase()));
  if (has(ongoing)) return '1';
  if (has(completed)) return '0';
  if (has(hiatus)) return '2';
  if (has(cancelled)) return '3';
  return '';
}

const getBetween = (a, b, v) => { v = String(v); const i = v.indexOf(a); if (i < 0) return ''; const j = v.indexOf(b, i + a.length); return j < 0 ? '' : v.slice(i + a.length, j); };
const separateLeft = (v, d) => { v = String(v); const i = v.indexOf(d); return i < 0 ? v : v.slice(0, i); };
const separateRight = (v, d) => { v = String(v); const i = v.indexOf(d); return i < 0 ? v : v.slice(i + d.length); };

// ---------- fmd.crypto (основное) ----------
const hash = (alg, s) => nodeCrypto.createHash(alg).update(Buffer.from(String(s), 'latin1')).digest();
const latin = (b) => Buffer.from(b).toString('latin1');
const cryptoLib = {
  EncodeURLElement: (s) => encodeURIComponent(String(s ?? '')).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()),
  EncodeURL: (s) => encodeURI(String(s ?? '')),
  DecodeURL: (s) => { try { return decodeURIComponent(String(s ?? '').replace(/\+/g, ' ')); } catch { return String(s ?? ''); } },
  HTMLEncode: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  HTMLDecode: (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&'),
  EncodeBase64: (s) => Buffer.from(String(s ?? ''), 'latin1').toString('base64'),
  DecodeBase64: (s) => Buffer.from(String(s ?? ''), 'base64').toString('latin1'),
  EncodeBase64URL: (s) => Buffer.from(String(s ?? ''), 'latin1').toString('base64url'),
  DecodeBase64URL: (s) => Buffer.from(String(s ?? ''), 'base64url').toString('latin1'),
  MD5: (s) => latin(hash('md5', s)), MD5Hex: (s) => hash('md5', s).toString('hex'),
  SHA1: (s) => latin(hash('sha1', s)), SHA1Hex: (s) => hash('sha1', s).toString('hex'),
  SHA256: (s) => latin(hash('sha256', s)), SHA256Hex: (s) => hash('sha256', s).toString('hex'),
  SHA512: (s) => latin(hash('sha512', s)), SHA512Hex: (s) => hash('sha512', s).toString('hex'),
  HMAC_SHA256: (k, s) => latin(nodeCrypto.createHmac('sha256', Buffer.from(String(k), 'latin1')).update(Buffer.from(String(s), 'latin1')).digest()),
  HMAC_SHA256Hex: (k, s) => nodeCrypto.createHmac('sha256', Buffer.from(String(k), 'latin1')).update(Buffer.from(String(s), 'latin1')).digest('hex'),
  StrToHexStr: (s) => Buffer.from(String(s), 'latin1').toString('hex'),
  HexToStr: (s) => Buffer.from(String(s), 'hex').toString('latin1'),
  CRC32: (s) => { let c = ~0; for (const b of Buffer.from(String(s), 'latin1')) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; },
};
// Старые скрипты зовут DecodeBase(...) как DecodeBase64
cryptoLib.DecodeBase = cryptoLib.DecodeBase64;
cryptoLib.EncodeBase = cryptoLib.EncodeBase64;

// ---------- Скрипт сайта ----------
const PRELUDE = `
no_error, net_problem, information_not_found = 0, 1, 2
asUnknown, asChecking, asValid, asInvalid = 0, 1, 2, 3
local mf = __mf
table.insert(package.searchers, 2, function(name)
  local js = mf.lib(name)
  if js ~= nil then return function() return js end end
  local src = mf.source(name)
  if src == nil or src == '' then return '\\n\\tno MangaForge script ' .. name end
  return assert(load(src, '@' .. name))
end)
function sleep(ms) mf.sleep(ms or 0):await() end
function Delay() mf.sleep(250):await() end
function print(...) local t = {} for i = 1, select('#', ...) do t[#t + 1] = tostring((select(i, ...))) end mf.log(table.concat(t, ' ')) end
function MakeHTTP(H)
  return setmetatable({
    GET = function(u) return H.getAsync(u):await() end,
    POST = function(u, d) return H.postAsync(u, d):await() end,
    HEAD = function(u) return H.headAsync(u):await() end,
    XHR = function(u) H.Headers.Values['X-Requested-With'] = 'XMLHttpRequest' return H.getAsync(u):await() end,
    Request = function(m, u) if m == 'POST' then return H.postAsync(u, ''):await() end return H.getAsync(u):await() end,
  }, { __index = function(_, k) return H[k] end, __newindex = function(_, k, v) H[k] = v end })
end
`;

class SiteScript {
  constructor({ file, scriptsDir, log, fetchImpl, jar, options, manualRedirects }) {
    this.manualRedirects = manualRedirects !== false;
    this.file = file;
    this.scriptsDir = scriptsDir;
    this.log = log || (() => {});
    this.fetchImpl = fetchImpl;
    this.jar = jar;
    this.options = options || {};
    this.modules = [];
    this.storage = storage();
    this.queue = Promise.resolve();
  }

  readSource(name) {
    // templates.X → templates/X.lua, utils.json → utils/json.lua
    const rel = String(name).replace(/\./g, '/') + '.lua';
    const full = path.join(this.scriptsDir, rel);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  }

  // Свой вариант doString: в wasmoon 1.16 doString оставляет результат на главном стеке,
  // стек переполняется через несколько десятков вызовов и портит память.
  async exec(code) {
    const g = this.lua.global;
    const thread = g.newThread();
    const index = g.getTop();
    try {
      thread.loadString(code);
      const result = await thread.run(0);
      return result[0];
    } finally {
      g.setTop(index - 1);
    }
  }

  async load() {
    this.lua = await factory.createEngine();
    const self = this;
    const env = { Directory: '', ExeName: 'mangaforge', Version: '2.0.0', Revision: '0', LuaDirectory: this.scriptsDir, SelectedLanguage: 'ru_RU' };
    const libs = {
      'fmd.crypto': cryptoLib,
      'fmd.env': env,
      'fmd.duktape': { ExecJS: (src) => { try { const r = vm.runInNewContext(String(src), {}, { timeout: 5000 }); return r === undefined || r === null ? '' : String(r); } catch (e) { self.log('ExecJS: ' + e.message); return ''; } } },
      'fmd.logger': { send: (s) => self.log(String(s)), SendError: (s) => self.log(String(s)), SendWarning: (s) => self.log(String(s)) },
    };
    this.lua.global.set('__mf', {
      lib: (name) => libs[name],
      source: (name) => this.readSource(name),
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(Number(ms) || 0, 10000))),
      log: (s) => this.log(String(s)),
    });
    const G = this.lua.global;
    G.set('CreateTXQuery', (input) => createTXQuery(input, (m) => this.log(m)));
    G.set('MaybeFillHost', maybeFillHost);
    G.set('MangaInfoStatusIfPos', mangaInfoStatusIfPos);
    G.set('Trim', (s, chars) => (chars ? String(s).replace(new RegExp(`^[${chars.replace(/[\]\\^-]/g, '\\$&')}]+|[${chars.replace(/[\]\\^-]/g, '\\$&')}]+$`, 'g'), '') : String(s ?? '').trim()));
    G.set('GetBetween', getBetween);
    G.set('SeparateLeft', separateLeft);
    G.set('SeparateRight', separateRight);
    G.set('EncodeURLElement', cryptoLib.EncodeURLElement);
    G.set('DecodeURL', cryptoLib.DecodeURL);
    G.set('HTMLDecode', cryptoLib.HTMLDecode);
    G.set('TStringList', { Create: () => stringList(), New: () => stringList() });
    G.set('CreateStringList', () => stringList());
    G.set('NewWebsiteModule', () => this.newModule());
    await this.exec(PRELUDE);
    await this.exec(fs.readFileSync(this.file, 'utf8'));
    await this.exec('if Init then Init() end');
    return this.modules;
  }

  newModule() {
    const options = {};
    const m = {
      ID: '', Name: '', RootURL: '', Category: '', TotalDirectory: 1, SortedList: false,
      AccountSupport: false, FavoriteAvailable: true, DynamicPageLink: false, MaxTaskLimit: 0, MaxConnectionLimit: 0,
      Storage: this.storage,
      Account: { Enabled: false, Status: 0, Username: '', Password: '', Cookies: '' },
      CurrentDirectoryIndex: 0,
      AddOptionCheckBox: (name, caption, def) => { options[name] = this.options[name] ?? Boolean(def); },
      AddOptionEdit: (name, caption, def) => { options[name] = this.options[name] ?? (def ?? ''); },
      AddOptionSpinEdit: (name, caption, def) => { options[name] = this.options[name] ?? Number(def ?? 0); },
      AddOptionComboBox: (name, caption, items, def) => { options[name] = this.options[name] ?? Number(def ?? 0); },
      GetOption: (name) => options[name],
      ClearCookies: () => {},
      AddServerCookies: () => {},
      options,
    };
    this.modules.push(m);
    return m;
  }

  // Вызвать обработчик модуля (имя функции хранится в m.OnGetInfo и т. п.).
  // Глобальные MODULE/HTTP/TASK общие на весь Lua, поэтому вызовы идут строго по очереди.
  call(module, handler, globals) {
    const fn = module[handler];
    if (!fn) return Promise.resolve(undefined);
    const run = this.queue.then(() => {
      const G = this.lua.global;
      G.set('MODULE', module);
      for (const [k, v] of Object.entries(globals)) G.set(k, v);
      return this.exec(`${globals.__http ? 'HTTP = MakeHTTP(__http) ' : ''}return ${fn}()`);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  newHttp() {
    return createHttp({ fetchImpl: this.fetchImpl, jar: this.jar, log: this.log, manualRedirects: this.manualRedirects });
  }

  close() { if (this.lua) this.lua.global.close(); this.lua = null; }
}

// ---------- Операции загрузчика ----------
function makeMangaInfo(url) {
  return {
    URL: url, Title: '', AltTitles: '', CoverLink: '', Authors: '', Artists: '', Genres: '', Status: '', Summary: '',
    NumChapter: 0, Website: '', ChapterLinks: stringList(), ChapterNames: stringList(),
  };
}

function makeTask(chapterLink, chapterName) {
  return {
    PageLinks: stringList(), PageContainerLinks: stringList(), PageNumber: 0,
    ChapterLinks: (() => { const l = stringList(); l.Add(chapterLink); return l; })(),
    ChapterNames: (() => { const l = stringList(); l.Add(chapterName || ''); return l; })(),
    CurrentDownloadChapterPtr: 0,
    Link: chapterLink,
  };
}

async function getInfo(script, module, url) {
  const info = makeMangaInfo(url);
  const http = script.newHttp();
  const code = await script.call(module, 'OnGetInfo', { MANGAINFO: info, __http: http, URL: url });
  const links = info.ChapterLinks.toArray();
  const names = info.ChapterNames.toArray();
  // Как в uData.pas: обрезка, удаление повторов, ссылки без хоста
  const seen = new Set();
  const chapters = [];
  links.forEach((l, i) => {
    const link = l.trim();
    if (!link || seen.has(link.toLowerCase())) return;
    seen.add(link.toLowerCase());
    const { host, path: p } = splitURL(link);
    // Ссылка без хоста всегда с «/» в начале: скрипты склеивают API_URL .. URL
    chapters.push({ link: host ? p || link : link.replace(/^(?![/?#])/, '/'), name: (names[i] || '').trim().replace(/\s+/g, ' ') });
  });
  return {
    code: Number(code ?? 0),
    title: String(info.Title || '').trim() || 'N/A',
    altTitles: String(info.AltTitles || '').trim(),
    cover: info.CoverLink ? maybeFillHost(module.RootURL, info.CoverLink) : '',
    authors: String(info.Authors || '').trim(),
    artists: String(info.Artists || '').trim(),
    genres: String(info.Genres || '').trim(),
    summary: String(info.Summary || '').trim(),
    chapters,
  };
}

async function getPages(script, module, chapterLink) {
  const task = makeTask(chapterLink);
  const http = script.newHttp();
  const ok = await script.call(module, 'OnGetPageNumber', { TASK: task, __http: http, URL: chapterLink });
  let pages = task.PageLinks.toArray().map((s) => s.trim()).filter(Boolean);
  // Сайты, где сначала собираются страницы-контейнеры, а картинка достаётся отдельно
  const containers = task.PageContainerLinks.toArray();
  if (module.OnGetImageURL && (pages.length === 0 || pages.length < containers.length)) {
    const total = Math.max(Number(task.PageNumber) || 0, containers.length);
    while (task.PageLinks.Count < total) task.PageLinks.Add('');
    for (let i = 0; i < total; i++) {
      const h = script.newHttp();
      await script.call(module, 'OnGetImageURL', { TASK: task, __http: h, URL: containers[i] || '', WORKID: i });
    }
    pages = task.PageLinks.toArray().map((s) => s.trim()).filter(Boolean);
  }
  return { ok: ok !== false, pages: pages.map((p) => maybeFillHost(module.RootURL, p)) };
}

// Загрузка одной картинки с подготовкой от скрипта (Referer и т. п.).
// Скрипт зовём один раз на главу и хост картинок, дальше повторяем его заголовки.
async function downloadImage(script, module, chapterLink, imageUrl, prepCache) {
  const http = script.newHttp();
  let url = imageUrl;
  if (module.OnBeforeDownloadImage) {
    let host = '';
    try { host = new URL(imageUrl).host; } catch { /* относительная ссылка */ }
    const key = `${module.ID}|${chapterLink}|${host}`;
    let prep = prepCache && prepCache.get(key);
    if (!prep) {
      const task = makeTask(chapterLink);
      const h = script.newHttp();
      await script.call(module, 'OnBeforeDownloadImage', { TASK: task, __http: h, URL: imageUrl, WORKID: 0 });
      prep = { headers: h.Headers.entries(), cookies: h.Cookies.entries(), ua: h.UserAgent };
      if (prepCache) prepCache.set(key, prep);
    }
    for (const [k, v] of prep.headers) http.Headers.Values[k] = v;
    for (const [k, v] of prep.cookies) http.Cookies.Values[k] = v;
    http.UserAgent = prep.ua;
  }
  const ok = await http.getAsync(url);
  if (!ok) return null;
  return { bytes: http.Document.bytes, mime: http.MimeType };
}

module.exports = { SiteScript, getInfo, getPages, downloadImage, splitURL, maybeFillHost, stringList };
