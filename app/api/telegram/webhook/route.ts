import { NextResponse } from "next/server";
import { handleUpdate } from "@/src/lib/bot";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || request.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await handleUpdate(await request.json());
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Telegram webhook failed", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "slotly-telegram-bot" });
}
