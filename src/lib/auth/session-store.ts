import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { loadSafeIdentity } from "@/lib/auth/authentication.service";

export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const SESSION_COOKIE_NAME = "retail_session";

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSessionRecord(userId: string, token = randomBytes(32).toString("base64url"), now = new Date()) {
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await prisma.authSession.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function getSessionRecord(token: string, now = new Date()) {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= now) return null;
  const user = await loadSafeIdentity(session.userId);
  if (!user) return null;
  return { user, expiresAt: session.expiresAt };
}

export async function deleteSessionRecord(token: string) {
  await prisma.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
