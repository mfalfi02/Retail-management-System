import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/authorization";
import { hasPermission } from "@/lib/auth/authorization";
import { formatCurrency } from "@/lib/utils";
import { EmptyState, PageHeader, StatusBadge, TableFrame } from "@/components/ui/page-header";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermission("product.view");
  const { q = "", status = "ACTIVE" } = await searchParams;
  const products = await prisma.product.findMany({
    where: { ...(status === "ALL" ? {} : { status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE" }), ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] } : {}) },
    orderBy: { name: "asc" }, take: 100,
    select: { id: true, sku: true, barcode: true, name: true, sellingPrice: true, status: true, category: { select: { name: true } }, inventory: { select: { quantity: true, reservedQuantity: true } } },
  });
  return <div><PageHeader title="Products" description="Browse and maintain the item catalog." action={hasPermission(user,"product.create")?<Link href="/products/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800"><Plus size={16}/> New product</Link>:null}/>
    <form className="mb-4 flex flex-wrap gap-2"><label className="relative flex-1"><span className="sr-only">Search products</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input name="q" defaultValue={q} placeholder="Search name, SKU, or barcode" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm"/></label><select name="status" defaultValue={status} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">All status</option></select><button className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium">Filter</button></form>
    {products.length?<TableFrame><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["SKU", "Product", "Category", "Price", "Stock on hand", "Status"].map((column)=><th key={column} className="px-4 py-3 font-medium">{column}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{products.map((product)=><tr key={product.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono text-xs">{product.sku}</td><td className="px-4 py-3"><Link href={`/products/${product.id}`} className="font-medium text-emerald-800 hover:underline">{product.name}</Link></td><td className="px-4 py-3 text-slate-600">{product.category?.name??"—"}</td><td className="px-4 py-3">{formatCurrency(product.sellingPrice.toString())}</td><td className="px-4 py-3">{product.inventory.reduce((sum,row)=>sum+Number(row.quantity),0)}</td><td className="px-4 py-3"><StatusBadge value={product.status}/></td></tr>)}</tbody></TableFrame>:<EmptyState title="No products found" description="Change the search filters or add a product to the catalog."/>}
    {products.length===100&&<p className="mt-3 text-xs text-slate-500">Showing first 100 matches. Refine your search to narrow the list.</p>}
  </div>;
}
