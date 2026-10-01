import { MovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { BusinessRuleError } from "@/lib/services/errors";
import { calculateAvailableQuantity } from "@/lib/services/inventory-quantity";
import { allowsNegativeInventory } from "@/lib/services/numbering.service";

export { calculateAvailableQuantity } from "@/lib/services/inventory-quantity";

export async function getInventory(productId: string, warehouseId: string) {
  return prisma.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
}

export async function getAvailableQuantity(productId: string, warehouseId: string) {
  const inventory = await getInventory(productId, warehouseId);
  if (!inventory) return new Prisma.Decimal(0);
  return calculateAvailableQuantity(inventory.quantity, inventory.reservedQuantity);
}

export type StockMovementInput = {
  productId: string;
  warehouseId: string;
  quantity: Prisma.Decimal;
  type: MovementType;
  createdById?: string;
  unitCost?: Prisma.Decimal;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
};

export async function createStockMovement(tx: Prisma.TransactionClient, input: StockMovementInput) {
  if (!input.quantity.greaterThan(0)) throw new BusinessRuleError("Stock movement quantity must be greater than zero.");
  return tx.stockMovement.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      type: input.type,
      createdById: input.createdById,
      unitCost: input.unitCost,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes,
    },
  });
}

async function ensureInventoryRow(
  tx: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
  initialCost: Prisma.Decimal,
) {
  return tx.inventory.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: {},
    create: { productId, warehouseId, quantity: 0, reservedQuantity: 0, averageCost: initialCost },
  });
}

export async function increaseStock(
  tx: Prisma.TransactionClient,
  input: Omit<StockMovementInput, "quantity"> & { quantity: Prisma.Decimal },
) {
  if (!input.quantity.greaterThan(0)) throw new BusinessRuleError("Stock increase quantity must be greater than zero.");
  const row = await ensureInventoryRow(tx, input.productId, input.warehouseId, input.unitCost ?? new Prisma.Decimal(0));
  const cost = input.unitCost ?? row.averageCost;
  const newQuantity = row.quantity.plus(input.quantity);
  const newAverageCost = row.quantity.greaterThan(0) && newQuantity.greaterThan(0)
    ? row.quantity.times(row.averageCost).plus(input.quantity.times(cost)).dividedBy(newQuantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : cost;

  await tx.inventory.update({
    where: { id: row.id },
    data: { quantity: { increment: input.quantity }, averageCost: newAverageCost },
  });
  return createStockMovement(tx, { ...input, type: input.type });
}

export async function decreaseStock(
  tx: Prisma.TransactionClient,
  input: Omit<StockMovementInput, "quantity"> & { quantity: Prisma.Decimal },
) {
  if (!input.quantity.greaterThan(0)) throw new BusinessRuleError("Stock decrease quantity must be greater than zero.");
  const negativeAllowed = await allowsNegativeInventory(tx);
  const row = await ensureInventoryRow(tx, input.productId, input.warehouseId, input.unitCost ?? new Prisma.Decimal(0));
  const available = calculateAvailableQuantity(row.quantity, row.reservedQuantity);
  if (!negativeAllowed && available.lessThan(input.quantity)) {
    throw new BusinessRuleError(`Insufficient available stock for product ${input.productId}.`, "INSUFFICIENT_STOCK");
  }

  const updated = await tx.inventory.updateMany({
    where: {
      id: row.id,
      ...(negativeAllowed ? {} : { quantity: { gte: row.reservedQuantity.plus(input.quantity) } }),
    },
    data: { quantity: { decrement: input.quantity } },
  });
  if (updated.count !== 1) throw new BusinessRuleError("Inventory changed during this operation. Please retry.", "STOCK_CONFLICT");
  return createStockMovement(tx, { ...input, type: input.type });
}

export async function adjustStock(
  tx: Prisma.TransactionClient,
  input: Omit<StockMovementInput, "quantity"> & { quantityDelta: Prisma.Decimal },
) {
  if (input.quantityDelta.isZero()) throw new BusinessRuleError("Stock adjustment cannot be zero.");
  const { quantityDelta, ...movement } = input;
  if (quantityDelta.greaterThan(0)) {
    return increaseStock(tx, { ...movement, quantity: quantityDelta, type: MovementType.ADJUSTMENT });
  }
  return decreaseStock(tx, { ...movement, quantity: quantityDelta.abs(), type: MovementType.ADJUSTMENT });
}

export async function transferStock(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: Prisma.Decimal;
    createdById: string;
    referenceId: string;
    unitCost: Prisma.Decimal;
  },
) {
  if (input.fromWarehouseId === input.toWarehouseId) throw new BusinessRuleError("Source and destination warehouses must be different.");
  if (!input.quantity.greaterThan(0)) throw new BusinessRuleError("Transfer quantity must be greater than zero.");
  await decreaseStock(tx, {
    productId: input.productId,
    warehouseId: input.fromWarehouseId,
    quantity: input.quantity,
    type: MovementType.TRANSFER_OUT,
    createdById: input.createdById,
    referenceType: "STOCK_TRANSFER",
    referenceId: input.referenceId,
    unitCost: input.unitCost,
  });
  await increaseStock(tx, {
    productId: input.productId,
    warehouseId: input.toWarehouseId,
    quantity: input.quantity,
    type: MovementType.TRANSFER_IN,
    createdById: input.createdById,
    referenceType: "STOCK_TRANSFER",
    referenceId: input.referenceId,
    unitCost: input.unitCost,
  });
}
