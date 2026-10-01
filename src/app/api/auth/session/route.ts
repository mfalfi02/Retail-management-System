import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ user }, { headers: { "Cache-Control": "private, no-store" } });
}
