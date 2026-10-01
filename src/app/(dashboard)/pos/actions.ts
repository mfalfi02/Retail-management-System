"use server";

import { createHash } from "node:crypto";
import { PaymentType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorization";
import { assertStoreAccess } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { BusinessRuleError } from "@/lib/services/errors";
import { money, toDecimal } from "@/lib/services/decimal";
import { completeSale } from "@/lib/services/sales.service";

const checkoutSchema = z.object({
  checkoutKey: z.string().uuid(),
  storeId: z.string().min(1).optional(),
  warehouseId: z.string().min(1),
  customerId: z.string().min(1).nullable(),
  method: z.nativeEnum(PaymentType),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().finite().positive().max(100000) })).min(1).max(100),
});

export async function searchCatalog(rawInput: unknown) {
  const parsed = z.object({ query: z.string().trim().max(100).default(""), storeId: z.string().min(1), warehouseId: z.string().min(1) }).safeParse(rawInput);
  if (!parsed.success) return [];
  const user = await requirePermission("pos.access");
  assertStoreAccess(user, parsed.data.storeId);
  const warehouse = await prisma.warehouse.findFirst({ where: { id: parsed.data.warehouseId, storeId: parsed.data.storeId, status: "ACTIVE" }, select: { id: true } });
  if (!warehouse) return [];
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE", ...(parsed.data.query ? { OR: [{ name: { contains: parsed.data.query } }, { sku: { contains: parsed.data.query } }, { barcode: { contains: parsed.data.query } }] } : {}) },
    orderBy: { name: "asc" }, take: 40,
    select: { id: true, name: true, sku: true, sellingPrice: true, taxRate: true, imageUrl: true, category: { select: { id: true, name: true } }, inventory: { where: { warehouseId: warehouse.id }, select: { quantity: true, reservedQuantity: true } } },
  });
  return products.map((product) => ({ id: product.id, name: product.name, sku: product.sku, sellingPrice: product.sellingPrice.toString(), taxRate: product.taxRate.toString(), imageUrl: product.imageUrl, categoryId: product.category?.id ?? null, category: product.category?.name ?? "Uncategorized", quantity: product.inventory[0]?.quantity.toString() ?? "0", reservedQuantity: product.inventory[0]?.reservedQuantity.toString() ?? "0" }));
}

export async function submitCheckout(rawInput: unknown) {
  const parsed = checkoutSchema.safeParse(rawInput);
  if (!parsed.success) return { error: "Check the cart details and try again." };
  const user = await requirePermission("sale.create");
  const storeId = parsed.data.storeId ?? user.storeId;
  if (!storeId) return { error: "Choose an authorized store before checking out." };
  try {
    assertStoreAccess(user, storeId);
    const warehouse = await prisma.warehouse.findFirst({ where: { id: parsed.data.warehouseId, storeId, status: "ACTIVE" }, select: { id: true } });
    if (!warehouse) return { error: "No active warehouse is available for this store." };
    const products = await prisma.product.findMany({ where: { id: { in: parsed.data.items.map((item) => item.productId) }, status: "ACTIVE" }, select: { id: true, sellingPrice: true, taxRate: true } });
    if (products.length !== new Set(parsed.data.items.map((item) => item.productId)).size) return { error: "One or more cart products are no longer available." };
    const methods = await prisma.paymentMethod.findUnique({ where: { type: parsed.data.method }, select: { active: true } });
    if (!methods?.active) return { error: "That payment method is currently unavailable." };
    const byId = new Map(products.map((product) => [product.id, product]));
    const total = money(parsed.data.items.reduce((sum, item) => {
      const product = byId.get(item.productId)!;
      const gross = product.sellingPrice.times(toDecimal(item.quantity));
      return sum.plus(gross).plus(money(gross.times(product.taxRate).dividedBy(100)));
    }, toDecimal(0)));
    const requestHash = createHash("sha256").update(JSON.stringify({ userId: user.id, storeId, warehouseId: warehouse.id, customerId: parsed.data.customerId, method: parsed.data.method, items: parsed.data.items })).digest("hex");
    const sale = await completeSale({
      storeId,
      warehouseId: warehouse.id,
      cashierId: user.id,
      customerId: parsed.data.customerId ?? undefined,
      checkoutKey: parsed.data.checkoutKey,
      checkoutHash: requestHash,
      items: parsed.data.items,
      payments: [{ method: parsed.data.method, amount: total.toString() }],
    });
    revalidatePath("/dashboard");
    revalidatePath("/sales");
    revalidatePath("/inventory");
    return { sale: { id: sale.id, invoiceNumber: sale.invoiceNumber, grandTotal: sale.grandTotal.toString() } };
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    return { error: "Checkout could not be completed. Please retry." };
  }
}
