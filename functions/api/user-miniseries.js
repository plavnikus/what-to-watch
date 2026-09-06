import { verifyTelegramSession } from '../lib/telegram-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const ACTIVE_STATUSES = new Set(['announced', 'filming', 'pre-production', 'post-production']);
const PROVIDER_BATCH_SIZE = 40;
const PROVIDER_CONCURRENCY = 3;
const PROVIDER_LIMIT = 250;
const MAX_MINISERIES_EPISODES = 10;
const PROVIDER_TIMEOUT_MS = 9000;

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
      signal: controller.signal
    });

    if (!response.ok) {
      let message = `ПоискКино вернул ошибку ${response.status}`;
      try {
        const body = await response.json();
        message = body?.message || body?.error || message;
      } catch {}
      throw new Error(message);
    }

    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Источник данных отвечает слишком долго.');
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

const fetchStatuses = async (ids, token) => {
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

const episodeCount = season => {
  if (Array.isArray(season?.episodes)) {
    const numbered = new Set(
      season.episodes
        .map(episode => Number(episode?.number))
        .filter(number => Number.isInteger(number) && number > 0)
    );
    return numbered.size || season.episodes.length;
  }

  for (const value of [season?.episodesCount, season?.episodeCount]) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }

  return 0;
};

const fetchSeasonStats = async (ids, token) => {
  const stats = new Map(ids.map(id => [String(id), new Map()]));
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL('https://api.poiskkino.dev/v1.4/season');
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PROVIDER_LIMIT));
    ids.forEach(id => url.searchParams.append('movieId', String(id)));
    // Keep the response small: only fields needed for the MVP classification.
    url.searchParams.append('selectFields', 'movieId');
    url.searchParams.append('selectFields', 'number');
    url.searchParams.append('selectFields', 'episodes');

    const data = await fetchJson(url.toString(), token);
    const docs = Array.isArray(data?.docs) ? data.docs : [];
    for (const season of docs) {
      const movieId = season?.movieId == null ? '' : String(season.movieId);
      const number = Number(season?.number);
      if (!stats.has(movieId) || !Number.isInteger(number) || number <= 0) continue;
      stats.get(movieId).set(number, episodeCount(season));
    }

    totalPages = Math.max(1, Number(data?.pages) || 1);
    page += 1;
  } while (page <= totalPages && page <= 10);

  return stats;
};

const classifyBatch = async (ids, token) => {
  const [statuses, seasonStats] = await Promise.all([
    fetchStatuses(ids, token),
    fetchSeasonStats(ids, token)
  ]);

  const qualified = [];
  let seasonRecords = 0;
  let episodeRecords = 0;

  for (const id of ids) {
    const seasons = seasonStats.get(String(id)) || new Map();
    seasonRecords += seasons.size;
    const episodeCounts = [...seasons.values()];
    episodeRecords += episodeCounts.reduce((sum, count) => sum + count, 0);

    const status = statuses.get(String(id)) || '';
    const hasOneSeason = seasons.size === 1;
    const episodes = hasOneSeason ? episodeCounts[0] || 0 : 0;
    const shortEnough = episodes > 0 && episodes <= MAX_MINISERIES_EPISODES;

    if (hasOneSeason && shortEnough && !ACTIVE_STATUSES.has(status)) {
      qualified.push(String(id));
    }
  }

  return { qualified, seasonRecords, episodeRecords };
};

const updateTypes = async (db, ids, type, currentType) => {
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
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

    const existingMiniIds = await readLibraryIdsByType(db, session.userId, 'mini');
    const seriesIds = await readLibraryIdsByType(db, session.userId, 'series');

    // The previous broad rule already promoted one-season candidates to `mini`.
    // Refine those first instead of re-scanning the whole library on a filter tap.
    // If there are no cached candidates (new user/library), perform the initial discovery.
    const candidateIds = existingMiniIds.length ? existingMiniIds : seriesIds;
    const phase = existingMiniIds.length ? 'refine-cached-candidates' : 'initial-discovery';

    if (!candidateIds.length) {
      return json({
        ok: true,
        miniIds: [],
        checked: 0,
        classified: 0,
        reverted: 0,
        seasonRecords: 0,
        episodeRecords: 0,
        phase
      });
    }

    const token = String(context.env.POISKKINO_API_TOKEN || '').trim();
    if (!token) return json({ error: 'Не настроен источник данных для определения мини-сериалов.' }, 503);

    const qualifiedMiniIds = new Set();
    let checked = 0;
    let seasonRecords = 0;
    let episodeRecords = 0;

    const batches = [];
    for (let offset = 0; offset < candidateIds.length; offset += PROVIDER_BATCH_SIZE) {
      batches.push(candidateIds.slice(offset, offset + PROVIDER_BATCH_SIZE));
    }

    for (let offset = 0; offset < batches.length; offset += PROVIDER_CONCURRENCY) {
      const group = batches.slice(offset, offset + PROVIDER_CONCURRENCY);
      const results = await Promise.all(group.map(batch => classifyBatch(batch, token)));
      results.forEach((result, index) => {
        checked += group[index].length;
        seasonRecords += result.seasonRecords;
        episodeRecords += result.episodeRecords;
        result.qualified.forEach(id => qualifiedMiniIds.add(id));
      });
    }

    const existingMiniSet = new Set(existingMiniIds);
    const newlyClassified = [...qualifiedMiniIds].filter(id => !existingMiniSet.has(id));
    const reverted = existingMiniIds.filter(id => !qualifiedMiniIds.has(id));

    await updateTypes(db, newlyClassified, 'mini', 'series');
    await updateTypes(db, reverted, 'series', 'mini');

    return json({
      ok: true,
      miniIds: [...qualifiedMiniIds],
      checked,
      classified: newlyClassified.length,
      reverted: reverted.length,
      seasonRecords,
      episodeRecords,
      maxEpisodes: MAX_MINISERIES_EPISODES,
      phase,
      rule: 'one-season-up-to-10-episodes-not-active-production',
      source: 'poiskkino-season-endpoint'
    });
  } catch (error) {
    return json({ error: error?.message || 'Не удалось определить мини-сериалы.' }, 500);
  }
}

export function onRequest() {
  return json({ error: 'Метод не поддерживается.' }, 405);
}
