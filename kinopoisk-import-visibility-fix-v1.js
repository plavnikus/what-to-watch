(() => {
  const style = document.createElement('style');
  style.textContent = `
    #importOverlay .import-form[hidden],
    #importOverlay .import-progress[hidden],
    #importOverlay .import-status[hidden],
    #importOverlay .note[hidden],
    #importOverlay .enrichment-test[hidden],
    #quickChoiceBtn[hidden] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
})();
