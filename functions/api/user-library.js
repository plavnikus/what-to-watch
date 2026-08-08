const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const TEST_USER_ID = 'local_test_user';
const ALLOWED_STATUSES = new Set(['none', 'watchlist', 'watched', 'rewatch']);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

const asInt = value => {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
};

const asNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;

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

const normalizeLibraryRow = row => {
  const imdbId = String(row.imdb_id || '');
  const durationMinutes = asNumber(row.duration_minutes);
  return {
    kinopoiskId: String(row.kinopoisk_id),
    status: String(row.status || 'none'),
    forTonight: Number(row.for_tonight || 0) === 1,
    personalRating: row.personal_rating == null ? null : asNumber(row.personal_rating),
    watchedAt: row.watched_at || null,
    addedAt: row.added_at || null,
    selectedForTonightAt: row.selected_for_tonight_at || null,
    note: row.note || null,
    updatedAt: row.user_movie_updated_at || null,
    movie: {
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
      trailer: String(row.trailer_url || '')
    }
  };
};

const getDb = context => context.env.MOVIES_DB;

// Temporary MVP identity resolver. Later this function is the only place that
// needs to change when Telegram initData verification is connected.
const resolveUserId = () => TEST_USER_ID;

const ensureUserExists = async (db, userId) => {
  const user = await db.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').bind(userId).first();
  return Boolean(user);
};

const readBody = async request => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const validateKinopoiskId = value => {
  const id = asInt(value);
  return id && id > 0 ? id : null;
};

const validateRating = value => {
  if (value === null || value === '' || typeof value === 'undefined') return { ok: true, value: null };
  const rating = asInt(value);
  if (rating == null || rating < 1 || rating > 10) return { ok: false, value: null };
  return { ok: true, value: rating };
};

const getLibraryItem = async (db, userId, kinopoiskId) => db.prepare(`
  SELECT
    um.user_id,
    um.kinopoisk_id,
    um.status,
    um.for_tonight,
    um.personal_rating,
    um.watched_at,
    um.added_at,
    um.selected_for_tonight_at,
    um.note,
    um.updated_at AS user_movie_updated_at,
    m.title,
    m.original_title,
    m.year,
    m.type,
    m.countries_json,
    m.genres_json,
    m.description,
    m.short_description,
    m.duration_minutes,
    m.rating_kp,
    m.rating_imdb,
    m.poster_url,
    m.backdrop_url,
    m.imdb_id,
    m.tmdb_id,
    m.kp_url,
    m.trailer_url
  FROM user_movies um
  JOIN movies m ON m.kinopoisk_id = um.kinopoisk_id
  WHERE um.user_id = ? AND um.kinopoisk_id = ?
  LIMIT 1
`).bind(userId, kinopoiskId).first();

export async function onRequestGet(context) {
  const db = getDb(context);
  if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

  const userId = resolveUserId(context.request);
  const url = new URL(context.request.url);
  const status = String(url.searchParams.get('status') || '').trim();
  const forTonightOnly = url.searchParams.get('forTonight') === '1';
  const kinopoiskId = validateKinopoiskId(url.searchParams.get('kinopoiskId'));

  if (status && !ALLOWED_STATUSES.has(status)) {
    return json({ error: 'Неизвестный статус фильма.' }, 400);
  }

  try {
    if (!(await ensureUserExists(db, userId))) {
      return json({ error: 'Тестовый пользователь не найден.' }, 404);
    }

    if (kinopoiskId) {
      const row = await getLibraryItem(db, userId, kinopoiskId);
      return json({ userId, item: row ? normalizeLibraryRow(row) : null });
    }

    const where = ['um.user_id = ?'];
    const binds = [userId];
    if (status) {
      where.push('um.status = ?');
      binds.push(status);
    }
    if (forTonightOnly) where.push('um.for_tonight = 1');

    const result = await db.prepare(`
      SELECT
        um.user_id,
        um.kinopoisk_id,
        um.status,
        um.for_tonight,
        um.personal_rating,
        um.watched_at,
        um.added_at,
        um.selected_for_tonight_at,
        um.note,
        um.updated_at AS user_movie_updated_at,
        m.title,
        m.original_title,
        m.year,
        m.type,
        m.countries_json,
        m.genres_json,
        m.description,
        m.short_description,
        m.duration_minutes,
        m.rating_kp,
        m.rating_imdb,
        m.poster_url,
        m.backdrop_url,
        m.imdb_id,
        m.tmdb_id,
        m.kp_url,
        m.trailer_url
      FROM user_movies um
      JOIN movies m ON m.kinopoisk_id = um.kinopoisk_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        um.for_tonight DESC,
        COALESCE(um.updated_at, um.created_at) DESC
    `).bind(...binds).all();

    const items = (result.results || []).map(normalizeLibraryRow);
    return json({ userId, items, total: items.length });
  } catch (error) {
    return json({ error: 'Не удалось загрузить личную кинотеку.', details: String(error?.message || error) }, 500);
  }
}

