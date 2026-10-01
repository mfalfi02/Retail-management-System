import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { assertStoreAccess, hasRole, requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { businessDateRange } from "@/lib/reports/date-range";

const reportTypes = ["sales", "purchases", "inventory", "payments", "refunds", "customers", "suppliers", "profit"] as const;

function csvCell(value: unknown) {
  let text = value == null ? "" : value instanceof Date ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(value) : String(value);
  if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export async function GET(request: NextRequest) {
  const user = await requirePermission("report.view");
  const params = request.nextUrl.searchParams;
  const parsed = z.object({ type: z.enum(reportTypes), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), storeId: z.string().min(1).optional(), status: z.string().optional(), payment: z.string().optional() }).safeParse({ type: params.get("type") ?? "", from: params.get("from") || undefined, to: params.get("to") || undefined, storeId: params.get("storeId") || undefined, status: params.get("status") || undefined, payment: params.get("payment") || undefined });
  if (!parsed.success || parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) return Response.json({ error: "Invalid report filters." }, { status: 400 });
  const { type, from, to, storeId, status, payment } = parsed.data;
  if (storeId) assertStoreAccess(user, storeId);
  const scopedStoreId = storeId ?? user.storeId ?? (hasRole(user, "SUPER_ADMIN") ? undefined : "__unauthorized_store_scope__");
  const storeFilter = scopedStoreId ? { storeId: scopedStoreId } : {};
  const start = from ? businessDateRange(from) : undefined;
  const end = to ? businessDateRange(to, true) : undefined;
  if (from && !start || to && !end) return Response.json({ error: "Invalid report filters." }, { status: 400 });
  const dateFilter = start || end ? { gte: start, lte: end } : undefined;
  const customerSaleFilter: Prisma.SaleWhereInput = { ...storeFilter, ...(dateFilter ? { saleDate: dateFilter } : {}), status: { in: ["COMPLETED", "PARTIAL_RETURN", "RETURNED"] } };
  const supplierPurchaseFilter: Prisma.PurchaseWhereInput = { ...storeFilter, ...(dateFilter ? { purchaseDate: dateFilter } : {}), status: { not: "CANCELLED" } };
  const validSalesStatus = ["COMPLETED", "PARTIAL_RETURN", "RETURNED", "CANCELLED"].includes(status ?? "") ? status as "COMPLETED" | "PARTIAL_RETURN" | "RETURNED" | "CANCELLED" : undefined;
  const validPaymentStatus = ["UNPAID", "PARTIAL", "PAID", "REFUNDED"].includes(payment ?? "") ? payment as "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" : undefined;
  let csv: string;

  if (type === "sales") {
    const rows = await prisma.sale.findMany({ where: { ...storeFilter, ...(dateFilter ? { saleDate: dateFilter } : {}), ...(validSalesStatus ? { status: validSalesStatus } : { status: { in: ["COMPLETED", "PARTIAL_RETURN", "RETURNED"] } }), ...(validPaymentStatus ? { paymentStatus: validPaymentStatus } : {}) }, orderBy: { saleDate: "desc" }, take: 10000, select: { invoiceNumber: true, saleDate: true, status: true, paymentStatus: true, subtotal: true, discount: true, tax: true, grandTotal: true, amountPaid: true, change: true, refunds: { where: { ...(dateFilter ? { settledAt: dateFilter } : {}) }, select: { amount: true } }, customer: { select: { name: true } }, store: { select: { name: true } } } });
    csv = toCsv(["Date", "Invoice", "Customer", "Store", "Status", "Payment status", "Subtotal", "Discount", "Tax", "Total", "Refund", "Net", "Paid", "Change"], rows.map((row) => { const refund = row.refunds.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)); return [row.saleDate, row.invoiceNumber, row.customer?.name, row.store.name, row.status, row.paymentStatus, row.subtotal, row.discount, row.tax, row.grandTotal, refund, row.grandTotal.minus(refund), row.amountPaid, row.change]; }));
  } else if (type === "purchases") {
    const validPurchaseStatus = ["DRAFT", "PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "COMPLETED", "CANCELLED"].includes(status ?? "") ? status as "DRAFT" | "PENDING" | "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "COMPLETED" | "CANCELLED" : undefined;
    const rows = await prisma.purchase.findMany({ where: { ...storeFilter, ...(dateFilter ? { purchaseDate: dateFilter } : {}), ...(validPurchaseStatus ? { status: validPurchaseStatus } : { status: { not: "CANCELLED" } }) }, orderBy: { purchaseDate: "desc" }, take: 10000, select: { invoiceNumber: true, purchaseDate: true, status: true, paymentStatus: true, grandTotal: true, supplier: { select: { name: true } }, store: { select: { name: true } } } });
    csv = toCsv(["Purchase", "Date", "Supplier", "Store", "Status", "Payment status", "Total"], rows.map((row) => [row.invoiceNumber, row.purchaseDate, row.supplier.name, row.store.name, row.status, row.paymentStatus, row.grandTotal]));
  } else if (type === "inventory") {
    const rows = await prisma.inventory.findMany({ where: scopedStoreId ? { warehouse: { storeId: scopedStoreId } } : {}, orderBy: { product: { name: "asc" } }, take: 10000, select: { quantity: true, reservedQuantity: true, averageCost: true, warehouse: { select: { name: true, store: { select: { name: true } } } }, product: { select: { name: true, sku: true, minimumStock: true } } } });
    csv = toCsv(["Product", "SKU", "Store", "Warehouse", "On hand", "Reserved", "Available", "Minimum", "Average cost"], rows.map((row) => [row.product.name, row.product.sku, row.warehouse.store.name, row.warehouse.name, row.quantity, row.reservedQuantity, row.quantity.minus(row.reservedQuantity), row.product.minimumStock, row.averageCost]));
  } else if (type === "refunds") {
    const rows = await prisma.refundSettlement.findMany({ where: { ...storeFilter, ...(dateFilter ? { settledAt: dateFilter } : {}) }, orderBy: { settledAt: "desc" }, take: 10000, select: { refundNumber: true, settledAt: true, method: true, amount: true, reference: true, sale: { select: { invoiceNumber: true } }, saleReturn: { select: { number: true, reason: true } }, processedBy: { select: { name: true } }, store: { select: { name: true } } } });
    csv = toCsv(["Refund", "Date", "Sale", "Return", "Store", "Method", "Amount", "Reference", "Reason", "Processed by"], rows.map((row) => [row.refundNumber, row.settledAt, row.sale.invoiceNumber, row.saleReturn.number, row.store.name, row.method, row.amount, row.reference, row.saleReturn.reason, row.processedBy.name]));
  } else if (type === "profit") {
    const rows = await prisma.$queryRaw<Array<{ estimatedGrossMargin: Prisma.Decimal }>>(Prisma.sql`SELECT COALESCE(SUM(s.subtotal - s.discount - s.tax - COALESCE(costs.cost, 0) + COALESCE(returned.returnedCost, 0) - COALESCE(refunds.amount * (s.grandTotal - s.tax) / NULLIF(s.grandTotal, 0), 0)), 0) AS estimatedGrossMargin FROM Sale s LEFT JOIN (SELECT saleId, SUM(unitCost * quantity) AS cost FROM SaleItem GROUP BY saleId) costs ON costs.saleId = s.id LEFT JOIN (SELECT sr.saleId, SUM(ri.quantity * si.unitCost) AS returnedCost FROM SaleReturn sr INNER JOIN SaleReturnItem ri ON ri.returnId = sr.id INNER JOIN SaleItem si ON si.id = ri.saleItemId GROUP BY sr.saleId) returned ON returned.saleId = s.id LEFT JOIN (SELECT saleId, SUM(amount) AS amount FROM RefundSettlement GROUP BY saleId) refunds ON refunds.saleId = s.id WHERE s.status IN ('COMPLETED', 'PARTIAL_RETURN', 'RETURNED') ${scopedStoreId ? Prisma.sql`AND s.storeId = ${scopedStoreId}` : Prisma.empty} ${start ? Prisma.sql`AND s.saleDate >= ${start}` : Prisma.empty} ${end ? Prisma.sql`AND s.saleDate <= ${end}` : Prisma.empty}`);
    csv = toCsv(["Metric", "Amount"], [["Estimated gross margin", rows[0]?.estimatedGrossMargin ?? new Prisma.Decimal(0)]]);
  } else if (type === "payments") {
    const [saleRows, refundRows] = await Promise.all([
      prisma.salePayment.groupBy({ by: ["method"], where: { sale: { ...storeFilter, ...(dateFilter ? { saleDate: dateFilter } : {}), ...(validSalesStatus ? { status: validSalesStatus } : { status: { in: ["COMPLETED", "PARTIAL_RETURN", "RETURNED"] } }), ...(validPaymentStatus ? { paymentStatus: validPaymentStatus } : {}) } }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.refundSettlement.groupBy({ by: ["method"], where: { ...storeFilter, ...(dateFilter ? { settledAt: dateFilter } : {}) }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    csv = toCsv(["Kind", "Method", "Transactions", "Amount"], [...saleRows.map((row) => ["SALE_PAYMENT", row.method, row._count._all, row._sum.amount]), ...refundRows.map((row) => ["REFUND", row.method, row._count._all, row._sum.amount])]);
  } else if (type === "customers") {
    const [rows, aggregates] = await Promise.all([
      prisma.customer.findMany({ where: { sales: { some: customerSaleFilter } }, orderBy: { name: "asc" }, take: 10000, select: { id: true, customerCode: true, name: true, email: true, phone: true, status: true } }),
      prisma.sale.groupBy({ by: ["customerId"], where: { customerId: { not: null }, ...customerSaleFilter }, _count: { _all: true }, _sum: { grandTotal: true } }),
    ]);
    const totals = new Map(aggregates.map((row) => [row.customerId, row]));
    csv = toCsv(["Code", "Customer", "Email", "Phone", "Status", "Transactions in period", "Total spend in period"], rows.map((row) => { const total = totals.get(row.id); return [row.customerCode, row.name, row.email, row.phone, row.status, total?._count._all ?? 0, total?._sum.grandTotal?.toString() ?? "0.00"]; }));
  } else {
    const [rows, aggregates] = await Promise.all([
      prisma.supplier.findMany({ where: { purchases: { some: supplierPurchaseFilter } }, orderBy: { name: "asc" }, take: 10000, select: { id: true, supplierCode: true, name: true, email: true, phone: true, status: true } }),
      prisma.purchase.groupBy({ by: ["supplierId"], where: supplierPurchaseFilter, _count: { _all: true }, _sum: { grandTotal: true } }),
    ]);
    const totals = new Map(aggregates.map((row) => [row.supplierId, row]));
    csv = toCsv(["Code", "Supplier", "Email", "Phone", "Status", "Purchases in period", "Total purchase value"], rows.map((row) => { const total = totals.get(row.id); return [row.supplierCode, row.name, row.email, row.phone, row.status, total?._count._all ?? 0, total?._sum.grandTotal?.toString() ?? "0.00"]; }));
  }
  return new Response(`\uFEFF${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${type}-report.csv"`, "cache-control": "no-store" } });
}
