# Slotly Telegram Bot

Telegram-бот для специалистов Slotly. Сервис принимает webhook-обновления Telegram, связывает аккаунт специалиста с профилем Slotly и позволяет получать уведомления и управлять заявками прямо в чате.

## Возможности

- привязка Telegram к профилю через одноразовую ссылку;
- уведомления о новых заявках и изменениях статуса;
- просмотр записей за сегодня, неделю и другие периоды;
- фильтры по статусам: новые, подтверждённые и отменённые;
- подтверждение, отмена и восстановление заявок кнопками;
- ближайшая запись и краткая статистика;
- подтверждение входа и удаления аккаунта через Telegram;
- защита внутренних запросов и идемпотентная доставка событий.

## Стек

Next.js 16 (App Router), TypeScript, [grammY](https://grammy.dev/), Supabase, Zod, Vitest.

## Архитектура

- `app/api/telegram/webhook/route.ts` — webhook Telegram;
- `app/api/internal/events/route.ts` — события от Slotly;
- `app/api/internal/account-delete/route.ts` — подтверждение удаления;
- `src/lib/bot.ts` — меню и действия над заявками;
- `src/lib/telegram-event.ts` — валидация и доставка событий;
- `src/lib/telegram-challenges.ts` — одноразовые challenge-токены;
- `scripts/set-webhook.mjs` — регистрация webhook.

## Локальный запуск

Требуется Node.js 20+ и бот, созданный через BotFather.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Заполните `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` и `SLOTLY_INTERNAL_SECRET`. Все значения должны оставаться серверными.

Для webhook нужен публичный HTTPS-адрес. После deployment зарегистрируйте webhook:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_URL=https://your-bot-project.vercel.app/api/telegram/webhook TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook
```

В Slotly настройте `TELEGRAM_BOT_INTERNAL_URL`, `TELEGRAM_INTERNAL_SECRET` и `TELEGRAM_BOT_USERNAME`.

## Проверки

```bash
npm run test
npm run lint
npm run build
```

## Связанный проект

- [Slotly](https://github.com/MarkovvvvvkaYT/slotly) — веб-приложение каталога, записи и кабинета специалиста.

## Безопасность

Не добавляйте `.env.local`, токен бота и сервисный ключ Supabase в репозиторий.
