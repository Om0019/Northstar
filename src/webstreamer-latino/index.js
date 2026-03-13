import { getLatinoSourceResults } from './sources.js';
import { getTmdbInfo } from './tmdb.js';
import { resolveLatinoStreams } from './extractors.js';

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  const normalizedSeason = season == null ? null : parseInt(season, 10);
  const normalizedEpisode = episode == null ? null : parseInt(episode, 10);

  console.log(
    `[WebstreamerLatino] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}` +
    (normalizedSeason && normalizedEpisode ? `, S${normalizedSeason}E${normalizedEpisode}` : ''),
  );

  try {
    const tmdb = await getTmdbInfo(tmdbId, mediaType);
    console.log(`[WebstreamerLatino] TMDB Info: "${tmdb.title}" (${tmdb.year || 'N/A'})`);

    const sourceResults = await getLatinoSourceResults(tmdb, mediaType, normalizedSeason, normalizedEpisode);
    console.log(`[WebstreamerLatino] Candidate source URLs: ${sourceResults.length}`);

    const streams = await resolveLatinoStreams(sourceResults);
    console.log(`[WebstreamerLatino] Final streams: ${streams.length}`);

    return streams;
  } catch (error) {
    console.error('[WebstreamerLatino] getStreams error:', error.message);
    return [];
  }
}

module.exports = { getStreams };
