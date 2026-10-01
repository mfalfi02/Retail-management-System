import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import type { AuthorizedUser } from "@/lib/auth/authorization";

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(190),
  password: z.string().min(1).max(200),
});

const DUMMY_PASSWORD_HASH = "$2b$12$dg4arpbboGDsPhLmwhG7HuFC.PnPjw8RL1jTZ51ED7KI6BQfCT8DK";

const identitySelection = {
  id: true,
  name: true,
  username: true,
  email: true,
  status: true,
  storeId: true,
  roles: {
    select: {
      role: {
        select: {
          name: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  },
} as const;

export type AuthenticatedIdentity = AuthorizedUser;

export async function authenticateCredentials(identifier: string, password: string): Promise<AuthenticatedIdentity | null> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
    select: { ...identitySelection, passwordHash: true },
  });
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || user.status !== "ACTIVE" || !passwordMatches) return null;

  const roles = user.roles.map(({ role }) => role.name);
  const permissions = [...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)))];
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    status: user.status,
    storeId: user.storeId,
    roles,
    permissions,
  };
}

export async function loadSafeIdentity(userId: string): Promise<AuthenticatedIdentity | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: identitySelection });
  if (!user || user.status !== "ACTIVE") return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    status: user.status,
    storeId: user.storeId,
    roles: user.roles.map(({ role }) => role.name),
    permissions: [...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)))],
  };
}
