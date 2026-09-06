import { verifyTelegramSession } from '../lib/telegram-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const ACTIVE_STATUSES = new Set(['announced', 'filming', 'pre-production', 'post-production']);
const PROVIDER_BATCH_SIZE = 150;
const PROVIDER_LIMIT = 250;
const MAX_MINISERIES_EPISODES = 10;
const PROVIDER_TIMEOUT_MS = 7000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

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

const readLibraryIdsByType = async (db, userId, type) => {
  const result = await db.prepare(`
    SELECT m.kinopoisk_id
    FROM user_movies um
    JOIN movies m ON m.kinopoisk_id = um.kinopoisk_id
    WHERE um.user_id = ?
      AND um.status IN ('watchlist', 'watched', 'rewatch')
      AND m.type = ?
    ORDER BY m.kinopoisk_id
  `).bind(userId, type).all();
  return (result.results || []).map(row => String(row.kinopoisk_id));
};

const fetchSeasonNumber = async (ids, seasonNumber, token) => {
  if (!ids.length) return new Map();

  const url = new URL('https://api.poiskkino.dev/v1.4/season');
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(Math.min(PROVIDER_LIMIT, ids.length)));
  ids.forEach(id => url.searchParams.append('movieId', String(id)));
  url.searchParams.append('number', String(seasonNumber));
  url.searchParams.append('selectFields', 'movieId');
  url.searchParams.append('selectFields', 'number');
  url.searchParams.append('selectFields', 'episodesCount');

  const data = await fetchJson(url.toString(), token);
  const map = new Map();
  for (const season of Array.isArray(data?.docs) ? data.docs : []) {
    if (season?.movieId == null) continue;
    const episodesCount = Number(season?.episodesCount);
    map.set(
      String(season.movieId),
      Number.isInteger(episodesCount) && episodesCount > 0 ? episodesCount : 0
    );
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

  const shortOneSeasonCandidates = ids.filter(id => {
    const episodes = seasonOne.get(String(id)) || 0;
    return episodes > 0
      && episodes <= MAX_MINISERIES_EPISODES
      && !seasonTwo.has(String(id));
  });

  const statuses = await fetchStatuses(shortOneSeasonCandidates, token);
  const qualified = shortOneSeasonCandidates.filter(id => {
    const status = statuses.get(String(id)) || '';
    return !ACTIVE_STATUSES.has(status);
  });

  return {
    qualified,
    seasonOneRecords: seasonOne.size,
    seasonTwoRecords: seasonTwo.size,
    shortCandidates: shortOneSeasonCandidates.length,
    statusRecords: statuses.size
  };
};

const updateTypes = async (db, ids, type, currentType) => {
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    if (!batch.length) continue;
    await db.batch(batch.map(id => db.prepare(`
      UPDATE movies
      SET type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE kinopoisk_id = ? AND type = ?
    `).bind(type, Number(id), currentType)));
  }
};

export async function onRequestPost(context) {
  try {
    const db = context.env.MOVIES_DB;
    if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

    const session = await verifyTelegramSession(context.request, context.env.TELEGRAM_BOT_TOKEN);
    if (!session.ok) return json({ error: 'Нужен вход через Telegram.' }, 401);

    const [existingMiniIds, seriesIds] = await Promise.all([
      readLibraryIdsByType(db, session.userId, 'mini'),
      readLibraryIdsByType(db, session.userId, 'series')
    ]);
    const candidateIds = [...new Set([...seriesIds, ...existingMiniIds])];

    if (!candidateIds.length) {
      return json({
        ok: true,
        miniIds: [],
        checked: 0,
        classified: 0,
        reverted: 0,
        seasonOneRecords: 0,
        seasonTwoRecords: 0,
        shortCandidates: 0,
        statusRecords: 0
      });
    }

    const token = String(context.env.POISKKINO_API_TOKEN || '').trim();
    if (!token) return json({ error: 'Не настроен источник данных для определения мини-сериалов.' }, 503);

    const batches = [];
    for (let offset = 0; offset < candidateIds.length; offset += PROVIDER_BATCH_SIZE) {
      batches.push(candidateIds.slice(offset, offset + PROVIDER_BATCH_SIZE));
    }

    const results = await Promise.all(batches.map(batch => classifyBatch(batch, token)));
    const qualifiedMiniIds = new Set();
    let seasonOneRecords = 0;
    let seasonTwoRecords = 0;
    let shortCandidates = 0;
    let statusRecords = 0;

    results.forEach(result => {
      result.qualified.forEach(id => qualifiedMiniIds.add(String(id)));
      seasonOneRecords += result.seasonOneRecords;
      seasonTwoRecords += result.seasonTwoRecords;
      shortCandidates += result.shortCandidates;
      statusRecords += result.statusRecords;
    });

    // Ноль нельзя считать достоверным, если поставщик вообще не вернул сезонные данные.
    if (seasonOneRecords === 0 && candidateIds.length > 0) {
      return json({
        error: 'Источник не вернул данные о сезонах. Типы фильмов не изменены.',
        checked: candidateIds.length,
        seasonOneRecords,
        seasonTwoRecords,
        shortCandidates,
        statusRecords
      }, 502);
    }

    const existingMiniSet = new Set(existingMiniIds);
    const newlyClassified = [...qualifiedMiniIds].filter(id => !existingMiniSet.has(id));
    const reverted = existingMiniIds.filter(id => !qualifiedMiniIds.has(id));

    await updateTypes(db, newlyClassified, 'mini', 'series');
    await updateTypes(db, reverted, 'series', 'mini');

    return json({
      ok: true,
      miniIds: [...qualifiedMiniIds],
      checked: candidateIds.length,
      classified: newlyClassified.length,
      reverted: reverted.length,
      seasonOneRecords,
      seasonTwoRecords,
      shortCandidates,
      statusRecords,
      maxEpisodes: MAX_MINISERIES_EPISODES,
      rule: 'season-1-up-to-10-no-season-2-not-active-production',
      source: 'poiskkino-season-episodes-count'
    });
  } catch (error) {
    const status = Number(error?.status);
    return json({
      error: error?.message || 'Не удалось определить мини-сериалы.'
    }, Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500);
  }
}

export function onRequest() {
  return json({ error: 'Метод не поддерживается.' }, 405);
}
