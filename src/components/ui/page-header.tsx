import type { ReactNode } from "react";

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>{action}</div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><p className="font-medium text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div>;
}

export function StatusBadge({ value }: { value: string }) {
  const tone = value === "ACTIVE" || value === "COMPLETED" || value === "PAID" || value === "RECEIVED" ? "bg-emerald-50 text-emerald-700" : value === "CANCELLED" || value === "INACTIVE" || value === "VOID" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm">{children}</table></div>;
}
