import { createHash } from "node:crypto";
import { MovementType, Prisma, PurchaseStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { BusinessRuleError } from "@/lib/services/errors";
import { decimalInput, money, moneyInput, toDecimal } from "@/lib/services/decimal";
import { decreaseStock, increaseStock } from "@/lib/services/inventory";
import { writeAudit } from "@/lib/services/audit.service";
import { generateDocumentNumber } from "@/lib/services/numbering.service";
import { assertActiveProduct, assertStoreWarehouse, assertUserCanAccessStore } from "@/lib/services/store-access.service";
import { runSerializableTransaction } from "@/lib/services/transaction.service";

const createPurchaseSchema = z.object({
  supplierId: z.string().min(1),
  storeId: z.string().min(1),
  warehouseId: z.string().min(1),
  createdById: z.string().min(1),
  discount: moneyInput.optional(),
  tax: moneyInput.optional(),
  shipping: moneyInput.optional(),
  notes: z.string().max(4000).optional(),
  items: z.array(z.object({ productId: z.string().min(1), quantity: decimalInput, unitCost: moneyInput, discount: moneyInput.optional(), tax: moneyInput.optional() })).min(1),
});

export type CreatePurchaseInput = z.input<typeof createPurchaseSchema>;

export async function createPurchase(rawInput: CreatePurchaseInput) {
  const input = createPurchaseSchema.parse(rawInput);
  for (const item of input.items) {
    if (!toDecimal(item.quantity).greaterThan(0)) throw new BusinessRuleError("Purchase quantities must be greater than zero.");
    if (toDecimal(item.unitCost).isNegative()) throw new BusinessRuleError("Purchase unit cost cannot be negative.");
  }
  return runSerializableTransaction(async (tx) => {
    await assertUserCanAccessStore(tx, input.createdById, input.storeId);
    await assertStoreWarehouse(tx, input.storeId, input.warehouseId);
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, status: true } });
    if (!supplier || supplier.status !== "ACTIVE") throw new BusinessRuleError("Supplier is not active.");

    let subtotal = new Prisma.Decimal(0);
    let itemDiscounts = new Prisma.Decimal(0);
    let itemTaxes = new Prisma.Decimal(0);
    const items = [];
    for (const item of input.items) {
      await assertActiveProduct(tx, item.productId);
      const quantity = toDecimal(item.quantity);
      const unitCost = toDecimal(item.unitCost);
      const gross = quantity.times(unitCost);
      const discount = toDecimal(item.discount ?? 0);
      const tax = toDecimal(item.tax ?? 0);
      if (discount.greaterThan(gross)) throw new BusinessRuleError("Purchase item discount exceeds its line total.");
      subtotal = subtotal.plus(gross);
      itemDiscounts = itemDiscounts.plus(discount);
      itemTaxes = itemTaxes.plus(tax);
      items.push({ productId: item.productId, quantity, receivedQuantity: 0, unitCost, discount, tax, subtotal: money(gross.minus(discount).plus(tax)) });
    }
    const extraDiscount = toDecimal(input.discount ?? 0);
    const extraTax = toDecimal(input.tax ?? 0);
    const shipping = toDecimal(input.shipping ?? 0);
    if (extraDiscount.plus(itemDiscounts).greaterThan(subtotal)) throw new BusinessRuleError("Purchase discount exceeds subtotal.");
    const discount = itemDiscounts.plus(extraDiscount);
    const tax = itemTaxes.plus(extraTax);
    const grandTotal = money(subtotal.minus(discount).plus(tax).plus(shipping));
    const invoiceNumber = await generateDocumentNumber(tx, "invoice.purchasePrefix", "PUR");
    const purchase = await tx.purchase.create({
      data: {
        invoiceNumber, status: PurchaseStatus.PENDING, paymentStatus: "UNPAID", supplierId: input.supplierId,
        storeId: input.storeId, warehouseId: input.warehouseId, createdById: input.createdById,
        subtotal: money(subtotal), discount: money(discount), tax: money(tax), shipping, grandTotal,
        notes: input.notes, items: { create: items },
      },
      select: { id: true, invoiceNumber: true, status: true, grandTotal: true },
    });
    await writeAudit(tx, { userId: input.createdById, action: "CREATED", module: "PURCHASING", entity: "Purchase", entityId: purchase.id, newValue: { invoiceNumber, grandTotal: grandTotal.toString(), itemCount: items.length } });
    return purchase;
  });
}

