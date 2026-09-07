import { verifyTelegramSession } from '../lib/telegram-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const ACTIVE_STATUSES = new Set(['announced', 'filming', 'pre-production', 'post-production']);
const SHORT_RULE_VERSION = 'short-v1-one-season-up-to-10';
const PROVIDER_BATCH_SIZE = 150;
const PROVIDER_LIMIT = 250;
const MAX_SHORT_SERIES_EPISODES = 10;
const PROVIDER_TIMEOUT_MS = 7000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

const ensureTraitsTable = async db => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS movie_series_traits (
      kinopoisk_id INTEGER PRIMARY KEY,
      is_short_series INTEGER NOT NULL DEFAULT 0,
      is_limited_series INTEGER,
      season_count INTEGER,
      episode_count INTEGER,
      short_rule_version TEXT,
      short_source TEXT,
      limited_source TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
};

const fetchJson = async (url, token) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'X-API-KEY': token,
        accept: 'application/json'
      },
      signal: controller.signal,
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

    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Источник данных отвечает слишком долго.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const readLibrarySeriesIds = async (db, userId) => {
  const result = await db.prepare(`
    SELECT m.kinopoisk_id
    FROM user_movies um
    JOIN movies m ON m.kinopoisk_id = um.kinopoisk_id
    WHERE um.user_id = ?
      AND um.status IN ('watchlist', 'watched', 'rewatch')
      AND m.type IN ('series', 'mini')
    ORDER BY m.kinopoisk_id
  `).bind(userId).all();
  return (result.results || []).map(row => String(row.kinopoisk_id));
};

const readCachedTraits = async (db, ids) => {
  const map = new Map();
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = ids.slice(offset, offset + 400);
    if (!batch.length) continue;
    const placeholders = batch.map(() => '?').join(',');
    const result = await db.prepare(`
      SELECT kinopoisk_id, is_short_series, season_count, episode_count
      FROM movie_series_traits
      WHERE kinopoisk_id IN (${placeholders})
        AND short_rule_version = ?
    `).bind(...batch.map(Number), SHORT_RULE_VERSION).all();
    for (const row of result.results || []) {
      map.set(String(row.kinopoisk_id), {
        isShortSeries: Number(row.is_short_series) === 1,
        seasonCount: Number(row.season_count) || 0,
        episodeCount: Number(row.episode_count) || 0
      });
    }
  }
  return map;
};

const fetchSeasonNumber = async (ids, seasonNumber, token) => {
  if (!ids.length) return new Map();
  const url = new URL('https://api.poiskkino.dev/v1.4/season');
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(Math.min(PROVIDER_LIMIT, ids.length)));
  ids.forEach(id => url.searchParams.append('movieId', String(id)));
  url.searchParams.append('number', String(seasonNumber));
  url.searchParams.append('selectFields', 'movieId');
  url.searchParams.append('selectFields', 'episodesCount');

  const data = await fetchJson(url.toString(), token);
  const map = new Map();
  for (const season of Array.isArray(data?.docs) ? data.docs : []) {
    if (season?.movieId == null) continue;
    const count = Number(season?.episodesCount);
    map.set(String(season.movieId), Number.isInteger(count) && count > 0 ? count : 0);
  }
  return map;
};

const fetchStatuses = async (ids, token) => {
  if (!ids.length) return new Map();
  const url = new URL('https://api.poiskkino.dev/v1.4/movie');
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(Math.min(PROVIDER_LIMIT, ids.length)));
  ids.forEach(id => url.searchParams.append('id', String(id)));
  url.searchParams.append('selectFields', 'id');
  url.searchParams.append('selectFields', 'status');

  const data = await fetchJson(url.toString(), token);
  const map = new Map();
  for (const item of Array.isArray(data?.docs) ? data.docs : []) {
    if (item?.id != null) map.set(String(item.id), String(item.status || '').toLowerCase());
  }
  return map;
};

