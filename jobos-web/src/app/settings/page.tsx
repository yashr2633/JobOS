/**
 * Settings -> Profile
 *
 * The profile is read on the server from the session's `user_metadata` and
 * handed to the form as its initial value, so there is no client-side fetch
 * waterfall before the fields can render.
 *
 * The auth guard lives in `settings/layout.tsx`; a null user cannot reach here.
 */

import { createClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/account/profile";
import ProfileForm from "./components/ProfileForm";

export default async function SettingsProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = profileFromMetadata(
    (user?.user_metadata ?? null) as Record<string, unknown> | null
  );

  return <ProfileForm initial={profile} />;
}
