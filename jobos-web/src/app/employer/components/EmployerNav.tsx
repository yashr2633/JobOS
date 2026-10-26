"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const destinations = [["/employer", "Overview"], ["/employer/jobs", "Jobs"], ["/employer/applicants", "Applicants"], ["/employer/company", "Company"]];
export default function EmployerNav() {
  const pathname = usePathname();
  return <nav aria-label="Employer navigation" className="employer-nav">{destinations.map(([href, label]) => <Link href={href} key={href} aria-current={(href === "/employer" ? pathname === href : pathname.startsWith(href)) ? "page" : undefined}>{label}</Link>)}</nav>;
}
