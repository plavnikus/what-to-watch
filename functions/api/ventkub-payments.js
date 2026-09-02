const GAS_URL = 'https://script.google.com/macros/s/AKfycbzoWuSLeDZAajNg13ZBH-R30Zv1LVFehYUaqH9lJBuSMpiFC7jm0k8kSucLiuv9AL04/exec';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: HEADERS
});

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const origin = request.headers.get('origin') || '';
    const host = new URL(request.url).origin;

    if (origin && origin !== host) {
      return json({ ok:false, error:'Недопустимый источник запроса.' }, 403);
    }

    const body = await request.json().catch(() => null);
    if (!body || !['getMonthSnapshot','savePayment'].includes(body.action)) {
      return json({ ok:false, error:'Некорректная команда API.' }, 400);
    }

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
