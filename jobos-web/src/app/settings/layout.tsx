import { redirect } from "next/navigation";

import AppShell from "@/app/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import SettingsNav from "./components/SettingsNav";

/**
 * Settings shell.
 *
 * One place holds the page header, the section navigation, and the auth guard.
 * Every settings page reads user-scoped data, so the session is verified here as
 * well as in `middleware.ts` — defence in depth, and it means an individual
 * section page can never accidentally render anonymously.
 *
 * `maxWidth="3xl"` keeps forms at a comfortable reading measure instead of
 * stretching inputs across a wide monitor.
 */
export default async function SettingsLayout({
  children,
}: LayoutProps<"/settings">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/settings");

  return (
    <AppShell maxWidth="3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Settings
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage your profile, account security, preferences, and connected
          services.
        </p>
      </div>

      <SettingsNav />

      <div className="mt-6 space-y-5">{children}</div>
    </AppShell>
  );
}
