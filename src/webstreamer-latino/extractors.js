import cheerio from 'cheerio-without-node-native';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import { fetchJson, fetchPage, fetchText } from './http.js';
import { extractPackedUrl, guessHeightFromPlaylist, parseQuality, qualityRank, uniqueBy, unpackPacker } from './utils.js';

const SHOULD_VALIDATE_MEDIA = process.env.NODE_ENV === 'production';

function absoluteUrl(rawUrl, origin) {
  return new URL(rawUrl.replace(/^\/\//, 'https://'), origin).href;
}

function buildPlaybackHeaders(pageUrl, extra = {}) {
  const finalPageUrl = String(pageUrl || '');
  let origin = '';

  try {
    origin = new URL(finalPageUrl).origin;
  } catch (_error) {}

  return {
    ...(origin ? { Origin: origin } : {}),
    ...(finalPageUrl ? { Referer: finalPageUrl } : {}),
    ...extra,
  };
}

function decodeBase64UrlToBytes(value) {
  const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const normalized = input.padEnd(input.length + ((4 - input.length % 4) % 4), '=');

  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'));
  }

  const binary = globalThis.atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeBase64ToText(value) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(String(value || ''), 'base64').toString('utf8');
  }

  return globalThis.atob(String(value || ''));
}

function extractEmbedCode(url) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const markerIndex = parts.findIndex((part) => part === 'e' || part === 'embed');

  if (markerIndex >= 0 && parts[markerIndex + 1]) {
    return parts[markerIndex + 1];
  }

  return parts.length ? parts[parts.length - 1] : '';
}

async function decryptStreamwishPayload(payload) {
  if (!payload?.iv || !payload?.payload || !Array.isArray(payload.key_parts) || payload.key_parts.length === 0) {
    return null;
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return null;
  }

  const keyParts = payload.key_parts.map((part) => decodeBase64UrlToBytes(part));
  const key = new Uint8Array(keyParts.reduce((size, part) => size + part.length, 0));
  let offset = 0;

  keyParts.forEach((part) => {
    key.set(part, offset);
    offset += part.length;
  });

  const iv = decodeBase64UrlToBytes(payload.iv);
  const encrypted = decodeBase64UrlToBytes(payload.payload);
  const importedKey = await subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, importedKey, encrypted);

  return JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted)));
}

