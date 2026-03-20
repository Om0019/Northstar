/**
 * webstreamer-latino - Built from src/webstreamer-latino/
 * Generated: 2026-03-20T03:14:13.014Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/webstreamer-latino/sources.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

// src/webstreamer-latino/constants.js
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"'
};
var SOURCE_BASES = {
  cuevana: "https://ww1.cuevana3.is",
  cinehdplus: "https://cinehdplus.gratis",
  homecine: "https://www3.homecine.to",
  verhdlink: "https://verhdlink.cam",
  tioplus: "https://tioplus.app"
};

// src/webstreamer-latino/http.js
var import_axios = __toESM(require("axios"));
var cookieJar = /* @__PURE__ */ new Map();
var REQUEST_TIMEOUT_MS = Math.max(1e3, parseInt(process.env.WEBSTREAMER_LATINO_HTTP_TIMEOUT_MS || "15000", 10) || 15e3);
function mergeHeaders(headers) {
  return __spreadValues(__spreadValues({}, DEFAULT_HEADERS), headers || {});
}
function getCookieHeader(url) {
  const hostname = new URL(url).hostname;
  return cookieJar.get(hostname) || "";
}
function storeCookies(url, response) {
  var _a;
  const hostname = new URL(url).hostname;
  const existing = cookieJar.get(hostname) || "";
  const cookieMap = /* @__PURE__ */ new Map();
  if (existing) {
    existing.split(/;\s*/).forEach((pair) => {
      const [name, ...rest] = pair.split("=");
      if (!name || !rest.length) {
        return;
      }
      cookieMap.set(name.trim(), rest.join("=").trim());
    });
  }
  const setCookie = (_a = response.headers) == null ? void 0 : _a["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  cookies.forEach((cookie) => {
    const pair = String(cookie).split(";")[0];
    const [name, ...rest] = pair.split("=");
    if (!name || !rest.length) {
      return;
    }
    cookieMap.set(name.trim(), rest.join("=").trim());
  });
  if (cookieMap.size > 0) {
    cookieJar.set(
      hostname,
      Array.from(cookieMap.entries()).map(([name, value]) => `${name}=${value}`).join("; ")
    );
  }
}
function issueRequest(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const cookieHeader = getCookieHeader(url);
    const navigationHeaders = {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1"
    };
    const response = yield (0, import_axios.default)({
      url,
      method: options.method || "GET",
      headers: mergeHeaders(__spreadValues(__spreadValues(__spreadValues({}, navigationHeaders), cookieHeader ? { Cookie: cookieHeader } : {}), options.headers || {})),
      data: options.body,
      responseType: "text",
      maxRedirects: 5,
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true
    });
    storeCookies(url, response);
    return response;
  });
}
function warmHost(url, headers) {
  return __async(this, null, function* () {
    const parsed = new URL(url);
    yield issueRequest(parsed.origin, {
      headers: __spreadValues({
        Referer: parsed.origin
      }, headers || {})
    }).catch(() => null);
  });
}
function fetchPage(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    var _a, _b, _c;
    let response = yield issueRequest(url, options);
    if (response.status === 403 && !options._warmed) {
      yield warmHost(url, options.headers);
      response = yield issueRequest(url, __spreadProps(__spreadValues({}, options), { _warmed: true }));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
    }
    const headers = {};
    for (const [key, value] of Object.entries(response.headers || {})) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    }
    return {
      text: typeof response.data === "string" ? response.data : String(response.data || ""),
      url: ((_b = (_a = response.request) == null ? void 0 : _a.res) == null ? void 0 : _b.responseUrl) || ((_c = response.config) == null ? void 0 : _c.url) || url,
      headers
    };
  });
}
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const page = yield fetchPage(url, options);
    return page.text;
  });
}
function fetchJson(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const response = yield (0, import_axios.default)({
      url,
      method: options.method || "GET",
      headers: mergeHeaders(__spreadValues({
        Accept: "application/json,text/plain,*/*"
      }, options.headers || {})),
      data: options.body,
      responseType: "json",
      maxRedirects: 5,
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
    }
    return response.data;
  });
}

