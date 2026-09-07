(() => {
  if (typeof movies === 'undefined') return;

  const canonicalGenre = value => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');

  const genreLabel = value => {
    const genre = canonicalGenre(value);
    if (!genre) return '';
    return genre.charAt(0).toLocaleUpperCase('ru-RU') + genre.slice(1);
  };

  const genreLineLabel = value => String(value || '')
    .split('·')
    .map(part => genreLabel(part))
    .filter(Boolean)
    .join(' · ');

  window.movieAppGenreLabel = genreLabel;

  function refreshGenreLines(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('.genre-line').forEach(line => {
      const next = genreLineLabel(line.textContent);
      if (next && line.textContent !== next) line.textContent = next;
    });
  }

  function refreshGenrePicker() {
    document.querySelectorAll('#genreList [data-genre]').forEach(button => {
      const label = button.querySelector('span:first-child');
      if (!label) return;
      const next = genreLabel(button.dataset.genre);
      if (next && label.textContent !== next) label.textContent = next;
    });
  }

  function refreshDetailGenre() {
    const spans = document.querySelectorAll('#detailMeta > span');
    if (spans.length < 2) return;
    const next = genreLineLabel(spans[1].textContent);
    if (next && spans[1].textContent !== next) spans[1].textContent = next;
  }

  function refreshGenreSummary() {
    const target = document.querySelector('#genreValue');
    if (!target || typeof draft === 'undefined') return;
    const selected = Array.isArray(draft?.genres) ? draft.genres : [];
    target.textContent = selected.length
      ? `${genreLabel(selected[0])}${selected.length > 1 ? ` +${selected.length - 1}` : ''} ›`
      : 'Не выбраны ›';
  }

  if (typeof filterItems === 'function') {
    const originalFilterItems = filterItems;
    filterItems = (filter, defaultRating = 6) => {
      const items = originalFilterItems(filter, defaultRating);
      return items.map(([key, value]) => {
        if (key !== 'genres') return [key, value];
        const selected = Array.isArray(filter?.genres) ? filter.genres : [];
        if (!selected.length) return [key, value];
        return [key, `${genreLabel(selected[0])}${selected.length > 1 ? ` +${selected.length - 1}` : ''}`];
      });
    };
  }

  if (typeof updateFilterSummary === 'function') {
    const originalUpdateFilterSummary = updateFilterSummary;
    updateFilterSummary = () => {
      const result = originalUpdateFilterSummary();
      refreshGenreSummary();
      return result;
    };
  }

  if (typeof renderGenreList === 'function') {
    const originalRenderGenreList = renderGenreList;
    renderGenreList = () => {
      const result = originalRenderGenreList();
      refreshGenrePicker();
      return result;
    };
  }

  if (typeof renderLibrary === 'function') {
    const originalRenderLibrary = renderLibrary;
    renderLibrary = () => {
      const result = originalRenderLibrary();
      refreshGenreLines(document.querySelector('#movieList'));
      return result;
    };
  }

  if (typeof renderCatalog === 'function') {
    const originalRenderCatalog = renderCatalog;
    renderCatalog = () => {
      const result = originalRenderCatalog();
      refreshGenreLines(document.querySelector('#catalogList'));
      return result;
    };
  }

  if (typeof renderCatalogStarter === 'function') {
    const originalRenderCatalogStarter = renderCatalogStarter;
    renderCatalogStarter = () => {
      const result = originalRenderCatalogStarter();
      refreshGenreLines(document.querySelector('#catalogStarterList'));
      return result;
    };
  }

  if (typeof renderDetail === 'function') {
    const originalRenderDetail = renderDetail;
    renderDetail = () => {
      const result = originalRenderDetail();
      refreshDetailGenre();
      return result;
    };
  }

  if (typeof renderSimilarMovies === 'function') {
    const originalRenderSimilarMovies = renderSimilarMovies;
    renderSimilarMovies = movie => {
      const result = originalRenderSimilarMovies(movie);
      refreshGenreLines(document.querySelector('#similarList'));
      return result;
    };
  }

  refreshGenrePicker();
  refreshGenreSummary();
  refreshGenreLines(document.querySelector('#movieList'));
  refreshGenreLines(document.querySelector('#catalogList'));
  refreshGenreLines(document.querySelector('#catalogStarterList'));
  refreshDetailGenre();
})();
