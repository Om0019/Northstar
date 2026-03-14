const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { pathToFileURL } = require('url');
const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const express = require('express'); // used later when attaching proxy route

const DEFAULT_TIMEOUT_MS = 7000;
const PROVIDER_TIMEOUT_MS = {
    netmirror: 9000,
    'webstreamer-latino': 20000,
    vidlink: 5000,
    vixsrc: 5000,
    yflix: 5000,
    castle: 5000
};
const IS_PROD = process.env.NODE_ENV === 'production';
const PUBLIC_ADDON_BASE = (process.env.ADDON_PUBLIC_URL || '').replace(/\/$/, '');
const DEFAULT_LOGO_URL = 'https://raw.githubusercontent.com/Om0019/Northstar/refs/heads/main/Assets/image.png';
const ADDON_LOGO_URL = PUBLIC_ADDON_BASE ? `${PUBLIC_ADDON_BASE}/Assets/image.png` : DEFAULT_LOGO_URL;
const addonConfig = require('./addon.config.json');
const providers = [];
const pDir = path.join(__dirname, 'providers');
const activeProviders = new Set(addonConfig.activeProviders || []);
const cinemetaCache = new Map();
const streamCache = new Map();
const pendingStreamRequests = new Map();
const CINEMETA_TTL_MS = 30 * 60 * 1000;
const STREAM_CACHE_TTL_MS = 3 * 60 * 1000;

function withTimeout(promise, ms, fallback) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(typeof fallback === 'function' ? fallback() : fallback), ms)),
    ]);
}

function timeoutFallback(providerName, ms) {
    console.warn(`[stream handler] provider ${providerName} timed out after ${ms}ms`);
    return [];
}

function getCacheEntry(cache, key) {
    const entry = cache.get(key);
    if (!entry) {
        return null;
    }

    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }

    return entry.value;
}

function setCacheEntry(cache, key, value, ttlMs) {
    cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
    });
}

async function runProvider(provider, tmdbId, mediaType, season, episode) {
    const timeoutMs = PROVIDER_TIMEOUT_MS[provider.name] || DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();
    const result = await withTimeout(
        Promise.resolve(provider.getStreams(tmdbId, mediaType, season, episode)).catch((error) => {
            console.error(`[stream handler] provider ${provider.name} failed: ${error && error.message ? error.message : error}`);
            return [];
        }),
        timeoutMs,
        () => timeoutFallback(provider.name, timeoutMs)
    );
    const elapsedMs = Date.now() - startedAt;
    const count = Array.isArray(result) ? result.length : 0;
    console.log(`[stream handler] provider ${provider.name} completed in ${elapsedMs}ms with ${count} streams`);
    return Array.isArray(result) ? result : [];
}

if (fs.existsSync(pDir)) {
    fs.readdirSync(pDir).forEach(f => {
        const base = f.replace('.js', '');
        if (!IS_PROD) {
            console.log(`Found provider file: ${f}`);
        }

        if (activeProviders.has(base)) {
            try {
                const p = require(path.join(pDir, f));
                if (p.getStreams) {
                    providers.push({ name: base, getStreams: p.getStreams });
                    console.log(`Loaded provider: ${base}`);
                } else if (!IS_PROD) {
                    console.log(`Skipped ${base}: no getStreams`);
                }
            } catch (e) {
                console.error(`Failed loading ${base}:`, e.message);
            }
        } else if (!IS_PROD) {
            console.log(`Not allowed: ${base}`);
        }
    });
}

console.log("Loaded providers:", providers.map(p => p.name));

// helper for proxying requests through this addon
// we don't know the exact host+port the client will use until the addon
// actually starts, so `ADDON_BASE` is initialized once the server listens.
// until then the function will fall back to a relative path (still valid
// for local testing) or localhost if necessary.
let ADDON_BASE = ''; // populated later
let LAST_HOST = '';    // updated by middleware for each incoming request
const dnsReachabilityCache = new Map();
let latinoMediaflowModulePromise = null;

