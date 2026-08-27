import { z } from "zod";
import { InlineKeyboard } from "grammy";
import { getSupabaseAdmin } from "./supabase";
import { formatBookingMessage } from "./telegram-text";

const bookingSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  reference: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  date: z.string().min(1),
  time: z.string().min(1),
  clientName: z.string().min(1),
  phone: z.string().min(1),
  comment: z.string().optional(),
  status: z.enum(["new", "confirmed", "cancelled"]),
  createdAt: z.string().min(1),
  deletedAt: z.string().optional(),
});

export const telegramEventSchema = z.object({
  eventKey: z.string().min(1).max(180),
  eventType: z.enum(["booking.created", "booking.status_changed"]),
  profileId: z.string().min(1),
  booking: bookingSchema,
});

export type TelegramEvent = z.infer<typeof telegramEventSchema>;

type BotApi = {
  sendMessage: (chatId: number, text: string, options?: { reply_markup?: InlineKeyboard }) => Promise<unknown>;
};

export async function sendBookingEvent(api: BotApi, event: TelegramEvent) {
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("telegram_delivery_events")
    .select("status")
    .eq("event_key", event.eventKey)
    .maybeSingle();
  if (existing?.status === "sent") return { sent: true, reason: "duplicate" as const };

  await supabase.from("telegram_delivery_events").upsert({
    event_key: event.eventKey,
    profile_id: event.profileId,
    booking_id: event.booking.id,
    event_type: event.eventType,
    payload: event,
    status: "pending",
    error: null,
  }, { onConflict: "event_key" });

  const { data: connection, error: connectionError } = await supabase
    .from("telegram_connections")
    .select("chat_id")
    .eq("profile_id", event.profileId)
    .is("revoked_at", null)
    .maybeSingle();
  if (connectionError || !connection) {
    await supabase.from("telegram_delivery_events").update({ status: "failed", error: "telegram-not-linked" }).eq("event_key", event.eventKey);
    return { sent: false, reason: "not-linked" as const };
  }

  const keyboard = event.eventType === "booking.created" && event.booking.status === "new"
    ? new InlineKeyboard().text("Подтвердить", `booking:confirm:${event.booking.id}`).text("Отменить", `booking:cancel-ask:${event.booking.id}`)
    : undefined;
  try {
    await api.sendMessage(Number(connection.chat_id), formatBookingMessage(event.eventType, event.booking), keyboard ? { reply_markup: keyboard } : undefined);
    await supabase.from("telegram_delivery_events").update({ status: "sent", error: null, delivered_at: new Date().toISOString() }).eq("event_key", event.eventKey);
    return { sent: true, reason: "sent" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "telegram-send-failed";
    await supabase.from("telegram_delivery_events").update({ status: "failed", error: message }).eq("event_key", event.eventKey);
    return { sent: false, reason: "telegram-error" as const };
  }
}
