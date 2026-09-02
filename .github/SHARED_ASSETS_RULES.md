# Правила общих статических файлов

## VentKub Payments

- Папка `shared-assets/ventkub-payments/` зарезервирована для публичных статических файлов мобильной формы оплат VentKub / Сибирь.
- Утверждённая иконка iPhone Home Screen хранится как `shared-assets/ventkub-payments/icon-180.png`.
- Публичная iPhone-обёртка хранится как `shared-assets/ventkub-payments/app/index.html` и должна открывать рабочий Google Apps Script web app внутри `iframe`.
- Для обёртки используется публичный Cloudflare Pages-хост этого репозитория: `https://what-to-watch-awy.pages.dev/shared-assets/ventkub-payments/app/`.
- Прямую ссылку Apps Script не использовать как домашнюю iPhone-иконку: Google показывает служебный баннер и не даёт нормальный контроль над Home Screen icon.
- Чтобы Apps Script открывался внутри обёртки, `doGet()` должен возвращать `HtmlOutput` с `.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)`.
- Не удалять, не перемещать и не переименовывать файлы из этой папки без одновременного обновления ссылок мобильного приложения.
- В эту папку можно добавлять только публичные ассеты: иконки, HTML-обёртки и другие несекретные статические файлы. Никаких ключей, токенов, паролей и финансовых данных.
- Если для отдельного сервиса появятся дополнительные публичные ассеты, создавать для него отдельную подпапку внутри `shared-assets/`.

Текущий URL иконки:
`https://raw.githubusercontent.com/plavnikus/what-to-watch/main/shared-assets/ventkub-payments/icon-180.png`

Текущий URL iPhone-обёртки:
`https://what-to-watch-awy.pages.dev/shared-assets/ventkub-payments/app/`