function requestBase(req) {
    if (PUBLIC_ADDON_BASE) {
        return PUBLIC_ADDON_BASE;
    }

    const host = req && req.headers && req.headers.host;
    if (host) {
        const proto = req.headers['x-forwarded-proto']
            || req.headers['x-forwarded-protocol']
            || req.protocol
            || (host.includes('onrender.com') || host.includes('koyeb.app') ? 'https' : 'http');
        return `${proto}://${host}`;
    }

    if (LAST_HOST && !LAST_HOST.startsWith('127.0.0.1')) {
        const proto = LAST_HOST.includes('onrender.com') || LAST_HOST.includes('koyeb.app') ? 'https' : 'http';
        return `${proto}://${LAST_HOST}`;
    }

    return ADDON_BASE;
}

function proxyWrap(url, headers) {
    const encodedUrl = encodeURIComponent(url);
    const encodedHeaders = encodeURIComponent(JSON.stringify(headers || {}));
    const proxyPath = `/proxy?url=${encodedUrl}&headers=${encodedHeaders}`;
    const base = requestBase();
    return base ? `${base}${proxyPath}` : proxyPath;
}

function mediaflowProxyWrap(req, url, headers) {
    const encodedUrl = encodeURIComponent(url);
    const encodedHeaders = encodeURIComponent(JSON.stringify(headers || {}));
    const base = requestBase(req);
    const proxyPath = `/proxy/hls/manifest.m3u8?url=${encodedUrl}&headers=${encodedHeaders}`;
    return base ? `${base}${proxyPath}` : proxyPath;
}

function ensureAddonAbsolute(url) {
    if (!url || !url.startsWith('/')) {
        return url;
    }

    const base = requestBase();
    return base ? `${base}${url}` : url;
}

function normalizeProxyTarget(rawUrl, headers = {}) {
    if (!rawUrl) {
        return rawUrl;
    }

    if (rawUrl.startsWith('//')) {
        return `https:${rawUrl}`;
    }

    if (rawUrl.startsWith('/')) {
        const base = headers.Referer || headers.Referer || headers.Origin || headers.origin;
        if (base) {
            try {
                return new URL(rawUrl, base).href;
            } catch (_error) {
                return rawUrl;
            }
        }
    }

    return rawUrl;
}

async function canResolveHost(hostname) {
    if (!hostname) {
        return false;
    }

    const now = Date.now();
    const cached = dnsReachabilityCache.get(hostname);
    if (cached && cached.expiresAt > now) {
        return cached.ok;
    }

    try {
        await dns.lookup(hostname);
        dnsReachabilityCache.set(hostname, { ok: true, expiresAt: now + 5 * 60 * 1000 });
        return true;
    } catch (_error) {
        dnsReachabilityCache.set(hostname, { ok: false, expiresAt: now + 60 * 1000 });
        return false;
    }
}

async function pruneDeadHlsVariants(playlistText, baseUrl) {
    const lines = playlistText.split('\n');
    const kept = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
            const nextLine = lines[i + 1] || '';
            const nextTrimmed = nextLine.trim();
            if (!nextTrimmed || nextTrimmed.startsWith('#')) {
                kept.push(line);
                continue;
            }

            let hostname = '';
            try {
                hostname = new URL(nextTrimmed, baseUrl).hostname;
            } catch (_error) {
                hostname = '';
            }

            if (!hostname || await canResolveHost(hostname)) {
                kept.push(line, nextLine);
            } else {
                console.log(`[proxy] dropping unreachable HLS variant host ${hostname}`);
            }

            i += 1;
            continue;
        }

        kept.push(line);
    }

    return kept.join('\n');
}

async function loadLatinoMediaflowResolver() {
    if (!latinoMediaflowModulePromise) {
        const modulePath = path.join(__dirname, 'src', 'webstreamer-latino', 'extractors.js');
        latinoMediaflowModulePromise = import(pathToFileURL(modulePath).href);
    }

    const module = await latinoMediaflowModulePromise;
    return module.resolveLatinoMediaflowTarget;
}

