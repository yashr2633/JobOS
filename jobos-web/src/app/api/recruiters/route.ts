import { createClient } from "@/lib/supabase/server";
import { CONTACT_PAGE_SIZE, readRecruiterDirectory } from "@/lib/recruiters/server";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in to browse recruiter contacts." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 80), page = Number(params.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return Response.json({ error: "Invalid contact page." }, { status: 400, headers });
  try {
    const result = await readRecruiterDirectory(query, page);
    // Directory browsing never includes an email, even for an active Pro user.
    const contacts = result.contacts.map(({ id, name, company, title, location }) => ({ id, name, company, title, location }));
    return Response.json({ contacts, count: result.count, nextPage: page * CONTACT_PAGE_SIZE < result.count ? page + 1 : null }, { headers });
  } catch { return Response.json({ error: "More contacts could not load. Please retry." }, { status: 503, headers }); }
}
