import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { billingReady } from "@/lib/billing/server";
import AppShell from "../components/AppShell";
import PlansContent from "./PlansContent";

export const metadata: Metadata = { title: "Plans", robots: { index: false, follow: false } };

export default async function PlansPage() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  return <AppShell><PlansContent signedIn={!!user} initiallyAvailable={billingReady()} /></AppShell>;
}
