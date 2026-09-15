import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseProfile } from "@/lib/jobs/profile";
import { fetchResumes } from "@/lib/api/resumes";
import { discoveryResumes } from "@/lib/jobs/resumeLibrary";

// Refresh evidence after the existing upload pipeline finishes. User data is
// never shared-cached; fetchResumes uses the signed-in client's existing RLS.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    return NextResponse.json({ resumes: discoveryResumes(await fetchResumes(supabase)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Resume uploaded, but the library could not refresh. Please retry." }, { status: 503 }); }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 16000) return NextResponse.json({ error: "Profile is too long." }, { status: 413 });
    const profile = parseProfile(JSON.parse(text));
    if (profile.resumeId) {
      const { data, error } = await supabase.from("resumes").select("id").eq("id", profile.resumeId).eq("user_id", user.id).maybeSingle();
      if (error || !data) return NextResponse.json({ error: "That resume is unavailable." }, { status: 404 });
    }
    const { resumeId, ...preferences } = profile;
    const { error } = await supabase.from("career_profiles").upsert({ user_id: user.id, resume_id: resumeId, preferences, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: "Could not save preferences. Please retry." }, { status: 500 });
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid profile." }, { status: 400 });
  }
}