function rotate13(value) {
  return String(value || '').replace(/[A-Za-z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function decodeVoeConfigToken(token) {
  const normalized = rotate13(token)
    .replace(/(@\$|\^\^|~@|%\?|\*~|!!|#&)/g, '_')
    .replace(/_/g, '');
  const decoded = decodeBase64ToText(normalized);
  const shifted = Array.from(decoded, (char) => String.fromCharCode(char.charCodeAt(0) - 3)).join('');
  const reversed = shifted.split('').reverse().join('');

  return JSON.parse(decodeBase64ToText(reversed));
}

function extractVoeConfig(html) {
  const matches = html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const match of matches) {
    try {
      const payload = JSON.parse(match[1]);
      if (Array.isArray(payload) && typeof payload[0] === 'string') {
        return decodeVoeConfigToken(payload[0]);
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function extractVoeRedirect(html) {
  const match =
    html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i) ||
    html.match(/window\.location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i) ||
    html.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i) ||
    html.match(/location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i);

  return match?.[1] || null;
}

function buildStream(result, extracted) {
  const quality = extracted.quality || parseQuality(extracted.title || extracted.url);
  const player = extracted.player || result.player || inferPlayerFromUrl(extracted.url || result.url);
  return {
    name: `${result.source} ${result.language}${player ? ` (${player})` : ''}`,
    title: `${extracted.title || result.title || `${result.language} Stream`}${player ? ` [${player}]` : ''}`,
    url: extracted.url,
    quality,
    headers: extracted.headers || result.headers || {},
    provider: 'webstreamer-latino',
    source: result.source,
    language: result.language,
    player,
    extractorTarget: result.url,
    extractorHeaders: result.headers || {},
    qualityRank: qualityRank(quality),
  };
}

export async function resolveLatinoStreams(results) {
  results.forEach((result) => {
    const player = inferPlayerFromUrl(result.url);
    console.log(`[WebstreamerLatino] Candidate: ${result.source} -> ${result.url} -> ${player || 'unknown'}`);
  });

  const settled = await Promise.allSettled(results.map((result) => resolveOne(result)));
  const streams = settled.flatMap((item) => {
    if (item.status === 'fulfilled') {
      return item.value;
    }

    return [];
  });

  const unique = uniqueBy(streams, (stream) => `${stream.url}|${JSON.stringify(stream.headers || {})}`);

  unique.sort((a, b) => {
    const playerComparison = playerRank(b.player) - playerRank(a.player);
    if (playerComparison !== 0) {
      return playerComparison;
    }

    if (b.qualityRank !== a.qualityRank) {
      return b.qualityRank - a.qualityRank;
    }
    return a.name.localeCompare(b.name);
  });

  const validated = await validatePlayableStreams(unique);
  return validated.map(({ qualityRank: _qualityRank, ...stream }) => stream);
}

export async function resolveLatinoMediaflowTarget(targetUrl, headers = {}, options = {}) {
  const player = options.player || inferPlayerFromUrl(targetUrl);
  const result = {
    source: options.source || 'MediaFlow',
    language: options.language || 'Latino',
    title: options.title || 'Latino Stream',
    url: targetUrl,
    referer: options.referer || headers.Referer || headers.referer || targetUrl,
    headers,
    player,
  };

  const streams = await resolveOne(result);
  return streams[0] || null;
}

async function resolveOne(result) {
  try {
    const url = new URL(result.url, result.referer || 'https://example.com');
    const host = url.hostname;

    if (/\.(m3u8|mp4)(\?|$)/i.test(url.href)) {
      return [buildStream(result, { url: url.href, player: inferPlayerFromUrl(url.href) })];
    }

    if (/supervideo/i.test(host)) {
      console.log(`[WebstreamerLatino] SuperVideo skipped: ${result.url}`);
      return [];
    }

    if (/dropload|dr0pstream/i.test(host)) {
      console.log(`[WebstreamerLatino] Dropload skipped: ${result.url}`);
      return [];
    }

    if (/vudeo/i.test(host)) {
      console.log(`[WebstreamerLatino] Vudeo skipped: ${result.url}`);
      return [];
    }

    if (/plustream/i.test(result.player || '')) {
      console.log(`[WebstreamerLatino] Plustream skipped: ${result.url}`);
      return [];
    }

    if (/streamwish|bysejikuar/i.test(host) || /streamwish/i.test(result.player || '')) {
      return resolveStreamwish(result, url);
    }

    if (/voe|dianaavoidthey/i.test(host) || /voe/i.test(result.player || '')) {
      return resolveVoe(result, url);
    }

    if (/mixdrop|mixdrp|mixdroop|m1xdrop/i.test(host)) {
      return resolveMixdrop(result, url);
    }

    if (/filelions|vidhide/i.test(host)) {
      return resolveFilelions(result, url);
    }

    if (/emturbovid|turbovidhls|turboviplay/i.test(host)) {
      return resolveEmturbovid(result, url);
    }

    if (/player\.cuevana3\.eu/i.test(host)) {
      return resolveCuevanaPlayer(result, url);
    }

    if (/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s/i.test(host)) {
      return resolveDoodStream(result, url);
    }

    if (/streamtape|streamta\.pe|strtape|strcloud|stape\.fun/i.test(host)) {
      return resolveStreamtape(result, url);
    }

    if (/fastream/i.test(host)) {
      console.log(`[WebstreamerLatino] Fastream skipped: ${result.url}`);
      return [];
    }

    if (/goodstream/i.test(host)) {
      return resolveGoodstream(result, url);
    }

    if (/waaw|vidora/i.test(host)) {
      console.log(`[WebstreamerLatino] Vidora skipped: ${result.url}`);
      return [];
    }

    if (/strp2p|4meplayer|upns\.pro|p2pplay/i.test(host)) {
      return resolveStrp2p(result, url);
    }

    if (/bullstream|mp4player|watch\.gxplayer/i.test(host)) {
      return resolveStreamEmbed(result, url);
    }

    if (/vimeos/i.test(host)) {
      return resolveVimeos(result, url);
    }

    if (/vidsrc|vsrc/i.test(host)) {
      return resolveVidSrc(result, url);
    }

    console.log(`[WebstreamerLatino] Unsupported host: ${result.url}`);
    return [];
  } catch (_error) {
    return [];
  }
}

function inferPlayerFromUrl(url) {
  const value = String(url || '').toLowerCase();

  if (value.includes('supervideo')) return 'SuperVideo';
  if (value.includes('dropload') || value.includes('dr0pstream')) return 'Dropload';
  if (value.includes('vudeo')) return 'Vudeo';
  if (value.includes('streamwish') || value.includes('bysejikuar')) return 'Streamwish';
  if (value.includes('voe')) return 'VOE';
  if (value.includes('mixdrop') || value.includes('mixdrp') || value.includes('mixdroop') || value.includes('m1xdrop')) return 'Mixdrop';
  if (value.includes('filelions') || value.includes('vidhide')) return 'FileLions';
  if (value.includes('emturbovid') || value.includes('turbovidhls') || value.includes('turboviplay')) return 'Emturbovid';
  if (value.includes('dood') || value.includes('ds2play') || value.includes('vidply') || value.includes('doply')) return 'DoodStream';
  if (value.includes('streamtape') || value.includes('streamta.pe') || value.includes('strcloud')) return 'Streamtape';
  if (value.includes('fastream')) return 'Fastream';
  if (value.includes('goodstream')) return 'Goodstream';
  if (value.includes('waaw') || value.includes('vidora')) return 'Vidora';
  if (value.includes('strp2p') || value.includes('4meplayer') || value.includes('upns.pro') || value.includes('p2pplay')) return 'StrP2P';
  if (value.includes('gxplayer') || value.includes('bullstream') || value.includes('mp4player')) return 'StreamEmbed';
  if (value.includes('vimeos')) return 'Vimeos';
  if (value.includes('vidsrc') || value.includes('vsrc')) return 'VidSrc';

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_error) {
    return '';
  }
}

function playerRank(player) {
  switch (player) {
    case 'FileLions':
      return 90;
    case 'Streamwish':
      return 88;
    case 'Emturbovid':
      return 85;
    case 'DoodStream':
      return 80;
    case 'Dropload':
      return 70;
    case 'Fastream':
      return 60;
    case 'Goodstream':
      return 58;
    case 'Mixdrop':
      return 55;
    case 'Vidora':
      return 45;
    case 'StrP2P':
      return 40;
    case 'StreamEmbed':
      return 35;
    case 'Vimeos':
      return 30;
    case 'Streamtape':
      return 20;
    case 'VOE':
      return 15;
    case 'Vudeo':
      return 5;
    case 'VidSrc':
      return 10;
    default:
      return 0;
  }
}

function shouldProbePlayableStream(stream) {
  const player = String(stream?.player || '').toLowerCase();

  if (!player) {
    return true;
  }

  if (player === 'filelions' || player === 'emturbovid' || player === 'vimeos' || player === 'goodstream' || player === 'voe') {
    return false;
  }

  return [
    'vimeos',
    'streamwish',
    'doodstream',
    'mixdrop',
    'streamtape',
  ].includes(player);
}

async function validatePlayableStreams(streams) {
  const maxFragileProbes = 6;
  let fragileProbeCount = 0;

  const validated = await Promise.all(streams.map(async (stream) => {
    if (!shouldProbePlayableStream(stream)) {
      return stream;
    }

    fragileProbeCount += 1;
    if (fragileProbeCount > maxFragileProbes) {
      return null;
    }

    const ok = await probePlaybackUrl(stream.url, stream.headers);
    if (!ok) {
      console.log(`[WebstreamerLatino] playback probe failed: ${stream.player} -> ${stream.url}`);
      return null;
    }

    return stream;
  }));

  return validated.filter(Boolean);
}

async function probePlaybackUrl(url, headers = {}) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      headers: {
        Range: 'bytes=0-0',
        ...(headers || {}),
      },
      responseType: 'arraybuffer',
      maxRedirects: 5,
      timeout: 1200,
      validateStatus: () => true,
    });

    if (![200, 206].includes(response.status)) {
      return false;
    }

    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    if (contentType.includes('text/html')) {
      return false;
    }

    if (contentType.includes('mpegurl') || contentType.includes('video/') || contentType.includes('octet-stream')) {
      return true;
    }

    return /\.(m3u8|mp4)(\?|$)/i.test(url) || /\/(master|playlist)\.(m3u8|txt)(\?|$)/i.test(url);
  } catch (_error) {
    return false;
  }
}

function extractCookieHeader(rawSetCookie) {
  if (!rawSetCookie) {
    return '';
  }

  const parts = String(rawSetCookie).split(/,(?=[^;,=\s]+=[^;,]+)/);
  const cookies = parts
    .map((part) => part.trim().split(';')[0].trim())
    .filter(Boolean);

  return uniqueBy(cookies, (cookie) => cookie.split('=')[0]).join('; ');
}

function mergeCookieHeaders(...values) {
  const cookies = values
    .flatMap((value) => extractCookieHeader(value).split(/;\s*/))
    .filter(Boolean);

  return uniqueBy(cookies, (cookie) => cookie.split('=')[0]).join('; ');
}

async function validateDirectMedia(url, headers) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(headers || {}),
        Range: 'bytes=0-0',
        Accept: '*/*',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });

    return response.status === 200 || response.status === 206;
  } catch (_error) {
    return false;
  }
}

