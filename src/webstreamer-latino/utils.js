export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseQuality(value) {
  const match = String(value || '').match(/(2160|1080|720|480|360)p/i);
  return match ? `${match[1]}p` : 'Auto';
}

export function qualityRank(value) {
  const match = String(value || '').match(/(\d{3,4})p/i);
  return match ? parseInt(match[1], 10) : 0;
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function unpackPacker(source) {
  let html = String(source || '');

  while (html.includes('eval(function(p,a,c,k,e,')) {
    const match = html.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/);
    if (!match) {
      break;
    }

    const payload = match[1]
      .replace(/\\'/g, '\'')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    const radix = parseInt(match[2], 10);
    const count = parseInt(match[3], 10);
    const symtab = match[4].split('|');
    const unbase = createUnbase(radix);

    if (!symtab.length || symtab.length < count) {
      break;
    }

    const unpacked = payload.replace(/\b[\w$]+\b/g, (word) => {
      const index = unbase(word);
      return index >= 0 && symtab[index] ? symtab[index] : word;
    });

    html = html.replace(match[0], unpacked);
  }

  return html;
}

export function extractPackedUrl(source, patterns = []) {
  const html = String(source || '');
  const unpacked = unpackPacker(html);
  const combined = `${html}\n${unpacked}`;

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match && match[1]) {
      return String(match[1]).replace(/\\\//g, '/');
    }
  }

  return null;
}

function createUnbase(radix) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  return (value) => {
    const input = String(value || '');
    let result = 0;

    for (let index = 0; index < input.length; index += 1) {
      const code = alphabet.indexOf(input[index]);
      if (code < 0 || code >= radix) {
        return -1;
      }
      result = result * radix + code;
    }

    return result;
  };
}

export async function guessHeightFromPlaylist(url, headers = {}) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    const resolutions = Array.from(text.matchAll(/RESOLUTION=\d+x(\d{3,4})/g))
      .map((match) => parseInt(match[1], 10))
      .filter(Boolean);

    if (resolutions.length) {
      return Math.max(...resolutions);
    }

    const labels = Array.from(text.matchAll(/(\d{3,4})p/gi))
      .map((match) => parseInt(match[1], 10))
      .filter(Boolean);

    return labels.length ? Math.max(...labels) : null;
  } catch (_error) {
    return null;
  }
}
