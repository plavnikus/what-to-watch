(() => {
  if (typeof catalogPresetLabels !== 'undefined') {
    delete catalogPresetLabels.mini;
    catalogPresetLabels['short-series'] = 'Короткие сериалы';
  }

  const quickStrip = document.querySelector('.catalog-quick-strip');
  if (!quickStrip) return;

  const legacy = quickStrip.querySelector('[data-catalog-preset="mini"]');
  const existing = quickStrip.querySelector('[data-catalog-preset="short-series"]');
  if (existing) return;

  const button = document.createElement('button');
  button.className = legacy?.className || 'catalog-quick-chip';
  button.dataset.catalogPreset = 'short-series';
  button.textContent = '📺 Короткие сериалы';
  button.addEventListener('click', () => {
    if (typeof applyCatalogPreset === 'function') applyCatalogPreset('short-series');
  });

  if (legacy) legacy.replaceWith(button);
  else quickStrip.appendChild(button);
})();
