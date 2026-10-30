// Движок запросов, совместимый со скриптами FMD.
// FMD использует XPath/JSONiq из Internet Tools (Xidel). Здесь запросы переводятся
// в стандартный XPath 3.1 и выполняются fontoxpath над деревом slimdom.
'use strict';

const fx = require('fontoxpath');
const { Document } = require('slimdom');
const parse5 = require('parse5');
const { selectAll } = require('css-select');

const NS = 'urn:mangaforge';
const NULL = { kind: 'null' }; // JSON null: в Xidel превращается в строку 'null'

// ---------- HTML → дерево ----------
// Элементы без пространства имён, чтобы //div работал как в Xidel.
function parseHTML(html) {
  const tree = parse5.parse(String(html ?? ''));
  const doc = new Document();
  const build = (src, parent) => {
    for (const n of src.childNodes || []) {
      if (n.nodeName === '#text') parent.appendChild(doc.createTextNode(n.value));
      else if (n.tagName) {
        let el;
        try { el = doc.createElementNS(null, n.tagName); } catch { continue; }
        for (const a of n.attrs) { try { el.setAttribute(a.name, a.value); } catch { /* недопустимое имя */ } }
        parent.appendChild(el);
        build(n.tagName === 'template' && n.content ? n.content : n, el);
      }
    }
  };
  build(tree, doc);
  return doc;
}

// Адаптер для css-select поверх slimdom
const isTag = (n) => n && n.nodeType === 1;
const cssAdapter = {
  isTag,
  getChildren: (n) => Array.from(n.childNodes),
  getParent: (n) => (n.parentNode && n.parentNode.nodeType === 1 ? n.parentNode : null),
  getAttributeValue: (n, name) => (n.hasAttribute(name) ? n.getAttribute(name) : undefined),
  hasAttrib: (n, name) => n.hasAttribute(name),
  getName: (n) => n.localName,
  getText: (n) => n.textContent,
  getSiblings: (n) => (n.parentNode ? Array.from(n.parentNode.childNodes) : [n]),
  removeSubsets: (nodes) => nodes.filter((n, i) => nodes.indexOf(n) === i && !nodes.some((o) => o !== n && o.contains && o.contains(n))),
  existsOne: (test, nodes) => nodes.some((n) => isTag(n) && (test(n) || cssAdapter.existsOne(test, Array.from(n.childNodes)))),
  findAll: (test, nodes) => {
    const out = [];
    const walk = (list) => { for (const n of list) { if (!isTag(n)) continue; if (test(n)) out.push(n); walk(Array.from(n.childNodes)); } };
    walk(nodes);
    return out;
  },
  findOne: (test, nodes) => cssAdapter.findAll(test, nodes)[0] || null,
};

// ---------- Строковое значение как в Xidel ----------
function itemToString(v) {
  if (v === null || v === undefined) return '';
  if (v === NULL) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v.nodeType) {
    if (v.nodeType === 2) return v.value;
    return v.textContent ?? v.data ?? '';
  }
  if (Array.isArray(v)) return v.map(itemToString).join('');
  return ''; // объект
}

// Значения JSON внутри результатов: null из JS-объектов → NULL
const fromJs = (v) => (v === null ? NULL : v);

// Xidel прощает висячие запятые, одинарные кавычки и ключи без кавычек — приводим к строгому JSON
function lenientJSON(text) {
  const t = String(text).trim();
  try { JSON.parse(t); return t; } catch { /* дальше */ }
  const noTrailing = t.replace(/,(\s*[}\]])/g, '$1');
  try { JSON.parse(noTrailing); return noTrailing; } catch { /* дальше */ }
  try {
    const v = require('vm').runInNewContext('(' + t + ')', Object.create(null), { timeout: 1000 });
    if (v !== undefined && typeof v !== 'function') return JSON.stringify(v);
  } catch (e) { if (process.env.MF_DEBUG) console.log('JSON не разобран:', e.message, JSON.stringify(t.slice(0, 120)), '…', JSON.stringify(t.slice(-120))); }
  return t;
}

