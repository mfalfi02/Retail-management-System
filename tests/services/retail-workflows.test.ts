import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { MovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calculateAvailableQuantity, increaseStock } from "@/lib/services/inventory";
import { completeSale, processSaleReturn } from "@/lib/services/sales.service";
import { approvePurchase, createPurchase, processPurchaseReturn, receivePurchase } from "@/lib/services/purchases.service";
import { approveStockAdjustment, completeStockAdjustment, createStockAdjustment, completeStockTransfer, createStockTransfer } from "@/lib/services/stock-documents.service";
import { createBalancedJournal } from "@/lib/services/accounting.service";
import { BusinessRuleError } from "@/lib/services/errors";
import { runSerializableTransaction } from "@/lib/services/transaction.service";

test("critical retail workflows preserve stock and transaction rules", async (t) => {
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "superadmin" }, select: { id: true } });
  const category = await prisma.category.findUniqueOrThrow({ where: { name: "General" }, select: { id: true } });
  const brand = await prisma.brand.findUniqueOrThrow({ where: { name: "House Brand" }, select: { id: true } });
  const unit = await prisma.unit.findUniqueOrThrow({ where: { symbol: "pcs" }, select: { id: true } });
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { supplierCode: "SUP-001" }, select: { id: true } });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { customerCode: "CUS-001" }, select: { id: true } });
  const debitAccount = await prisma.account.findUniqueOrThrow({ where: { code: "1000" }, select: { id: true } });
  const creditAccount = await prisma.account.findUniqueOrThrow({ where: { code: "4000" }, select: { id: true } });
  const store = await prisma.store.create({ data: { code: `T-${suffix}`, name: `Service Test ${suffix}` } });
  const sourceWarehouse = await prisma.warehouse.create({ data: { code: "SRC", name: "Test Source", storeId: store.id } });
  const targetWarehouse = await prisma.warehouse.create({ data: { code: "DST", name: "Test Destination", storeId: store.id } });
  const product = await prisma.product.create({ data: {
    sku: `TEST-${suffix}`, barcode: `TEST${suffix}`, name: `Service Test Product ${suffix}`,
    costPrice: "5.00", sellingPrice: "12.50", minimumStock: "0", categoryId: category.id, brandId: brand.id, unitId: unit.id,
  } });

  const madeRecords = { saleId: "", crossSaleId: "", limitedSaleId: "", returnId: "", fullReturnId: "", purchaseId: "", crossPurchaseId: "", failedReceivingPurchaseId: "", purchaseReturnId: "", adjustmentId: "", failedAdjustmentId: "", transferId: "", failedTransferId: "", journalId: "", wrongStoreId: "", wrongStoreUserId: "", wrongWarehouseId: "" };
  try {
    assert.equal(calculateAvailableQuantity(new Prisma.Decimal("10"), new Prisma.Decimal("3")).toString(), "7");
    await t.test("initial inventory has a movement and is transactional", async () => {
      await runSerializableTransaction((tx) => increaseStock(tx, {
        productId: product.id, warehouseId: sourceWarehouse.id, quantity: new Prisma.Decimal("20"),
        type: MovementType.INITIAL_STOCK, createdById: admin.id, unitCost: new Prisma.Decimal("5"), referenceType: "TEST",
      }));
      const row = await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } });
      assert.equal(row.quantity.toString(), "20");
      assert.equal(await prisma.stockMovement.count({ where: { productId: product.id, type: MovementType.INITIAL_STOCK } }), 1);
    });

    await t.test("purchase receiving applies only newly received quantities", async () => {
      const purchase = await createPurchase({
        supplierId: supplier.id, storeId: store.id, warehouseId: sourceWarehouse.id, createdById: admin.id,
        items: [{ productId: product.id, quantity: "10", unitCost: "5.00" }],
      });
      madeRecords.purchaseId = purchase.id;
      await approvePurchase(purchase.id, admin.id);
      const line = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: purchase.id } });
      const firstReceiving = { purchaseId: purchase.id, receivedById: admin.id, requestKey: randomUUID(), items: [{ purchaseItemId: line.id, quantity: "4" }] };
      await receivePurchase(firstReceiving);
      await receivePurchase(firstReceiving);
      assert.equal((await prisma.purchaseItem.findUniqueOrThrow({ where: { id: line.id } })).receivedQuantity.toString(), "4");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "24");
      assert.equal(await prisma.stockMovement.count({ where: { productId: product.id, type: MovementType.PURCHASE, referenceId: purchase.id } }), 1);
      await assert.rejects(receivePurchase({ ...firstReceiving, items: [{ purchaseItemId: line.id, quantity: "2" }] }), (error: unknown) => error instanceof BusinessRuleError && error.code === "RECEIVING_KEY_REUSED");
      await assert.rejects(receivePurchase({ purchaseId: purchase.id, receivedById: "missing-user", requestKey: randomUUID(), items: [{ purchaseItemId: line.id, quantity: "1" }] }), BusinessRuleError);
      const wrongStore = await prisma.store.create({ data: { code: `X-${suffix}`, name: `Other Scope ${suffix}` } });
      madeRecords.wrongStoreId = wrongStore.id;
      const otherWarehouse = await prisma.warehouse.create({ data: { code: "OTH", name: "Other Scope Warehouse", storeId: wrongStore.id } });
      madeRecords.wrongWarehouseId = otherWarehouse.id;
      const wrongStoreUser = await prisma.user.create({ data: { name: "Wrong Store Test", username: `scope-${suffix.toLowerCase()}`, passwordHash: "integration-test", storeId: wrongStore.id } });
      madeRecords.wrongStoreUserId = wrongStoreUser.id;
      await assert.rejects(receivePurchase({ purchaseId: purchase.id, receivedById: wrongStoreUser.id, requestKey: randomUUID(), items: [{ purchaseItemId: line.id, quantity: "1" }] }), (error: unknown) => error instanceof BusinessRuleError && error.code === "STORE_ACCESS_DENIED");
      const otherPurchase = await createPurchase({ supplierId: supplier.id, storeId: wrongStore.id, warehouseId: otherWarehouse.id, createdById: admin.id, items: [{ productId: product.id, quantity: "2", unitCost: "5" }] });
      madeRecords.crossPurchaseId = otherPurchase.id;
      await runSerializableTransaction((tx) => increaseStock(tx, { productId: product.id, warehouseId: otherWarehouse.id, quantity: new Prisma.Decimal("2"), type: MovementType.INITIAL_STOCK, createdById: admin.id, unitCost: new Prisma.Decimal("5"), referenceType: "TEST" }));
      const otherSale = await completeSale({ storeId: wrongStore.id, warehouseId: otherWarehouse.id, cashierId: admin.id, customerId: customer.id, items: [{ productId: product.id, quantity: "1" }], payments: [] });
      madeRecords.crossSaleId = otherSale.id;
      assert.equal((await prisma.sale.aggregate({ where: { customerId: customer.id, storeId: store.id }, _count: { _all: true } }))._count._all, 0);
      assert.equal((await prisma.sale.aggregate({ where: { customerId: customer.id, storeId: wrongStore.id }, _count: { _all: true } }))._count._all, 1);
      assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: { _count: { select: { sales: { where: { storeId: wrongStore.id } } } } } }))._count.sales, 1);
      assert.equal((await prisma.purchase.aggregate({ where: { supplierId: supplier.id, storeId: store.id }, _count: { _all: true } }))._count._all, 1);
      assert.equal((await prisma.purchase.aggregate({ where: { supplierId: supplier.id, storeId: wrongStore.id }, _count: { _all: true } }))._count._all, 1);
      assert.equal((await prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id }, include: { _count: { select: { purchases: { where: { storeId: wrongStore.id } } } } } }))._count.purchases, 1);
      await receivePurchase({ ...firstReceiving, requestKey: randomUUID(), items: [{ purchaseItemId: line.id, quantity: "3" }] });
      assert.equal((await prisma.purchaseItem.findUniqueOrThrow({ where: { id: line.id } })).receivedQuantity.toString(), "7");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "27");
      assert.equal(await prisma.stockMovement.count({ where: { productId: product.id, type: MovementType.PURCHASE, referenceId: purchase.id } }), 2);
      await assert.rejects(receivePurchase({ purchaseId: purchase.id, receivedById: admin.id, requestKey: randomUUID(), items: [{ purchaseItemId: line.id, quantity: "4" }] }), BusinessRuleError);
      assert.equal((await prisma.purchaseItem.findUniqueOrThrow({ where: { id: line.id } })).receivedQuantity.toString(), "7");
      const failingPurchase = await createPurchase({ supplierId: supplier.id, storeId: store.id, warehouseId: sourceWarehouse.id, createdById: admin.id, items: [{ productId: product.id, quantity: "1", unitCost: "5" }, { productId: product.id, quantity: "999999999999.999", unitCost: "5" }] });
      madeRecords.failedReceivingPurchaseId = failingPurchase.id;
      await approvePurchase(failingPurchase.id, admin.id);
      const failingLines = await prisma.purchaseItem.findMany({ where: { purchaseId: failingPurchase.id }, orderBy: { quantity: "asc" } });
      await assert.rejects(receivePurchase({ purchaseId: failingPurchase.id, receivedById: admin.id, requestKey: randomUUID(), items: failingLines.map((item) => ({ purchaseItemId: item.id, quantity: item.quantity.toString() })) }));
      assert.deepEqual((await prisma.purchaseItem.findMany({ where: { purchaseId: failingPurchase.id } })).map((item) => item.receivedQuantity.toString()), ["0", "0"]);
      assert.equal(await prisma.purchaseReceiving.count({ where: { purchaseId: failingPurchase.id } }), 0);
      assert.equal(await prisma.stockMovement.count({ where: { productId: product.id, type: MovementType.PURCHASE, referenceId: failingPurchase.id } }), 0);
      const returned = await processPurchaseReturn({ purchaseId: purchase.id, processedById: admin.id, reason: "Test return", items: [{ purchaseItemId: line.id, quantity: "2" }] });
      madeRecords.purchaseReturnId = returned.id;
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "25");
      const supplierHistory = await prisma.purchase.aggregate({ where: { supplierId: supplier.id, storeId: store.id }, _count: { _all: true }, _sum: { grandTotal: true } });
      const supplierPage = await prisma.purchase.findMany({ where: { supplierId: supplier.id, storeId: store.id }, orderBy: { purchaseDate: "desc" }, skip: 0, take: 1, select: { id: true } });
      assert.equal(supplierHistory._count._all, 1);
      assert.equal(supplierHistory._sum.grandTotal?.equals(purchase.grandTotal), true);
      assert.equal(supplierPage[0]?.id, purchase.id);
      await assert.rejects(processPurchaseReturn({ purchaseId: purchase.id, processedById: admin.id, reason: "Too much", items: [{ purchaseItemId: line.id, quantity: "6" }] }), BusinessRuleError);
    });

    await t.test("sale rolls back on oversell, and valid return restores stock", async () => {
      await assert.rejects(completeSale({
        storeId: store.id, warehouseId: sourceWarehouse.id, cashierId: admin.id,
        items: [{ productId: product.id, quantity: "30" }], payments: [],
      }), BusinessRuleError);
      assert.equal(await prisma.sale.count({ where: { storeId: store.id } }), 0);
      const checkout = {
        storeId: store.id, warehouseId: sourceWarehouse.id, cashierId: admin.id, customerId: customer.id,
        checkoutKey: randomUUID(), checkoutHash: "a".repeat(64),
        items: [{ productId: product.id, quantity: "5" }], payments: [{ method: "CASH" as const, amount: "100.00" }],
      };
      const sale = await completeSale(checkout);
      madeRecords.saleId = sale.id;
      const repeated = await completeSale(checkout);
      assert.equal(repeated.id, sale.id);
      assert.equal(await prisma.sale.count({ where: { storeId: store.id } }), 1);
      await assert.rejects(completeSale({ ...checkout, checkoutHash: "b".repeat(64) }), BusinessRuleError);
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "20");
      const saleItem = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
      const returnRequest = { saleId: sale.id, processedById: admin.id, reason: "Test return", requestKey: randomUUID(), requestHash: "c".repeat(64), items: [{ saleItemId: saleItem.id, quantity: "2" }] };
      const returned = await processSaleReturn(returnRequest);
      madeRecords.returnId = returned.id;
      assert.equal(returned.settlement.method, "CASH");
      assert.ok(returned.settlement.amount.greaterThan(0));
      assert.equal((await processSaleReturn(returnRequest)).id, returned.id);
      await assert.rejects(processSaleReturn({ ...returnRequest, requestHash: "d".repeat(64) }), BusinessRuleError);
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "22");
      await assert.rejects(processSaleReturn({ saleId: sale.id, processedById: admin.id, reason: "Too much", items: [{ saleItemId: saleItem.id, quantity: "4" }] }), BusinessRuleError);
      assert.equal(await prisma.saleReturn.count({ where: { saleId: sale.id } }), 1);
      const finalReturn = await processSaleReturn({ saleId: sale.id, processedById: admin.id, reason: "Remaining items returned", items: [{ saleItemId: saleItem.id, quantity: "3" }] });
      madeRecords.fullReturnId = finalReturn.id;
      const returnedSale = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id }, select: { status: true, paymentStatus: true } });
      assert.equal(returnedSale.status, "RETURNED");
      assert.equal(returnedSale.paymentStatus, "REFUNDED");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "25");
      const settlements = await prisma.refundSettlement.findMany({ where: { saleId: sale.id }, orderBy: { settledAt: "asc" } });
      assert.equal(settlements.length, 2);
      assert.equal(settlements.reduce((sum, settlement) => sum.plus(settlement.amount), new Prisma.Decimal(0)).equals(new Prisma.Decimal("62.50")), true);
      assert.ok(await prisma.auditLog.findFirst({ where: { entity: "SaleReturn", entityId: finalReturn.id, action: "PROCESSED" } }));
      const customerHistory = await prisma.sale.aggregate({ where: { customerId: customer.id, storeId: store.id }, _count: { _all: true }, _sum: { grandTotal: true }, _avg: { grandTotal: true } });
      const customerPage = await prisma.sale.findMany({ where: { customerId: customer.id, storeId: store.id }, orderBy: { saleDate: "desc" }, skip: 0, take: 1, select: { id: true } });
      assert.equal(customerHistory._count._all, 1);
      assert.equal(customerHistory._sum.grandTotal?.equals(new Prisma.Decimal("62.50")), true);
      assert.equal(customerHistory._avg.grandTotal?.equals(new Prisma.Decimal("62.50")), true);
      assert.equal(customerPage[0]?.id, sale.id);
      assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: { _count: { select: { sales: { where: { storeId: store.id } } } } } }))._count.sales, 1);
      assert.equal((await prisma.sale.aggregate({ where: { customerId: customer.id, storeId: madeRecords.wrongStoreId }, _count: { _all: true } }))._count._all, 1);
      const underpaidSale = await completeSale({ storeId: store.id, warehouseId: sourceWarehouse.id, cashierId: admin.id, items: [{ productId: product.id, quantity: "1" }], payments: [{ method: "CARD", amount: "1.00" }] });
      madeRecords.limitedSaleId = underpaidSale.id;
      const underpaidItem = await prisma.saleItem.findFirstOrThrow({ where: { saleId: underpaidSale.id } });
      await assert.rejects(processSaleReturn({ saleId: underpaidSale.id, processedById: admin.id, reason: "Refund exceeds paid amount", items: [{ saleItemId: underpaidItem.id, quantity: "1" }] }), (error: unknown) => error instanceof BusinessRuleError && error.code === "REFUND_AMOUNT_EXCEEDED");
      assert.equal(await prisma.saleReturn.count({ where: { saleId: underpaidSale.id } }), 0);
    });

    await t.test("adjustments remain draft until approved and completed", async () => {
      const adjustment = await createStockAdjustment({ warehouseId: sourceWarehouse.id, createdById: admin.id, reason: "Count correction", items: [{ productId: product.id, quantityDelta: "3" }] });
      madeRecords.adjustmentId = adjustment.id;
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "24");
      await approveStockAdjustment(adjustment.id, admin.id);
      await completeStockAdjustment(adjustment.id, admin.id);
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "27");
      const negative = await createStockAdjustment({ warehouseId: sourceWarehouse.id, createdById: admin.id, reason: "Invalid shortage", items: [{ productId: product.id, quantityDelta: "-100" }] });
      madeRecords.failedAdjustmentId = negative.id;
      await approveStockAdjustment(negative.id, admin.id);
      await assert.rejects(completeStockAdjustment(negative.id, admin.id), BusinessRuleError);
    });

    await t.test("transfers reject same warehouse and balance both locations", async () => {
      await assert.rejects(createStockTransfer({ fromWarehouseId: sourceWarehouse.id, toWarehouseId: sourceWarehouse.id, createdById: admin.id, items: [{ productId: product.id, quantity: "1" }] }), BusinessRuleError);
      const transfer = await createStockTransfer({ fromWarehouseId: sourceWarehouse.id, toWarehouseId: targetWarehouse.id, createdById: admin.id, items: [{ productId: product.id, quantity: "5" }] });
      madeRecords.transferId = transfer.id;
      await completeStockTransfer(transfer.id, admin.id);
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: sourceWarehouse.id } } })).quantity.toString(), "22");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: targetWarehouse.id } } })).quantity.toString(), "5");
      const movementTypes = await prisma.stockMovement.findMany({ where: { referenceId: transfer.id }, select: { type: true } });
      assert.deepEqual(new Set(movementTypes.map(({ type }) => type)), new Set([MovementType.TRANSFER_IN, MovementType.TRANSFER_OUT]));
      const excessive = await createStockTransfer({ fromWarehouseId: sourceWarehouse.id, toWarehouseId: targetWarehouse.id, createdById: admin.id, items: [{ productId: product.id, quantity: "100" }] });
      madeRecords.failedTransferId = excessive.id;
      await assert.rejects(completeStockTransfer(excessive.id, admin.id), BusinessRuleError);
    });

    await t.test("journal rejects unbalanced entries and accepts balanced entries", async () => {
      await assert.rejects(createBalancedJournal({ createdById: admin.id, entries: [{ accountId: debitAccount.id, debit: "10.00", credit: "0" }, { accountId: creditAccount.id, debit: "0", credit: "9.00" }] }), BusinessRuleError);
      const journal = await createBalancedJournal({ createdById: admin.id, description: "Service test", entries: [{ accountId: debitAccount.id, debit: "10.00", credit: "0" }, { accountId: creditAccount.id, debit: "0", credit: "10.00" }] });
      madeRecords.journalId = journal.id;
    });
  } finally {
    await prisma.$transaction(async (tx) => {
      const returnIds = [madeRecords.returnId, madeRecords.fullReturnId].filter(Boolean);
      if (returnIds.length) {
        await tx.refundSettlement.deleteMany({ where: { saleReturnId: { in: returnIds } } });
        await tx.saleReturnItem.deleteMany({ where: { returnId: { in: returnIds } } });
        await tx.saleReturn.deleteMany({ where: { id: { in: returnIds } } });
      }
      if (madeRecords.purchaseReturnId) {
        await tx.purchaseReturnItem.deleteMany({ where: { returnId: madeRecords.purchaseReturnId || "__none__" } });
        await tx.purchaseReturn.deleteMany({ where: { id: madeRecords.purchaseReturnId || "__none__" } });
      }
      if (madeRecords.saleId) await tx.sale.deleteMany({ where: { id: madeRecords.saleId } });
      if (madeRecords.crossSaleId) await tx.sale.deleteMany({ where: { id: madeRecords.crossSaleId } });
      if (madeRecords.limitedSaleId) await tx.sale.deleteMany({ where: { id: madeRecords.limitedSaleId } });
      if (madeRecords.purchaseId) await tx.purchase.deleteMany({ where: { id: madeRecords.purchaseId } });
      if (madeRecords.crossPurchaseId) await tx.purchase.deleteMany({ where: { id: madeRecords.crossPurchaseId } });
      if (madeRecords.failedReceivingPurchaseId) await tx.purchase.deleteMany({ where: { id: madeRecords.failedReceivingPurchaseId } });
      if (madeRecords.transferId) await tx.stockTransfer.deleteMany({ where: { id: madeRecords.transferId } });
      if (madeRecords.failedTransferId) await tx.stockTransfer.deleteMany({ where: { id: madeRecords.failedTransferId } });
      if (madeRecords.adjustmentId) await tx.stockAdjustment.deleteMany({ where: { id: madeRecords.adjustmentId } });
      if (madeRecords.failedAdjustmentId) await tx.stockAdjustment.deleteMany({ where: { id: madeRecords.failedAdjustmentId } });
      if (madeRecords.journalId) await tx.journal.deleteMany({ where: { id: madeRecords.journalId } });
      await tx.auditLog.deleteMany({ where: { userId: admin.id, entityId: { in: [madeRecords.saleId, madeRecords.crossSaleId, madeRecords.limitedSaleId, madeRecords.returnId, madeRecords.fullReturnId, madeRecords.purchaseId, madeRecords.crossPurchaseId, madeRecords.failedReceivingPurchaseId, madeRecords.purchaseReturnId, madeRecords.adjustmentId, madeRecords.failedAdjustmentId, madeRecords.transferId, madeRecords.failedTransferId, madeRecords.journalId].filter(Boolean) } } });
      await tx.stockMovement.deleteMany({ where: { productId: product.id } });
      await tx.inventory.deleteMany({ where: { productId: product.id } });
      await tx.product.delete({ where: { id: product.id } });
      await tx.warehouse.deleteMany({ where: { id: { in: [sourceWarehouse.id, targetWarehouse.id] } } });
      if (madeRecords.wrongStoreUserId) await tx.user.deleteMany({ where: { id: madeRecords.wrongStoreUserId } });
      if (madeRecords.wrongWarehouseId) await tx.warehouse.deleteMany({ where: { id: madeRecords.wrongWarehouseId } });
      if (madeRecords.wrongStoreId) await tx.store.deleteMany({ where: { id: madeRecords.wrongStoreId } });
      await tx.store.delete({ where: { id: store.id } });
    });
  }
});
