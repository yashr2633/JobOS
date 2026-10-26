import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import Brand from "../../components/Brand";
import LoginForm from "../../(auth)/login/LoginForm";
import { createClient } from "@/lib/supabase/server";

export default async function EmployerLogin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/employer");
  return <main className="auth-product-shell"><header className="auth-product-header"><Brand /><Link href="/login">Candidate login</Link></header><div className="marketing-shell w-full"><div className="marketing-hero"><section><p className="product-kicker">JobTrackOS for employers</p><h1>Hire with a clearer view of every candidate.</h1><p className="marketing-intro">Publish roles, review applications and keep hiring stages organised in your company workspace.</p><div className="product-list mt-8">{["Manage job listings", "Review candidate-submitted resumes", "Keep company access separate"].map(text => <p key={text} className="text-sm text-text-secondary">✓ {text}</p>)}</div></section><div className="auth-product-content"><Suspense fallback={<p>Loading sign in…</p>}><LoginForm audience="employer" /></Suspense></div></div></div><footer className="auth-product-footer"><Link href="/privacy-policy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link></footer></main>;
}
