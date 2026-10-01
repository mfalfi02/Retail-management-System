import { MovementType, PaymentType, Prisma, SaleStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { BusinessRuleError } from "@/lib/services/errors";
import { decimalInput, money, moneyInput, toDecimal } from "@/lib/services/decimal";
import { decreaseStock, increaseStock } from "@/lib/services/inventory";
import { writeAudit } from "@/lib/services/audit.service";
import { generateDocumentNumber } from "@/lib/services/numbering.service";
import { assertStoreWarehouse, assertUserCanAccessStore } from "@/lib/services/store-access.service";
import { runSerializableTransaction } from "@/lib/services/transaction.service";

const saleInputSchema = z.object({
  storeId: z.string().min(1),
  warehouseId: z.string().min(1),
  cashierId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  checkoutKey: z.string().uuid().optional(),
  checkoutHash: z.string().length(64).optional(),
  discount: moneyInput.optional(),
  items: z.array(z.object({ productId: z.string().min(1), quantity: decimalInput, discount: moneyInput.optional() })).min(1),
  payments: z.array(z.object({ method: z.nativeEnum(PaymentType), amount: moneyInput, reference: z.string().max(120).optional() })).default([]),
}).refine((input) => Boolean(input.checkoutKey) === Boolean(input.checkoutHash), "Checkout key and payload hash must be provided together.");

export type CompleteSaleInput = z.input<typeof saleInputSchema>;

export async function completeSale(rawInput: CompleteSaleInput) {
  const input = saleInputSchema.parse(rawInput);
  for (const item of input.items) if (toDecimal(item.quantity).isZero()) throw new BusinessRuleError("Sale quantity must be greater than zero.");
  for (const payment of input.payments) if (toDecimal(payment.amount).isZero()) throw new BusinessRuleError("Payment amount must be greater than zero.");

  const operation = () => runSerializableTransaction(async (tx) => {
    await assertUserCanAccessStore(tx, input.cashierId, input.storeId);
    if (input.checkoutKey) {
      const existing = await tx.sale.findUnique({ where: { checkoutKey: input.checkoutKey }, select: { id: true, invoiceNumber: true, grandTotal: true, paymentStatus: true, cashierId: true, checkoutHash: true } });
      if (existing) {
        if (existing.cashierId !== input.cashierId || existing.checkoutHash !== input.checkoutHash) throw new BusinessRuleError("Checkout key has already been used for a different request.", "CHECKOUT_KEY_REUSED");
        return { id: existing.id, invoiceNumber: existing.invoiceNumber, grandTotal: existing.grandTotal, paymentStatus: existing.paymentStatus };
      }
    }
    await assertStoreWarehouse(tx, input.storeId, input.warehouseId);
    if (input.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true, status: true } });
      if (!customer || customer.status !== "ACTIVE") throw new BusinessRuleError("Customer is not active.", "CUSTOMER_NOT_ACTIVE");
    }

    const products = await tx.product.findMany({
      where: { id: { in: input.items.map(({ productId }) => productId) } },
      select: { id: true, name: true, sellingPrice: true, costPrice: true, taxRate: true, status: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    if (productById.size !== new Set(input.items.map(({ productId }) => productId)).size) {
      throw new BusinessRuleError("One or more products do not exist.", "PRODUCT_NOT_FOUND");
    }

    let subtotal = new Prisma.Decimal(0);
    let itemDiscounts = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    let costTotal = new Prisma.Decimal(0);
    const items = [];
    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      if (product.status !== "ACTIVE") throw new BusinessRuleError(`Product ${product.name} is not active.`);
      if (product.sellingPrice.isNegative() || product.costPrice.isNegative() || product.taxRate.isNegative()) throw new BusinessRuleError(`Product ${product.name} has invalid pricing data.`);
      const quantity = toDecimal(item.quantity);
      if (!quantity.greaterThan(0)) throw new BusinessRuleError(`Quantity for ${product.name} must be positive.`);
      const gross = product.sellingPrice.times(quantity);
      const discount = toDecimal(item.discount ?? 0);
      if (discount.greaterThan(gross)) throw new BusinessRuleError(`Discount exceeds the line total for ${product.name}.`);
      const tax = money(gross.minus(discount).times(product.taxRate).dividedBy(100));
      const currentInventory = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: input.warehouseId } }, select: { averageCost: true } });
      const cost = currentInventory?.averageCost ?? product.costPrice;
      subtotal = subtotal.plus(gross);
      itemDiscounts = itemDiscounts.plus(discount);
      taxTotal = taxTotal.plus(tax);
      costTotal = costTotal.plus(cost.times(quantity));
      items.push({ productId: product.id, quantity, unitPrice: product.sellingPrice, unitCost: cost, discount, tax, subtotal: money(gross.minus(discount).plus(tax)) });
    }
    const additionalDiscount = toDecimal(input.discount ?? 0);
    if (additionalDiscount.greaterThan(subtotal.minus(itemDiscounts))) throw new BusinessRuleError("Sale discount exceeds the remaining subtotal.");
    const discount = itemDiscounts.plus(additionalDiscount);
    const grandTotal = money(subtotal.minus(discount).plus(taxTotal));
    const paid = input.payments.reduce((total, payment) => total.plus(toDecimal(payment.amount)), new Prisma.Decimal(0));
    const cashPaid = input.payments.filter(({ method }) => method === PaymentType.CASH).reduce((total, payment) => total.plus(toDecimal(payment.amount)), new Prisma.Decimal(0));
    const change = Prisma.Decimal.max(paid.minus(grandTotal), 0);
    if (change.greaterThan(cashPaid)) throw new BusinessRuleError("Overpayment must be covered by cash payment.");
    const paymentStatus = paid.greaterThanOrEqualTo(grandTotal) ? "PAID" : paid.greaterThan(0) ? "PARTIAL" : "UNPAID";
    const invoiceNumber = await generateDocumentNumber(tx, "invoice.salePrefix", "INV");

    const sale = await tx.sale.create({
      data: {
        invoiceNumber, status: SaleStatus.COMPLETED, paymentStatus, storeId: input.storeId,
        warehouseId: input.warehouseId, cashierId: input.cashierId, customerId: input.customerId,
        checkoutKey: input.checkoutKey, checkoutHash: input.checkoutHash,
        subtotal: money(subtotal), discount: money(discount), tax: money(taxTotal), grandTotal,
        amountPaid: paid, change,
        items: { create: items },
        payments: { create: input.payments.map((payment) => ({ ...payment, amount: toDecimal(payment.amount) })) },
      },
      select: { id: true, invoiceNumber: true, grandTotal: true, paymentStatus: true },
    });

    for (const item of items) {
      await decreaseStock(tx, {
        productId: item.productId, warehouseId: input.warehouseId, quantity: item.quantity,
        type: MovementType.SALE, createdById: input.cashierId, unitCost: item.unitCost,
        referenceType: "SALE", referenceId: sale.id,
      });
    }
    await writeAudit(tx, { userId: input.cashierId, action: "COMPLETED", module: "SALES", entity: "Sale", entityId: sale.id, newValue: { invoiceNumber, grandTotal: grandTotal.toString(), itemCount: items.length, costTotal: costTotal.toString() } });
    return sale;
  });
  try {
    return await operation();
  } catch (error) {
    if (input.checkoutKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.sale.findUnique({ where: { checkoutKey: input.checkoutKey }, select: { id: true, invoiceNumber: true, grandTotal: true, paymentStatus: true, cashierId: true, checkoutHash: true } });
      if (existing && existing.cashierId === input.cashierId && existing.checkoutHash === input.checkoutHash) {
        return { id: existing.id, invoiceNumber: existing.invoiceNumber, grandTotal: existing.grandTotal, paymentStatus: existing.paymentStatus };
      }
    }
    throw error;
  }
}

