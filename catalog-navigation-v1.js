(() => {
  if (typeof renderCatalog !== 'function' || typeof applyCatalogPreset !== 'function') return;
  if (document.querySelector('#catalogBackToDiscovery')) return;

  const resultsBlock = document.querySelector('#catalogResultsBlock');
  const resultHead = resultsBlock?.querySelector('.result-head');
  if (!resultsBlock || !resultHead) return;

  const style = document.createElement('style');
  style.textContent = `
    .catalog-back-discovery{
      display:none;
      align-items:center;
      gap:7px;
      min-height:44px;
      margin:0 0 10px;
      padding:8px 10px;
      border:0;
      background:transparent;
      color:var(--text);
      font-weight:750;
      font-size:15px;
      -webkit-tap-highlight-color:transparent;
    }
    .catalog-back-discovery.show{display:inline-flex}
    .catalog-back-discovery:active{opacity:.65}
    .catalog-back-discovery .arrow{font-size:21px;line-height:1}
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'catalogBackToDiscovery';
  button.className = 'catalog-back-discovery';
  button.type = 'button';
  button.innerHTML = '<span class="arrow">←</span><span>Быстрый выбор</span>';
  resultsBlock.insertBefore(button, resultHead);

  let presetOrigin = null;
  const originalApplyCatalogPreset = applyCatalogPreset;
  applyCatalogPreset = async preset => {
    if (!activeCatalogPreset) {
      presetOrigin = {
        query: document.querySelector('#catalogSearchInput')?.value || '',
        filters: typeof catalogFilters !== 'undefined' ? structuredClone(catalogFilters) : null
      };
    }
    const result = await originalApplyCatalogPreset(preset);
    updateBackButton();
    return result;
  };

  const originalRenderCatalog = renderCatalog;
  renderCatalog = () => {
    const result = originalRenderCatalog();
    updateBackButton();
    return result;
  };

  function updateBackButton() {
    button.classList.toggle('show', Boolean(activeCatalogPreset));
  }

  button.addEventListener('click', () => {
    activeCatalogPreset = null;
    catalogResults = [];
    catalogLoading = false;

    if (presetOrigin?.filters && typeof catalogFilters !== 'undefined') {
      catalogFilters = structuredClone(presetOrigin.filters);
      if (typeof filters !== 'undefined') filters = catalogFilters;
    }
    const search = document.querySelector('#catalogSearchInput');
    if (search) search.value = presetOrigin?.query || '';
    document.querySelector('#clearCatalogSearch')?.classList.toggle('show', Boolean(search?.value));

    presetOrigin = null;
    renderCatalog();
    if (typeof loadCatalogStarter === 'function') loadCatalogStarter();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });

  updateBackButton();
})();
