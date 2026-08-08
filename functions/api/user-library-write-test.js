const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const TEST_USER_ID = 'local_test_user';
const TEST_KINOPOISK_ID = 712;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: HEADERS
});

export async function onRequestGet(context) {
  const db = context.env.MOVIES_DB;
  if (!db) return json({ ok: false, error: 'MOVIES_DB binding is unavailable.' }, 503);

  try {
    const user = await db.prepare('SELECT id FROM users WHERE id = ? LIMIT 1')
      .bind(TEST_USER_ID)
      .first();
    if (!user) return json({ ok: false, error: 'Test user not found.' }, 404);

    const movie = await db.prepare('SELECT kinopoisk_id, title FROM movies WHERE kinopoisk_id = ? LIMIT 1')
      .bind(TEST_KINOPOISK_ID)
      .first();
    if (!movie) return json({ ok: false, error: 'Test movie 712 not found in movies.' }, 404);

    await db.prepare(`
      INSERT INTO user_movies (
        user_id,
        kinopoisk_id,
        status,
        for_tonight,
        created_at,
        updated_at,
        added_at
      ) VALUES (?, ?, 'watchlist', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, kinopoisk_id) DO UPDATE SET
        status = 'watchlist',
        for_tonight = 0,
        updated_at = CURRENT_TIMESTAMP,
        added_at = COALESCE(user_movies.added_at, CURRENT_TIMESTAMP)
    `).bind(TEST_USER_ID, TEST_KINOPOISK_ID).run();

    const saved = await db.prepare(`
      SELECT
        um.user_id,
        um.kinopoisk_id,
        um.status,
        um.for_tonight,
        um.personal_rating,
        um.watched_at,
        um.added_at,
        m.title
      FROM user_movies um
      JOIN movies m ON m.kinopoisk_id = um.kinopoisk_id
      WHERE um.user_id = ? AND um.kinopoisk_id = ?
      LIMIT 1
    `).bind(TEST_USER_ID, TEST_KINOPOISK_ID).first();

    return json({
      ok: true,
      testOnly: true,
      message: 'Test movie saved to server library.',
      item: {
        userId: saved.user_id,
        kinopoiskId: String(saved.kinopoisk_id),
        title: saved.title,
        status: saved.status,
        forTonight: Number(saved.for_tonight || 0) === 1,
        personalRating: saved.personal_rating ?? null,
        watchedAt: saved.watched_at ?? null,
        addedAt: saved.added_at ?? null
      }
    });
  } catch (error) {
    return json({ ok: false, error: 'Write test failed.', details: String(error?.message || error) }, 500);
  }
}
