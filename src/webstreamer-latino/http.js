import axios from 'axios';
import { DEFAULT_HEADERS } from './constants.js';

const cookieJar = new Map();
const REQUEST_TIMEOUT_MS = Math.max(1000, parseInt(process.env.WEBSTREAMER_LATINO_HTTP_TIMEOUT_MS || '15000', 10) || 15000);

function mergeHeaders(headers) {
  return { ...DEFAULT_HEADERS, ...(headers || {}) };
}

function getCookieHeader(url) {
  const hostname = new URL(url).hostname;
  return cookieJar.get(hostname) || '';
}

function storeCookies(url, response) {
  const hostname = new URL(url).hostname;
  const existing = cookieJar.get(hostname) || '';
  const cookieMap = new Map();

  if (existing) {
    existing.split(/;\s*/).forEach((pair) => {
      const [name, ...rest] = pair.split('=');
      if (!name || !rest.length) {
        return;
      }
      cookieMap.set(name.trim(), rest.join('=').trim());
    });
  }

  const setCookie = response.headers?.['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  cookies.forEach((cookie) => {
    const pair = String(cookie).split(';')[0];
    const [name, ...rest] = pair.split('=');
    if (!name || !rest.length) {
      return;
    }
    cookieMap.set(name.trim(), rest.join('=').trim());
  });

  if (cookieMap.size > 0) {
    cookieJar.set(
      hostname,
      Array.from(cookieMap.entries()).map(([name, value]) => `${name}=${value}`).join('; '),
    );
  }
}

async function issueRequest(url, options = {}) {
  const cookieHeader = getCookieHeader(url);
  const navigationHeaders = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  const response = await axios({
    url,
    method: options.method || 'GET',
    headers: mergeHeaders({
      ...navigationHeaders,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(options.headers || {}),
    }),
    data: options.body,
    responseType: 'text',
    maxRedirects: 5,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  storeCookies(url, response);
  return response;
}

async function warmHost(url, headers) {
  const parsed = new URL(url);
  await issueRequest(parsed.origin, {
    headers: {
      Referer: parsed.origin,
      ...(headers || {}),
    },
  }).catch(() => null);
}

export async function fetchPage(url, options = {}) {
  let response = await issueRequest(url, options);

  if (response.status === 403 && !options._warmed) {
    await warmHost(url, options.headers);
    response = await issueRequest(url, { ...options, _warmed: true });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }
  const headers = {};
  for (const [key, value] of Object.entries(response.headers || {})) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  return {
    text: typeof response.data === 'string' ? response.data : String(response.data || ''),
    url: response.request?.res?.responseUrl || response.config?.url || url,
    headers,
  };
}

export async function fetchText(url, options = {}) {
  const page = await fetchPage(url, options);
  return page.text;
}

export async function fetchJson(url, options = {}) {
  const response = await axios({
    url,
    method: options.method || 'GET',
    headers: mergeHeaders({
      Accept: 'application/json,text/plain,*/*',
      ...(options.headers || {}),
    }),
    data: options.body,
    responseType: 'json',
    maxRedirects: 5,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.data;
}
