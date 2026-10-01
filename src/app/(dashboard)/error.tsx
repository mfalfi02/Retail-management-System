"use client";

export default function DashboardError({reset}:{error:Error & {digest?:string};reset:()=>void}){return <main className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-white p-8 text-center"><h2 className="text-lg font-semibold">This page could not be loaded</h2><p className="mt-2 text-sm text-slate-600">Please retry. If the problem continues, contact your administrator.</p><button onClick={()=>reset()} className="mt-5 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white">Try again</button></main>;}
