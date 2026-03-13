import cheerio from 'cheerio-without-node-native';
import { SOURCE_BASES } from './constants.js';
import { fetchPage, fetchText } from './http.js';
import { buildEpisodeTag } from './tmdb.js';
import { normalizeTitle } from './utils.js';

function languageMeta(kind) {
  return kind === 'mx'
    ? { language: 'Latino', contentLanguage: 'es-mx' }
    : { language: 'Castellano', contentLanguage: 'es-es' };
}

function buildTitle(tmdb, season, episode) {
  if (tmdb.mediaType === 'tv' && season && episode) {
    return `${tmdb.title} ${buildEpisodeTag(season, episode)}`;
  }

  return tmdb.year ? `${tmdb.title} (${tmdb.year})` : tmdb.title;
}

export async function getLatinoSourceResults(tmdb, mediaType, season, episode) {
  await Promise.allSettled([
    prewarmSource(SOURCE_BASES.cuevana),
    prewarmSource(SOURCE_BASES.verhdlink),
    prewarmSource(SOURCE_BASES.tioplus),
  ]);

  const tasks = [
    searchCuevana(tmdb, season, episode),
    searchCineHdPlus(tmdb, mediaType, season, episode),
    searchHomeCine(tmdb, season, episode),
    searchVerHdLink(tmdb, mediaType),
    searchTioPlus(tmdb, mediaType),
  ];

  const settled = await Promise.allSettled(tasks);

  return settled.flatMap((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    console.error('[WebstreamerLatino] Source error:', result.reason ? result.reason.message : result.reason);
    return [];
  });
}

async function prewarmSource(baseUrl) {
  await fetchPage(baseUrl, {
    headers: {
      Referer: baseUrl,
      Origin: new URL(baseUrl).origin,
    },
  }).catch(() => null);
}

async function searchCuevana(tmdb, season, episode) {
  const searchTerm = tmdb.title || tmdb.originalTitle;
  if (!searchTerm) {
    return [];
  }

  const searchUrl = `${SOURCE_BASES.cuevana}/search/${encodeURIComponent(searchTerm)}/`;
  const html = await fetchText(searchUrl, {
    headers: { Referer: SOURCE_BASES.cuevana },
  });
  const $ = cheerio.load(html);
  const targetNorm = normalizeTitle(searchTerm);

  let pagePath = null;
  let bestScore = -1;

  $('.TPost .Title').each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).closest('a').attr('href');
    if (!href) {
      return;
    }

    let score = 0;
    const norm = normalizeTitle(title);
    if (norm === targetNorm) {
      score += 10;
    }
    if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
      score += 5;
    }

    const year = $(el).closest('.TPost').find('.Year').first().text().trim();
    if (tmdb.year && year === tmdb.year) {
      score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      pagePath = href;
    }
  });

  if (!pagePath) {
    return [];
  }

  let pageUrl = new URL(pagePath, SOURCE_BASES.cuevana);

  if (tmdb.mediaType === 'tv' && season && episode) {
    const episodeHtml = await fetchText(pageUrl.href, {
      headers: { Referer: pageUrl.origin },
    });
    const $$ = cheerio.load(episodeHtml);
    const episodePath = $$('.TPost .Year')
      .filter((_, el) => $$(el).text().trim() === `${season}x${episode}`)
      .closest('a')
      .attr('href');

    if (!episodePath) {
      return [];
    }

    pageUrl = new URL(episodePath, pageUrl.origin);
  }

  const pageHtml = await fetchText(pageUrl.href, {
    headers: { Referer: pageUrl.origin },
  });
  const $$$ = cheerio.load(pageHtml);
  const results = [];

  $$$('.open_submenu').each((_, el) => {
    const text = $$$(el).text();
    if (!/espa[nñ]ol/i.test(text) || !/latino/i.test(text)) {
      return;
    }

    $$$(el).find('[data-tr], [data-video]').each((__, node) => {
      const rawUrl = $$$(node).attr('data-tr') || $$$(node).attr('data-video');
      if (!rawUrl) {
        return;
      }

      results.push({
        source: 'Cuevana',
        language: 'Latino',
        title: buildTitle(tmdb, season, episode),
        url: rawUrl,
        referer: pageUrl.href,
        headers: { Referer: pageUrl.href },
      });
    });
  });

  return results;
}

