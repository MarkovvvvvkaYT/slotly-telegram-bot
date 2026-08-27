import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/src/lib/supabase";

const inputSchema = z.object({ userId: z.string().uuid() });

export async function POST(request: Request) {
  const expected = process.env.SLOTLY_INTERNAL_SECRET;
  if (!expected || request.headers.get("x-slotly-internal-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(parsed.data.userId);
  if (error) return NextResponse.json({ error: "Account deletion failed" }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
