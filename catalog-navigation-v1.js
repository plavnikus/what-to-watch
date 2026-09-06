(() => {
  if (typeof renderCatalog !== 'function' || typeof applyCatalogPreset !== 'function') return;
  if (document.querySelector('#catalogBackToDiscovery')) return;

  const resultsBlock = document.querySelector('#catalogResultsBlock');
  const resultHead = resultsBlock?.querySelector('.result-head');
  if (!resultsBlock || !resultHead) return;

  const style = document.createElement('style');
  style.textContent = `
    .catalog-back-discovery,
    .catalog-back-discovery-sticky{
      width:46px;
      height:46px;
      border:1px solid var(--line);
      border-radius:50%;
      display:grid;
      place-items:center;
      background:color-mix(in srgb,var(--panel) 94%,transparent);
      color:var(--text);
      backdrop-filter:blur(14px);
      font-size:28px;
      line-height:1;
      padding:0;
      -webkit-tap-highlight-color:transparent;
    }
    .catalog-back-discovery{
      display:none;
      margin:0 0 12px;
    }
    .catalog-back-discovery.show{display:grid}
    .catalog-back-discovery:active,
    .catalog-back-discovery-sticky:active{transform:scale(.96)}
    .catalog-back-discovery-sticky{
      position:fixed;
      z-index:24;
      top:76px;
      left:max(16px,calc(50% - 254px));
      opacity:0;
      pointer-events:none;
      transform:translateY(-8px);
      transition:opacity .16s ease,transform .16s ease;
      box-shadow:0 8px 24px rgba(0,0,0,.16);
    }
    .catalog-back-discovery-sticky.show{
      opacity:1;
      pointer-events:auto;
      transform:translateY(0);
    }
    @media(max-width:540px){.catalog-back-discovery-sticky{left:16px}}
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'catalogBackToDiscovery';
  button.className = 'catalog-back-discovery';
  button.type = 'button';
  button.setAttribute('aria-label', 'Назад к быстрому выбору');
  button.textContent = '‹';
  resultsBlock.insertBefore(button, resultHead);

  const stickyButton = document.createElement('button');
  stickyButton.id = 'catalogBackToDiscoverySticky';
  stickyButton.className = 'catalog-back-discovery-sticky';
  stickyButton.type = 'button';
  stickyButton.setAttribute('aria-label', 'Назад к быстрому выбору');
  stickyButton.textContent = '‹';
  document.body.appendChild(stickyButton);

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
    updateButtons();
    return result;
  };

  const originalRenderCatalog = renderCatalog;
  renderCatalog = () => {
    const result = originalRenderCatalog();
    updateButtons();
    return result;
  };

  function updateButtons() {
    const active = Boolean(activeCatalogPreset) && document.querySelector('#catalog')?.classList.contains('active');
    button.classList.toggle('show', active);
    if (!active) {
      stickyButton.classList.remove('show');
      return;
    }
    const rect = button.getBoundingClientRect();
    stickyButton.classList.toggle('show', rect.bottom < 76);
  }

  function returnToDiscovery() {
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
    stickyButton.classList.remove('show');
    renderCatalog();
    if (typeof loadCatalogStarter === 'function') loadCatalogStarter();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  button.addEventListener('click', returnToDiscovery);
  stickyButton.addEventListener('click', returnToDiscovery);
  window.addEventListener('scroll', updateButtons, { passive: true });
  window.addEventListener('resize', updateButtons, { passive: true });
  document.addEventListener('click', () => requestAnimationFrame(updateButtons));

  updateButtons();
})();
