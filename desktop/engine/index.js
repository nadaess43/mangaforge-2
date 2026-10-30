// Загрузчик манги на скриптах сайтов FMD: найти сайт по ссылке, получить главы, страницы и картинки.
'use strict';

const fs = require('fs');
const path = require('path');
const { SiteScript, getInfo, getPages, downloadImage } = require('./lua-host');
const { CookieJar } = require('./http');

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
// Сайты часто меняют поддомен и зону (1.seimanga.me → seimanga.live), поэтому сравниваем и «имя» домена
const domainOf = (h) => h.split('.').slice(-2).join('.');
const labelOf = (h) => { const p = h.split('.'); return p.length >= 2 ? p[p.length - 2] : h; };

class Downloader {
  constructor({ scriptsDir, fetchImpl, log, manualRedirects = true }) {
    this.manualRedirects = manualRedirects;
    this.scriptsDir = scriptsDir;
    this.fetchImpl = fetchImpl;
    this.log = log || (() => {});
    this.jar = new CookieJar();
    this.scripts = new Map();
    this.imagePrep = new Map(); // заголовки картинок, подготовленные скриптом, по главе и хосту
    this.index = null;
    this.options = {};
  }

  // Быстрый индекс без запуска скриптов: имя и адрес сайта из текста модуля
  buildIndex() {
    if (this.index) return this.index;
    const dir = path.join(this.scriptsDir, 'modules');
    const index = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.lua')) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const roots = [...src.matchAll(/RootURL\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      // Модули со списком сайтов в таблице: { 'Name', 'https://…' }
      for (const m of src.matchAll(/['"](https?:\/\/[^'"\s]+)['"]/g)) if (!roots.includes(m[1]) && /AddWebsiteModule|NewWebsiteModule/.test(src)) roots.push(m[1]);
      const name = (/\.Name\s*=\s*['"]([^'"]+)['"]/.exec(src) || [])[1] || f.replace(/\.lua$/, '');
      for (const r of roots) { const h = hostOf(r); if (h) index.push({ file: path.join(dir, f), name, host: h }); }
    }
    this.index = index;
    return index;
  }

  candidates(url) {
    const h = hostOf(url);
    const idx = this.buildIndex();
    const tiers = [
      idx.filter((e) => e.host === h),
      idx.filter((e) => domainOf(e.host) === domainOf(h)),
      idx.filter((e) => labelOf(e.host) === labelOf(h)),
    ];
    const seen = new Set();
    const out = [];
    for (const t of tiers) for (const e of t) if (!seen.has(e.file)) { seen.add(e.file); out.push(e); }
    return out;
  }

  async script(file) {
    let s = this.scripts.get(file);
    if (!s) {
      const script = new SiteScript({ file, scriptsDir: this.scriptsDir, log: this.log, fetchImpl: this.fetchImpl, jar: this.jar, options: this.options, manualRedirects: this.manualRedirects });
      s = script.load().then(() => script);
      this.scripts.set(file, s);
      s.catch(() => this.scripts.delete(file));
    }
    return s;
  }

  // Lua в wasm иногда портит память после многих вызовов — тогда перезапускаем скрипт и повторяем
  async withScript(url, fn) {
    for (let attempt = 0; ; attempt++) {
      const r = await this.resolve(url);
      if (!r) throw new Error('Этот сайт не поддерживается');
      try {
        return await fn(r);
      } catch (e) {
        const broken = e instanceof WebAssembly.RuntimeError || /memory access out of bounds|unreachable|table index/i.test(String(e && e.message));
        if (!broken || attempt > 0) throw e;
        this.log(`Lua: перезапуск ${r.script.file}`);
        this.scripts.delete(r.script.file);
        this.imagePrep.clear();
        try { r.script.close(); } catch { /* уже сломан */ }
      }
    }
  }

  // Найти модуль сайта для ссылки
  async resolve(url) {
    const h = hostOf(url);
    for (const c of this.candidates(url)) {
      const s = await this.script(c.file);
      const mods = s.modules.filter((m) => m.OnGetInfo);
      const m = mods.find((x) => hostOf(x.RootURL) === h) || mods.find((x) => domainOf(hostOf(x.RootURL)) === domainOf(h)) || mods.find((x) => labelOf(hostOf(x.RootURL)) === labelOf(h));
      if (m) {
        // Сайт переехал на другой домен — работаем с тем, что открыл пользователь
        if (hostOf(m.RootURL) !== h) m.RootURL = new URL(url).origin;
        return { script: s, module: m };
      }
    }
    return null;
  }

  info(url) {
    return this.withScript(url, async (r) => ({ site: r.module.Name, ...(await getInfo(r.script, r.module, url)) }));
  }

  pages(url, chapterLink) {
    return this.withScript(url, (r) => getPages(r.script, r.module, chapterLink));
  }

  image(url, chapterLink, imageUrl) {
    return this.withScript(url, (r) => downloadImage(r.script, r.module, chapterLink, imageUrl, this.imagePrep));
  }

  sites() {
    return [...new Map(this.buildIndex().map((e) => [e.name, e.host])).entries()].map(([name, host]) => ({ name, host }));
  }
}

module.exports = { Downloader };
