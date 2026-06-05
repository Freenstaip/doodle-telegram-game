# Doodle Telegram Game + Bot Admin

Проект можно держать в одном GitHub-репозитории и деплоить через Cloudflare Pages.

## Структура

- `public/` — сама игра.
- `functions/[[path]].js` — backend: Telegram-бот, API игры, статистика, postback, рассылка.
- `db/schema.sql` — таблицы D1.

## Cloudflare Pages через браузер

1. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git.
2. Выбери этот GitHub репозиторий.
3. Framework preset: `None`.
4. Build command: пусто.
5. Build output directory: `public`.
6. Deploy.

## D1 база

Cloudflare → Storage & Databases → D1 → Create Database.
Название: `doodle_game`.

Открой базу → Console → вставь содержимое `db/schema.sql` → Execute.

Потом в Pages проекте:
Settings → Bindings → Add binding → D1 database.

- Variable name: `DB`
- Database: `doodle_game`

## Environment variables

Pages проект → Settings → Environment variables:

- `TELEGRAM_BOT_TOKEN` — токен бота от BotFather.
- `ADMIN_IDS` — твой Telegram ID, можно несколько через запятую: `123,456`.
- `BOT_WEBHOOK_SECRET` — любой секретный набор символов, например `mysecret777`.
- `PUBLIC_BASE_URL` — ссылка Cloudflare Pages, например `https://project.pages.dev`.
- `ONEWIN_LINK` — партнёрская ссылка, обязательно с `{user_id}`, например `https://example.com/?sub1={user_id}`.
- `POSTBACK_SECRET` — необязательно, секрет для postback.

## Webhook Telegram

Открой в браузере:

`https://api.telegram.org/botBOT_TOKEN/setWebhook?url=https://PROJECT.pages.dev/bot/BOT_WEBHOOK_SECRET`

Замени `BOT_TOKEN`, `PROJECT.pages.dev`, `BOT_WEBHOOK_SECRET`.

## Админка в боте

Напиши боту `/admin` с Telegram ID, указанного в `ADMIN_IDS`.

Будут кнопки:

- Статистика
- Рассылка

Рассылка работает так:

1. `/admin`
2. `Рассылка`
3. отправь фото
4. отправь текст
5. отправь текст кнопки
6. отправь ссылку кнопки
7. подтверди отправку

## 1win postback

В кабинете партнёрки укажи:

`https://PROJECT.pages.dev/postback?user_id={sub1}`

Если используешь `POSTBACK_SECRET`:

`https://PROJECT.pages.dev/postback?user_id={sub1}&secret=ТВОЙ_СЕКРЕТ`

