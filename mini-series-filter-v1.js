(() => {
  if (typeof movies === 'undefined') return;

  const RULE_VERSION = 'mini-v3-1season-10episodes';
  const RULE_STORAGE_KEY = 'movieAppMiniSeriesRuleVersion';
  const REQUEST_TIMEOUT_MS = 12000;

  let loading = false;
  let ready = false;
  try {
    ready = localStorage.getItem(RULE_STORAGE_KEY) === RULE_VERSION;
  } catch {}

  const applyMiniIds = ids => {
    const set = new Set((Array.isArray(ids) ? ids : []).map(String));

    const update = movie => {
      if (!movie?.kinopoiskId) return;
      const id = String(movie.kinopoiskId);
      if (set.has(id)) {
        movie.type = 'mini';
      } else if (movie.type === 'mini') {
        movie.type = 'series';
      }
    };

    movies.forEach(update);
    if (typeof catalogResults !== 'undefined' && Array.isArray(catalogResults)) catalogResults.forEach(update);
    if (typeof catalogStarterItems !== 'undefined' && Array.isArray(catalogStarterItems)) catalogStarterItems.forEach(update);
    if (typeof persistImportedMovies === 'function') persistImportedMovies();
  };

  const refreshFilterUi = () => {
    if (typeof updateFilterSummary === 'function') updateFilterSummary();
    if (typeof renderLibrary === 'function' && document.querySelector('#library')?.classList.contains('active')) renderLibrary();
  };

  async function ensureMiniSeries() {
    if (ready) return true;
    if (loading) return false;
    loading = true;

    const button = document.querySelector('#typeOptions [data-value="mini"]');
    const preview = document.querySelector('#previewCount');
    const originalLabel = button?.textContent || 'Мини-сериалы';
    if (button) {
      button.disabled = true;
      button.textContent = 'Определяем…';
    }
    if (preview) preview.textContent = '…';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('/api/user-miniseries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store',
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось определить мини-сериалы.');

      applyMiniIds(data.miniIds);
      ready = true;
      try { localStorage.setItem(RULE_STORAGE_KEY, RULE_VERSION); } catch {}
      return true;
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Не удалось быстро определить мини-сериалы. Попробуйте ещё раз позже.'
        : (error.message || 'Не удалось определить мини-сериалы.');
      if (typeof showToast === 'function') showToast(message);
      return false;
    } finally {
      clearTimeout(timer);
      loading = false;
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
      refreshFilterUi();
    }
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('#typeOptions [data-value="mini"]');
    if (!button) return;
    if (typeof currentFilterContext !== 'undefined' && currentFilterContext !== 'library') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (typeof draft === 'undefined') return;
    const selected = Array.isArray(draft.types) && draft.types.includes('mini');
    if (selected) {
      draft.types = draft.types.filter(value => value !== 'mini');
      refreshFilterUi();
      return;
    }

    const ok = await ensureMiniSeries();
    if (!ok) return;
    if (!Array.isArray(draft.types)) draft.types = [];
    if (!draft.types.includes('mini')) draft.types = [...draft.types, 'mini'];
    refreshFilterUi();
  }, true);
})();
