import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import { getSupabaseAdmin } from "./supabase";
import { hashChallengeToken, isChallengeExpired } from "./telegram-challenges";
import { parseAccountAction, parseBookingAction, parseMenuAction, parseStartPayload, telegramUpdateId } from "./telegram-text";

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

function mainMenu() {
  return new Keyboard()
    .text("Сегодня").text("Неделя").row()
    .text("Новые").text("Подтверждённые").row()
    .text("Все записи").text("Отменённые").row()
    .text("Следующая запись").text("Статистика").row()
    .text("Профиль").text("Помощь")
    .resized()
    .persistent();
}

function bookingKeyboard(booking: BookingRow) {
  if (booking.status === "cancelled") return new InlineKeyboard().text("Вернуть", `booking:confirm:${booking.id}`);
  if (booking.status === "confirmed") return new InlineKeyboard().text("Отменить", `booking:cancel-ask:${booking.id}`);
  return new InlineKeyboard().text("Подтвердить", `booking:confirm:${booking.id}`).text("Отменить", `booking:cancel-ask:${booking.id}`);
}

function contextKeyboard() {
  return new InlineKeyboard()
    .text("Сегодня", "menu:today").text("Неделя", "menu:week").row()
    .text("Новые", "menu:new").text("Подтверждённые", "menu:confirmed").row()
    .text("Все записи", "menu:all").text("Статистика", "menu:stats").row()
    .text("Главное меню", "menu:main");
}

