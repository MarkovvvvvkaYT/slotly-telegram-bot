import { Bot, Context } from "grammy";
import { getSupabaseAdmin } from "./supabase";
import { hashChallengeToken, isChallengeExpired } from "./telegram-challenges";
import { parseBookingAction, parseStartPayload, telegramUpdateId } from "./telegram-text";

type Connection = { id: string; profile_id: string; telegram_user_id: number; chat_id: number };
type BookingRow = {
  id: string;
  reference: string;
  service_name: string;
  date: string;
  time: string;
  client_name: string;
  phone: string;
  comment: string | null;
  status: "new" | "confirmed" | "cancelled";
};

let botInstance: Bot<Context> | null = null;
let botInitPromise: Promise<unknown> | null = null;

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatBookingList(rows: BookingRow[]) {
  if (!rows.length) return "Записей нет.";
  return rows.map((booking) => {
    const status = booking.status === "confirmed" ? "подтверждена" : booking.status === "cancelled" ? "отменена" : "новая";
    return `${booking.date} ${booking.time} · ${booking.service_name}\n${booking.client_name} · ${booking.phone}\nСтатус: ${status} · #${booking.reference}`;
  }).join("\n\n");
}

async function connectionFor(ctx: Context) {
  if (ctx.chat?.type !== "private" || !ctx.from) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("telegram_connections")
    .select("id,profile_id,telegram_user_id,chat_id")
    .eq("chat_id", ctx.chat.id)
    .eq("telegram_user_id", ctx.from.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (data) await supabase.from("telegram_connections").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data as Connection | null;
}

async function sendStart(ctx: Context, payload: string | undefined) {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  const parsed = parseStartPayload(payload);
  const supabase = getSupabaseAdmin();
  if (!parsed) {
    const connection = await connectionFor(ctx);
    await ctx.reply(connection ? "Telegram подключён к Slotly. Используйте /today или /week." : "Эта команда доступна после привязки Telegram в кабинете специалиста Slotly.");
    return;
  }

  if (parsed.type === "link") {
    const { data: challenge } = await supabase
      .from("telegram_link_challenges")
      .select("id,profile_id,expires_at")
      .eq("token_hash", hashChallengeToken(parsed.token))
      .is("consumed_at", null)
      .maybeSingle();
    if (!challenge || isChallengeExpired(String(challenge.expires_at))) {
      await ctx.reply("Ссылка привязки истекла. Создайте новую в профиле Slotly.");
      return;
    }
    const connectionData = {
      profile_id: challenge.profile_id,
      telegram_user_id: ctx.from.id,
      chat_id: ctx.chat.id,
      username: ctx.from.username ?? null,
      display_name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || null,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    };
    const { data: existing } = await supabase.from("telegram_connections").select("id").eq("profile_id", challenge.profile_id).is("revoked_at", null).maybeSingle();
    const { data: connection, error } = existing
      ? await supabase.from("telegram_connections").update(connectionData).eq("id", existing.id).select("id").single()
      : await supabase.from("telegram_connections").insert(connectionData).select("id").single();
    if (error || !connection) {
      await ctx.reply("Не удалось привязать Telegram. Возможно, этот аккаунт уже подключён к другому профилю.");
      return;
    }
    await supabase.from("telegram_link_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id).is("consumed_at", null);
    await ctx.reply("Telegram подключён к Slotly. Теперь заявки будут приходить сюда.");
    return;
  }

  const { data: challenge } = await supabase
    .from("telegram_login_challenges")
    .select("id,profile_id,expires_at")
    .eq("token_hash", hashChallengeToken(parsed.token))
    .eq("status", "pending")
    .maybeSingle();
  if (!challenge || isChallengeExpired(String(challenge.expires_at))) {
    if (challenge) await supabase.from("telegram_login_challenges").update({ status: "expired", decided_at: new Date().toISOString() }).eq("id", challenge.id).eq("status", "pending");
    await ctx.reply("Запрос входа истёк. Начните вход в Slotly заново.");
    return;
  }
  const connection = await connectionFor(ctx);
  if (!connection || connection.profile_id !== challenge.profile_id) {
    await ctx.reply("Этот Telegram не привязан к профилю, который запрашивает вход.");
    return;
  }
  await supabase.from("telegram_login_challenges").update({ status: "approved", decided_at: new Date().toISOString(), telegram_connection_id: connection.id }).eq("id", challenge.id).eq("status", "pending");
  await ctx.reply("Вход в кабинет Slotly подтверждён. Вернитесь в браузер.");
}

async function listBookings(ctx: Context, days: number) {
  const connection = await connectionFor(ctx);
  if (!connection) {
    await ctx.reply("Сначала подключите Telegram в профиле специалиста Slotly.");
    return;
  }
  const from = dateKey();
  const to = dateKey(addDays(new Date(), days - 1));
  const { data, error } = await getSupabaseAdmin()
    .from("bookings")
    .select("id,reference,service_name,date,time,client_name,phone,comment,status")
    .eq("profile_id", connection.profile_id)
    .is("deleted_at", null)
    .gte("date", from)
    .lte("date", to)
    .order("date")
    .order("time");
  if (error) {
    await ctx.reply("Не удалось загрузить записи.");
    return;
  }
  await ctx.reply(formatBookingList((data ?? []) as BookingRow[]));
}

async function handleBookingAction(ctx: Context, action: "confirm" | "cancel", bookingId: string) {
  const connection = await connectionFor(ctx);
  if (!connection) {
    await ctx.answerCallbackQuery({ text: "Telegram не подключён", show_alert: true });
    return;
  }
  const status = action === "confirm" ? "confirmed" : "cancelled";
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId)
    .eq("profile_id", connection.profile_id)
    .is("deleted_at", null)
    .select("id,status")
    .maybeSingle();
  if (error || !data) {
    await ctx.answerCallbackQuery({ text: "Заявка уже изменена или не найдена", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({ text: status === "confirmed" ? "Заявка подтверждена" : "Заявка отменена" });
  await ctx.reply(status === "confirmed" ? "Заявка подтверждена." : "Заявка отменена.");
}

function registerHandlers(bot: Bot<Context>) {
  bot.command("start", (ctx) => sendStart(ctx, ctx.match));
  bot.command("today", (ctx) => listBookings(ctx, 1));
  bot.command("week", (ctx) => listBookings(ctx, 7));
  bot.command("help", (ctx) => ctx.reply("Команды: /today — записи сегодня; /week — записи на 7 дней; /help — помощь."));
  bot.command("status", async (ctx) => {
    const connection = await connectionFor(ctx);
    await ctx.reply(connection ? "Telegram подключён к Slotly." : "Telegram не подключён.");
  });
  bot.on("callback_query:data", async (ctx) => {
    const parsed = parseBookingAction(ctx.callbackQuery.data);
    if (!parsed) return ctx.answerCallbackQuery({ text: "Неизвестное действие", show_alert: true });
    await handleBookingAction(ctx, parsed.action, parsed.bookingId);
  });
}

export function getBot() {
  if (botInstance) return botInstance;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  botInstance = new Bot(token);
  registerHandlers(botInstance);
  return botInstance;
}

export async function handleUpdate(update: unknown) {
  const updateId = telegramUpdateId(update);
  if (updateId !== null) {
    const { error } = await getSupabaseAdmin().from("telegram_updates").insert({ update_id: updateId });
    if (error?.code === "23505") return { duplicate: true } as const;
    if (error) throw error;
  }
  const bot = getBot();
  botInitPromise ??= bot.init().catch((error) => {
    botInitPromise = null;
    throw error;
  });
  await botInitPromise;
  await bot.handleUpdate(update as Parameters<Bot<Context>["handleUpdate"]>[0]);
  return { duplicate: false } as const;
}
