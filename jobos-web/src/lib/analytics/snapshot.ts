import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminPeriod, AdminSnapshot } from "@/types/adminAnalytics";
const userCensus = unstable_cache(async () => {
  const db = createAdminClient(); const rows = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Account totals could not be loaded.");
    for (const user of data.users) {
      if (user.is_anonymous || (user as typeof user & { deleted_at?: string }).deleted_at) continue;
      const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
      rows.push({ id: user.id, email: user.email ?? null, name: typeof name === "string" ? name.slice(0, 120) : null,
        created_at: user.created_at, last_sign_in_at: user.last_sign_in_at ?? null, is_test: user.app_metadata?.is_test === true });
    }
    if (data.users.length < 1000) return rows;
  }
  throw new Error("Account census exceeded the reporting limit; no partial total was returned.");
}, ["admin-user-census-v2"], { revalidate: 45 });
export async function adminSnapshot(filters: { days: AdminPeriod; includeStaff: boolean; page: number; query: string; plan: string }): Promise<AdminSnapshot> {
  const census = await userCensus();
  const { data, error } = await createAdminClient().rpc("admin_product_analytics", {
    p_users: census, p_days: filters.days, p_include_staff: filters.includeStaff, p_page: filters.page, p_query: filters.query, p_plan: filters.plan,
  }).abortSignal(AbortSignal.timeout(22000));
  if (error || !data || data.version !== 2) throw new Error("The analytics report could not be refreshed. Previous figures have not been replaced with zero.");
  return data as AdminSnapshot;
}
