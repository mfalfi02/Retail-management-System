import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { createCustomer } from "@/lib/actions/catalog";
import { PageHeader } from "@/components/ui/page-header";

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("customer.manage"); const { error }=await searchParams; const field="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
  return <div className="max-w-2xl"><PageHeader title="Add customer" description="Create a customer record for checkout and transaction history."/><form action={createCustomer} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 sm:p-7">{error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Check the customer details and try again.</p>}<label className="block text-sm font-medium">Name<input name="name" required maxLength={150} className={field}/></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Email<input name="email" type="email" maxLength={190} className={field}/></label><label className="block text-sm font-medium">Phone<input name="phone" maxLength={30} className={field}/></label></div><label className="block text-sm font-medium">Address<textarea name="address" maxLength={4000} rows={3} className={`${field} h-auto py-2`}/></label><div className="flex justify-end gap-2"><Link href="/customers" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">Cancel</Link><button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white">Create customer</button></div></form></div>;
}
