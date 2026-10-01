import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { prisma } from "@/lib/db/prisma";
import { authenticateCredentials } from "@/lib/auth/authentication.service";
import { hashPassword } from "@/lib/auth/password";
import { createSessionRecord, deleteSessionRecord, getSessionRecord, hashSessionToken } from "@/lib/auth/session-store";
import { assertUserCanAccessStore } from "@/lib/services/store-access.service";
import { BusinessRuleError } from "@/lib/services/errors";

test("authentication rejects invalid/inactive credentials generically and sessions revoke cleanly", async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "superadmin" }, select: { id: true, username: true } });
  const correct = await authenticateCredentials(admin.username, "Demo-Only-2026!");
  const wrong = await authenticateCredentials(admin.username, "incorrect-password");
  const missing = await authenticateCredentials(`missing-${randomBytes(5).toString("hex")}`, "incorrect-password");
  assert.ok(correct);
  assert.equal(wrong, null);
  assert.equal(missing, null);
  assert.deepEqual(wrong, missing);
  assert.equal("passwordHash" in correct, false);

  const token = randomBytes(32).toString("base64url");
  try {
    const created = await createSessionRecord(admin.id, token);
    const stored = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token) } });
    assert.equal(stored.tokenHash, hashSessionToken(token));
    assert.notEqual(stored.tokenHash, token);
    assert.ok(created.expiresAt.getTime() > Date.now());

    const current = await getSessionRecord(token);
    assert.ok(current);
    assert.equal(current.user.id, admin.id);
    assert.equal("passwordHash" in current.user, false);
    assert.equal("token" in current, false);

    const expired = await getSessionRecord(token, new Date(created.expiresAt.getTime() + 1));
    assert.equal(expired, null);
    await deleteSessionRecord(token);
    assert.equal(await getSessionRecord(token), null);
    await deleteSessionRecord(token); // idempotent logout
  } finally {
    await deleteSessionRecord(token);
  }
});

test("inactive users are denied without account-specific authentication errors", async () => {
  const suffix = randomBytes(6).toString("hex");
  const user = await prisma.user.create({
    data: {
      name: "Temporary auth test",
      username: `auth-test-${suffix}`,
      email: `auth-test-${suffix}@example.test`,
      passwordHash: await hashPassword("temporary-test-password"),
      status: "INACTIVE",
    },
  });
  try {
    assert.equal(await authenticateCredentials(user.username, "temporary-test-password"), null);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test("multiple assigned roles merge grants and store access is limited to SUPER_ADMIN", async () => {
  const suffix = randomBytes(6).toString("hex");
  const [cashierRole, staffRole, admin, superAdmin] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { name: "CASHIER" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { name: "STAFF" }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { username: "admin1" }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { username: "superadmin" }, select: { id: true } }),
  ]);
  const user = await prisma.user.create({
    data: {
      name: "Multi-role auth test", username: `auth-multi-${suffix}`, email: `auth-multi-${suffix}@example.test`,
      passwordHash: await hashPassword("temporary-test-password"),
      roles: { create: [{ roleId: cashierRole.id }, { roleId: staffRole.id }] },
    },
  });
  const store = await prisma.store.create({ data: { code: `AUTH-${suffix.slice(0, 8)}`, name: "Temporary auth isolation test" } });
  try {
    const identity = await authenticateCredentials(user.username, "temporary-test-password");
    assert.ok(identity);
    assert.deepEqual(new Set(identity.roles), new Set(["CASHIER", "STAFF"]));
    assert.ok(identity.permissions.includes("sale.create"));
    assert.ok(identity.permissions.includes("dashboard.view"));

    await assert.rejects(
      prisma.$transaction((tx) => assertUserCanAccessStore(tx, admin.id, store.id)),
      (error: unknown) => error instanceof BusinessRuleError && error.code === "STORE_ACCESS_DENIED",
    );
    await prisma.$transaction((tx) => assertUserCanAccessStore(tx, superAdmin.id, store.id));
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.store.delete({ where: { id: store.id } });
  }
});
