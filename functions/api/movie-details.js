// Movie details v2.0 — shared D1 catalog + PoiskKino provider adapter
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const MAX_IDS_PER_REQUEST = 30;
const PROVIDER_CONCURRENCY = 3;

const asNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;
const names = value => Array.isArray(value)
  ? value.map(item => String(item?.name || '').trim()).filter(Boolean)
  : [];

const parseJsonArray = value => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const formatDuration = minutes => {
  const value = asNumber(minutes);
  if (!value || value <= 0) return '';
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${rest} мин`;
};

const mapType = value => {
  const type = String(value || '').toLowerCase();
  if (type === 'mini-series') return 'mini';
  if (['tv-series', 'animated-series', 'anime'].includes(type)) return 'series';
  return 'film';
};

function normalizeProviderMovie(source, id) {
  const type = mapType(source.type);
  const title = source.name || source.alternativeName || source.enName || `Кинопоиск ${id}`;
  const imdbId = String(source.externalId?.imdb || '');
  const tmdbId = asNumber(source.externalId?.tmdb);
  const trailer = Array.isArray(source.videos?.trailers)
    ? source.videos.trailers.find(item => item?.url)?.url
    : '';
  const durationMinutes = asNumber(source.movieLength || source.seriesLength);
  const now = new Date().toISOString();

  return {
    kinopoiskId: String(source.id || id),
    title: String(title),
    originalTitle: String(source.alternativeName || source.enName || ''),
    year: asNumber(source.year),
    type,
    genres: names(source.genres),
    countries: names(source.countries),
    desc: String(source.description || source.shortDescription || ''),
    shortDescription: String(source.shortDescription || ''),
    durationMinutes,
    time: formatDuration(durationMinutes),
    posterUrl: String(source.poster?.url || source.poster?.previewUrl || ''),
    backdropUrl: String(source.backdrop?.url || source.backdrop?.previewUrl || ''),
    kp: asNumber(source.rating?.kp),
    imdb: asNumber(source.rating?.imdb),
    imdbId,
    tmdbId,
    kpUrl: `https://www.kinopoisk.ru/${type === 'series' || type === 'mini' ? 'series' : 'film'}/${source.id || id}/`,
    imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : '',
    trailer: String(trailer || `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' трейлер')}`),
    source: 'poiskkino',
    sourceUpdatedAt: String(source.updatedAt || source.updated_at || now),
    enrichedAt: now
  };
}

function normalizeDatabaseMovie(row) {
  const durationMinutes = asNumber(row.duration_minutes);
  const imdbId = String(row.imdb_id || '');
  return {
    kinopoiskId: String(row.kinopoisk_id),
    title: String(row.title || ''),
    originalTitle: String(row.original_title || ''),
    year: asNumber(row.year),
    type: String(row.type || 'film'),
    genres: parseJsonArray(row.genres_json),
    countries: parseJsonArray(row.countries_json),
    desc: String(row.description || row.short_description || ''),
    shortDescription: String(row.short_description || ''),
    durationMinutes,
    time: formatDuration(durationMinutes),
    posterUrl: String(row.poster_url || ''),
    backdropUrl: String(row.backdrop_url || ''),
    kp: asNumber(row.rating_kp),
    imdb: asNumber(row.rating_imdb),
    imdbId,
    tmdbId: asNumber(row.tmdb_id),
    kpUrl: String(row.kp_url || ''),
    imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : '',
    trailer: String(row.trailer_url || ''),
    source: String(row.source || 'poiskkino'),
    sourceUpdatedAt: String(row.source_updated_at || ''),
    enrichedAt: String(row.updated_at || row.created_at || '')
  };
}

async function readCachedMovies(db, ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const query = `SELECT * FROM movies WHERE kinopoisk_id IN (${placeholders})`;
  const result = await db.prepare(query).bind(...ids.map(Number)).all();
  const map = new Map();
  for (const row of result.results || []) {
    const movie = normalizeDatabaseMovie(row);
    map.set(movie.kinopoiskId, movie);
  }
  return map;
}

