import { authenticateTelegramRequest } from '../lib/telegram-auth.js';
import { createTelegramSession, telegramSessionCookie } from '../lib/telegram-session.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...JSON_HEADERS, ...extraHeaders }
});

export async function onRequestPost(context) {
  try {
    const auth = await authenticateTelegramRequest(context);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status || 401);

    const token = await createTelegramSession(auth.userId, context.env.TELEGRAM_BOT_TOKEN, context.env);
    return json({
      ok: true,
      userId: auth.userId,
      user: auth.user
    }, 200, {
      'set-cookie': telegramSessionCookie(token, context.env)
    });
  } catch (error) {
    return json({ ok: false, error: 'Не удалось создать пользовательскую сессию.', details: String(error?.message || error) }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: 'Method Not Allowed' }, 405);
}
