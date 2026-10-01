import "server-only";
import { cookies } from "next/headers";
import { createSessionRecord, deleteSessionRecord, getSessionRecord, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth/session-store";

export async function createSession(userId: string) {
  const { token } = await createSessionRecord(userId);
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function getCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await getSessionRecord(token);
  if (!session) return null;
  return session;
}

export async function getCurrentUser() {
  return (await getCurrentSession())?.user ?? null;
}

export async function getSessionUserId() {
  return (await getCurrentUser())?.id ?? null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  try {
    if (token) await deleteSessionRecord(token);
  } finally {
    jar.delete(SESSION_COOKIE_NAME);
  }
}
