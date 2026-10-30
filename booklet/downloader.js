// Скачивание манги по ссылке (только настольная версия: window.mfDownload из desktop/preload.js).
(function () {
  'use strict';
  const api = window.mfDownload;
  if (!api) return;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dlg = $('#dl');
  let info = null;      // ответ загрузчика: название, главы
  let url = '';
  let chapters = [];    // [{link, name, vol, ch, folder, on, saved}]
  let lastClicked = -1;
  let cancel = false;
  let running = false;
  let minimized = false;

  for (const id of ['#btnFromUrl', '#btnFromUrl2']) {
    const b = $(id);
    b.hidden = false;
    b.addEventListener('click', open);
  }

  // При первом запуске скрипты сайтов скачиваются с GitHub FMD — показываем, сколько осталось
  const statusTimer = setInterval(async () => {
    const s = await api.status();
    if (s.ready) { clearInterval(statusTimer); return; }
    $('#dlHint').textContent = s.error
      ? `Не удалось скачать скрипты сайтов с GitHub FMD: ${s.error}. Проверьте интернет и перезапустите программу.`
      : `Скачиваю скрипты сайтов с GitHub FMD${s.total ? `: ${s.done} из ${s.total}` : '…'} Это нужно один раз.`;
  }, 500);

  api.sites().then((list) => {
    if (!list.length) return;
    const ru = ['ReadManga', 'MintManga', 'SeiManga', 'SelfMangaRU', 'MangaChan', 'MangaLib', 'Desu', 'RuMIX'];
    const names = list.map((s) => s.name);
    const shown = ru.filter((n) => names.includes(n));
    $('#dlHint').textContent = `Работает на скриптах FMD: ${list.length} сайтов, среди них ${shown.join(', ')} и другие. Вставьте ссылку на страницу манги (не главы).`;
  });

  function open() {
    minimized = false;
    $('#dlPill').hidden = true;
    if (!dlg.open) dlg.showModal();
    if (!running) { $('#dlUrl').focus(); $('#dlUrl').select(); }
  }
  // Свернуть: окно прячется, скачивание идёт дальше, внизу справа — маленькая панель
  function minimize() {
    minimized = true;
    dlg.close();
    $('#dlPill').hidden = false;
  }
  $('#dlMin').addEventListener('click', minimize);
  $('#dlClose').addEventListener('click', () => { if (running) minimize(); else dlg.close(); });
  dlg.addEventListener('cancel', (e) => { if (running) { e.preventDefault(); minimize(); } });
  $('#dlPillOpen').addEventListener('click', open);
  $('#dlPillStop').addEventListener('click', () => { cancel = true; $('#dlPillText').textContent = 'Останавливаю…'; });

  // Имя папки для Windows: без запрещённых знаков, точек и пробелов в конце
  const safe = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[. ]+$/, '') || 'manga';

  // Папка загрузок: каждая манга — в своей папке по названию, внутри — папки глав
  const showFolder = (p) => { $('#dlFolder').textContent = p; $('#dlFolder').title = p; };
  api.folder().then(showFolder);
  $('#dlPick').addEventListener('click', async () => {
    const p = await api.pickFolder();
    if (!p) return;
    showFolder(p);
    if (info) await markSaved();
  });
  $('#dlOpen').addEventListener('click', () => api.openFolder(info ? safe(info.title) : ''));

  $('#dlUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
  $('#dlFind').addEventListener('click', find);

  function status(text, p) {
    $('#dlStatus').textContent = text || '';
    $('#dlBarWrap').hidden = p === undefined;
    if (p !== undefined) $('#dlBar').style.width = Math.round(p * 100) + '%';
    if (running) {
      $('#dlPillText').textContent = text || '';
      $('#dlPillBar').style.width = Math.round((p || 0) * 100) + '%';
    }
  }

  // Том и глава: из названия («Том 2 Глава 7», «Vol.1 Ch.3») или из ссылки (/vol2/7, _v1_ch3)
  function parseKey(name, link) {
    const n = (re, s) => { const m = re.exec(s); return m ? parseFloat(m[1].replace(',', '.')) : null; };
    let vol = n(/(?:том|vol(?:ume)?\.?|т\.)\s*(\d+(?:[.,]\d+)?)/i, name);
    let ch = n(/(?:глава|гл\.|ch(?:apter)?\.?|chap\.?)\s*(\d+(?:[.,]\d+)?)/i, name);
    if (vol === null) vol = n(/(?:\/vol|_v|\/v)(\d+)(?=[/_])/i, link);
    if (ch === null) ch = n(/\/vol\d+\/(\d+(?:\.\d+)?)/i, link) ?? n(/_ch_?(\d+(?:\.\d+)?)/i, link) ?? n(/chapter[-_/]?(\d+(?:\.\d+)?)/i, link);
    return { vol, ch };
  }

  async function find() {
    url = $('#dlUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { status('Вставьте ссылку, начинающуюся с https://'); return; }
    status('Ищу мангу…');
    $('#dlFind').disabled = true;
    $('#dlInfo').hidden = true;
    $('#dlTools').hidden = true;
    $('#dlList').innerHTML = '';
    $('#dlGo').disabled = true;
    try {
      info = await api.info(url);
      if (!info.chapters.length) {
        status(info.code === 1 ? 'Сайт не ответил. Проверьте, открывается ли он в браузере.' : 'Глав не нашлось. Возможно, сайт требует входа в аккаунт или поменял вёрстку.');
        return;
      }
      chapters = info.chapters.map((c, i) => {
        const k = parseKey(c.name, c.link);
        const label = k.vol !== null && k.ch !== null ? `Том ${k.vol} Глава ${k.ch}` : k.ch !== null ? `Глава ${k.ch}` : `Глава ${i + 1}`;
        // Папка главы: номер для правильного порядка + название с сайта
        const rest = c.name.replace(/^(?:том|vol\.?)\s*\d+\s*(?:глава|ch\.?)\s*\d+(?:[.,]\d+)?\s*[-–:.]?\s*/i, '');
        return { ...c, ...k, label, folder: safe(rest && rest !== c.name ? `${label} ${rest}` : label), on: true, saved: false };
      });
      $('#dlTitle').textContent = info.title;
      $('#dlMeta').textContent = [info.site, info.authors, `${chapters.length} глав`].filter(Boolean).join(' · ');
      $('#dlInfo').hidden = false;
      loadCover();
      await markSaved();
      renderList();
      const n = chapters.filter((c) => c.saved).length;
      status(n ? `${n} из ${chapters.length} глав уже есть в папке — их не будем качать заново.` : '');
    } catch (e) {
      status(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      $('#dlFind').disabled = false;
    }
  }

  // Какие главы уже лежат в папке — их не качаем повторно
  async function markSaved() {
    const root = safe(info.title);
    const has = await api.hasChapters(chapters.map((c) => `${root}/${c.folder}`));
    chapters.forEach((c, i) => { c.saved = has[i]; });
    if ($('#dlList').children.length) renderList();
  }

  async function loadCover() {
    const img = $('#dlCover');
    img.removeAttribute('src');
    if (!info.cover) return;
    try {
      const r = await api.image(url, '', info.cover);
      if (r) img.src = URL.createObjectURL(new Blob([r.bytes], { type: r.mime || 'image/jpeg' }));
    } catch { /* без обложки */ }
  }

  function renderList() {
    const vols = [...new Set(chapters.map((c) => c.vol))];
    const hasVols = vols.length > 1 || vols[0] !== null;
    $('#dlVols').innerHTML = hasVols
      ? 'Тома: ' + vols.map((v) => `<button class="chip" data-vol="${v}">${v === null ? 'без тома' : v}</button>`).join('')
      : '';
    $('#dlTools').hidden = false;
    let html = '';
    let prevVol;
    chapters.forEach((c, i) => {
      if (hasVols && c.vol !== prevVol) { html += `<div class="dl-vol">${c.vol === null ? 'Без тома' : 'Том ' + c.vol}</div>`; prevVol = c.vol; }
      html += `<label class="dl-ch"><input type="checkbox" data-i="${i}" ${c.on ? 'checked' : ''}><span>${esc(c.name || c.label)}</span>${c.saved ? '<span class="done">✓ уже скачана</span>' : ''}</label>`;
    });
    $('#dlList').innerHTML = html;
    sync();
  }

  function sync() {
    dlg.classList.toggle('running', running);
    if (running) { $('#dlGo').disabled = false; $('#dlGo').textContent = 'Остановить'; return; }
    const n = chapters.filter((c) => c.on).length;
    $('#dlGo').disabled = !n;
    $('#dlGo').textContent = n ? `Скачать ${n} ${plural(n, 'главу', 'главы', 'глав')}` : 'Скачать';
    for (const b of document.querySelectorAll('#dlVols [data-vol]')) {
      const v = b.dataset.vol === 'null' ? null : parseFloat(b.dataset.vol);
      const list = chapters.filter((c) => c.vol === v);
      b.classList.toggle('on', list.every((c) => c.on));
    }
  }
  const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

  // Галочки: Shift — выделить диапазон
  $('#dlList').addEventListener('click', (e) => {
    const cb = e.target.closest('input[data-i]');
    if (!cb || running) { if (cb) e.preventDefault(); return; }
    const i = +cb.dataset.i;
    if (e.shiftKey && lastClicked >= 0) {
      const [a, b] = [Math.min(i, lastClicked), Math.max(i, lastClicked)];
      for (let k = a; k <= b; k++) chapters[k].on = cb.checked;
      for (const x of document.querySelectorAll('#dlList input[data-i]')) x.checked = chapters[+x.dataset.i].on;
    } else chapters[i].on = cb.checked;
    lastClicked = i;
    sync();
  });
  $('#dlTools').addEventListener('click', (e) => {
    if (running) return;
    const s = e.target.closest('[data-sel]');
    const v = e.target.closest('[data-vol]');
    if (s) chapters.forEach((c) => { c.on = s.dataset.sel === 'all'; });
    else if (v) {
      const vol = v.dataset.vol === 'null' ? null : parseFloat(v.dataset.vol);
      const list = chapters.filter((c) => c.vol === vol);
      const on = !list.every((c) => c.on);
      list.forEach((c) => { c.on = on; });
    } else return;
    for (const x of document.querySelectorAll('#dlList input[data-i]')) x.checked = chapters[+x.dataset.i].on;
    sync();
  });

  const extOf = (mime, src) => {
    const m = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[mime];
    return m || ((/\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i.exec(src) || [])[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  };
  const mimeOf = (name) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' }[name.split('.').pop().toLowerCase()] || 'image/jpeg');

  $('#dlGo').addEventListener('click', () => {
    if (running) { cancel = true; status('Останавливаю…'); } else download();
  });

  async function download() {
    const list = chapters.filter((c) => c.on);
    if (!list.length) return;
    running = true; cancel = false;
    $('#dlFind').disabled = true;
    $('#dlPick').disabled = true;
    sync();
    const root = safe(info.title);
    const items = [];
    const failed = [];
    try {
      for (let ci = 0; ci < list.length && !cancel; ci++) {
        const c = list[ci];
        const rel = `${root}/${c.folder}`;
        // Уже скачана — берём с диска
        if (c.saved) {
          status(`Глава ${ci + 1} из ${list.length}: беру из папки…`, ci / list.length);
          const files = await api.readChapter(rel);
          if (files.length) {
            for (const f of files) items.push({ file: new File([f.bytes], f.name, { type: mimeOf(f.name) }), path: `${rel}/${f.name}` });
            continue;
          }
        }
        status(`Глава ${ci + 1} из ${list.length}: ищу страницы…`, ci / list.length);
        let pages = [];
        // Сайты иногда отдают обрезанную страницу — пробуем ещё раз
        for (let attempt = 0; attempt < 3 && !pages.length && !cancel; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
          try { pages = (await api.pages(url, c.link)).pages; } catch { /* повтор */ }
        }
        if (!pages.length) { if (!cancel) failed.push(c.name || c.label); continue; }
        const width = Math.max(3, String(pages.length).length);
        const got = new Array(pages.length);
        let done = 0, next = 0;
        // 4 картинки одновременно — быстро и без лишней нагрузки на сайт; каждую сразу на диск
        const worker = async () => {
          while (next < pages.length && !cancel) {
            const k = next++;
            for (let attempt = 0; attempt < 3 && !got[k]; attempt++) {
              try { got[k] = await api.image(url, c.link, pages[k]); } catch { /* повтор */ }
            }
            if (got[k]) {
              got[k].name = String(k + 1).padStart(width, '0') + '.' + extOf(got[k].mime, pages[k]);
              try { await api.save(`${rel}/${got[k].name}`, got[k].bytes); } catch (e) { failed.push(`запись на диск: ${e.message}`); cancel = true; }
            }
            done++;
            status(`Глава ${ci + 1} из ${list.length}: страница ${done} из ${pages.length}`, (ci + done / pages.length) / list.length);
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        got.forEach((r) => { if (r) items.push({ file: new File([r.bytes], r.name, { type: r.mime || 'image/jpeg' }), path: `${rel}/${r.name}` }); });
        if (got.length && got.every(Boolean)) c.saved = true;
        else if (!cancel) failed.push(`${c.name || c.label} (не все страницы)`);
      }
    } finally {
      running = false;
      $('#dlFind').disabled = false;
      $('#dlPick').disabled = false;
      renderList();
    }
    const wasMin = minimized;
    const note = failed.length ? ` Не скачались: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? ` и ещё ${failed.length - 3}` : ''}.` : '';
    const where = `Сохранено в папку «${root}».`;
    if (!items.length) { finish(cancel ? 'Остановлено.' : 'Ничего не скачалось. Возможно, сайт не отдаёт картинки.' + note, wasMin); return; }
    if ($('#dlAdd').checked) {
      if (dlg.open) dlg.close();
      $('#dlPill').hidden = true;
      await window.MangaForge.addInputs(items);
      window.MangaForge.setTitle(info.title);
      finish((cancel ? 'Остановлено — в книгу добавлено то, что успело скачаться. ' : 'Готово, главы в книге. ') + where + note, true);
    } else {
      finish((cancel ? 'Остановлено. ' : 'Готово. ') + where + note, wasMin);
    }
  }

  // Итог: в окне, а если оно свёрнуто или уже закрыто — во всплывающей подсказке
  function finish(text, outside) {
    $('#dlPill').hidden = true;
    minimized = false;
    if (outside) window.MangaForge.toast(text);
    else status(text);
  }
})();
