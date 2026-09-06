import { verifyTelegramSession } from '../lib/telegram-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const ACTIVE_STATUSES = new Set(['announced', 'filming', 'pre-production', 'post-production']);
const PROVIDER_BATCH_SIZE = 40;
const PROVIDER_LIMIT = 250;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

const fetchJson = async (url, token) => {
  const response = await fetch(url, {
    headers: {
      'X-API-KEY': token,
      accept: 'application/json'
    }
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
};

const readLibraryIds = async (db, userId, type) => {
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

const fetchSeasonCounts = async (ids, token) => {
  const counts = new Map(ids.map(id => [String(id), new Set()]));
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL('https://api.poiskkino.dev/v1.4/season');
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PROVIDER_LIMIT));
    ids.forEach(id => url.searchParams.append('movieId', String(id)));
    url.searchParams.append('selectFields', 'movieId');
    url.searchParams.append('selectFields', 'number');

    const data = await fetchJson(url.toString(), token);
    const docs = Array.isArray(data?.docs) ? data.docs : [];
    for (const season of docs) {
      const movieId = season?.movieId == null ? '' : String(season.movieId);
      const number = Number(season?.number);
      if (!counts.has(movieId) || !Number.isInteger(number) || number <= 0) continue;
      counts.get(movieId).add(number);
    }

    totalPages = Math.max(1, Number(data?.pages) || 1);
    page += 1;
  } while (page <= totalPages && page <= 20);

  return counts;
};

export async function onRequestPost(context) {
  try {
    const db = context.env.MOVIES_DB;
    if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

    const session = await verifyTelegramSession(context.request, context.env.TELEGRAM_BOT_TOKEN);
    if (!session.ok) return json({ error: 'Нужен вход через Telegram.' }, 401);

    const existingMiniIds = await readLibraryIds(db, session.userId, 'mini');
    const seriesIds = await readLibraryIds(db, session.userId, 'series');
    if (!seriesIds.length) {
      return json({ ok: true, miniIds: existingMiniIds, checked: 0, classified: 0, seasonRecords: 0 });
    }

    const token = String(context.env.POISKKINO_API_TOKEN || '').trim();
    if (!token) return json({ error: 'Не настроен источник данных для определения мини-сериалов.' }, 503);

    const miniIds = new Set(existingMiniIds);
    let checked = 0;
    let seasonRecords = 0;

    for (let offset = 0; offset < seriesIds.length; offset += PROVIDER_BATCH_SIZE) {
      const batch = seriesIds.slice(offset, offset + PROVIDER_BATCH_SIZE);
      const [statuses, seasonCounts] = await Promise.all([
        fetchStatuses(batch, token),
        fetchSeasonCounts(batch, token)
      ]);

      checked += batch.length;
      for (const id of batch) {
        const seasons = seasonCounts.get(String(id)) || new Set();
        seasonRecords += seasons.size;
        const status = statuses.get(String(id)) || '';
        if (seasons.size === 1 && !ACTIVE_STATUSES.has(status)) {
          miniIds.add(String(id));
        }
      }
    }

    const existingSet = new Set(existingMiniIds);
    const newlyClassified = [...miniIds].filter(id => !existingSet.has(id));
    for (let offset = 0; offset < newlyClassified.length; offset += 100) {
      const batch = newlyClassified.slice(offset, offset + 100);
      await db.batch(batch.map(id => db.prepare(`
        UPDATE movies
        SET type = 'mini', updated_at = CURRENT_TIMESTAMP
        WHERE kinopoisk_id = ? AND type = 'series'
      `).bind(Number(id))));
    }

    return json({
      ok: true,
      miniIds: [...miniIds],
      checked,
      classified: newlyClassified.length,
      seasonRecords,
      rule: 'one-season-not-active-production',
      source: 'poiskkino-season-endpoint'
    });
  } catch (error) {
    return json({ error: error?.message || 'Не удалось определить мини-сериалы.' }, 500);
  }
}

export function onRequest() {
  return json({ error: 'Метод не поддерживается.' }, 405);
}
