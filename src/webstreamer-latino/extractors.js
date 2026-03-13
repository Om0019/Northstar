import cheerio from 'cheerio-without-node-native';
import { fetchPage, fetchText } from './http.js';
import { extractPackedUrl, guessHeightFromPlaylist, parseQuality, qualityRank, uniqueBy, unpackPacker } from './utils.js';

function absoluteUrl(rawUrl, origin) {
  return new URL(rawUrl.replace(/^\/\//, 'https://'), origin).href;
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

  return unique.map(({ qualityRank: _qualityRank, ...stream }) => stream);
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
      return resolveDropload(result, url);
    }

    if (/mixdrop|mixdrp|mixdroop|m1xdrop/i.test(host)) {
      return resolveMixdrop(result, url);
    }

    if (/dood|do[0-9]go|doood|dooood|ds2play|ds2video|dsvplay|d0o0d|do0od|d0000d|d000d|myvidplay|vidply|all3do|doply|vide0|vvide0|d-s/i.test(host)) {
      return resolveDoodStream(result, url);
    }

    if (/streamtape|streamta\.pe|strtape|strcloud|stape\.fun/i.test(host)) {
      return resolveStreamtape(result, url);
    }

    if (/fastream/i.test(host)) {
      return resolveFastream(result, url);
    }

    if (/waaw|vidora/i.test(host)) {
      return resolveVidora(result, url);
    }

    if (/bullstream|mp4player|watch\.gxplayer/i.test(host)) {
      return resolveStreamEmbed(result, url);
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
  if (value.includes('mixdrop') || value.includes('mixdrp') || value.includes('mixdroop') || value.includes('m1xdrop')) return 'Mixdrop';
  if (value.includes('dood') || value.includes('ds2play') || value.includes('vidply') || value.includes('doply')) return 'DoodStream';
  if (value.includes('streamtape') || value.includes('streamta.pe') || value.includes('strcloud')) return 'Streamtape';
  if (value.includes('fastream')) return 'Fastream';
  if (value.includes('waaw') || value.includes('vidora')) return 'Vidora';
  if (value.includes('gxplayer') || value.includes('bullstream') || value.includes('mp4player')) return 'StreamEmbed';
  if (value.includes('vidsrc') || value.includes('vsrc')) return 'VidSrc';

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_error) {
    return '';
  }
}

function playerRank(player) {
  switch (player) {
    case 'Dropload':
      return 80;
    case 'Fastream':
      return 70;
    case 'Vidora':
      return 60;
    case 'StreamEmbed':
      return 50;
    case 'Mixdrop':
      return 40;
    case 'DoodStream':
      return 30;
    case 'Streamtape':
      return 20;
    case 'VidSrc':
      return 10;
    default:
      return 0;
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
  const finalFileUrl = new URL(finalEmbedUrl.href.replace('/e/', '/f/'));
  const streamHeaders = {
    Referer: finalFileUrl.href,
    Origin: finalEmbedUrl.origin,
  };

  if (cookieHeader) {
    streamHeaders.Cookie = cookieHeader;
  }

  const isPlayable = await validateDirectMedia(directUrl, streamHeaders);
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

  return [buildStream(result, {
    title,
    url: directUrl.href,
    quality: 'Auto',
    headers: { Referer: normalized.href },
    player: 'DoodStream',
  })];
}

async function resolveDropload(result, url) {
  const normalized = url.href
    .replace('/d/', '/')
    .replace('/e/', '/')
    .replace('/embed-', '/');
  const html = await fetchText(normalized, { headers: result.headers });

  if (/File Not Found|Pending in queue/i.test(html)) {
    console.log(`[WebstreamerLatino] Dropload miss: ${url.href}`);
    return [];
  }

  const unpacked = unpackPacker(html);
  const fileMatch = unpacked.match(/sources:\[\{file:"(.*?)"/) || html.match(/sources:\[\{file:"(.*?)"/);
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
  const normalized = new URL(url.href.replace('/e/', '/v/'));
  const html = await fetchText(normalized.href, { headers: result.headers });
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
  const normalized = url.href.replace('/embed/', '/');
  const html = await fetchText(normalized, { headers: result.headers });
  const unpacked = unpackPacker(html);
  const fileMatch = unpacked.match(/file:\s*"(.*?)"/) || unpacked.match(/file:\s*'(.*?)'/);
  if (!fileMatch) {
    console.log(`[WebstreamerLatino] Vidora miss: ${url.href}`);
    return [];
  }

  const page = cheerio.load(html);
  const title = page('title').text().trim().replace(/^Watch /, '') || result.title;
  const origin = new URL(normalized).origin;
  const height = await guessHeightFromPlaylist(fileMatch[1], { Origin: origin });

  return [buildStream(result, {
    title,
    url: fileMatch[1],
    quality: height ? `${height}p` : 'Auto',
    headers: { Origin: origin },
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
