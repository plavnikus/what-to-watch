(() => {
  if (typeof movies === 'undefined') return;

  const normalizeGenre = value => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');

  const normalizeGenreList = values => {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const genre = normalizeGenre(value);
      if (!genre || seen.has(genre)) continue;
      seen.add(genre);
      result.push(genre);
    }
    return result;
  };

  const normalizeMovieGenres = movie => {
    if (!movie || typeof movie !== 'object') return movie;
    movie.genres = normalizeGenreList(movie.genres);
    return movie;
  };

  const normalizeFilterGenres = filter => {
    if (filter && Array.isArray(filter.genres)) filter.genres = normalizeGenreList(filter.genres);
  };

  const rebuildGenres = () => {
    movies.forEach(normalizeMovieGenres);
    if (typeof catalogResults !== 'undefined' && Array.isArray(catalogResults)) {
      catalogResults.forEach(normalizeMovieGenres);
    }
    normalizeFilterGenres(typeof libraryFilters !== 'undefined' ? libraryFilters : null);
    normalizeFilterGenres(typeof catalogFilters !== 'undefined' ? catalogFilters : null);
    normalizeFilterGenres(typeof draft !== 'undefined' ? draft : null);
    if (typeof draftGenres !== 'undefined') draftGenres = normalizeGenreList(draftGenres);

    genres = [...new Set(movies.flatMap(movie => movie.genres || []))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
  };

  rebuildGenres();

  // Normalize every future movie entering the frontend model as well.
  if (typeof normalizeImportedMovie === 'function') {
    const originalNormalizeImportedMovie = normalizeImportedMovie;
    normalizeImportedMovie = item => normalizeMovieGenres(originalNormalizeImportedMovie(item));
  }

  if (typeof applyServerLibrary === 'function') {
    const originalApplyServerLibrary = applyServerLibrary;
    applyServerLibrary = items => {
      const result = originalApplyServerLibrary(items);
      rebuildGenres();
      if (typeof renderLibrary === 'function') renderLibrary();
      if (typeof renderCatalog === 'function') renderCatalog();
      return result;
    };
  }

  if (typeof mergeEnrichedMovie === 'function') {
    const originalMergeEnrichedMovie = mergeEnrichedMovie;
    mergeEnrichedMovie = data => {
      const result = originalMergeEnrichedMovie(data);
      const id = String(data?.kinopoiskId || '');
      const movie = movies.find(item => String(item.kinopoiskId || '') === id);
      normalizeMovieGenres(movie);
      rebuildGenres();
      return result;
    };
  }

  if (typeof ensureCatalogMovieLocal === 'function') {
    const originalEnsureCatalogMovieLocal = ensureCatalogMovieLocal;
    ensureCatalogMovieLocal = movie => {
      const local = originalEnsureCatalogMovieLocal(normalizeMovieGenres(movie));
      normalizeMovieGenres(local);
      rebuildGenres();
      return local;
    };
  }

  if (typeof renderGenreList === 'function') {
    const originalRenderGenreList = renderGenreList;
    renderGenreList = () => {
      rebuildGenres();
      return originalRenderGenreList();
    };
  }

  // iOS/Telegram WebView can override SPA scroll restoration after history.back().
  // We own navigation state, so browser-native restoration must not fight it.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  if (typeof openMovie === 'function') {
    const originalOpenMovie = openMovie;
    openMovie = id => {
      const screen = typeof activeScreenId === 'function' ? activeScreenId() : 'home';
      let sourceCard = null;
      if (screen === 'library') sourceCard = document.querySelector(`[data-open="${id}"]`);
      if (screen === 'catalog') sourceCard = document.querySelector(`[data-catalog-open="${id}"]`);

      const snapshot = {
        screen,
        scrollY: window.scrollY,
        anchorId: id,
        anchorTop: sourceCard ? sourceCard.getBoundingClientRect().top : null,
        activeTab: typeof activeTab !== 'undefined' ? activeTab : null,
        libraryFilters: typeof libraryFilters !== 'undefined' ? structuredClone(libraryFilters) : null,
        catalogFilters: typeof catalogFilters !== 'undefined' ? structuredClone(catalogFilters) : null,
        libraryQuery: document.querySelector('#searchInput')?.value || '',
        catalogQuery: document.querySelector('#catalogSearchInput')?.value || '',
        activeCatalogPreset: typeof activeCatalogPreset !== 'undefined' ? activeCatalogPreset : null
      };

      originalOpenMovie(id);
      if (typeof detailOrigin !== 'undefined' && detailOrigin) Object.assign(detailOrigin, snapshot);
    };
  }

  if (typeof performDetailReturn === 'function') {
    const originalPerformDetailReturn = performDetailReturn;
    performDetailReturn = () => {
      const origin = typeof detailOrigin !== 'undefined' && detailOrigin
        ? structuredClone(detailOrigin)
        : { screen: 'library', scrollY: 0 };

      if (origin.activeTab && typeof activeTab !== 'undefined') activeTab = origin.activeTab;
      if (origin.libraryFilters && typeof libraryFilters !== 'undefined') libraryFilters = structuredClone(origin.libraryFilters);
      if (origin.catalogFilters && typeof catalogFilters !== 'undefined') catalogFilters = structuredClone(origin.catalogFilters);
      if (typeof activeCatalogPreset !== 'undefined') activeCatalogPreset = origin.activeCatalogPreset || null;

      originalPerformDetailReturn();

      const restorePosition = () => {
        const targetY = Math.max(0, Number(origin.scrollY) || 0);
        window.scrollTo({ top: targetY, behavior: 'auto' });

        let sourceCard = null;
        if (origin.screen === 'library' && origin.anchorId) {
          sourceCard = document.querySelector(`[data-open="${origin.anchorId}"]`);
        } else if (origin.screen === 'catalog' && origin.anchorId) {
          sourceCard = document.querySelector(`[data-catalog-open="${origin.anchorId}"]`);
        }

        if (sourceCard && Number.isFinite(origin.anchorTop)) {
          const delta = sourceCard.getBoundingClientRect().top - origin.anchorTop;
          if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'auto' });
        }
      };

      requestAnimationFrame(() => requestAnimationFrame(restorePosition));
      setTimeout(restorePosition, 100);
      setTimeout(restorePosition, 260);
    };
  }

  // Mini-series already exist as a data type/filter. Add the missing quick collection.
  if (typeof catalogPresetLabels !== 'undefined') catalogPresetLabels.mini = 'Мини-сериалы';
  const quickStrip = document.querySelector('.catalog-quick-strip');
  if (quickStrip && !quickStrip.querySelector('[data-catalog-preset="mini"]')) {
    const button = document.createElement('button');
    button.className = 'catalog-quick-chip';
    button.dataset.catalogPreset = 'mini';
    button.textContent = '📺 Мини-сериалы';
    button.addEventListener('click', () => {
      if (typeof applyCatalogPreset === 'function') applyCatalogPreset('mini');
    });
    quickStrip.appendChild(button);
  }

  if (typeof renderLibrary === 'function') renderLibrary();
  if (typeof renderCatalog === 'function') renderCatalog();
})();
