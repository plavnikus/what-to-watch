(() => {
  const originalRunSequentialImport = window.runSequentialImport;
  if (typeof originalRunSequentialImport !== 'function') return;

  window.runSequentialImport = async function runSequentialImportWithFinalPageFallback(url) {
    try {
      return await originalRunSequentialImport(url);
    } catch (error) {
      const session = typeof window.readImportSession === 'function'
        ? window.readImportSession()
        : null;
      const message = String(error?.message || error || '');
      const finalPage = Boolean(
        session &&
        Number(session.totalPages) > 0 &&
        Number(session.nextPage) >= Number(session.totalPages)
      );
      const emptyFinalPage = /страница\s+\d+\s+дважды\s+загрузилась\s+без\s+фильмов/i.test(message);
      const hasSavedMovies = Array.isArray(session?.items) && session.items.length > 0;

      if (!finalPage || !emptyFinalPage || !hasSavedMovies) throw error;

      const expected = Math.max(0, Number(session.totalExpected) || 0);
      const found = session.items.length;
      const unresolved = expected ? Math.max(0, expected - found) : 0;

      session.completed = true;
      session.completedWithMissing = unresolved > 0;
      session.unresolved = unresolved;
      if (typeof window.saveImportSession === 'function') window.saveImportSession(session);

      window.__kpPartialImportResult = { found, unresolved };
      return session;
    }
  };

  const guide = document.querySelector('#kinopoiskImportOnboarding');
  if (!guide) return;

  const observer = new MutationObserver(() => {
    const partial = window.__kpPartialImportResult;
    if (!partial) return;
    const paragraph = guide.querySelector('.kp-done p');
    if (!paragraph || paragraph.dataset.partialImportNote === '1') return;

    paragraph.dataset.partialImportNote = '1';
    if (partial.unresolved > 0) {
      paragraph.textContent += ` Не удалось распознать ещё ${partial.unresolved} из списка Кинопоиска.`;
    }
  });

  observer.observe(guide, { childList: true, subtree: true });
})();
