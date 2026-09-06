import { verifyTelegramSession } from '../lib/telegram-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

const ACTIVE_PRODUCTION_STATUSES = new Set([
  'announced',
  'filming',
  'pre-production',
  'post-production'
]);

const positiveSeasonNumbers = value => {
  const seasons = Array.isArray(value) ? value : [];
  return [...new Set(
    seasons
      .map(item => Number(item?.number))
      .filter(number => Number.isInteger(number) && number > 0)
  )];
};

const isMiniSeries = item => {
  const type = String(item?.type || '').toLowerCase();
  const status = String(item?.status || '').toLowerCase();
  const seasonNumbers = positiveSeasonNumbers(item?.seasonsInfo);

  // PoiskKino exposes limited series as tv-series rather than a separate mini-series type.
  // For MVP we treat a tv-series with exactly one regular season as a mini-series unless
  // the provider explicitly says it is still in active production.
  return type === 'tv-series'
    && seasonNumbers.length === 1
    && !ACTIVE_PRODUCTION_STATUSES.has(status);
};

const fetchProviderBatch = async (ids, token) => {
  const url = new URL('https://api.poiskkino.dev/v1.4/movie');
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(ids.length));
  ids.forEach(id => url.searchParams.append('id', String(id)));
  ['id', 'type', 'status', 'seasonsInfo'].forEach(field => url.searchParams.append('selectFields', field));

  const response = await fetch(url.toString(), {
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

  const data = await response.json();
  return Array.isArray(data?.docs) ? data.docs : [];
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

export async function onRequestPost(context) {
  try {
    const db = context.env.MOVIES_DB;
    if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

    const session = await verifyTelegramSession(context.request, context.env.TELEGRAM_BOT_TOKEN);
    if (!session.ok) return json({ error: 'Нужен вход через Telegram.' }, 401);

    const existingMiniIds = await readLibraryIds(db, session.userId, 'mini');
    const seriesIds = await readLibraryIds(db, session.userId, 'series');
    if (!seriesIds.length) {
      return json({ ok: true, miniIds: existingMiniIds, checked: 0, classified: 0 });
    }

    const token = String(context.env.POISKKINO_API_TOKEN || '').trim();
    if (!token) return json({ error: 'Не настроен источник данных для определения мини-сериалов.' }, 503);

    const miniIds = new Set(existingMiniIds);
    let checked = 0;
    let returned = 0;
    let singleSeasonCandidates = 0;
    let activeExcluded = 0;

    for (let offset = 0; offset < seriesIds.length; offset += 150) {
      const batch = seriesIds.slice(offset, offset + 150);
      const docs = await fetchProviderBatch(batch, token);
      checked += batch.length;
      returned += docs.length;

      for (const item of docs) {
        const seasonNumbers = positiveSeasonNumbers(item?.seasonsInfo);
        if (String(item?.type || '').toLowerCase() === 'tv-series' && seasonNumbers.length === 1) {
          singleSeasonCandidates++;
          if (ACTIVE_PRODUCTION_STATUSES.has(String(item?.status || '').toLowerCase())) {
            activeExcluded++;
            continue;
          }
        }
        if (isMiniSeries(item) && item?.id != null) miniIds.add(String(item.id));
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
      returned,
      classified: newlyClassified.length,
      singleSeasonCandidates,
      activeExcluded,
      rule: 'single-season-not-active-production'
    });
  } catch (error) {
    return json({ error: error?.message || 'Не удалось определить мини-сериалы.' }, 500);
  }
}

export function onRequest() {
  return json({ error: 'Метод не поддерживается.' }, 405);
}
