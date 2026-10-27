import { createClient } from "@/lib/supabase/server";
import { discoveryData } from "@/lib/jobs/data";
import { EMPTY_PROFILE } from "@/lib/jobs/types";
import CareerAssistant from "./CareerAssistant";
export default async function CareerHome({ userId, name, gmailConnected }: { userId: string; name?: string; gmailConnected: boolean }) {
  const client = await createClient();
  const data = await discoveryData(client, userId).catch(() => null);
  return <>{!data && <p className="mb-3 text-xs text-text-secondary">Saved career preferences could not load. You can still search without a resume.</p>}<CareerAssistant profile={data?.profile ?? { ...EMPTY_PROFILE }} resumes={data?.resumes ?? []} name={name} gmailConnected={gmailConnected} /></>;
}
