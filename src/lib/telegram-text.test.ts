import { formatBookingMessage, parseStartPayload, parseAccountAction, parseBookingAction, parseMenuAction, telegramUpdateId } from "./telegram-text";

describe("Telegram bot payloads", () => {
  it("formats booking notification with action context", () => {
    const text = formatBookingMessage("booking.created", {
      reference: "SL-ABC123",
      serviceName: "Консультация",
      date: "2099-04-12",
      time: "10:00",
      clientName: "Анна",
      phone: "+7 999 123-45-67",
      comment: "Онлайн",
      status: "new",
    });
    expect(text).toContain("Новая запись в Slotly");
    expect(text).toContain("SL-ABC123");
    expect(text).toContain("Анна");
    expect(text).toContain("Онлайн");
  });

  it("parses only known deep-link payloads", () => {
    expect(parseStartPayload("link_token12345678901234567890")).toEqual({ type: "link", token: "token12345678901234567890" });
    expect(parseStartPayload("login_token12345678901234567890")).toEqual({ type: "login", token: "token12345678901234567890" });
    expect(parseStartPayload("delete_token12345678901234567890")).toEqual({ type: "delete", token: "token12345678901234567890" });
    expect(parseStartPayload("link_")).toBeNull();
    expect(parseStartPayload("unknown_token")).toBeNull();
  });

  it("parses account deletion actions", () => {
    expect(parseAccountAction("account:approve:challenge-1")).toEqual({ action: "approve", challengeId: "challenge-1" });
    expect(parseAccountAction("account:cancel:challenge-1")).toEqual({ action: "cancel", challengeId: "challenge-1" });
    expect(parseAccountAction("account:approve:")).toBeNull();
  });

  it("parses booking actions without accepting malformed callback data", () => {
    expect(parseBookingAction("booking:confirm:booking-1")).toEqual({ action: "confirm", bookingId: "booking-1" });
    expect(parseBookingAction("booking:restore:booking-1")).toEqual({ action: "restore", bookingId: "booking-1" });
    expect(parseBookingAction("booking:cancel:booking-1")).toEqual({ action: "cancel", bookingId: "booking-1" });
    expect(parseBookingAction("booking:cancel-ask:booking-1")).toEqual({ action: "cancel-ask", bookingId: "booking-1" });
    expect(parseBookingAction("booking:confirm:")).toBeNull();
    expect(parseBookingAction("other:confirm:booking-1")).toBeNull();
  });

  it("parses known menu views", () => {
    expect(parseMenuAction("menu:today")).toEqual({ view: "today" });
    expect(parseMenuAction("menu:main")).toEqual({ view: "main" });
    expect(parseMenuAction("menu:unknown")).toBeNull();
  });

  it("extracts a safe Telegram update id for deduplication", () => {
    expect(telegramUpdateId({ update_id: 42 })).toBe(42);
    expect(telegramUpdateId({ update_id: -1 })).toBeNull();
    expect(telegramUpdateId({ update_id: "42" })).toBeNull();
  });
});
