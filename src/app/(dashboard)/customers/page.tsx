import Link from "next/link";
import { Plus } from "lucide-react";
import { authorizedStoreScopeId, requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/auth/authorization";
import { PageHeader, StatusBadge, TableFrame } from "@/components/ui/page-header";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; created?: string }> }) {
  const user = await requirePermission("customer.manage");
  const storeId = authorizedStoreScopeId(user);
  const { q = "", created } = await searchParams;
  const customers = await prisma.customer.findMany({ where: q ? { OR: [{ name: { contains: q } }, { customerCode: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] } : {}, orderBy: { name: "asc" }, take: 100, include: { _count: { select: { sales: { where: storeId ? { storeId } : {} } } } } });
  return <div><PageHeader title="Customers" description="Customer records and purchase activity." action={hasPermission(user,"customer.manage")?<Link href="/customers/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white"><Plus size={16}/> Add customer</Link>:null}/>{created&&<p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Customer {created} created.</p>}<form className="mb-4 flex gap-2"><input name="q" defaultValue={q} placeholder="Search customer name, code, email, phone" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"/><button className="rounded-lg border border-slate-300 bg-white px-4 text-sm">Search</button></form>{customers.length?<TableFrame><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Code", "Customer", "Contact", "Transactions", "Loyalty", "Status"].map((name)=><th key={name} className="px-4 py-3 font-medium">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{customers.map((customer)=><tr key={customer.id}><td className="px-4 py-3 font-mono text-xs">{customer.customerCode}</td><td className="px-4 py-3 font-medium"><Link href={`/customers/${customer.id}`} className="text-emerald-800 hover:underline">{customer.name}</Link></td><td className="px-4 py-3 text-slate-600">{customer.email??customer.phone??"—"}</td><td className="px-4 py-3">{customer._count.sales}</td><td className="px-4 py-3">{customer.loyaltyPoints}</td><td className="px-4 py-3"><StatusBadge value={customer.status}/></td></tr>)}</tbody></TableFrame>:<p className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">No customers match this search.</p>}</div>;
}
