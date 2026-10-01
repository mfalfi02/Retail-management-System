import { AuthenticationError, AuthorizationError } from "@/lib/auth/errors";

export type AuthorizedUser = {
  id: string;
  name: string;
  username: string;
  email?: string | null;
  status: string;
  storeId: string | null;
  roles: string[];
  permissions: string[];
};

type RoleName = string;

export function hasRole(user: AuthorizedUser, role: RoleName) {
  return user.roles.includes(role);
}

export function hasAnyRole(user: AuthorizedUser, roles: readonly RoleName[]) {
  return roles.some((role) => hasRole(user, role));
}

export function hasAllRoles(user: AuthorizedUser, roles: readonly RoleName[]) {
  return roles.every((role) => hasRole(user, role));
}

export function hasPermission(user: AuthorizedUser, permission: string) {
  return hasRole(user, "SUPER_ADMIN") || user.permissions.includes("*") || user.permissions.includes(permission);
}

export function hasAnyPermission(user: AuthorizedUser, permissions: readonly string[]) {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function hasAllPermissions(user: AuthorizedUser, permissions: readonly string[]) {
  return permissions.every((permission) => hasPermission(user, permission));
}

export function assertRole(user: AuthorizedUser, roles: RoleName | readonly RoleName[]) {
  const allowed = typeof roles === "string" ? [roles] : roles;
  if (!hasAnyRole(user, allowed)) throw new AuthorizationError();
}

export function assertPermission(user: AuthorizedUser, permission: string) {
  if (!hasPermission(user, permission)) throw new AuthorizationError();
}

export function assertStoreAccess(user: AuthorizedUser, storeId: string) {
  if (!hasRole(user, "SUPER_ADMIN") && user.storeId !== storeId) throw new AuthorizationError("Store access denied.");
}

export function authorizedStoreScopeId(user: AuthorizedUser): string | undefined {
  if (hasRole(user, "SUPER_ADMIN")) return undefined;
  return user.storeId ?? "__no_authorized_store_scope__";
}

export function canAssignRolePermissions(user: AuthorizedUser, permissionKeys: readonly string[]) {
  if (hasRole(user, "SUPER_ADMIN")) return true;
  const granted = new Set(user.permissions);
  return permissionKeys.every((key) => key !== "*" && key !== "role.manage" && granted.has(key));
}

export async function requireAuth() {
  const { getCurrentUser } = await import("@/lib/auth/session");
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}

export async function requireRole(roles: RoleName | readonly RoleName[]) {
  const user = await requireAuth();
  assertRole(user, roles);
  return user;
}

export async function requirePermission(permission: string) {
  const user = await requireAuth();
  assertPermission(user, permission);
  return user;
}

export async function requireStoreAccess(storeId: string) {
  const user = await requireAuth();
  assertStoreAccess(user, storeId);
  return user;
}