// src/webstreamer-latino/tmdb.js
function normalizeMediaType(mediaType) {
  return mediaType === "tv" ? "tv" : "movie";
}
function getTmdbInfo(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const type = normalizeMediaType(mediaType);
    const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids&language=es-ES`;
    const data = yield fetchJson(url);
    const title = type === "tv" ? data.name : data.title;
    const originalTitle = type === "tv" ? data.original_name || data.name : data.original_title || data.title;
    const year = type === "tv" ? (data.first_air_date || "").slice(0, 4) : (data.release_date || "").slice(0, 4);
    return {
      tmdbId: String(tmdbId),
      mediaType: type,
      title,
      originalTitle,
      year,
      imdbId: data.external_ids ? data.external_ids.imdb_id : null
    };
  });
}
function buildEpisodeTag(season, episode) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// src/webstreamer-latino/utils.js
function normalizeTitle(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}
function parseQuality(value) {
  const match = String(value || "").match(/(2160|1080|720|480|360)p/i);
  return match ? `${match[1]}p` : "Auto";
}
function qualityRank(value) {
  const match = String(value || "").match(/(\d{3,4})p/i);
  return match ? parseInt(match[1], 10) : 0;
}
function uniqueBy(items, keyFn) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function unpackPacker(source) {
  let html = String(source || "");
  while (html.includes("eval(function(p,a,c,k,e,")) {
    const match = html.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/);
    if (!match) {
      break;
    }
    const payload = match[1].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const radix = parseInt(match[2], 10);
    const count = parseInt(match[3], 10);
    const symtab = match[4].split("|");
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
function extractPackedUrl(source, patterns = []) {
  const html = String(source || "");
  const unpacked = unpackPacker(html);
  const combined = `${html}
${unpacked}`;
  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match && match[1]) {
      return String(match[1]).replace(/\\\//g, "/");
    }
  }
  return null;
}
function createUnbase(radix) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return (value) => {
    const input = String(value || "");
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
function guessHeightFromPlaylist(_0) {
  return __async(this, arguments, function* (url, headers = {}) {
    try {
      const response = yield fetch(url, { headers });
      if (!response.ok) {
        return null;
      }
      const text = yield response.text();
      const resolutions = Array.from(text.matchAll(/RESOLUTION=\d+x(\d{3,4})/g)).map((match) => parseInt(match[1], 10)).filter(Boolean);
      if (resolutions.length) {
        return Math.max(...resolutions);
      }
      const labels = Array.from(text.matchAll(/(\d{3,4})p/gi)).map((match) => parseInt(match[1], 10)).filter(Boolean);
      return labels.length ? Math.max(...labels) : null;
    } catch (_error) {
      return null;
    }
  });
}

// src/webstreamer-latino/sources.js
function languageMeta(kind) {
  return kind === "mx" ? { language: "Latino", contentLanguage: "es-mx" } : { language: "Castellano", contentLanguage: "es-es" };
}
function buildTitle(tmdb, season, episode) {
  if (tmdb.mediaType === "tv" && season && episode) {
    return `${tmdb.title} ${buildEpisodeTag(season, episode)}`;
  }
  return tmdb.year ? `${tmdb.title} (${tmdb.year})` : tmdb.title;
}
function scoreSearchCandidate(targetTitle, rawTitle, expectedYear, matchedYear) {
  const targetNorm = normalizeTitle(targetTitle);
  const rawNorm = normalizeTitle(rawTitle);
  let score = 0;
  if (!targetNorm || !rawNorm) {
    return score;
  }
  if (rawNorm === targetNorm) {
    score += 10;
  } else if (rawNorm.includes(targetNorm) || targetNorm.includes(rawNorm)) {
    score += 5;
  }
  if (expectedYear && matchedYear) {
    if (matchedYear === expectedYear) {
      score += 4;
    } else {
      score -= 3;
    }
  } else if (!expectedYear && matchedYear) {
    score += 1;
  }
  return score;
}
function getLatinoSourceResults(tmdb, mediaType, season, episode) {
  return __async(this, null, function* () {
    const disabled = new Set(
      String(process.env.WEBSTREAMER_LATINO_DISABLED_SOURCES || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean)
    );
    const sourceTimeoutMs = Math.max(0, parseInt(process.env.WEBSTREAMER_LATINO_SOURCE_TIMEOUT_MS || "0", 10) || 0);
    const withTimeout = (label, promise) => {
      if (!sourceTimeoutMs) {
        return promise;
      }
      return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => {
          console.warn(`[WebstreamerLatino] Source timed out after ${sourceTimeoutMs}ms: ${label}`);
          resolve([]);
        }, sourceTimeoutMs))
      ]);
    };
    yield Promise.allSettled([
      prewarmSource(SOURCE_BASES.cuevana),
      prewarmSource(SOURCE_BASES.cinecalidad),
      prewarmSource(SOURCE_BASES.verhdlink),
      prewarmSource(SOURCE_BASES.tioplus),
      prewarmSource(SOURCE_BASES.verpeliculasultra)
    ]);
    const tasks = [
      !disabled.has("cuevana") && withTimeout("cuevana", searchCuevana(tmdb, season, episode)),
      !disabled.has("cinehdplus") && withTimeout("cinehdplus", searchCineHdPlus(tmdb, mediaType, season, episode)),
      !disabled.has("cinecalidad") && withTimeout("cinecalidad", searchCineCalidad(tmdb, mediaType, season, episode)),
      !disabled.has("homecine") && withTimeout("homecine", searchHomeCine(tmdb, season, episode)),
      !disabled.has("verhdlink") && withTimeout("verhdlink", searchVerHdLink(tmdb, mediaType)),
      !disabled.has("tioplus") && withTimeout("tioplus", searchTioPlus(tmdb, mediaType, season, episode)),
      !disabled.has("verpeliculasultra") && withTimeout("verpeliculasultra", searchVerPeliculasUltra(tmdb, mediaType))
    ].filter(Boolean);
    const settled = yield Promise.allSettled(tasks);
    return settled.flatMap((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      console.error("[WebstreamerLatino] Source error:", result.reason ? result.reason.message : result.reason);
      return [];
    });
  });
}
function prewarmSource(baseUrl) {
  return __async(this, null, function* () {
    yield fetchPage(baseUrl, {
      headers: {
        Referer: baseUrl,
        Origin: new URL(baseUrl).origin
      }
    }).catch(() => null);
  });
}
function searchCuevana(tmdb, season, episode) {
  return __async(this, null, function* () {
    const searchTerms = [...new Set([tmdb.originalTitle, tmdb.title].filter(Boolean))];
    let pagePath = null;
    for (const searchTerm of searchTerms) {
      const searchUrl = `${SOURCE_BASES.cuevana}/search/${encodeURIComponent(searchTerm)}/`;
      const html = yield fetchText(searchUrl, {
        headers: { Referer: SOURCE_BASES.cuevana }
      });
      const $ = import_cheerio_without_node_native.default.load(html);
      const targetNorm = normalizeTitle(searchTerm);
      let bestPath = null;
      let bestScore = -1;
      $(".TPost .Title").each((_, el) => {
        const title = $(el).text().trim();
        const href = $(el).closest("a").attr("href");
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
        const year = $(el).closest(".TPost").find(".Year").first().text().trim();
        if (tmdb.year && year === tmdb.year) {
          score += 3;
        }
        if (score > bestScore) {
          bestScore = score;
          bestPath = href;
        }
      });
      if (bestPath) {
        pagePath = bestPath;
        break;
      }
    }
    if (!pagePath) {
      return [];
    }
    let pageUrl = new URL(pagePath, SOURCE_BASES.cuevana);
    if (tmdb.mediaType === "tv" && season && episode) {
      const episodeHtml = yield fetchText(pageUrl.href, {
        headers: { Referer: pageUrl.origin }
      });
      const $$ = import_cheerio_without_node_native.default.load(episodeHtml);
      const episodePath = $$(".TPost .Year").filter((_, el) => $$(el).text().trim() === `${season}x${episode}`).closest("a").attr("href");
      if (!episodePath) {
        return [];
      }
      pageUrl = new URL(episodePath, pageUrl.origin);
    }
    const pageHtml = yield fetchText(pageUrl.href, {
      headers: { Referer: pageUrl.origin }
    });
    const $$$ = import_cheerio_without_node_native.default.load(pageHtml);
    const results = [];
    $$$(".open_submenu").each((_, el) => {
      const text = $$$(el).text();
      if (!/espa[nñ]ol/i.test(text) || !/latino/i.test(text)) {
        return;
      }
      $$$(el).find("[data-tr], [data-video]").each((__, node) => {
        const rawUrl = $$$(node).attr("data-tr") || $$$(node).attr("data-video");
        if (!rawUrl) {
          return;
        }
        results.push({
          source: "Cuevana",
          language: "Latino",
          title: buildTitle(tmdb, season, episode),
          url: rawUrl,
          referer: pageUrl.href,
          headers: { Referer: pageUrl.href }
        });
      });
    });
    return results;
  });
}
function searchCineHdPlus(tmdb, mediaType, season, episode) {
  return __async(this, null, function* () {
    if (mediaType !== "tv" || !season || !episode) {
      return [];
    }
    const searchUrl = `${SOURCE_BASES.cinehdplus}/series/?story=${tmdb.tmdbId}&do=search&subaction=search`;
    const html = yield fetchText(searchUrl);
    const $ = import_cheerio_without_node_native.default.load(html);
    const pageUrl = $(".card__title a[href]").first().attr("href");
    if (!pageUrl) {
      return [];
    }
    const pageHtml = yield fetchText(pageUrl);
    const $$ = import_cheerio_without_node_native.default.load(pageHtml);
    const isLatino = /latino/i.test($$(".details__langs").text());
    if (!isLatino) {
      return [];
    }
    const title = `${$$('meta[property="og:title"]').attr("content") || tmdb.title} ${buildEpisodeTag(season, episode)}`;
    const results = [];
    $$(`[data-num="${season}x${episode}"]`).siblings(".mirrors").children("[data-link]").each((_, el) => {
      const rawUrl = $$(el).attr("data-link");
      if (!rawUrl || /cinehdplus/.test(rawUrl)) {
        return;
      }
      results.push(__spreadProps(__spreadValues({
        source: "CineHDPlus"
      }, languageMeta("mx")), {
        title,
        url: rawUrl.replace(/^(https:)?\/\//, "https://"),
        referer: pageUrl,
        headers: { Referer: pageUrl }
      }));
    });
    return results;
  });
}
function searchCineCalidad(tmdb, mediaType, season, episode) {
  return __async(this, null, function* () {
    if (mediaType === "tv" && season && episode) {
      return searchCineCalidadSeries(tmdb, season, episode);
    }
    if (mediaType !== "movie") {
      return [];
    }
    const pageUrl = yield findCineCalidadPage(
      [tmdb.title, tmdb.originalTitle].filter(Boolean),
      findCineCalidadMovie,
      tmdb.year
    );
    if (!pageUrl) {
      return [];
    }
    return extractCineCalidadPlayers(tmdb, pageUrl);
  });
}
function searchCineCalidadSeries(tmdb, season, episode) {
  return __async(this, null, function* () {
    const seriesUrl = yield findCineCalidadPage(
      [tmdb.title, tmdb.originalTitle].filter(Boolean),
      findCineCalidadSeries,
      tmdb.year
    );
    if (!seriesUrl) {
      return [];
    }
    const episodeUrl = yield findCineCalidadEpisodeUrl(seriesUrl, season, episode);
    if (!episodeUrl) {
      return [];
    }
    return extractCineCalidadPlayers(tmdb, episodeUrl, season, episode);
  });
}
function findCineCalidadPage(candidates, finder, year) {
  return __async(this, null, function* () {
    for (const candidate of candidates) {
      const resultUrl = yield finder(candidate, year);
      if (resultUrl) {
        return resultUrl;
      }
    }
    return null;
  });
}
function extractCineCalidadPlayers(tmdb, pageUrl, season, episode) {
  return __async(this, null, function* () {
    const html = yield fetchText(pageUrl, {
      headers: { Referer: SOURCE_BASES.cinecalidad }
    });
    const $ = import_cheerio_without_node_native.default.load(html);
    const results = [];
    $("#playeroptionsul li[data-option]").each((_, el) => {
      const rawUrl = ($(el).attr("data-option") || "").trim();
      if (!rawUrl || /youtube\.com\/embed/i.test(rawUrl)) {
        return;
      }
      const normalizedUrl = normalizePlayerUrl(rawUrl, pageUrl);
      if (!normalizedUrl) {
        return;
      }
      results.push(__spreadProps(__spreadValues({
        source: "Cinecalidad"
      }, languageMeta("mx")), {
        title: buildTitle(tmdb, season, episode),
        url: normalizedUrl,
        referer: pageUrl,
        headers: { Referer: pageUrl }
      }));
    });
    return results;
  });
}
function searchHomeCine(tmdb, season, episode) {
  return __async(this, null, function* () {
    const candidateNames = [tmdb.title, tmdb.originalTitle].filter(Boolean);
    let pageUrl = null;
    for (const candidate of candidateNames) {
      pageUrl = yield findHomeCinePage(candidate, tmdb.mediaType === "tv");
      if (pageUrl) {
        break;
      }
    }
    if (!pageUrl) {
      return [];
    }
    let pageHtml = yield fetchText(pageUrl);
    if (tmdb.mediaType === "tv" && season && episode) {
      const episodeUrl = extractHomeCineEpisodeUrl(pageHtml, season, episode);
      if (!episodeUrl) {
        return [];
      }
      pageUrl = episodeUrl;
      pageHtml = yield fetchText(pageUrl);
    }
    const $ = import_cheerio_without_node_native.default.load(pageHtml);
    const results = [];
    $(".les-content a").each((_, el) => {
      const text = $(el).text().toLowerCase();
      if (!text.includes("latino")) {
        return;
      }
      const href = $(el).attr("href");
      if (!href) {
        return;
      }
      const iframeHtml = `<div>${href}</div>`;
      const iframeSrc = import_cheerio_without_node_native.default.load(iframeHtml)("iframe").attr("src");
      if (!iframeSrc) {
        return;
      }
      results.push(__spreadProps(__spreadValues({
        source: "HomeCine"
      }, languageMeta("mx")), {
        title: buildTitle(tmdb, season, episode),
        url: iframeSrc,
        referer: pageUrl,
        headers: { Referer: pageUrl }
      }));
    });
    return results;
  });
}
function findHomeCinePage(name, isSeries) {
  return __async(this, null, function* () {
    const searchUrl = `${SOURCE_BASES.homecine}/?s=${encodeURIComponent(name)}`;
    const html = yield fetchText(searchUrl);
    const $ = import_cheerio_without_node_native.default.load(html);
    const candidates = [];
    const targetNorm = normalizeTitle(name);
    $("a[oldtitle]").each((_, el) => {
      const oldTitle = ($(el).attr("oldtitle") || "").trim();
      const href = $(el).attr("href");
      if (!href) {
        return;
      }
      const seriesMatch = href.includes("/series/");
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
  });
}
function extractHomeCineEpisodeUrl(pageHtml, season, episode) {
  const $ = import_cheerio_without_node_native.default.load(pageHtml);
  const suffix = `-temporada-${season}-capitulo-${episode}`;
  const href = $("#seasons a").map((_, el) => $(el).attr("href")).get().find((value) => value && value.endsWith(suffix));
  return href || null;
}
function searchVerHdLink(tmdb, mediaType) {
  return __async(this, null, function* () {
    if (mediaType !== "movie" || !tmdb.imdbId) {
      return [];
    }
    const pageUrl = `${SOURCE_BASES.verhdlink}/movie/${tmdb.imdbId}`;
    const html = yield fetchText(pageUrl);
    const $ = import_cheerio_without_node_native.default.load(html);
    const results = [];
    $('._player-mirrors.latino [data-link!=""]').each((_, el) => {
      const rawUrl = $(el).attr("data-link");
      if (!rawUrl || /verhdlink/.test(rawUrl)) {
        return;
      }
      results.push(__spreadProps(__spreadValues({
        source: "VerHdLink"
      }, languageMeta("mx")), {
        title: buildTitle(tmdb),
        url: rawUrl.replace(/^(https:)?\/\//, "https://"),
        referer: SOURCE_BASES.verhdlink,
        headers: { Referer: SOURCE_BASES.verhdlink }
      }));
    });
    return results;
  });
}
function findCineCalidadMovie(title, year) {
  return __async(this, null, function* () {
    const searchUrl = `${SOURCE_BASES.cinecalidad}/?s=${encodeURIComponent(title)}`;
    const html = yield fetchText(searchUrl, {
      headers: { Referer: SOURCE_BASES.cinecalidad }
    });
    const $ = import_cheerio_without_node_native.default.load(html);
    const targetNorm = normalizeTitle(title);
    let best = null;
    $("#archive-content article.item.movies").each((_, el) => {
      const href = $(el).find('a[href*="/ver-pelicula/"]').first().attr("href");
      const rawTitle = $(el).find(".in_title").first().text().trim();
      if (!href || !rawTitle) {
        return;
      }
      let score = 0;
      const norm = normalizeTitle(rawTitle);
      if (norm === targetNorm) {
        score += 10;
      }
      if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
        score += 5;
      }
      const yearText = $(el).find(".home_post_content p").eq(1).text().trim();
      if (year && yearText === year) {
        score += 4;
      }
      if (!best || score > best.score) {
        best = { href, score };
      }
    });
    return best && best.score >= 5 ? best.href : null;
  });
}
function findCineCalidadSeries(title, year) {
  return __async(this, null, function* () {
    const searchUrl = `${SOURCE_BASES.cinecalidad}/?s=${encodeURIComponent(title)}`;
    const html = yield fetchText(searchUrl, {
      headers: { Referer: SOURCE_BASES.cinecalidad }
    });
    const $ = import_cheerio_without_node_native.default.load(html);
    const targetNorm = normalizeTitle(title);
    let best = null;
    $("#archive-content article.item, #archive-content article").each((_, el) => {
      const href = $(el).find('a[href*="/ver-serie/"]').first().attr("href");
      const rawTitle = $(el).find(".in_title, .title, h2, h3").first().text().trim();
      if (!href || !rawTitle) {
        return;
      }
      let score = 0;
      const norm = normalizeTitle(rawTitle);
      if (norm === targetNorm) {
        score += 10;
      }
      if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
        score += 5;
      }
      const yearText = $(el).find(".home_post_content p").eq(1).text().trim();
      if (year && yearText === year) {
        score += 4;
      }
      if (!best || score > best.score) {
        best = { href, score };
      }
    });
    return best && best.score >= 5 ? best.href : null;
  });
}
function findCineCalidadEpisodeUrl(seriesUrl, season, episode) {
  return __async(this, null, function* () {
    const html = yield fetchText(seriesUrl, {
      headers: { Referer: SOURCE_BASES.cinecalidad }
    });
    const $ = import_cheerio_without_node_native.default.load(html);
    const target = `${season}x${episode}`;
    const href = $('a[href*="/ver-el-episodio/"]').map((_, el) => $(el).attr("href")).get().find((value) => {
      if (!value) {
        return false;
      }
      try {
        const pathname = new URL(value, SOURCE_BASES.cinecalidad).pathname.toLowerCase();
        return pathname.endsWith(`-${target}/`) || pathname.endsWith(`-${target}`);
      } catch (_error) {
        return false;
      }
    });
    return href ? new URL(href, SOURCE_BASES.cinecalidad).href : null;
  });
}
function normalizePlayerUrl(rawUrl, baseUrl) {
  if (!rawUrl) {
    return null;
  }
  if (/^\/\//.test(rawUrl)) {
    return `https:${rawUrl}`;
  }
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  try {
    return new URL(rawUrl, baseUrl || SOURCE_BASES.cinecalidad).href;
  } catch (_error) {
    return null;
  }
}
function searchTioPlusSeries(tmdb, season, episode) {
  return __async(this, null, function* () {
    const candidates = [tmdb.originalTitle, tmdb.title].filter(Boolean);
    let seriesUrl = null;
    for (const candidate of candidates) {
      const resultUrl = yield findTioPlusSeries(candidate, tmdb.year);
      if (resultUrl) {
        seriesUrl = resultUrl;
        break;
      }
    }
    if (!seriesUrl) {
      return [];
    }
    const seriesHtml = yield fetchText(seriesUrl, {
      headers: { Referer: SOURCE_BASES.tioplus }
    });
    const $ = import_cheerio_without_node_native.default.load(seriesHtml);
    const episodeHref = $("#episodeList a.itemA[href]").map((_, el) => $(el).attr("href")).get().find((href) => {
      if (!href) {
        return false;
      }
      try {
        const pathname = new URL(href, SOURCE_BASES.tioplus).pathname.replace(/\/+$/, "");
        return pathname === `/serie/${pathname.split("/")[2]}/season/${season}/episode/${episode}`;
      } catch (_error) {
        return false;
      }
    });
    if (!episodeHref) {
      return [];
    }
    const episodeUrl = new URL(episodeHref, SOURCE_BASES.tioplus).href;
    const html = yield fetchText(episodeUrl, {
      headers: { Referer: seriesUrl }
    });
    const $$ = import_cheerio_without_node_native.default.load(html);
    const results = [];
    $$(".bg-tabs > div").each((_, section) => {
      const buttonText = $$(section).find("button").first().text().toLowerCase();
      if (!buttonText.includes("latino")) {
        return;
      }
      $$(section).find("li[data-server]").each((__, el) => {
        const token = $$(el).attr("data-server");
        if (!token) {
          return;
        }
        results.push(__spreadProps(__spreadValues({
          source: "TioPlus"
        }, languageMeta("mx")), {
          title: buildTitle(tmdb, season, episode),
          url: `${SOURCE_BASES.tioplus}/player/${Buffer.from(token).toString("base64")}`,
          referer: episodeUrl,
          headers: { Referer: episodeUrl },
          _tioplusToken: token
        }));
      });
    });
    if (results.length === 0) {
      return [];
    }
    const resolved = yield Promise.allSettled(results.map(resolveTioPlusPlayer));
    return resolved.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  });
}
function searchTioPlus(tmdb, mediaType, season, episode) {
  return __async(this, null, function* () {
    if (mediaType === "tv" && season && episode) {
      return searchTioPlusSeries(tmdb, season, episode);
    }
    return searchTioPlusMovieFlow(tmdb, mediaType);
  });
}
function searchTioPlusMovieFlow(tmdb, mediaType) {
  return __async(this, null, function* () {
    if (mediaType !== "movie") {
      return [];
    }
    const candidates = [tmdb.originalTitle, tmdb.title].filter(Boolean);
    let pageUrl = null;
    for (const candidate of candidates) {
      const resultUrl = yield findTioPlusMovie(candidate, tmdb.year);
      if (resultUrl) {
        pageUrl = resultUrl;
        break;
      }
    }
    if (!pageUrl) {
      return [];
    }
    const html = yield fetchText(pageUrl, {
      headers: { Referer: SOURCE_BASES.tioplus }
    });
    const $ = import_cheerio_without_node_native.default.load(html);
    const results = [];
    $(".bg-tabs > div").each((_, section) => {
      const buttonText = $(section).find("button").first().text().toLowerCase();
      if (!buttonText.includes("latino")) {
        return;
      }
      $(section).find("li[data-server]").each((__, el) => {
        const token = $(el).attr("data-server");
        if (!token) {
          return;
        }
        results.push(__spreadProps(__spreadValues({
          source: "TioPlus"
        }, languageMeta("mx")), {
          title: buildTitle(tmdb),
          url: `${SOURCE_BASES.tioplus}/player/${Buffer.from(token).toString("base64")}`,
          referer: pageUrl,
          headers: { Referer: pageUrl },
          _tioplusToken: token
        }));
      });
    });
    if (results.length === 0) {
      return [];
    }
    const resolved = yield Promise.allSettled(results.map(resolveTioPlusPlayer));
    return resolved.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  });
}
function searchVerPeliculasUltra(tmdb, mediaType) {
  return __async(this, null, function* () {
    if (mediaType !== "movie") {
      return [];
    }
    const candidates = [tmdb.title, tmdb.originalTitle].filter(Boolean);
    let pageUrl = null;
    for (const candidate of candidates) {
      const resultUrl = yield findVerPeliculasUltraMovie(candidate, tmdb.year);
      if (resultUrl) {
        pageUrl = resultUrl;
        break;
      }
    }
    if (!pageUrl) {
      return [];
    }
    const html = yield fetchText(pageUrl, {
      headers: { Referer: SOURCE_BASES.verpeliculasultra }
    });
    const $ = import_cheerio_without_node_native.default.load(html);
    const results = [];
    $("#ts21 .play-btn-cont[data-src], #ts2 .play-btn-cont[data-src]").each((_, el) => {
      const rawUrl = ($(el).attr("data-src") || "").trim();
      if (!rawUrl) {
        return;
      }
      results.push(__spreadProps(__spreadValues({
        source: "VerPeliculasUltra"
      }, languageMeta("mx")), {
        title: buildTitle(tmdb),
        url: rawUrl.replace(/^(https:)?\/\//, "https://"),
        referer: pageUrl,
        headers: { Referer: pageUrl }
      }));
    });
    return results;
  });
}
function findVerPeliculasUltraMovie(title, year) {
  return __async(this, null, function* () {
    const searchUrl = `${SOURCE_BASES.verpeliculasultra}/index.php?do=search&subaction=search&story=${encodeURIComponent(title)}`;
    const html = yield fetchText(searchUrl, {
      headers: {
        Referer: SOURCE_BASES.verpeliculasultra,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    const $ = import_cheerio_without_node_native.default.load(html);
    const targetNorm = normalizeTitle(title);
    let best = null;
    $('a[href$=".html"][title]').each((_, el) => {
      const href = $(el).attr("href");
      const rawTitle = ($(el).attr("title") || $(el).text() || "").trim();
      if (!href || !rawTitle) {
        return;
      }
      let score = 0;
      const norm = normalizeTitle(rawTitle);
      if (norm === targetNorm) {
        score += 10;
      }
      if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
        score += 5;
      }
      const article = $(el).closest("article, .shortstory, .base.shortstory, li, div");
      const yearText = article.text().match(/\b(19|20)\d{2}\b/);
      if (year && yearText && yearText[0] === year) {
        score += 4;
      }
      if (/serie|temporada|cap[ií]tulo/i.test(rawTitle)) {
        score -= 5;
      }
      if (!best || score > best.score) {
        best = { href, score };
      }
    });
    return best && best.score >= 5 ? new URL(best.href, SOURCE_BASES.verpeliculasultra).href : null;
  });
}
function findTioPlusMovie(title, year) {
  return __async(this, null, function* () {
    const searchUrl = `${SOURCE_BASES.tioplus}/api/search/${encodeURIComponent(title)}`;
    const html = yield fetchText(searchUrl, {
      headers: {
        Referer: `${SOURCE_BASES.tioplus}/search`,
        Accept: "text/html,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    if (/No hay resultados/i.test(html)) {
      return null;
    }
    const $ = import_cheerio_without_node_native.default.load(`<div>${html}</div>`);
    let best = null;
    $("a.itemA[href]").each((_, el) => {
      const href = $(el).attr("href");
      const rawTitle = $(el).find("h2").text().trim();
      const kind = $(el).find(".typeItem").text().toLowerCase();
      if (!href || !rawTitle || kind.includes("serie")) {
        return;
      }
      const matchYear = rawTitle.match(/\((\d{4})\)/);
      const score = scoreSearchCandidate(title, rawTitle.replace(/\(\d{4}\)/, "").trim(), year, matchYear ? matchYear[1] : null);
      if (!best || score > best.score) {
        best = { href, score };
      }
    });
    return best && best.score >= 5 ? best.href : null;
  });
}
function findTioPlusSeries(title, year) {
  return __async(this, null, function* () {
    const searchUrl = `${SOURCE_BASES.tioplus}/api/search/${encodeURIComponent(title)}`;
    const html = yield fetchText(searchUrl, {
      headers: {
        Referer: `${SOURCE_BASES.tioplus}/search`,
        Accept: "text/html,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    if (/No hay resultados/i.test(html)) {
      return null;
    }
    const $ = import_cheerio_without_node_native.default.load(`<div>${html}</div>`);
    let best = null;
    $("a.itemA[href]").each((_, el) => {
      const href = $(el).attr("href");
      const rawTitle = $(el).find("h2").text().trim();
      const kind = $(el).find(".typeItem").text().toLowerCase();
      if (!href || !rawTitle || !kind.includes("serie")) {
        return;
      }
      const matchYear = rawTitle.match(/\((\d{4})\)/);
      const score = scoreSearchCandidate(title, rawTitle.replace(/\(\d{4}\)/, "").trim(), year, matchYear ? matchYear[1] : null);
      if (!best || score > best.score) {
        best = { href, score };
      }
    });
    return best && best.score >= 5 ? best.href : null;
  });
}
function resolveTioPlusPlayer(result) {
  return __async(this, null, function* () {
    const html = yield fetchText(result.url, {
      headers: result.headers
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
      headers: { Referer: result.referer }
    };
  });
}

// src/webstreamer-latino/extractors.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));
var import_crypto_js = __toESM(require("crypto-js"));
var SHOULD_VALIDATE_MEDIA = process.env.NODE_ENV === "production";
function absoluteUrl(rawUrl, origin) {
  return new URL(rawUrl.replace(/^\/\//, "https://"), origin).href;
}
function buildPlaybackHeaders(pageUrl, extra = {}) {
  const finalPageUrl = String(pageUrl || "");
  let origin = "";
  try {
    origin = new URL(finalPageUrl).origin;
  } catch (_error) {
  }
  return __spreadValues(__spreadValues(__spreadValues({}, origin ? { Origin: origin } : {}), finalPageUrl ? { Referer: finalPageUrl } : {}), extra);
}
function buildStream(result, extracted) {
  const quality = extracted.quality || parseQuality(extracted.title || extracted.url);
  const player = extracted.player || result.player || inferPlayerFromUrl(extracted.url || result.url);
  return {
    name: `${result.source} ${result.language}${player ? ` (${player})` : ""}`,
    title: `${extracted.title || result.title || `${result.language} Stream`}${player ? ` [${player}]` : ""}`,
    url: extracted.url,
    quality,
    headers: extracted.headers || result.headers || {},
    provider: "webstreamer-latino",
    source: result.source,
    language: result.language,
    player,
    qualityRank: qualityRank(quality)
  };
}
function resolveLatinoStreams(results) {
  return __async(this, null, function* () {
    results.forEach((result) => {
      const player = inferPlayerFromUrl(result.url);
      console.log(`[WebstreamerLatino] Candidate: ${result.source} -> ${result.url} -> ${player || "unknown"}`);
    });
    const settled = yield Promise.allSettled(results.map((result) => resolveOne(result)));
    const streams = settled.flatMap((item) => {
      if (item.status === "fulfilled") {
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
    return unique.map((_a) => {
      var _b = _a, { qualityRank: _qualityRank } = _b, stream = __objRest(_b, ["qualityRank"]);
      return stream;
    });
  });
}
function resolveOne(result) {
  return __async(this, null, function* () {
    try {
      const url = new URL(result.url, result.referer || "https://example.com");
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
        return resolveFastream(result, url);
      }
      if (/waaw|vidora/i.test(host)) {
        return resolveVidora(result, url);
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
  });
}
function inferPlayerFromUrl(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("supervideo"))
    return "SuperVideo";
  if (value.includes("dropload") || value.includes("dr0pstream"))
    return "Dropload";
  if (value.includes("mixdrop") || value.includes("mixdrp") || value.includes("mixdroop") || value.includes("m1xdrop"))
    return "Mixdrop";
  if (value.includes("filelions") || value.includes("vidhide"))
    return "FileLions";
  if (value.includes("emturbovid") || value.includes("turbovidhls") || value.includes("turboviplay"))
    return "Emturbovid";
  if (value.includes("dood") || value.includes("ds2play") || value.includes("vidply") || value.includes("doply"))
    return "DoodStream";
  if (value.includes("streamtape") || value.includes("streamta.pe") || value.includes("strcloud"))
    return "Streamtape";
  if (value.includes("fastream"))
    return "Fastream";
  if (value.includes("waaw") || value.includes("vidora"))
    return "Vidora";
  if (value.includes("strp2p") || value.includes("4meplayer") || value.includes("upns.pro") || value.includes("p2pplay"))
    return "StrP2P";
  if (value.includes("gxplayer") || value.includes("bullstream") || value.includes("mp4player"))
    return "StreamEmbed";
  if (value.includes("vimeos"))
    return "Vimeos";
  if (value.includes("vidsrc") || value.includes("vsrc"))
    return "VidSrc";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}
function playerRank(player) {
  switch (player) {
    case "FileLions":
      return 90;
    case "Emturbovid":
      return 85;
    case "DoodStream":
      return 80;
    case "Dropload":
      return 70;
    case "Fastream":
      return 60;
    case "Mixdrop":
      return 55;
    case "Vidora":
      return 45;
    case "StrP2P":
      return 40;
    case "StreamEmbed":
      return 35;
    case "Vimeos":
      return 30;
    case "Streamtape":
      return 20;
    case "VidSrc":
      return 10;
    default:
      return 0;
  }
}
function extractCookieHeader(rawSetCookie) {
  if (!rawSetCookie) {
    return "";
  }
  const parts = String(rawSetCookie).split(/,(?=[^;,=\s]+=[^;,]+)/);
  const cookies = parts.map((part) => part.trim().split(";")[0].trim()).filter(Boolean);
  return uniqueBy(cookies, (cookie) => cookie.split("=")[0]).join("; ");
}
function mergeCookieHeaders(...values) {
  const cookies = values.flatMap((value) => extractCookieHeader(value).split(/;\s*/)).filter(Boolean);
  return uniqueBy(cookies, (cookie) => cookie.split("=")[0]).join("; ");
}
function validateDirectMedia(url, headers) {
  return __async(this, null, function* () {
    try {
      const response = yield fetch(url, {
        method: "GET",
        headers: __spreadProps(__spreadValues({}, headers || {}), {
          Range: "bytes=0-0",
          Accept: "*/*"
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(8e3)
      });
      return response.status === 200 || response.status === 206;
    } catch (_error) {
      return false;
    }
  });
}
function resolveMixdrop(result, url) {
  return __async(this, null, function* () {
    var _a, _b, _c, _d, _e;
    const normalized = new URL(url.href.replace("/f/", "/e/"));
    const fileUrl = new URL(normalized.href.replace("/e/", "/f/"));
    const baseHeaders = __spreadProps(__spreadValues({}, result.headers || {}), {
      Referer: result.referer || normalized.origin
    });
    const embedPage = yield fetchPage(normalized.href, {
      headers: __spreadProps(__spreadValues({}, baseHeaders), { Referer: fileUrl.href })
    }).catch(() => null);
    const filePage = embedPage ? null : yield fetchPage(fileUrl.href, { headers: baseHeaders }).catch(() => null);
    const html = (embedPage == null ? void 0 : embedPage.text) || (filePage == null ? void 0 : filePage.text) || null;
    let finalPageUrl = (embedPage == null ? void 0 : embedPage.url) || (filePage == null ? void 0 : filePage.url) || normalized.href;
    let cookieHeader = mergeCookieHeaders(
      (_a = result.headers) == null ? void 0 : _a.Cookie,
      (_b = result.headers) == null ? void 0 : _b.cookie,
      (_c = embedPage == null ? void 0 : embedPage.headers) == null ? void 0 : _c["set-cookie"],
      (_d = filePage == null ? void 0 : filePage.headers) == null ? void 0 : _d["set-cookie"]
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
      /(?:vsr|wurl)[^"'`]*["'`]((?:https?:)?\/\/[^"'`]+)["'`]/
    ]);
    if ((!directValue || /^\/e\//.test(directValue)) && (filePage == null ? void 0 : filePage.text)) {
      const iframePath = extractPackedUrl(filePage.text, [
        /<iframe[^>]+src="([^"]+)"/i,
        /<iframe[^>]+src='([^']+)'/i
      ]);
      if (iframePath) {
        const iframeUrl = absoluteUrl(iframePath, fileUrl.origin);
        const nestedPage = yield fetchPage(iframeUrl, {
          headers: __spreadProps(__spreadValues({}, baseHeaders), { Referer: fileUrl.href })
        }).catch(() => null);
        const nestedHtml = (nestedPage == null ? void 0 : nestedPage.text) || null;
        if (nestedHtml) {
          finalPageUrl = nestedPage.url || finalPageUrl;
          cookieHeader = mergeCookieHeaders(cookieHeader, (_e = nestedPage.headers) == null ? void 0 : _e["set-cookie"]);
          directValue = extractPackedUrl(nestedHtml, [
            /(?:MDCore|Core|MDp)\.wurl\s*=\s*"([^"]+)"/,
            /(?:MDCore|Core|MDp)\.wurl\s*=\s*'([^']+)'/,
            /wurl\s*=\s*"([^"]+)"/,
            /wurl\s*=\s*'([^']+)'/,
            /src:\s*"([^"]+)"/,
            /src:\s*'([^']+)'/,
            /(?:vsr|wurl)[^"'`]*["'`]((?:https?:)?\/\/[^"'`]+)["'`]/
          ]);
        }
      }
    }
    if (!directValue || /^\/e\//.test(directValue)) {
      console.log(`[WebstreamerLatino] Mixdrop parse miss: ${url.href}`);
      return [];
    }
    const directUrl = absoluteUrl(directValue, normalized.origin);
    const page = import_cheerio_without_node_native2.default.load((filePage == null ? void 0 : filePage.text) || html);
    const title = page(".title b").text().trim() || result.title;
    const finalEmbedUrl = new URL(finalPageUrl);
    const streamHeaders = buildPlaybackHeaders(finalEmbedUrl.href);
    if (cookieHeader) {
      streamHeaders.Cookie = cookieHeader;
    }
    const isPlayable = !SHOULD_VALIDATE_MEDIA || (yield validateDirectMedia(directUrl, streamHeaders));
    if (!isPlayable) {
      console.log(`[WebstreamerLatino] Mixdrop blocked: ${url.href}`);
      return [];
    }
    return [buildStream(result, {
      title,
      url: directUrl,
      quality: "Auto",
      headers: streamHeaders,
      player: "Mixdrop"
    })];
  });
}
function resolveFilelions(result, url) {
  return __async(this, null, function* () {
    const normalized = new URL(
      url.href.replace("/v/", "/f/").replace("/download/", "/f/").replace("/file/", "/f/")
    );
    const headers = __spreadProps(__spreadValues({}, result.headers || {}), {
      Referer: result.referer || "https://ww1.cuevana3.is/"
    });
    const page = yield fetchPage(normalized.href, { headers }).catch(() => null);
    if (!(page == null ? void 0 : page.text)) {
      console.log(`[WebstreamerLatino] FileLions miss: ${url.href}`);
      return [];
    }
    const unpacked = unpackPacker(page.text);
    const hls4Match = unpacked.match(/["']hls4["']\s*:\s*["']([^"']+)/i);
    const hls3Match = unpacked.match(/["']hls3["']\s*:\s*["']([^"']+)/i);
    const hls2Match = unpacked.match(/var\s+links\s*=\s*\{[^}]*["']hls2["']\s*:\s*["']([^"']+)/i) || unpacked.match(/["']hls2["']\s*:\s*["']([^"']+)/i);
    const fileMatch = unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i) || unpacked.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i);
    const playlistCandidate = (hls4Match == null ? void 0 : hls4Match[1]) || (hls3Match == null ? void 0 : hls3Match[1]) || (hls2Match == null ? void 0 : hls2Match[1]) || (fileMatch == null ? void 0 : fileMatch[1]);
    if (!playlistCandidate) {
      console.log(`[WebstreamerLatino] FileLions parse miss: ${url.href}`);
      return [];
    }
    const finalPageUrl = page.url || normalized.href;
    const playlistUrl = absoluteUrl(playlistCandidate.replace(/\\\//g, "/"), finalPageUrl);
    const title = import_cheerio_without_node_native2.default.load(unpacked)('meta[name="description"]').attr("content") || result.title;
    const streamHeaders = buildPlaybackHeaders(finalPageUrl);
    return [buildStream(result, {
      title,
      url: playlistUrl,
      quality: "Auto",
      headers: streamHeaders,
      player: "FileLions"
    })];
  });
}
function resolveEmturbovid(result, url) {
  return __async(this, null, function* () {
    const headers = __spreadProps(__spreadValues({}, result.headers || {}), {
      Referer: result.referer || "https://tioplus.app/"
    });
    const page = yield fetchPage(url.href, { headers }).catch(() => null);
    const html = page == null ? void 0 : page.text;
    if (!html) {
      console.log(`[WebstreamerLatino] Emturbovid miss: ${url.href}`);
      return [];
    }
    const playlistMatch = html.match(/data-hash="([^"]+\.m3u8[^"]*)"/i) || html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    if (!playlistMatch) {
      console.log(`[WebstreamerLatino] Emturbovid parse miss: ${url.href}`);
      return [];
    }
    const playlistUrl = playlistMatch[1].replace(/\\\//g, "/");
    const title = import_cheerio_without_node_native2.default.load(html)("title").text().trim() || result.title;
    const streamHeaders = buildPlaybackHeaders(page.url || url.href);
    return [buildStream(result, {
      title,
      url: playlistUrl,
      quality: "Auto",
      headers: streamHeaders,
      player: "Emturbovid"
    })];
  });
}
function resolveCuevanaPlayer(result, url) {
  return __async(this, null, function* () {
    const html = yield fetchText(url.href, {
      headers: __spreadProps(__spreadValues({}, result.headers || {}), {
        Referer: result.referer || "https://ww1.cuevana3.is/"
      })
    }).catch(() => null);
    if (!html) {
      console.log(`[WebstreamerLatino] Cuevana player miss: ${url.href}`);
      return [];
    }
    const targetMatch = html.match(/var\s+url\s*=\s*'([^']+)'/i) || html.match(/var\s+url\s*=\s*"([^"]+)"/i) || html.match(/<iframe[^>]+src="([^"]+)"/i) || html.match(/<iframe[^>]+src='([^']+)'/i);
    if (!targetMatch) {
      console.log(`[WebstreamerLatino] Cuevana player parse miss: ${url.href}`);
      return [];
    }
    return resolveOne(__spreadProps(__spreadValues({}, result), {
      url: absoluteUrl(targetMatch[1], url.origin),
      referer: url.href,
      headers: { Referer: url.href }
    }));
  });
}
function resolveStrp2p(result, url) {
  return __async(this, null, function* () {
    if (!url.hash || url.hash.length < 2) {
      console.log(`[WebstreamerLatino] StrP2P miss: ${url.href}`);
      return [];
    }
    const apiUrl = new URL(`/api/v1/video?id=${encodeURIComponent(url.hash.slice(1))}`, url.origin);
    const headers = {
      Origin: url.origin,
      Referer: `${url.origin}/`,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
    };
    const hexData = yield fetchText(apiUrl.href, { headers }).catch(() => null);
    if (!hexData) {
      console.log(`[WebstreamerLatino] StrP2P miss: ${url.href}`);
      return [];
    }
    try {
      const encrypted = import_crypto_js.default.enc.Hex.parse(hexData.trim().slice(0, -1));
      const key = import_crypto_js.default.enc.Hex.parse("6b69656d7469656e6d75613931316361");
      const iv = import_crypto_js.default.enc.Hex.parse("313233343536373839306f6975797472");
      const decrypted = import_crypto_js.default.AES.decrypt(
        { ciphertext: encrypted },
        key,
        { iv, mode: import_crypto_js.default.mode.CBC, padding: import_crypto_js.default.pad.Pkcs7 }
      ).toString(import_crypto_js.default.enc.Utf8);
      const { source, title } = JSON.parse(decrypted);
      if (!source) {
        console.log(`[WebstreamerLatino] StrP2P parse miss: ${url.href}`);
        return [];
      }
      const playlistUrl = new URL(source, url.origin);
      const height = yield guessHeightFromPlaylist(playlistUrl.href, headers).catch(() => null);
      return [
        buildStream(result, {
          url: playlistUrl.href,
          title,
          quality: height ? `${height}p` : "Auto",
          player: "StrP2P",
          headers
        })
      ];
    } catch (_error) {
      console.log(`[WebstreamerLatino] StrP2P parse miss: ${url.href}`);
      return [];
    }
  });
}
function resolveDoodStream(result, url) {
  return __async(this, null, function* () {
    const videoId = url.pathname.replace(/\/+$/, "").split("/").pop();
    if (!videoId) {
      return [];
    }
    const normalized = new URL(`https://dood.to/e/${videoId}`);
    const headers = __spreadProps(__spreadValues({}, result.headers || {}), {
      Referer: `${normalized.origin}/`,
      Origin: normalized.origin
    });
    const html = yield fetchText(normalized.href, { headers }).catch(() => null);
    if (!html || /Video not found/i.test(html)) {
      console.log(`[WebstreamerLatino] Dood miss: ${url.href}`);
      return [];
    }
    const titlePage = import_cheerio_without_node_native2.default.load(html);
    const title = titlePage("title").text().trim().replace(/ - DoodStream$/i, "").trim() || result.title;
    const passMatch = html.match(/\$\.get\(\s*['"]([^'"]*\/pass_md5\/[^'"]+)['"]\s*,/i) || html.match(/(\/pass_md5\/[^'"\\\s]+)/);
    if (!passMatch) {
      console.log(`[WebstreamerLatino] Dood pass_md5 miss: ${normalized.href}`);
      return [];
    }
    const passUrl = new URL(passMatch[1], normalized.origin).href;
    const passToken = passUrl.split("/").filter(Boolean).pop();
    const tokenMatch = html.match(/token=([^&'"]+)/);
    const token = (tokenMatch == null ? void 0 : tokenMatch[1]) || passToken;
    const passResponse = yield fetchText(passUrl, {
      headers: {
        Referer: normalized.href,
        "User-Agent": (result.headers || {})["User-Agent"]
      }
    }).catch(() => null);
    if (!passResponse) {
      console.log(`[WebstreamerLatino] Dood pass_md5 fetch miss: ${normalized.href}`);
      return [];
    }
    const directBase = passResponse.trim();
    const suffix = Math.random().toString(36).slice(2, 12);
    const directUrl = new URL(`${directBase}${suffix}`);
    if (token) {
      directUrl.searchParams.set("token", token);
    }
    directUrl.searchParams.set("expiry", String(Date.now()));
    const streamHeaders = { Referer: normalized.href };
    const isPlayable = !SHOULD_VALIDATE_MEDIA || (yield validateDirectMedia(directUrl.href, streamHeaders));
    if (!isPlayable) {
      console.log(`[WebstreamerLatino] Dood blocked: ${normalized.href}`);
      return [];
    }
    return [buildStream(result, {
      title,
      url: directUrl.href,
      quality: "Auto",
      headers: streamHeaders,
      player: "DoodStream"
    })];
  });
}
function resolveDropload(result, url) {
  return __async(this, null, function* () {
    const normalized = url.href.replace("/d/", "/").replace("/e/", "/").replace("/embed-", "/");
    const html = yield fetchText(normalized, { headers: result.headers }).catch(() => null);
    if (!html) {
      console.log(`[WebstreamerLatino] Dropload miss: ${url.href}`);
      return [];
    }
    if (/File Not Found|Pending in queue|no longer available|expired or has been deleted/i.test(html)) {
      console.log(`[WebstreamerLatino] Dropload miss: ${url.href}`);
      return [];
    }
    const unpacked = unpackPacker(html);
    const fileMatch = unpacked.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i) || html.match(/sources\s*:\s*\[\{\s*file\s*:\s*["']([^"']+)/i) || unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i) || html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
    if (!fileMatch) {
      console.log(`[WebstreamerLatino] Dropload parse miss: ${url.href}`);
      return [];
    }
    const hostMatch = html.match(/(https:\/\/.+?\/)player/);
    const page = import_cheerio_without_node_native2.default.load(html);
    const title = page(".videoplayer h1").text().trim() || result.title;
    const playlistHeaders = hostMatch ? { Referer: hostMatch[1] } : result.headers || {};
    const height = yield guessHeightFromPlaylist(fileMatch[1], playlistHeaders);
    return [buildStream(result, {
      title,
      url: fileMatch[1],
      quality: height ? `${height}p` : "Auto",
      headers: playlistHeaders,
      player: "Dropload"
    })];
  });
}
function resolveStreamtape(result, url) {
  return __async(this, null, function* () {
    const candidates = uniqueBy([
      url.href,
      url.href.replace("/e/", "/v/"),
      url.href.replace("/v/", "/e/")
    ], (value) => value);
    let html = null;
    let finalUrl = null;
    for (const candidate of candidates) {
      const page2 = yield fetchText(candidate, { headers: result.headers }).catch(() => null);
      if (!page2) {
        continue;
      }
      if (/Video not found|Maybe it got deleted by the creator/i.test(page2)) {
        continue;
      }
      html = page2;
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
    const page = import_cheerio_without_node_native2.default.load(html);
    const title = page('meta[name="og:title"]').attr("content") || result.title;
    return [buildStream(result, {
      title,
      url: `https:${directMatch[1]}`,
      quality: "720p",
      headers: finalUrl ? { Referer: finalUrl } : void 0,
      player: "Streamtape"
    })];
  });
}
function resolveFastream(result, url) {
  return __async(this, null, function* () {
    const candidates = [
      url.href,
      url.href.replace("/e/", "/embed-").replace("/d/", "/embed-"),
      url.href.replace("/embed-", "/d/")
    ];
    for (const candidate of candidates) {
      const html = yield fetchText(candidate, { headers: result.headers }).catch(() => null);
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
      const height = yield guessHeightFromPlaylist(fileMatch[1], headers);
      return [buildStream(result, {
        title: titleMatch ? titleMatch[1] : result.title,
        url: fileMatch[1],
        quality: height ? `${height}p` : "Auto",
        headers,
        player: "Fastream"
      })];
    }
    console.log(`[WebstreamerLatino] Fastream miss: ${url.href}`);
    return [];
  });
}
function resolveVidora(result, url) {
  return __async(this, null, function* () {
    const candidates = uniqueBy([
      url.href.replace("/embed/", "/").replace("/f/", "/e/"),
      url.href.replace("/embed/", "/"),
      url.href
    ], (value) => value);
    let html = null;
    let finalUrl = null;
    for (const candidate of candidates) {
      const page2 = yield fetchText(candidate, { headers: result.headers }).catch(() => null);
      if (!page2) {
        continue;
      }
      html = page2;
      finalUrl = candidate;
      break;
    }
    if (!html || !finalUrl) {
      console.log(`[WebstreamerLatino] Vidora miss: ${url.href}`);
      return [];
    }
    const unpacked = unpackPacker(html);
    const fileMatch = unpacked.match(/file:\s*"(.*?)"/) || unpacked.match(/file:\s*'(.*?)'/) || html.match(/src:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)/i);
    if (!fileMatch) {
      console.log(`[WebstreamerLatino] Vidora miss: ${url.href}`);
      return [];
    }
    const page = import_cheerio_without_node_native2.default.load(html);
    const title = page("title").text().trim().replace(/^Watch /, "") || result.title;
    const streamHeaders = buildPlaybackHeaders(finalUrl);
    const height = yield guessHeightFromPlaylist(fileMatch[1], streamHeaders);
    return [buildStream(result, {
      title,
      url: fileMatch[1],
      quality: height ? `${height}p` : "Auto",
      headers: streamHeaders,
      player: "Vidora"
    })];
  });
}
function resolveStreamEmbed(result, url) {
  return __async(this, null, function* () {
    const html = yield fetchText(url.href, { headers: result.headers });
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
    const qualityList = JSON.parse(video.quality || "[]");
    return [buildStream(result, {
      title: decodeURIComponent(video.title || result.title),
      url: playlistUrl,
      quality: qualityList[0] ? `${qualityList[0]}p` : "Auto",
      player: "StreamEmbed"
    })];
  });
}
function resolveVimeos(result, url) {
  return __async(this, null, function* () {
    const headers = __spreadProps(__spreadValues({}, result.headers || {}), {
      Referer: result.referer || url.href
    });
    const html = yield fetchText(url.href, { headers }).catch(() => null);
    if (!html) {
      console.log(`[WebstreamerLatino] Vimeos miss: ${url.href}`);
      return [];
    }
    const unpacked = unpackPacker(html) || "";
    const body = `${html}
${unpacked}`;
    const fileMatch = body.match(/sources:\s*\[\{file:"([^"]+\.m3u8[^"]*)"/i) || body.match(/sources:\s*\[\{file:'([^']+\.m3u8[^']*)'/i) || body.match(/https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*/i);
    if (!fileMatch) {
      console.log(`[WebstreamerLatino] Vimeos parse miss: ${url.href}`);
      return [];
    }
    const playlistUrl = (fileMatch[1] || fileMatch[0]).replace(/\\\//g, "/");
    const posterMatch = body.match(/image:"([^"]+)"/i);
    const height = yield guessHeightFromPlaylist(playlistUrl, { Referer: url.href }).catch(() => null);
    return [buildStream(result, {
      title: posterMatch ? result.title : result.title,
      url: playlistUrl,
      quality: height ? `${height}p` : "Auto",
      headers: { Referer: url.href },
      player: "Vimeos"
    })];
  });
}
function resolveVidSrc(result, url) {
  return __async(this, null, function* () {
    const html = yield fetchText(url.href, { headers: result.headers });
    const tokenMatch = html.match(/['"]token['"]: ?['"](.*?)['"]/);
    const expiresMatch = html.match(/['"]expires['"]: ?['"](.*?)['"]/);
    const urlMatch = html.match(/url: ?['"](.*?)['"]/);
    if (!tokenMatch || !expiresMatch || !urlMatch) {
      console.log(`[WebstreamerLatino] VidSrc parse miss: ${url.href}`);
      return [];
    }
    const baseUrl = new URL(urlMatch[1]);
    const playlistUrl = new URL(`${baseUrl.origin}${baseUrl.pathname}.m3u8?${baseUrl.searchParams}`);
    playlistUrl.searchParams.append("token", tokenMatch[1]);
    playlistUrl.searchParams.append("expires", expiresMatch[1]);
    playlistUrl.searchParams.append("h", "1");
    const height = yield guessHeightFromPlaylist(playlistUrl.href, { Referer: url.href });
    return [buildStream(result, {
      url: playlistUrl.href,
      quality: height ? `${height}p` : "Auto",
      headers: { Referer: url.href },
      player: "VidSrc"
    })];
  });
}

// src/webstreamer-latino/index.js
function getStreams(tmdbId, mediaType = "movie", season = null, episode = null) {
  return __async(this, null, function* () {
    const normalizedSeason = season == null ? null : parseInt(season, 10);
    const normalizedEpisode = episode == null ? null : parseInt(episode, 10);
    console.log(
      `[WebstreamerLatino] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}` + (normalizedSeason && normalizedEpisode ? `, S${normalizedSeason}E${normalizedEpisode}` : "")
    );
    try {
      const tmdb = yield getTmdbInfo(tmdbId, mediaType);
      console.log(`[WebstreamerLatino] TMDB Info: "${tmdb.title}" (${tmdb.year || "N/A"})`);
      const sourceResults = yield getLatinoSourceResults(tmdb, mediaType, normalizedSeason, normalizedEpisode);
      console.log(`[WebstreamerLatino] Candidate source URLs: ${sourceResults.length}`);
      const streams = yield resolveLatinoStreams(sourceResults);
      console.log(`[WebstreamerLatino] Final streams: ${streams.length}`);
      return streams;
    } catch (error) {
      console.error("[WebstreamerLatino] getStreams error:", error.message);
      return [];
    }
  });
}
module.exports = { getStreams };
