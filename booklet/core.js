// Ядро: раскладка страниц по листам и сборка PDF.
// Работает и в браузере (window.BookletCore), и в Node (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BookletCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MM = 72 / 25.4;

  // Портретные размеры в pt
  const PAPERS = {
    A4: { w: 595.28, h: 841.89, label: 'A4' },
    A3: { w: 841.89, h: 1190.55, label: 'A3' },
    A5: { w: 419.53, h: 595.28, label: 'A5' },
    Letter: { w: 612, h: 792, label: 'Letter' },
    Legal: { w: 612, h: 1008, label: 'Legal' },
  };

  // booklet — на стороне листа 2 страницы, лист = одна тетрадь.
  // booklet4 — на стороне 4 страницы: лист режут пополам поперёк,
  // верхняя половинка идёт в одну тетрадь, нижняя — в другую.
  const MODES = {
    booklet: { cols: 2, rows: 1, landscape: true, perSide: 2 },
    booklet4: { cols: 2, rows: 2, landscape: false, perSide: 4 },
  };
  const isBooklet = (st) => st.mode === 'booklet' || st.mode === 'booklet4';
  // Скрепление: 'fold' — тетради, согнутые пополам; 'punch' — лист режется на отдельные листки,
  // у корешка остаётся поле под дырокол (кольца, диски, пружина — без клея)
  const isPunch = (st) => st.binding === 'punch';

  const DEFAULTS = {
    mode: 'booklet',
    binding: 'fold',
    punchMargin: 15,      // поле под дырокол у корешка, мм
    paper: 'A4',
    rtl: false,
    sheetsPerSig: 4,
    oneSig: false,
    balance: true,
    leadingBlanks: 0,
    keepLastAsBack: false,
    range: '',
    marginOuter: 5,
    marginInner: 5,
    marginTop: 5,
    marginBottom: 5,
    scale: 100,
    shiftX: 0,
    shiftY: 0,
    creep: 0,
    cropL: 0,
    cropR: 0,
    cropT: 0,
    cropB: 0,
    marks: true,
    exclude: '',
    splitSpreads: true,
    duplex: 'auto',
    reverseBacks: false,
    pageNumbers: false,
    pageNumberSize: 9,
    // Обложка: номера страниц (с 1), 0 — нет
    coverFront: 0,
    coverBack: 0,
    coverMode: 'sheet',   // 'sheet' — отдельный лист, 'skip' — не печатать, 'inside' — как обычные страницы
    paperThick: 0.1,      // толщина листа бумаги блока, мм (для ширины корешка)
    coverPaper: 'auto',
  };

  // "1-30, 45, 50-" -> индексы с нуля. Пустая строка -> все страницы.
  function parseRange(str, total) {
    const s = (str || '').trim();
    if (!s) return { pages: [...Array(total).keys()] };
    const pages = [];
    for (const raw of s.split(/[,;]+/)) {
      const part = raw.trim();
      if (!part) continue;
      const m = part.match(/^(\d*)\s*[-–—]\s*(\d*)$/);
      let a, b;
      if (m) {
        a = m[1] ? +m[1] : 1;
        b = m[2] ? +m[2] : total;
      } else if (/^\d+$/.test(part)) {
        a = b = +part;
      } else {
        return { error: `Не понял «${part}». Пример: 1-30, 45, 50-` };
      }
      if (a < 1 || b < 1 || a > total || b > total) {
        return { error: `«${part}»: в документе всего ${total} стр.` };
      }
      const step = a <= b ? 1 : -1;
      for (let i = a; i !== b + step; i += step) pages.push(i - 1);
    }
    if (!pages.length) return { error: 'Диапазон пустой' };
    return { pages };
  }

  // Последовательность страниц книги: номер страницы источника или null (пустая).
  // Страницы обложки (индексы с нуля) или null
  function coverPages(total, st) {
    const idx = (n) => (n >= 1 && n <= total ? n - 1 : null);
    return { front: idx(st.coverFront), back: idx(st.coverBack) };
  }

  // pagesMeta — страницы ({w, h, spread?}); spread: 1 — первая половина разворота, 2 — вторая
  function buildSequence(pagesMeta, st) {
    const total = pagesMeta.length;
    const r = parseRange(st.range, total);
    if (r.error) return r;
    const out = new Set();
    if ((st.exclude || '').trim()) {
      const ex = parseRange(st.exclude, total);
      if (ex.error) return { error: 'Убрать страницы: ' + ex.error };
      ex.pages.forEach((p) => out.add(p));
    }
    const cov = coverPages(total, st);
    if (st.coverMode !== 'inside') [cov.front, cov.back].forEach((p) => p !== null && out.add(p));
    const seq = [];
    for (let i = 0; i < st.leadingBlanks; i++) seq.push(null);
    for (const p of r.pages) {
      if (out.has(p)) continue;
      // Половинки разворота должны лечь друг напротив друга: первая — на нечётное место
      // (место 0 — правая страница обложки, дальше пары 1–2, 3–4…)
      if (pagesMeta[p].spread === 1 && seq.length % 2 === 0) seq.push(null);
      seq.push(p);
    }
    if (!seq.some((x) => x !== null)) return { error: 'В книге не осталось страниц' };
    const unit = isPunch(st) ? 2 : 4;
    const pad = (unit - (seq.length % unit)) % unit;
    const blanks = Array(pad).fill(null);
    if (st.keepLastAsBack && seq.length > 1) seq.splice(seq.length - 1, 0, ...blanks);
    else seq.push(...blanks);
    return { seq, padded: pad };
  }

  // Сколько листов в каждой тетради
  function signatureSizes(totalSheets, st) {
    const sps = Math.max(1, Math.floor(st.sheetsPerSig) || 1);
    let count = st.oneSig || sps >= totalSheets ? 1 : Math.ceil(totalSheets / sps);
    // На листе booklet4 две тетради — нужна пара, иначе половина листа пустая
    const pairUp = st.mode === 'booklet4' && totalSheets > 1 && count % 2 === 1;
    if (pairUp) count++;
    if (count === 1) return [totalSheets];
    if (!st.balance && !pairUp) {
      const sizes = Array(count).fill(sps);
      sizes[count - 1] = totalSheets - sps * (count - 1);
      return sizes;
    }
    const base = Math.floor(totalSheets / count);
    const extra = totalSheets % count;
    return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
  }

  // Раскладка: какие страницы попадают на какую сторону какого листа.
  // Слот — это позиция последовательности (индекс в seq).
  function impose(seq, st) {
    if (isPunch(st)) return imposePunch(seq, st);
    const { sheets: halves, signatures } = imposeSignatures(seq, st);
    if (st.mode !== 'booklet4') return { sheets: halves, signatures };
    // Две тетради на одном листе: нечётная сверху, следующая снизу.
    // Если тетрадей нечётное число или они разной длины, недостающая половинка пустая.
    const sheets = [];
    const empty = [null, null];
    for (let s = 0; s < signatures.length; s += 2) {
      const top = signatures[s], bottom = signatures[s + 1];
      const n = Math.max(top.sheets.length, bottom ? bottom.sheets.length : 0);
      for (let i = 0; i < n; i++) {
        const a = top.sheets[i] || null;
        const b = bottom ? bottom.sheets[i] || null : null;
        const lead = a || b;
        sheets.push({
          sig: lead.sig, sheetInSig: lead.sheetInSig, sheetsInSig: lead.sheetsInSig,
          globalNo: sheets.length + 1,
          halves: [a, b],
          front: [...(a ? a.front : empty), ...(b ? b.front : empty)],
          back: [...(a ? a.back : empty), ...(b ? b.back : empty)],
        });
      }
    }
    return { sheets, signatures };
  }

  // Дырокол: стопку режут целиком, стопки ячеек кладут друг на друга (первая ячейка сверху) — и листки сразу по порядку.
  // Листок j: ячейка floor(j / N) листа j mod N; на лице стр. 2j, на обороте 2j+1.
  // Оборот переворачивается так же, как у тетрадей: ячейка на обороте — зеркальная по горизонтали.
  function imposePunch(seq, st) {
    const k = MODES[st.mode].perSide;
    const leafCount = seq.length / 2;
    const N = Math.max(1, Math.ceil(leafCount / k));
    const mirror = (c) => c ^ 1; // 0↔1, 2↔3: столбец меняется, ряд тот же
    const sheets = [];
    for (let i = 0; i < N; i++) {
      const front = Array(k).fill(null), back = Array(k).fill(null);
      const leaves = [];
      for (let c = 0; c < k; c++) {
        const j = c * N + i;
        if (j >= leafCount) { leaves.push(null); continue; }
        front[c] = 2 * j;
        back[mirror(c)] = 2 * j + 1;
        leaves.push({ no: j + 1, pages: [2 * j, 2 * j + 1] });
      }
      sheets.push({ globalNo: i + 1, front, back, leaves, sheetsTotal: N });
    }
    return { sheets, signatures: [], leafCount };
  }

  // Тетради и их листы (для booklet4 — половинки листа)
  function imposeSignatures(seq, st) {
    const sheets = [];
    const signatures = [];
    {
      const sizes = signatureSizes(seq.length / 4, st);
      let start = 0;
      let globalNo = 0;
      sizes.forEach((S, sigIdx) => {
        const P = S * 4;
        const at = (k) => start + k;
        const sig = { no: sigIdx + 1, sheets: [], from: start, to: start + P - 1, size: S };
        for (let i = 0; i < S; i++) {
          let front, back;
          if (!st.rtl) {
            front = [at(P - 1 - 2 * i), at(2 * i)];
            back = [at(2 * i + 1), at(P - 2 - 2 * i)];
          } else {
            front = [at(2 * i), at(P - 1 - 2 * i)];
            back = [at(P - 2 - 2 * i), at(2 * i + 1)];
          }
          const sheet = {
            sig: sig.no, sheetInSig: i + 1, sheetsInSig: S, globalNo: ++globalNo,
            front, back,
            // Листок, который ближе к началу книги, и листок ближе к концу
            leaves: [[at(2 * i), at(2 * i + 1)], [at(P - 2 - 2 * i), at(P - 1 - 2 * i)]],
          };
          sig.sheets.push(sheet);
          sheets.push(sheet);
        }
        signatures.push(sig);
        start += P;
      });
    }
    return { sheets, signatures };
  }

  function sheetSize(st) {
    const p = PAPERS[st.paper] || PAPERS.A4;
    return MODES[st.mode].landscape ? { W: p.h, H: p.w } : { W: p.w, H: p.h };
  }

  // Области для страниц на стороне листа (pt, начало координат внизу слева).
  // side: 'front' | 'back'. spineSide у слота: где корешок ('right' значит корешок справа от страницы).
  function slotRects(st) {
    const { W, H } = sheetSize(st);
    const o = st.marginOuter * MM, inn = st.marginInner * MM;
    const t = st.marginTop * MM, b = st.marginBottom * MM;
    const mode = MODES[st.mode];
    const slots = [];
    if (mode.rows === 1) {
      const w = W / 2 - o - inn;
      const h = H - t - b;
      slots.push({ x: o, y: b, w, h, spine: 'right' });
      slots.push({ x: W / 2 + inn, y: b, w, h, spine: 'left' });
    } else {
      const w = W / 2 - o - inn;
      const h = H / 2 - t - b;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          slots.push({
            x: c === 0 ? o : W / 2 + inn,
            y: r === 0 ? H / 2 + b : b,
            w, h, spine: c === 0 ? 'right' : 'left',
          });
        }
      }
    }
    return { W, H, slots };
  }

  // Ячейки листа (в порядке слотов) — куски, на которые лист режется в режиме дырокола
  function cells(st) {
    const { W, H } = sheetSize(st);
    if (MODES[st.mode].rows === 1) return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
    const out = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) out.push({ x: c * W / 2, y: r === 0 ? H / 2 : 0, w: W / 2, h: H / 2 });
    return out;
  }

  // Область страницы в ячейке листка: у корешка — поле под дырокол
  function punchSlot(cell, spine, st) {
    const p = st.punchMargin * MM, o = st.marginOuter * MM;
    const l = spine === 'left' ? p : o, r = spine === 'left' ? o : p;
    const t = st.marginTop * MM, b = st.marginBottom * MM;
    return { x: cell.x + l, y: cell.y + b, w: Math.max(1, cell.w - l - r), h: Math.max(1, cell.h - t - b), spine, cell };
  }

  // Где на листе окажется видимая (обрезанная) часть страницы.
  // vis: {w, h} — размер страницы как её видно (с учётом поворота).
  // creepSteps — номер листа от внешнего (для компенсации толщины бумаги).
  // Какая часть страницы видна, в долях её ширины и высоты.
  // У половинки разворота (part: [a, b]) поля срезаются только с внешнего края.
  function cropOf(m, st) {
    const [a, b] = m.part || [0, 1];
    return {
      l: a === 0 ? st.cropL / 100 : a,
      r: b === 1 ? st.cropR / 100 : 1 - b,
      t: st.cropT / 100,
      b: st.cropB / 100,
    };
  }

  function placePage(vis, slot, st, creepSteps) {
    const c = cropOf(vis, st);
    const cl = c.l, cr = c.r, ct = c.t, cb = c.b;
    const cw = vis.w * Math.max(0.05, 1 - cl - cr);
    const ch = vis.h * Math.max(0.05, 1 - ct - cb);
    const s = Math.min(slot.w / cw, slot.h / ch) * (st.scale / 100);
    const w = cw * s, h = ch * s;
    let x = slot.x + (slot.w - w) / 2;
    let y = slot.y + (slot.h - h) / 2 + st.shiftY * MM;
    // Сдвиг по X: плюс — к внешнему краю (от корешка). Компенсация толщины — к корешку.
    const toOuter = slot.spine === 'right' ? -1 : 1;
    x += toOuter * st.shiftX * MM;
    if (isBooklet(st) && !isPunch(st)) x -= toOuter * st.creep * MM * creepSteps;
    return { x, y, w, h, scale: s };
  }

  // Обрезка в координатах, как видно, -> рамка в собственных координатах страницы
  function naturalBox(box, rot, v) {
    let n;
    switch (rot) {
      case 90: n = { l: v.t, r: v.b, b: v.l, t: v.r }; break;
      case 180: n = { l: v.r, r: v.l, b: v.t, t: v.b }; break;
      case 270: n = { l: v.b, r: v.t, b: v.r, t: v.l }; break;
      default: n = v;
    }
    return {
      left: box.x + box.width * n.l,
      right: box.x + box.width * (1 - n.r),
      bottom: box.y + box.height * n.b,
      top: box.y + box.height * (1 - n.t),
    };
  }

  function normRot(a) {
    return ((Math.round((a || 0) / 90) * 90) % 360 + 360) % 360;
  }

  // Полный план: последовательность + листы + геометрия
  function plan(pagesMeta, st) {
    const seqRes = buildSequence(pagesMeta, st);
    if (seqRes.error) return { error: seqRes.error };
    const { seq } = seqRes;
    const { sheets, signatures, leafCount } = impose(seq, st);
    const geo = slotRects(st);
    const punch = isPunch(st);
    const cs = punch ? cells(st) : null;
    // Корешок листка: на лице слева (у манги справа), на обороте — с другой стороны
    const punchSpine = (back) => ((st.rtl ? 'right' : 'left') === 'left') !== back ? 'left' : 'right';
    const sideLayout = (positions, sheet, back) =>
      positions.map((pos, k) => {
        const src = pos === null ? null : seq[pos];
        const slot = punch ? punchSlot(cs[k], punchSpine(back), st) : geo.slots[k];
        if (src === null || src === undefined) return { pos, src: null, slot };
        const m = pagesMeta[src];
        const half = sheet.halves ? sheet.halves[k < 2 ? 0 : 1] : sheet;
        const creepSteps = half ? half.sheetInSig - 1 : 0;
        return { pos, src, slot, rect: placePage(m, slot, st, creepSteps) };
      });
    for (const sh of sheets) {
      sh.frontLayout = sideLayout(sh.front, sh, false);
      sh.backLayout = sideLayout(sh.back, sh, true);
    }
    if (punch) geo.cells = cs;
    const blanks = seq.filter((x) => x === null).length;
    const cover = coverPlan(pagesMeta, st, seq.length);
    return { seq, sheets, signatures, geo, blanks, padded: seqRes.padded, cover, punch, leafCount };
  }

  // Размер страницы готовой книги, pt
  function bookPageSize(st) {
    const p = PAPERS[st.paper] || PAPERS.A4;
    return st.mode === 'booklet4' ? { w: p.w / 2, h: p.h / 2 } : { w: p.h / 2, h: p.w };
  }

  // Картинка заполняет область целиком (лишнее по краям срезается)
  function placeFill(vis, panel, st) {
    const c = cropOf(vis, st);
    const cw = vis.w * Math.max(0.05, 1 - c.l - c.r);
    const ch = vis.h * Math.max(0.05, 1 - c.t - c.b);
    const s = Math.max(panel.w / cw, panel.h / ch);
    const w = cw * s, h = ch * s;
    return { x: panel.x + (panel.w - w) / 2, y: panel.y + (panel.h - h) / 2, w, h };
  }

  // Развёртка обложки: задняя + корешок + передняя, точно по размеру книги
  function coverPlan(pagesMeta, st, bookPages) {
    if (st.coverMode !== 'sheet') return null;
    const cov = coverPages(pagesMeta.length, st);
    if (cov.front === null && cov.back === null) return null;
    if (isPunch(st)) return punchCoverPlan(pagesMeta, st, cov);
    const { w: bw, h: bh } = bookPageSize(st);
    const spine = Math.ceil(bookPages / 2) * st.paperThick * MM;
    const W = 2 * bw + spine, H = bh;
    const margin = 8 * MM;
    const cands = st.coverPaper === 'auto' ? [st.paper, 'A3'] : [st.coverPaper];
    let paper = null, scale = 1;
    for (const name of cands) {
      const p = PAPERS[name];
      if (W <= p.h - 2 * margin && H <= p.w - 2 * margin) { paper = name; break; }
    }
    if (!paper) {
      paper = cands[cands.length - 1];
      const p = PAPERS[paper];
      scale = Math.min((p.h - 2 * margin) / W, (p.w - 2 * margin) / H);
    }
    const PW = PAPERS[paper].h, PH = PAPERS[paper].w;
    const x0 = (PW - W * scale) / 2, y0 = (PH - H * scale) / 2;
    const panel = (x, w) => ({ x: x0 + x * scale, y: y0, w: w * scale, h: H * scale });
    const left = panel(0, bw), right = panel(bw + spine, bw);
    const front = st.rtl ? left : right, back = st.rtl ? right : left;
    const whole = panel(0, W);
    const fm = cov.front !== null ? pagesMeta[cov.front] : null;
    // Одна широкая картинка без задней — это обложка целиком (зад + корешок + перед)
    const wrap = !!fm && cov.back === null && fm.w > fm.h;
    const items = [];
    if (wrap) items.push({ src: cov.front, panel: whole, R: placeFill(fm, whole, st) });
    else {
      if (fm) items.push({ src: cov.front, panel: front, R: placeFill(fm, front, st) });
      if (cov.back !== null) items.push({ src: cov.back, panel: back, R: placeFill(pagesMeta[cov.back], back, st) });
    }
    return {
      PW, PH, paper, scale, W, H, bookW: bw, bookH: bh, spine,
      front, back, spinePanel: panel(bw, spine), whole, wrap, items,
    };
  }

  // Обложка под дырокол: перед и зад — два листка на одном листе (на плотной бумаге, одна сторона).
  // Одна широкая картинка (зад + корешок + перед) делится: передняя половина на перед, задняя на зад.
  function punchCoverPlan(pagesMeta, st, cov) {
    const { W, H } = sheetSize(st);
    const cs = cells(st);
    const front = cs[0], back = cs[1];
    const fm = cov.front !== null ? pagesMeta[cov.front] : null;
    const wrap = !!fm && cov.back === null && fm.w > fm.h;
    const items = [];
    // Половина широкой картинки на всю ячейку: rightHalf — правая половина
    const halfFill = (m, panel, rightHalf) => {
      const c = cropOf(m, st);
      const cw = m.w * Math.max(0.05, 1 - c.l - c.r), ch = m.h * Math.max(0.05, 1 - c.t - c.b);
      const s = Math.max(panel.w / (cw / 2), panel.h / ch);
      const w = cw * s, h = ch * s;
      return { x: rightHalf ? panel.x + panel.w - w : panel.x, y: panel.y + (panel.h - h) / 2, w, h };
    };
    if (wrap) {
      // Обычная книга: перед — правая половина развёртки; манга — левая
      items.push({ src: cov.front, panel: front, R: halfFill(fm, front, !st.rtl) });
      items.push({ src: cov.front, panel: back, R: halfFill(fm, back, st.rtl) });
    } else {
      if (fm) items.push({ src: cov.front, panel: front, R: placeFill(fm, front, st) });
      if (cov.back !== null) items.push({ src: cov.back, panel: back, R: placeFill(pagesMeta[cov.back], back, st) });
    }
    const bp = bookPageSize(st);
    return { punch: true, PW: W, PH: H, paper: st.paper, scale: 1, W, H, bookW: bp.w, bookH: bp.h, spine: 0, front, back, spinePanel: null, whole: null, wrap, items, cells: cs };
  }

  // Сборка PDF.
  // files: [{kind:'pdf', bytes}] или [{kind:'images', images:[{bytes, mime}]}]
  // pagesMeta: [{file, page, w, h}] (page с нуля).
  async function generate(PDFLib, files, pagesMeta, st, onProgress) {
    const { PDFDocument, degrees, rgb, StandardFonts, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = PDFLib;
    const p = plan(pagesMeta, st);
    if (p.error) throw new Error(p.error);
    const srcDocs = [];
    for (const f of files) {
      srcDocs.push(f.kind === 'images'
        ? null
        : await PDFDocument.load(f.bytes, { ignoreEncryption: true, updateMetadata: false }));
    }
    const split = st.duplex === 'manual';
    const outMain = await PDFDocument.create();
    const outBack = split ? await PDFDocument.create() : null;
    const fontMain = await outMain.embedFont(StandardFonts.Helvetica);
    const fontBack = outBack ? await outBack.embedFont(StandardFonts.Helvetica) : null;
    const caches = new Map();   // для каждого выходного файла — свои вложенные страницы
    const { W, H } = p.geo;
    const total = p.sheets.length * 2;
    let done = 0;

    // Нарисовать страницу src так, чтобы её видимая (обрезанная) часть заняла R
    async function drawSrc(doc, page, src, R) {
      if (!caches.has(doc)) caches.set(doc, new Map());
      const cache = caches.get(doc);
      const meta = pagesMeta[src];
      if (files[meta.file].kind === 'images') {
        let img = cache.get(src);
        if (!img) {
          const im = files[meta.file].images[meta.page];
          img = im.mime === 'image/png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
          cache.set(src, img);
        }
        const c = cropOf(meta, st);
        const kw = Math.max(0.05, 1 - c.l - c.r);
        const kh = Math.max(0.05, 1 - c.t - c.b);
        const fw = R.w / kw, fh = R.h / kh;
        page.pushOperators(pushGraphicsState(), rectangle(R.x, R.y, R.w, R.h), clip(), endPath());
        page.drawImage(img, { x: R.x - c.l * fw, y: R.y - c.b * fh, width: fw, height: fh });
        page.pushOperators(popGraphicsState());
        return true;
      }
      const srcPage = srcDocs[meta.file].getPage(meta.page);
      // Страница без содержимого — просто пустая
      if (!srcPage.node.Contents()) return false;
      const rot = normRot(srcPage.getRotation().angle);
      let emb = cache.get(src);
      if (!emb) {
        emb = await doc.embedPage(srcPage, naturalBox(srcPage.getCropBox(), rot, cropOf(meta, st)));
        cache.set(src, emb);
      }
      const swap = rot === 90 || rot === 270;
      const o = { width: swap ? R.h : R.w, height: swap ? R.w : R.h };
      if (rot === 0) Object.assign(o, { x: R.x, y: R.y });
      if (rot === 90) Object.assign(o, { x: R.x, y: R.y + R.h, rotate: degrees(-90) });
      if (rot === 180) Object.assign(o, { x: R.x + R.w, y: R.y + R.h, rotate: degrees(180) });
      if (rot === 270) Object.assign(o, { x: R.x + R.w, y: R.y, rotate: degrees(90) });
      page.drawPage(emb, o);
      return true;
    }

    function drawNumber(page, font, item) {
      const txt = String(item.pos + 1);
      const size = st.pageNumberSize;
      const w = font.widthOfTextAtSize(txt, size);
      const R = item.rect;
      const pad = 1.5 * MM;
      // Номер в нижнем внешнем углу страницы
      const x = item.slot.spine === 'right' ? R.x + pad : R.x + R.w - pad - w;
      const y = R.y + pad;
      page.drawRectangle({ x: x - 1.5, y: y - 1.5, width: w + 3, height: size + 2, color: rgb(1, 1, 1) });
      page.drawText(txt, { x, y: y + size * 0.12, size, font, color: rgb(0, 0, 0) });
    }

    async function drawSide(doc, font, layout, sheet, sideName) {
      const page = doc.addPage([W, H]);
      for (const item of layout) {
        if (item.src === null) continue;
        if (await drawSrc(doc, page, item.src, item.rect) && st.pageNumbers) drawNumber(page, font, item);
      }
      if (st.marks) {
        const grey = rgb(0.6, 0.6, 0.6);
        const tick = 6 * MM;
        const line = (x1, y1, x2, y2, dash) => page.drawLine({
          start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: dash ? 0.5 : 0.7, color: grey, dashArray: dash ? [2, 2] : undefined,
        });
        const label = (half, y) => half && page.drawText(
          `T${half.sig} · L${half.sheetInSig}/${half.sheetsInSig} · ${sideName}`,
          { x: 3 * MM, y, size: 6, font, color: grey });
        if (p.punch) {
          // Разрез — сплошные засечки по краям листа; подпись: номер листа и сторона
          line(W / 2, 0, W / 2, tick, false);
          line(W / 2, H - tick, W / 2, H, false);
          if (st.mode === 'booklet4') {
            line(0, H / 2, tick, H / 2, false);
            line(W - tick, H / 2, W, H / 2, false);
          }
          page.drawText(`L${sheet.globalNo}/${sheet.sheetsTotal} · ${sideName}`, { x: 3 * MM, y: 1.5 * MM, size: 6, font, color: grey });
        } else {
        // Сгиб — пунктир по краям листа
        line(W / 2, 0, W / 2, tick, true);
        line(W / 2, H - tick, W / 2, H, true);
        if (st.mode === 'booklet4') {
          // Разрез — сплошные засечки по краям, сгибы у линии разреза
          line(0, H / 2, tick, H / 2, false);
          line(W - tick, H / 2, W, H / 2, false);
          line(W / 2, H / 2 - tick, W / 2, H / 2 + tick, true);
          label(sheet.halves[0], H / 2 + 1.5 * MM);
          label(sheet.halves[1], 1.5 * MM);
        } else {
          label(sheet, 1.5 * MM);
        }
        }
      }
      done++;
      if (onProgress) await onProgress(done / total);
    }

    for (const sh of p.sheets) {
      await drawSide(outMain, fontMain, sh.frontLayout, sh, 'A');
      if (!split) await drawSide(outMain, fontMain, sh.backLayout, sh, 'B');
    }
    if (split) {
      const order = st.reverseBacks ? [...p.sheets].reverse() : p.sheets;
      for (const sh of order) await drawSide(outBack, fontBack, sh.backLayout, sh, 'B');
    }
    const main = await outMain.save();
    const back = outBack ? await outBack.save() : null;

    // Обложка — отдельным файлом: её часто печатают на плотной бумаге
    let cover = null;
    if (p.cover) {
      const c = p.cover;
      const doc = await PDFDocument.create();
      const page = doc.addPage([c.PW, c.PH]);
      for (const it of c.items) {
        const P = it.panel;
        page.pushOperators(pushGraphicsState(), rectangle(P.x, P.y, P.w, P.h), clip(), endPath());
        await drawSrc(doc, page, it.src, it.R);
        page.pushOperators(popGraphicsState());
      }
      const grey = rgb(0.45, 0.45, 0.45);
      if (c.punch) {
        // Обложка под дырокол: только засечки разреза
        const cut = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: grey });
        cut(c.PW / 2, 0, c.PW / 2, 6 * MM);
        cut(c.PW / 2, c.PH - 6 * MM, c.PW / 2, c.PH);
        if (st.mode === 'booklet4') { cut(0, c.PH / 2, 6 * MM, c.PH / 2); cut(c.PW - 6 * MM, c.PH / 2, c.PW, c.PH / 2); }
        cover = await doc.save();
        return { main, back, cover, plan: p };
      }
      // Метки обрезки по углам и линии сгиба корешка — за краем обложки
      const A = c.whole, gap = 2 * MM, len = 5 * MM;
      const line = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: grey });
      for (const x of [A.x, A.x + A.w]) {
        line(x, A.y - gap - len, x, A.y - gap);
        line(x, A.y + A.h + gap, x, A.y + A.h + gap + len);
      }
      for (const y of [A.y, A.y + A.h]) {
        line(A.x - gap - len, y, A.x - gap, y);
        line(A.x + A.w + gap, y, A.x + A.w + gap + len, y);
      }
      for (const x of [c.spinePanel.x, c.spinePanel.x + c.spinePanel.w]) {
        line(x, A.y - gap - len, x, A.y - gap);
        line(x, A.y + A.h + gap, x, A.y + A.h + gap + len);
      }
      cover = await doc.save();
    }
    return { main, back, cover, plan: p };
  }

  return { MM, PAPERS, MODES, DEFAULTS, isBooklet, isPunch, cells, parseRange, buildSequence, signatureSizes, impose, slotRects, placePage, naturalBox, plan, generate, normRot, coverPages, bookPageSize, cropOf };
});
