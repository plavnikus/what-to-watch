const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30',
  'x-content-type-options': 'nosniff'
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
const normalize = row => {
  const imdbId = String(row.imdb_id || '');
  const durationMinutes = asNumber(row.duration_minutes);
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
    enrichedAt: String(row.updated_at || row.created_at || '')
  };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

export async function onRequestGet(context) {
  const db = context.env.MOVIES_DB;
  if (!db) return json({ error: 'Общий каталог временно недоступен.' }, 503);

  const url = new URL(context.request.url);
  const q = String(url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 50);

  if (q.length < 2) return json({ items: [], total: 0, query: q });

  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  try {
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
    return json({ error: 'Не удалось выполнить поиск по каталогу.', details: String(error?.message || error) }, 500);
  }
}
