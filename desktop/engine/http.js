// HTTP-клиент с интерфейсом THTTPSendThread из FMD (объект HTTP в скриптах).
'use strict';

// Тот же User-Agent, что FMD отправляет по умолчанию
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

// Словарь как TStrings.Values: отсутствующий ключ читается как ''
function valuesMap(initial = {}) {
  const data = { ...initial };
  const api = {
    get Text() { return Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\r\n'); },
    set Text(t) { for (const k of Object.keys(data)) delete data[k]; for (const line of String(t).split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim(); } },
    Clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    entries: () => Object.entries(data).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  };
  api.Values = new Proxy(data, {
    get: (t, k) => (typeof k === 'string' ? (t[k] ?? '') : undefined),
    set: (t, k, v) => { if (v === null || v === undefined || v === '') delete t[k]; else t[k] = String(v); return true; },
  });
  return api;
}

// Документ ответа (TMemoryStream): текст + байты
function makeDocument() {
  const doc = {
    bytes: Buffer.alloc(0),
    text: '',
    ToString: () => doc.text,
    WriteString: (s) => { doc.text += String(s); doc.bytes = Buffer.from(doc.text); },
    SaveToFile: () => false,
    Clear: () => { doc.text = ''; doc.bytes = Buffer.alloc(0); },
    get Size() { return doc.bytes.length; },
  };
  return doc;
}

function decodeBody(buf, contentType) {
  let cs = (/charset=([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!cs) {
    const head = buf.subarray(0, 2048).toString('latin1');
    cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

// Простое хранилище cookie по домену
class CookieJar {
  constructor() { this.byHost = new Map(); }
  store(host, setCookies) {
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(';');
      const i = pair.indexOf('=');
      if (i < 1) continue;
      const domainAttr = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
      const domain = (domainAttr ? domainAttr.slice(7) : host).replace(/^\./, '').toLowerCase();
      if (!this.byHost.has(domain)) this.byHost.set(domain, new Map());
      this.byHost.get(domain).set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  forHost(host) {
    const out = new Map();
    host = host.toLowerCase();
    for (const [d, m] of this.byHost) if (host === d || host.endsWith('.' + d)) for (const [k, v] of m) out.set(k, v);
    return out;
  }
  clear() { this.byHost.clear(); }
}

// fetchImpl(url, {method, headers, body, redirect}) → Response (fetch API)
// manualRedirects: false — перенаправления проходит сам fetch (сеть Electron не отдаёт 3xx)
function createHttp({ fetchImpl, jar = new CookieJar(), log = () => {}, timeout = 30000, manualRedirects = true }) {
  const headers = valuesMap();
  const cookies = valuesMap();
  const state = { ResultCode: 0, ResultString: '', LastURL: '', MimeType: '', UserAgent: DEFAULT_UA, FollowRedirection: true, RetryCount: 0, EnabledCookies: true };
  let document = makeDocument();
  const responseHeaders = valuesMap();

  async function request(method, url, body) {
    url = String(url);
    document = makeDocument();
    http.Document = document;
    state.ResultCode = 0;
    let target = url;
    for (let hop = 0; hop < 6; hop++) {
      const u = new URL(target);
      const h = {};
      for (const [k, v] of headers.entries()) h[k] = v;
      if (state.UserAgent) h['User-Agent'] = state.UserAgent;
      const jarCookies = state.EnabledCookies ? jar.forHost(u.hostname) : new Map();
      for (const [k, v] of cookies.entries()) jarCookies.set(k, v);
      if (jarCookies.size) h.Cookie = [...jarCookies].map(([k, v]) => `${k}=${v}`).join('; ');
      if (method === 'POST' && body !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/x-www-form-urlencoded';
      let res;
      const t0 = Date.now();
      try {
        res = await fetchImpl(target, { method, headers: h, body: method === 'POST' ? String(body ?? '') : undefined, redirect: manualRedirects && state.FollowRedirection ? 'manual' : 'follow', signal: AbortSignal.timeout(timeout) });
      } catch (e) {
        const why = e.name === 'TimeoutError' ? `нет ответа за ${timeout / 1000} с` : e.message + (e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : '');
        log(`HTTP ${method} ${target} ✗ ${why} через ${Date.now() - t0} мс`, { request: h, body: method === 'POST' ? String(body ?? '').slice(0, 500) : undefined }, 'WARN');
        state.ResultCode = 0;
        return false;
      }
      const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      if (setCookie.length) jar.store(u.hostname, setCookie);
      state.ResultCode = res.status;
      state.ResultString = res.statusText;
      responseHeaders.Clear();
      res.headers.forEach((v, k) => { responseHeaders.Values[k.replace(/(^|-)\w/g, (m) => m.toUpperCase())] = v; });
      const loc = res.headers.get('location');
      if (state.FollowRedirection && loc && [301, 302, 303, 307, 308].includes(res.status)) {
        log(`HTTP ${method} ${target} → ${res.status} перенаправление на ${loc}`);
        target = new URL(loc, target).toString();
        if (res.status === 303) method = 'GET';
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      state.MimeType = ct.split(';')[0].trim();
      state.LastURL = res.url || target;
      document.bytes = buf;
      document.text = /^(image|video|audio)\//.test(state.MimeType) ? '' : decodeBody(buf, ct);
      const final = res.url && res.url !== target ? ` (итоговый адрес ${res.url})` : '';
      const line = `HTTP ${method} ${target} → ${res.status}${res.statusText ? ' ' + res.statusText : ''}, ${state.MimeType || 'без типа'}, ${buf.length} байт, ${Date.now() - t0} мс${final}`;
      if (res.status >= 400 || !buf.length) {
        // Ответ с ошибкой: что отправили, что пришло и начало тела — по нему видно капчу, «доступ запрещён» и т. п.
        const head = {};
        res.headers.forEach((v, k) => { head[k] = v; });
        log(line, { request: h, response: head, body: document.text.replace(/\s+/g, ' ').slice(0, 600) }, 'WARN');
      } else log(line);
      return buf.length > 0;
    }
    return false;
  }

  const http = {
    get ResultCode() { return state.ResultCode; },
    get ResultString() { return state.ResultString; },
    get LastURL() { return state.LastURL; },
    get MimeType() { return state.MimeType; },
    get UserAgent() { return state.UserAgent; }, set UserAgent(v) { state.UserAgent = String(v ?? ''); },
    get FollowRedirection() { return state.FollowRedirection; }, set FollowRedirection(v) { state.FollowRedirection = Boolean(v); },
    get RetryCount() { return state.RetryCount; }, set RetryCount(v) { state.RetryCount = Number(v) || 0; },
    get EnabledCookies() { return state.EnabledCookies; }, set EnabledCookies(v) { state.EnabledCookies = Boolean(v); },
    get Timeout() { return timeout; }, set Timeout(v) { timeout = Number(v) || timeout; },
    Terminated: false,
    Headers: headers,
    Cookies: cookies,
    ResponseHeaders: responseHeaders,
    Document: document,
    // Асинхронные — Lua-обёртка ждёт их через :await()
    getAsync: (u) => request('GET', u),
    postAsync: (u, data) => request('POST', u, data),
    headAsync: (u) => request('HEAD', u),
    Reset: () => { headers.Clear(); cookies.Clear(); state.MimeType = ''; },
    ResetBasic: () => { headers.Clear(); },
    ClearCookies: () => cookies.Clear(),
    ClearCookiesStorage: () => jar.clear(),
    GetCookies: () => cookies.entries().map(([k, v]) => `${k}=${v}`).join('; '),
    AddServerCookies: () => {},
    ParseServerCookies: () => {},
    RemoveCookie: (name) => { cookies.Values[name] = ''; },
    SetProxy: () => {},
  };
  return http;
}

module.exports = { createHttp, CookieJar, valuesMap, DEFAULT_UA };
