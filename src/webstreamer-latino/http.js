import axios from 'axios';
import { DEFAULT_HEADERS } from './constants.js';

const cookieJar = new Map();
const pageCache = new Map();
const pendingPageRequests = new Map();
const PAGE_CACHE_TTL_MS = 2 * 60 * 1000;

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

function sortedHeaders(headers = {}) {
  return Object.keys(headers)
    .sort()
    .reduce((acc, key) => {
      acc[key] = headers[key];
      return acc;
    }, {});
}

function clonePage(page) {
  return {
    text: page.text,
    url: page.url,
    headers: { ...(page.headers || {}) },
  };
}

function getCachedPage(key) {
  const entry = pageCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    pageCache.delete(key);
    return null;
  }

  return clonePage(entry.value);
}

function setCachedPage(key, value) {
  pageCache.set(key, {
    value: clonePage(value),
    expiresAt: Date.now() + PAGE_CACHE_TTL_MS,
  });
}

function createPageCacheKey(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET' || options.body || options._warmed) {
    return null;
  }

  return JSON.stringify({
    url,
    method,
    headers: sortedHeaders(options.headers || {}),
  });
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
    timeout: 15000,
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
  const cacheKey = createPageCacheKey(url, options);
  if (cacheKey) {
    const cached = getCachedPage(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = pendingPageRequests.get(cacheKey);
    if (pending) {
      return clonePage(await pending);
    }
  }

  const request = (async () => {
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

    const page = {
      text: typeof response.data === 'string' ? response.data : String(response.data || ''),
      url: response.request?.res?.responseUrl || response.config?.url || url,
      headers,
    };

    if (cacheKey) {
      setCachedPage(cacheKey, page);
    }

    return page;
  })();

  if (!cacheKey) {
    return request;
  }

  pendingPageRequests.set(cacheKey, request);
  try {
    return clonePage(await request);
  } finally {
    pendingPageRequests.delete(cacheKey);
  }
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
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.data;
}
