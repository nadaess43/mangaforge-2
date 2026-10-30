(() => {
  'use strict';
  const C = window.BookletCore;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  const L = window.mfLogger;

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* без хранилища тоже работаем */ } },
  };

  const THUMB_W = 420;
  const IMAGE_RE = /\.(jpe?g|png|webp|avif|bmp|gif)$/i;
  let st = { ...C.DEFAULTS, ...store.get('booklet.settings', {}) };
  if (!C.MODES[st.mode]) st.mode = 'booklet';
  let files = [];        // источники: {id, kind:'pdf'|'images', name, size, numPages, sizes, ...}
  let meta = [];         // страницы подряд: {file, page, w, h, key, name, part?, spread?}
  // Обложка запоминается по картинке («id:страница»), а не по номеру:
  // номера сдвигаются, когда развороты режутся на половинки
  const coverKeys = { front: null, back: null };
  let plan = null;
  let title = '';        // что ввёл человек; пусто — берём подсказку
  const TABS = ['viewer', 'sheets', 'build', 'book'];
  let tab = store.get('booklet.tab', 'viewer');
  if (!TABS.includes(tab)) tab = 'viewer';
  let zoom = store.get('booklet.zoom', 380);
  let vSheet = 0;      // какой лист открыт в «Пролистать листы»
  let vBack = false;   // перевёрнут ли он
  let bookIdx = 0;     // разворот в «Готовой книге»
  let turning = false;
  let uid = 0;

  // ---------- Рисование страниц источников ----------
  async function renderSourcePage(src, page, width) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (src.kind === 'pdf') {
      const pg = await src.pdf.getPage(page + 1);
      const base = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: width / base.width });
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      pg.cleanup();
    } else {
      const bmp = await createImageBitmap(src.images[page].blob);
      const k = Math.min(1, width / bmp.width);
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
    }
    return c;
  }

  // ---------- Миниатюры ----------
  const thumbs = new Map();
  const queue = [];
  const queued = new Set();
  let pumping = false;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      requestThumb(e.target.dataset.key);
    }
  }, { root: window.matchMedia('(max-width: 860px)').matches ? null : $('#view'), rootMargin: '700px' });

  function requestThumb(key) {
    if (thumbs.has(key) || queued.has(key)) return;
    queued.add(key);
    queue.push(key);
    pump();
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      // Последние запрошенные — первыми: это то, что сейчас на экране
      const key = queue.pop();
      try { await renderThumb(key); } catch (e) { console.warn('миниатюра', key, e); }
      queued.delete(key);
    }
    pumping = false;
  }

  async function renderThumb(key) {
    const [id, p] = key.split(':');
    const src = files.find((x) => x.id === +id);
    if (!src) return;
    const c = await renderSourcePage(src, +p, THUMB_W);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    const url = URL.createObjectURL(blob);
    const old = thumbs.get(key);
    if (old) URL.revokeObjectURL(old);
    thumbs.set(key, url);
    for (const img of $$(`img[data-key="${key}"]`)) { img.src = url; img.classList.add('ready'); }
  }

  function hookThumbs(root) {
    for (const img of $$('img[data-key]', root)) {
      const url = thumbs.get(img.dataset.key);
      if (url) { img.src = url; img.classList.add('ready'); } else io.observe(img);
    }
  }

  // Для крупных просмотрщиков: всё видно сразу, грузим без ожидания прокрутки
  function fillThumbs(root) {
    for (const img of $$('img[data-key]', root)) {
      const url = thumbs.get(img.dataset.key);
      if (url) { img.src = url; img.classList.add('ready'); } else requestThumb(img.dataset.key);
    }
  }

  function prefetch(positions) {
    for (const pos of positions) {
      const src = plan.seq[pos];
      if (src !== null && src !== undefined) requestThumb(meta[src].key);
    }
  }

  // ---------- Порядок глав ----------
  // Том и глава из названия: «Vol.01 Ch.010.5 - Title», «Chapter 12», «Том 2 Глава 7», «001»
  const NUM = '(\\d+(?:[.,]\\d+)?)';
  const VOL_RE = new RegExp(`(?<![a-zа-яё])(?:vol(?:ume)?|v|том|т)\\.?\\s*${NUM}`, 'i');
  const CH_RE = new RegExp(`(?<![a-zа-яё])(?:ch(?:apter)?|c|ep(?:isode)?|глава|гл|#)\\.?\\s*${NUM}`, 'i');
  const toNum = (s) => parseFloat(s.replace(',', '.'));

  function chapterKey(name) {
    const s = name.replace(/\.(pdf|cbz|zip)$/i, '');
    const v = s.match(VOL_RE);
    const c = s.match(CH_RE);
    let ch = c ? toNum(c[1]) : null;
    if (ch === null) {
      // Нет слова «глава» — берём последнее число, кроме номера тома
      const rest = v ? s.replace(v[0], ' ') : s;
      const nums = rest.match(/\d+(?:[.,]\d+)?/g);
      if (nums) ch = toNum(nums[nums.length - 1]);
    }
    return { vol: v ? toNum(v[1]) : null, ch };
  }

  function smartCompare(a, b) {
    const ka = chapterKey(a), kb = chapterKey(b);
    if (ka.vol !== null && kb.vol !== null && ka.vol !== kb.vol) return ka.vol - kb.vol;
    if (ka.ch !== null && kb.ch !== null && ka.ch !== kb.ch) return ka.ch - kb.ch;
    return collator.compare(a, b);
  }

  const lastPart = (p) => p.split('/').filter(Boolean).pop() || p;
  function sortFiles() {
    files.sort((a, b) => smartCompare(lastPart(a.path || a.name), lastPart(b.path || b.name))
      || collator.compare(a.path || a.name, b.path || b.name));
  }

  // CBZ / ZIP: архив картинок одной главы
  async function readArchive(file) {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files)
      .filter((e) => !e.dir && IMAGE_RE.test(e.name) && !e.name.startsWith('__MACOSX'))
      .sort((a, b) => collator.compare(a.name, b.name));
    const imgs = [];
    for (const e of entries) {
      const ext = e.name.split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
      const blob = new Blob([await e.async('arraybuffer')], { type: mime });
      try {
        const bmp = await createImageBitmap(blob);
        imgs.push({ name: e.name, blob, mime, w: bmp.width, h: bmp.height });
        bmp.close();
      } catch (err) {
        L.warn('файлы', `Не картинка или битый файл в архиве ${file.name}: ${e.name}`, err);
      }
    }
    return imgs;
  }

  // ---------- Загрузка ----------
  // items: [{file, path}] — path с папками, если пришли из папки
  async function addInputs(items) {
    const pdfs = items.filter((it) => /\.pdf$/i.test(it.file.name) || it.file.type === 'application/pdf');
    const archives = items.filter((it) => /\.(cbz|zip)$/i.test(it.file.name));
    // Картинки берём только из папок глав
    const images = items.filter((it) => IMAGE_RE.test(it.file.name) && it.path.includes('/'));
    L.info('файлы', `Добавляю: ${items.length} файлов (PDF ${pdfs.length}, архивов ${archives.length}, картинок ${images.length})`);
    const t0 = Date.now();
    if (!pdfs.length && !images.length && !archives.length) {
      L.warn('файлы', 'Ничего подходящего', items.slice(0, 20).map((it) => it.path || it.file.name));
      toast('Нужен PDF, CBZ или папка с главами. DJVU и CBR сначала переведите в PDF или CBZ.');
      return;
    }
    busy(true, 'Открываю…', 0);
    try {
      for (const it of pdfs) {
        const data = new Uint8Array(await it.file.arrayBuffer());
        await openPdf({ name: it.file.name, size: it.file.size, file: it.file, bytes: null, path: it.path }, data);
      }
      let n = 0;
      for (const it of archives) {
        busy(true, `Распаковываю ${it.file.name} (${++n} из ${archives.length})`, n / archives.length);
        const imgs = await readArchive(it.file);
        if (!imgs.length) { toast(`В «${it.file.name}» нет картинок.`); continue; }
        files.push({
          id: ++uid, kind: 'images', name: it.file.name.replace(/\.(cbz|zip)$/i, ''), path: it.path,
          size: it.file.size, images: imgs, numPages: imgs.length, sizes: imgs.map((x) => ({ w: x.w, h: x.h })),
        });
      }
      // Картинки группируются по папкам: одна папка — одна глава
      const groups = new Map();
      for (const it of images) {
        const dir = it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : '';
        if (!groups.has(dir)) groups.set(dir, []);
        groups.get(dir).push(it);
      }
      const dirs = [...groups.keys()];
      let done = 0;
      for (const dir of dirs) {
        const list = groups.get(dir).sort((a, b) => collator.compare(a.file.name, b.file.name));
        const name = dir.split('/').pop();
        const imgs = [];
        for (const it of list) {
          try {
            const bmp = await createImageBitmap(it.file);
            imgs.push({ name: it.file.name, blob: it.file, mime: it.file.type, w: bmp.width, h: bmp.height });
            bmp.close();
          } catch (err) {
            L.warn('файлы', `Не картинка или формат не поддерживается: ${it.path} (${it.file.type || 'без типа'}, ${it.file.size} байт)`, err);
          }
          if (++done % 10 === 0) busy(true, `Читаю картинки: ${done} из ${images.length}`, done / images.length);
        }
        if (!imgs.length) continue;
        files.push({
          id: ++uid, kind: 'images', name, path: dir,
          size: imgs.reduce((s, x) => s + x.blob.size, 0),
          images: imgs, numPages: imgs.length, sizes: imgs.map((x) => ({ w: x.w, h: x.h })),
        });
      }
      L.info('файлы', `Открыто за ${Date.now() - t0} мс, всего в книге ${files.length} файлов, ${files.reduce((n, x) => n + x.numPages, 0)} страниц`, files.map((x) => `${x.name}: ${x.numPages} стр.`));
    } catch (e) {
      L.error('файлы', 'Не получилось открыть', e);
      toast('Не получилось открыть: ' + e.message);
    } finally {
      // Весь список — по томам и главам, даже если добавляли в несколько заходов
      sortFiles();
      detectCovers();
      rebuildMeta();
      busy(false);
      update();
    }
  }

  async function openPdf(entry, data) {
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const f = { id: ++uid, kind: 'pdf', ...entry, pdf, numPages: pdf.numPages, sizes: [] };
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const [x1, y1, x2, y2] = pg.view;
      let w = x2 - x1, h = y2 - y1;
      if (C.normRot(pg.rotate) % 180) [w, h] = [h, w];
      f.sizes.push({ w, h });
      if (i % 20 === 0) busy(true, `Читаю страницы: ${i} из ${pdf.numPages}`, i / pdf.numPages);
    }
    files.push(f);
  }

  // Папки при перетаскивании: обходим вглубь
  async function collectDropped(dt) {
    const out = [];
    const entries = [...dt.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) return [...dt.files].map((file) => ({ file, path: file.name }));
    const readAll = (reader) => new Promise((res, rej) => {
      const acc = [];
      const step = () => reader.readEntries((batch) => { if (!batch.length) res(acc); else { acc.push(...batch); step(); } }, rej);
      step();
    });
    async function walk(entry) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push({ file, path: entry.fullPath.replace(/^\//, '') });
      } else if (entry.isDirectory) {
        for (const e of await readAll(entry.createReader())) await walk(e);
      }
    }
    for (const e of entries) await walk(e);
    return out;
  }

  const isWide = (s) => s.w > s.h * 1.15;

  // Страницы книги по порядку. Широкие картинки (развороты) режутся на две половинки:
  // у обычной книги сначала левая, у манги — правая. Обложки не режутся.
  function rebuildMeta() {
    meta = [];
    // Обложку не режем, только если она печатается отдельно; «как обычные страницы» — режется как все
    const covers = new Set(st.coverMode === 'inside' ? [] : [coverKeys.front, coverKeys.back]);
    files.forEach((f, fi) => f.sizes.forEach((s, i) => {
      const key = `${f.id}:${i}`;
      const name = f.kind === 'images' ? f.images[i].name : '';
      const base = { file: fi, page: i, w: s.w, h: s.h, key, name };
      if (st.splitSpreads && isWide(s) && !covers.has(key)) {
        const halves = st.rtl ? [[0.5, 1], [0, 0.5]] : [[0, 0.5], [0.5, 1]];
        meta.push({ ...base, part: halves[0], spread: 1 }, { ...base, part: halves[1], spread: 2 });
      } else meta.push(base);
    }));
    // Номера обложек — по текущей нумерации
    const num = (k) => { const i = meta.findIndex((m) => m.key === k); return i < 0 ? 0 : i + 1; };
    st.coverFront = coverKeys.front ? num(coverKeys.front) : 0;
    st.coverBack = coverKeys.back ? num(coverKeys.back) : 0;
  }

  // Обложку ищем по имени файла, как её называют в релизах: cover, обложка, 0000, p000
  const COVER_RE = /(cover|обложк|^p?0{3,}(\D|$))/i;
  const BACK_RE = /(back|задн)/i;
  function detectCovers() {
    if (coverKeys.front || coverKeys.back || !files.length) return;
    const found = { front: null, back: null };
    files.forEach((f) => {
      if (f.kind !== 'images') return;
      f.images.forEach((im, i) => {
        const base = im.name.split('/').pop();
        const key = `${f.id}:${i}`;
        if (BACK_RE.test(base) && /cover|обложк/i.test(base)) { if (!found.back) found.back = key; }
        else if (COVER_RE.test(base) && !found.front) found.front = key;
      });
    });
    if (!found.front && !found.back) return;
    Object.assign(coverKeys, found);
    st.coverMode = 'sheet';
    toast('Нашёл обложку по имени файла. Проверьте её в разделе «Обложка».');
  }

  function setCover(which, n) {
    // n — номер страницы (с 1) или 0
    const m = meta[n - 1];
    coverKeys[which] = m ? m.key : null;
    if (coverKeys[which] && st.coverMode === 'inside') st.coverMode = 'sheet';
    rebuildMeta();
    syncControls();
    update();
  }

  function removeFile(id) {
    const f = files.find((x) => x.id === id);
    if (!f) return;
    for (const [k, url] of thumbs) if (k.startsWith(id + ':')) { URL.revokeObjectURL(url); thumbs.delete(k); }
    for (const w of ['front', 'back']) if (coverKeys[w] && coverKeys[w].startsWith(id + ':')) coverKeys[w] = null;
    if (f.pdf) f.pdf.destroy();
    files = files.filter((x) => x.id !== id);
    rebuildMeta();
    update();
  }

  function moveFile(id, d) {
    const i = files.findIndex((x) => x.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= files.length) return;
    [files[i], files[j]] = [files[j], files[i]];
    rebuildMeta();
    update();
  }

  // Что программа поняла из названия: «Т.1 Гл.10.5 · »
  function keyText(f) {
    if (files.length < 2) return '';
    const k = chapterKey(lastPart(f.path || f.name));
    const parts = [];
    if (k.vol !== null) parts.push(`Т.${k.vol}`);
    if (k.ch !== null) parts.push(`Гл.${k.ch}`);
    return parts.length ? `<b class="fkey">${parts.join(' ')}</b> · ` : '';
  }

  function renderFiles() {
    $('#btnSortFiles').hidden = files.length < 2;
    const fmt = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.ceil(b / 1024) + ' КБ');
    $('#fileList').innerHTML = files.map((f, i) => `
      <li>
        <span class="ftype">${f.kind === 'pdf' ? 'PDF' : '🖼'}</span>
        <div class="fi"><div class="fn" translate="no" title="${esc(f.path || f.name)}">${esc(f.name)}</div><div class="fm">${keyText(f)}${f.numPages} стр. · ${fmt(f.size)}</div></div>
        <button data-act="up" data-id="${f.id}" title="Выше" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" data-id="${f.id}" title="Ниже" ${i === files.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="del" data-id="${f.id}" title="Убрать">✕</button>
      </li>`).join('');
  }

  // Пример: пронумерованные страницы, чтобы понять раскладку
  async function loadDemo() {
    busy(true, 'Готовлю пример…', 0);
    try {
      const { PDFDocument, StandardFonts, rgb } = PDFLib;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const colors = [rgb(0.31, 0.27, 0.9), rgb(0.05, 0.58, 0.53), rgb(0.85, 0.47, 0.02), rgb(0.86, 0.15, 0.15)];
      for (let i = 1; i <= 40; i++) {
        const p = doc.addPage([420, 595]);
        const col = colors[Math.floor((i - 1) / 10) % colors.length];
        p.drawRectangle({ x: 18, y: 18, width: 384, height: 559, borderColor: col, borderWidth: 4 });
        p.drawRectangle({ x: 18, y: 520, width: 384, height: 57, color: col });
        p.drawText('PAGE', { x: 40, y: 540, size: 22, font, color: rgb(1, 1, 1) });
        const s = String(i);
        p.drawText(s, { x: 210 - font.widthOfTextAtSize(s, 150) / 2, y: 230, size: 150, font, color: col });
        for (let l = 0; l < 4; l++) p.drawRectangle({ x: 50, y: 160 - l * 26, width: 320 - (l % 2) * 90, height: 9, color: rgb(0.85, 0.85, 0.85) });
      }
      const bytes = await doc.save();
      await openPdf({ name: I18N.t('Пример (40 страниц).pdf'), size: bytes.length, file: null, bytes }, bytes.slice());
      rebuildMeta();
    } finally {
      busy(false);
      update();
    }
  }

  // ---------- Имя файла ----------
  // Подсказка названия по именам файлов и папок (как в MangaForge): «Наруто Том 1-3 Гл. 5-10»
  function suggestTitle() {
    if (!files.length) return I18N.t('Книга');
    if (files.length === 1 && files[0].kind === 'pdf') return files[0].name.replace(/\.pdf$/i, '');
    const names = files.map((f) => f.name.replace(/\.pdf$/i, ''));
    const clean = names
      .map((n) => n.replace(/(vol|v|том|глава|гл|ch|chapter|glava)\.?\s*\d+/gi, '').replace(/\d+/g, '').replace(/_/g, ' ').replace(/^[\s\-.]+|[\s\-.]+$/g, ''))
      .filter(Boolean);
    let base = clean.length ? commonPrefix(clean).replace(/[\s\-.]+$/, '').trim() : '';
    if (base.length < 3) base = clean[0] || I18N.t('Манга');
    const vols = [], chs = [];
    for (const n of names) {
      const v = n.match(/(?:vol|v|том)\.?\s*(\d+)/i);
      if (v) vols.push(+v[1]);
      const c = n.match(/(?:ch|chapter|глава|гл|glava)\.?\s*(\d+)/i);
      if (c) chs.push(+c[1]);
      else if (!v) { const nums = n.match(/\d+/g); if (nums) chs.push(+nums[nums.length - 1]); }
    }
    const span = (a) => { const lo = Math.min(...a), hi = Math.max(...a); return lo === hi ? `${lo}` : `${lo}-${hi}`; };
    const parts = [base];
    if (vols.length) parts.push(I18N.t('Том') + ' ' + span(vols));
    if (chs.length) parts.push(I18N.t('Гл.') + ' ' + span(chs));
    return parts.join(' ');
  }

  function commonPrefix(arr) {
    let p = arr[0];
    for (const s of arr) while (!s.startsWith(p)) p = p.slice(0, -1);
    return p;
  }

  const bookTitleText = () => title.trim() || suggestTitle();

  // ---------- Авто-обрезка полей (Smart Crop) ----------
  async function autoCrop() {
    if (!meta.length) return;
    busy(true, 'Ищу поля на страницах…', 0);
    try {
      const real = meta.filter((m) => !m.part);
      const n = Math.min(12, real.length);
      // Берём страницы из середины книги: у обложки и последних страниц поля другие
      const from = Math.floor(real.length * 0.1), to = Math.max(from + 1, Math.floor(real.length * 0.9));
      const pick = Array.from({ length: n }, (_, i) => real[Math.floor(from + ((to - from) * (i + 0.5)) / n)]);
      const mins = { l: 1, r: 1, t: 1, b: 1 };
      let found = 0;
      for (let i = 0; i < pick.length; i++) {
        const m = pick[i];
        const c = await renderSourcePage(files[m.file], m.page, 300);
        const box = contentBox(c);
        if (box) {
          found++;
          mins.l = Math.min(mins.l, box.l); mins.r = Math.min(mins.r, box.r);
          mins.t = Math.min(mins.t, box.t); mins.b = Math.min(mins.b, box.b);
        }
        busy(true, 'Ищу поля на страницах…', (i + 1) / pick.length);
      }
      if (!found) { toast('Не нашёл полей: страницы пустые или без рамки.'); return; }
      // Запас 0,5%, чтобы не задеть рисунок
      const val = (x) => clamp(Math.floor((x * 100 - 0.5) * 2) / 2, 0, 25);
      Object.assign(st, { cropL: val(mins.l), cropR: val(mins.r), cropT: val(mins.t), cropB: val(mins.b) });
      syncControls();
      update();
      toast(`Поля найдены: сверху ${st.cropT}%, снизу ${st.cropB}%, слева ${st.cropL}%, справа ${st.cropR}%.`);
    } finally {
      busy(false);
    }
  }

  // Доли полей страницы: всё, что отличается от цвета угла, считается содержимым
  function contentBox(c) {
    const { width: w, height: h } = c;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const bg = [d[0], d[1], d[2]];
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { l: x0 / w, r: (w - 1 - x1) / w, t: y0 / h, b: (h - 1 - y1) / h };
  }

  // ---------- Настройки ----------
  function bindControls() {
    for (const el of $$('[data-k]')) {
      const k = el.dataset.k;
      const ev = ['range', 'text', 'number'].includes(el.type) ? 'input' : 'change';
      el.addEventListener(ev, () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'radio') {
          if (!el.checked) return;
          v = el.value === 'true' ? true : el.value === 'false' ? false : el.value;
        } else if (el.type === 'range' || el.type === 'number') {
          v = parseFloat(el.value);
          if (Number.isNaN(v)) return;
        } else v = el.value;
        if (st[k] !== v) L.info('настройки', `${k}: ${JSON.stringify(st[k])} → ${JSON.stringify(v)}`);
        st[k] = v;
        syncControls(el);
        // От этих настроек зависит, как режутся развороты
        if (k === 'splitSpreads' || k === 'rtl' || k === 'coverMode') rebuildMeta();
        scheduleUpdate();
      });
    }
    for (const b of $$('[data-set]')) {
      b.addEventListener('click', () => {
        L.info('настройки', `${b.dataset.set}: ${JSON.stringify(st[b.dataset.set])} → ${+b.dataset.v}`);
        st[b.dataset.set] = +b.dataset.v;
        if (b.dataset.set === 'sheetsPerSig') st.oneSig = false;
        syncControls();
        scheduleUpdate();
      });
    }
  }

  function finishedSize(mode) {
    const p = C.PAPERS[st.paper];
    const mm = (pt) => Math.round(pt / C.MM);
    const [w, h] = mode === 'booklet4' ? [p.w / 2, p.h / 2] : [p.h / 2, p.w];
    const names = { '148x210': 'A5', '149x210': 'A5', '105x148': 'A6', '105x149': 'A6', '210x297': 'A4', '74x105': 'A7' };
    const key = `${mm(w)}x${mm(h)}`;
    return `${mm(w)} × ${mm(h)} мм${names[key] ? ` (${names[key]})` : ''}`;
  }

  function syncControls(except) {
    for (const el of $$('[data-k]')) {
      if (el === except) continue;
      const v = st[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = String(v) === el.value;
      else el.value = v;
    }
    for (const o of $$('output[data-out]')) {
      const v = st[o.dataset.out];
      o.textContent = String(v).replace('.', ',') + (o.dataset.unit || '');
    }
    for (const c of $$('[data-set]')) c.classList.toggle('on', !st.oneSig && st[c.dataset.set] === +c.dataset.v);
    for (const el of $$('[data-show-duplex]')) el.hidden = st.duplex !== el.dataset.showDuplex;
    for (const el of $$('[data-show-num]')) el.hidden = !st.pageNumbers;
    const punch = C.isPunch(st);
    for (const el of $$('[data-show-fold]')) el.hidden = punch;
    for (const el of $$('[data-show-punch]')) el.hidden = !punch;
    for (const el of $$('[data-fold-txt]')) el.textContent = punch ? el.dataset.punchTxt : el.dataset.foldTxt;
    for (const el of $$('[data-size]')) el.textContent = 'Готовая книга: ' + finishedSize(el.dataset.size);
    const range = $('input[data-k="sheetsPerSig"]');
    range.disabled = st.oneSig;
    const half = st.mode === 'booklet4';
    $('#sigHint').textContent = st.oneSig
      ? (half ? 'Будет 2 тетради: верхние половинки листов и нижние.' : 'Все листы сгибаются одной стопкой. Удобно для тонких книжек до ~40 страниц.')
      : half
        ? `Тетрадь = ${st.sheetsPerSig} половинок = ${st.sheetsPerSig * 4} страниц. Один лист бумаги даёт по половинке в 2 тетради.`
        : `Тетрадь = ${st.sheetsPerSig} лист. = ${st.sheetsPerSig * 4} страниц. Для обычной бумаги удобно 4–8 листов.`;
    $('#finishedSize').textContent = 'Готовая книга: ' + finishedSize(st.mode);
    $('#coverFront').value = st.coverFront || '';
    $('#coverBack').value = st.coverBack || '';
    for (const el of $$('[data-show-cover]')) el.hidden = st.coverMode !== 'sheet';
  }

  // Миниатюры выбранных обложек и размер развёртки
  function renderCoverPanel() {
    $('#coverFront').value = st.coverFront || '';
    $('#coverBack').value = st.coverBack || '';
    for (const el of $$('input[name="coverMode"]')) el.checked = el.value === st.coverMode;
    for (const el of $$('[data-show-cover]')) el.hidden = st.coverMode !== 'sheet';
    const thumb = (n, label) => {
      const m = meta[n - 1];
      return m ? fitPage(m, 46 / 64) : `<span>${label}</span>`;
    };
    $('#thumbFront').innerHTML = thumb(st.coverFront, 'нет');
    $('#thumbBack').innerHTML = thumb(st.coverBack, 'нет');
    fillThumbs($('#thumbFront'));
    fillThumbs($('#thumbBack'));
    const info = $('#coverInfo');
    const c = plan && !plan.error ? plan.cover : null;
    if (!st.coverFront && !st.coverBack) info.textContent = 'Обложка не выбрана — книга начнётся сразу со страниц.';
    else if (st.coverMode === 'skip') info.textContent = 'Страницы обложки уберутся из книги и не напечатаются.';
    else if (st.coverMode === 'inside') info.textContent = 'Страницы обложки останутся в книге как обычные страницы.';
    else if (c) {
      const mm = (pt) => Math.round(pt / C.MM);
      info.textContent = `Развёртка ${mm(c.W)} × ${mm(c.H)} мм (корешок ${(c.spine / C.MM).toFixed(1)} мм) → печать на ${c.paper}`
        + (c.scale < 1 ? `, уменьшена до ${Math.round(c.scale * 100)}% — выберите бумагу больше` : '')
        + (c.wrap ? '. Широкая картинка займёт всю развёртку.' : '.');
    }
  }

  let timer = 0;
  function scheduleUpdate() {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  }

  // ---------- Отрисовка ----------
  function update() {
    store.set('booklet.settings', st);
    renderFiles();
    const has = files.length > 0;
    $('#empty').hidden = has;
    $('#work').hidden = !has;
    $('#title').placeholder = has ? suggestTitle() : 'подберётся по файлам';
    if (!has) { plan = null; $('#btnSave').disabled = true; renderCoverPanel(); return; }
    plan = C.plan(meta, st);
    $('#rangeErr').textContent = plan.error || '';
    $('#btnSave').disabled = !!plan.error;
    renderCoverPanel();
    renderSummary();
    renderTab();
  }

  function printHint() {
    if (st.duplex === 'manual') {
      return 'Сначала напечатайте файл «лицевые», затем переверните стопку, вставьте обратно в лоток и напечатайте «обороты». Проверьте сначала на 2 листах.';
    }
    const edge = st.mode === 'booklet4' ? 'по длинному краю' : 'по короткому краю';
    return `Двусторонняя печать, переворот <b>${edge}</b>. Масштаб в окне печати — «Фактический размер» (100%).`;
  }

  function renderSummary() {
    const el = $('#summary');
    if (plan.error) { el.innerHTML = `<div class="error">${esc(plan.error)}</div>`; return; }
    const pages = plan.seq.filter((x) => x !== null).length;
    const stat = (n, t) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`;
    const parts = [stat(pages, 'страниц книги'), '<div class="arrow">→</div>'];
    if (plan.punch) parts.push(stat(plan.leafCount, plural(plan.leafCount, 'листок', 'листка', 'листков')));
    else parts.push(stat(plan.signatures.length, plural(plan.signatures.length, 'тетрадь', 'тетради', 'тетрадей')));
    parts.push(stat(plan.sheets.length, plural(plan.sheets.length, 'лист бумаги', 'листа бумаги', 'листов бумаги')));
    parts.push(stat(plan.blanks, plural(plan.blanks, 'пустая страница', 'пустые страницы', 'пустых страниц')));
    parts.push(stat(finishedSize(st.mode).replace(/ мм.*/, ''), 'размер книги, мм'));
    parts.push(`<div class="print-hint"><span>${printHint()}</span></div>`);
    el.innerHTML = parts.join('');
  }

  function renderTab() {
    for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    $('#zoomBox').hidden = tab !== 'sheets';
    io.disconnect();
    turning = false;
    const box = $('#tabContent');
    if (plan.error) { box.innerHTML = ''; return; }
    if (tab === 'build') box.innerHTML = buildView();
    else if (tab === 'book') box.innerHTML = bookView();
    else if (tab === 'viewer') box.innerHTML = viewerView();
    else box.innerHTML = sheetsView();
    if (tab === 'viewer' || tab === 'book') fillThumbs(box);
    else hookThumbs(box);
    if (tab === 'viewer') prefetchSheet(vSheet + 1);
    if (tab === 'book') prefetchBook();
  }

  const numOf = (pos) => (pos === null || pos === undefined || plan.seq[pos] === null || plan.seq[pos] === undefined ? null : plan.seq[pos] + 1);

  // Картинка страницы, растянутая так, что видна только её обрезанная часть (или половинка разворота)
  function pageImgMeta(m) {
    const c = C.cropOf(m, st);
    const kw = Math.max(0.05, 1 - c.l - c.r), kh = Math.max(0.05, 1 - c.t - c.b);
    return `<img data-key="${m.key}" alt="" style="width:${100 / kw}%;height:${100 / kh}%;left:${(-c.l / kw) * 100}%;top:${(-c.t / kh) * 100}%">`;
  }

  const pageImg = (src) => pageImgMeta(meta[src]);

  // Видимая часть страницы: ширина / высота
  function visRatio(m) {
    const c = C.cropOf(m, st);
    return (m.w * (1 - c.l - c.r)) / (m.h * (1 - c.t - c.b));
  }

  // Страница целиком внутри рамки с соотношением boxRatio, без искажений (поля по краям)
  function fitPage(m, boxRatio, badge = '') {
    const r = visRatio(m);
    const style = r > boxRatio
      ? `left:0;width:100%;height:${(boxRatio / r) * 100}%;top:${((1 - boxRatio / r) / 2) * 100}%`
      : `top:0;height:100%;width:${(r / boxRatio) * 100}%;left:${((1 - r / boxRatio) / 2) * 100}%`;
    return `<div class="pg" style="${style}">${pageImgMeta(m)}${badge}</div>`;
  }

  // Внутренность листа бумаги: области, страницы, пустые места, сгиб и разрез
  function paperInner(layout) {
    const { W, H } = plan.geo;
    const pos = (r) => `left:${(r.x / W) * 100}%;top:${((H - r.y - r.h) / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%`;
    const items = layout.map((it) => {
      let s = `<div class="slot" style="${pos(it.slot)}"></div>`;
      if (it.src === null) s += `<div class="blank" style="${pos(it.slot)}">пусто</div>`;
      else s += `<div class="pg" style="${pos(it.rect)}">${pageImg(it.src)}<span class="num">${it.src + 1}</span></div>`;
      return s;
    }).join('');
    if (plan.punch) {
      const mm = C.MM;
      const zones = layout.filter((it) => it.src !== null).map((it) => {
        const c = it.slot.cell, w = Math.min(st.punchMargin * mm, c.w) * 0.8;
        const z = { x: it.slot.spine === 'left' ? c.x : c.x + c.w - w, y: c.y, w, h: c.h };
        return `<div class="hole-zone" style="${pos(z)}"></div>`;
      }).join('');
      return zones + items + '<div class="cut cut-v"></div>' + (st.mode === 'booklet4' ? '<div class="cut"></div>' : '');
    }
    return items + '<div class="fold"></div>' + (st.mode === 'booklet4' ? '<div class="cut"></div>' : '');
  }

  // Листки на листе дырокола: «листок 1 (стр. 1–2)»
  const leafText = (lf) => (lf ? `листок ${lf.no} (стр. ${pairText(lf.pages)})` : 'пусто');

  const halvesOf = (sh) => sh.halves || [sh];
  // «16 и 1», а для маленькой книги по половинкам: «16 и 1 / пусто и 17»
  const sideList = (layout) => {
    const t = layout.map((it) => (it.src === null ? 'пусто' : it.src + 1));
    const pairs = [];
    for (let i = 0; i < t.length; i += 2) pairs.push(`${t[i]} и ${t[i + 1]}`);
    return pairs.join(' / ');
  };

  // ---------- Пролистать листы ----------
  function prefetchSheet(i) {
    const sh = plan.sheets[i];
    if (sh) prefetch([...sh.front, ...sh.back]);
  }

  function viewerView() {
    const n = plan.sheets.length;
    vSheet = clamp(vSheet, 0, n - 1);
    const sh = plan.sheets[vSheet];
    const { W, H } = plan.geo;
    if (plan.punch) return punchViewer(sh, n);
    const half = st.mode === 'booklet4';
    const hs = halvesOf(sh);
    const sub = half
      ? hs.map((h, i) => (h ? `${i ? 'низ' : 'верх'} — тетрадь ${h.sig}, лист ${h.sheetInSig} из ${h.sheetsInSig}` : `${i ? 'низ' : 'верх'} — пусто`)).join(' · ')
      : `Тетрадь ${sh.sig} из ${plan.signatures.length} · в ней это лист ${sh.sheetInSig} из ${sh.sheetsInSig}`;
    const sideIdx = vSheet * 2 + (vBack ? 1 : 0);
    const chips = [];
    for (let k = Math.max(0, sideIdx - 3); k <= Math.min(n * 2 - 1, sideIdx + 3); k++) {
      const s = Math.floor(k / 2), b = k % 2;
      chips.push(`<button class="ochip${k === sideIdx ? ' cur' : ''}" data-side="${k}"><span class="side side-${b ? 'B' : 'A'}">${b ? 'B' : 'A'}</span> лист ${s + 1}</button>`);
    }
    const lay = (layout, i) => (half ? layout.slice(i * 2, i * 2 + 2) : layout);
    const what = hs.map((h, i) => {
      if (!h) return `<p class="muted">${i ? 'Нижняя' : 'Верхняя'} половина пустая.</p>`;
      const head = half ? `<p class="half-head">${i ? '⬇ Нижняя' : '⬆ Верхняя'} половина → тетрадь ${h.sig}</p>` : '';
      return `${head}
        <p><span class="side side-A">A</span> лицевая: <b>${sideList(lay(sh.frontLayout, i))}</b> · <span class="side side-B">B</span> оборот: <b>${sideList(lay(sh.backLayout, i))}</b></p>
        <p class="muted">После сгиба: стр. <b>${pairText(h.leaves[0])}</b> и <b>${pairText(h.leaves[1])}</b></p>`;
    }).join('');
    const where = hs.filter(Boolean).map((h) => `
      <div class="v-card"><h4>${half ? `Тетрадь ${h.sig}` : `Где он в тетради ${h.sig}`}</h4>${butterfly(plan.signatures[h.sig - 1], h.sheetInSig - 1)}<p class="hint">Выделенная линия — ${half ? 'эта половинка' : 'этот лист'}. Вид сверху на сложенную тетрадь.</p></div>`).join('');
    return `
      <div class="viewer">
        <div class="v-nav">
          <button class="btn" data-v="prev" ${sideIdx === 0 ? 'disabled' : ''}>◀ Назад</button>
          <div class="v-title"><b>Лист ${vSheet + 1} из ${n}</b><span>${sub}</span></div>
          <button class="btn" data-v="next" ${sideIdx === n * 2 - 1 ? 'disabled' : ''}>Вперёд ▶</button>
        </div>
        <div class="v-side" id="vSide">${sideTag()}</div>
        <div class="v-stage" style="--ar:${(W / H).toFixed(4)}">
          <div class="card3d${vBack ? ' flipped' : ''}" id="card" title="Нажмите, чтобы перевернуть">
            <div class="face front"><div class="paper">${paperInner(sh.frontLayout)}</div></div>
            <div class="face back"><div class="paper">${paperInner(sh.backLayout)}</div></div>
          </div>
        </div>
        <div class="v-actions">
          <button class="btn primary" data-v="flip">↻ Перевернуть лист</button>
          <span class="hint">Клавиши: ← → — листать, пробел — перевернуть</span>
        </div>
        <label class="v-scrub"><span>Лист 1</span><input type="range" min="1" max="${n}" value="${vSheet + 1}" data-v="scrub"><span>${n}</span></label>
        <div class="v-info">
          <div class="v-card"><h4>Что на этом листе</h4>${what}</div>
          ${where}
          <div class="v-card">
            <h4>Порядок печати</h4>
            <p class="hint">${st.duplex === 'manual'
              ? 'Сначала печатаются все стороны A (файл «лицевые»), потом стопку переворачивают и печатают все B.'
              : 'Принтер печатает A, затем на обороте того же листа B, и берёт следующий лист.'}</p>
            <div class="ochips">${chips.join('')}</div>
          </div>
        </div>
      </div>`;
  }

  // Пролистать листы — дырокол: на листе несколько листков, после разрезки они расходятся по своим стопкам
  function punchViewer(sh, n) {
    const { W, H } = plan.geo;
    const sideIdx = vSheet * 2 + (vBack ? 1 : 0);
    const chips = [];
    for (let k = Math.max(0, sideIdx - 3); k <= Math.min(n * 2 - 1, sideIdx + 3); k++) {
      const s = Math.floor(k / 2), b = k % 2;
      chips.push(`<button class="ochip${k === sideIdx ? ' cur' : ''}" data-side="${k}"><span class="side side-${b ? 'B' : 'A'}">${b ? 'B' : 'A'}</span> лист ${s + 1}</button>`);
    }
    const names = st.mode === 'booklet4' ? ['⬉ левый верхний', '⬈ правый верхний', '⬋ левый нижний', '⬊ правый нижний'] : ['◧ левый', '◨ правый'];
    const what = sh.leaves.map((lf, c) => `<p>${names[c]} кусок → <b>${leafText(lf)}</b>, стопка ${c + 1}</p>`).join('');
    return `
      <div class="viewer">
        <div class="v-nav">
          <button class="btn" data-v="prev" ${sideIdx === 0 ? 'disabled' : ''}>◀ Назад</button>
          <div class="v-title"><b>Лист ${vSheet + 1} из ${n}</b><span>после разрезки — ${sh.leaves.filter(Boolean).length} ${plural(sh.leaves.filter(Boolean).length, 'листок', 'листка', 'листков')}</span></div>
          <button class="btn" data-v="next" ${sideIdx === n * 2 - 1 ? 'disabled' : ''}>Вперёд ▶</button>
        </div>
        <div class="v-side" id="vSide">${sideTag()}</div>
        <div class="v-stage" style="--ar:${(W / H).toFixed(4)}">
          <div class="card3d${vBack ? ' flipped' : ''}" id="card" title="Нажмите, чтобы перевернуть">
            <div class="face front"><div class="paper">${paperInner(sh.frontLayout)}</div></div>
            <div class="face back"><div class="paper">${paperInner(sh.backLayout)}</div></div>
          </div>
        </div>
        <div class="v-actions">
          <button class="btn primary" data-v="flip">↻ Перевернуть лист</button>
          <span class="hint">Клавиши: ← → — листать, пробел — перевернуть</span>
        </div>
        <label class="v-scrub"><span>Лист 1</span><input type="range" min="1" max="${n}" value="${vSheet + 1}" data-v="scrub"><span>${n}</span></label>
        <div class="v-info">
          <div class="v-card"><h4>Что на этом листе</h4>${what}
            <p class="hint">Заштрихованная полоса — поле под дырокол. На обороте она с другой стороны, поэтому после переворота совпадает.</p></div>
          <div class="v-card">
            <h4>Порядок печати</h4>
            <p class="hint">${st.duplex === 'manual'
              ? 'Сначала печатаются все стороны A (файл «лицевые»), потом стопку переворачивают и печатают все B.'
              : 'Принтер печатает A, затем на обороте того же листа B, и берёт следующий лист.'}</p>
            <div class="ochips">${chips.join('')}</div>
          </div>
        </div>
      </div>`;
  }

  function sideTag() {
    return vBack
      ? '<span class="side side-B">B</span> Сейчас видно: оборот листа (как он ляжет после переворота)'
      : '<span class="side side-A">A</span> Сейчас видно: лицевая сторона';
  }

  function flipSheet() {
    vBack = !vBack;
    const card = $('#card');
    if (!card) return;
    card.classList.toggle('flipped', vBack);
    $('#vSide').innerHTML = sideTag();
    renderViewerChrome();
  }

  // Обновить кнопки и полоску порядка без пересборки листа (чтобы шла анимация)
  function renderViewerChrome() {
    const box = $('#tabContent');
    const fresh = document.createElement('div');
    fresh.innerHTML = viewerView();
    for (const sel of ['.v-nav', '.ochips']) {
      const a = $(sel, box), b = $(sel, fresh);
      if (a && b) a.replaceWith(b);
    }
  }

  function stepSide(d) {
    const n = plan.sheets.length;
    const k = clamp(vSheet * 2 + (vBack ? 1 : 0) + d, 0, n * 2 - 1);
    const s = Math.floor(k / 2), b = k % 2 === 1;
    if (s === vSheet) { if (b !== vBack) flipSheet(); return; }
    vSheet = s;
    vBack = b;
    renderTab();
  }

  // ---------- Все листы ----------
  function sheetsView() {
    const { W, H } = plan.geo;
    const portrait = W < H;
    const paper = (layout, side) => {
      const cap = side === 'A'
        ? '<span class="side side-A">A</span> лицевая сторона'
        : '<span class="side side-B">B</span> оборот этого же листа';
      return `<figure class="paper-wrap${portrait ? ' portrait' : ''}"><div class="paper" style="aspect-ratio:${W}/${H}">${paperInner(layout)}</div><figcaption>${cap}</figcaption></figure>`;
    };
    if (plan.punch) {
      const row = (sh) => `
        <div class="sheet-row">
          <div class="sheet-label"><b>Лист ${sh.globalNo}</b><small>метка L${sh.globalNo}/${sh.sheetsTotal}</small>
            <div class="sheet-pages">${sh.leaves.map((lf) => (lf ? `листок ${lf.no}: ${pairText(lf.pages)}` : 'пусто')).join('<br>')}</div>
          </div>
          ${paper(sh.frontLayout, 'A')}
          ${paper(sh.backLayout, 'B')}
        </div>`;
      const piles = st.mode === 'booklet4' ? 'четыре стопки: левую верхнюю, правую верхнюю, левую нижнюю, правую нижнюю' : 'две стопки: левую и правую';
      const intro = `<p class="intro">Так листы выйдут из принтера. После печати разрежьте всю стопку по линиям разреза — получатся ${piles}.
        Положите их друг на друга в этом порядке (первая — сверху): листки сразу пойдут по порядку. Пробейте дыроколом поле у корешка (заштриховано).</p>`;
      return coverBlock() + intro + `<section class="sig">${plan.sheets.map(row).join('')}</section>`;
    }
    const row = (sh) => {
      const label = st.mode === 'booklet4'
        ? halvesOf(sh).map((h, i) => (h ? `${i ? '⬇' : '⬆'} T${h.sig}·L${h.sheetInSig}` : `${i ? '⬇' : '⬆'} пусто`)).join('<br>')
        : `метка T${sh.sig}·L${sh.sheetInSig}`;
      return `
      <div class="sheet-row">
        <div class="sheet-label"><b>Лист ${sh.globalNo}</b><small>${label}</small>
          <div class="sheet-pages"><span class="side side-A">A</span> ${sideList(sh.frontLayout)}<br><span class="side side-B">B</span> ${sideList(sh.backLayout)}</div>
        </div>
        ${paper(sh.frontLayout, 'A')}
        ${paper(sh.backLayout, 'B')}
      </div>`;
    };
    const intro = st.mode === 'booklet4'
      ? `<p class="intro">Так листы выйдут из принтера. На каждой стороне 4 страницы. После печати разрежьте всю стопку пополам по линии разреза:
         верхние половинки — одна тетрадь, нижние — другая. Каждую тетрадь сложите пополам.</p>`
      : `<p class="intro">Так листы выйдут из принтера. На одном листе 4 страницы: две с лица (A) и две с оборота (B).
         Первый лист: первая и последняя страница тетради снаружи, дальше листы вкладываются друг в друга.
         Сложите листы тетради стопкой и согните пополам — страницы пойдут по порядку.</p>`;
    // Группы: лист за листом одной тетради (или пары тетрадей)
    const groups = [];
    for (const sh of plan.sheets) {
      const key = halvesOf(sh).map((h) => (h ? h.sig : '-')).join('+');
      const g = groups[groups.length - 1];
      if (g && g.key === key) g.sheets.push(sh); else groups.push({ key, sheets: [sh] });
    }
    return coverBlock() + intro + groups.map((g) => {
      const sigs = halvesOf(g.sheets[0]).filter(Boolean).map((h) => plan.signatures[h.sig - 1]);
      const head = sigs.map((s, i) => `<div class="sig-tag">${st.mode === 'booklet4' ? (i ? '⬇ ' : '⬆ ') : ''}Тетрадь ${s.no}</div><span>${rangeText(s.from, s.to)}</span>`).join('');
      return `<section class="sig"><div class="sig-head">${head}</div>${g.sheets.map(row).join('')}</section>`;
    }).join('');
  }

  // Лист обложки: развёртка «зад — корешок — перед» на своей бумаге
  function coverBlock() {
    const c = plan.cover;
    if (!c || !c.items.length) return '';
    const pos = (r) => `left:${(r.x / c.PW) * 100}%;top:${((c.PH - r.y - r.h) / c.PH) * 100}%;width:${(r.w / c.PW) * 100}%;height:${(r.h / c.PH) * 100}%`;
    const items = c.items.map((it) => {
      const P = it.panel, R = it.R;
      const inner = `left:${((R.x - P.x) / P.w) * 100}%;top:${((P.y + P.h - R.y - R.h) / P.h) * 100}%;width:${(R.w / P.w) * 100}%;height:${(R.h / P.h) * 100}%`;
      return `<div class="cov-panel" style="${pos(P)}"><div class="cov-in" style="${inner}">${pageImg(it.src)}</div></div>`;
    }).join('');
    const mm = (pt) => Math.round(pt / C.MM);
    if (c.punch) {
      return `
      <section class="sig cover-sec">
        <div class="sig-head"><div class="sig-tag">Обложка</div><span>отдельный лист ${c.paper}, печать с одной стороны · листок ${mm(c.bookW)} × ${mm(c.bookH)} мм</span></div>
        <figure class="paper-wrap cover-wrap${c.PW < c.PH ? ' portrait' : ''}"><div class="paper" style="aspect-ratio:${c.PW}/${c.PH}">
          ${items}<div class="cut cut-v"></div>${st.mode === 'booklet4' ? '<div class="cut"></div>' : ''}
        </div><figcaption>перед · зад</figcaption></figure>
      </section>`;
    }
    const left = st.rtl ? 'перед' : 'зад', right = st.rtl ? 'зад' : 'перед';
    return `
      <section class="sig cover-sec">
        <div class="sig-head"><div class="sig-tag">Обложка</div><span>отдельный лист ${c.paper} · книга ${mm(c.bookW)} × ${mm(c.bookH)} мм · корешок ${(c.spine / C.MM).toFixed(1)} мм</span></div>
        <figure class="paper-wrap cover-wrap"><div class="paper" style="aspect-ratio:${c.PW}/${c.PH}">
          <div class="cov-whole" style="${pos(c.whole)}"></div>
          ${items}
          <div class="cov-spine" style="${pos(c.spinePanel)}"></div>
        </div><figcaption>${left} · корешок · ${right}</figcaption></figure>
      </section>`;
  }

  // Номера страниц в куске последовательности: «стр. 1–24»
  function rangeText(from, to) {
    const nums = plan.seq.slice(from, to + 1).filter((x) => x !== null).map((x) => x + 1);
    if (!nums.length) return 'только пустые';
    const blanks = to - from + 1 - nums.length;
    return `стр. ${Math.min(...nums)}–${Math.max(...nums)}` + (blanks ? ` + ${blanks} пуст.` : '');
  }

  function pairText(leaf) {
    const [a, b] = leaf.map(numOf);
    const f = (x) => (x === null ? 'пусто' : x);
    if (a !== null && b !== null && b === a + 1) return `${a}–${b}`;
    return `${f(a)}, ${f(b)}`;
  }

  function butterfly(sig, cur = -1) {
    const S = sig.sheets.length;
    const gap = S > 10 ? 8 : 11;
    const W = 320, len = 200;
    const H = gap * S * 2 + 34;
    const cy = H / 2;
    const rtl = st.rtl;
    const sx = rtl ? W - 46 : 46;          // где корешок
    const dir = rtl ? -1 : 1;
    let out = '';
    sig.sheets.forEach((sh, i) => {
      const spread = gap * (S - i);
      const fx = sx + dir * i * 3;
      const ex = sx + dir * len;
      const cls = i === cur ? ' cur' : cur < 0 && i === 0 ? ' outer' : '';
      out += `<path class="sheet${cls}" d="M${ex},${cy - spread} L${fx},${cy} L${ex},${cy + spread}"/>`;
      const tx = ex + dir * 6;
      const anchor = rtl ? 'end' : 'start';
      const tc = i === cur ? ' class="cur"' : '';
      out += `<text${tc} x="${tx}" y="${cy - spread + 4}" text-anchor="${anchor}">${pairText(sh.leaves[0])}</text>`;
      out += `<text${tc} x="${tx}" y="${cy + spread + 4}" text-anchor="${anchor}">${pairText(sh.leaves[1])}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Схема тетради ${sig.no}">${out}</svg>`;
  }

  // ---------- Как собрать ----------
  function buildView() {
    if (plan.punch) return punchBuildView();
    const sigs = plan.signatures;
    const many = sigs.length > 1;
    const spine = st.rtl ? 'справа' : 'слева';
    const half = st.mode === 'booklet4';
    const pic = stepPics();
    const li = (p, title, text) => `<li><figure class="pic">${p}</figure><div><b>${title}</b><span>${text}</span></div></li>`;
    const steps = `
      <ol class="steps">
        ${li(pic.print, 'Скачайте PDF и напечатайте', printHint())}
        ${half ? li(pic.cut, 'Разрежьте листы пополам', 'Разрежьте всю стопку поперёк по засечкам — ножом по линейке или резаком. Верхние половинки — тетрадь с меньшим номером, нижние — следующая. Порядок в стопке не меняйте.') : ''}
        ${li(pic.stack, `Сложите ${half ? 'половинки' : 'листы'} стопкой`, `Листы одной тетради — стороной A вверх, лист 1 сверху, остальные под ним по порядку. Метка в углу подсказывает: «T1 · L3/6 · A» — тетрадь 1, лист 3, сторона A.`)}
        ${li(pic.fold, 'Согните пополам', `Согните всю стопку сразу так, чтобы лист 1 оказался снаружи. Проверьте: на обложке тетради 1 — страница ${numOf(0) ?? 'пусто'}.`)}
        ${many ? li(pic.join, 'Соберите тетради вместе', `Положите сложенные тетради по порядку: T1, T2, T3… Сгибы — в одну сторону, ${spine}. Выровняйте стопку постукиванием.`) : ''}
        ${li(pic.bind, 'Скрепите корешок', many
          ? 'Прошейте каждую тетрадь по сгибу (3–5 стежков) и сшейте тетради между собой. Или зажмите стопку, намажьте корешок клеем ПВА в 2 слоя и подклейте полоску ткани или плотной бумаги.'
          : 'Тонкую тетрадь можно скрепить степлером по сгибу (2–3 скобы) или прошить нитью.')}
        ${li(pic.cover, 'Обложка', plan.cover && plan.cover.items.length
          ? `Файл «обложка» напечатайте на плотной бумаге ${plan.cover.paper} (односторонняя печать, масштаб 100%). Обрежьте по уголкам-меткам, согните по меткам корешка, промажьте корешок блока клеем и оберните.`
          : 'Наклейте обложку из плотной бумаги. Готовую обложку из страниц манги можно выбрать в разделе «Обложка» слева.')}
      </ol>`;
    const stack = many ? `
      <h3 class="block-title">Книга целиком: тетради по порядку</h3>
      <div class="stack">${sigs.map((s) => `<div class="blk"><b>T${s.no}</b><span>${rangeText(s.from, s.to)}</span></div>`).join('')}</div>` : '';
    const cards = sigs.map((sig) => `
      <div class="sig-card">
        <h4>Тетрадь ${sig.no} · ${sig.sheets.length} ${plural(sig.sheets.length, half ? 'половинка' : 'лист', half ? 'половинки' : 'листа', half ? 'половинок' : 'листов')}</h4>
        <span class="hint">Вид сверху на сложенную тетрадь: каждая линия — один лист, согнутый пополам. Цифры — страницы на половинках листа.</span>
        ${butterfly(sig)}
        <ul>${sig.sheets.map((sh) => `<li>Лист ${sh.sheetInSig} <span>стр. ${pairText(sh.leaves[0])} и ${pairText(sh.leaves[1])}</span></li>`).join('')}</ul>
      </div>`).join('');
    return steps + coverBlock() + stack + `<h3 class="block-title">Схема каждой тетради</h3><div class="sig-cards">${cards}</div>`;
  }

  // Как собрать — дырокол: напечатать, разрезать стопку, сложить стопки по порядку, пробить, скрепить
  function punchBuildView() {
    const pic = punchPics();
    const four = st.mode === 'booklet4';
    const spine = st.rtl ? 'справа' : 'слева';
    const li = (p, title, text) => `<li><figure class="pic">${p}</figure><div><b>${title}</b><span>${text}</span></div></li>`;
    const N = plan.sheets.length;
    const piles = plan.sheets[0].leaves.map((lf, c) => {
      const nums = plan.sheets.map((sh) => sh.leaves[c]).filter(Boolean);
      return nums.length ? `<div class="blk"><b>${c + 1}</b><span>листки ${nums[0].no}–${nums[nums.length - 1].no}</span></div>` : '';
    }).join('');
    return `
      <ol class="steps">
        ${li(pic.print, 'Скачайте PDF и напечатайте', printHint())}
        ${li(pic.cut, four ? 'Разрежьте стопку на 4 части' : 'Разрежьте стопку пополам', `Не перекладывая листы, разрежьте всю стопку (${N} ${plural(N, 'лист', 'листа', 'листов')}) по засечкам — резаком или ножом по линейке. Получится ${four ? '4 стопки' : '2 стопки'}.`)}
        ${li(pic.stack, 'Сложите стопки по порядку', `Стопку ${four ? 'левого верхнего куска' : 'левых половинок'} — сверху, под ней ${four ? 'правую верхнюю, затем левую нижнюю и правую нижнюю' : 'правую'}. Листки сразу идут по порядку: сверху листок 1 со страницей ${numOf(0) ?? 'пусто'}.`)}
        ${li(pic.punch, 'Пробейте дыроколом', `Поле под дырокол — ${spine} у лицевой стороны листка (${st.punchMargin} мм). Пробивайте по 10–15 листков за раз, прижимая их к упору дырокола одинаково.`)}
        ${li(pic.bind, 'Скрепите', 'Наденьте листки на кольца, диски (тетрадь на дисках) или пружину. Клей и нитки не нужны, листки можно вынимать и добавлять.')}
        ${li(pic.cover, 'Обложка', plan.cover && plan.cover.items.length
          ? `Файл «обложка» напечатайте на плотной бумаге ${plan.cover.paper} с одной стороны, разрежьте по засечкам и пробейте так же: перед — первым, зад — последним.`
          : 'Положите сверху и снизу листки плотной бумаги или пластиковые обложки. Обложку из страниц манги можно выбрать в разделе «Обложка» слева.')}
      </ol>` + coverBlock() + `
      <h3 class="block-title">Стопки после разрезки — сверху вниз</h3>
      <div class="stack">${piles}</div>`;
  }

  // Плоские схемы к шагам для дырокола. У манги корешок справа.
  function punchPics() {
    const rtl = st.rtl;
    const four = st.mode === 'booklet4';
    const rect = (x, y, w, h, cls = 'k-p') => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5"/>`;
    const text = (x, y, s, cls = 'k-t') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="middle">${s}</text>`;
    const line = (x1, y1, x2, y2, cls = 'k-fold') => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    const arrow = (x1, y1, x2, y2) => {
      const ang = Math.atan2(y2 - y1, x2 - x1), l = 7, s = 0.45;
      return `<path class="k-ar" d="M${x1},${y1} L${x2},${y2}"/><path class="k-ah" d="M${x2},${y2} L${x2 - l * Math.cos(ang - s)},${y2 - l * Math.sin(ang - s)} L${x2 - l * Math.cos(ang + s)},${y2 - l * Math.sin(ang + s)}Z"/>`;
    };
    const svg = (body) => `<svg viewBox="0 0 200 120" aria-hidden="true">${body}</svg>`;
    // Дырки вдоль корешка листка
    const holes = (x, y, w, h, n = 4) => {
      const hx = rtl ? x + w - 5 : x + 5;
      return Array.from({ length: n }, (_, i) => `<circle class="k-hole" cx="${hx}" cy="${y + (h * (i + 0.5)) / n}" r="2"/>`).join('');
    };
    const leaf = (x, y, w, h, label, cls = 'k-p') => rect(x, y, w, h, cls) + holes(x, y, w, h) + (label ? text(x + w / 2, y + h / 2 + 5, label, 'k-num') : '');
    const first = numOf(0) ?? '';
    const n = (pos) => numOf(pos) ?? '';
    const sh = plan.sheets[0];
    const pics = {};
    pics.print = four
      ? svg(rect(66, 6, 68, 100) + line(100, 6, 100, 106, 'k-cut') + line(66, 56, 134, 56, 'k-cut')
        + [0, 1, 2, 3].map((c) => text(83 + (c % 2) * 34, 36 + Math.floor(c / 2) * 50, n(sh.front[c]), 'k-num')).join('')
        + text(100, 117, 'лист A4', 'k-cap'))
      : svg(rect(10, 22, 120, 76) + line(70, 22, 70, 98, 'k-cut')
        + text(40, 66, n(sh.front[0]), 'k-num') + text(100, 66, n(sh.front[1]), 'k-num')
        + text(70, 112, 'лицо листа 1', 'k-cap') + text(165, 66, '✂', 'k-scis'));
    pics.cut = four
      ? svg(rect(14, 14, 34, 44) + rect(52, 14, 34, 44) + rect(14, 62, 34, 44) + rect(52, 62, 34, 44)
        + [1, 2, 3, 4].map((k, i) => text(31 + (i % 2) * 38, 42 + Math.floor(i / 2) * 48, k, 'k-num')).join('')
        + text(100, 64, '✂', 'k-scis') + text(150, 64, '4 стопки', 'k-cap'))
      : svg(rect(14, 22, 56, 76) + rect(80, 22, 56, 76) + text(42, 66, '1', 'k-num') + text(108, 66, '2', 'k-num')
        + text(75, 14, '✂', 'k-scis') + text(168, 64, '2 стопки', 'k-cap'));
    pics.stack = svg(rect(110, 40, 56, 72, 'k-p k-back') + leaf(104, 34, 56, 72, first)
      + rect(24, 50, 44, 58, 'k-p k-alt') + text(46, 84, four ? '2–4' : '2', 'k-num')
      + rect(24, 8, 44, 38) + text(46, 32, '1', 'k-num') + arrow(74, 30, 98, 46) + arrow(74, 80, 98, 90)
      + text(46, 118, 'стопки', 'k-cap'));
    pics.punch = svg(rect(rtl ? 116 : 40, 20, 44, 84, 'k-p k-cov') + leaf(rtl ? 30 : 70, 26, 100, 72, '')
      + text(rtl ? 138 : 62, 14, 'дырокол', 'k-cap'));
    pics.bind = svg(leaf(56, 20, 92, 80, first) + Array.from({ length: 4 }, (_, i) => {
      const cx = rtl ? 56 + 92 - 5 : 61, cy = 20 + (80 * (i + 0.5)) / 4;
      return `<ellipse class="k-ring" cx="${cx}" cy="${cy}" rx="7" ry="5"/>`;
    }).join(''));
    pics.cover = svg(rect(20, 18, 70, 88, 'k-p k-cov') + holes(20, 18, 70, 88) + text(55, 66, 'перед', 'k-cap')
      + rect(110, 18, 70, 88, 'k-p k-cov') + holes(110, 18, 70, 88) + text(145, 66, 'зад', 'k-cap'));
    return pics;
  }

  // ---------- Картинки к шагам сборки ----------
  // Плоские схемы 200×120. Ход действий всегда слева направо; у манги зеркалятся только страницы и корешок.
  function stepPics() {
    const rtl = st.rtl;
    let flip = false;
    const X = (x, w = 0) => (flip ? 200 - x - w : x);
    const rect = (x, y, w, h, cls = 'k-p') => `<rect class="${cls}" x="${X(x, w)}" y="${y}" width="${w}" height="${h}" rx="1.5"/>`;
    const text = (x, y, s, cls = 'k-t') => `<text class="${cls}" x="${X(x)}" y="${y}" text-anchor="middle">${s}</text>`;
    const line = (x1, y1, x2, y2, cls = 'k-fold') => `<line class="${cls}" x1="${X(x1)}" y1="${y1}" x2="${X(x2)}" y2="${y2}"/>`;
    // Стрелка: кривая через (cx,cy) или прямая, с наконечником в конце
    const arrow = (x1, y1, x2, y2, cx, cy, cls = 'k-ar') => {
      const [a, b, c, d] = [X(x1), y1, X(x2), y2];
      const qx = cx === undefined ? a : X(cx), qy = cy === undefined ? b : cy;
      const path = cx === undefined ? `M${a},${b} L${c},${d}` : `M${a},${b} Q${qx},${qy} ${c},${d}`;
      const ang = Math.atan2(d - qy, c - qx), l = 7, s = 0.45;
      const head = `M${c},${d} L${c - l * Math.cos(ang - s)},${d - l * Math.sin(ang - s)} L${c - l * Math.cos(ang + s)},${d - l * Math.sin(ang + s)}Z`;
      return `<path class="${cls}" d="${path}"/><path class="k-ah" d="${head}"/>`;
    };
    const svg = (body) => `<svg viewBox="0 0 200 120" aria-hidden="true">${body}</svg>`;
    const n = (pos) => numOf(pos) ?? '';
    const sh = plan.signatures[0].sheets[0];
    // Лицо листа 1: [последняя | 1], оборот: [2 | предпоследняя]; у манги наоборот
    const face = [n(sh.leaves[1][1]), n(sh.leaves[0][0])];
    const back = [n(sh.leaves[0][1]), n(sh.leaves[1][0])];
    if (rtl) { face.reverse(); back.reverse(); }
    // Лист тетради с двумя страницами и линией сгиба
    const sheet = (x, y, w, h, nums, cls = 'k-p') =>
      rect(x, y, w, h, cls) + line(x + w / 2, y + 3, x + w / 2, y + h - 3)
      + (nums ? text(x + w / 4, y + h / 2 + 6, nums[0], 'k-num') + text(x + (3 * w) / 4, y + h / 2 + 6, nums[1], 'k-num') : '');
    // Сложенная тетрадь: корешок — жирная линия
    const booklet = (x, y, w, h, label, cls = 'k-p') =>
      rect(x + 3, y + 3, w, h, 'k-p k-back') + rect(x, y, w, h, cls) + line(x + (rtl ? w : 0), y, x + (rtl ? w : 0), y + h, 'k-spine') + (label ? text(x + w / 2, y + h / 2 + 5, label, 'k-num') : '');
    const half = st.mode === 'booklet4';
    const many = plan.signatures.length;
    const pics = {};

    pics.print = half
      ? svg(rect(66, 6, 68, 100) + line(100, 9, 100, 53) + line(100, 59, 100, 103) + line(70, 56, 130, 56, 'k-cut')
        + [0, 1].map((r) => [0, 1].map((c) => rect(71 + c * 31, 10 + r * 50, 27, 42, 'k-slot')).join('')).join('')
        + text(100, 117, 'лист A4', 'k-cap'))
      : svg(sheet(6, 22, 88, 60, face) + text(50, 98, 'лицо', 'k-cap')
        + sheet(106, 22, 88, 60, back, 'k-p k-alt') + text(150, 98, 'оборот', 'k-cap'));

    pics.cut = svg(rect(20, 4, 68, 50) + line(54, 8, 54, 50) + text(54, 34, 'T1', 'k-num')
      + rect(20, 66, 68, 50) + line(54, 70, 54, 112) + text(54, 96, 'T2', 'k-num')
      + line(10, 60, 98, 60, 'k-cut') + text(110, 64, '✂', 'k-scis')
      + arrow(128, 30, 160, 30) + booklet(166, 12, 28, 40, '') + arrow(128, 92, 160, 92) + booklet(166, 72, 28, 40, ''));

    pics.stack = svg(sheet(34, 34, 120, 72, null, 'k-p k-back') + sheet(27, 27, 120, 72, null, 'k-p k-back')
      + sheet(20, 20, 120, 72, face) + text(80, 14, 'лист 1 — сверху', 'k-cap'));

    // Сгиб: половина без стр. 1 уходит назад, стр. 1 остаётся на обложке тетради
    pics.fold = svg(sheet(6, 24, 100, 64, face)
      + (rtl ? arrow(82, 92, 30, 94, 60, 118, 'k-ar k-dash') : arrow(30, 92, 82, 94, 52, 118, 'k-ar k-dash'))
      + arrow(116, 56, 140, 56)
      + booklet(150, 24, 42, 64, face[rtl ? 0 : 1]));

    pics.join = svg(Array.from({ length: Math.min(many, 3) }, (_, j) => booklet(6 + j * 34, 34, 26, 44, `T${j + 1}`)).join('')
      + arrow(112, 56, 134, 56)
      + rect(150, 34, 36, 50, 'k-p k-back') + rect(147, 31, 36, 50, 'k-p k-back') + booklet(144, 28, 36, 50, 'T1'));

    const o = rtl ? -4 : 4;
    pics.bind = svg(rect(58 + 2 * o, 30, 70, 76, 'k-p k-back') + rect(58 + o, 26, 70, 76, 'k-p k-back') + rect(58, 22, 70, 76)
      + ((g) => line(g, 22, g, 98, 'k-glue') + [34, 50, 66, 82].map((y) => line(g - 6, y, g + 6, y, 'k-stitch')).join('')
        + text(rtl ? g + 26 : g - 28, 64, 'клей', 'k-cap'))(rtl ? 128 : 58));

    // Обложка: задняя часть, корешок, передняя; блок кладём на заднюю и оборачиваем переднюю
    flip = rtl;
    pics.cover = svg(rect(4, 46, 86, 64, 'k-p k-cov') + rect(90, 46, 14, 64, 'k-p k-cov k-sp') + rect(104, 46, 86, 64, 'k-p k-cov')
      + rect(14, 52, 74, 52, 'k-p k-back') + rect(12, 50, 76, 52) + line(88, 50, 88, 102, 'k-glue')
      + arrow(150, 40, 50, 40, 100, -6));
    return pics;
  }


  // ---------- Готовая книга ----------
  // Развороты: [левая, правая]. 'F' и 'B' — передняя и задняя обложка (если печатается отдельно).
  function spreads() {
    const seq = plan.seq;
    const c = plan.cover;
    const out = [];
    if (c && c.items.length) out.push([-1, 'F']);
    out.push([-1, 0]);
    for (let i = 1; i < seq.length; i += 2) out.push([i, i + 1 < seq.length ? i + 1 : -1]);
    if (c && (c.wrap || c.items.some((it) => it.panel === c.back))) out.push(['B', -1]);
    // У манги всё зеркально: первая страница справа налево
    return out.map(([a, b]) => (st.rtl ? [b, a] : [a, b]));
  }

  // Обложка в «Готовой книге»: показываем её часть, которая попадёт на переднюю или заднюю сторону
  function coverFace(which) {
    const c = plan.cover;
    const P = which === 'F' ? c.front : c.back;
    const it = c.items.find((x) => x.panel === P) || (c.wrap ? c.items[0] : null);
    if (!it) return '<div class="blank">нет обложки</div>';
    const R = it.R;
    const style = `left:${((R.x - P.x) / P.w) * 100}%;top:${((P.y + P.h - R.y - R.h) / P.h) * 100}%;width:${(R.w / P.w) * 100}%;height:${(R.h / P.h) * 100}%`;
    return `<div class="pg cover-face"><div class="cov-in" style="${style}">${pageImg(it.src)}</div></div>`;
  }

  function bookFace(pos) {
    if (pos === 'F' || pos === 'B') return coverFace(pos);
    if (pos < 0 || pos >= plan.seq.length) return '';
    const src = plan.seq[pos];
    if (src === null) return '<div class="blank">пусто</div>';
    return fitPage(meta[src], bookRatio, `<span class="num">${src + 1}</span>`);
  }

  // Пропорции страницы готовой книги (A5, A6…)
  let bookRatio = 0.7;

  function bookView() {
    const sp = spreads();
    bookIdx = clamp(bookIdx, 0, sp.length - 1);
    const s = sp[bookIdx];
    const bp = C.bookPageSize(st);
    bookRatio = bp.w / bp.h;
    const ratio = bookRatio;
    const face = (cls, pos) => `<div class="b-page ${cls}${pos < 0 ? ' empty' : ''}" id="${cls === 'left' ? 'bl' : 'br'}">${bookFace(pos)}</div>`;
    return `
      <div class="flipbook">
        <div class="v-nav">
          <button class="btn" data-b="left">◀ ${st.rtl ? 'Дальше' : 'Назад'}</button>
          <div class="v-title"><b id="bTitle">${bookTitle(sp)}</b><span>${plan.punch ? 'Готовая книга на кольцах или дисках' : 'Готовая книга после складывания и склейки'}</span></div>
          <button class="btn" data-b="right">${st.rtl ? 'Назад' : 'Дальше'} ▶</button>
        </div>
        <div class="book" id="book" style="--ar:${(ratio * 2).toFixed(4)}">
          ${face('left', s[0])}
          ${face('right', s[1])}
          <div class="spine${s[0] < 0 || s[1] < 0 ? ' off' : ''}" id="spine"></div>
          <div class="leaf" id="leaf" hidden><div class="lf lf-front"></div><div class="lf lf-back"></div></div>
        </div>
        <label class="v-scrub${st.rtl ? ' rtl' : ''}"><span>${st.rtl ? 'конец' : 'начало'}</span><input type="range" min="1" max="${sp.length}" value="${bookIdx + 1}" data-b="scrub"><span>${st.rtl ? 'начало' : 'конец'}</span></label>
        <p class="hint center">Листайте кнопками, стрелками ← → или щелчком по странице.${st.rtl ? ' Манга листается справа налево.' : ''}</p>
      </div>`;
  }

  function bookTitle(sp) {
    const s = sp[bookIdx];
    const tail = ` · ${bookIdx + 1} из ${sp.length}`;
    if (s.includes('F')) return 'Передняя обложка' + tail;
    if (s.includes('B')) return 'Задняя обложка' + tail;
    const what = bookIdx === 0 || sp[bookIdx - 1].includes('F') ? 'Первая страница'
      : bookIdx === sp.length - 1 && (s[0] < 0 || s[1] < 0) ? 'Последняя страница' : 'Разворот';
    const nums = (st.rtl ? [s[1], s[0]] : s).filter((p) => p >= 0).map((p) => (numOf(p) === null ? 'пусто' : numOf(p)));
    return `${what}: стр. ${nums.join(' и ')}${tail}`;
  }

  function prefetchBook() {
    const sp = spreads();
    for (const d of [1, -1, 2]) if (sp[bookIdx + d]) prefetch(sp[bookIdx + d].filter((p) => p >= 0));
  }

  function setFace(el, pos) {
    el.innerHTML = bookFace(pos);
    el.classList.toggle('empty', pos < 0);
    fillThumbs(el);
  }

  // Перелистывание. visual: +1 — лист уходит справа налево, -1 — слева направо.
  function turnVisual(visual) {
    // Для обычной книги «дальше» — справа налево, для манги — наоборот
    turn(st.rtl ? -visual : visual, visual);
  }

  function turn(delta, visual) {
    if (turning) return;
    const sp = spreads();
    const j = bookIdx + delta;
    if (j < 0 || j >= sp.length) return;
    const S = sp[bookIdx], T = sp[j];
    const leaf = $('#leaf'), L = $('#bl'), R = $('#br');
    if (!leaf) return;
    const [front, back] = leaf.children;
    const fill = (el, pos) => { el.innerHTML = bookFace(pos); el.classList.toggle('empty', pos < 0); };
    if (visual > 0) {
      setFace(R, T[1]);
      fill(front, S[1]);
      fill(back, T[0]);
      leaf.className = 'leaf to-left';
    } else {
      setFace(L, T[0]);
      fill(front, S[0]);
      fill(back, T[1]);
      leaf.className = 'leaf to-right';
    }
    fillThumbs(leaf);
    $('#spine').classList.add('off');
    leaf.hidden = false;
    turning = true;
    leaf.style.transition = 'none';
    leaf.style.transform = 'rotateY(0deg)';
    void leaf.offsetWidth;
    leaf.style.transition = 'transform .75s cubic-bezier(.45,.05,.3,1)';
    leaf.style.transform = `rotateY(${visual > 0 ? -180 : 180}deg)`;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      if (visual > 0) setFace(L, T[0]); else setFace(R, T[1]);
      leaf.hidden = true;
      bookIdx = j;
      turning = false;
      $('#spine').classList.toggle('off', T[0] < 0 || T[1] < 0);
      $('#bTitle').textContent = bookTitle(sp);
      const r = $('input[data-b="scrub"]');
      if (r) r.value = bookIdx + 1;
      prefetchBook();
    };
    leaf.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 1000);
  }

  // ---------- События вкладок ----------
  function onTabClick(e) {
    const v = e.target.closest('[data-v]');
    if (v && v.tagName === 'BUTTON') {
      if (v.dataset.v === 'flip') flipSheet();
      if (v.dataset.v === 'next') stepSide(1);
      if (v.dataset.v === 'prev') stepSide(-1);
      return;
    }
    if (e.target.closest('#card')) { flipSheet(); return; }
    const chip = e.target.closest('[data-side]');
    if (chip) {
      const k = +chip.dataset.side;
      vSheet = Math.floor(k / 2);
      vBack = k % 2 === 1;
      renderTab();
      return;
    }
    const b = e.target.closest('button[data-b]');
    if (b) { turnVisual(b.dataset.b === 'right' ? 1 : -1); return; }
    if (e.target.closest('#br')) turnVisual(1);
    else if (e.target.closest('#bl')) turnVisual(-1);
  }

  function onTabInput(e) {
    const t = e.target;
    if (t.dataset.v === 'scrub') { vSheet = +t.value - 1; vBack = false; renderTab(); }
    if (t.dataset.b === 'scrub') { bookIdx = +t.value - 1; renderTab(); }
  }

  function onKey(e) {
    if (e.target.closest('input, select, textarea') || !plan || plan.error || $('#work').hidden) return;
    if (tab === 'viewer') {
      if (e.key === 'ArrowRight') stepSide(1);
      else if (e.key === 'ArrowLeft') stepSide(-1);
      else if (e.key === ' ') flipSheet();
      else return;
      e.preventDefault();
    } else if (tab === 'book') {
      if (e.key === 'ArrowRight') turnVisual(1);
      else if (e.key === 'ArrowLeft') turnVisual(-1);
      else return;
      e.preventDefault();
    }
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  // ---------- Сохранение ----------
  async function imageBytes(im) {
    // Формат смотрим по содержимому: сайты отдают AVIF/WebP под именем .jpg
    const raw = new Uint8Array(await im.blob.arrayBuffer());
    if (raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) return { bytes: raw, mime: 'image/jpeg' };
    if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) return { bytes: raw, mime: 'image/png' };
    // webp, avif, bmp, gif — переводим в JPEG
    L.debug('pdf', `${im.name}: внутри не JPEG/PNG (первые байты ${[...raw.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}), перевожу в JPEG`);
    const bmp = await createImageBitmap(im.blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' };
  }

  async function save() {
    if (!plan || plan.error) return;
    busy(true, 'Собираю PDF…', 0);
    const t0 = Date.now();
    L.info('pdf', `Собираю PDF «${bookTitleText()}»: ${files.length} файлов`, { настройки: st, листов: plan.sheets && plan.sheets.length, тетрадей: plan.signatures && plan.signatures.length });
    try {
      const data = [];
      for (const f of files) {
        if (f.kind === 'images') {
          const images = [];
          for (const im of f.images) images.push(await imageBytes(im));
          data.push({ kind: 'images', images });
        } else {
          data.push({ kind: 'pdf', bytes: f.file ? new Uint8Array(await f.file.arrayBuffer()) : f.bytes.slice() });
        }
      }
      L.info('pdf', `Картинки подготовлены за ${Date.now() - t0} мс`);
      const res = await C.generate(PDFLib, data, meta, st, async (p) => {
        busy(true, `Собираю PDF… ${Math.round(p * 100)}%`, p);
        await new Promise((r) => setTimeout(r));
      });
      busy(true, 'Сохраняю…', 1);
      const base = bookTitleText().replace(/[\\/:*?"<>|]+/g, ' ').trim() || I18N.t('Книга');
      const names = [];
      if (res.back) {
        download(res.main, I18N.t('{0} — лицевые.pdf', base));
        setTimeout(() => download(res.back, I18N.t('{0} — обороты.pdf', base)), 600);
        names.push('«лицевые»', '«обороты»');
      } else {
        download(res.main, I18N.t('{0} — для печати.pdf', base));
        names.push('«для печати»');
      }
      if (res.cover) {
        setTimeout(() => download(res.cover, I18N.t('{0} — обложка.pdf', base)), 1200);
        names.push('«обложка»');
      }
      L.info('pdf', `Готово за ${((Date.now() - t0) / 1000).toFixed(1)} с: ${names.join(', ')}`, { основной: res.main.length, обороты: res.back && res.back.length, обложка: res.cover && res.cover.length });
      toast(`Готово! Скачано: ${names.join(', ')}.`);
    } catch (e) {
      L.error('pdf', 'Не получилось собрать PDF', e);
      toast('Не получилось собрать PDF: ' + e.message);
    } finally {
      busy(false);
    }
  }

  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- Мелочи интерфейса ----------
  function busy(on, text, p) {
    $('#busy').hidden = !on;
    if (text) $('#busyText').textContent = text;
    if (p !== undefined) $('#busyBar').style.width = Math.round(p * 100) + '%';
  }

  let toastTimer = 0;
  function toast(msg) {
    L.info('подсказка', msg);
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function setZoom(v) {
    zoom = v;
    document.documentElement.style.setProperty('--sheet-w', v + 'px');
    $('#zoom').value = v;
    store.set('booklet.zoom', v);
  }

  // ---------- Оформление: дизайны целиком + светлая/тёмная ----------
  // Каждый дизайн — свой файл designs/<id>.css, правила включаются атрибутом html[data-design].
  // «Классика» живёт в style.css и работает без атрибута. Новый дизайн: файл в designs/, <link> в index.html и строка здесь.
  const DESIGNS = [
    ['mat', 'Стол переплётчика'],
    ['print', 'Печатный цех'],
    ['strict', 'Строгий'],
    ['classic', 'Классика'],
  ];
  const MODES = [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']];

  function applyDesign(design, mode) {
    const root = document.documentElement;
    if (design === 'classic') delete root.dataset.design; else root.dataset.design = design;
    if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme;
  }

  function initThemes() {
    const sel = $('#theme'), modeSel = $('#themeMode');
    const fill = (el, list) => { el.innerHTML = list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(''); };
    fill(sel, DESIGNS);
    fill(modeSel, MODES);
    // Раньше здесь хранилась палитра или «light/dark» — переносим режим, дизайн берём по умолчанию
    const old = store.get('booklet.theme', 'auto');
    const design = store.get('booklet.design', DESIGNS[0][0]);
    const mode = store.get('booklet.mode', old === 'light' || old === 'dark' ? old : 'auto');
    sel.value = DESIGNS.some(([v]) => v === design) ? design : DESIGNS[0][0];
    modeSel.value = MODES.some(([v]) => v === mode) ? mode : 'auto';
    applyDesign(sel.value, modeSel.value);
    const save = () => { applyDesign(sel.value, modeSel.value); store.set('booklet.design', sel.value); store.set('booklet.mode', modeSel.value); };
    sel.addEventListener('change', save);
    modeSel.addEventListener('change', save);
  }

  // Для окна скачивания (настольная версия)
  window.MangaForge = {
    addInputs,
    setTitle: (t) => { title = t; $('#title').value = t; },
    toast,
  };

  function init() {
    initThemes();
    bindControls();
    syncControls();
    setZoom(zoom);

    const input = $('#fileInput');
    const folder = $('#folderInput');
    const pick = () => input.click();
    const pickFolder = () => folder.click();
    $('#btnOpen').addEventListener('click', pick);
    $('#btnPick').addEventListener('click', pick);
    $('#btnAdd').addEventListener('click', pick);
    $('#btnPickFolder').addEventListener('click', pickFolder);
    $('#btnAddFolder').addEventListener('click', pickFolder);
    input.addEventListener('change', () => { addInputs([...input.files].map((file) => ({ file, path: file.name }))); input.value = ''; });
    folder.addEventListener('change', () => { addInputs([...folder.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }))); folder.value = ''; });
    $('#btnDemo').addEventListener('click', loadDemo);
    $('#btnSave').addEventListener('click', save);
    $('#btnAutoCrop').addEventListener('click', autoCrop);
    $('#btnSortFiles').addEventListener('click', () => {
      sortFiles();
      rebuildMeta();
      update();
      toast('Главы расставлены по томам и номерам.');
    });
    $('#zoom').addEventListener('input', (e) => setZoom(+e.target.value));
    $('#title').addEventListener('input', (e) => { title = e.target.value; });

    // Обложка: номер страницы или быстрые кнопки
    $('#coverFront').addEventListener('change', (e) => setCover('front', parseInt(e.target.value, 10) || 0));
    $('#coverBack').addEventListener('change', (e) => setCover('back', parseInt(e.target.value, 10) || 0));
    for (const b of $$('[data-cv]')) {
      b.addEventListener('click', () => {
        const [which, what] = b.dataset.cv.split('-');
        // «последняя» — последняя страница без половинок разворота
        let n = 0;
        if (what === 'first') n = 1;
        if (what === 'last') n = meta.length;
        setCover(which, n);
      });
    }
    $('#btnCropReset').addEventListener('click', () => {
      Object.assign(st, { cropL: 0, cropR: 0, cropT: 0, cropB: 0 });
      syncControls();
      update();
    });
    $('#btnReset').addEventListener('click', () => {
      st = { ...C.DEFAULTS };
      coverKeys.front = coverKeys.back = null;
      rebuildMeta();
      syncControls();
      update();
    });
    $('#fileList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const id = +b.dataset.id;
      if (b.dataset.act === 'del') removeFile(id);
      if (b.dataset.act === 'up') moveFile(id, -1);
      if (b.dataset.act === 'down') moveFile(id, 1);
    });
    for (const b of $$('.tabs button')) {
      b.addEventListener('click', () => { tab = b.dataset.tab; store.set('booklet.tab', tab); renderTab(); });
    }
    $('#tabContent').addEventListener('click', onTabClick);
    $('#tabContent').addEventListener('input', onTabInput);
    document.addEventListener('keydown', onKey);

    // Перетаскивание файлов и папок в окно
    let depth = 0;
    const veil = $('#dropveil');
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; veil.classList.add('on'); });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('on'); });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      veil.classList.remove('on');
      addInputs(await collectDropped(e.dataTransfer));
    });

    update();
    // index.html#demo сразу открывает пример, #demo/build — с нужной вкладкой
    const m = location.hash.match(/^#demo(?:\/(\w+))?/);
    if (m) {
      if (m[1]) tab = m[1];
      loadDemo();
    }
  }

  init();
})();
