// Скрипты сайтов берутся из репозитория FMD2 на GitHub, как это делает сам FMD:
// при первом запуске скачиваются целиком, потом обновляются только изменённые файлы.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = 'dazedcat19/FMD2';
const BRANCH = 'master';
// Обход защиты сайтов от ботов не используем
const SKIP = /^lua\/websitebypass\//;

async function updateScripts({ dir, fetchImpl, onProgress = () => {}, log = () => {} }) {
  const manifestFile = path.join(dir, '.manifest.json');
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* первый запуск */ }

  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  const tree = (await res.json()).tree.filter((e) => e.type === 'blob' && e.path.startsWith('lua/') && e.path.endsWith('.lua') && !SKIP.test(e.path));
  const todo = tree.filter((e) => manifest[e.path] !== e.sha || !fs.existsSync(path.join(dir, e.path.slice(4))));
  log(`Скрипты FMD: ${tree.length} файлов, обновить ${todo.length}`);

  let done = 0, next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const e = todo[next++];
      const r = await fetchImpl(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${e.path.split('/').map(encodeURIComponent).join('/')}`);
      if (!r.ok) throw new Error(`${e.path}: ${r.status}`);
      const target = path.join(dir, e.path.slice(4));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(await r.arrayBuffer()));
      manifest[e.path] = e.sha;
      onProgress(++done, todo.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: 8 }, worker));
  } finally {
    // Удалённые из FMD скрипты убираем, манифест сохраняем даже при обрыве
    const alive = new Set(tree.map((e) => e.path));
    for (const p of Object.keys(manifest)) if (p.startsWith('lua/') && !alive.has(p)) { delete manifest[p]; try { fs.unlinkSync(path.join(dir, p.slice(4))); } catch { /* уже нет */ } }
    manifest.__checked = Date.now();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  }
  return todo.length;
}

function scriptsPresent(dir) {
  return fs.existsSync(path.join(dir, 'modules')) && fs.readdirSync(path.join(dir, 'modules')).length > 50;
}

function lastCheck(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '.manifest.json'), 'utf8')).__checked || 0; } catch { return 0; }
}

module.exports = { updateScripts, scriptsPresent, lastCheck };
