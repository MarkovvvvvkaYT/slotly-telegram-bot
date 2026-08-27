# Slotly Telegram Bot

Webhook service for Slotly specialists. It handles Telegram linking, booking notifications, booking status actions, and login confirmation challenges.

## Local checks

```bash
npm install
npm test
npm run lint
npm run build
```

## Vercel environment

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SLOTLY_INTERNAL_SECRET` in the Vercel project. Keep all values server-only.

After deployment, set the Telegram webhook:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_URL=https://<project>.vercel.app/api/telegram/webhook TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook
```

The existing Slotly app needs `TELEGRAM_BOT_INTERNAL_URL`, `TELEGRAM_INTERNAL_SECRET`, and `TELEGRAM_BOT_USERNAME`.