// ---------- Пользовательские функции ----------
let registered = false;
function registerFunctions() {
  if (registered) return;
  registered = true;
  const textOf = (items) => items.map((x) => (typeof x === 'string' ? x : x && x.nodeType ? itemToString(x) : String(x))).join('');
  fx.registerCustomXPathFunction({ namespaceURI: NS, localName: 'jsontext' }, ['item()*'], 'xs:string', (_, a) => lenientJSON(textOf(a)));
  // not() как в Xidel: объект или массив — это «истина»
  const ebv = (a) => a.length > 0 && (a.length > 1 || (typeof a[0] === 'object' ? a[0] !== null : Boolean(a[0])));
  fx.registerCustomXPathFunction({ namespaceURI: NS, localName: 'not' }, ['item()*'], 'xs:boolean', (_, a) => !ebv(a));
  // resolve-uri(x) в Xidel без базового адреса возвращает ссылку как есть — хост добавит MaybeFillHost
  const resolve = (rel, base) => { if (rel === null) return null; try { return base ? new URL(rel, base).toString() : rel; } catch { return rel; } };
  fx.registerCustomXPathFunction({ namespaceURI: NS, localName: 'resolve' }, ['xs:string?'], 'xs:string?', (_, r) => resolve(r));
  fx.registerCustomXPathFunction({ namespaceURI: NS, localName: 'resolve' }, ['xs:string?', 'xs:string'], 'xs:string?', (_, r, b) => resolve(r, b));
  fx.registerCustomXPathFunction({ namespaceURI: NS, localName: 'css' }, ['xs:string', 'node()?'], 'node()*',
    (_, sel, ctx) => (ctx ? selectAll(sel, ctx.nodeType === 9 ? Array.from(ctx.childNodes) : [ctx], { adapter: cssAdapter }) : []));
}

// ---------- Перевод запроса FMD → XPath 3.1 ----------
// Меняем только код вне строковых литералов и комментариев.
function splitCode(expr) {
  const parts = [];
  let i = 0, buf = '';
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < expr.length) { if (expr[j] === c) { if (expr[j + 1] === c) { j += 2; continue; } break; } j++; }
      parts.push({ code: buf }); buf = '';
      parts.push({ str: expr.slice(i, j + 1) });
      i = j + 1;
    } else if (c === '(' && expr[i + 1] === ':') {
      const j = expr.indexOf(':)', i + 2);
      i = j < 0 ? expr.length : j + 2;
      buf += ' ';
    } else { buf += c; i++; }
  }
  parts.push({ code: buf });
  return parts;
}

