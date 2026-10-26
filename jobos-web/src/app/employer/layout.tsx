import type { ReactNode } from "react";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Employer workspace", robots: { index: false, follow: false } };
export default function EmployerRoot({ children }: { children: ReactNode }) { return children; }
