import { MovementType, Prisma, StockAdjustmentStatus, StockTransferStatus } from "@prisma/client";
import { z } from "zod";
import { BusinessRuleError } from "@/lib/services/errors";
import { decimalInput, signedDecimalInput, toDecimal } from "@/lib/services/decimal";
import { adjustStock, transferStock } from "@/lib/services/inventory";
import { writeAudit } from "@/lib/services/audit.service";
import { generateDocumentNumber } from "@/lib/services/numbering.service";
import { assertStoreWarehouse, assertUserCanAccessStore } from "@/lib/services/store-access.service";
import { runSerializableTransaction } from "@/lib/services/transaction.service";

const transferSchema = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  createdById: z.string().min(1),
  items: z.array(z.object({ productId: z.string().min(1), quantity: decimalInput })).min(1),
});

export type CreateStockTransferInput = z.input<typeof transferSchema>;

export async function createStockTransfer(rawInput: CreateStockTransferInput) {
  const input = transferSchema.parse(rawInput);
  if (input.fromWarehouseId === input.toWarehouseId) throw new BusinessRuleError("Source and destination warehouses must be different.");
  if (new Set(input.items.map(({ productId }) => productId)).size !== input.items.length) throw new BusinessRuleError("A product can only appear once in a transfer.");
  for (const item of input.items) if (!toDecimal(item.quantity).greaterThan(0)) throw new BusinessRuleError("Transfer quantities must be greater than zero.");

  return runSerializableTransaction(async (tx) => {
    const warehouses = await tx.warehouse.findMany({ where: { id: { in: [input.fromWarehouseId, input.toWarehouseId] } }, select: { id: true, storeId: true, status: true } });
    const source = warehouses.find((warehouse) => warehouse.id === input.fromWarehouseId);
    const destination = warehouses.find((warehouse) => warehouse.id === input.toWarehouseId);
    if (!source || !destination || source.status !== "ACTIVE" || destination.status !== "ACTIVE") throw new BusinessRuleError("Both warehouses must exist and be active.");
    await assertStoreWarehouse(tx, source.storeId, source.id);
    await assertStoreWarehouse(tx, destination.storeId, destination.id);
    await assertUserCanAccessStore(tx, input.createdById, source.storeId);
    await assertUserCanAccessStore(tx, input.createdById, destination.storeId);
    const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) }, status: "ACTIVE" }, select: { id: true } });
    if (products.length !== input.items.length) throw new BusinessRuleError("Every transfer product must exist and be active.");
    const number = await generateDocumentNumber(tx, "invoice.transferPrefix", "TRF");
    const transfer = await tx.stockTransfer.create({
      data: {
        number, fromWarehouseId: source.id, toWarehouseId: destination.id,
        createdById: input.createdById, status: StockTransferStatus.PENDING,
        items: { create: input.items.map((item) => ({ productId: item.productId, quantity: toDecimal(item.quantity) })) },
      },
      select: { id: true, number: true, status: true },
    });
    await writeAudit(tx, { userId: input.createdById, action: "CREATED", module: "INVENTORY", entity: "StockTransfer", entityId: transfer.id, newValue: { number, fromWarehouseId: source.id, toWarehouseId: destination.id, status: transfer.status } });
    return transfer;
  });
}

export async function completeStockTransfer(transferId: string, completedById: string) {
  return runSerializableTransaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({ where: { id: transferId }, include: { items: true, fromWarehouse: true, toWarehouse: true } });
    if (!transfer) throw new BusinessRuleError("Stock transfer was not found.", "TRANSFER_NOT_FOUND");
    if (transfer.fromWarehouseId === transfer.toWarehouseId) throw new BusinessRuleError("Source and destination warehouses must be different.");
    if (transfer.status !== StockTransferStatus.PENDING && transfer.status !== StockTransferStatus.IN_TRANSIT) throw new BusinessRuleError("Only pending or in-transit transfers can be completed.");
    await assertUserCanAccessStore(tx, completedById, transfer.fromWarehouse.storeId);
    await assertUserCanAccessStore(tx, completedById, transfer.toWarehouse.storeId);
    await assertStoreWarehouse(tx, transfer.fromWarehouse.storeId, transfer.fromWarehouseId);
    await assertStoreWarehouse(tx, transfer.toWarehouse.storeId, transfer.toWarehouseId);

    for (const item of transfer.items) {
      const inventory = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: transfer.fromWarehouseId } }, select: { averageCost: true } });
      if (!inventory) throw new BusinessRuleError(`No source inventory exists for product ${item.productId}.`, "INSUFFICIENT_STOCK");
      await transferStock(tx, {
        productId: item.productId, fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId,
        quantity: item.quantity, createdById: completedById, referenceId: transfer.id, unitCost: inventory.averageCost,
      });
    }
    await tx.stockTransfer.update({ where: { id: transfer.id }, data: { status: StockTransferStatus.COMPLETED } });
    await writeAudit(tx, { userId: completedById, action: "COMPLETED", module: "INVENTORY", entity: "StockTransfer", entityId: transfer.id, oldValue: { status: transfer.status }, newValue: { status: StockTransferStatus.COMPLETED } });
    return { id: transfer.id, number: transfer.number, status: StockTransferStatus.COMPLETED };
  });
}

