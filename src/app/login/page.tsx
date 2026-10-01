import Link from "next/link";
import { redirect } from "next/navigation";
import { Store } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { error } = await searchParams;
  return <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-50 via-slate-50 to-slate-100 p-5">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
      <div className="mb-8 flex items-center gap-3"><div className="rounded-xl bg-emerald-700 p-3 text-white"><Store size={22}/></div><div><h1 className="font-semibold text-slate-900">Retail Management</h1><p className="text-sm text-slate-500">Sign in to your workspace</p></div></div>
      <LoginForm error={error}/>
      <Link href="/" className="mt-6 block text-center text-sm text-emerald-800 hover:underline">Back to overview</Link>
    </section>
  </main>;
}
