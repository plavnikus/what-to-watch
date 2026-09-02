# Правила общих статических файлов

## VentKub Payments

- Папка `shared-assets/ventkub-payments/` зарезервирована для публичных статических файлов мобильной формы оплат VentKub / Сибирь.
- Утверждённая иконка iPhone Home Screen хранится как `shared-assets/ventkub-payments/icon-180.png`.
- Постоянная PWA-оболочка мобильной формы хранится в `ventkub-payments/` и публикуется через Cloudflare Pages.
- Основной пользовательский URL PWA: `https://what-to-watch-awy.pages.dev/ventkub-payments/`.
- Папка `shared-assets/ventkub-payments/app/` с iframe-обёрткой считается устаревшим экспериментом: Google Apps Script вернул 401 внутри iframe, поэтому этот способ больше не использовать.
- Прямую ссылку Apps Script не использовать как домашнюю iPhone-иконку: Google показывает служебный баннер и не даёт нормальный контроль над Home Screen icon.
- Apps Script для PWA используется только как backend. Внешний интерфейс обращается к same-origin Cloudflare Pages Function `functions/api/ventkub-payments.js`, а та сервер-сервером вызывает Apps Script JSON API.
- Доступ к PWA API привязывается к устройству через `functions/api/ventkub-pair.js`: одноразовый код проверяется по SHA-256, после чего устанавливается `HttpOnly; Secure; SameSite=Strict` cookie. Открытый код доступа не хранить в GitHub.
- Cloudflare proxy передаёт код из защищённой cookie в Apps Script; Apps Script повторно проверяет SHA-256. Это защищает и внешний API, и прямой `doPost` Apps Script.
- Для backend-версии Apps Script обязательны `doPost(e)`, `getMonthSnapshot(...)` и `savePayment(...)`. Не менять финансовую логику записи без отдельного согласования.
- Не удалять, не перемещать и не переименовывать файлы PWA или иконку без одновременного обновления ссылок и service worker.
- В публичный репозиторий нельзя добавлять ключи, токены, пароли и финансовые данные.
- Перед постоянным производственным использованием провести реальную тестовую запись и проверить корректность всех полей в Google Sheets.
- Если для отдельного сервиса появятся дополнительные публичные ассеты, создавать для него отдельную подпапку внутри `shared-assets/`.

Текущий URL иконки:
`https://raw.githubusercontent.com/plavnikus/what-to-watch/main/shared-assets/ventkub-payments/icon-180.png`

Текущий URL PWA:
`https://what-to-watch-awy.pages.dev/ventkub-payments/`