async function resolveMixdrop(result, url) {
  const normalized = new URL(url.href.replace('/f/', '/e/'));
  const fileUrl = new URL(normalized.href.replace('/e/', '/f/'));
  const baseHeaders = {
    ...(result.headers || {}),
    Referer: result.referer || normalized.origin,
  };
  const embedPage = await fetchPage(normalized.href, {
    headers: { ...baseHeaders, Referer: fileUrl.href },
  }).catch(() => null);
  const filePage = embedPage ? null : await fetchPage(fileUrl.href, { headers: baseHeaders }).catch(() => null);
  const html = embedPage?.text || filePage?.text || null;
  let finalPageUrl = embedPage?.url || filePage?.url || normalized.href;
  let cookieHeader = mergeCookieHeaders(
    result.headers?.Cookie,
    result.headers?.cookie,
    embedPage?.headers?.['set-cookie'],
    filePage?.headers?.['set-cookie']
  );

  if (!html || /can't find the (file|video)/i.test(html)) {
    console.log(`[WebstreamerLatino] Mixdrop miss: ${url.href}`);
    return [];
  }

  let directValue = extractPackedUrl(html, [
    /(?:MDCore|Core|MDp)\.wurl\s*=\s*"([^"]+)"/,
    /(?:MDCore|Core|MDp)\.wurl\s*=\s*'([^']+)'/,
    /wurl\s*=\s*"([^"]+)"/,
    /wurl\s*=\s*'([^']+)'/,
    /src:\s*"([^"]+)"/,
    /src:\s*'([^']+)'/,
    /(?:vsr|wurl)[^"'`]*["'`]((?:https?:)?\/\/[^"'`]+)["'`]/,
  ]);

  if ((!directValue || /^\/e\//.test(directValue)) && filePage?.text) {
    const iframePath = extractPackedUrl(filePage.text, [
      /<iframe[^>]+src="([^"]+)"/i,
      /<iframe[^>]+src='([^']+)'/i,
    ]);

    if (iframePath) {
      const iframeUrl = absoluteUrl(iframePath, fileUrl.origin);
      const nestedPage = await fetchPage(iframeUrl, {
        headers: { ...baseHeaders, Referer: fileUrl.href },
      }).catch(() => null);
      const nestedHtml = nestedPage?.text || null;

      if (nestedHtml) {
        finalPageUrl = nestedPage.url || finalPageUrl;
        cookieHeader = mergeCookieHeaders(cookieHeader, nestedPage.headers?.['set-cookie']);
        directValue = extractPackedUrl(nestedHtml, [
          /(?:MDCore|Core|MDp)\.wurl\s*=\s*"([^"]+)"/,
          /(?:MDCore|Core|MDp)\.wurl\s*=\s*'([^']+)'/,
          /wurl\s*=\s*"([^"]+)"/,
          /wurl\s*=\s*'([^']+)'/,
          /src:\s*"([^"]+)"/,
          /src:\s*'([^']+)'/,
          /(?:vsr|wurl)[^"'`]*["'`]((?:https?:)?\/\/[^"'`]+)["'`]/,
        ]);
      }
    }
  }

  if (!directValue || /^\/e\//.test(directValue)) {
    console.log(`[WebstreamerLatino] Mixdrop parse miss: ${url.href}`);
    return [];
  }

  const directUrl = absoluteUrl(directValue, normalized.origin);
  const page = cheerio.load(filePage?.text || html);
  const title = page('.title b').text().trim() || result.title;
  const finalEmbedUrl = new URL(finalPageUrl);
  const streamHeaders = buildPlaybackHeaders(finalEmbedUrl.href);

  if (cookieHeader) {
    streamHeaders.Cookie = cookieHeader;
  }

  const isPlayable = !SHOULD_VALIDATE_MEDIA || await validateDirectMedia(directUrl, streamHeaders);
  if (!isPlayable) {
    console.log(`[WebstreamerLatino] Mixdrop blocked: ${url.href}`);
    return [];
  }

  return [buildStream(result, {
    title,
    url: directUrl,
    quality: 'Auto',
    headers: streamHeaders,
    player: 'Mixdrop',
  })];
}

