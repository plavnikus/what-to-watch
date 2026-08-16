(() => {
  const overlay = document.querySelector('#importOverlay');
  const openImportButton = document.querySelector('#openImport');
  const input = document.querySelector('#kinopoiskImportUrl');
  const startButton = document.querySelector('#startKinopoiskImport');
  const form = overlay?.querySelector('.import-form');
  const status = document.querySelector('#importStatus');
  const progress = document.querySelector('#importProgress');
  const progressText = document.querySelector('#importProgressText');
  const oldNote = overlay?.querySelector('.import-form + .import-progress + .import-status + .note');
  const enrichmentTest = overlay?.querySelector('.enrichment-test');
  const sheetHeadTitle = overlay?.querySelector('.sheet-head h3');
  const sheetHeadNote = overlay?.querySelector('.sheet-head .note');

  if (!overlay || !openImportButton || !input || !startButton || !form) return;

  const PROFILE_PATTERN = /^\/user\/\d+\/?$/i;
  const LIST_PATTERN = /^\/user\/\d+\/movies\/list\/type\/\d+/i;
  let step = 1;
  let importing = false;

  const style = document.createElement('style');
  style.textContent = `
    .kp-onboarding{display:grid;gap:12px;margin:8px 0 14px}
    .kp-step{border:1px solid var(--line);background:var(--panel2);border-radius:18px;padding:16px}
    .kp-step-kicker{font-size:12px;font-weight:800;color:var(--accent);margin-bottom:7px}
    .kp-step h4{font-size:19px;line-height:1.25;margin:0 0 7px}
    .kp-step p{margin:0;color:var(--muted);line-height:1.45}
    .kp-step-actions{display:grid;gap:8px;margin-top:14px}
    .kp-import-help{font-size:12px;color:var(--muted);line-height:1.45;margin:8px 2px 0}
    .kp-empty-card{padding:18px}
    .kp-empty-card h3{font-size:20px;margin-bottom:6px}
    .kp-empty-card p{margin-bottom:14px;line-height:1.45}
    .kp-done{text-align:center;padding:8px 0 2px}
    .kp-done-icon{font-size:38px;margin-bottom:8px}
    .kp-done strong{display:block;font-size:22px;margin-bottom:6px}
  `;
  document.head.appendChild(style);

  if (sheetHeadTitle) sheetHeadTitle.textContent = 'Добавить фильмы из Кинопоиска';
  if (sheetHeadNote) sheetHeadNote.textContent = 'Перенесём ваш список «Буду смотреть»';
  if (oldNote) oldNote.hidden = true;
  if (enrichmentTest) enrichmentTest.hidden = true;

  const oldSample = /\/user\/1555709\/movies\/list\/type\/3575/i;
  if (oldSample.test(input.value)) input.value = '';
  input.placeholder = 'https://www.kinopoisk.ru/user/1234567/';
  input.setAttribute('aria-label', 'Ссылка на профиль Кинопоиска');
  startButton.textContent = 'Добавить мои фильмы';

  const guide = document.createElement('div');
  guide.id = 'kinopoiskImportOnboarding';
  guide.className = 'kp-onboarding';
  form.parentNode.insertBefore(guide, form);

  function isSupportedUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (!/(^|\.)kinopoisk\.ru$/i.test(url.hostname)) return false;
      return PROFILE_PATTERN.test(url.pathname) || LIST_PATTERN.test(url.pathname);
    } catch {
      return false;
    }
  }

  function setStatus(message, isError = false) {
    if (typeof setImportStatus === 'function') {
      setImportStatus(message, isError);
      return;
    }
    if (!status) return;
    status.textContent = message;
    status.classList.add('show');
    status.classList.toggle('error', isError);
  }

  function setBusy(value, message = 'Добавляем ваши фильмы…') {
    importing = value;
    if (typeof setImportLoading === 'function') setImportLoading(value, message);
    startButton.disabled = value;
  }

  function renderStep(nextStep) {
    step = nextStep;
    status?.classList.remove('show', 'error');
    progress?.classList.remove('show');
    form.hidden = step !== 3;

    if (step === 1) {
      guide.innerHTML = `
        <div class="kp-step">
          <div class="kp-step-kicker">Шаг 1 из 3</div>
          <h4>Откройте свой профиль в Кинопоиске</h4>
          <p>Откройте Кинопоиск и перейдите на страницу своего профиля.</p>
          <div class="kp-step-actions">
            <button type="button" class="btn primary full" data-kp-next="2">Профиль открыт</button>
          </div>
        </div>`;
      return;
    }

    if (step === 2) {
      guide.innerHTML = `
        <div class="kp-step">
          <div class="kp-step-kicker">Шаг 2 из 3</div>
          <h4>Скопируйте ссылку на профиль</h4>
          <p>Нажмите <strong>«Поделиться профилем»</strong>, затем <strong>«Скопировать ссылку»</strong>.</p>
          <div class="kp-step-actions">
            <button type="button" class="btn primary full" data-kp-next="3">Ссылка скопирована</button>
            <button type="button" class="btn secondary full" data-kp-next="1">Назад</button>
          </div>
        </div>`;
      return;
    }

    guide.innerHTML = `
      <div class="kp-step">
        <div class="kp-step-kicker">Шаг 3 из 3</div>
        <h4>Вставьте ссылку сюда</h4>
        <p>Вернитесь в приложение и вставьте скопированную ссылку на профиль.</p>
      </div>`;
    form.hidden = false;
    if (!input.value) input.focus();
    let helper = form.querySelector('.kp-import-help');
    if (!helper) {
      helper = document.createElement('div');
      helper.className = 'kp-import-help';
      helper.textContent = 'Ссылка выглядит примерно так: kinopoisk.ru/user/1234567/';
      form.appendChild(helper);
    }
  }

  function renderDone(result) {
    form.hidden = true;
    progress?.classList.remove('show');
    status?.classList.remove('show', 'error');
    guide.innerHTML = `
      <div class="kp-step kp-done">
        <div class="kp-done-icon">🍿</div>
        <strong>Готово!</strong>
        <p>Добавили ${result.added} ${result.added === 1 ? 'фильм' : 'фильмов'} в «Хочу посмотреть»${result.skipped ? `. Ещё ${result.skipped} уже были в вашей кинотеке.` : '.'}</p>
        <div class="kp-step-actions">
          <button type="button" class="btn primary full" data-kp-view-library="1">Посмотреть мои фильмы</button>
        </div>
      </div>`;
  }

  async function fetchLibrary() {
    const response = await fetch('/api/user-library', {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось открыть личную кинотеку.');
    return data;
  }

  async function bulkImportToCurrentUser(rawItems) {
    const before = await fetchLibrary();
    const existing = new Set((before.items || []).map(item => String(item.kinopoiskId || '')));

    const unique = new Map();
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
      const movie = normalizeImportedMovie(raw);
      if (movie?.kinopoiskId) unique.set(String(movie.kinopoiskId), movie);
    }

    const newMovies = [...unique.values()].filter(movie => !existing.has(String(movie.kinopoiskId)));
    const payload = newMovies.map(movie => ({
      kinopoiskId: String(movie.kinopoiskId),
      status: 'watchlist',
      forTonight: false,
      personalRating: null,
      watchedAt: null,
      movie: libraryMovieSeed(movie)
    }));

    for (let offset = 0; offset < payload.length; offset += 1000) {
      const chunk = payload.slice(offset, offset + 1000);
      const response = await fetch('/api/user-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        body: JSON.stringify({ items: chunk })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось добавить фильмы в вашу кинотеку.');
    }

    const after = await fetchLibrary();
    applyServerLibrary(after.items || []);

    return {
      added: newMovies.length,
      skipped: unique.size - newMovies.length,
      total: unique.size
    };
  }

  async function startProfileImport() {
    if (importing) return;
    const url = input.value.trim();
    if (!url) {
      setStatus('Вставьте ссылку на свой профиль Кинопоиска.', true);
      return;
    }
    if (!isSupportedUrl(url)) {
      setStatus('Не получилось распознать ссылку. Нужна ссылка на ваш профиль вида kinopoisk.ru/user/1234567/.', true);
      return;
    }

    setBusy(true, 'Добавляем ваши фильмы…');
    status?.classList.remove('show', 'error');

    try {
      const session = await runSequentialImport(url);
      setBusy(true, `Сохраняем ${session.items.length} фильмов в вашу кинотеку…`);
      const result = await bulkImportToCurrentUser(session.items);
      clearImportSession();
      setBusy(false);
      renderDone(result);
      if (typeof showToast === 'function') showToast(`Добавлено ${result.added} фильмов`);
      refreshEmptyLibraryState();
    } catch (error) {
      setBusy(false);
      setStatus(String(error?.message || error || 'Не удалось импортировать фильмы.'), true);
    }
  }

  const progressObserver = new MutationObserver(() => {
    if (!importing || !progressText) return;
    const text = progressText.textContent || '';
    const foundMatch = text.match(/найдено\s+(\d+)/i);
    if (foundMatch) {
      progressText.textContent = `Добавляем ваши фильмы… Уже нашли ${foundMatch[1]}`;
      return;
    }
    if (/Cloudflare просит подождать/i.test(text)) {
      progressText.textContent = 'Небольшая пауза… Продолжаем автоматически.';
    }
  });
  if (progressText) progressObserver.observe(progressText, { childList: true, characterData: true, subtree: true });

  document.addEventListener('click', event => {
    const next = event.target.closest('[data-kp-next]');
    if (next) {
      event.preventDefault();
      renderStep(Number(next.dataset.kpNext));
      return;
    }

    const viewLibrary = event.target.closest('[data-kp-view-library]');
    if (viewLibrary) {
      event.preventDefault();
      if (typeof closeOverlay === 'function') closeOverlay('importOverlay');
      if (typeof go === 'function') go('library', { behavior: 'auto' });
      return;
    }

    const targetStart = event.target.closest('#startKinopoiskImport');
    if (targetStart) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startProfileImport();
    }
  }, true);

  openImportButton.addEventListener('click', () => {
    const session = typeof readImportSession === 'function' ? readImportSession() : null;
    if (session && !session.completed && session.nextPage > 1) {
      renderStep(3);
      input.value = session.url || input.value;
      setStatus(`Продолжим импорт с того места, где остановились. Уже нашли ${session.items?.length || 0} фильмов.`);
    } else {
      renderStep(1);
    }
  });

  function emptyCardHtml(scope) {
    return `
      <div class="card kp-empty-card" data-kp-empty="${scope}">
        <h3>Добавьте свои фильмы</h3>
        <p class="muted">Скопируйте ссылку на профиль Кинопоиска — список «Буду смотреть» перенесём сами.</p>
        <button type="button" class="btn primary full" data-kp-open-import="1">Добавить из Кинопоиска</button>
      </div>`;
  }

  async function refreshEmptyLibraryState() {
    let empty = false;
    try {
      const data = await fetchLibrary();
      empty = !(data.items || []).some(item => item.status && item.status !== 'none');
    } catch {
      empty = !movies.some(movie => movie.kinopoiskId && states[movie.id] && states[movie.id].status !== 'none');
    }

    const home = document.querySelector('#home');
    const library = document.querySelector('#library');
    const quickChoice = document.querySelector('#quickChoiceBtn');

    document.querySelectorAll('[data-kp-empty]').forEach(node => node.remove());

    if (!empty) {
      if (quickChoice) quickChoice.hidden = false;
      return;
    }

    if (quickChoice) quickChoice.hidden = true;

    const hero = home?.querySelector('.hero');
    if (hero) hero.insertAdjacentHTML('afterend', emptyCardHtml('home'));

    const resultHead = library?.querySelector('.result-head');
    if (resultHead) resultHead.insertAdjacentHTML('afterend', emptyCardHtml('library'));
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-kp-open-import]');
    if (!button) return;
    event.preventDefault();
    openImportButton.click();
  });

  renderStep(1);
  setTimeout(refreshEmptyLibraryState, 700);
})();
