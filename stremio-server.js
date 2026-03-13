const fs = require('fs');
const path = require('path');
const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const express = require('express'); // used later when attaching proxy route

const TIMEOUT_MS = 15000;
const IS_PROD = process.env.NODE_ENV === 'production';
const PUBLIC_ADDON_BASE = (process.env.ADDON_PUBLIC_URL || '').replace(/\/$/, '');
const DEFAULT_LOGO_URL = 'https://raw.githubusercontent.com/Om0019/Northstar/refs/heads/main/Assets/image.png';
const ADDON_LOGO_URL = PUBLIC_ADDON_BASE ? `${PUBLIC_ADDON_BASE}/Assets/image.png` : DEFAULT_LOGO_URL;
const addonConfig = require('./addon.config.json');
const providers = [];
const pDir = path.join(__dirname, 'providers');
const activeProviders = new Set(addonConfig.activeProviders || []);

function withTimeout(promise, ms, fallback) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
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
    const [imdbId, season, episode] = id.split(":");
    let tmdbId = null;
    try {
        const { data } = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        tmdbId = data.meta.moviedb_id;
    } catch (e) {}
    
    if (!tmdbId) return { streams: [] };

    // Convert series to tv
    const mediaType = type === "series" ? "tv" : "movie";
    const results = await Promise.all(
        providers.map((provider) => withTimeout(
            Promise.resolve(provider.getStreams(tmdbId, mediaType, season, episode)).catch(() => []),
            TIMEOUT_MS,
            []
        ))
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
            const proxiedUrl = proxyWrap(s.url, finalHeaders);

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
    return { streams };
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

    app.get('/proxy', async (req, res) => {
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
                resp.data.on('end', () => {
                    // Get base URL for resolving relative paths
                    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                    
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
                    const rewritten = data.split('\n').map(line => {
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
    });
});
