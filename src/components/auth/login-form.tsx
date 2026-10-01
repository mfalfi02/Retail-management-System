"use client";

import { useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";

export function LoginForm({ error }: { error?: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  return <form action="/api/auth/login" method="post" onSubmit={() => setPending(true)} className="space-y-5">
    {error === "credentials" && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">Username/email or password is incorrect.</p>}
    <label className="block text-sm font-medium text-slate-700">Username or email<input name="identifier" type="text" autoComplete="username" required maxLength={190} className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"/></label>
    <label className="block text-sm font-medium text-slate-700">Password<span className="relative mt-2 block"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={200} className="h-11 w-full rounded-lg border border-slate-300 px-3 pr-12 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"/><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
    <button disabled={pending} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 font-medium text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-70">{pending && <LoaderCircle className="animate-spin" size={17} />}{pending ? "Signing in…" : "Sign in"}</button>
    <p className="text-center text-xs text-slate-500">Access is limited to authorized staff.</p>
  </form>;
}
