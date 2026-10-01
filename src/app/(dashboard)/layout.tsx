import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, BarChart3, Boxes, Building2, CreditCard, LayoutDashboard, LogOut, Package, Settings, ShoppingBag, ShoppingCart, Users, Warehouse, ReceiptText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission, hasRole } from "@/lib/auth/authorization";

const navigation = [
  { section: "Workspace", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { section: "Sales", label: "Point of sale", href: "/pos", icon: ShoppingCart, permission: "pos.access" },
  { section: "Sales", label: "Sales orders", href: "/sales", icon: CreditCard, permission: "sale.view" },
  { section: "Catalog", label: "Products", href: "/products", icon: Package, permission: "product.view" },
  { section: "Inventory", label: "Stock", href: "/inventory", icon: Boxes, permission: "inventory.view" },
  { section: "Purchasing", label: "Purchases", href: "/purchases", icon: ShoppingBag, permission: "purchase.view" },
  { section: "Purchasing", label: "Suppliers", href: "/suppliers", icon: Building2, permission: "supplier.manage" },
  { section: "Customers", label: "Customers", href: "/customers", icon: Users, permission: "customer.manage" },
  { section: "Finance", label: "Expenses", href: "/expenses", icon: ReceiptText, permission: "expense.manage" },
  { section: "Finance", label: "Reports", href: "/reports", icon: BarChart3, permission: "report.view" },
  { section: "Administration", label: "Users & roles", href: "/settings?tab=users", icon: Activity, permission: "user.manage" },
  { section: "Administration", label: "Settings", href: "/settings", icon: Settings, permission: "settings.manage" },
];

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const allowed = navigation.filter((item) => hasPermission(user, item.permission));
  const sections = [...new Set(allowed.map((item) => item.section))];
  return <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <Link href="/dashboard" className="flex items-center gap-3 border-b border-slate-100 px-5 py-5"><span className="rounded-xl bg-emerald-700 p-2.5 text-white"><Warehouse size={20}/></span><span><span className="block text-sm font-semibold">Retail Management</span><span className="block text-xs text-slate-500">Operations workspace</span></span></Link>
      <nav aria-label="Main navigation" className="grid grid-cols-3 gap-1 p-3 sm:grid-cols-4 md:flex md:flex-1 md:flex-col md:overflow-y-auto">{sections.map((section) => <div key={section} className="contents md:block"><p className="hidden px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400 md:block">{section}</p>{allowed.filter((item) => item.section === section).map(({ label, href, icon: Icon }) => <Link key={href} href={href} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 md:gap-3 md:text-sm"><Icon size={17}/><span>{label}</span></Link>)}</div>)}</nav>
      <div className="flex items-center justify-between border-t border-slate-100 p-4 md:block"><div><p className="truncate text-sm font-medium">{user.name}</p><p className="truncate text-xs text-slate-500">{user.roles.join(" · ")}</p></div><form action="/api/auth/logout" method="post"><button aria-label="Sign out" className="mt-0 flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:mt-3 md:px-0"><LogOut size={15}/> <span className="md:inline">Sign out</span></button></form></div>
    </aside>
    <div className="min-w-0 flex-1"><header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur md:px-8"><div><p className="text-xs text-slate-500">Retail workspace</p><p className="text-sm font-semibold">{hasRole(user,"SUPER_ADMIN") ? "All stores" : user.storeId ? "Store operations" : "Store not assigned"}</p></div><div className="flex items-center gap-3"><span className="hidden text-xs text-slate-500 sm:block">{user.email ?? user.username}</span><span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">{user.name.slice(0,1).toUpperCase()}</span></div></header><main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</main></div>
  </div>;
}
