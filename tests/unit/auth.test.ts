import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  assertPermission,
  assertRole,
  assertStoreAccess,
  authorizedStoreScopeId,
  canAssignRolePermissions,
  hasAllPermissions,
  hasAllRoles,
  hasAnyPermission,
  hasAnyRole,
  hasPermission,
  hasRole,
  type AuthorizedUser,
} from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { loginSchema } from "@/lib/auth/authentication.service";

const cashier: AuthorizedUser = {
  id: "u1", name: "Cashier", username: "cashier", email: null, status: "ACTIVE", storeId: "store-a",
  roles: ["CASHIER", "STAFF"], permissions: ["sale.create", "sale.view"],
};

test("login schema accepts bounded username/email identifier and password", () => {
  assert.equal(loginSchema.safeParse({ identifier: " cashier@example.test ", password: "secret" }).success, true);
  assert.equal(loginSchema.safeParse({ identifier: "", password: "secret" }).success, false);
  assert.equal(loginSchema.safeParse({ identifier: "x".repeat(191), password: "secret" }).success, false);
  assert.equal(loginSchema.safeParse({ identifier: "cashier", password: "" }).success, false);
  assert.equal(loginSchema.safeParse({ identifier: "cashier", password: "x".repeat(201) }).success, false);
});

test("password helpers hash and verify without preserving plaintext", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.notEqual(encoded, "correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
});

test("role helpers check one, any, and all roles", () => {
  assert.equal(hasRole(cashier, "CASHIER"), true);
  assert.equal(hasRole(cashier, "ADMIN"), false);
  assert.equal(hasAnyRole(cashier, ["ADMIN", "CASHIER"]), true);
  assert.equal(hasAllRoles(cashier, ["CASHIER", "STAFF"]), true);
  assert.equal(hasAllRoles(cashier, ["CASHIER", "ADMIN"]), false);
  assert.doesNotThrow(() => assertRole(cashier, ["ADMIN", "CASHIER"]));
  assert.throws(() => assertRole(cashier, "ADMIN"), AuthorizationError);
});

test("permission helpers combine grants and keep denial server-side", () => {
  assert.equal(hasPermission(cashier, "sale.create"), true);
  assert.equal(hasPermission(cashier, "sale.cancel"), false);
  assert.equal(hasAnyPermission(cashier, ["sale.cancel", "sale.view"]), true);
  assert.equal(hasAllPermissions(cashier, ["sale.create", "sale.view"]), true);
  assert.equal(hasAllPermissions(cashier, ["sale.create", "sale.cancel"]), false);
  assert.doesNotThrow(() => assertPermission(cashier, "sale.create"));
  assert.throws(() => assertPermission(cashier, "sale.cancel"), AuthorizationError);
});

test("SUPER_ADMIN bypasses permission checks and wildcard seed grants work", () => {
  const superAdmin = { ...cashier, roles: ["SUPER_ADMIN"], permissions: [] };
  const wildcardAdmin = { ...cashier, roles: ["ADMIN"], permissions: ["*"] };
  assert.equal(hasPermission(superAdmin, "unseeded.permission"), true);
  assert.equal(hasAllPermissions(superAdmin, ["one", "two"]), true);
  assert.equal(hasPermission(wildcardAdmin, "inventory.transfer"), true);
  assert.equal(hasPermission({ ...cashier, roles: ["ADMIN"], permissions: ["user.manage"] }, "role.manage"), false);
  assert.equal(hasPermission(superAdmin, "role.manage"), true);
});

test("store access is restricted except for SUPER_ADMIN", () => {
  assert.doesNotThrow(() => assertStoreAccess(cashier, "store-a"));
  assert.throws(() => assertStoreAccess(cashier, "store-b"), AuthorizationError);
  const admin = { ...cashier, roles: ["ADMIN"] };
  assert.throws(() => assertStoreAccess(admin, "store-b"), AuthorizationError);
  const superAdmin = { ...cashier, roles: ["SUPER_ADMIN"], storeId: null };
  assert.doesNotThrow(() => assertStoreAccess(superAdmin, "store-b"));
});

test("unassigned non-super-admin users fail closed for store queries", () => {
  assert.equal(authorizedStoreScopeId(cashier), "store-a");
  assert.equal(authorizedStoreScopeId({ ...cashier, storeId: null }), "__no_authorized_store_scope__");
  assert.equal(authorizedStoreScopeId({ ...cashier, roles: ["SUPER_ADMIN"], storeId: null }), undefined);
});

test("delegated role managers cannot grant permissions they do not hold", () => {
  const delegatedManager = { ...cashier, roles: ["CUSTOM_ROLE"], permissions: ["role.manage", "sale.view"] };
  assert.equal(canAssignRolePermissions(delegatedManager, ["sale.view"]), true);
  assert.equal(canAssignRolePermissions(delegatedManager, ["user.manage"]), false);
  assert.equal(canAssignRolePermissions(delegatedManager, ["*"]), false);
  assert.equal(canAssignRolePermissions(delegatedManager, ["role.manage"]), false);
  assert.equal(canAssignRolePermissions({ ...delegatedManager, roles: ["SUPER_ADMIN"] }, ["*"]), true);
});
