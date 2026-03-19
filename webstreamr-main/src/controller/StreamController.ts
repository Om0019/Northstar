import { Mutex } from 'async-mutex';
import { Request, Response, Router } from 'express';
import { ContentType } from 'stremio-addon-sdk';
import winston from 'winston';
import { Source } from '../source';
import { contextFromRequestAndResponse, envGet, envIsProd, Id, ImdbId, StreamResolver, TmdbId } from '../utils';

export class StreamController {
  public readonly router: Router;

  private readonly logger: winston.Logger;
  private readonly sources: Source[];
  private readonly streamResolver: StreamResolver;

  private readonly locks = new Map<string, Mutex>();

  private readonly streamCache = new Map<string, { expiresAt: number; payload: { streams: unknown } }>();

  public constructor(logger: winston.Logger, sources: Source[], streams: StreamResolver) {
    this.router = Router();

    this.logger = logger;
    this.sources = sources;
    this.streamResolver = streams;

    this.router.get('/stream/:type/:id.json', this.getStream.bind(this));
    this.router.get('/:config/stream/:type/:id.json', this.getStream.bind(this));
  }

  private async getStream(req: Request, res: Response) {
    const type: ContentType = (req.params['type'] || '') as ContentType;
    const rawId: string = req.params['id'] as string || '';

    let id: Id;
    if (rawId.startsWith('tmdb:')) {
      id = TmdbId.fromString(rawId.replace('tmdb:', ''));
    } else if (rawId.startsWith('tt')) {
      id = ImdbId.fromString(rawId);
    } else {
      res.status(400).send(`Unsupported ID: ${rawId}`);

      return;
    }

    const ctx = contextFromRequestAndResponse(req, res);

    this.logger.info(`Search stream for type "${type}" and id "${rawId}" for ip ${ctx.ip}`, ctx);

    const sources = this.sources.filter(source => source.countryCodes.filter(countryCode => countryCode in ctx.config).length);

    const cacheTtlMs = parseInt(envGet('STREAM_CACHE_TTL_MS') || '0', 10) || 0;
    const cacheMaxEntries = Math.max(0, parseInt(envGet('STREAM_CACHE_MAX_ENTRIES') || '500', 10) || 500);
    const cacheKey = cacheTtlMs > 0
      ? `${type}|${rawId}|${JSON.stringify(ctx.config)}`
      : '';

    let mutex = this.locks.get(rawId);
    if (!mutex) {
      mutex = new Mutex();
      this.locks.set(rawId, mutex);
    }

    await mutex.runExclusive(async () => {
      if (cacheTtlMs > 0) {
        const cached = this.streamCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          res.setHeader('Content-Type', 'application/json');
          res.send(JSON.stringify(cached.payload));
          return;
        }
      }

      const { streams, ttl } = await this.streamResolver.resolve(ctx, sources, type, id);

      if (ttl && envIsProd()) {
        res.setHeader('Cache-Control', `public, max-age=${Math.floor(ttl / 1000)}, immutable`);
      }

      res.setHeader('Content-Type', 'application/json');
      const payload = { streams };
      res.send(JSON.stringify(payload));

      if (cacheTtlMs > 0) {
        // best-effort bounded cache
        if (this.streamCache.size >= cacheMaxEntries) {
          const firstKey = this.streamCache.keys().next().value as string | undefined;
          if (firstKey) {
            this.streamCache.delete(firstKey);
          }
        }
        this.streamCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, payload });
      }
    });

    if (!mutex.isLocked()) {
      this.locks.delete(rawId);
    }
  };
}
