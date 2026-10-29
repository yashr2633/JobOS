import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "../components/AppShell";
import ResumeToolsNav from "../components/ResumeToolsNav";
import DocumentWorkbench from "../documents/DocumentWorkbench";
import { getApplicationIntelligenceInput } from "@/lib/api/intelligence";
import { DOCUMENT_ID } from "@/lib/documents/model";
export const metadata: Metadata = { title: "Cover Letter", robots: { index: false, follow: false } };
export default async function CoverLetterPage({ searchParams }: { searchParams: Promise<{ resume?: string; application?: string }> }) {
  const client = await createClient(), { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=/cover-letter");
  const params = await searchParams;
  const input = params.application && DOCUMENT_ID.test(params.application) ? await getApplicationIntelligenceInput(client, params.application).catch(() => null) : null;
  const application = input ? await client.from("applications").select("company, role").eq("id", params.application!).eq("user_id", user.id).maybeSingle() : null;
  const context = input ? { role: input.parsedJd?.title ?? application?.data?.role ?? "", company: input.parsedJd?.company ?? application?.data?.company ?? "", jobDescription: input.jobDescription ?? "" } : undefined;
  return <AppShell><ResumeToolsNav active="letter" /><DocumentWorkbench kind="letter" initialResumeId={params.resume} context={context} /></AppShell>;
}
