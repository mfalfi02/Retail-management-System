import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/authorization";

// Kept as the redirect-oriented helper used by existing Server Components.
export async function requireUser(permission?: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !hasPermission(user, permission)) redirect("/forbidden");
  return { ...user, permissions: new Set(user.permissions) };
}

export {
  hasRole,
  hasAnyRole,
  hasAllRoles,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  requireAuth,
  requireRole,
  requirePermission,
  requireStoreAccess,
} from "@/lib/auth/authorization";