function extractMediaflowHeaders(query) {
    const headers = {};
    Object.entries(query || {}).forEach(([key, value]) => {
        if (!key.startsWith('h_') || value == null) {
            return;
        }

        const headerName = key.slice(2).replace(/_/g, '-');
        headers[headerName] = String(value);
    });
    return headers;
}

function streamPriority(stream) {
    switch (stream.provider) {
        case 'netmirror':
            return 300;
        case 'webstreamer-latino':
            return 200;
        case 'vidlink':
            return 120;
        case 'vixsrc':
            return 110;
        case 'yflix':
            return 100;
        case 'castle':
            return -100;
        default:
            return 0;
    }
}

const builder = new addonBuilder({
    id: "org.stremio.nuvio.om019",
    // bump version whenever manifest/providers change so clients reload
    version: "61.0.5",
    name: "Northstar",
    logo: ADDON_LOGO_URL,
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

builder.defineStreamHandler(async ({ type, id }) => {
    if (!IS_PROD) {
        console.log('[stream handler] LAST_HOST =', LAST_HOST, 'ADDON_BASE =', ADDON_BASE, 'PUBLIC_ADDON_BASE =', PUBLIC_ADDON_BASE);
    }
    const cacheKey = `${type}:${id}`;
    const cachedStreams = getCacheEntry(streamCache, cacheKey);
    if (cachedStreams) {
        if (!IS_PROD) {
            console.log(`[stream handler] cache hit for ${cacheKey}`);
        }
        return { streams: cachedStreams };
    }

    const pendingRequest = pendingStreamRequests.get(cacheKey);
    if (pendingRequest) {
        console.log(`[stream handler] joining in-flight request for ${cacheKey}`);
        return pendingRequest;
    }

    const pendingWork = (async () => {
        const [imdbId, season, episode] = id.split(":");
        const cinemetaKey = `${type}:${imdbId}`;
        let tmdbId = getCacheEntry(cinemetaCache, cinemetaKey);
        if (!tmdbId) {
            try {
                const { data } = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, {
                    timeout: 5000
                });
                tmdbId = data.meta.moviedb_id;
                if (tmdbId) {
                    setCacheEntry(cinemetaCache, cinemetaKey, tmdbId, CINEMETA_TTL_MS);
                }
            } catch (_e) {}
        }

        if (!tmdbId) return { streams: [] };

        // Convert series to tv
        const mediaType = type === "series" ? "tv" : "movie";
        const results = await Promise.all(
            providers.map((provider) => runProvider(provider, tmdbId, mediaType, season, episode))
        ).catch(() => []);

        const streams = (Array.isArray(results) ? results.flat() : [])
            .filter(s => s && s.url)
            .sort((a, b) => {
                const priorityDiff = streamPriority(b) - streamPriority(a);
                if (priorityDiff !== 0) {
                    return priorityDiff;
                }
                return (a.name || '').localeCompare(b.name || '');
            })
            .map(s => {
                const providerHeaders = s.headers || {};
                
                // Merge provider headers directly (keeps the correct Referer and Cookie from Netmirror)
                const finalHeaders = {
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                    ...providerHeaders
                };

                // route the stream through our local proxy so that headers/cookies are
                // consistently applied even for playlist/segment requests
                const proxiedUrl = s.url.startsWith('/extractor/video?') || s.url.includes('/extractor/video?')
                    ? ensureAddonAbsolute(s.url)
                    : proxyWrap(s.url, finalHeaders);

                return {
                    name: s.name || "Source",
                    title: s.title || "Stream",
                    url: proxiedUrl,
                    subtitles: s.subtitles || [],
                    behaviorHints: {
                        notWebReady: true
                    }
                };
            });

        console.log(`Sending ${streams.length} streams`);
        if (streams.length > 0) {
            setCacheEntry(streamCache, cacheKey, streams, STREAM_CACHE_TTL_MS);
        } else {
            console.log(`[stream handler] skipping empty cache write for ${cacheKey}`);
        }
        return { streams };
    })();

    pendingStreamRequests.set(cacheKey, pendingWork);

    try {
        return await pendingWork;
    } finally {
        pendingStreamRequests.delete(cacheKey);
    }
});

// we build our own express server instead of using serveHTTP so we can
// register middleware ahead of the stremio router.  This allows us to capture
// the `Host` header from the client before the stream handler runs (needed for
// proper absolute URLs when the addon is accessed remotely).
function startServer(addonInterface, opts = {}) {
    const cacheMaxAge = opts.cacheMaxAge || opts.cache;
    if (cacheMaxAge > 365 * 24 * 60 * 60)
        console.warn('cacheMaxAge set to more then 1 year, be advised that cache times are in seconds, not milliseconds.');

    const app = express();

    // record host header early for use in stream handler
    app.use((req, res, next) => {
        if (req.headers && req.headers.host) {
            LAST_HOST = req.headers.host;
        }
        next();
    });

    // cache-control (copied from serveHTTP)
    app.use((_, res, next) => {
        if (cacheMaxAge && !res.getHeader('Cache-Control'))
            res.setHeader('Cache-Control', 'max-age=' + cacheMaxAge + ', public');
        next();
    });

    app.get('/health', (_, res) => {
        res.json({
            ok: true,
            addon: builder.getInterface().manifest.name,
            providers: providers.map(p => p.name)
        });
    });

    app.use('/Assets', express.static(path.join(__dirname, 'Assets')));

    app.use(require('stremio-addon-sdk').getRouter(addonInterface));

    if (opts.static) {
        const location = path.join(process.cwd(), opts.static);
        if (!fs.existsSync(location)) throw new Error('directory to serve does not exist');
        app.use(opts.static, express.static(location));
    }

    const hasConfig = !!(addonInterface.manifest.config || []).length;
    const landingHTML = require('stremio-addon-sdk/src/landingTemplate')(addonInterface.manifest);
    app.get('/', (_, res) => {
        if (hasConfig) {
            res.redirect('/configure');
        } else {
            res.setHeader('content-type', 'text/html');
            res.end(landingHTML);
        }
    });
    if (hasConfig)
        app.get('/configure', (_, res) => {
            res.setHeader('content-type', 'text/html');
            res.end(landingHTML);
        });

    // bind to a host if provided; default to 0.0.0.0 for cloud environments
    const host = opts.host || '0.0.0.0';
    const server = app.listen(opts.port, host);
    return new Promise((resolve, reject) => {
        server.on('listening', () => {
            const url = `http://127.0.0.1:${server.address().port}/manifest.json`;
            console.log('HTTP addon accessible at:', url);
            resolve({ url, server });
        });
        server.on('error', reject);
    });
}

// allow the port to be specified by the environment (Render, Heroku, etc.)
const PORT = process.env.PORT || 7010;

startServer(builder.getInterface(), { port: PORT }).then(({ server, url }) => {
    ADDON_BASE = PUBLIC_ADDON_BASE || '';
    console.log('addon base url:', ADDON_BASE);

    const app = server._events.request;

    const proxyHandler = async (req, res) => {
        try {
            let targetUrl = req.query.url && decodeURIComponent(req.query.url);
            if (!targetUrl) return res.status(400).send('missing url');
            let headers = {};
            if (req.query.headers) {
                try {
                    headers = JSON.parse(decodeURIComponent(req.query.headers));
                } catch (e) {
                    console.error('proxy: failed to parse headers', e.message);
                }
            }

            targetUrl = normalizeProxyTarget(targetUrl, headers);

            const targetHost = (() => {
                try {
                    return new URL(targetUrl).host;
                } catch (_error) {
                    return 'invalid-url';
                }
            })();

            const upstreamHeaders = {
                ...headers,
                ...(req.headers.range ? { Range: req.headers.range } : {}),
                ...(req.headers.accept ? { Accept: req.headers.accept } : {}),
            };

            const resp = await axios.get(targetUrl, {
                headers: upstreamHeaders,
                responseType: 'stream',
                timeout: 10000,
                validateStatus: () => true
            });

            console.log(`[proxy] ${req.method} ${targetHost} -> ${resp.status} ${resp.headers['content-type'] || 'unknown'}`);

            // copy status and headers, but drop hop-by-hop / body-size headers
            // that become invalid once we rewrite playlist bodies.
            res.status(resp.status);
            Object.entries(resp.headers).forEach(([k, v]) => {
                const key = String(k).toLowerCase();
                if ([
                    'content-length',
                    'content-encoding',
                    'transfer-encoding',
                    'connection',
                    'keep-alive',
                ].includes(key)) {
                    return;
                }
                res.setHeader(k, v);
            });

            const contentType = (resp.headers['content-type'] || '').toLowerCase();
            const isPlaylist = contentType.includes('mpegurl') || targetUrl.endsWith('.m3u8');
            if (isPlaylist) {
                let data = '';
                resp.data.on('data', chunk => data += chunk.toString());
                resp.data.on('end', async () => {
                    // Get base URL for resolving relative paths
                    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                    const sanitizedData = data.includes('#EXT-X-STREAM-INF')
                        ? await pruneDeadHlsVariants(data, baseUrl)
                        : data;
                    
                    const toAbsoluteUrl = (value) => {
                        if (value.startsWith('http://') || value.startsWith('https://')) {
                            return value;
                        }
                        if (value.startsWith('/')) {
                            const baseUrlObj = new URL(baseUrl);
                            return baseUrlObj.protocol + '//' + baseUrlObj.host + value;
                        }
                        return new URL(value, baseUrl).href;
                    };

                    const toProxyUrl = (value) => {
                        const urlToProxy = toAbsoluteUrl(value);
                        if (urlToProxy.includes('/proxy?')) return value;

                        const eurl = encodeURIComponent(urlToProxy);
                        const eheaders = encodeURIComponent(JSON.stringify(headers));
                        const prefix = requestBase(req);
                        return prefix ? `${prefix}/proxy?url=${eurl}&headers=${eheaders}` : `/proxy?url=${eurl}&headers=${eheaders}`;
                    };

                    // rewrite playlist lines: segment URLs plus URI attributes inside HLS tags
                    const rewritten = sanitizedData.split('\n').map(line => {
                        const trimmed = line.trim();

                        if (!trimmed) return line;

                        if (trimmed.startsWith('#')) {
                            return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${toProxyUrl(uri)}"`);
                        }

                        return toProxyUrl(trimmed);
                    }).join('\n');

                    res.setHeader('content-type', resp.headers['content-type'] || 'application/vnd.apple.mpegurl');
                    res.removeHeader('content-length');
                    res.send(rewritten);
                });
            } else {
                resp.data.pipe(res);
            }
        } catch (err) {
            console.error(`[proxy] error ${err && err.message}`);
            res.status(500).send('proxy error');
        }
    };

    app.get('/proxy', proxyHandler);
    app.get('/proxy/hls/manifest.m3u8', proxyHandler);

    app.get('/extractor/video', async (req, res) => {
        try {
            const host = String(req.query.host || '').trim();
            const rawTarget = req.query.d && decodeURIComponent(req.query.d);
            if (!host || !rawTarget) {
                return res.status(400).json({ error: 'missing host or d' });
            }

            const headers = extractMediaflowHeaders(req.query);
            const resolveLatinoMediaflowTarget = await loadLatinoMediaflowResolver();
            const stream = await resolveLatinoMediaflowTarget(rawTarget, headers, {
                source: 'MediaFlow',
                language: 'Latino',
                title: host,
                referer: headers.referer || headers.Referer || rawTarget,
                player: host,
            });

            if (!stream || !stream.url) {
                return res.status(404).json({ error: 'extractor could not resolve stream' });
            }

            const proxyUrl = mediaflowProxyWrap(req, stream.url, stream.headers || headers);

            if (String(req.query.redirect_stream || '').toLowerCase() === 'true') {
                return res.redirect(proxyUrl);
            }

            return res.json({
                destination_url: stream.url,
                request_headers: stream.headers || headers,
                mediaflow_proxy_url: proxyUrl,
                query_params: {},
            });
        } catch (err) {
            console.error(`[extractor/video] error ${err && err.message}`);
            return res.status(500).json({ error: 'extractor error' });
        }
    });
});
