(() => {
  const load = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });

  (async () => {
    try {
      await load('/kinopoisk-import-onboarding-v1.js?v=pr16-5');
      await load('/kinopoisk-import-finalize-v1.js?v=pr16-5');
      await load('/kinopoisk-import-visibility-fix-v1.js?v=pr16-5');
      await load('/kinopoisk-import-paste-v1.js?v=pr16-5');

      const originalSetImportLoading = window.setImportLoading;
      if (typeof originalSetImportLoading === 'function') {
        window.setImportLoading = (loading, message = 'Добавляем ваши фильмы…') => {
          originalSetImportLoading(loading, message);
          const button = document.querySelector('#startKinopoiskImport');
          if (button) button.textContent = loading ? 'Добавляем…' : 'Добавить мои фильмы';
        };
      }
    } catch (error) {
      console.error('Kinopoisk import onboarding failed to load', error);
    }

    try {
      await load('/quick-choice-v2.js?v=pr15-final');
      await load('/quick-choice-genre-labels-v1.js?v=pr15-final');
      await load('/quick-choice-restart-v1.js?v=pr15-final');
    } catch (error) {
      console.error('Quick choice failed to load', error);
    }
  })();
})();
