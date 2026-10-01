import { NextResponse } from "next/server";
import { loginSchema, authenticateCredentials } from "@/lib/auth/authentication.service";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";

function requestMetadata(request: Request) {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent") ?? null,
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const form = await request.formData();
    body = { identifier: form.get("identifier") ?? form.get("username"), password: form.get("password") };
  } catch {
    body = {};
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    await prisma.auditLog.create({ data: { action: "LOGIN_FAILED", module: "AUTH", ...requestMetadata(request) } });
    return NextResponse.redirect(new URL("/login?error=credentials", request.url));
  }
  const user = await authenticateCredentials(parsed.data.identifier, parsed.data.password);
  if (!user) {
    await prisma.auditLog.create({ data: { action: "LOGIN_FAILED", module: "AUTH", ...requestMetadata(request) } });
    return NextResponse.redirect(new URL("/login?error=credentials", request.url));
  }
  await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN_SUCCESS", module: "AUTH", ...requestMetadata(request) } });
  await createSession(user.id);
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
