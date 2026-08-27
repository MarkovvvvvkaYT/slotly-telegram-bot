export type BookingEventType = "booking.created" | "booking.status_changed";

export type BookingNotification = {
  reference: string;
  serviceName: string;
  date: string;
  time: string;
  clientName: string;
  phone: string;
  comment?: string;
  status: "new" | "confirmed" | "cancelled";
};

export function formatBookingMessage(eventType: BookingEventType, booking: BookingNotification) {
  const title = eventType === "booking.created" ? "Новая запись в Slotly" : "Изменение записи в Slotly";
  const status = booking.status === "confirmed" ? "Подтверждена" : booking.status === "cancelled" ? "Отменена" : "Новая";
  return [
    title,
    `${booking.serviceName} · ${booking.date} в ${booking.time}`,
    `Клиент: ${booking.clientName}`,
    `Телефон: ${booking.phone}`,
    booking.comment ? `Комментарий: ${booking.comment}` : "",
    `Статус: ${status}`,
    `Номер: ${booking.reference}`,
  ].filter(Boolean).join("\n");
}

export function parseStartPayload(payload: string | undefined) {
  if (!payload) return null;
  const match = /^(link|login|delete)_([A-Za-z0-9_-]{20,})$/.exec(payload);
  if (!match) return null;
  return { type: match[1] as "link" | "login" | "delete", token: match[2] };
}

export function parseAccountAction(data: string | undefined) {
  if (!data) return null;
  const match = /^account:(approve|cancel):([A-Za-z0-9-]{8,})$/.exec(data);
  if (!match) return null;
  return { action: match[1] as "approve" | "cancel", challengeId: match[2] };
}

export function parseBookingAction(data: string | undefined) {
  if (!data) return null;
  const match = /^booking:(confirm|restore|cancel|cancel-ask):([A-Za-z0-9-]{8,})$/.exec(data);
  if (!match) return null;
  return { action: match[1] as "confirm" | "restore" | "cancel" | "cancel-ask", bookingId: match[2] };
}

export function parseMenuAction(data: string | undefined) {
  if (!data) return null;
  const match = /^menu:(main|today|week|new|confirmed|cancelled|all|stats|next|profile)$/.exec(data);
  if (!match) return null;
  return { view: match[1] as "main" | "today" | "week" | "new" | "confirmed" | "cancelled" | "all" | "stats" | "next" | "profile" };
}

export function telegramUpdateId(update: unknown) {
  if (!update || typeof update !== "object" || !Number.isInteger((update as { update_id?: unknown }).update_id)) return null;
  const id = (update as { update_id: number }).update_id;
  return id >= 0 ? id : null;
}
