import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, hasRole, requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { updateSupplier } from "@/lib/actions/catalog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader, StatusBadge, TableFrame } from "@/components/ui/page-header";
import { businessDateRange } from "@/lib/reports/date-range";

const pageSize = 20;
export default async function SupplierDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; from?: string; to?: string; status?: string }> }) {
  const user = await requirePermission("supplier.manage");
  const [{ id }, filters] = await Promise.all([params, searchParams]);
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const dateFrom = filters.from ? businessDateRange(filters.from) : undefined;
  const dateTo = filters.to ? businessDateRange(filters.to, true) : undefined;
  if ((filters.from && !dateFrom) || (filters.to && !dateTo) || (filters.from && filters.to && filters.from > filters.to)) return <div><PageHeader title="Supplier history" description="Purchases associated with this supplier."/><p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Invalid supplier history date range.</p></div>;
  const purchaseWhere = {
    supplierId: id,
    storeId: user.storeId ?? (hasRole(user, "SUPER_ADMIN") ? undefined : "__no_store__"),
    ...(dateFrom || dateTo ? { purchaseDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    ...(filters.status && ["DRAFT", "PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "COMPLETED", "CANCELLED"].includes(filters.status) ? { status: filters.status as "DRAFT" | "PENDING" | "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "COMPLETED" | "CANCELLED" } : {}),
  };
  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true, supplierCode: true, name: true, email: true, phone: true, contactPerson: true, address: true, taxNumber: true, status: true } });
  if (!supplier) notFound();
  const [purchases, count, totals] = await Promise.all([
    prisma.purchase.findMany({ where: purchaseWhere, orderBy: { purchaseDate: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, invoiceNumber: true, purchaseDate: true, grandTotal: true, status: true, paymentStatus: true } }),
    prisma.purchase.count({ where: purchaseWhere }),
    prisma.purchase.aggregate({ where: purchaseWhere, _sum: { grandTotal: true }, _avg: { grandTotal: true } }),
  ]);
  const input = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const url = (nextPage: number) => `/suppliers/${id}?page=${nextPage}${filters.from ? `&from=${filters.from}` : ""}${filters.to ? `&to=${filters.to}` : ""}${filters.status ? `&status=${filters.status}` : ""}`;
  return <div className="max-w-5xl"><PageHeader title={supplier.name} description={`${supplier.supplierCode} · ${supplier.email ?? supplier.phone ?? "No contact details"}`} action={<Link href="/suppliers" className="text-sm text-emerald-800">Back to suppliers</Link>} /><div className="mb-5"><StatusBadge value={supplier.status} /></div>
    {hasPermission(user, "supplier.manage") && <form action={updateSupplier} className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Update supplier contact</h2><input type="hidden" name="id" value={supplier.id} /><label className="text-sm font-medium">Name<input name="name" defaultValue={supplier.name} required maxLength={150} className={input} /></label><label className="text-sm font-medium">Contact person<input name="contactPerson" defaultValue={supplier.contactPerson ?? ""} maxLength={120} className={input} /></label><label className="text-sm font-medium">Email<input name="email" type="email" defaultValue={supplier.email ?? ""} maxLength={190} className={input} /></label><label className="text-sm font-medium">Phone<input name="phone" defaultValue={supplier.phone ?? ""} maxLength={30} className={input} /></label><label className="text-sm font-medium">Tax number<input name="taxNumber" defaultValue={supplier.taxNumber ?? ""} maxLength={60} className={input} /></label><label className="text-sm font-medium">Address<input name="address" defaultValue={supplier.address ?? ""} maxLength={4000} className={input} /></label><button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white sm:col-span-2">Save supplier</button></form>}
    <section className="mb-6 grid gap-3 sm:grid-cols-3"><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Purchases in selected period</p><p className="mt-1 text-xl font-semibold">{count.toLocaleString("id-ID")}</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total purchase value</p><p className="mt-1 text-xl font-semibold">{formatCurrency(totals._sum.grandTotal?.toString() ?? "0")}</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Average purchase</p><p className="mt-1 text-xl font-semibold">{formatCurrency(totals._avg.grandTotal?.toString() ?? "0")}</p></article></section>
    <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_180px_auto]"><input type="date" name="from" aria-label="From date" defaultValue={filters.from} className={input} /><input type="date" name="to" aria-label="To date" defaultValue={filters.to} className={input} /><select name="status" defaultValue={filters.status ?? "ALL"} className={input}><option value="ALL">All purchase statuses</option>{["DRAFT", "PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "COMPLETED", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select><button className="rounded-lg border border-slate-300 bg-white px-4 text-sm">Filter</button></form>
    <h2 className="mb-3 font-semibold">Purchase history</h2>{purchases.length ? <TableFrame><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Purchase", "Date", "Total", "Payment", "Status"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{purchases.map((purchase) => <tr key={purchase.id}><td className="px-4 py-3"><Link href={`/purchases/${purchase.id}`} className="font-medium text-emerald-800">{purchase.invoiceNumber}</Link></td><td className="px-4 py-3">{formatDate(purchase.purchaseDate)}</td><td className="px-4 py-3">{formatCurrency(purchase.grandTotal.toString())}</td><td className="px-4 py-3"><StatusBadge value={purchase.paymentStatus} /></td><td className="px-4 py-3"><StatusBadge value={purchase.status} /></td></tr>)}</tbody></TableFrame> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No purchases match these filters in your store scope.</p>}
    <div className="mt-4 flex items-center justify-between text-sm"><span>Page {page} of {pageCount} · {count} purchases</span><div className="flex gap-4">{page > 1 && <Link href={url(page - 1)} className="text-emerald-800">Previous</Link>}{page < pageCount && <Link href={url(page + 1)} className="text-emerald-800">Next</Link>}</div></div>
  </div>;
}
