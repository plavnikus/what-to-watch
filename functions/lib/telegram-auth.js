const encoder = new TextEncoder();

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const FUTURE_SKEW_SECONDS = 5 * 60;

const toHex = buffer => Array.from(new Uint8Array(buffer))
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('');

const safeEqual = (left, right) => {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
};

const hmacSha256 = async (keyBytes, value) => {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(value));
};

const parseMaxAge = env => {
  const configured = Number(env?.TELEGRAM_AUTH_MAX_AGE_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_AGE_SECONDS;
};

export async function verifyTelegramInitData(initData, botToken, options = {}) {
  const raw = String(initData || '').trim();
  const token = String(botToken || '').trim();
  if (!raw) return { ok: false, status: 401, error: 'Telegram initData отсутствует.' };
  if (!token) return { ok: false, status: 503, error: 'Telegram-авторизация ещё не настроена на сервере.' };

  const params = new URLSearchParams(raw);
  const receivedHash = params.get('hash');
  if (!receivedHash) return { ok: false, status: 401, error: 'Telegram initData не содержит hash.' };

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), token);
  const calculatedHash = toHex(await hmacSha256(new Uint8Array(secretKey), dataCheckString));
  if (!safeEqual(calculatedHash, receivedHash)) {
    return { ok: false, status: 401, error: 'Не удалось подтвердить Telegram-сессию.' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, status: 401, error: 'Telegram initData не содержит корректный auth_date.' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = Number(options.maxAgeSeconds) || DEFAULT_MAX_AGE_SECONDS;
  if (authDate > nowSeconds + FUTURE_SKEW_SECONDS || nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, status: 401, error: 'Telegram-сессия устарела. Откройте приложение заново.' };
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    user = null;
  }
  if (!user || !user.id) {
    return { ok: false, status: 401, error: 'Telegram initData не содержит пользователя.' };
  }

  return {
    ok: true,
    authDate,
    user: {
      id: String(user.id),
      firstName: String(user.first_name || ''),
      lastName: String(user.last_name || ''),
      username: String(user.username || ''),
      languageCode: String(user.language_code || ''),
      photoUrl: String(user.photo_url || '')
    }
  };
}

export async function upsertTelegramUser(db, telegramUser) {
  const telegramUserId = String(telegramUser?.id || '').trim();
  if (!telegramUserId) throw new Error('Telegram user id is required.');

  const existing = await db.prepare(
    'SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1'
  ).bind(telegramUserId).first();

  const name = [telegramUser.firstName, telegramUser.lastName].filter(Boolean).join(' ').trim() || null;
  const username = telegramUser.username || null;
  const avatarUrl = telegramUser.photoUrl || null;

  if (existing?.id) {
    await db.prepare(`
      UPDATE users
      SET name = ?, username = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name, username, avatarUrl, existing.id).run();
    return String(existing.id);
  }

  const userId = `telegram:${telegramUserId}`;
  await db.prepare(`
    INSERT INTO users (
      id, telegram_user_id, name, username, avatar_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(userId, telegramUserId, name, username, avatarUrl).run();

  return userId;
}

export async function authenticateTelegramRequest(context) {
  const initData = context.request.headers.get('x-telegram-init-data') || '';
  const verified = await verifyTelegramInitData(
    initData,
    context.env.TELEGRAM_BOT_TOKEN,
    { maxAgeSeconds: parseMaxAge(context.env) }
  );

  if (!verified.ok) return verified;
  const db = context.env.MOVIES_DB;
  if (!db) return { ok: false, status: 503, error: 'Пользовательские данные временно недоступны.' };

  const userId = await upsertTelegramUser(db, verified.user);
  return { ...verified, userId };
}
