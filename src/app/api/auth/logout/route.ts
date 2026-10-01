import { NextResponse } from "next/server";
import { destroySession, getSessionUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  await destroySession();
  if (userId) await prisma.auditLog.create({ data: { userId, action: "LOGOUT", module: "AUTH", userAgent: request.headers.get("user-agent") ?? null } });
  return NextResponse.redirect(new URL("/login", request.url));
}
