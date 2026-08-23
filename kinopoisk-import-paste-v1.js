(() => {
  const input = document.querySelector('#kinopoiskImportUrl');
  const startButton = document.querySelector('#startKinopoiskImport');
  const guide = document.querySelector('#kinopoiskImportOnboarding');
  const form = input?.closest('.import-form');
  if (!input || !startButton || !guide || !form) return;

  const pasteButton = document.createElement('button');
  pasteButton.type = 'button';
  pasteButton.className = 'btn primary full';
  pasteButton.textContent = 'Вставить ссылку';
  pasteButton.hidden = true;
  input.insertAdjacentElement('afterend', pasteButton);

  function onStepThree() {
    return /Шаг 3 из 3/i.test(guide.querySelector('.kp-step-kicker')?.textContent || '');
  }

  function updateStepThree() {
    if (!onStepThree()) {
      pasteButton.hidden = true;
      return;
    }

    const description = guide.querySelector('.kp-step p');
    if (description) description.textContent = 'Вставьте скопированную ссылку на профиль.';

    const hasValue = Boolean(input.value.trim());
    pasteButton.hidden = hasValue;
    startButton.hidden = !hasValue;
  }

  input.addEventListener('input', updateStepThree);

  pasteButton.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (!text) throw new Error('clipboard-empty');
      input.value = text.trim();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    } catch {
      input.focus();
      if (typeof window.setImportStatus === 'function') {
        window.setImportStatus('Не получилось вставить автоматически. Нажмите и удерживайте поле, затем выберите «Вставить».');
      }
    }
  });

  const observer = new MutationObserver(updateStepThree);
  observer.observe(guide, { childList: true, subtree: true });
  updateStepThree();
})();
