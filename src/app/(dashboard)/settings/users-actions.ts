"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertStoreAccess, canAssignRolePermissions, hasRole, requirePermission } from "@/lib/auth/authorization";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/services/audit.service";
import { runSerializableTransaction } from "@/lib/services/transaction.service";

const userFields = z.object({
  name: z.string().trim().min(1).max(120),
  username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.union([z.string().trim().email().max(190), z.literal("")]).optional(),
  storeId: z.string().optional(),
  roleIds: z.array(z.string().min(1)).min(1).max(10),
});

function roleIds(form: FormData) {
  return [...new Set(form.getAll("roleIds").filter((value): value is string => typeof value === "string"))];
}

async function validateRoles(ids: string[], mayAssignSuperAdmin: boolean) {
  const roles = await prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  if (roles.length !== ids.length || (!mayAssignSuperAdmin && roles.some((role) => role.name === "SUPER_ADMIN"))) {
    throw new Error("ROLE_NOT_ALLOWED");
  }
}

function assertManagedUserScope(actor: Awaited<ReturnType<typeof requirePermission>>, targetStoreId: string | null) {
  if (!hasRole(actor, "SUPER_ADMIN") && (!actor.storeId || targetStoreId !== actor.storeId)) {
    assertStoreAccess(actor, targetStoreId ?? "__no_store_scope__");
  }
}

export async function createManagedUser(form: FormData) {
  const actor = await requirePermission("user.manage");
  const parsed = userFields.extend({ password: z.string().min(12).max(200) }).safeParse({
    ...Object.fromEntries(form.entries()), roleIds: roleIds(form),
  });
  if (!parsed.success) redirect("/settings?tab=users&error=validation");
  const storeId = parsed.data.storeId || null;
  if (!hasRole(actor, "SUPER_ADMIN") && !storeId) redirect("/settings?tab=users&error=store");
  if (storeId) assertStoreAccess(actor, storeId);
  try {
    await validateRoles(parsed.data.roleIds, hasRole(actor, "SUPER_ADMIN"));
    const passwordHash = await hashPassword(parsed.data.password);
    await runSerializableTransaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: parsed.data.name, username: parsed.data.username, email: parsed.data.email || null,
          passwordHash, storeId, status: "ACTIVE", roles: { create: parsed.data.roleIds.map((roleId) => ({ roleId })) },
        },
        select: { id: true, name: true, username: true, storeId: true },
      });
      await writeAudit(tx, { userId: actor.id, action: "CREATED", module: "USERS", entity: "User", entityId: created.id, newValue: { ...created, roleIds: parsed.data.roleIds } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ROLE_NOT_ALLOWED") redirect("/settings?tab=users&error=role");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") redirect("/settings?tab=users&error=duplicate");
    redirect("/settings?tab=users&error=operation");
  }
  revalidatePath("/settings");
  redirect("/settings?tab=users&created=1");
}

export async function updateManagedUser(form: FormData) {
  const actor = await requirePermission("user.manage");
  const id = z.string().min(1).safeParse(form.get("id"));
  const parsed = userFields.safeParse({ ...Object.fromEntries(form.entries()), roleIds: roleIds(form) });
  if (!id.success || !parsed.success) redirect("/settings?tab=users&error=validation");
  const target = await prisma.user.findUnique({ where: { id: id.data }, include: { roles: { include: { role: true } } } });
  if (!target) redirect("/settings?tab=users&error=missing");
  assertManagedUserScope(actor, target.storeId);
  const storeId = parsed.data.storeId || null;
  if (!hasRole(actor, "SUPER_ADMIN") && !storeId) redirect("/settings?tab=users&error=store");
  if (storeId) assertStoreAccess(actor, storeId);
  if (id.data === actor.id && (storeId !== target.storeId || parsed.data.roleIds.some((roleId) => !target.roles.some((role) => role.roleId === roleId)) || target.roles.some((role) => !parsed.data.roleIds.includes(role.roleId)))) {
    redirect("/settings?tab=users&error=self");
  }
  if (target.roles.some(({ role }) => role.name === "SUPER_ADMIN") && !hasRole(actor, "SUPER_ADMIN")) redirect("/settings?tab=users&error=role");
  try {
    await validateRoles(parsed.data.roleIds, hasRole(actor, "SUPER_ADMIN"));
    await runSerializableTransaction(async (tx) => {
      const oldValue = { name: target.name, username: target.username, email: target.email, storeId: target.storeId, status: target.status, roles: target.roles.map(({ role }) => role.name) };
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          name: parsed.data.name, username: parsed.data.username, email: parsed.data.email || null, storeId,
          roles: { create: parsed.data.roleIds.map((roleId) => ({ roleId })) },
        },
        select: { id: true, name: true, username: true, email: true, storeId: true },
      });
      await writeAudit(tx, { userId: actor.id, action: "UPDATED", module: "USERS", entity: "User", entityId: target.id, oldValue, newValue: { ...updated, roleIds: parsed.data.roleIds } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ROLE_NOT_ALLOWED") redirect("/settings?tab=users&error=role");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") redirect("/settings?tab=users&error=duplicate");
    redirect("/settings?tab=users&error=operation");
  }
  revalidatePath("/settings");
  redirect("/settings?tab=users&updated=1");
}

