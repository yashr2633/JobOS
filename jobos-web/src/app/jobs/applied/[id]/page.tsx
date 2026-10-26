import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "../../../components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/employer/validation";
export default async function ApplicationConfirmation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/applications");
  const { data, error } = await supabase.from("employer_submissions").select("id,stage,created_at,tracker_id").eq("id", id).eq("candidate_id", user.id).maybeSingle();
  if (error) return <AppShell><p role="alert" className="product-notice product-error">Confirmation could not load. Check your Applications tracker before trying again.</p></AppShell>;
  if (!data) notFound();
  return <AppShell maxWidth="3xl"><section className="product-panel py-14 text-center"><span className="product-badge">Application submitted</span><h1 className="mt-6 font-semibold">Your application is on its way.</h1><p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-text-secondary">The employer received your application and the resume information you agreed to share. It has also been added to your Applications tracker.</p><p className="mt-6 text-sm">Current stage: <strong>{data.stage}</strong></p><p className="mt-2 text-xs text-text-muted">Submitted {new Date(data.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p><div className="product-actions justify-center"><Link className="product-button product-button-primary" href="/applications">Track my application</Link><Link className="product-button" href="/jobs">Find more jobs</Link></div></section></AppShell>;
}
