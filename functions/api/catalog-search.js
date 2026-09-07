const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30',
  'x-content-type-options': 'nosniff'
};

const SHORT_RULE_VERSION = 'short-v1-one-season-up-to-10';

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
const normalizeGenres = values => {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const genre = String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
    if (!genre || seen.has(genre)) continue;
    seen.add(genre);
    result.push(genre);
  }
  return result;
};
const formatDuration = minutes => {
  const value = asNumber(minutes);
  if (!value || value <= 0) return '';
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${rest} мин`;
};
const normalize = row => {
  const imdbId = String(row.imdb_id || '');
  const durationMinutes = asNumber(row.duration_minutes);
  const rawType = String(row.type || 'film');
  return {
    kinopoiskId: String(row.kinopoisk_id),
    title: String(row.title || ''),
    originalTitle: String(row.original_title || ''),
    year: asNumber(row.year),
    type: rawType === 'mini' ? 'series' : rawType,
    genres: normalizeGenres(parseJsonArray(row.genres_json)),
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
    enrichedAt: String(row.updated_at || row.created_at || '')
  };
};
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

const presetSql = (preset, currentYear) => {
  const base = `poster_url IS NOT NULL AND poster_url <> ''`;
  switch (preset) {
    case 'comedy': return { where: `${base} AND genres_json LIKE ?`, binds: ['%"комедия"%'], order: 'rating_kp DESC, year DESC' };
    case 'thriller': return { where: `${base} AND genres_json LIKE ?`, binds: ['%"триллер"%'], order: 'rating_kp DESC, year DESC' };
    case 'horror': return { where: `${base} AND genres_json LIKE ?`, binds: ['%"ужасы"%'], order: 'rating_kp DESC, year DESC' };
    case 'short-series': return {
      where: `${base} AND EXISTS (
        SELECT 1 FROM movie_series_traits mst
        WHERE mst.kinopoisk_id = movies.kinopoisk_id
          AND mst.is_short_series = 1
          AND mst.short_rule_version = ?
      )`,
      binds: [SHORT_RULE_VERSION],
      order: 'rating_kp DESC, year DESC'
    };
    case 'rating7': return { where: `${base} AND rating_kp >= 7`, binds: [], order: 'rating_kp DESC, year DESC' };
    case 'short': return { where: `${base} AND duration_minutes > 0 AND duration_minutes <= 120`, binds: [], order: 'rating_kp DESC, year DESC' };
    case 'new': return { where: `${base} AND year >= ?`, binds: [currentYear - 1], order: 'year DESC, rating_kp DESC' };
    case 'starter': return { where: `${base} AND rating_kp IS NOT NULL AND rating_kp >= 7`, binds: [], order: 'rating_kp DESC, year DESC' };
    default: return null;
  }
};

const STARTER_EXCLUDED_GENRES = new Set([
  'документальный', 'концерт', 'музыка', 'короткометражка', 'реальное тв', 'ток-шоу', 'новости'
]);
const starterPrimaryGenre = item => (item.genres || []).find(g => !STARTER_EXCLUDED_GENRES.has(String(g).toLowerCase())) || '';
const selectStarterItems = (items, limit) => {
  const eligible = items.filter(item => {
    const genres = (item.genres || []).map(g => String(g).toLowerCase());
    return item.posterUrl && Number(item.kp) >= 7 && !genres.some(g => STARTER_EXCLUDED_GENRES.has(g));
  });

  const selected = [];
  const usedPrimary = new Set();

  for (const item of eligible) {
    const primary = starterPrimaryGenre(item);
    if (primary && usedPrimary.has(primary)) continue;
    selected.push(item);
    if (primary) usedPrimary.add(primary);
    if (selected.length >= limit) return selected;
  }

  for (const item of eligible) {
    if (selected.some(x => x.kinopoiskId === item.kinopoiskId)) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
};

export async function onRequestGet(context) {
  const db = context.env.MOVIES_DB;
  if (!db) return json({ error: 'Общий каталог временно недоступен.' }, 503);

  const url = new URL(context.request.url);
  const q = String(url.searchParams.get('q') || '').trim();
  const preset = String(url.searchParams.get('preset') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 50);

  try {
    if (preset) {
      if (preset === 'short-series') await ensureTraitsTable(db);
      const cfg = presetSql(preset, new Date().getFullYear());
      if (!cfg) return json({ error: 'Неизвестный быстрый фильтр.' }, 400);
      const queryLimit = preset === 'starter' ? Math.min(Math.max(limit * 6, 30), 50) : limit;
      const result = await db.prepare(`
        SELECT * FROM movies
        WHERE ${cfg.where}
        ORDER BY ${cfg.order}
        LIMIT ?
      `).bind(...cfg.binds, queryLimit).all();
      const normalized = (result.results || []).map(normalize);
      const items = preset === 'starter' ? selectStarterItems(normalized, limit) : normalized.slice(0, limit);
      return json({ items, total: items.length, preset });
    }

    if (q.length < 2) return json({ items: [], total: 0, query: q });

    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const result = await db.prepare(`
      SELECT * FROM movies
      WHERE title LIKE ? ESCAPE '\\'
         OR original_title LIKE ? ESCAPE '\\'
      ORDER BY
        CASE WHEN lower(title) = lower(?) THEN 0
             WHEN lower(title) LIKE lower(?) THEN 1
             ELSE 2 END,
        rating_kp DESC,
        year DESC
      LIMIT ?
    `).bind(pattern, pattern, q, `${q}%`, limit).all();

    const items = (result.results || []).map(normalize);
    return json({ items, total: items.length, query: q });
  } catch (error) {
    return json({ error: 'Не удалось выполнить запрос к каталогу.', details: String(error?.message || error) }, 500);
  }
}
