import { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/lib/services/errors";

export async function assertStoreWarehouse(
  tx: Prisma.TransactionClient,
  storeId: string,
  warehouseId: string,
) {
  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, storeId: true, status: true } });
  if (!warehouse || warehouse.status !== "ACTIVE" || warehouse.storeId !== storeId) {
    throw new BusinessRuleError("Selected warehouse does not belong to the selected active store.", "STORE_WAREHOUSE_MISMATCH");
  }
}

export async function assertUserCanAccessStore(
  tx: Prisma.TransactionClient,
  userId: string,
  storeId: string,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { status: true, storeId: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!user || user.status !== "ACTIVE") throw new BusinessRuleError("Active authenticated user is required.", "USER_NOT_ACTIVE");
  const globalAdmin = user.roles.some(({ role }) => role.name === "SUPER_ADMIN");
  if (!globalAdmin && user.storeId !== storeId) {
    throw new BusinessRuleError("You are not allowed to create transactions for this store.", "STORE_ACCESS_DENIED");
  }
}

export async function assertActiveProduct(tx: Prisma.TransactionClient, productId: string) {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, status: true } });
  if (!product || product.status !== "ACTIVE") throw new BusinessRuleError(`Product ${productId} is not active.`, "PRODUCT_NOT_ACTIVE");
}