async function upsertLibraryItem(context, mode) {
  const db = getDb(context);
  if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

  const userId = resolveUserId(context.request);
  const body = await readBody(context.request);
  if (!body) return json({ error: 'Некорректное тело запроса.' }, 400);

  const kinopoiskId = validateKinopoiskId(body.kinopoiskId);
  if (!kinopoiskId) return json({ error: 'Нужен корректный kinopoiskId.' }, 400);

  const requestedStatus = typeof body.status === 'undefined'
    ? (mode === 'create' ? 'watchlist' : null)
    : String(body.status);
  if (requestedStatus !== null && !ALLOWED_STATUSES.has(requestedStatus)) {
    return json({ error: 'Неизвестный статус фильма.' }, 400);
  }

  const rating = validateRating(body.personalRating);
  if (!rating.ok) return json({ error: 'Личная оценка должна быть целым числом от 1 до 10.' }, 400);

  try {
    if (!(await ensureUserExists(db, userId))) {
      return json({ error: 'Тестовый пользователь не найден.' }, 404);
    }

    const movie = await db.prepare('SELECT kinopoisk_id FROM movies WHERE kinopoisk_id = ? LIMIT 1')
      .bind(kinopoiskId)
      .first();
    if (!movie) return json({ error: 'Фильм ещё не найден в общем каталоге.' }, 404);

    const current = await db.prepare(`
      SELECT status, for_tonight, personal_rating, watched_at, added_at, selected_for_tonight_at, note
      FROM user_movies
      WHERE user_id = ? AND kinopoisk_id = ?
      LIMIT 1
    `).bind(userId, kinopoiskId).first();

    const status = requestedStatus ?? String(current?.status || 'none');
    let forTonight = typeof body.forTonight === 'boolean'
      ? body.forTonight
      : Number(current?.for_tonight || 0) === 1;
    let watchedAt = current?.watched_at || null;
    let addedAt = current?.added_at || null;
    let selectedForTonightAt = current?.selected_for_tonight_at || null;
    const now = new Date().toISOString();

    if (status === 'watched') {
      forTonight = false;
      selectedForTonightAt = null;
      watchedAt = watchedAt || now;
    }

    if ((status === 'watchlist' || status === 'rewatch') && !addedAt) {
      addedAt = now;
    }

    if (forTonight && status !== 'watched') {
      selectedForTonightAt = selectedForTonightAt || now;
    } else if (!forTonight) {
      selectedForTonightAt = null;
    }

    const personalRating = Object.prototype.hasOwnProperty.call(body, 'personalRating')
      ? rating.value
      : (current?.personal_rating ?? null);
    const note = Object.prototype.hasOwnProperty.call(body, 'note')
      ? (body.note == null ? null : String(body.note).slice(0, 2000))
      : (current?.note ?? null);

    await db.prepare(`
      INSERT INTO user_movies (
        user_id,
        kinopoisk_id,
        status,
        for_tonight,
        personal_rating,
        watched_at,
        added_at,
        selected_for_tonight_at,
        note,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, kinopoisk_id) DO UPDATE SET
        status = excluded.status,
        for_tonight = excluded.for_tonight,
        personal_rating = excluded.personal_rating,
        watched_at = excluded.watched_at,
        added_at = excluded.added_at,
        selected_for_tonight_at = excluded.selected_for_tonight_at,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      userId,
      kinopoiskId,
      status,
      forTonight ? 1 : 0,
      personalRating,
      watchedAt,
      addedAt,
      selectedForTonightAt,
      note
    ).run();

    const saved = await getLibraryItem(db, userId, kinopoiskId);
    return json({ ok: true, userId, item: saved ? normalizeLibraryRow(saved) : null }, mode === 'create' ? 201 : 200);
  } catch (error) {
    return json({ error: 'Не удалось сохранить личный статус фильма.', details: String(error?.message || error) }, 500);
  }
}

export async function onRequestPost(context) {
  return upsertLibraryItem(context, 'create');
}

export async function onRequestPatch(context) {
  return upsertLibraryItem(context, 'update');
}

export async function onRequestDelete(context) {
  const db = getDb(context);
  if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

  const userId = resolveUserId(context.request);
  const url = new URL(context.request.url);
  let kinopoiskId = validateKinopoiskId(url.searchParams.get('kinopoiskId'));

  if (!kinopoiskId) {
    const body = await readBody(context.request);
    kinopoiskId = validateKinopoiskId(body?.kinopoiskId);
  }
  if (!kinopoiskId) return json({ error: 'Нужен корректный kinopoiskId.' }, 400);

  try {
    const result = await db.prepare(`
      DELETE FROM user_movies
      WHERE user_id = ? AND kinopoisk_id = ?
    `).bind(userId, kinopoiskId).run();

    return json({ ok: true, userId, kinopoiskId: String(kinopoiskId), deleted: Number(result.meta?.changes || 0) > 0 });
  } catch (error) {
    return json({ error: 'Не удалось удалить фильм из личной кинотеки.', details: String(error?.message || error) }, 500);
  }
}
