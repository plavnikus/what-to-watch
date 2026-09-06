(() => {
  if (typeof movies === 'undefined') return;

  let loading = false;
  let ready = false;

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

    try {
      const response = await fetch('/api/user-miniseries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось определить мини-сериалы.');

      applyMiniIds(data.miniIds);
      ready = true;
      return true;
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message || 'Не удалось определить мини-сериалы.');
      return false;
    } finally {
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
