import { DEFAULT_HEADERS } from './constants.js';

function mergeHeaders(headers) {
  return { ...DEFAULT_HEADERS, ...(headers || {}) };
}

export async function fetchPage(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: mergeHeaders(options.headers),
    body: options.body,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  const text = await response.text();
  const headers = {};

  for (const [key, value] of response.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }

  return {
    text,
    url: response.url,
    headers,
  };
}

export async function fetchText(url, options = {}) {
  const page = await fetchPage(url, options);
  return page.text;
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: mergeHeaders({
      Accept: 'application/json,text/plain,*/*',
      ...(options.headers || {}),
    }),
    body: options.body,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.json();
}
