import { Prisma } from "@prisma/client";
import { z } from "zod";

const MAX_QUANTITY = 999_999_999_999.999;
const MAX_MONEY = 9_999_999_999_999.99;

export const decimalInput = z.union([
  z.string().trim().max(16).regex(/^\d{1,12}(\.\d{1,3})?$/, "Enter a valid decimal amount."),
  z.number().finite().nonnegative().max(MAX_QUANTITY),
]);

export const moneyInput = z.union([
  z.string().trim().max(16).regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter a valid money amount."),
  z.number().finite().nonnegative().max(MAX_MONEY),
]);

export const signedDecimalInput = z.union([
  z.string().trim().max(17).regex(/^-?\d{1,12}(\.\d{1,3})?$/, "Enter a valid decimal amount."),
  z.number().finite().min(-MAX_QUANTITY).max(MAX_QUANTITY),
]);

export type DecimalInput = z.infer<typeof decimalInput> | z.infer<typeof moneyInput> | z.infer<typeof signedDecimalInput>;

export function toDecimal(value: DecimalInput | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
