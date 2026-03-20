const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { pathToFileURL } = require('url');
const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const express = require('express'); // used later when attaching proxy route

const TIMEOUT_MS = 15000;
const CINEMETA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STREAM_RESULT_CACHE_TTL_MS = 30 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';
const PUBLIC_ADDON_BASE = (process.env.ADDON_PUBLIC_URL || '').replace(/\/$/, '');
const MONITOR_TOKEN = process.env.MONITOR_TOKEN || '';
const DEFAULT_LOGO_URL = 'https://raw.githubusercontent.com/Om0019/Northstar/refs/heads/main/Assets/image.png';
const ADDON_LOGO_URL = PUBLIC_ADDON_BASE ? `${PUBLIC_ADDON_BASE}/Assets/image.png` : DEFAULT_LOGO_URL;
const requestContextStore = new AsyncLocalStorage();
const LOG_LIMIT = 250;
const DEVICE_LIMIT = 200;
const ACTIVITY_LIMIT = 250;
const ERROR_LIMIT = 250;
const PLAYBACK_SESSION_LIMIT = 250;
const PLAYBACK_ACTIVE_WINDOW_MS = 10 * 60 * 1000;
const PLAYBACK_RECENT_WINDOW_MS = 60 * 60 * 1000;
const addonConfig = require('./addon.config.json');
const providers = [];
const pDir = path.join(__dirname, 'providers');
const activeProviders = new Set(addonConfig.activeProviders || []);
const KNOWN_PLAYERS = [
    'DoodStream',
    'FileLions',
    'Mixdrop',
    'Streamtape',
    'StrP2P',
    'StreamEmbed',
    'Dropload',
    'Emturbovid',
    'Vidora',
    'Vimeos',
    'VidSrc',
    'Fastream',
    'Unknown',
];
const monitorState = {
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    devices: new Map(),
    activity: [],
    logs: [],
    errors: [],
    playbackSessions: new Map(),
};
const controlState = {
    paused: false,
    stopped: false,
    configVersion: 0,
    providers: new Map(),
    players: new Map(KNOWN_PLAYERS.map((player) => [player, { enabled: true, lastSeenAt: null, seenCount: 0 }])),
};
const cinemetaMetaCache = new Map();
const cinemetaMetaInFlight = new Map();
const streamResultCache = new Map();
const streamResultInFlight = new Map();

function trimArray(array, limit) {
    while (array.length > limit) {
        array.shift();
    }
}

function maskToken(token) {
    if (!token) {
        return 'disabled';
    }

    if (token.length <= 6) {
        return `${token[0] || ''}***`;
    }

    return `${token.slice(0, 3)}***${token.slice(-3)}`;
}

function nowIso() {
    return new Date().toISOString();
}

function touchMonitorState() {
    monitorState.lastUpdatedAt = nowIso();
}

function formatConsoleArgs(args) {
    return args.map((value) => {
        if (typeof value === 'string') {
            return value;
        }

        if (value instanceof Error) {
            return value.stack || value.message;
        }

        try {
            return JSON.stringify(value);
        } catch (_error) {
            return String(value);
        }
    }).join(' ');
}

function getRequestIp(req) {
    if (!req) {
        return 'unknown';
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.headers['cf-connecting-ip']
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || 'unknown';
}

function inferDevice(userAgent) {
    const ua = String(userAgent || '');
    const lowered = ua.toLowerCase();
    const deviceType = lowered.includes('ipad') ? 'tablet'
        : lowered.includes('iphone') ? 'phone'
            : lowered.includes('android') && lowered.includes('mobile') ? 'phone'
                : lowered.includes('android') ? 'tablet'
                    : lowered.includes('tv') || lowered.includes('appletv') ? 'tv'
                        : lowered.includes('windows') || lowered.includes('macintosh') || lowered.includes('linux') ? 'desktop'
                            : 'unknown';
    const platform = lowered.includes('iphone') || lowered.includes('ipad') || lowered.includes('ios') ? 'iOS'
        : lowered.includes('android') ? 'Android'
            : lowered.includes('macintosh') || lowered.includes('mac os') ? 'macOS'
                : lowered.includes('windows') ? 'Windows'
                    : lowered.includes('linux') ? 'Linux'
                        : lowered.includes('appletv') ? 'tvOS'
                            : 'Unknown';
    const app = lowered.includes('stremio') ? 'Stremio'
        : lowered.includes('curl') ? 'curl'
            : lowered.includes('vlc') ? 'VLC'
            : lowered.includes('cfnetwork') ? 'Apple Client'
                : lowered.includes('safari') ? 'Safari'
                    : lowered.includes('okhttp') ? 'Android Client'
                        : 'Unknown';
    const deviceName = lowered.includes('iphone') ? 'iPhone'
        : lowered.includes('ipad') ? 'iPad'
            : lowered.includes('appletv') ? 'Apple TV'
                : lowered.includes('android') && lowered.includes('tv') ? 'Android TV'
                    : lowered.includes('android') ? 'Android Device'
                        : lowered.includes('windows') ? 'Windows PC'
                            : lowered.includes('macintosh') || lowered.includes('mac os') ? 'Mac'
                                : lowered.includes('linux') ? 'Linux Device'
                                    : lowered.includes('curl') ? 'Command Line Client'
                                        : lowered.includes('cfnetwork') ? 'Apple Network Client'
                                            : 'Unknown Device';

    return {
        raw: ua || 'unknown',
        app,
        deviceType,
        platform,
        deviceName,
    };
}

function currentRequestContext() {
    return requestContextStore.getStore() || null;
}

function recordLog(level, args) {
    const context = currentRequestContext();
    const entry = {
        id: crypto.randomUUID(),
        timestamp: nowIso(),
        level,
        message: formatConsoleArgs(args),
        path: context?.path || null,
        method: context?.method || null,
        deviceId: context?.deviceId || null,
        clientIp: context?.clientIp || null,
    };

    monitorState.logs.push(entry);
    trimArray(monitorState.logs, LOG_LIMIT);
    if (level === 'error') {
        monitorState.errors.push(entry);
        trimArray(monitorState.errors, ERROR_LIMIT);
    }
    touchMonitorState();
}

function patchConsole() {
    if (console.__northstarMonitorPatched) {
        return;
    }

    const original = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    };

    console.log = (...args) => {
        recordLog('info', args);
        original.log(...args);
    };

    console.warn = (...args) => {
        recordLog('warn', args);
        original.warn(...args);
    };

    console.error = (...args) => {
        recordLog('error', args);
        original.error(...args);
    };

    console.__northstarMonitorPatched = true;
}

