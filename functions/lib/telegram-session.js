const encoder = new TextEncoder();
const SESSION_COOKIE = 'wtw_session';
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;

const toBase64Url = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = value => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

const safeEqual = (left, right) => {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const sign = async (secret, value) => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
};

const parseCookies = request => Object.fromEntries(
  String(request.headers.get('cookie') || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=');
      return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
    })
);

const sessionTtl = env => {
  const configured = Number(env?.TELEGRAM_SESSION_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_SESSION_TTL_SECONDS;
};

export async function createTelegramSession(userId, botToken, env = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId: String(userId),
    issuedAt: now,
    expiresAt: now + sessionTtl(env)
  };
  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(botToken, payloadPart);
  return `${payloadPart}.${signature}`;
}

export async function verifyTelegramSession(request, botToken) {
  const token = parseCookies(request)[SESSION_COOKIE] || '';
  if (!token || !botToken) return { ok: false };

  const [payloadPart, receivedSignature] = token.split('.');
  if (!payloadPart || !receivedSignature) return { ok: false };

  const expectedSignature = await sign(botToken, payloadPart);
  if (!safeEqual(receivedSignature, expectedSignature)) return { ok: false };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart)));
  } catch {
    return { ok: false };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload?.userId || !Number.isFinite(payload?.expiresAt) || payload.expiresAt <= now) {
    return { ok: false };
  }

  return { ok: true, userId: String(payload.userId), expiresAt: payload.expiresAt };
}

export function telegramSessionCookie(token, env = {}) {
  const maxAge = sessionTtl(env);
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearTelegramSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
