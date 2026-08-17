import AppShell from "../components/AppShell";
import ApplicationsContent from "./components/ApplicationsContent";
import { createClient } from "@/lib/supabase/server";
import { countUnknownBucket } from "@/lib/api/gmailActivity";

export default async function ApplicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The Unknown_Bucket count is resolved here, on the server, and handed down
  // as a plain number. A read failure is not worth blanking the page over: the
  // entry point is secondary, so treat it as an empty bucket and render nothing.
  let unknownBucketCount = 0;
  if (user) {
    try {
      unknownBucketCount = await countUnknownBucket(supabase, user.id);
    } catch (error) {
      console.error("[applications] Unknown-bucket count failed:", error);
    }
  }

  return (
    <AppShell>
      <ApplicationsContent unknownBucketCount={unknownBucketCount} />
    </AppShell>
  );
}
