import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "../components/AppShell";
import ResumeToolsNav from "../components/ResumeToolsNav";
import ResumeStudio from "../documents/ResumeStudio";
export const metadata: Metadata = { title: "Resume Builder", robots: { index: false, follow: false } };
export default async function ResumeBuilderPage() {
  const client = await createClient(), { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=/resume-builder");
  return <AppShell><ResumeToolsNav active="builder" /><ResumeStudio /></AppShell>;
}
