import { Prisma } from "@prisma/client";

export function calculateAvailableQuantity(
  quantity: Prisma.Decimal,
  reservedQuantity: Prisma.Decimal,
): Prisma.Decimal {
  return quantity.minus(reservedQuantity);
}
