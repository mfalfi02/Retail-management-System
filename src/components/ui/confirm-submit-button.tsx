"use client";

import { ReactNode } from "react";

export function ConfirmSubmitButton({ children, question, className }: { children: ReactNode; question: string; className?: string }) {
  return <button type="submit" className={className} onClick={(event) => { if (!window.confirm(question)) event.preventDefault(); }}>{children}</button>;
}
