// Журнал событий. В настольной версии — в файл (window.mfLog из desktop/preload.js) и окно «Журнал»,
// в браузере — только в консоль.
(function () {
  'use strict';
  const bridge = window.mfLog;

  // Ошибки и прочие объекты превращаем в то, что можно передать в основной процесс
  const plain = (v) => {
    if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
    if (v === undefined || v === null || typeof v !== 'object') return v;
    try { return JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Error ? x.stack || x.message : x instanceof Blob ? `<${x.type} ${x.size} байт>` : x))); } catch { return String(v); }
  };
  const write = (level) => (source, msg, data) => {
    if (bridge) bridge.write(level, source, plain(msg), plain(data));
    else (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(`[${source}]`, msg, data ?? '');
  };
  const log = { debug: write('DEBUG'), info: write('INFO'), warn: write('WARN'), error: write('ERROR') };
  window.mfLogger = log;

  // «Script error.» без подробностей — чужой скрипт; в настольной версии его и так запишет консоль
  window.addEventListener('error', (e) => e.error || e.message !== 'Script error.' ? log.error('страница', `Ошибка: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno})`, e.error) : null);
  window.addEventListener('unhandledrejection', (e) => log.error('страница', 'Необработанный отказ промиса', e.reason));

  if (!bridge) return;

  // ---------- Окно «Журнал» ----------
  const $ = (s) => document.querySelector(s);
  const btn = $('#btnLog');
  const dlg = $('#logDlg');
  const list = $('#logList');
  btn.hidden = false;
  let lines = [];
  let filter = 'main';
  let query = '';
  let unseenErrors = 0;

  const RANK = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmt = (e) => { const d = new Date(e.t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${e.level.padEnd(5)} [${e.source}] ${e.text}`; };
  const visible = (e) => (filter === 'all' || (filter === 'main' && RANK[e.level] >= 1) || (filter === 'errors' && RANK[e.level] >= 2))
    && (!query || fmt(e).toLowerCase().includes(query));

  function row(e) {
    const div = document.createElement('div');
    div.className = 'log-row ' + e.level.toLowerCase();
    div.textContent = fmt(e);
    return div;
  }
  function render() {
    const shown = lines.filter(visible);
    const frag = document.createDocumentFragment();
    // Тысячи строк DOM тормозят — показываем последние 3000 подходящих
    for (const e of shown.slice(-3000)) frag.appendChild(row(e));
    list.replaceChildren(frag);
    $('#logCount').textContent = `${shown.length} из ${lines.length}`;
    list.scrollTop = list.scrollHeight;
  }
  function badge() {
    btn.textContent = unseenErrors ? `Журнал · ${unseenErrors}` : 'Журнал';
    btn.classList.toggle('has-errors', unseenErrors > 0);
    btn.title = unseenErrors ? `Новых ошибок: ${unseenErrors}. Ctrl+Shift+L` : 'Что происходит в программе. Ctrl+Shift+L';
  }

  bridge.onEntry((e) => {
    lines.push(e);
    if (lines.length > 5000) lines.splice(0, lines.length - 5000);
    if (e.level === 'ERROR' && !dlg.open) { unseenErrors++; badge(); }
    if (!dlg.open || !visible(e)) return;
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.appendChild(row(e));
    if (list.children.length > 3000) list.firstChild.remove();
    if (stick) list.scrollTop = list.scrollHeight;
  });

  async function show() {
    lines = await bridge.recent();
    unseenErrors = 0;
    badge();
    $('#logPath').textContent = await bridge.path();
    if (!dlg.open) dlg.showModal();
    render();
  }
  btn.addEventListener('click', show);
  // Ctrl+Shift+L; по коду клавиши — работает и в русской раскладке (Ctrl+Shift+Д)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') { e.preventDefault(); if (dlg.open) dlg.close(); else show(); }
  });
  $('#logClose').addEventListener('click', () => dlg.close());
  $('#logFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    for (const x of document.querySelectorAll('#logFilter [data-f]')) x.classList.toggle('on', x === b);
    render();
  });
  $('#logSearch').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); render(); });
  $('#logCopy').addEventListener('click', async () => {
    const text = lines.filter(visible).map(fmt).join('\n');
    try { await navigator.clipboard.writeText(text); $('#logCopy').textContent = 'Скопировано ✓'; } catch { $('#logCopy').textContent = 'Не скопировалось'; }
    setTimeout(() => { $('#logCopy').textContent = 'Копировать'; }, 1500);
  });
  $('#logFile').addEventListener('click', () => bridge.openFile());
  $('#logFolder').addEventListener('click', () => bridge.openFolder());
  badge();
})();