async function searchCineHdPlus(tmdb, mediaType, season, episode) {
  if (mediaType !== 'tv' || !season || !episode) {
    return [];
  }

  const searchUrl = `${SOURCE_BASES.cinehdplus}/series/?story=${tmdb.tmdbId}&do=search&subaction=search`;
  const html = await fetchText(searchUrl);
  const $ = cheerio.load(html);
  const pageUrl = $('.card__title a[href]').first().attr('href');

  if (!pageUrl) {
    return [];
  }

  const pageHtml = await fetchText(pageUrl);
  const $$ = cheerio.load(pageHtml);
  const isLatino = /latino/i.test($$('.details__langs').text());
  if (!isLatino) {
    return [];
  }

  const title = `${$$('meta[property="og:title"]').attr('content') || tmdb.title} ${buildEpisodeTag(season, episode)}`;
  const results = [];

  $$(`[data-num="${season}x${episode}"]`)
    .siblings('.mirrors')
    .children('[data-link]')
    .each((_, el) => {
      const rawUrl = $$(el).attr('data-link');
      if (!rawUrl || /cinehdplus/.test(rawUrl)) {
        return;
      }

      results.push({
        source: 'CineHDPlus',
        ...languageMeta('mx'),
        title,
        url: rawUrl.replace(/^(https:)?\/\//, 'https://'),
        referer: pageUrl,
        headers: { Referer: pageUrl },
      });
    });

  return results;
}

async function searchHomeCine(tmdb, season, episode) {
  const candidateNames = [tmdb.title, tmdb.originalTitle].filter(Boolean);
  let pageUrl = null;

  for (const candidate of candidateNames) {
    pageUrl = await findHomeCinePage(candidate, tmdb.mediaType === 'tv');
    if (pageUrl) {
      break;
    }
  }

  if (!pageUrl) {
    return [];
  }

  let pageHtml = await fetchText(pageUrl);

  if (tmdb.mediaType === 'tv' && season && episode) {
    const episodeUrl = extractHomeCineEpisodeUrl(pageHtml, season, episode);
    if (!episodeUrl) {
      return [];
    }
    pageUrl = episodeUrl;
    pageHtml = await fetchText(pageUrl);
  }

  const $ = cheerio.load(pageHtml);
  const results = [];

  $('.les-content a').each((_, el) => {
    const text = $(el).text().toLowerCase();
    if (!text.includes('latino')) {
      return;
    }

    const href = $(el).attr('href');
    if (!href) {
      return;
    }

    const iframeHtml = `<div>${href}</div>`;
    const iframeSrc = cheerio.load(iframeHtml)('iframe').attr('src');
    if (!iframeSrc) {
      return;
    }

    results.push({
      source: 'HomeCine',
      ...languageMeta('mx'),
      title: buildTitle(tmdb, season, episode),
      url: iframeSrc,
      referer: pageUrl,
      headers: { Referer: pageUrl },
    });
  });

  return results;
}

async function findHomeCinePage(name, isSeries) {
  const searchUrl = `${SOURCE_BASES.homecine}/?s=${encodeURIComponent(name)}`;
  const html = await fetchText(searchUrl);
  const $ = cheerio.load(html);
  const candidates = [];
  const targetNorm = normalizeTitle(name);

  $('a[oldtitle]').each((_, el) => {
    const oldTitle = ($(el).attr('oldtitle') || '').trim();
    const href = $(el).attr('href');
    if (!href) {
      return;
    }

    const seriesMatch = href.includes('/series/');
    if (isSeries !== seriesMatch) {
      return;
    }

    let score = 0;
    const norm = normalizeTitle(oldTitle);
    if (norm === targetNorm) {
      score += 10;
    }
    if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
      score += 5;
    }

    candidates.push({ href, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].href : null;
}

function extractHomeCineEpisodeUrl(pageHtml, season, episode) {
  const $ = cheerio.load(pageHtml);
  const suffix = `-temporada-${season}-capitulo-${episode}`;

  const href = $('#seasons a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .find((value) => value && value.endsWith(suffix));

  return href || null;
}

async function searchVerHdLink(tmdb, mediaType) {
  if (mediaType !== 'movie' || !tmdb.imdbId) {
    return [];
  }

  const pageUrl = `${SOURCE_BASES.verhdlink}/movie/${tmdb.imdbId}`;
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const results = [];

  $('._player-mirrors.latino [data-link!=""]').each((_, el) => {
    const rawUrl = $(el).attr('data-link');
    if (!rawUrl || /verhdlink/.test(rawUrl)) {
      return;
    }

    results.push({
      source: 'VerHdLink',
      ...languageMeta('mx'),
      title: buildTitle(tmdb),
      url: rawUrl.replace(/^(https:)?\/\//, 'https://'),
      referer: SOURCE_BASES.verhdlink,
      headers: { Referer: SOURCE_BASES.verhdlink },
    });
  });

  return results;
}

async function searchTioPlus(tmdb, mediaType) {
  if (mediaType !== 'movie') {
    return [];
  }

  const candidates = [tmdb.originalTitle, tmdb.title].filter(Boolean);
  let pageUrl = null;

  for (const candidate of candidates) {
    const resultUrl = await findTioPlusMovie(candidate, tmdb.year);
    if (resultUrl) {
      pageUrl = resultUrl;
      break;
    }
  }

  if (!pageUrl) {
    return [];
  }

  const html = await fetchText(pageUrl, {
    headers: { Referer: SOURCE_BASES.tioplus },
  });
  const $ = cheerio.load(html);
  const results = [];

  $('.bg-tabs > div').each((_, section) => {
    const buttonText = $(section).find('button').first().text().toLowerCase();
    if (!buttonText.includes('latino')) {
      return;
    }

    $(section).find('li[data-server]').each((__, el) => {
      const token = $(el).attr('data-server');
      if (!token) {
        return;
      }

      results.push({
        source: 'TioPlus',
        ...languageMeta('mx'),
        title: buildTitle(tmdb),
        url: `${SOURCE_BASES.tioplus}/player/${Buffer.from(token).toString('base64')}`,
        referer: pageUrl,
        headers: { Referer: pageUrl },
        _tioplusToken: token,
      });
    });
  });

  if (results.length === 0) {
    return [];
  }

  const resolved = await Promise.allSettled(results.map(resolveTioPlusPlayer));

  return resolved.flatMap((result) => (
    result.status === 'fulfilled' && result.value ? [result.value] : []
  ));
}

async function findTioPlusMovie(title, year) {
  const searchUrl = `${SOURCE_BASES.tioplus}/api/search/${encodeURIComponent(title)}`;
  const html = await fetchText(searchUrl, {
    headers: {
      Referer: `${SOURCE_BASES.tioplus}/search`,
      Accept: 'text/html,*/*;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (/No hay resultados/i.test(html)) {
    return null;
  }

  const $ = cheerio.load(`<div>${html}</div>`);
  const targetNorm = normalizeTitle(title);
  let best = null;

  $('a.itemA[href]').each((_, el) => {
    const href = $(el).attr('href');
    const rawTitle = $(el).find('h2').text().trim();
    const kind = $(el).find('.typeItem').text().toLowerCase();
    if (!href || !rawTitle || kind.includes('serie')) {
      return;
    }

    let score = 0;
    const norm = normalizeTitle(rawTitle.replace(/\(\d{4}\)/, '').trim());
    if (norm === targetNorm) {
      score += 10;
    }
    if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
      score += 5;
    }

    const matchYear = rawTitle.match(/\((\d{4})\)/);
    if (year && matchYear && matchYear[1] === year) {
      score += 4;
    }

    if (!year && matchYear) {
      score += 1;
    }

    if (!best) {
      score += 1;
    }

    if (!best || score > best.score) {
      best = { href, score };
    }
  });

  return best && best.score >= 1 ? best.href : null;
}

async function resolveTioPlusPlayer(result) {
  const html = await fetchText(result.url, {
    headers: result.headers,
  });
  const match = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
  if (!match || !match[1]) {
    return null;
  }

  return {
    source: result.source,
    language: result.language,
    contentLanguage: result.contentLanguage,
    title: result.title,
    url: match[1],
    referer: result.referer,
    headers: { Referer: result.referer },
  };
}
