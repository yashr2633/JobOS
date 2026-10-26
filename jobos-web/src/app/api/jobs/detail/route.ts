import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveJob } from "@/lib/jobs/providers";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 150) return NextResponse.json({ error: "Invalid listing." }, { status: 400 });
  try {
    const job = await getLiveJob(id, new URL(request.url).searchParams.get("source") ?? undefined);
    return job ? NextResponse.json({ job }, { headers: { "Cache-Control": "private, no-store" } })
      : NextResponse.json({ error: "This vacancy is no longer publicly listed." }, { status: 410 });
  } catch {
    return NextResponse.json({ error: "The employer is temporarily unavailable. Please retry or open the original listing." }, { status: 503 });
  }
}