export async function approvePurchase(purchaseId: string, approvedById: string) {
  return runSerializableTransaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({ where: { id: purchaseId }, select: { id: true, status: true, storeId: true } });
    if (!purchase) throw new BusinessRuleError("Purchase was not found.", "PURCHASE_NOT_FOUND");
    await assertUserCanAccessStore(tx, approvedById, purchase.storeId);
    if (purchase.status !== PurchaseStatus.DRAFT && purchase.status !== PurchaseStatus.PENDING) throw new BusinessRuleError("Only draft or pending purchases can be approved.");
    const updated = await tx.purchase.update({ where: { id: purchase.id }, data: { status: PurchaseStatus.APPROVED } });
    await writeAudit(tx, { userId: approvedById, action: "APPROVED", module: "PURCHASING", entity: "Purchase", entityId: purchase.id, oldValue: { status: purchase.status }, newValue: { status: updated.status } });
    return updated;
  });
}

const receiveSchema = z.object({
  purchaseId: z.string().min(1),
  receivedById: z.string().min(1),
  requestKey: z.string().uuid(),
  items: z.array(z.object({ purchaseItemId: z.string().min(1), quantity: decimalInput })).min(1),
});

export type ReceivePurchaseInput = z.input<typeof receiveSchema>;

export async function receivePurchase(rawInput: ReceivePurchaseInput) {
  const input = receiveSchema.parse(rawInput);
  if (new Set(input.items.map((item) => item.purchaseItemId)).size !== input.items.length) throw new BusinessRuleError("A purchase item can only appear once per receiving operation.");
  const requestHash = createHash("sha256").update(JSON.stringify({
    purchaseId: input.purchaseId,
    receivedById: input.receivedById,
    items: [...input.items].map(({ purchaseItemId, quantity }) => ({ purchaseItemId, quantity: toDecimal(quantity).toString() })).sort((a, b) => a.purchaseItemId.localeCompare(b.purchaseItemId)),
  })).digest("hex");

  try {
    return await runSerializableTransaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({ where: { id: input.purchaseId }, include: { items: true } });
      if (!purchase) throw new BusinessRuleError("Purchase was not found.", "PURCHASE_NOT_FOUND");
      await assertUserCanAccessStore(tx, input.receivedById, purchase.storeId);
      const priorRequest = await tx.purchaseReceiving.findUnique({ where: { requestKey: input.requestKey } });
      if (priorRequest) {
        if (priorRequest.receivedById !== input.receivedById || priorRequest.requestHash !== requestHash) throw new BusinessRuleError("Receiving request key has already been used for a different operation.", "RECEIVING_KEY_REUSED");
        return { purchaseId: purchase.id, status: purchase.status, receivedItems: priorRequest.itemCount };
      }
      if (purchase.status !== PurchaseStatus.APPROVED && purchase.status !== PurchaseStatus.PARTIALLY_RECEIVED) throw new BusinessRuleError("Purchase must be approved before it can be received.");
      await assertStoreWarehouse(tx, purchase.storeId, purchase.warehouseId);

      const changes: { itemId: string; delta: Prisma.Decimal; productId: string; unitCost: Prisma.Decimal }[] = [];
      for (const received of input.items) {
        const item = purchase.items.find((candidate) => candidate.id === received.purchaseItemId);
        if (!item) throw new BusinessRuleError("Receiving line does not belong to the selected purchase.");
        const delta = toDecimal(received.quantity);
        if (!delta.greaterThan(0)) throw new BusinessRuleError("Received quantity must be greater than zero.");
        const remaining = item.quantity.minus(item.receivedQuantity);
        if (delta.greaterThan(remaining)) throw new BusinessRuleError("Received quantity exceeds the remaining purchase quantity.", "RECEIVED_QUANTITY_EXCEEDED");
        changes.push({ itemId: item.id, delta, productId: item.productId, unitCost: item.unitCost });
      }

      await tx.purchaseReceiving.create({ data: { requestKey: input.requestKey, requestHash, purchaseId: purchase.id, receivedById: input.receivedById, itemCount: changes.length } });
      for (const change of changes) {
        const changed = await tx.purchaseItem.updateMany({
          where: { id: change.itemId, receivedQuantity: purchase.items.find((item) => item.id === change.itemId)!.receivedQuantity },
          data: { receivedQuantity: { increment: change.delta } },
        });
        if (changed.count !== 1) throw new BusinessRuleError("Purchase receiving changed concurrently. Please retry.", "PURCHASE_CONFLICT");
        await increaseStock(tx, {
          productId: change.productId, warehouseId: purchase.warehouseId, quantity: change.delta,
          type: MovementType.PURCHASE, createdById: input.receivedById, unitCost: change.unitCost,
          referenceType: "PURCHASE", referenceId: purchase.id,
        });
      }
      const refreshed = await tx.purchaseItem.findMany({ where: { purchaseId: purchase.id }, select: { quantity: true, receivedQuantity: true } });
      const allReceived = refreshed.every((item) => item.receivedQuantity.greaterThanOrEqualTo(item.quantity));
      const status = allReceived ? PurchaseStatus.RECEIVED : PurchaseStatus.PARTIALLY_RECEIVED;
      await tx.purchase.update({ where: { id: purchase.id }, data: { status } });
      await writeAudit(tx, { userId: input.receivedById, action: "RECEIVED", module: "PURCHASING", entity: "Purchase", entityId: purchase.id, oldValue: { status: purchase.status }, newValue: { status, items: changes.map(({ itemId, delta }) => ({ itemId, receivedNow: delta.toString() })) } });
      return { purchaseId: purchase.id, status, receivedItems: changes.length };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.purchaseReceiving.findUnique({ where: { requestKey: input.requestKey } });
      if (existing?.receivedById === input.receivedById && existing.requestHash === requestHash) {
        const purchase = await prisma.purchase.findUnique({ where: { id: existing.purchaseId }, select: { status: true } });
        if (purchase) return { purchaseId: existing.purchaseId, status: purchase.status, receivedItems: existing.itemCount };
      }
      if (existing) throw new BusinessRuleError("Receiving request key has already been used for a different operation.", "RECEIVING_KEY_REUSED");
    }
    throw error;
  }
}