const adjustmentSchema = z.object({
  warehouseId: z.string().min(1),
  createdById: z.string().min(1),
  reason: z.string().trim().min(1).max(255),
  items: z.array(z.object({ productId: z.string().min(1), quantityDelta: signedDecimalInput })).min(1),
});

export type CreateStockAdjustmentInput = z.input<typeof adjustmentSchema>;

export async function createStockAdjustment(rawInput: CreateStockAdjustmentInput) {
  const input = adjustmentSchema.parse(rawInput);
  if (new Set(input.items.map(({ productId }) => productId)).size !== input.items.length) throw new BusinessRuleError("A product can only appear once in an adjustment.");
  if (input.items.some(({ quantityDelta }) => toDecimal(quantityDelta).isZero())) throw new BusinessRuleError("Adjustment quantities cannot be zero.");
  return runSerializableTransaction(async (tx) => {
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { id: true, storeId: true, status: true } });
    if (!warehouse || warehouse.status !== "ACTIVE") throw new BusinessRuleError("Warehouse is not active.");
    await assertStoreWarehouse(tx, warehouse.storeId, warehouse.id);
    await assertUserCanAccessStore(tx, input.createdById, warehouse.storeId);
    const products = await tx.product.findMany({ where: { id: { in: input.items.map(({ productId }) => productId) }, status: "ACTIVE" }, select: { id: true } });
    if (products.length !== input.items.length) throw new BusinessRuleError("Every adjustment product must exist and be active.");
    const number = await generateDocumentNumber(tx, "invoice.adjustmentPrefix", "ADJ");
    const adjustment = await tx.stockAdjustment.create({
      data: {
        number, warehouseId: warehouse.id, reason: input.reason, createdById: input.createdById,
        status: StockAdjustmentStatus.DRAFT,
        items: { create: input.items.map((item) => ({ productId: item.productId, quantityDelta: toDecimal(item.quantityDelta) })) },
      },
      select: { id: true, number: true, status: true },
    });
    await writeAudit(tx, { userId: input.createdById, action: "CREATED", module: "INVENTORY", entity: "StockAdjustment", entityId: adjustment.id, newValue: { number, status: adjustment.status, reason: input.reason } });
    return adjustment;
  });
}

export async function approveStockAdjustment(adjustmentId: string, approvedById: string) {
  return runSerializableTransaction(async (tx) => {
    const adjustment = await tx.stockAdjustment.findUnique({ where: { id: adjustmentId }, include: { warehouse: { select: { storeId: true } }, items: { select: { id: true } } } });
    if (!adjustment) throw new BusinessRuleError("Stock adjustment was not found.", "ADJUSTMENT_NOT_FOUND");
    await assertUserCanAccessStore(tx, approvedById, adjustment.warehouse.storeId);
    if (adjustment.status !== StockAdjustmentStatus.DRAFT) throw new BusinessRuleError("Only draft adjustments can be approved.");
    if (adjustment.items.length === 0) throw new BusinessRuleError("Adjustment must include at least one item.");
    const updated = await tx.stockAdjustment.update({ where: { id: adjustmentId }, data: { status: StockAdjustmentStatus.APPROVED } });
    await writeAudit(tx, { userId: approvedById, action: "APPROVED", module: "INVENTORY", entity: "StockAdjustment", entityId: adjustment.id, oldValue: { status: adjustment.status }, newValue: { status: updated.status } });
    return updated;
  });
}

export async function completeStockAdjustment(adjustmentId: string, completedById: string) {
  return runSerializableTransaction(async (tx) => {
    const adjustment = await tx.stockAdjustment.findUnique({ where: { id: adjustmentId }, include: { warehouse: { select: { storeId: true } }, items: true } });
    if (!adjustment) throw new BusinessRuleError("Stock adjustment was not found.", "ADJUSTMENT_NOT_FOUND");
    if (adjustment.status !== StockAdjustmentStatus.APPROVED) throw new BusinessRuleError("Adjustment must be approved before completion.");
    if (adjustment.items.length === 0) throw new BusinessRuleError("Adjustment must include at least one item.");
    await assertUserCanAccessStore(tx, completedById, adjustment.warehouse.storeId);
    await assertStoreWarehouse(tx, adjustment.warehouse.storeId, adjustment.warehouseId);
    for (const item of adjustment.items) {
      const inventory = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: adjustment.warehouseId } }, select: { averageCost: true } });
      await adjustStock(tx, {
        productId: item.productId, warehouseId: adjustment.warehouseId,
        quantityDelta: item.quantityDelta, type: MovementType.ADJUSTMENT, createdById: completedById,
        referenceType: "STOCK_ADJUSTMENT", referenceId: adjustment.id,
        unitCost: inventory?.averageCost ?? new Prisma.Decimal(0),
      });
    }
    await tx.stockAdjustment.update({ where: { id: adjustment.id }, data: { status: StockAdjustmentStatus.COMPLETED } });
    await writeAudit(tx, { userId: completedById, action: "COMPLETED", module: "INVENTORY", entity: "StockAdjustment", entityId: adjustment.id, oldValue: { status: adjustment.status }, newValue: { status: StockAdjustmentStatus.COMPLETED, items: adjustment.items.map(({ productId, quantityDelta }) => ({ productId, quantityDelta: quantityDelta.toString() })) } });
    return { id: adjustment.id, number: adjustment.number, status: StockAdjustmentStatus.COMPLETED };
  });
}
