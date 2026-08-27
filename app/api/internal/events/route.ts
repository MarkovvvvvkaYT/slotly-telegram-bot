import { NextResponse } from "next/server";
import { getBot } from "@/src/lib/bot";
import { sendBookingEvent, telegramEventSchema } from "@/src/lib/telegram-event";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.SLOTLY_INTERNAL_SECRET;
  if (!expected || request.headers.get("x-slotly-internal-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = telegramEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  try {
    const result = await sendBookingEvent(getBot().api, parsed.data);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    console.error("Telegram event failed", error);
    return NextResponse.json({ error: "Event delivery failed" }, { status: 500 });
  }
}