const purchaseReturnSchema = z.object({
  purchaseId: z.string().min(1),
  processedById: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
  items: z.array(z.object({ purchaseItemId: z.string().min(1), quantity: decimalInput })).min(1),
});

export type ProcessPurchaseReturnInput = z.input<typeof purchaseReturnSchema>;

export async function processPurchaseReturn(rawInput: ProcessPurchaseReturnInput) {
  const input = purchaseReturnSchema.parse(rawInput);
  if (new Set(input.items.map((item) => item.purchaseItemId)).size !== input.items.length) throw new BusinessRuleError("A purchase item can only appear once per return.");
  return runSerializableTransaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({ where: { id: input.purchaseId }, include: { items: { include: { returnedItems: true } } } });
    if (!purchase) throw new BusinessRuleError("Purchase was not found.", "PURCHASE_NOT_FOUND");
    if (purchase.status !== PurchaseStatus.RECEIVED && purchase.status !== PurchaseStatus.PARTIALLY_RECEIVED && purchase.status !== PurchaseStatus.COMPLETED) throw new BusinessRuleError("Only received purchase items can be returned.");
    await assertUserCanAccessStore(tx, input.processedById, purchase.storeId);
    await assertStoreWarehouse(tx, purchase.storeId, purchase.warehouseId);

    const lines = input.items.map((requested) => {
      const original = purchase.items.find((item) => item.id === requested.purchaseItemId);
      if (!original) throw new BusinessRuleError("Return line does not belong to this purchase.");
      const quantity = toDecimal(requested.quantity);
      if (!quantity.greaterThan(0)) throw new BusinessRuleError("Purchase return quantity must be greater than zero.");
      const returned = original.returnedItems.reduce((sum, item) => sum.plus(item.quantity), new Prisma.Decimal(0));
      if (returned.plus(quantity).greaterThan(original.receivedQuantity)) throw new BusinessRuleError("Return quantity exceeds the received quantity still on hand.", "PURCHASE_RETURN_EXCEEDED");
      return { original, quantity, amount: money(original.unitCost.times(quantity)) };
    });
    const amount = lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
    const number = await generateDocumentNumber(tx, "invoice.purchaseReturnPrefix", "PRT");
    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        number, purchaseId: purchase.id, processedById: input.processedById, reason: input.reason, amount,
        items: { create: lines.map(({ original, quantity, amount: lineAmount }) => ({ purchaseItemId: original.id, quantity, amount: lineAmount })) },
      },
      select: { id: true, number: true, amount: true },
    });
    for (const line of lines) {
      await decreaseStock(tx, {
        productId: line.original.productId, warehouseId: purchase.warehouseId, quantity: line.quantity,
        type: MovementType.PURCHASE_RETURN, createdById: input.processedById, unitCost: line.original.unitCost,
        referenceType: "PURCHASE_RETURN", referenceId: purchaseReturn.id,
      });
    }
    await writeAudit(tx, { userId: input.processedById, action: "PROCESSED", module: "PURCHASING", entity: "PurchaseReturn", entityId: purchaseReturn.id, newValue: { number, purchaseId: purchase.id, amount: amount.toString() } });
    return purchaseReturn;
  });
}
