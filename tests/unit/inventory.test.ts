import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateAvailableQuantity } from "@/lib/services/inventory-quantity";
import { decimalInput, money, moneyInput, signedDecimalInput, toDecimal } from "@/lib/services/decimal";

test("available stock is derived from on-hand minus reserved quantity", () => {
  assert.equal(calculateAvailableQuantity(new Prisma.Decimal("12.500"), new Prisma.Decimal("2.250")).toString(), "10.25");
  assert.equal(calculateAvailableQuantity(new Prisma.Decimal("2"), new Prisma.Decimal("3")).toString(), "-1");
});

test("financial values stay decimal-safe and round to two places", () => {
  const value = toDecimal("0.1").plus(toDecimal("0.2"));
  assert.equal(value.toString(), "0.3");
  assert.equal(money(toDecimal("1.005")).toString(), "1.01");
});

test("decimal inputs enforce database precision bounds", () => {
  assert.equal(decimalInput.safeParse("999999999999.999").success, true);
  assert.equal(decimalInput.safeParse("1000000000000").success, false);
  assert.equal(decimalInput.safeParse("1".repeat(100000)).success, false);
  assert.equal(moneyInput.safeParse("9999999999999.99").success, true);
  assert.equal(moneyInput.safeParse("10000000000000").success, false);
  assert.equal(signedDecimalInput.safeParse("-999999999999.999").success, true);
  assert.equal(signedDecimalInput.safeParse("-1000000000000").success, false);
});
