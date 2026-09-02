const GAS_URL = 'https://script.google.com/macros/s/AKfycbzoWuSLeDZAajNg13ZBH-R30Zv1LVFehYUaqH9lJBuSMpiFC7jm0k8kSucLiuv9AL04/exec';
const TOKEN_SHA256 = '190dd78d4f04de20ebc37b272bf5556fc8f4d2a79d0d73a3cde42d85751685d3';
const COOKIE_NAME = 'vkp_access';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: HEADERS
});

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); }
    catch { return part.slice(i + 1).trim(); }
  }
  return '';
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const origin = request.headers.get('origin') || '';
    const host = new URL(request.url).origin;

    if (origin && origin !== host) {
      return json({ ok:false, error:'Недопустимый источник запроса.' }, 403);
    }

    const token = readCookie(request, COOKIE_NAME);
    if (!token || await sha256Hex(token) !== TOKEN_SHA256) {
      return json({ ok:false, error:'Требуется доступ к приложению.', needsPairing:true }, 401);
    }

    const body = await request.json().catch(() => null);
    if (!body || !['getMonthSnapshot','savePayment'].includes(body.action)) {
      return json({ ok:false, error:'Некорректная команда API.' }, 400);
    }

    body.token = token;

    const upstream = await fetch(GAS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'accept': 'application/json'
      },
      body: JSON.stringify(body),
      redirect: 'follow'
    });

    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return json({
        ok:false,
        error:'Apps Script вернул не JSON.',
        upstreamStatus: upstream.status
      }, 502);
    }

    if (!data || data.ok === false) {
      return json({
        ok:false,
        error:(data && data.error) || 'Ошибка Apps Script.'
      }, 502);
    }

    return json(data, 200);
  } catch (error) {
    return json({
      ok:false,
      error:String(error?.message || error || 'Ошибка прокси.')
    }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok:false, error:'Method Not Allowed' }, 405);
}