async function resolveStreamwish(result, url) {
  const embedUrl = new URL(url.href.replace('/f/', '/e/'));
  const code = extractEmbedCode(embedUrl);
  if (!code) {
    console.log(`[WebstreamerLatino] Streamwish miss: ${url.href}`);
    return [];
  }

  const requestHeaders = {
    ...(result.headers || {}),
    ...buildPlaybackHeaders(embedUrl.href),
    Accept: 'application/json, text/plain, */*',
  };
  const detailsUrl = new URL(`/api/videos/${encodeURIComponent(code)}/embed/details`, embedUrl.origin);
  const playbackUrl = new URL(`/api/videos/${encodeURIComponent(code)}/embed/playback`, embedUrl.origin);

  const details = await fetchJson(detailsUrl.href, { headers: requestHeaders }).catch(() => null);
  const playback = await fetchJson(playbackUrl.href, { headers: requestHeaders }).catch(() => null);
  const media = await decryptStreamwishPayload(playback?.playback || playback).catch(() => null);
  const sources = Array.isArray(media?.sources) ? media.sources : [];

  if (sources.length === 0) {
    console.log(`[WebstreamerLatino] Streamwish parse miss: ${url.href}`);
    return [];
  }

  const bestSource = [...sources]
    .filter((source) => source?.url)
    .sort((left, right) => {
      const leftHeight = parseInt(left.height || parseQuality(left.label).replace(/\D+/g, ''), 10) || 0;
      const rightHeight = parseInt(right.height || parseQuality(right.label).replace(/\D+/g, ''), 10) || 0;
      const leftBitrate = parseInt(left.bitrate_kbps, 10) || 0;
      const rightBitrate = parseInt(right.bitrate_kbps, 10) || 0;

      if (rightHeight !== leftHeight) {
        return rightHeight - leftHeight;
      }

      return rightBitrate - leftBitrate;
    })[0];

  if (!bestSource?.url) {
    console.log(`[WebstreamerLatino] Streamwish parse miss: ${url.href}`);
    return [];
  }

  const streamHeaders = buildPlaybackHeaders(embedUrl.href);
  const quality = bestSource.height
    ? `${bestSource.height}p`
    : parseQuality(bestSource.label || bestSource.url);

  return [buildStream(result, {
    title: details?.title || result.title,
    url: absoluteUrl(bestSource.url, embedUrl.origin),
    quality,
    headers: streamHeaders,
    player: 'Streamwish',
  })];
}