function translateCode(s) {
  // Функции Xidel: json(x) и jn:members(x) помечаем, скобки расставит wrapCalls
  s = s.replace(/(?<![\w:.-])json\s*\(/g, '\u0001(');
  s = s.replace(/(?<![\w:.-])jn:members\s*\(/g, '\u0002(');
  s = s.replace(/(?<![\w:.-])css\s*\(/g, '\u0003(');
  s = s.replace(/(?<![\w:.-])not\s*\(/g, 'mf:not(');
  s = s.replace(/(?<![\w:.-])resolve-uri\s*\(/g, 'mf:resolve(');
  s = s.replace(/(?<![\w:.-])jn:keys\s*\(/g, 'map:keys(');
  // Доступ к полям через точку: $x.a, (...).a  → $x?a
  s = s.replace(/(?<=[\w)\]*])\.(?=[A-Za-z_])/g, '?');
  // .member() → ?member?*   $x() → $x?*   )() → )?*
  s = s.replace(/(\?[A-Za-z_][\w-]*)\s*\(\s*\)/g, '$1?*');
  s = s.replace(/(\$[A-Za-z_][\w-]*)\s*\(\s*\)/g, '$1?*');
  s = s.replace(/\)\s*\(\s*\)/g, ')?*');
  return s;
}

// Помеченные вызовы: \u0001( … ) → parse-json(mf:jsontext( … )),  \u0002( … ) → ( … )?*
const WRAP = { '\u0001': ['parse-json(mf:jsontext(', '))'], '\u0002': ['(', ')?*'], '\u0003': ['mf:css(', ', .)'] };
function wrapCalls(s) {
  let res = '', i = 0;
  const stack = [];
  while (i < s.length) {
    const c = s[i];
    if (WRAP[c] && s[i + 1] === '(') { res += WRAP[c][0]; stack.push({ depth: 0, close: WRAP[c][1] }); i += 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; } j++; }
      res += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (stack.length) {
      const top = stack[stack.length - 1];
      if (c === '(') top.depth++;
      else if (c === ')') {
        if (top.depth === 0) { res += top.close; stack.pop(); i++; continue; }
        top.depth--;
      }
    }
    res += c; i++;
  }
  return res;
}

const KEYWORDS = new Set(['and', 'or', 'div', 'idiv', 'mod', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'is', 'to', 'instance', 'of', 'if', 'then',
  'else', 'for', 'in', 'return', 'let', 'some', 'every', 'satisfies', 'cast', 'castable', 'as', 'treat', 'union', 'intersect', 'except']);

// JSONiq-литералы true/false/null (без скобок)
function literals(s) {
  return s.replace(/(?<![\w$?@:./-])(true|false|null)(?![\w(:-])/g, (w) => (w === 'null' ? '()' : w + '()'));
}

// Контекст — JSON-объект: в Xidel «data?*», «a/b» и «not(x)» читают поля объекта
function mapSteps(s) {
  s = s.replace(/(?<!\/)\/([A-Za-z_][\w-]*)(?![\w-])(?!\s*\()(?!\s*::)/g, '?$1');
  return s.replace(/(?<![\w$?@:./-])([A-Za-z_][\w-]*)(?![\w-])(?!\s*\()(?!\s*::)(?!:)/g, (m, name) => (KEYWORDS.has(name) ? m : '?' + name));
}

const cache = new Map();
function translate(expr, mapMode = false) {
  const key = (mapMode ? 'M' : 'N') + expr;
  let t = cache.get(key);
  if (t === undefined) {
    t = wrapCalls(splitCode(expr).map((p) => (p.str !== undefined ? p.str : (mapMode ? mapSteps : (x) => x)(literals(translateCode(p.code))))).join(''));
    cache.set(key, t);
  }
  return t;
}

const nsResolver = (p) => ({ mf: NS, map: 'http://www.w3.org/2005/xpath-functions/map', array: 'http://www.w3.org/2005/xpath-functions/array' }[p] || null);

function evaluate(expr, contextItem, onError) {
  registerFunctions();
  const isMap = contextItem && typeof contextItem === 'object' && !contextItem.nodeType && contextItem !== NULL;
  const q = translate(expr, isMap);
  // array{...} — обход ограничения fontoxpath на последовательности карт
  const wrapped = 'array { ' + q + ' }';
  let ctx = contextItem === NULL || contextItem === undefined ? null : contextItem;
  try {
    const r = fx.evaluateXPath(wrapped, ctx, null, null, fx.evaluateXPath.ANY_TYPE, { namespaceResolver: nsResolver, language: fx.evaluateXPath.XPATH_3_1_LANGUAGE });
    return Array.isArray(r) ? r.map(fromJs) : [fromJs(r)];
  } catch (e) {
    if (onError) onError(expr, q, e);
    return [];
  }
}

// ---------- Значения для Lua (аналог IXQValue) ----------
const ITEMS = Symbol('items');
function makeValue(items) {
  const v = {
    get Count() { return items.length; },
    ToString: () => items.map(itemToString).join(''),
    GetAttribute: (name) => {
      const n = items[0];
      return n && n.nodeType === 1 && n.hasAttribute(name) ? n.getAttribute(name) : '';
    },
    GetProperty: (name) => {
      const o = items[0];
      if (o && typeof o === 'object' && !o.nodeType && !Array.isArray(o) && o !== NULL && name in o) return makeValue([fromJs(o[name])]);
      return makeValue([]);
    },
    InnerText: () => itemToString(items[0]),
    InnerHTML: () => (items[0] && items[0].nodeType ? Array.from(items[0].childNodes).map(serialize).join('') : ''),
    OuterHTML: () => (items[0] && items[0].nodeType ? serialize(items[0]) : ''),
    Get: (i) => {
      if (i === undefined || i === null) {
        let k = 0;
        return () => (k < items.length ? makeValue([items[k++]]) : undefined);
      }
      const it = items[Number(i) - 1];
      return makeValue(it === undefined ? [] : [it]);
    },
  };
  Object.defineProperty(v, ITEMS, { value: items });
  return v;
}

function serialize(n) {
  if (n.nodeType === 3) return n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (n.nodeType !== 1) return '';
  const attrs = Array.from(n.attributes).map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('');
  return `<${n.localName}${attrs}>${Array.from(n.childNodes).map(serialize).join('')}</${n.localName}>`;
}

const itemsOf = (v) => (v && v[ITEMS]) || [];
const contextOf = (v) => (v && v[ITEMS] ? v[ITEMS][0] : undefined);

// ---------- Аналог TXQueryEngineHTML ----------
function createTXQuery(input, log) {
  let doc = parseHTML(input === undefined ? '' : typeof input === 'string' ? input : input.ToString ? input.ToString() : String(input));
  const onError = log ? (expr, q, e) => log(`XPath: ${expr}\n  → ${q}\n  ${String(e.message).split('\n').pop()}`) : null;
  const run = (expr, ctx) => evaluate(expr, ctx === undefined ? doc : contextOf(ctx), onError);
  const trimAdd = (list, s) => list.Add(s);
  return {
    ParseHTML: (s) => { doc = parseHTML(typeof s === 'string' ? s : s && s.ToString ? s.ToString() : ''); },
    XPath: (expr, ctx) => makeValue(run(expr, ctx)),
    XPathString: (expr, ctx) => run(expr, ctx).map(itemToString).join(''),
    XPathCount: (expr, ctx) => run(expr, ctx).length,
    // XPathStringAll(expr) / (expr, sep) / (expr, ctxValue) / (expr, list) / (expr, sep, ctx) / (expr, list, ctx)
    XPathStringAll: (expr, a, b) => {
      let sep = ', ', list = null, ctx;
      if (typeof a === 'string') { sep = a; ctx = b; }
      else if (a && a.Add) { list = a; ctx = b; }
      else ctx = a;
      const vals = run(expr, ctx).map(itemToString);
      if (list) { for (const s of vals) list.Add(s); return undefined; }
      let res = '';
      for (const s of vals) if (s.trim()) res = res.trim() ? res.trim() + sep + s.trim() : s.trim();
      return res;
    },
    XPathHREFAll: (expr, links, names, ctx) => {
      for (const n of run(expr, ctx)) {
        links.Add(n && n.nodeType === 1 && n.hasAttribute('href') ? n.getAttribute('href') : '');
        trimAdd(names, itemToString(n).trim());
      }
    },
    XPathHREFTitleAll: (expr, links, titles, ctx) => {
      for (const n of run(expr, ctx)) {
        links.Add(n && n.nodeType === 1 && n.hasAttribute('href') ? n.getAttribute('href') : '');
        titles.Add(n && n.nodeType === 1 && n.hasAttribute('title') ? n.getAttribute('title') : '');
      }
    },
  };
}

module.exports = { createTXQuery, translate, evaluate, parseHTML, itemToString, makeValue, itemsOf, NULL };
