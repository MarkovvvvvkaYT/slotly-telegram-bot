const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !webhookUrl || !secret) {
  throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET are required");
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ["message", "callback_query"] }),
});
const body = await response.json();
if (!response.ok || !body.ok) throw new Error(JSON.stringify(body));
console.log(body.result);

const commandsResponse = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands: [
    { command: "start", description: "Открыть меню специалиста" },
    { command: "today", description: "Записи на сегодня" },
    { command: "week", description: "Записи на 7 дней" },
    { command: "new", description: "Новые заявки" },
    { command: "confirmed", description: "Подтверждённые записи" },
    { command: "cancelled", description: "Отменённые записи" },
    { command: "all", description: "Все записи на 30 дней" },
    { command: "next", description: "Ближайшая запись" },
    { command: "stats", description: "Статистика" },
    { command: "profile", description: "Мой профиль" },
    { command: "help", description: "Помощь" },
  ] }),
});
const commandsBody = await commandsResponse.json();
if (!commandsResponse.ok || !commandsBody.ok) throw new Error(JSON.stringify(commandsBody));
console.log("Commands configured");
