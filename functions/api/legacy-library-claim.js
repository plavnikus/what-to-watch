import { verifyTelegramSession } from '../lib/telegram-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const SOURCE_USER_ID = 'local_test_user';
const CHUNK_SIZE = 25;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS
});

const copyRowStatement = (db, targetUserId, row) => db.prepare(`
  INSERT INTO user_movies (
    user_id, kinopoisk_id, status, for_tonight, personal_rating, watched_at,
    added_at, selected_for_tonight_at, note, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, kinopoisk_id) DO NOTHING
`).bind(
  targetUserId,
  row.kinopoisk_id,
  row.status,
  row.for_tonight,
  row.personal_rating,
  row.watched_at,
  row.added_at,
  row.selected_for_tonight_at,
  row.note,
  row.created_at,
  row.updated_at
);

export async function onRequestPost(context) {
  const db = context.env.MOVIES_DB;
  if (!db) return json({ error: 'Личная кинотека временно недоступна.' }, 503);

  const session = await verifyTelegramSession(context.request, context.env.TELEGRAM_BOT_TOKEN);
  if (!session.ok) return json({ error: 'Нужен вход через Telegram.' }, 401);

  const configuredOwner = String(context.env.LEGACY_LIBRARY_OWNER_USER_ID || '').trim();
  if (!configuredOwner) {
    return json({ error: 'Владелец старой кинотеки ещё не задан на сервере.' }, 503);
  }

  if (session.userId !== configuredOwner) {
    return json({
      ok: true,
      eligible: false,
      userId: session.userId,
      copied: 0
    });
  }

  try {
    const sourceCountRow = await db.prepare(
      'SELECT COUNT(*) AS count FROM user_movies WHERE user_id = ?'
    ).bind(SOURCE_USER_ID).first();
    const sourceCount = Number(sourceCountRow?.count || 0);

    const targetBeforeRow = await db.prepare(
      'SELECT COUNT(*) AS count FROM user_movies WHERE user_id = ?'
    ).bind(session.userId).first();
    const targetBefore = Number(targetBeforeRow?.count || 0);

    if (!sourceCount) {
      return json({
        ok: true,
        eligible: true,
        userId: session.userId,
        copied: 0,
        sourceCount: 0,
        targetBefore,
        targetAfter: targetBefore,
        sourcePreserved: true
      });
    }

    const rowsResult = await db.prepare(`
      SELECT
        kinopoisk_id, status, for_tonight, personal_rating, watched_at,
        added_at, selected_for_tonight_at, note, created_at, updated_at
      FROM user_movies
      WHERE user_id = ?
      ORDER BY kinopoisk_id ASC
    `).bind(SOURCE_USER_ID).all();

    const rows = rowsResult.results || [];
    for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
      const chunk = rows.slice(index, index + CHUNK_SIZE);
      await db.batch(chunk.map(row => copyRowStatement(db, session.userId, row)));
    }

    const targetAfterRow = await db.prepare(
      'SELECT COUNT(*) AS count FROM user_movies WHERE user_id = ?'
    ).bind(session.userId).first();
    const targetAfter = Number(targetAfterRow?.count || 0);

    return json({
      ok: true,
      eligible: true,
      userId: session.userId,
      copied: Math.max(0, targetAfter - targetBefore),
      sourceCount,
      targetBefore,
      targetAfter,
      sourcePreserved: true
    });
  } catch (error) {
    return json({
      error: 'Не удалось привязать старую кинотеку.',
      details: String(error?.message || error)
    }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: 'Method Not Allowed' }, 405);
}