const returnSchema = z.object({
  saleId: z.string().min(1),
  processedById: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
  refundMethod: z.nativeEnum(PaymentType).optional(),
  refundReference: z.string().max(120).optional(),
  requestKey: z.string().uuid().optional(),
  requestHash: z.string().length(64).optional(),
  items: z.array(z.object({ saleItemId: z.string().min(1), quantity: decimalInput })).min(1),
}).refine((input) => Boolean(input.requestKey) === Boolean(input.requestHash), "Return request key and hash must be provided together.");

export type ProcessSaleReturnInput = z.input<typeof returnSchema>;

export async function processSaleReturn(rawInput: ProcessSaleReturnInput) {
  const input = returnSchema.parse(rawInput);
  if (new Set(input.items.map(({ saleItemId }) => saleItemId)).size !== input.items.length) throw new BusinessRuleError("A sale item can only appear once per return.");
  const operation = () => runSerializableTransaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: input.saleId },
      include: {
        items: { include: { returnedItems: { include: { return: { select: { id: true } } } } } },
        payments: true,
        returns: { select: { settlement: { select: { amount: true } } } },
      },
    });
    if (!sale) throw new BusinessRuleError("Sale was not found.", "SALE_NOT_FOUND");
    if (sale.status !== SaleStatus.COMPLETED && sale.status !== SaleStatus.PARTIAL_RETURN) throw new BusinessRuleError("Only completed sales can be returned.");
    await assertUserCanAccessStore(tx, input.processedById, sale.storeId);
    if (input.requestKey) {
      const existing = await tx.saleReturn.findUnique({ where: { requestKey: input.requestKey }, include: { settlement: true } });
      if (existing) {
        if (existing.saleId !== sale.id || existing.createdById !== input.processedById || existing.requestHash !== input.requestHash || !existing.settlement) {
          throw new BusinessRuleError("Return request key has already been used for a different request.", "RETURN_KEY_REUSED");
        }
        return { id: existing.id, number: existing.number, amount: existing.amount, settlement: existing.settlement };
      }
    }

    const returnLines = input.items.map((requested) => {
      const original = sale.items.find((item) => item.id === requested.saleItemId);
      if (!original) throw new BusinessRuleError("Return item does not belong to this sale.");
      const quantity = toDecimal(requested.quantity);
      if (!quantity.greaterThan(0)) throw new BusinessRuleError("Return quantity must be greater than zero.");
      const alreadyReturned = original.returnedItems.reduce((total, returned) => total.plus(returned.quantity), new Prisma.Decimal(0));
      if (alreadyReturned.plus(quantity).greaterThan(original.quantity)) throw new BusinessRuleError("Return quantity exceeds the remaining returnable quantity.", "RETURN_QUANTITY_EXCEEDED");
      const lineTotal = original.subtotal.times(quantity).dividedBy(original.quantity);
      const saleLineTotal = sale.items.reduce((sum, line) => sum.plus(line.subtotal), new Prisma.Decimal(0));
      const amount = money(saleLineTotal.greaterThan(0) ? lineTotal.times(sale.grandTotal).dividedBy(saleLineTotal) : new Prisma.Decimal(0));
      return { original, quantity, amount };
    });
    const resultingReturnQty = sale.items.reduce((sum, original) => {
      const alreadyReturned = original.returnedItems.reduce((total, item) => total.plus(item.quantity), new Prisma.Decimal(0));
      const thisReturn = returnLines.filter((item) => item.original.id === original.id).reduce((total, item) => total.plus(item.quantity), new Prisma.Decimal(0));
      return sum.plus(alreadyReturned).plus(thisReturn);
    }, new Prisma.Decimal(0));
    const allSoldQty = sale.items.reduce((sum, item) => sum.plus(item.quantity), new Prisma.Decimal(0));
    const fullyReturned = resultingReturnQty.greaterThanOrEqualTo(allSoldQty);
    const alreadyRefunded = sale.returns.reduce((sum, item) => sum.plus(item.settlement?.amount ?? 0), new Prisma.Decimal(0));
    const netPaid = Prisma.Decimal.min(sale.grandTotal, sale.amountPaid.minus(sale.change));
    const refundableRemaining = netPaid.minus(alreadyRefunded);
    let total = returnLines.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    if (fullyReturned) total = sale.grandTotal.minus(alreadyRefunded);
    if (!total.greaterThan(0) || total.greaterThan(refundableRemaining)) {
      throw new BusinessRuleError("Refund amount exceeds the amount paid and still refundable.", "REFUND_AMOUNT_EXCEEDED");
    }
    const refundMethod = input.refundMethod ?? sale.payments[0]?.method ?? PaymentType.CASH;
    const returnItemLines = returnLines.map((line) => ({ ...line }));
    if (fullyReturned && returnItemLines.length) {
      const lineTotal = returnItemLines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
      returnItemLines[returnItemLines.length - 1].amount = money(returnItemLines[returnItemLines.length - 1].amount.plus(total.minus(lineTotal)));
    }
    const number = await generateDocumentNumber(tx, "invoice.returnPrefix", "RET");
    const saleReturn = await tx.saleReturn.create({
      data: {
        number, saleId: sale.id, reason: input.reason, amount: total, requestKey: input.requestKey, requestHash: input.requestHash,
        createdById: input.processedById,
        items: { create: returnItemLines.map(({ original, quantity, amount }) => ({ saleItemId: original.id, quantity, amount })) },
      },
      select: { id: true, number: true, amount: true },
    });
    const refundNumber = await generateDocumentNumber(tx, "invoice.refundPrefix", "RFD");
    const settlement = await tx.refundSettlement.create({
      data: {
        refundNumber, saleId: sale.id, saleReturnId: saleReturn.id, storeId: sale.storeId,
        processedById: input.processedById, method: refundMethod, amount: total,
        reference: input.refundReference || null,
      },
      select: { id: true, refundNumber: true, method: true, amount: true, settledAt: true },
    });

    for (const { original, quantity } of returnLines) {
      await increaseStock(tx, {
        productId: original.productId, warehouseId: sale.warehouseId, quantity,
        type: MovementType.SALE_RETURN, createdById: input.processedById,
        unitCost: original.unitCost, referenceType: "SALE_RETURN", referenceId: saleReturn.id,
      });
    }
    const newStatus = fullyReturned ? SaleStatus.RETURNED : SaleStatus.PARTIAL_RETURN;
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: newStatus,
        ...(newStatus === SaleStatus.RETURNED ? { paymentStatus: "REFUNDED" } : {}),
      },
    });
    await writeAudit(tx, { userId: input.processedById, action: "PROCESSED", module: "SALES", entity: "SaleReturn", entityId: saleReturn.id, newValue: { number, saleId: sale.id, amount: total.toString(), refundNumber, refundMethod } });
    return { ...saleReturn, settlement };
  });
  try {
    return await operation();
  } catch (error) {
    if (input.requestKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.saleReturn.findUnique({ where: { requestKey: input.requestKey }, include: { settlement: true } });
      if (existing && existing.saleId === input.saleId && existing.createdById === input.processedById && existing.requestHash === input.requestHash && existing.settlement) {
        return { id: existing.id, number: existing.number, amount: existing.amount, settlement: existing.settlement };
      }
    }
    throw error;
  }
}