const classifyBatch = async (ids, token) => {
  const [seasonOne, seasonTwo] = await Promise.all([
    fetchSeasonNumber(ids, 1, token),
    fetchSeasonNumber(ids, 2, token)
  ]);

  const knownIds = ids.filter(id => seasonOne.has(String(id)));
  const statuses = await fetchStatuses(knownIds, token);
  const traits = [];

  for (const id of knownIds) {
    const episodes = seasonOne.get(String(id)) || 0;
    const hasSecondSeason = seasonTwo.has(String(id));
    const status = statuses.get(String(id)) || '';
    const isShort = episodes > 0
      && episodes <= MAX_SHORT_SERIES_EPISODES
      && !hasSecondSeason
      && !ACTIVE_STATUSES.has(status);

    traits.push({
      id: String(id),
      isShort,
      seasonCount: hasSecondSeason ? 2 : 1,
      episodeCount: episodes
    });
  }

  return {
    traits,
    seasonOneRecords: seasonOne.size,
    seasonTwoRecords: seasonTwo.size
  };
};

const saveTraits = async (db, traits) => {
  for (let offset = 0; offset < traits.length; offset += 100) {
    const batch = traits.slice(offset, offset + 100);
    if (!batch.length) continue;
    await db.batch(batch.map(item => db.prepare(`
      INSERT INTO movie_series_traits (
        kinopoisk_id, is_short_series, season_count, episode_count,
        short_rule_version, short_source, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'poiskkino-season', CURRENT_TIMESTAMP)
      ON CONFLICT(kinopoisk_id) DO UPDATE SET
        is_short_series = excluded.is_short_series,
        season_count = excluded.season_count,
        episode_count = excluded.episode_count,
        short_rule_version = excluded.short_rule_version,
        short_source = excluded.short_source,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      Number(item.id),
      item.isShort ? 1 : 0,
      item.seasonCount,
      item.episodeCount,
      SHORT_RULE_VERSION
    )));
  }
};

export async function onRequestPost(context) {
  try {
    const db = context.env.MOVIES_DB;
    if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

    const session = await verifyTelegramSession(context.request, context.env.TELEGRAM_BOT_TOKEN);
    if (!session.ok) return json({ error: 'Нужен вход через Telegram.' }, 401);

    await ensureTraitsTable(db);

    // Старое экспериментальное значение `mini` использовалось как эвристика.
    // Возвращаем его к базовому типу `series`; признаки теперь хранятся отдельно.
    await db.prepare(`UPDATE movies SET type = 'series' WHERE type = 'mini'`).run();

    const ids = await readLibrarySeriesIds(db, session.userId);
    if (!ids.length) return json({ ok: true, shortSeriesIds: [], checked: 0, cached: 0, unresolved: 0 });

    const cached = await readCachedTraits(db, ids);
    const missing = ids.filter(id => !cached.has(String(id)));
    const token = String(context.env.POISKKINO_API_TOKEN || '').trim();

    if (missing.length && !token) {
      return json({ error: 'Не настроен источник данных для определения коротких сериалов.' }, 503);
    }

    let checked = 0;
    let seasonOneRecords = 0;
    let seasonTwoRecords = 0;
    const freshTraits = [];

    const batches = [];
    for (let offset = 0; offset < missing.length; offset += PROVIDER_BATCH_SIZE) {
      batches.push(missing.slice(offset, offset + PROVIDER_BATCH_SIZE));
    }

    const results = await Promise.all(batches.map(batch => classifyBatch(batch, token)));
    results.forEach((result, index) => {
      checked += batches[index].length;
      seasonOneRecords += result.seasonOneRecords;
      seasonTwoRecords += result.seasonTwoRecords;
      freshTraits.push(...result.traits);
    });

    await saveTraits(db, freshTraits);

    const finalTraits = await readCachedTraits(db, ids);
    const shortSeriesIds = ids.filter(id => finalTraits.get(String(id))?.isShortSeries);

    return json({
      ok: true,
      shortSeriesIds,
      totalSeries: ids.length,
      cached: ids.length - missing.length,
      checked,
      resolved: finalTraits.size,
      unresolved: ids.length - finalTraits.size,
      seasonOneRecords,
      seasonTwoRecords,
      maxEpisodes: MAX_SHORT_SERIES_EPISODES,
      ruleVersion: SHORT_RULE_VERSION,
      rule: 'one-season-up-to-10-episodes-not-active-production'
    });
  } catch (error) {
    const status = Number(error?.status);
    return json({ error: error?.message || 'Не удалось определить короткие сериалы.' },
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500);
  }
}

export function onRequest() {
  return json({ error: 'Метод не поддерживается.' }, 405);
}
