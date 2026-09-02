(() => {
  const STORAGE_TOKEN_KEY = 'ventkub-payments-api-token';
  const API_PATH = '/api/ventkub-payments';
  const nativeFetch = window.fetch.bind(window);

  function getToken() {
    let token = String(localStorage.getItem(STORAGE_TOKEN_KEY) || '').trim();
    if (!token) {
      token = String(window.prompt('Введите код доступа к оплатам') || '').trim();
      if (token) localStorage.setItem(STORAGE_TOKEN_KEY, token);
    }
    return token;
  }

  window.fetch = async function(resource, options) {
    const url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
    if (!url.includes(API_PATH)) return nativeFetch(resource, options);

    const token = getToken();
    if (!token) throw new Error('Нужен код доступа к оплатам.');

    const nextOptions = Object.assign({}, options || {});
    let body = {};
    try { body = nextOptions.body ? JSON.parse(nextOptions.body) : {}; } catch (e) { body = {}; }
    body.token = token;
    nextOptions.body = JSON.stringify(body);

    const response = await nativeFetch(resource, nextOptions);
    if (response.status === 401) localStorage.removeItem(STORAGE_TOKEN_KEY);
    return response;
  };
})();