async function fetchProviderMovie(id, token) {
  const response = await fetch(`https://api.poiskkino.dev/v1.4/movie/${encodeURIComponent(id)}`, {
    headers: {
      'X-API-KEY': token,
      accept: 'application/json'
    },
    cf: {
      cacheTtl: 86400,
      cacheEverything: true
    }
  });

  if (!response.ok) {
    let message = `ПоискКино вернул ошибку ${response.status}`;
    try {
      const body = await response.json();
      message = body?.message || body?.error || message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return normalizeProviderMovie(await response.json(), id);
}

function createUpsertStatement(db, movie) {
  return db.prepare(`
    INSERT INTO movies (
      kinopoisk_id, title, original_title, year, type,
      countries_json, genres_json, description, short_description,
      duration_minutes, rating_kp, rating_imdb, poster_url, backdrop_url,
      imdb_id, tmdb_id, kp_url, trailer_url, source, source_updated_at,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(kinopoisk_id) DO UPDATE SET
      title = excluded.title,
      original_title = excluded.original_title,
      year = excluded.year,
      type = excluded.type,
      countries_json = excluded.countries_json,
      genres_json = excluded.genres_json,
      description = excluded.description,
      short_description = excluded.short_description,
      duration_minutes = excluded.duration_minutes,
      rating_kp = excluded.rating_kp,
      rating_imdb = excluded.rating_imdb,
      poster_url = excluded.poster_url,
      backdrop_url = excluded.backdrop_url,
      imdb_id = excluded.imdb_id,
      tmdb_id = excluded.tmdb_id,
      kp_url = excluded.kp_url,
      trailer_url = excluded.trailer_url,
      source = excluded.source,
      source_updated_at = excluded.source_updated_at,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    Number(movie.kinopoiskId),
    movie.title,
    movie.originalTitle || null,
    movie.year,
    movie.type,
    JSON.stringify(movie.countries || []),
    JSON.stringify(movie.genres || []),
    movie.desc || null,
    movie.shortDescription || null,
    movie.durationMinutes,
    movie.kp,
    movie.imdb,
    movie.posterUrl || null,
    movie.backdropUrl || null,
    movie.imdbId || null,
    movie.tmdbId,
    movie.kpUrl || null,
    movie.trailer || null,
    movie.source || 'poiskkino',
    movie.sourceUpdatedAt || null
  );
}

async function saveMovies(db, movies) {
  if (!movies.length) return { attempted: 0, successful: 0, results: [] };
  const statements = movies.map(movie => createUpsertStatement(db, movie));
  const results = await db.batch(statements);
  const successful = Array.isArray(results)
    ? results.filter(result => result?.success !== false).length
    : 0;
  return {
    attempted: movies.length,
    successful,
    results: Array.isArray(results)
      ? results.map(result => ({
          success: result?.success !== false,
          changes: result?.meta?.changes ?? null,
          duration: result?.meta?.duration ?? null
        }))
      : []
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

export async function onRequestPost(context) {
  try {
    const db = context.env.MOVIES_DB;
    const token = context.env.POISKKINO_API_TOKEN;

    if (!db) {
      throw new Error('В Cloudflare не найдено подключение MOVIES_DB.');
    }

    const body = await context.request.json().catch(() => ({}));
    const ids = [...new Set(
      (Array.isArray(body.kinopoiskIds) ? body.kinopoiskIds : [])
        .map(String)
        .filter(id => /^\d+$/.test(id))
    )].slice(0, MAX_IDS_PER_REQUEST);

    if (!ids.length) {
      throw new Error('Не переданы ID фильмов.');
    }

    const cachedMap = await readCachedMovies(db, ids);
    const missingIds = ids.filter(id => !cachedMap.has(id));
    const fetchedMovies = [];
    const errors = [];

    if (missingIds.length) {
      if (!token) {
        errors.push(...missingIds.map(kinopoiskId => ({
          kinopoiskId,
          error: 'В Cloudflare не найден секрет POISKKINO_API_TOKEN.'
        })));
      } else {
        for (let offset = 0; offset < missingIds.length; offset += PROVIDER_CONCURRENCY) {
          const batch = missingIds.slice(offset, offset + PROVIDER_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(id => fetchProviderMovie(id, token))
          );

          results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              fetchedMovies.push(result.value);
            } else {
              errors.push({
                kinopoiskId: batch[index],
                error: result.reason?.message || 'Ошибка запроса'
              });
            }
          });
        }

        var writeResult = await saveMovies(db, fetchedMovies);
      }
    }

    const itemMap = new Map(cachedMap);
    for (const movie of fetchedMovies) {
      itemMap.set(movie.kinopoiskId, movie);
    }

    // Сохраняем исходный порядок ID, чтобы frontend обновлял именно запрошенные позиции.
    const items = ids.map(id => itemMap.get(id)).filter(Boolean);

    return jsonResponse({
      provider: 'shared-catalog',
      requested: ids.length,
      received: items.length,
      items,
      errors,
      cache: {
        hits: cachedMap.size,
        misses: missingIds.length,
        saved: writeResult?.successful || 0
      }
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || 'Ошибка получения карточек.'
    }, 400);
  }
}

export function onRequestGet() {
  return jsonResponse({ error: 'Метод не поддерживается.' }, 405);
}

export function onRequest() {
  return jsonResponse({ error: 'Метод не поддерживается.' }, 405);
}
