(() => {
  if (typeof movies === 'undefined') return;

  let loading = false;
  let ready = false;
  let shortSeriesIds = new Set();
  const REQUEST_TIMEOUT_MS = 15000;

  // Старое экспериментальное `mini` больше не является типом фильма.
  const normalizeLegacyMiniType = movie => {
    if (movie && movie.type === 'mini') movie.type = 'series';
  };
  movies.forEach(normalizeLegacyMiniType);
  if (typeof catalogResults !== 'undefined' && Array.isArray(catalogResults)) catalogResults.forEach(normalizeLegacyMiniType);
  if (typeof catalogStarterItems !== 'undefined' && Array.isArray(catalogStarterItems)) catalogStarterItems.forEach(normalizeLegacyMiniType);

  const typeButton = document.querySelector('#typeOptions [data-value="mini"]');
  if (typeButton) {
    typeButton.dataset.value = 'short-series';
    typeButton.textContent = 'Короткие сериалы';
  }

  if (typeof visibleMovies === 'function') {
    const originalVisibleMovies = visibleMovies;
    visibleMovies = (filter = libraryFilters) => {
      const types = Array.isArray(filter?.types) ? filter.types : [];
      if (!types.includes('short-series')) return originalVisibleMovies(filter);

      const ordinaryTypes = types.filter(type => type !== 'short-series');
      const withoutTypeFilter = { ...filter, types: [] };
      const candidates = originalVisibleMovies(withoutTypeFilter);

      return candidates.filter(movie => {
        const shortMatch = shortSeriesIds.has(String(movie?.kinopoiskId || ''));
        const ordinaryMatch = ordinaryTypes.includes(movie?.type);
        return shortMatch || ordinaryMatch;
      });
    };
  }

  if (typeof filterItems === 'function') {
    const originalFilterItems = filterItems;
    filterItems = (filter, defaultRating = 6) => {
      const items = originalFilterItems(filter, defaultRating);
      return items.map(([key, value]) => {
        if (key !== 'types' || !Array.isArray(filter?.types)) return [key, value];
        const labels = filter.types.map(type => {
          if (type === 'short-series') return 'Короткие сериалы';
          if (type === 'film') return 'Фильм';
          if (type === 'series') return 'Сериал';
          return String(type);
        });
        return [key, labels.join(', ')];
      });
    };
  }

  const refreshFilterUi = () => {
    if (typeof updateFilterSummary === 'function') updateFilterSummary();
    if (typeof renderLibrary === 'function' && document.querySelector('#library')?.classList.contains('active')) renderLibrary();
  };

  async function ensureShortSeries() {
    if (ready) return true;
    if (loading) return false;
    loading = true;

    const button = document.querySelector('#typeOptions [data-value="short-series"]');
    const preview = document.querySelector('#previewCount');
    if (button) {
      button.disabled = true;
      button.textContent = 'Определяем…';
    }
    if (preview) preview.textContent = '…';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('/api/user-short-series', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store',
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось определить короткие сериалы.');

      shortSeriesIds = new Set((Array.isArray(data.shortSeriesIds) ? data.shortSeriesIds : []).map(String));
      ready = true;
      return true;
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Не удалось быстро определить короткие сериалы. Попробуйте ещё раз позже.'
        : (error.message || 'Не удалось определить короткие сериалы.');
      if (typeof showToast === 'function') showToast(message);
      return false;
    } finally {
      clearTimeout(timer);
      loading = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Короткие сериалы';
      }
      refreshFilterUi();
    }
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('#typeOptions [data-value="short-series"]');
    if (!button) return;
    if (typeof currentFilterContext !== 'undefined' && currentFilterContext !== 'library') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (typeof draft === 'undefined') return;
    const selected = Array.isArray(draft.types) && draft.types.includes('short-series');
    if (selected) {
      draft.types = draft.types.filter(value => value !== 'short-series');
      refreshFilterUi();
      return;
    }

    const ok = await ensureShortSeries();
    if (!ok) return;
    if (!Array.isArray(draft.types)) draft.types = [];
    if (!draft.types.includes('short-series')) draft.types = [...draft.types, 'short-series'];
    refreshFilterUi();
  }, true);
})();
