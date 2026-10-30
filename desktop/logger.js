// Журнал: всё, что происходит в программе, — в файл «Документы\MangaForge\Логи\ГГГГ-ММ-ДД.log» и в окно «Журнал».
'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const KEEP = 5000; // строк в памяти для окна «Журнал»

const pad = (n, w = 2) => String(n).padStart(w, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

// Секреты в журнал не пишем: журнал могут переслать кому-то для разбора ошибки
const SECRET = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|token)$/i;
function hideSecrets(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 4) return v;
  if (Array.isArray(v)) return v.map((x) => hideSecrets(x, depth + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = SECRET.test(k) && x ? '***' : hideSecrets(x, depth + 1);
  return o;
}

function format(value) {
  if (value === undefined) return '';
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(hideSecrets(value), (k, v) => {
      if (v instanceof Uint8Array || Buffer.isBuffer(v)) return `<${v.length} байт>`;
      if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + `… (+${v.length - 2000} симв.)`;
      return v;
    });
  } catch { return String(value); }
}

class Logger {
  constructor(dir) {
    this.dir = dir;
    this.lines = [];
    this.listeners = new Set();
    this.file = '';
    this.stream = null;
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* пишем только в память */ }
  }

  open() {
    const f = path.join(this.dir, day(new Date()) + '.log');
    if (f === this.file && this.stream) return;
    if (this.stream) this.stream.end();
    this.file = f;
    try {
      this.stream = fs.createWriteStream(f, { flags: 'a' });
      this.stream.on('error', () => { this.stream = null; });
    } catch { this.stream = null; }
  }

  write(level, source, message, data) {
    if (!LEVELS.includes(level)) level = 'INFO';
    const d = new Date();
    let text = format(message);
    const extra = format(data);
    if (extra) text += (text ? ' ' : '') + extra;
    const entry = { t: d.getTime(), level, source: String(source || 'app'), text };
    const line = `${day(d)} ${time(d)} ${level.padEnd(5)} [${entry.source}] ${text.replace(/\n/g, '\n    ')}\n`;
    this.open();
    if (this.stream) this.stream.write(line);
    if (process.env.MF_DEBUG) process.stdout.write(line);
    this.lines.push(entry);
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    for (const fn of this.listeners) { try { fn(entry); } catch { /* окно закрыто */ } }
  }

  debug(src, msg, data) { this.write('DEBUG', src, msg, data); }
  info(src, msg, data) { this.write('INFO', src, msg, data); }
  warn(src, msg, data) { this.write('WARN', src, msg, data); }
  error(src, msg, data) { this.write('ERROR', src, msg, data); }

  // Сразу на диск: перед выходом и после падения
  flush() { return new Promise((r) => (this.stream ? this.stream.write('', r) : r())); }
}

module.exports = { Logger, format };