function formatBookingDetails(booking: BookingRow) {
  const status = booking.status === "confirmed" ? "Подтверждена" : booking.status === "cancelled" ? "Отменена" : "Новая";
  return `${booking.date} · ${booking.time}\n${booking.service_name}\nКлиент: ${booking.client_name}\nТелефон: ${booking.phone}${booking.comment ? `\nКомментарий: ${booking.comment}` : ""}\nСтатус: ${status}\nНомер: ${booking.reference}`;
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
    await ctx.reply(connection ? "Slotly подключён. Выберите действие — бот покажет только актуальное." : "Сначала подключите Telegram в профиле специалиста Slotly.", { reply_markup: connection ? mainMenu() : undefined });
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
    await ctx.reply("Telegram подключён. Новые заявки придут сюда, а меню поможет управлять днём без сайта.", { reply_markup: mainMenu() });
    return;
  }

  if (parsed.type === "delete") {
    const { data: challenge } = await supabase.from("telegram_account_delete_challenges").select("id,profile_id,expires_at").eq("token_hash", hashChallengeToken(parsed.token)).eq("status", "pending").maybeSingle();
    if (!challenge || isChallengeExpired(String(challenge.expires_at))) {
      await ctx.reply("Запрос удаления истёк. Создайте новый в кабинете Slotly.");
      return;
    }
    const connection = await connectionFor(ctx);
    if (!connection || connection.profile_id !== challenge.profile_id) {
      await ctx.reply("Этот Telegram не привязан к профилю, который запрашивает удаление.");
      return;
    }
    await ctx.reply("Удалить аккаунт Slotly? Профиль, услуги и заявки будут удалены без возможности восстановления.", { reply_markup: new InlineKeyboard().text("Удалить аккаунт", `account:approve:${challenge.id}`).text("Отмена", `account:cancel:${challenge.id}`) });
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

async function listBookings(ctx: Context, days: number, status?: "new" | "confirmed" | "cancelled") {
  const connection = await connectionFor(ctx);
  if (!connection) {
    await ctx.reply("Сначала подключите Telegram в профиле специалиста Slotly.");
    return;
  }
  const from = dateKey();
  const to = dateKey(addDays(new Date(), days - 1));
  let query = getSupabaseAdmin()
    .from("bookings")
    .select("id,reference,service_name,date,time,client_name,phone,comment,status")
    .eq("profile_id", connection.profile_id)
    .is("deleted_at", null)
    .gte("date", from)
    .lte("date", to);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("date").order("time");
  if (error) {
    await ctx.reply("Не удалось загрузить записи.");
    return;
  }
  const rows = (data ?? []).map((row) => ({ ...row, time: String(row.time).slice(0, 5) })) as BookingRow[];
  if (!rows.length) { await ctx.reply("Записей нет.", { reply_markup: mainMenu() }); return; }
  const visibleRows = rows.slice(0, 8);
  await ctx.reply(rows.length > visibleRows.length ? `Записей: ${rows.length}. Показываю ближайшие ${visibleRows.length}; остальные доступны на сайте.` : `Записи: ${rows.length}. Нажмите кнопку под заявкой для изменения статуса.`, { reply_markup: contextKeyboard() });
  for (const booking of visibleRows) await ctx.reply(formatBookingDetails(booking), { reply_markup: bookingKeyboard(booking) });
}

async function sendStats(ctx: Context) {
  const connection = await connectionFor(ctx);
  if (!connection) return ctx.reply("Сначала подключите Telegram в профиле специалиста Slotly.", { reply_markup: mainMenu() });
  const { data, error } = await getSupabaseAdmin().from("bookings").select("status,date").eq("profile_id", connection.profile_id).is("deleted_at", null).gte("date", dateKey());
  if (error) return ctx.reply("Не удалось загрузить статистику.", { reply_markup: mainMenu() });
  const rows = data ?? [];
  const count = (value: string) => rows.filter((row) => row.status === value).length;
  await ctx.reply(`Статистика с сегодня\nВсего: ${rows.length}\nНовых: ${count("new")}\nПодтверждено: ${count("confirmed")}\nОтменено: ${count("cancelled")}`, { reply_markup: contextKeyboard() });
}

async function sendNextBooking(ctx: Context) {
  const connection = await connectionFor(ctx);
  if (!connection) return ctx.reply("Сначала подключите Telegram в профиле специалиста Slotly.", { reply_markup: mainMenu() });
  const { data } = await getSupabaseAdmin().from("bookings").select("id,reference,service_name,date,time,client_name,phone,comment,status").eq("profile_id", connection.profile_id).is("deleted_at", null).neq("status", "cancelled").gte("date", dateKey()).order("date").order("time").limit(1).maybeSingle();
  if (!data) return ctx.reply("Ближайших записей нет.", { reply_markup: contextKeyboard() });
  const booking = { ...(data as BookingRow), time: String(data.time).slice(0, 5) };
  await ctx.reply(`Следующая запись\n\n${formatBookingDetails(booking)}`, { reply_markup: new InlineKeyboard().text("Отменить запись", `booking:cancel-ask:${booking.id}`).row().text("Назад к меню", "menu:main") });
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
    .select("id,reference,service_name,date,time,client_name,phone,comment,status")
    .maybeSingle();
  if (error || !data) {
    await ctx.answerCallbackQuery({ text: "Заявка уже изменена или не найдена", show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({ text: status === "confirmed" ? "Заявка подтверждена" : "Заявка отменена" });
  const booking = { ...(data as BookingRow), time: String(data.time).slice(0, 5) };
  await ctx.editMessageText(formatBookingDetails(booking), { reply_markup: bookingKeyboard(booking) });
}

async function handleCancelPrompt(ctx: Context, bookingId: string) {
  const connection = await connectionFor(ctx);
  if (!connection) return ctx.answerCallbackQuery({ text: "Telegram не подключён", show_alert: true });
  const { data } = await getSupabaseAdmin().from("bookings").select("id,reference,service_name,date,time,client_name,phone,comment,status").eq("id", bookingId).eq("profile_id", connection.profile_id).is("deleted_at", null).maybeSingle();
  if (!data) return ctx.answerCallbackQuery({ text: "Заявка уже изменена или не найдена", show_alert: true });
  await ctx.answerCallbackQuery();
  const booking = { ...(data as BookingRow), time: String(data.time).slice(0, 5) };
  await ctx.editMessageText(`${formatBookingDetails(booking)}\n\nТочно отменить заявку?`, { reply_markup: new InlineKeyboard().text("Да, отменить", `booking:cancel:${booking.id}`).text("Назад", "menu:main") });
}

async function handleAccountAction(ctx: Context, action: "approve" | "cancel", challengeId: string) {
  const connection = await connectionFor(ctx);
  if (!connection) return ctx.answerCallbackQuery({ text: "Telegram не подключён", show_alert: true });
  const supabase = getSupabaseAdmin();
  const nextStatus = action === "approve" ? "approved" : "rejected";
  const { data } = await supabase.from("telegram_account_delete_challenges").update({ status: nextStatus, decided_at: new Date().toISOString(), telegram_connection_id: connection.id }).eq("id", challengeId).eq("profile_id", connection.profile_id).eq("status", "pending").select("id").maybeSingle();
  if (!data) return ctx.answerCallbackQuery({ text: "Запрос уже обработан или истёк", show_alert: true });
  await ctx.answerCallbackQuery({ text: action === "approve" ? "Удаление подтверждено" : "Удаление отменено" });
  await ctx.editMessageText(action === "approve" ? "Удаление аккаунта подтверждено. Вернитесь на сайт." : "Удаление аккаунта отменено.");
}

async function sendProfile(ctx: Context) {
  const connection = await connectionFor(ctx);
  if (!connection) return ctx.reply("Сначала подключите Telegram в профиле специалиста Slotly.");
  const { data } = await getSupabaseAdmin().from("profiles").select("name,slug,is_published").eq("id", connection.profile_id).maybeSingle();
  if (!data) return ctx.reply("Профиль не найден.", { reply_markup: contextKeyboard() });
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? "https://slotly-online.vercel.app";
  return ctx.reply(`${data.name}\nПрофиль: ${siteUrl}/p/${data.slug}\nСтатус: ${data.is_published ? "опубликован" : "скрыт"}`, { reply_markup: contextKeyboard() });
}

function registerHandlers(bot: Bot<Context>) {
  bot.command("start", (ctx) => sendStart(ctx, ctx.match));
  bot.command("today", (ctx) => listBookings(ctx, 1));
  bot.command("week", (ctx) => listBookings(ctx, 7));
  bot.command("upcoming", (ctx) => listBookings(ctx, 30));
  bot.command("new", (ctx) => listBookings(ctx, 30, "new"));
  bot.command("confirmed", (ctx) => listBookings(ctx, 30, "confirmed"));
  bot.command("cancelled", (ctx) => listBookings(ctx, 30, "cancelled"));
  bot.command("all", (ctx) => listBookings(ctx, 30));
  bot.command("next", sendNextBooking);
  bot.command("stats", sendStats);
  bot.command("menu", (ctx) => ctx.reply("Выберите действие:", { reply_markup: mainMenu() }));
  bot.command("profile", sendProfile);
  bot.command("help", (ctx) => ctx.reply("Меню работает кнопками или командами:\nСегодня, Неделя, Новые, Подтверждённые, Все записи, Отменённые\nСледующая запись, Статистика, Профиль\nКоманды: /today /week /upcoming /new /confirmed /cancelled /all /next /stats /profile /status", { reply_markup: mainMenu() }));
  bot.hears("Сегодня", (ctx) => listBookings(ctx, 1));
  bot.hears("Неделя", (ctx) => listBookings(ctx, 7));
  bot.hears("Новые", (ctx) => listBookings(ctx, 30, "new"));
  bot.hears("Подтверждённые", (ctx) => listBookings(ctx, 30, "confirmed"));
  bot.hears("Все записи", (ctx) => listBookings(ctx, 30));
  bot.hears("Отменённые", (ctx) => listBookings(ctx, 30, "cancelled"));
  bot.hears("Следующая запись", sendNextBooking);
  bot.hears("Статистика", sendStats);
  bot.hears("Профиль", sendProfile);
  bot.hears("Помощь", (ctx) => ctx.reply("Выберите кнопку меню или используйте /help.", { reply_markup: mainMenu() }));
  bot.command("status", async (ctx) => {
    const connection = await connectionFor(ctx);
    await ctx.reply(connection ? "Telegram подключён к Slotly." : "Telegram не подключён.");
  });
  bot.on("callback_query:data", async (ctx) => {
    const accountAction = parseAccountAction(ctx.callbackQuery.data);
    if (accountAction) return handleAccountAction(ctx, accountAction.action, accountAction.challengeId);
    const menuAction = parseMenuAction(ctx.callbackQuery.data);
    if (menuAction) {
      await ctx.answerCallbackQuery();
      if (menuAction.view === "main") return ctx.reply("Выберите действие:", { reply_markup: mainMenu() });
      if (menuAction.view === "stats") return sendStats(ctx);
      if (menuAction.view === "next") return sendNextBooking(ctx);
      if (menuAction.view === "profile") return sendProfile(ctx);
      const views = { today: [1], week: [7], new: [30, "new"], confirmed: [30, "confirmed"], cancelled: [30, "cancelled"], all: [30] } as const;
      const view = views[menuAction.view as keyof typeof views];
      if (view) return listBookings(ctx, view[0], view[1] as "new" | "confirmed" | "cancelled" | undefined);
    }
    const parsed = parseBookingAction(ctx.callbackQuery.data);
    if (!parsed) return ctx.answerCallbackQuery({ text: "Неизвестное действие", show_alert: true });
    if (parsed.action === "cancel-ask") return handleCancelPrompt(ctx, parsed.bookingId);
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
