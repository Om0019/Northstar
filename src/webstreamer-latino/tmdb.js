import { TMDB_API_KEY, TMDB_BASE_URL } from './constants.js';
import { fetchJson } from './http.js';

function normalizeMediaType(mediaType) {
  return mediaType === 'tv' ? 'tv' : 'movie';
}

export async function getTmdbInfo(tmdbId, mediaType) {
  const type = normalizeMediaType(mediaType);
  const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids&language=es-ES`;

  const data = await fetchJson(url);
  const title = type === 'tv' ? data.name : data.title;
  const originalTitle = type === 'tv' ? (data.original_name || data.name) : (data.original_title || data.title);
  const year = type === 'tv'
    ? (data.first_air_date || '').slice(0, 4)
    : (data.release_date || '').slice(0, 4);

  return {
    tmdbId: String(tmdbId),
    mediaType: type,
    title,
    originalTitle,
    year,
    imdbId: data.external_ids ? data.external_ids.imdb_id : null,
  };
}

export function buildEpisodeTag(season, episode) {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}