async function resolveVoe(result, url) {
  const headers = {
    ...(result.headers || {}),
    Referer: result.referer || url.href,
  };
  let page = await fetchPage(url.href, { headers }).catch(() => null);
  let html = page?.text || null;

  if (!html) {
    console.log(`[WebstreamerLatino] VOE miss: ${url.href}`);
    return [];
  }

  let config = extractVoeConfig(html);
  if (!config) {
    const redirectUrl = extractVoeRedirect(html);
    if (redirectUrl) {
      page = await fetchPage(absoluteUrl(redirectUrl, url.origin), {
        headers: buildPlaybackHeaders(absoluteUrl(redirectUrl, url.origin)),
      }).catch(() => null);
      html = page?.text || null;
      config = html ? extractVoeConfig(html) : null;
    }
  }

  const finalPageUrl = page.url || url.href;
  const streamHeaders = buildPlaybackHeaders(finalPageUrl);
  const playlistUrl = config?.source || null;
  const directUrl = config?.direct_access_allowed !== false ? config?.direct_access_url : null;
  const streamUrl = playlistUrl || directUrl;

  if (!streamUrl) {
    console.log(`[WebstreamerLatino] VOE parse miss: ${url.href}`);
    return [];
  }

  return [buildStream(result, {
    title: config?.title || result.title,
    url: absoluteUrl(streamUrl, finalPageUrl),
    quality: 'Auto',
    headers: streamHeaders,
    player: 'VOE',
  })];
}

