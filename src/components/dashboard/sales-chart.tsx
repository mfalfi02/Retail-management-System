"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/utils";

export function SalesChart({ data }: { data: { day: string; total: number }[] }) {
  return <div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}><defs><linearGradient id="sales" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#047857" stopOpacity={0.18}/><stop offset="95%" stopColor="#047857" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8edf2"/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(n: number) => `${Math.round(n / 1000)}k`}/><Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }}/><Area type="monotone" dataKey="total" stroke="#047857" strokeWidth={2.5} fill="url(#sales)"/></AreaChart></ResponsiveContainer></div>;
}
