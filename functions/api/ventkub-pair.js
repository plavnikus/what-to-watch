const TOKEN_SHA256 = '190dd78d4f04de20ebc37b272bf5556fc8f4d2a79d0d73a3cde42d85751685d3';
const COOKIE_NAME = 'vkp_access';

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const code = String(requestUrl.searchParams.get('code') || '').trim();

  if (!code || await sha256Hex(code) !== TOKEN_SHA256) {
    return new Response('Неверный код доступа.', {
      status: 401,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      }
    });
  }

  const cookie = `${COOKIE_NAME}=${encodeURIComponent(code)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`;
  return new Response(null, {
    status: 302,
    headers: {
      'location': '/ventkub-payments/',
      'set-cookie': cookie,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer'
    }
  });
}

export async function onRequestPost() {
  return new Response('Method Not Allowed', { status: 405 });
}
