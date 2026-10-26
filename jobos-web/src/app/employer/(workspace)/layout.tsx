import type { ReactNode } from "react";
import Link from "next/link";
import Brand from "../../components/Brand";
import AuthButton from "../../components/AuthButton";
import EmployerNav from "../components/EmployerNav";
import { employerSession } from "@/lib/employer/data";
export default async function EmployerLayout({ children }: { children: ReactNode }) {
  const { user } = await employerSession();
  return <div className="product-app min-h-dvh"><a href="#main-content" className="sr-only focus:not-sr-only">Skip to content</a><header className="product-header flex items-center justify-between border-b border-border bg-surface"><Brand employer /><EmployerNav /><div className="flex items-center gap-3"><Link href="/" className="hidden text-xs text-text-muted sm:block">Candidate view</Link><AuthButton userEmail={user.email} /></div></header><main id="main-content" className="employer-main">{children}</main></div>;
}
