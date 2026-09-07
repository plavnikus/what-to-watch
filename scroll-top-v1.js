(() => {
  if (document.querySelector('#scrollToTopBtn')) return;

  const style = document.createElement('style');
  style.textContent = `
    .scroll-to-top{
      position:fixed;
      right:max(18px,calc(50% - 252px));
      bottom:calc(76px + env(safe-area-inset-bottom));
      z-index:26;
      width:46px;
      height:46px;
      border:1px solid var(--line);
      border-radius:50%;
      display:grid;
      place-items:center;
      background:color-mix(in srgb,var(--panel) 94%,transparent);
      color:var(--text);
      box-shadow:0 8px 24px rgba(0,0,0,.18);
      backdrop-filter:blur(14px);
      opacity:0;
      pointer-events:none;
      transform:translateY(8px) scale(.96);
      transition:opacity .16s ease,transform .16s ease;
      -webkit-tap-highlight-color:transparent;
    }
    .scroll-to-top.show{
      opacity:1;
      pointer-events:auto;
      transform:translateY(0) scale(1);
    }
    .scroll-to-top:active{transform:scale(.94)}
    .scroll-to-top svg{width:22px;height:22px;display:block}
    @media(max-width:540px){.scroll-to-top{right:18px}}
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'scrollToTopBtn';
  button.className = 'scroll-to-top';
  button.type = 'button';
  button.setAttribute('aria-label', 'Наверх');
  button.title = 'Наверх';
  button.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  document.body.appendChild(button);

  const visibleScreens = new Set(['home', 'library', 'catalog', 'settings']);

  function updateVisibility() {
    const screen = typeof activeScreenId === 'function'
      ? activeScreenId()
      : document.querySelector('.screen.active')?.id;
    const shouldShow = visibleScreens.has(screen) && window.scrollY > 700;
    button.classList.toggle('show', shouldShow);
  }

  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', updateVisibility, { passive: true });
  window.addEventListener('resize', updateVisibility, { passive: true });
  document.addEventListener('click', () => requestAnimationFrame(updateVisibility));
  updateVisibility();
})();
