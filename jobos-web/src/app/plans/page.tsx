import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { payuReady } from "@/lib/billing/payu";
import AppShell from "../components/AppShell";
import PlansContent from "./PlansContent";

export const metadata: Metadata = { title: "Plans", robots: { index: false, follow: false } };

export default async function PlansPage() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  return <AppShell><PlansContent signedIn={!!user} initiallyAvailable={payuReady()} /></AppShell>;
}
