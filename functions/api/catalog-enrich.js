// Catalog enrichment v1.0 — protected batch enrichment for migrated D1 records
import { fetchProviderMovie, saveMovies } from './movie-details.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const MAX_BATCH_SIZE = 25;
const PROVIDER_CONCURRENCY = 3;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function readAdminKey(request) {
  return String(request.headers.get('x-catalog-enrich-key') || '').trim();
}

async function countPending(db) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM movies
    WHERE source = 'library_migration'
  `).first();
  return Number(row?.count || 0);
}

async function getPendingIds(db, limit) {
  const result = await db.prepare(`
    SELECT kinopoisk_id
    FROM movies
    WHERE source = 'library_migration'
    ORDER BY kinopoisk_id ASC
    LIMIT ?
  `).bind(limit).all();

  return (result.results || [])
    .map(row => String(row.kinopoisk_id || ''))
    .filter(id => /^\d+$/.test(id));
}

export async function onRequestPost(context) {
  try {
    const db = context.env.MOVIES_DB;
    const providerToken = String(context.env.POISKKINO_API_TOKEN || '').trim();
    const expectedKey = String(context.env.CATALOG_ENRICH_KEY || '').trim();

    if (!db) {
      return jsonResponse({ error: 'В Cloudflare не найдено подключение MOVIES_DB.' }, 503);
    }
    if (!providerToken) {
      return jsonResponse({ error: 'В Cloudflare не найден секрет POISKKINO_API_TOKEN.' }, 503);
    }
    if (!expectedKey) {
      return jsonResponse({ error: 'В Cloudflare не настроен секрет CATALOG_ENRICH_KEY.' }, 503);
    }
    if (readAdminKey(context.request) !== expectedKey) {
      return jsonResponse({ error: 'Недостаточно прав.' }, 401);
    }

    const body = await context.request.json().catch(() => ({}));
    const requestedLimit = Math.floor(Number(body.limit) || MAX_BATCH_SIZE);
    const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, requestedLimit));

    const pendingBefore = await countPending(db);
    if (!pendingBefore) {
      return jsonResponse({
        ok: true,
        requested: 0,
        enriched: 0,
        failed: 0,
        pendingBefore: 0,
        pendingAfter: 0,
        items: [],
        errors: []
      });
    }

    const ids = await getPendingIds(db, Math.min(limit, pendingBefore));
    const movies = [];
    const errors = [];

    for (let offset = 0; offset < ids.length; offset += PROVIDER_CONCURRENCY) {
      const batch = ids.slice(offset, offset + PROVIDER_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(id => fetchProviderMovie(id, providerToken))
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          movies.push(result.value);
        } else {
          errors.push({
            kinopoiskId: batch[index],
            error: result.reason?.message || 'Ошибка запроса к поставщику'
          });
        }
      });
    }

    const writeResult = await saveMovies(db, movies);
    const pendingAfter = await countPending(db);

    return jsonResponse({
      ok: errors.length === 0,
      requested: ids.length,
      enriched: writeResult.successful,
      failed: errors.length,
      pendingBefore,
      pendingAfter,
      items: movies.map(movie => ({
        kinopoiskId: movie.kinopoiskId,
        title: movie.title,
        source: movie.source
      })),
      errors
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || 'Ошибка пакетного обогащения каталога.'
    }, 500);
  }
}

export function onRequestGet() {
  return jsonResponse({ error: 'Метод не поддерживается.' }, 405);
}

export function onRequest() {
  return jsonResponse({ error: 'Метод не поддерживается.' }, 405);
}
