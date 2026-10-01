import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

test("generated Prisma client exposes delegates used by dashboard and reports aggregates", async () => {
  const prisma = new PrismaClient();
  try {
    for (const model of ["sale", "purchase", "refundSettlement"]) {
      const delegate = prisma[model as keyof PrismaClient];
      assert.ok(delegate, `Prisma delegate ${model} must exist in the generated client`);
      assert.equal(typeof (delegate as { aggregate?: unknown }).aggregate, "function", `${model}.aggregate must be available`);
    }
  } finally {
    await prisma.$disconnect();
  }
});