function registerDevice(req) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = getRequestIp(req);
    const fingerprint = crypto
        .createHash('sha1')
        .update(`${userAgent}|${ip}`)
        .digest('hex')
        .slice(0, 16);
    const inferred = inferDevice(userAgent);
    const existing = monitorState.devices.get(fingerprint);
    const base = existing || {
        id: fingerprint,
        firstSeenAt: nowIso(),
        requestCount: 0,
    };

    const device = {
        ...base,
        lastSeenAt: nowIso(),
        requestCount: base.requestCount + 1,
        ip,
        app: inferred.app,
        deviceType: inferred.deviceType,
        platform: inferred.platform,
        deviceName: inferred.deviceName,
        clientName: `${inferred.app} on ${inferred.deviceName}`,
        userAgent: inferred.raw,
        host: req.headers.host || null,
        lastPath: req.path || req.originalUrl || null,
    };

    monitorState.devices.set(fingerprint, device);
    if (monitorState.devices.size > DEVICE_LIMIT) {
        const oldestKey = [...monitorState.devices.entries()]
            .sort((a, b) => new Date(a[1].lastSeenAt) - new Date(b[1].lastSeenAt))[0]?.[0];
        if (oldestKey) {
            monitorState.devices.delete(oldestKey);
        }
    }

    touchMonitorState();
    return device;
}

function recordActivity(event) {
    const context = currentRequestContext();
    const entry = {
        id: crypto.randomUUID(),
        timestamp: nowIso(),
        deviceId: context?.deviceId || null,
        clientIp: context?.clientIp || null,
        app: context?.app || null,
        platform: context?.platform || null,
        ...event,
    };

    monitorState.activity.push(entry);
    trimArray(monitorState.activity, ACTIVITY_LIMIT);
    touchMonitorState();
}

function buildSummary() {
    const devices = [...monitorState.devices.values()];
    const activeDevices = devices.filter((device) => {
        return Date.now() - new Date(device.lastSeenAt).getTime() < 1000 * 60 * 30;
    }).length;

    return {
        startedAt: monitorState.startedAt,
        lastUpdatedAt: monitorState.lastUpdatedAt,
        totalDevices: devices.length,
        activeDevices,
        recentActivityCount: getCurrentlyPlaying().length,
        recentErrorCount: monitorState.errors.length,
        recentLogCount: monitorState.logs.length,
        providers: providers.map((provider) => provider.name),
        paused: controlState.paused,
        stopped: controlState.stopped,
    };
}

function prunePlaybackSessions() {
    const sessions = [...monitorState.playbackSessions.values()]
        .sort((a, b) => new Date(b.lastActivityAt || b.startedAt) - new Date(a.lastActivityAt || a.startedAt));
    const keepIds = new Set(sessions.slice(0, PLAYBACK_SESSION_LIMIT).map((session) => session.id));
    for (const key of monitorState.playbackSessions.keys()) {
        if (!keepIds.has(key)) {
            monitorState.playbackSessions.delete(key);
        }
    }
}

function createPlaybackSession(data) {
    const session = {
        id: crypto.randomUUID(),
        startedAt: nowIso(),
        lastActivityAt: null,
        active: false,
        proxyHits: 0,
        ...data,
    };
    monitorState.playbackSessions.set(session.id, session);
    prunePlaybackSessions();
    touchMonitorState();
    return session;
}

function touchPlaybackSession(sessionId) {
    const session = monitorState.playbackSessions.get(sessionId);
    if (!session) {
        return null;
    }
    const updated = {
        ...session,
        active: true,
        proxyHits: session.proxyHits + 1,
        lastActivityAt: nowIso(),
    };
    monitorState.playbackSessions.set(sessionId, updated);
    touchMonitorState();
    return updated;
}