async function resolveFilelions(result, url) {
  const normalized = new URL(
    url.href
      .replace('/v/', '/f/')
      .replace('/download/', '/f/')
      .replace('/file/', '/f/')
  );
  const headers = {
    ...(result.headers || {}),
    Referer: result.referer || 'https://ww1.cuevana3.is/',
  };
  const page = await fetchPage(normalized.href, { headers }).catch(() => null);
  if (!page?.text) {
    console.log(`[WebstreamerLatino] FileLions miss: ${url.href}`);
    return [];
  }

  const unpacked = unpackPacker(page.text);
  const hls4Match = unpacked.match(/["']hls4["']\s*:\s*["']([^"']+)/i);
  const hls3Match = unpacked.match(/["']hls3["']\s*:\s*["']([^"']+)/i);
  const hls2Match =
    unpacked.match(/var\s+links\s*=\s*\{[^}]*["']hls2["']\s*:\s*["']([^"']+)/i) ||
    unpacked.match(/["']hls2["']\s*:\s*["']([^"']+)/i);
  const fileMatch =
    unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i) ||
    unpacked.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i);
  const playlistCandidate = hls4Match?.[1] || hls3Match?.[1] || hls2Match?.[1] || fileMatch?.[1];

  if (!playlistCandidate) {
    console.log(`[WebstreamerLatino] FileLions parse miss: ${url.href}`);
    return [];
  }

  const finalPageUrl = page.url || normalized.href;
  const playlistUrl = absoluteUrl(playlistCandidate.replace(/\\\//g, '/'), finalPageUrl);
  const title = cheerio.load(unpacked)('meta[name="description"]').attr('content') || result.title;
  const streamHeaders = buildPlaybackHeaders(finalPageUrl);

  return [buildStream(result, {
    title,
    url: playlistUrl,
    quality: 'Auto',
    headers: streamHeaders,
    player: 'FileLions',
  })];
}

async function resolveEmturbovid(result, url) {
  const headers = {
    ...(result.headers || {}),
    Referer: result.referer || 'https://tioplus.app/',
  };
  const page = await fetchPage(url.href, { headers }).catch(() => null);
  const html = page?.text;
  if (!html) {
    console.log(`[WebstreamerLatino] Emturbovid miss: ${url.href}`);
    return [];
  }

  const playlistMatch =
    html.match(/data-hash="([^"]+\.m3u8[^"]*)"/i) ||
    html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);

  if (!playlistMatch) {
    console.log(`[WebstreamerLatino] Emturbovid parse miss: ${url.href}`);
    return [];
  }

  const playlistUrl = playlistMatch[1].replace(/\\\//g, '/');
  const title = cheerio.load(html)('title').text().trim() || result.title;
  const streamHeaders = buildPlaybackHeaders(page.url || url.href);

  return [buildStream(result, {
    title,
    url: playlistUrl,
    quality: 'Auto',
    headers: streamHeaders,
    player: 'Emturbovid',
  })];
}

async function resolveCuevanaPlayer(result, url) {
  const html = await fetchText(url.href, {
    headers: {
      ...(result.headers || {}),
      Referer: result.referer || 'https://ww1.cuevana3.is/',
    },
  }).catch(() => null);

  if (!html) {
    console.log(`[WebstreamerLatino] Cuevana player miss: ${url.href}`);
    return [];
  }

  const targetMatch =
    html.match(/var\s+url\s*=\s*'([^']+)'/i) ||
    html.match(/var\s+url\s*=\s*"([^"]+)"/i) ||
    html.match(/<iframe[^>]+src="([^"]+)"/i) ||
    html.match(/<iframe[^>]+src='([^']+)'/i);

  if (!targetMatch) {
    console.log(`[WebstreamerLatino] Cuevana player parse miss: ${url.href}`);
    return [];
  }

  return resolveOne({
    ...result,
    url: absoluteUrl(targetMatch[1], url.origin),
    referer: url.href,
    headers: { Referer: url.href },
  });
}

async function resolveStrp2p(result, url) {
  if (!url.hash || url.hash.length < 2) {
    console.log(`[WebstreamerLatino] StrP2P miss: ${url.href}`);
    return [];
  }

  const apiUrl = new URL(`/api/v1/video?id=${encodeURIComponent(url.hash.slice(1))}`, url.origin);
  const headers = {
    Origin: url.origin,
    Referer: `${url.origin}/`,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  };

  const hexData = await fetchText(apiUrl.href, { headers }).catch(() => null);
  if (!hexData) {
    console.log(`[WebstreamerLatino] StrP2P miss: ${url.href}`);
    return [];
  }

  try {
    const encrypted = CryptoJS.enc.Hex.parse(hexData.trim().slice(0, -1));
    const key = CryptoJS.enc.Hex.parse('6b69656d7469656e6d75613931316361');
    const iv = CryptoJS.enc.Hex.parse('313233343536373839306f6975797472');
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: encrypted },
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    ).toString(CryptoJS.enc.Utf8);
    const { source, title } = JSON.parse(decrypted);

    if (!source) {
      console.log(`[WebstreamerLatino] StrP2P parse miss: ${url.href}`);
      return [];
    }

    const playlistUrl = new URL(source, url.origin);
    const height = await guessHeightFromPlaylist(playlistUrl.href, headers).catch(() => null);

    return [
      buildStream(result, {
        url: playlistUrl.href,
        title,
        quality: height ? `${height}p` : 'Auto',
        player: 'StrP2P',
        headers,
      }),
    ];
  } catch (_error) {
    console.log(`[WebstreamerLatino] StrP2P parse miss: ${url.href}`);
    return [];
  }
}

async function resolveDoodStream(result, url) {
  const videoId = url.pathname.replace(/\/+$/, '').split('/').pop();
  if (!videoId) {
    return [];
  }

  const normalized = new URL(`https://dood.to/e/${videoId}`);
  const headers = {
    ...(result.headers || {}),
    Referer: `${normalized.origin}/`,
    Origin: normalized.origin,
  };
  const html = await fetchText(normalized.href, { headers }).catch(() => null);

  if (!html || /Video not found/i.test(html)) {
    console.log(`[WebstreamerLatino] Dood miss: ${url.href}`);
    return [];
  }

  const titlePage = cheerio.load(html);
  const title = titlePage('title').text().trim().replace(/ - DoodStream$/i, '').trim() || result.title;

  const passMatch =
    html.match(/\$\.get\(\s*['"]([^'"]*\/pass_md5\/[^'"]+)['"]\s*,/i) ||
    html.match(/(\/pass_md5\/[^'"\\\s]+)/);
  if (!passMatch) {
    console.log(`[WebstreamerLatino] Dood pass_md5 miss: ${normalized.href}`);
    return [];
  }

  const passUrl = new URL(passMatch[1], normalized.origin).href;
  const passToken = passUrl.split('/').filter(Boolean).pop();
  const tokenMatch = html.match(/token=([^&'"]+)/);
  const token = tokenMatch?.[1] || passToken;
  const passResponse = await fetchText(passUrl, {
    headers: {
      Referer: normalized.href,
      'User-Agent': (result.headers || {})['User-Agent'],
    },
  }).catch(() => null);

  if (!passResponse) {
    console.log(`[WebstreamerLatino] Dood pass_md5 fetch miss: ${normalized.href}`);
    return [];
  }

  const directBase = passResponse.trim();
  const suffix = Math.random().toString(36).slice(2, 12);
  const directUrl = new URL(`${directBase}${suffix}`);
  if (token) {
    directUrl.searchParams.set('token', token);
  }
  directUrl.searchParams.set('expiry', String(Date.now()));
  const streamHeaders = { Referer: normalized.href };
  const isPlayable = !SHOULD_VALIDATE_MEDIA || await validateDirectMedia(directUrl.href, streamHeaders);
  if (!isPlayable) {
    console.log(`[WebstreamerLatino] Dood blocked: ${normalized.href}`);
    return [];
  }

  return [buildStream(result, {
    title,
    url: directUrl.href,
    quality: 'Auto',
    headers: streamHeaders,
    player: 'DoodStream',
  })];
}

async function resolveDropload(result, url) {
  const normalized = url.href
    .replace('/d/', '/')
    .replace('/e/', '/')
    .replace('/embed-', '/');
  const html = await fetchText(normalized, { headers: result.headers }).catch(() => null);

  if (!html) {
    console.log(`[WebstreamerLatino] Dropload miss: ${url.href}`);
    return [];
  }

  if (/File Not Found|Pending in queue|no longer available|expired or has been deleted/i.test(html)) {
    console.log(`[WebstreamerLatino] Dropload miss: ${url.href}`);
    return [];
  }

  const unpacked = unpackPacker(html);
  const fileMatch =
    unpacked.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i) ||
    html.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i) ||
    unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i) ||
    html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
  if (!fileMatch) {
    console.log(`[WebstreamerLatino] Dropload parse miss: ${url.href}`);
    return [];
  }

  const hostMatch = html.match(/(https:\/\/.+?\/)player/);
  const page = cheerio.load(html);
  const title = page('.videoplayer h1').text().trim() || result.title;
  const playlistHeaders = hostMatch ? { Referer: hostMatch[1] } : (result.headers || {});
  const height = await guessHeightFromPlaylist(fileMatch[1], playlistHeaders);

  return [buildStream(result, {
    title,
    url: fileMatch[1],
    quality: height ? `${height}p` : 'Auto',
    headers: playlistHeaders,
    player: 'Dropload',
  })];
}

async function resolveStreamtape(result, url) {
  const candidates = uniqueBy([
    url.href,
    url.href.replace('/e/', '/v/'),
    url.href.replace('/v/', '/e/'),
  ], (value) => value);

  let html = null;
  let finalUrl = null;

  for (const candidate of candidates) {
    const page = await fetchText(candidate, { headers: result.headers }).catch(() => null);
    if (!page) {
      continue;
    }
    if (/Video not found|Maybe it got deleted by the creator/i.test(page)) {
      continue;
    }
    html = page;
    finalUrl = candidate;
    break;
  }

  if (!html) {
    console.log(`[WebstreamerLatino] Streamtape miss: ${url.href}`);
    return [];
  }

  const directMatch = html.match(/'(\/\/streamtape\.com\/get_video[^']+)'/) || html.match(/"(\/\/streamtape\.com\/get_video[^"]+)"/);

  if (!directMatch) {
    console.log(`[WebstreamerLatino] Streamtape miss: ${url.href}`);
    return [];
  }

  const page = cheerio.load(html);
  const title = page('meta[name="og:title"]').attr('content') || result.title;

  return [buildStream(result, {
    title,
    url: `https:${directMatch[1]}`,
    quality: '720p',
    headers: finalUrl ? { Referer: finalUrl } : undefined,
    player: 'Streamtape',
  })];
}

async function resolveFastream(result, url) {
  const candidates = [
    url.href,
    url.href.replace('/e/', '/embed-').replace('/d/', '/embed-'),
    url.href.replace('/embed-', '/d/'),
  ];

  for (const candidate of candidates) {
    const html = await fetchText(candidate, { headers: result.headers }).catch(() => null);
    if (!html) {
      continue;
    }

    const unpacked = unpackPacker(html);
    const fileMatch = unpacked.match(/sources:\[\{file:"(.*?)"/) || unpacked.match(/file:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
    if (!fileMatch) {
      continue;
    }

    const titleMatch = html.match(/>Download (.*?)</);
    const headers = { Referer: candidate };
    const height = await guessHeightFromPlaylist(fileMatch[1], headers);

    return [buildStream(result, {
      title: titleMatch ? titleMatch[1] : result.title,
      url: fileMatch[1],
      quality: height ? `${height}p` : 'Auto',
      headers,
      player: 'Fastream',
    })];
  }

  console.log(`[WebstreamerLatino] Fastream miss: ${url.href}`);
  return [];
}

async function resolveVidora(result, url) {
  const candidates = uniqueBy([
    url.href.replace('/embed/', '/').replace('/f/', '/e/'),
    url.href.replace('/embed/', '/'),
    url.href,
  ], (value) => value);

  let html = null;
  let finalUrl = null;

  for (const candidate of candidates) {
    const page = await fetchText(candidate, { headers: result.headers }).catch(() => null);
    if (!page) {
      continue;
    }
    html = page;
    finalUrl = candidate;
    break;
  }

  if (!html || !finalUrl) {
    console.log(`[WebstreamerLatino] Vidora miss: ${url.href}`);
    return [];
  }

  const unpacked = unpackPacker(html);
  const fileMatch =
    unpacked.match(/file:\s*"(.*?)"/) ||
    unpacked.match(/file:\s*'(.*?)'/) ||
    html.match(/src:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)/i);
  if (!fileMatch) {
    console.log(`[WebstreamerLatino] Vidora miss: ${url.href}`);
    return [];
  }

  const page = cheerio.load(html);
  const title = page('title').text().trim().replace(/^Watch /, '') || result.title;
  const streamHeaders = buildPlaybackHeaders(finalUrl);
  const height = await guessHeightFromPlaylist(fileMatch[1], streamHeaders);

  return [buildStream(result, {
    title,
    url: fileMatch[1],
    quality: height ? `${height}p` : 'Auto',
    headers: streamHeaders,
    player: 'Vidora',
  })];
}

async function resolveStreamEmbed(result, url) {
  const html = await fetchText(url.href, { headers: result.headers });
  if (/Video is not ready/i.test(html)) {
    console.log(`[WebstreamerLatino] StreamEmbed not ready: ${url.href}`);
    return [];
  }

  const videoMatch = html.match(/video ?= ?(.*);/);
  if (!videoMatch) {
    console.log(`[WebstreamerLatino] StreamEmbed parse miss: ${url.href}`);
    return [];
  }

  const video = JSON.parse(videoMatch[1]);
  const playlistUrl = new URL(`/m3u8/${video.uid}/${video.md5}/master.txt?s=1&id=${video.id}&cache=${video.status}`, url.origin).href;
  const qualityList = JSON.parse(video.quality || '[]');

  return [buildStream(result, {
    title: decodeURIComponent(video.title || result.title),
    url: playlistUrl,
    quality: qualityList[0] ? `${qualityList[0]}p` : 'Auto',
    player: 'StreamEmbed',
  })];
}

async function resolveGoodstream(result, url) {
  const pageUrl = url.href;
  const html = await fetchText(pageUrl, { headers: result.headers }).catch(() => null);
  if (!html) {
    console.log(`[WebstreamerLatino] Goodstream miss: ${pageUrl}`);
    return [];
  }

  if (/expired|deleted|file is no longer available/i.test(html)) {
    console.log(`[WebstreamerLatino] Goodstream dead link: ${pageUrl}`);
    return [];
  }

  const fileMatch =
    html.match(/sources:\s*\[\s*\{\s*file:"([^"]+\.m3u8[^"]*)"/i) ||
    html.match(/sources:\s*\[\s*\{\s*file:'([^']+\.m3u8[^']*)'/i) ||
    html.match(/file:"([^"]+\.m3u8[^"]*)"/i) ||
    html.match(/file:'([^']+\.m3u8[^']*)'/i);

  if (!fileMatch) {
    console.log(`[WebstreamerLatino] Goodstream parse miss: ${pageUrl}`);
    return [];
  }

  const playlistUrl = fileMatch[1].replace(/\\\//g, '/');
  const streamHeaders = buildPlaybackHeaders(pageUrl);
  const height = await guessHeightFromPlaylist(playlistUrl, streamHeaders).catch(() => null);

  return [buildStream(result, {
    url: playlistUrl,
    quality: height ? `${height}p` : 'Auto',
    headers: streamHeaders,
    player: 'Goodstream',
  })];
}

async function resolveVimeos(result, url) {
  const headers = {
    ...(result.headers || {}),
    Referer: result.referer || url.href,
  };
  const html = await fetchText(url.href, { headers }).catch(() => null);
  if (!html) {
    console.log(`[WebstreamerLatino] Vimeos miss: ${url.href}`);
    return [];
  }

  const unpacked = unpackPacker(html) || '';
  const body = `${html}\n${unpacked}`;
  const fileMatch =
    body.match(/sources:\s*\[\{file:"([^"]+\.m3u8[^"]*)"/i) ||
    body.match(/sources:\s*\[\{file:'([^']+\.m3u8[^']*)'/i) ||
    body.match(/https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*/i);

  if (!fileMatch) {
    console.log(`[WebstreamerLatino] Vimeos parse miss: ${url.href}`);
    return [];
  }

  const playlistUrl = (fileMatch[1] || fileMatch[0]).replace(/\\\//g, '/');
  const posterMatch = body.match(/image:"([^"]+)"/i);
  const height = await guessHeightFromPlaylist(playlistUrl, { Referer: url.href }).catch(() => null);

  return [buildStream(result, {
    title: posterMatch ? result.title : result.title,
    url: playlistUrl,
    quality: height ? `${height}p` : 'Auto',
    headers: { Referer: url.href },
    player: 'Vimeos',
  })];
}

async function resolveVidSrc(result, url) {
  const html = await fetchText(url.href, { headers: result.headers });
  const tokenMatch = html.match(/['"]token['"]: ?['"](.*?)['"]/);
  const expiresMatch = html.match(/['"]expires['"]: ?['"](.*?)['"]/);
  const urlMatch = html.match(/url: ?['"](.*?)['"]/);

  if (!tokenMatch || !expiresMatch || !urlMatch) {
    console.log(`[WebstreamerLatino] VidSrc parse miss: ${url.href}`);
    return [];
  }

  const baseUrl = new URL(urlMatch[1]);
  const playlistUrl = new URL(`${baseUrl.origin}${baseUrl.pathname}.m3u8?${baseUrl.searchParams}`);
  playlistUrl.searchParams.append('token', tokenMatch[1]);
  playlistUrl.searchParams.append('expires', expiresMatch[1]);
  playlistUrl.searchParams.append('h', '1');

  const height = await guessHeightFromPlaylist(playlistUrl.href, { Referer: url.href });

  return [buildStream(result, {
    url: playlistUrl.href,
    quality: height ? `${height}p` : 'Auto',
    headers: { Referer: url.href },
    player: 'VidSrc',
  })];
}
