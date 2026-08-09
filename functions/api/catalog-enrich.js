// Catalog enrichment v1.1 — protected, queue-safe batch enrichment for migrated D1 records
import { fetchProviderMovie, saveMovies } from './movie-details.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const MAX_BATCH_SIZE = 25;
const PROVIDER_CONCURRENCY = 3;
const PERMANENT_PROVIDER_STATUSES = new Set([404, 410, 422]);
const STOP_PROVIDER_STATUSES = new Set([401, 402, 403, 429]);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function readAdminKey(request) {
  return String(request.headers.get('x-catalog-enrich-key') || '').trim();
}

function resolveLimit(request, body) {
  const urlLimit = new URL(request.url).searchParams.get('limit');
  const rawLimit = urlLimit ?? body?.limit;
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(parsed)));
}

function errorStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status > 0 ? status : null;
}

function classifyProviderFailure(error) {
  const status = errorStatus(error);
  if (status && PERMANENT_PROVIDER_STATUSES.has(status)) return 'quarantine';
  if (status && STOP_PROVIDER_STATUSES.has(status)) return 'stop';
  return 'retry';
}

async function countBySource(db, source) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM movies
    WHERE source = ?
  `).bind(source).first();
  return Number(row?.count || 0);
}

async function countPending(db) {
  return countBySource(db, 'library_migration');
}

async function countQuarantined(db) {
  return countBySource(db, 'library_migration_failed');
}

async function getPendingIds(db, limit) {
  const result = await db.prepare(`
    SELECT kinopoisk_id
    FROM movies
    WHERE source = 'library_migration'
    ORDER BY datetime(updated_at) ASC, kinopoisk_id ASC
    LIMIT ?
  `).bind(limit).all();

  return (result.results || [])
    .map(row => String(row.kinopoisk_id || ''))
    .filter(id => /^\d+$/.test(id));
}

async function applyFailureQueueUpdates(db, failures) {
  const statements = [];

  for (const failure of failures) {
    if (failure.disposition === 'quarantine') {
      statements.push(db.prepare(`
        UPDATE movies
        SET source = 'library_migration_failed',
            updated_at = CURRENT_TIMESTAMP
        WHERE kinopoisk_id = ?
          AND source = 'library_migration'
      `).bind(Number(failure.kinopoiskId)));
    } else if (failure.disposition === 'retry') {
      // Keep the item eligible, but move it to the end of the queue so one
      // temporary provider failure cannot block enrichment of other movies.
      statements.push(db.prepare(`
        UPDATE movies
        SET updated_at = CURRENT_TIMESTAMP
        WHERE kinopoisk_id = ?
          AND source = 'library_migration'
      `).bind(Number(failure.kinopoiskId)));
    }
  }

  if (statements.length) {
    await db.batch(statements);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.MOVIES_DB;
    const providerToken = String(context.env.POISKKINO_API_TOKEN || '').trim();
    const expectedKey = String(context.env.CATALOG_ENRICH_KEY || '').trim();
    const providedKey = readAdminKey(context.request);

    if (!db) {
      return jsonResponse({ error: 'В Cloudflare не найдено подключение MOVIES_DB.' }, 503);
    }
    if (!providerToken) {
      return jsonResponse({ error: 'В Cloudflare не найден секрет POISKKINO_API_TOKEN.' }, 503);
    }
    if (!expectedKey) {
      return jsonResponse({ error: 'В Cloudflare не настроен секрет CATALOG_ENRICH_KEY.' }, 503);
    }
    if (providedKey !== expectedKey) {
      return jsonResponse({ error: 'Недостаточно прав.' }, 401);
    }

    const body = await context.request.json().catch(() => ({}));
    const limit = resolveLimit(context.request, body);

    const pendingBefore = await countPending(db);
    const quarantinedBefore = await countQuarantined(db);
    if (!pendingBefore) {
      return jsonResponse({
        ok: true,
        requested: 0,
        attempted: 0,
        enriched: 0,
        failed: 0,
        skipped: 0,
        quarantined: 0,
        retryLater: 0,
        pendingBefore: 0,
        pendingAfter: 0,
        quarantinedBefore,
        quarantinedAfter: quarantinedBefore,
        stopped: false,
        stopReason: null,
        items: [],
        errors: []
      });
    }

    const ids = await getPendingIds(db, Math.min(limit, pendingBefore));
    const movies = [];
    const errors = [];
    let attempted = 0;
    let stopReason = null;

    for (let offset = 0; offset < ids.length; offset += PROVIDER_CONCURRENCY) {
      const batch = ids.slice(offset, offset + PROVIDER_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(id => fetchProviderMovie(id, providerToken))
      );
      attempted += batch.length;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          movies.push(result.value);
          return;
        }

        const kinopoiskId = batch[index];
        const status = errorStatus(result.reason);
        const disposition = classifyProviderFailure(result.reason);
        const failure = {
          kinopoiskId,
          status,
          disposition,
          error: result.reason?.message || 'Ошибка запроса к поставщику'
        };
        errors.push(failure);

        if (disposition === 'stop' && !stopReason) {
          stopReason = status
            ? `Поставщик остановил пакет с HTTP ${status}.`
            : 'Поставщик остановил пакет.';
        }
      });

      if (stopReason) break;
    }

    const writeResult = await saveMovies(db, movies);
    await applyFailureQueueUpdates(db, errors);

    const pendingAfter = await countPending(db);
    const quarantinedAfter = await countQuarantined(db);
    const quarantined = errors.filter(item => item.disposition === 'quarantine').length;
    const retryLater = errors.filter(item => item.disposition !== 'quarantine').length;

    return jsonResponse({
      ok: errors.length === 0,
      requested: ids.length,
      attempted,
      enriched: writeResult.successful,
      failed: errors.length,
      skipped: Math.max(0, ids.length - attempted),
      quarantined,
      retryLater,
      pendingBefore,
      pendingAfter,
      quarantinedBefore,
      quarantinedAfter,
      stopped: Boolean(stopReason),
      stopReason,
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