function getCurrentlyPlaying() {
    const cutoff = Date.now() - PLAYBACK_ACTIVE_WINDOW_MS;
    return [...monitorState.playbackSessions.values()]
        .filter((session) => session.proxyHits > 0 && session.lastActivityAt && new Date(session.lastActivityAt).getTime() >= cutoff)
        .map((session) => ({
            ...session,
            activeForSeconds: Math.max(
                0,
                Math.floor((new Date(session.lastActivityAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
            ),
        }))
        .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
}

function getRecentlyPlayed() {
    const cutoff = Date.now() - PLAYBACK_RECENT_WINDOW_MS;
    return [...monitorState.playbackSessions.values()]
        .filter((session) => session.proxyHits > 0 && session.lastActivityAt && new Date(session.lastActivityAt).getTime() >= cutoff)
        .map((session) => ({
            ...session,
            activeForSeconds: Math.max(
                0,
                Math.floor((new Date(session.lastActivityAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
            ),
        }))
        .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
}

function serverMode() {
    if (controlState.stopped) {
        return 'stopped';
    }
    if (controlState.paused) {
        return 'paused';
    }
    return 'running';
}

function serverIsBlockingStreams() {
    return controlState.paused || controlState.stopped;
}

function providerEnabled(name) {
    return controlState.providers.get(name)?.enabled !== false;
}

function bumpStreamConfigVersion() {
    controlState.configVersion += 1;
    streamResultCache.clear();
    streamResultInFlight.clear();
    touchMonitorState();
}

function setProviderEnabled(name, enabled) {
    const existing = controlState.providers.get(name);
    if (!existing) {
        return false;
    }
    controlState.providers.set(name, { ...existing, enabled: Boolean(enabled) });
    bumpStreamConfigVersion();
    return true;
}

function normalizePlayerName(value) {
    const player = String(value || '').trim();
    return player || 'Unknown';
}

function playerEnabled(name) {
    return controlState.players.get(normalizePlayerName(name))?.enabled !== false;
}

function setPlayerEnabled(name, enabled) {
    const playerName = normalizePlayerName(name);
    const existing = controlState.players.get(playerName) || { enabled: true, lastSeenAt: null, seenCount: 0 };
    controlState.players.set(playerName, { ...existing, enabled: Boolean(enabled) });
    bumpStreamConfigVersion();
}

function notePlayerSeen(name) {
    const playerName = normalizePlayerName(name);
    const existing = controlState.players.get(playerName) || { enabled: true, lastSeenAt: null, seenCount: 0 };
    controlState.players.set(playerName, {
        ...existing,
        lastSeenAt: nowIso(),
        seenCount: existing.seenCount + 1,
    });
    touchMonitorState();
}

function inferPlayerFromStream(stream) {
    const candidates = [
        stream.player,
        stream.behaviorHints?.player,
        stream.name,
        stream.title,
        stream.url,
    ].filter(Boolean).map((value) => String(value));

    for (const candidate of candidates) {
        if (/dood/i.test(candidate)) return 'DoodStream';
        if (/filelions|vidhide/i.test(candidate)) return 'FileLions';
        if (/mixdrop/i.test(candidate)) return 'Mixdrop';
        if (/streamtape|strcloud/i.test(candidate)) return 'Streamtape';
        if (/strp2p|p2pplay|4meplayer|upns\.pro/i.test(candidate)) return 'StrP2P';
        if (/streamembed|gxplayer|bullstream|mp4player/i.test(candidate)) return 'StreamEmbed';
        if (/dropload/i.test(candidate)) return 'Dropload';
        if (/emturbovid|turbovid/i.test(candidate)) return 'Emturbovid';
        if (/vidora|waaw/i.test(candidate)) return 'Vidora';
        if (/vimeos/i.test(candidate)) return 'Vimeos';
        if (/vidsrc/i.test(candidate)) return 'VidSrc';
        if (/fastream/i.test(candidate)) return 'Fastream';
    }

    return normalizePlayerName(stream.player);
}

function buildControlsPayload() {
    return {
        paused: controlState.paused,
        stopped: controlState.stopped,
        mode: serverMode(),
        providers: providers.map((provider) => {
            const state = controlState.providers.get(provider.name) || { enabled: true, available: true };
            return {
                name: provider.name,
                enabled: state.enabled,
                available: state.available !== false,
            };
        }),
        players: [...controlState.players.entries()]
            .map(([name, state]) => ({
                name,
                enabled: state.enabled !== false,
                seenCount: state.seenCount || 0,
                lastSeenAt: state.lastSeenAt || null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
    };
}

function monitorAuth(req, res, next) {
    if (!MONITOR_TOKEN) {
        return next();
    }

    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerToken = req.headers['x-monitor-token'];
    const token = bearerToken || headerToken;

    if (token !== MONITOR_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    return next();
}

patchConsole();

process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandledRejection', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[process] uncaughtException', error);
});

function withTimeout(promise, ms, fallback) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
}

function getCachedValue(cache, key) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }
    if (cached) {
        cache.delete(key);
    }
    return null;
}

function setCachedValue(cache, key, value, ttlMs) {
    cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

async function getOrComputeCached(cache, inFlight, key, ttlMs, compute) {
    const cached = getCachedValue(cache, key);
    if (cached !== null) {
        return cached;
    }

    if (inFlight.has(key)) {
        return inFlight.get(key);
    }

    const promise = Promise.resolve()
        .then(compute)
        .then((value) => {
            setCachedValue(cache, key, value, ttlMs);
            inFlight.delete(key);
            return value;
        })
        .catch((error) => {
            inFlight.delete(key);
            throw error;
        });

    inFlight.set(key, promise);
    return promise;
}

async function fetchCinemetaMeta(type, imdbId) {
    const cacheKey = `${type}:${imdbId}`;
    return getOrComputeCached(cinemetaMetaCache, cinemetaMetaInFlight, cacheKey, CINEMETA_CACHE_TTL_MS, async () => {
        const { data } = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, { timeout: 8000 });
        return {
            tmdbId: data?.meta?.moviedb_id || null,
            metaName: data?.meta?.name || null,
        };
    });
}

if (fs.existsSync(pDir)) {
    fs.readdirSync(pDir).forEach(f => {
        const base = f.replace('.js', '');
        const isActive = activeProviders.has(base);
        if (!IS_PROD) {
            console.log(`Found provider file: ${f}`);
        }

        if (!isActive) {
            controlState.providers.set(base, { enabled: false, available: true });
            if (!IS_PROD) {
                console.log(`Registered inactive provider without loading: ${base}`);
            }
            return;
        }

        try {
            const p = require(path.join(pDir, f));
            if (p.getStreams) {
                providers.push({ name: base, getStreams: p.getStreams });
                controlState.providers.set(base, { enabled: true, available: true });
                console.log(`Loaded provider: ${base}`);
            } else if (!IS_PROD) {
                console.log(`Skipped ${base}: no getStreams`);
            }
        } catch (e) {
            controlState.providers.set(base, { enabled: false, available: false });
            console.error(`Failed loading ${base}:`, e.message);
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
const LATINO_ON_DEMAND_PLAYERS = new Set([
    'filelions',
    'emturbovid',
    'goodstream',
    'fastream',
    'vimeos',
    'streamwish',
    'voe',
]);
const LATINO_RETRY_PLAYERS = new Set([
    'fastream',
    'vimeos',
    'streamwish',
    'voe',
]);
const SLOW_PLAYBACK_HOST_PATTERNS = /(filelions|vidhide|emturbovid|goodstream|vimeos|fastream|streamwish|voe|technicaldocumentation\.site|acek-cdn\.com|ovaltinecdn\.com|orbitcache\.com)/i;

function forwardedProto(req) {
    if (!req || !req.headers) {
        return '';
    }

    const direct = req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'];
    if (typeof direct === 'string' && direct.trim()) {
        return direct.split(',')[0].trim().toLowerCase();
    }

    const forwarded = req.headers.forwarded;
    if (typeof forwarded === 'string' && forwarded.trim()) {
        const match = forwarded.match(/proto=([^;,\s]+)/i);
        if (match && match[1]) {
            return match[1].trim().toLowerCase();
        }
    }

    return '';
}

function requestBase(req) {
    if (PUBLIC_ADDON_BASE) {
        return PUBLIC_ADDON_BASE;
    }

    const host = (req && req.headers && req.headers.host) || (req && req.host);
    if (host) {
        const proto = forwardedProto(req)
            || (req && req.protocol)
            || (req && req.proto)
            || (host.includes('onrender.com') || host.includes('koyeb.app') ? 'https' : 'http');
        return `${proto}://${host}`;
    }

    if (LAST_HOST && !LAST_HOST.startsWith('127.0.0.1')) {
        const proto = LAST_HOST.includes('onrender.com') || LAST_HOST.includes('koyeb.app') ? 'https' : 'http';
        return `${proto}://${LAST_HOST}`;
    }

    return ADDON_BASE;
}

function proxyWrap(req, url, headers, extraParams = {}) {
    const encodedUrl = encodeURIComponent(url);
    const encodedHeaders = encodeURIComponent(JSON.stringify(headers || {}));
    const extraQuery = Object.entries(extraParams)
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    const proxyPath = `/proxy?url=${encodedUrl}&headers=${encodedHeaders}${extraQuery ? `&${extraQuery}` : ''}`;
    const base = requestBase(req);
    return base ? `${base}${proxyPath}` : proxyPath;
}

function proxyWrapHls(req, url, headers, extraParams = {}) {
    const encodedUrl = encodeURIComponent(url);
    const encodedHeaders = encodeURIComponent(JSON.stringify(headers || {}));
    const extraQuery = Object.entries(extraParams)
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    const proxyPath = `/proxy/hls/manifest.m3u8?url=${encodedUrl}&headers=${encodedHeaders}${extraQuery ? `&${extraQuery}` : ''}`;
    const base = requestBase(req);
    return base ? `${base}${proxyPath}` : proxyPath;
}

function isLikelyHlsUrl(url, stream = null) {
    const raw = String(url || '');
    const lower = raw.toLowerCase();

    if (!raw) {
        return false;
    }

    const declaredType = String(stream && stream.type || '').toLowerCase();
    if (declaredType === 'hls') {
        return true;
    }

    if (lower.includes('.m3u8') || lower.includes('.m3u')) {
        return true;
    }

    if (/[?&](format|type)=hls(?:[&#]|$)/i.test(raw)) {
        return true;
    }

    try {
        const parsed = new URL(raw);
        const pathname = parsed.pathname.toLowerCase();
        const basename = pathname.split('/').pop() || '';

        if ((basename === 'master.txt' || basename === 'playlist.txt') && pathname.includes('/hls')) {
            return true;
        }

        if (basename === 'master.txt' && /(filelions|vidhide|emturbovid|strp2p|4meplayer|upns)/i.test(parsed.hostname)) {
            return true;
        }
    } catch (_error) {}

    return false;
}

function mediaflowProxyWrap(req, url, headers, extraParams = {}, stream = null) {
    const encodedUrl = encodeURIComponent(url);
    const encodedHeaders = encodeURIComponent(JSON.stringify(headers || {}));
    const extraQuery = Object.entries(extraParams)
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    const base = requestBase(req);
    const proxyPath = isLikelyHlsUrl(url, stream)
        ? `/proxy/hls/manifest.m3u8?url=${encodedUrl}&headers=${encodedHeaders}${extraQuery ? `&${extraQuery}` : ''}`
        : `/proxy?url=${encodedUrl}&headers=${encodedHeaders}${extraQuery ? `&${extraQuery}` : ''}`;
    return base ? `${base}${proxyPath}` : proxyPath;
}

function playbackProxyTimeoutMs(url, stream = null) {
    if (isLikelyHlsUrl(url, stream)) {
        return 30000;
    }

    if (SLOW_PLAYBACK_HOST_PATTERNS.test(String(url || ''))) {
        return 30000;
    }

    return 10000;
}

function extractorWrap(req, host, targetUrl, headers = {}, extraParams = {}) {
    const base = requestBase(req);
    const query = new URLSearchParams({
        host,
        d: targetUrl,
        ...Object.fromEntries(
            Object.entries(extraParams)
                .filter(([, value]) => value != null && value !== '')
                .map(([key, value]) => [key, String(value)])
        ),
    });

    Object.entries(headers || {}).forEach(([key, value]) => {
        if (value == null || value === '') {
            return;
        }
        query.set(`h_${String(key).replace(/-/g, '_')}`, String(value));
    });

    const normalizedHost = String(host || '').trim().toLowerCase();
    const playbackPath = LATINO_ON_DEMAND_PLAYERS.has(normalizedHost)
        ? '/extractor/video/manifest.m3u8'
        : '/extractor/video';
    const path = `${playbackPath}?${query.toString()}`;
    return base ? `${base}${path}` : path;
}

function shouldResolveLatinoOnDemand(stream) {
    if (!stream || String(stream.provider || '').toLowerCase() !== 'webstreamer-latino') {
        return false;
    }

    if (!stream.extractorTarget || !stream.player) {
        return false;
    }

    return LATINO_ON_DEMAND_PLAYERS.has(String(stream.player).toLowerCase());
}

function shouldRetryLatinoPlaybackHost(host) {
    return LATINO_RETRY_PLAYERS.has(String(host || '').toLowerCase());
}

function shouldBlockStream(stream) {
    if (!stream) {
        return false;
    }

    const provider = String(stream.provider || '').toLowerCase();
    const source = String(stream.source || '').toLowerCase();
    const player = String(stream.player || '').toLowerCase();

    if (provider === 'webstreamer-latino' && source === 'cuevana' && player === 'filelions') {
        return true;
    }

    return false;
}

async function probeResolvedLatinoStream(url, headers = {}) {
    try {
        const response = await axios({
            method: isLikelyHlsUrl(url) ? 'GET' : 'HEAD',
            url,
            headers,
            responseType: 'stream',
            timeout: 4000,
            maxRedirects: 5,
            validateStatus: () => true,
        });

        if (response.data && typeof response.data.destroy === 'function') {
            response.data.destroy();
        }

        return response.status;
    } catch (_error) {
        return 0;
    }
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

function shouldMarkMexicanFlag(stream) {
    if (!stream) {
        return false;
    }

    const provider = String(stream.provider || '').toLowerCase();
    if (provider === 'webstreamer-latino') {
        return true;
    }

    const audioLanguages = Array.isArray(stream.audioLanguages)
        ? stream.audioLanguages.map((value) => String(value || '').toLowerCase())
        : [];
    if (audioLanguages.some((value) => /\blatino\b|\bes[-_ ]?mx\b|mexic|spa[-_ ]?lat/i.test(value))) {
        return true;
    }
    if (audioLanguages.length > 0) {
        return false;
    }

    const language = String(stream.language || stream.contentLanguage || '').toLowerCase();
    if (language.includes('latino') || language.includes('es-mx') || language.includes('spa-lat')) {
        return true;
    }

    const combined = `${stream.name || ''} ${stream.title || ''}`.toLowerCase();
    return /\blatino\b/.test(combined) || /\bes[-_ ]?mx\b/.test(combined);
}

function decorateStreamTitle(stream) {
    const title = String(stream?.title || 'Stream');
    if (!shouldMarkMexicanFlag(stream)) {
        return title;
    }
    if (title.includes('🇲🇽')) {
        return title;
    }
    return `🇲🇽 ${title}`;
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
        // dns.lookup can block for a while on some networks/devices; cap it.
        await Promise.race([
            dns.lookup(hostname),
            new Promise((_, reject) => setTimeout(() => reject(new Error('dns_timeout')), 750)),
        ]);
        dnsReachabilityCache.set(hostname, { ok: true, expiresAt: now + 5 * 60 * 1000 });
        return true;
    } catch (_error) {
        dnsReachabilityCache.set(hostname, { ok: false, expiresAt: now + 60 * 1000 });
        return false;
    }
}

async function pruneDeadHlsVariants(playlistText, baseUrl) {
    const pruneOptOut = /(turboviplay|turbovidhls|emturbovid|goodstream|vimeos|fastream|filelions|vidhide)/i.test(String(baseUrl || ''));
    if (pruneOptOut) {
        return playlistText;
    }

    const lines = playlistText.split('\n');
    const variantChecks = [];

    for (let i = 0; i < lines.length; i += 1) {
        const trimmed = (lines[i] || '').trim();
        if (!trimmed.startsWith('#EXT-X-STREAM-INF')) {
            continue;
        }

        const nextLine = lines[i + 1] || '';
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
            continue;
        }

        let hostname = '';
        try {
            hostname = new URL(nextTrimmed, baseUrl).hostname;
        } catch (_error) {
            hostname = '';
        }

        variantChecks.push({ idx: i, hostname });
        i += 1;
    }

    // If the master playlist only exposes a single variant, keep it even when
    // DNS probing fails locally. Some hosts serve valid playlists on CDNs that
    // are not resolvable from the server environment, and pruning the sole
    // variant leaves clients with a malformed two-line manifest.
    if (variantChecks.length <= 1) {
        return playlistText;
    }

    const okByIdx = new Map();
    await Promise.all(variantChecks.map(async ({ idx, hostname }) => {
        if (!hostname) {
            okByIdx.set(idx, true);
            return;
        }
        const ok = await canResolveHost(hostname);
        okByIdx.set(idx, ok);
        if (!ok) {
            console.log(`[proxy] dropping unreachable HLS variant host ${hostname}`);
        }
    }));

    const kept = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = (line || '').trim();

        if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
            const nextLine = lines[i + 1] || '';
            const ok = okByIdx.get(i);
            if (ok === false) {
                i += 1; // drop variant URI line as well
                continue;
            }
            kept.push(line);
            if (nextLine !== undefined) {
                kept.push(nextLine);
            }
            i += 1;
            continue;
        }

        kept.push(line);
    }

    return kept.join('\n');
}

function shouldBypassLatinoNestedProxy(baseUrl) {
    return /(turboviplay|turbovidhls|emturbovid|fastream)/i.test(String(baseUrl || ''));
}

async function filterReachableHlsVariants(playlistText, baseUrl) {
    const lines = playlistText.split('\n');
    const variants = [];

    for (let i = 0; i < lines.length; i += 1) {
        const trimmed = (lines[i] || '').trim();
        if (!trimmed.startsWith('#EXT-X-STREAM-INF')) {
            continue;
        }

        const nextLine = lines[i + 1] || '';
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
            continue;
        }

        let hostname = '';
        try {
            hostname = new URL(nextTrimmed, baseUrl).hostname;
        } catch (_error) {
            hostname = '';
        }

        variants.push({ idx: i, hostname });
        i += 1;
    }

    if (variants.length <= 1) {
        return playlistText;
    }

    const okByIdx = new Map();
    await Promise.all(variants.map(async ({ idx, hostname }) => {
        if (!hostname) {
            okByIdx.set(idx, true);
            return;
        }
        okByIdx.set(idx, await canResolveHost(hostname));
    }));

    const hasReachableVariant = [...okByIdx.values()].some(Boolean);
    if (!hasReachableVariant) {
        return playlistText;
    }

    const kept = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = (line || '').trim();

        if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
            const nextLine = lines[i + 1] || '';
            if (okByIdx.get(i) === false) {
                i += 1;
                continue;
            }
            kept.push(line);
            kept.push(nextLine);
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
        case 'vidlink':
            return 220;
        case 'vixsrc':
            return 210;
        case 'yflix':
            return 200;
        case 'webstreamer-latino':
            return 120;
        case 'castle':
            return -100;
        default:
            return 0;
    }
}

function hasSpanishAudio(stream) {
    const audioLanguages = Array.isArray(stream?.audioLanguages) ? stream.audioLanguages : [];
    return audioLanguages.some((value) => /^spanish$/i.test(String(value || '').trim()));
}

function mexicanFlagOrderPriority(stream) {
    const provider = String(stream?.provider || '').toLowerCase();
    const player = String(stream?.player || inferPlayerFromStream(stream) || '').toLowerCase();
    const visibleText = `${stream?.name || ''} ${stream?.title || ''}`;

    if (provider === 'webstreamer-latino' || visibleText.includes('🇲🇽')) {
        if (player === 'vimeos') return 5000;
        if (provider === 'netmirror' && hasSpanishAudio(stream)) return 4900;
        if (player === 'filelions') return 4800;
        if (player === 'goodstream') return 4700;
        return 4600;
    }

    if (provider === 'netmirror' && hasSpanishAudio(stream)) {
        return 4900;
    }

    return 0;
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
    const requestContext = currentRequestContext();
    if (serverIsBlockingStreams()) {
        recordActivity({
            eventType: 'stream_lookup_blocked',
            type,
            reason: controlState.stopped ? 'server_stopped' : 'server_paused',
            requestPath: requestContext?.path || null,
        });
        return { streams: [] };
    }
    if (!IS_PROD) {
        console.log('[stream handler] LAST_HOST =', LAST_HOST, 'ADDON_BASE =', ADDON_BASE, 'PUBLIC_ADDON_BASE =', PUBLIC_ADDON_BASE);
    }
    const [imdbId, season, episode] = id.split(":");
    let tmdbId = null;
    let metaName = null;
    try {
        const meta = await fetchCinemetaMeta(type, imdbId);
        tmdbId = meta.tmdbId;
        metaName = meta.metaName;
    } catch (e) {}
    
    if (!tmdbId) {
        recordActivity({
            eventType: 'stream_lookup_failed',
            type,
            imdbId,
            season: season || null,
            episode: episode || null,
            title: metaName,
            reason: 'missing_tmdb_id',
            requestPath: requestContext?.path || null,
        });
        return { streams: [] };
    }

    // Convert series to tv
    const mediaType = type === "series" ? "tv" : "movie";
    const streamCacheKey = `${type}:${id}|tmdb:${tmdbId}|cfg:${controlState.configVersion}`;
    const enabledProviders = providers.filter((provider) => providerEnabled(provider.name));
    const cachedProviders = enabledProviders.filter((provider) => provider.name !== 'webstreamer-latino');
    const uncachedProviders = enabledProviders.filter((provider) => provider.name === 'webstreamer-latino');
    const loadProviderStreams = async (providerList) => {
        const results = await Promise.all(
            providerList.map((provider) => withTimeout(
                Promise.resolve(provider.getStreams(tmdbId, mediaType, season, episode))
                    .then((streams) => Array.isArray(streams)
                        ? streams.map((stream) => ({ ...stream, provider: stream.provider || provider.name }))
                        : []
                    )
                    .catch(() => []),
                TIMEOUT_MS,
                []
            ))
        ).catch(() => []);

        return (Array.isArray(results) ? results.flat() : []).filter((stream) => stream && stream.url);
    };

    const cachedRawStreams = cachedProviders.length === 0
        ? []
        : await getOrComputeCached(
            streamResultCache,
            streamResultInFlight,
            streamCacheKey,
            STREAM_RESULT_CACHE_TTL_MS,
            async () => loadProviderStreams(cachedProviders)
        ).catch(() => []);

    const uncachedRawStreams = uncachedProviders.length === 0
        ? []
        : await loadProviderStreams(uncachedProviders).catch(() => []);

    const rawStreams = cachedRawStreams.concat(uncachedRawStreams);

    const streams = rawStreams
        .filter(s => s && s.url)
        .map((stream) => {
            const player = inferPlayerFromStream(stream);
            notePlayerSeen(player);
            return {
                ...stream,
                player,
            };
        })
        .filter((stream) => playerEnabled(stream.player))
        .filter((stream) => !shouldBlockStream(stream))
        .sort((a, b) => {
            const mexicanFlagDiff = mexicanFlagOrderPriority(b) - mexicanFlagOrderPriority(a);
            if (mexicanFlagDiff !== 0) {
                return mexicanFlagDiff;
            }
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
            const playbackSession = createPlaybackSession({
                title: metaName || s.title || 'Unknown title',
                type,
                mediaType,
                imdbId,
                tmdbId,
                season: season || null,
                episode: episode || null,
                deviceId: requestContext?.deviceId || null,
                clientIp: requestContext?.clientIp || null,
                app: requestContext?.app || null,
                platform: requestContext?.platform || null,
                deviceName: monitorState.devices.get(requestContext?.deviceId || '')?.deviceName || null,
                clientName: monitorState.devices.get(requestContext?.deviceId || '')?.clientName || null,
                provider: s.provider || null,
                player: s.player || null,
            });

            const urlLower = String(s.url || '').toLowerCase();
            const providerLower = String(s.provider || '').toLowerCase();
            const nameLower = String(s.name || '').toLowerCase();
            const isHls = isLikelyHlsUrl(s.url, s)
                // vixsrc often returns playlist URLs without .m3u8 extension
                || providerLower === 'vixsrc'
                || nameLower.includes('vixsrc');
            const proxiedUrl = shouldResolveLatinoOnDemand(s)
                ? extractorWrap(
                    requestContext,
                    s.player,
                    s.extractorTarget,
                    s.extractorHeaders || providerHeaders,
                    { redirect_stream: 'true', sid: playbackSession.id }
                )
                : (isHls
                    ? proxyWrapHls(requestContext, s.url, finalHeaders, { sid: playbackSession.id })
                    : proxyWrap(requestContext, s.url, finalHeaders, { sid: playbackSession.id }));

            return {
                name: s.name || "Source",
                title: decorateStreamTitle(s),
                url: proxiedUrl,
                subtitles: s.subtitles || [],
                behaviorHints: {
                    notWebReady: true,
                    player: s.player || null,
                    provider: s.provider || null,
                },
            };
        });

    console.log(`Sending ${streams.length} streams`);
    recordActivity({
        eventType: 'stream_lookup',
        type,
        mediaType,
        imdbId,
        tmdbId,
        season: season || null,
        episode: episode || null,
        title: metaName,
        streamCount: streams.length,
        requestPath: requestContext?.path || null,
    });
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
    app.set('trust proxy', true);
    app.use(express.json());

    // record host header early for use in stream handler
    app.use((req, res, next) => {
        const device = registerDevice(req);
        const context = {
            requestId: crypto.randomUUID(),
            method: req.method,
            path: req.path,
            originalUrl: req.originalUrl,
            host: req.headers.host || null,
            proto: forwardedProto(req) || req.protocol || null,
            clientIp: device.ip,
            deviceId: device.id,
            app: device.app,
            platform: device.platform,
        };

        requestContextStore.run(context, () => {
            if (req.headers && req.headers.host) {
                LAST_HOST = req.headers.host;
            }
            next();
        });
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
            paused: controlState.paused,
            stopped: controlState.stopped,
            providers: providers.filter((provider) => providerEnabled(provider.name)).map(p => p.name)
        });
    });

    app.get('/monitor/summary', monitorAuth, (_, res) => {
        res.json(buildSummary());
    });

    app.get('/monitor/devices', monitorAuth, (req, res) => {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, DEVICE_LIMIT));
        const devices = [...monitorState.devices.values()]
            .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
            .slice(0, limit);
        res.json({ devices });
    });

    app.get('/monitor/activity', monitorAuth, (req, res) => {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, ACTIVITY_LIMIT));
        res.json({ activity: monitorState.activity.slice(-limit).reverse() });
    });

    app.get('/monitor/currently-playing', monitorAuth, (req, res) => {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, PLAYBACK_SESSION_LIMIT));
        res.json({ sessions: getCurrentlyPlaying().slice(0, limit) });
    });

    app.get('/monitor/recently-played', monitorAuth, (req, res) => {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, PLAYBACK_SESSION_LIMIT));
        res.json({ sessions: getRecentlyPlayed().slice(0, limit) });
    });

    app.get('/monitor/logs', monitorAuth, (req, res) => {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, LOG_LIMIT));
        res.json({ logs: monitorState.logs.slice(-limit).reverse() });
    });

    app.get('/monitor/errors', monitorAuth, (req, res) => {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, ERROR_LIMIT));
        res.json({ errors: monitorState.errors.slice(-limit).reverse() });
    });

    app.get('/monitor/controls', monitorAuth, (_, res) => {
        res.json(buildControlsPayload());
    });

    app.post('/monitor/controls/pause', monitorAuth, (req, res) => {
        controlState.paused = Boolean(req.body?.paused);
        if (!controlState.paused) {
            controlState.stopped = false;
        }
        touchMonitorState();
        recordActivity({
            eventType: controlState.paused ? 'server_paused' : 'server_resumed',
            source: 'monitor_controls',
        });
        res.json(buildControlsPayload());
    });

    app.post('/monitor/controls/state', monitorAuth, (req, res) => {
        const action = String(req.body?.action || '').trim().toLowerCase();
        if (action === 'play') {
            controlState.paused = false;
            controlState.stopped = false;
            recordActivity({ eventType: 'server_resumed', source: 'monitor_controls' });
        } else if (action === 'pause') {
            controlState.paused = true;
            controlState.stopped = false;
            recordActivity({ eventType: 'server_paused', source: 'monitor_controls' });
        } else if (action === 'stop') {
            controlState.paused = false;
            controlState.stopped = true;
            recordActivity({ eventType: 'server_stopped', source: 'monitor_controls' });
        } else {
            return res.status(400).json({ error: 'invalid_action' });
        }
        touchMonitorState();
        return res.json(buildControlsPayload());
    });

    app.post('/monitor/controls/providers/:name', monitorAuth, (req, res) => {
        const name = String(req.params.name || '').trim();
        if (!setProviderEnabled(name, req.body?.enabled)) {
            return res.status(404).json({ error: 'provider_not_found' });
        }
        recordActivity({
            eventType: 'provider_toggled',
            source: 'monitor_controls',
            provider: name,
            enabled: providerEnabled(name),
        });
        return res.json(buildControlsPayload());
    });

    app.post('/monitor/controls/players/:name', monitorAuth, (req, res) => {
        const playerName = decodeURIComponent(String(req.params.name || '').trim());
        setPlayerEnabled(playerName, req.body?.enabled);
        recordActivity({
            eventType: 'player_toggled',
            source: 'monitor_controls',
            player: normalizePlayerName(playerName),
            enabled: playerEnabled(playerName),
        });
        return res.json(buildControlsPayload());
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
    console.log(`[monitor] token ${maskToken(MONITOR_TOKEN)}`);

    const app = server._events.request;

    function parseSetCookieToCookieHeader(setCookie) {
        const cookies = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
        const pairs = cookies
            .map((value) => String(value).split(';')[0].trim())
            .filter(Boolean);
        return pairs.join('; ');
    }

    function mergeCookieStrings(a, b) {
        const result = new Map();
        const ingest = (value) => {
            String(value || '')
                .split(';')
                .map((part) => part.trim())
                .filter(Boolean)
                .forEach((pair) => {
                    const idx = pair.indexOf('=');
                    if (idx <= 0) return;
                    const name = pair.slice(0, idx).trim();
                    const val = pair.slice(idx + 1).trim();
                    if (!name) return;
                    result.set(name, val);
                });
        };
        ingest(a);
        ingest(b);
        return [...result.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const proxyHandler = async (req, res) => {
        if (serverIsBlockingStreams()) {
            return res.status(503).send('server paused');
        }
        const sessionId = req.query.sid ? String(req.query.sid) : '';
        const upstreamMethod = String(req.method || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
        if (sessionId) {
            touchPlaybackSession(sessionId);
        }
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

            const session = sessionId ? monitorState.playbackSessions.get(sessionId) : null;
            const sessionCookie = session && session.cookie ? session.cookie : '';
            const upstreamCookie = mergeCookieStrings(headers.Cookie || headers.cookie || '', sessionCookie);
            const upstreamHeaders = {
                ...headers,
                ...(upstreamCookie ? { Cookie: upstreamCookie } : {}),
                ...(req.headers.range ? { Range: req.headers.range } : {}),
                ...(req.headers.accept ? { Accept: req.headers.accept } : {}),
            };
            const upstreamTimeout = playbackProxyTimeoutMs(targetUrl);

            const resp = await axios({
                method: upstreamMethod,
                url: targetUrl,
                headers: upstreamHeaders,
                responseType: 'stream',
                timeout: upstreamTimeout,
                validateStatus: () => true
            });

            console.log(`[proxy] ${req.method} ${targetHost} -> ${resp.status} ${resp.headers['content-type'] || 'unknown'}`);

            // capture upstream cookies for subsequent HLS segment requests
            if (sessionId) {
                const setCookie = resp.headers['set-cookie'];
                const newCookie = parseSetCookieToCookieHeader(setCookie);
                if (newCookie) {
                    const existing = monitorState.playbackSessions.get(sessionId);
                    if (existing) {
                        monitorState.playbackSessions.set(sessionId, {
                            ...existing,
                            cookie: mergeCookieStrings(existing.cookie || '', newCookie),
                        });
                        touchMonitorState();
                    }
                }
            }

            // copy upstream headers. We only strip hop-by-hop headers here.
            // body-size headers are preserved for direct file streams because
            // ExoPlayer uses them for range/seeking behavior.
            res.status(resp.status);
            Object.entries(resp.headers).forEach(([k, v]) => {
                const key = String(k).toLowerCase();
                if ([
                    'transfer-encoding',
                    'connection',
                    'keep-alive',
                ].includes(key)) {
                    return;
                }
                res.setHeader(k, v);
            });

            const contentType = (resp.headers['content-type'] || '').toLowerCase();
            const isPlaylist = contentType.includes('mpegurl') || isLikelyHlsUrl(targetUrl);
            if (upstreamMethod === 'HEAD') {
                return res.end();
            }
            if (isPlaylist) {
                let data = '';
                resp.data.on('data', chunk => data += chunk.toString());
                resp.data.on('end', async () => {
                    // Get base URL for resolving relative paths
                    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                    const isMasterPlaylist = data.includes('#EXT-X-STREAM-INF');
                    let sanitizedData = isMasterPlaylist
                        ? await pruneDeadHlsVariants(data, baseUrl)
                        : data;
                    const bypassNestedProxy = shouldBypassLatinoNestedProxy(baseUrl);
                    if (isMasterPlaylist && bypassNestedProxy) {
                        sanitizedData = await filterReachableHlsVariants(sanitizedData, baseUrl);
                    }
                    
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
                        if (bypassNestedProxy) {
                            return urlToProxy;
                        }
                        if (urlToProxy.includes('/proxy?')) return value;

                        const eurl = encodeURIComponent(urlToProxy);
                        const eheaders = encodeURIComponent(JSON.stringify(headers));
                        const sidPart = sessionId ? `&sid=${encodeURIComponent(sessionId)}` : '';
                        const prefix = requestBase(req);
                        const proxyPath = isLikelyHlsUrl(urlToProxy)
                            ? `/proxy/hls/manifest.m3u8?url=${eurl}&headers=${eheaders}${sidPart}`
                            : `/proxy?url=${eurl}&headers=${eheaders}${sidPart}`;
                        return prefix ? `${prefix}${proxyPath}` : proxyPath;
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

                    res.setHeader('content-type', 'application/vnd.apple.mpegurl');
                    res.removeHeader('content-length');
                    res.removeHeader('content-encoding');
                    res.removeHeader('transfer-encoding');
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
    app.head('/proxy', proxyHandler);
    app.get('/proxy/hls/manifest.m3u8', proxyHandler);
    app.head('/proxy/hls/manifest.m3u8', proxyHandler);

    const extractorVideoHandler = async (req, res) => {
        if (serverIsBlockingStreams()) {
            return res.status(503).json({ error: 'server paused' });
        }
        try {
            const host = String(req.query.host || '').trim();
            const rawTarget = req.query.d && decodeURIComponent(req.query.d);
            if (!host || !rawTarget) {
                return res.status(400).json({ error: 'missing host or d' });
            }

            const headers = extractMediaflowHeaders(req.query);
            const resolveLatinoMediaflowTarget = await loadLatinoMediaflowResolver();
            let stream = await resolveLatinoMediaflowTarget(rawTarget, headers, {
                source: 'MediaFlow',
                language: 'Latino',
                title: host,
                referer: headers.referer || headers.Referer || rawTarget,
                player: host,
            });

            if (stream && stream.url && shouldRetryLatinoPlaybackHost(host)) {
                const firstStatus = await probeResolvedLatinoStream(stream.url, stream.headers || headers);
                if (firstStatus === 403 || firstStatus === 404) {
                    console.log(`[extractor/video] retrying fragile host ${host} after probe status ${firstStatus}`);
                    const retried = await resolveLatinoMediaflowTarget(rawTarget, headers, {
                        source: 'MediaFlow',
                        language: 'Latino',
                        title: host,
                        referer: headers.referer || headers.Referer || rawTarget,
                        player: host,
                    }).catch(() => null);
                    if (retried && retried.url) {
                        stream = retried;
                    }
                }
            }

            if (!stream || !stream.url) {
                return res.status(404).json({ error: 'extractor could not resolve stream' });
            }

            const sid = req.query.sid ? String(req.query.sid) : '';
            const proxyUrl = mediaflowProxyWrap(req, stream.url, stream.headers || headers, sid ? { sid } : {}, stream);

            const redirectMode = String(req.query.redirect_stream || '').toLowerCase();
            if (redirectMode !== 'false') {
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
    };

    app.get('/extractor/video', extractorVideoHandler);
    app.get('/extractor/video/manifest.m3u8', extractorVideoHandler);
});
