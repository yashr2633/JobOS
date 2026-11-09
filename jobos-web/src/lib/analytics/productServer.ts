import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { eventProperties, type ProductEvent } from "./productModel";

/** Await the bounded write; never allow analytics failure to fail a product action. */
export async function recordProductEvent(userId: string | null, event: ProductEvent, properties: unknown = {}, sessionId: string | null = null, eventId?: string) {
  try {
    const db = createAdminClient();
    const { error } = await db.from("product_analytics_events").upsert({ ...(eventId ? { id: eventId } : {}), user_id: userId, event_name: event,
      session_id: sessionId, properties: eventProperties(properties) }, { onConflict: "id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(1800));
    if (error) console.warn("[analytics] Event write unavailable", error.code);
  } catch { console.warn("[analytics] Event write unavailable"); }
}