export async function setManagedUserStatus(form: FormData) {
  const actor = await requirePermission("user.manage");
  const parsed = z.object({ id: z.string().min(1), status: z.enum(["ACTIVE", "INACTIVE"]) }).safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success || parsed.data.id === actor.id) redirect("/settings?tab=users&error=self");
  const target = await prisma.user.findUnique({ where: { id: parsed.data.id }, include: { roles: { include: { role: true } } } });
  if (!target) redirect("/settings?tab=users&error=missing");
  assertManagedUserScope(actor, target.storeId);
  if (target.roles.some(({ role }) => role.name === "SUPER_ADMIN") && (!hasRole(actor, "SUPER_ADMIN") || parsed.data.status === "INACTIVE" && await prisma.user.count({ where: { id: { not: target.id }, status: "ACTIVE", roles: { some: { role: { name: "SUPER_ADMIN" } } } } }) === 0)) redirect("/settings?tab=users&error=lastadmin");
  await runSerializableTransaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { status: parsed.data.status } });
    if (parsed.data.status === "INACTIVE") await tx.authSession.deleteMany({ where: { userId: target.id } });
    await writeAudit(tx, { userId: actor.id, action: parsed.data.status === "ACTIVE" ? "ACTIVATED" : "DEACTIVATED", module: "USERS", entity: "User", entityId: target.id, oldValue: { status: target.status }, newValue: { status: parsed.data.status } });
  });
  revalidatePath("/settings");
  redirect("/settings?tab=users&updated=1");
}

export async function resetManagedUserPassword(form: FormData) {
  const actor = await requirePermission("user.manage");
  const parsed = z.object({ id: z.string().min(1), password: z.string().min(12).max(200) }).safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success || parsed.data.id === actor.id) redirect("/settings?tab=users&error=self");
  const target = await prisma.user.findUnique({ where: { id: parsed.data.id }, select: { id: true, storeId: true, roles: { select: { role: { select: { name: true } } } } } });
  if (!target) redirect("/settings?tab=users&error=missing");
  if (target.roles.some(({ role }) => role.name === "SUPER_ADMIN") && !hasRole(actor, "SUPER_ADMIN")) redirect("/settings?tab=users&error=role");
  assertManagedUserScope(actor, target.storeId);
  const passwordHash = await hashPassword(parsed.data.password);
  await runSerializableTransaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
    await tx.authSession.deleteMany({ where: { userId: target.id } });
    await writeAudit(tx, { userId: actor.id, action: "PASSWORD_RESET", module: "USERS", entity: "User", entityId: target.id });
  });
  revalidatePath("/settings");
  redirect("/settings?tab=users&updated=password");
}

export async function updateRolePermissions(form: FormData) {
  const actor = await requirePermission("role.manage");
  const roleId = z.string().min(1).safeParse(form.get("roleId"));
  const permissionIds = [...new Set(form.getAll("permissionIds").filter((value): value is string => typeof value === "string"))];
  if (!roleId.success || permissionIds.length > 200) redirect("/settings?tab=users&error=permissions");
  await runSerializableTransaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: roleId.data }, select: { id: true, name: true, permissions: { select: { permissionId: true } } } });
    if (!role || role.name === "SUPER_ADMIN") throw new Error("ROLE_NOT_EDITABLE");
    const permissions = await tx.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true, key: true } });
    if (permissions.length !== permissionIds.length) throw new Error("PERMISSION_NOT_FOUND");
    if (!canAssignRolePermissions(actor, permissions.map(({ key }) => key))) throw new Error("PERMISSION_ESCALATION_NOT_ALLOWED");
    const oldPermissionIds = role.permissions.map(({ permissionId }) => permissionId);
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissionIds.length) await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
    await writeAudit(tx, { userId: actor.id, action: "PERMISSIONS_UPDATED", module: "RBAC", entity: "Role", entityId: role.id, oldValue: { permissionIds: oldPermissionIds }, newValue: { permissionIds } });
  }).catch((error: unknown) => {
    if (error instanceof Error && ["ROLE_NOT_EDITABLE", "PERMISSION_NOT_FOUND", "PERMISSION_ESCALATION_NOT_ALLOWED"].includes(error.message)) redirect("/settings?tab=users&error=permissions");
    throw error;
  });
  revalidatePath("/settings");
  redirect("/settings?tab=users&updated=permissions");
}
