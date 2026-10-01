import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, hasRole, requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { updateCustomer } from "@/lib/actions/catalog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader, StatusBadge, TableFrame } from "@/components/ui/page-header";
import { businessDateRange } from "@/lib/reports/date-range";

const pageSize = 20;
export default async function CustomerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; from?: string; to?: string; status?: string; payment?: string }> }) {
  const user = await requirePermission("customer.manage");
  const [{ id }, filters] = await Promise.all([params, searchParams]);
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const dateFrom = filters.from ? businessDateRange(filters.from) : undefined;
  const dateTo = filters.to ? businessDateRange(filters.to, true) : undefined;
  if ((filters.from && !dateFrom) || (filters.to && !dateTo) || (filters.from && filters.to && filters.from > filters.to)) return <div><PageHeader title="Customer history" description="Sales associated with this customer."/><p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Invalid customer history date range.</p></div>;
  const saleWhere = {
    customerId: id,
    storeId: user.storeId ?? (hasRole(user, "SUPER_ADMIN") ? undefined : "__no_store__"),
    ...(dateFrom || dateTo ? { saleDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    ...(filters.status && ["COMPLETED", "PARTIAL_RETURN", "RETURNED", "CANCELLED"].includes(filters.status) ? { status: filters.status as "COMPLETED" | "PARTIAL_RETURN" | "RETURNED" | "CANCELLED" } : {}),
    ...(filters.payment && ["UNPAID", "PARTIAL", "PAID", "REFUNDED"].includes(filters.payment) ? { paymentStatus: filters.payment as "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" } : {}),
  };
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, customerCode: true, name: true, email: true, phone: true, address: true, status: true, loyaltyPoints: true } });
  if (!customer) notFound();
  const [sales, count, totals] = await Promise.all([
    prisma.sale.findMany({ where: saleWhere, orderBy: { saleDate: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, invoiceNumber: true, saleDate: true, grandTotal: true, status: true, paymentStatus: true } }),
    prisma.sale.count({ where: saleWhere }),
    prisma.sale.aggregate({ where: saleWhere, _sum: { grandTotal: true }, _avg: { grandTotal: true } }),
  ]);
  const input = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const url = (nextPage: number) => `/customers/${id}?page=${nextPage}${filters.from ? `&from=${filters.from}` : ""}${filters.to ? `&to=${filters.to}` : ""}${filters.status ? `&status=${filters.status}` : ""}${filters.payment ? `&payment=${filters.payment}` : ""}`;
  return <div className="max-w-5xl"><PageHeader title={customer.name} description={`${customer.customerCode} · ${customer.email ?? customer.phone ?? "No contact details"}`} action={<Link href="/customers" className="text-sm text-emerald-800">Back to customers</Link>} /><div className="mb-5 flex items-center gap-3"><StatusBadge value={customer.status} /><span className="text-sm text-slate-500">{customer.loyaltyPoints} loyalty points</span></div>
    {hasPermission(user, "customer.manage") && <form action={updateCustomer} className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Update contact</h2><input type="hidden" name="id" value={customer.id} /><label className="text-sm font-medium">Name<input name="name" defaultValue={customer.name} required maxLength={150} className={input} /></label><label className="text-sm font-medium">Email<input name="email" type="email" defaultValue={customer.email ?? ""} maxLength={190} className={input} /></label><label className="text-sm font-medium">Phone<input name="phone" defaultValue={customer.phone ?? ""} maxLength={30} className={input} /></label><label className="text-sm font-medium">Address<input name="address" defaultValue={customer.address ?? ""} maxLength={4000} className={input} /></label><button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white sm:col-span-2">Save customer</button></form>}
    <section className="mb-6 grid gap-3 sm:grid-cols-3"><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Transactions in selected period</p><p className="mt-1 text-xl font-semibold">{count.toLocaleString("id-ID")}</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total sales value</p><p className="mt-1 text-xl font-semibold">{formatCurrency(totals._sum.grandTotal?.toString() ?? "0")}</p></article><article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Average transaction</p><p className="mt-1 text-xl font-semibold">{formatCurrency(totals._avg.grandTotal?.toString() ?? "0")}</p></article></section>
    <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_150px_150px_auto]"><input type="date" name="from" aria-label="From date" defaultValue={filters.from} className={input} /><input type="date" name="to" aria-label="To date" defaultValue={filters.to} className={input} /><select name="status" defaultValue={filters.status ?? "ALL"} className={input}><option value="ALL">All sale statuses</option>{["COMPLETED", "PARTIAL_RETURN", "RETURNED", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select><select name="payment" defaultValue={filters.payment ?? "ALL"} className={input}><option value="ALL">All payment statuses</option>{["UNPAID", "PARTIAL", "PAID", "REFUNDED"].map((value) => <option key={value}>{value}</option>)}</select><button className="rounded-lg border border-slate-300 bg-white px-4 text-sm">Filter</button></form>
    <h2 className="mb-3 font-semibold">Transaction history</h2>{sales.length ? <TableFrame><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Invoice", "Date", "Total", "Payment", "Status"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{sales.map((sale) => <tr key={sale.id}><td className="px-4 py-3"><Link href={`/sales/${sale.id}`} className="font-medium text-emerald-800">{sale.invoiceNumber}</Link></td><td className="px-4 py-3">{formatDate(sale.saleDate)}</td><td className="px-4 py-3">{formatCurrency(sale.grandTotal.toString())}</td><td className="px-4 py-3"><StatusBadge value={sale.paymentStatus} /></td><td className="px-4 py-3"><StatusBadge value={sale.status} /></td></tr>)}</tbody></TableFrame> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No transactions match these filters in your store scope.</p>}
    <div className="mt-4 flex items-center justify-between text-sm"><span>Page {page} of {pageCount} · {count} transactions</span><div className="flex gap-4">{page > 1 && <Link href={url(page - 1)} className="text-emerald-800">Previous</Link>}{page < pageCount && <Link href={url(page + 1)} className="text-emerald-800">Next</Link>}</div></div>
  </div>;
}
