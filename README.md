# Notebook Jump для Telegram + Cloudflare Pages

Игра сделана как один статический Telegram Web App: `index.html`, `styles.css`, `game.js`.

## Запуск локально
```bash
npm install
npm run dev
```

## GitHub + Cloudflare Pages
1. Создай новый репозиторий на GitHub.
2. Загрузи туда все файлы из этой папки.
3. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
4. Build command оставь пустым, output directory: `/`.
5. После деплоя получишь HTTPS-ссылку вида `https://notebook-jump.pages.dev`.

## Подключение в Telegram
- Для Mini App: BotFather → `/newapp` или Bot Settings → Menu Button → Web App URL.
- Для канала: добавь ссылку на Web App в пост или кнопку через бота.

## Управление
- Тап — прыжок.
- Палец слева/справа — движение.
- На телефоне также работает наклон.
- На ПК: стрелки/A/D и Space.

## Обновление дизайна
В папке `assets/` лежат новые PNG-ассеты: фон, деревянная платформа, травяная платформа, монстр и баннер score. Игра уже подключает их в `game.js`, дополнительных настроек не требуется.
