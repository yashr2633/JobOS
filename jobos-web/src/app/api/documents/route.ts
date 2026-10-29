import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { DOCUMENT_ID, MAX_DOCUMENT_BYTES, documentPath, readWorkspaceDocument, type DocumentKind } from "@/lib/documents/model";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
const validKind = (value: unknown): value is DocumentKind => value === "resume" || value === "letter";

export async function GET(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  const params = new URL(request.url).searchParams, kind = params.get("kind"), id = params.get("id");
  if (!validKind(kind) || (id && !DOCUMENT_ID.test(id))) return json({ error: "Choose a valid document." }, 400);
  try {
    const bucket = client.storage.from("resumes");
    if (id) {
      const { data, error } = await bucket.download(documentPath(user.id, kind, id));
      if (error || !data) return json({ error: "Draft not found or unavailable." }, 404);
      if (data.size > MAX_DOCUMENT_BYTES) return json({ error: "This draft is too large." }, 422);
      const document = readWorkspaceDocument(JSON.parse(await data.text()));
      return document && document.kind === kind ? json({ id, document }) : json({ error: "This draft could not be read." }, 422);
    }
    const offset = Number(params.get("offset") ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) return json({ error: "Invalid draft page." }, 400);
    const { data, error } = await bucket.list(`${user.id}/documents/${kind}`, { limit: 20, offset, sortBy: { column: "updated_at", order: "desc" } });
    if (error) return json({ error: "Saved drafts could not load. Retry shortly." }, 502);
    const files = (data ?? []).filter(file => DOCUMENT_ID.test(file.name.replace(/\.json$/, "")) && file.name.endsWith(".json"));
    const results = await Promise.allSettled(files.map(async file => {
      const id = file.name.replace(/\.json$/, "");
      const { data, error } = await bucket.download(documentPath(user.id, kind, id));
      if (error || !data || data.size > MAX_DOCUMENT_BYTES) throw new Error("Draft unavailable");
      const document = readWorkspaceDocument(JSON.parse(await data.text()));
      if (!document || document.kind !== kind) throw new Error("Invalid draft");
      return { id, label: document.label, updatedAt: file.updated_at };
    }));
    return json({ drafts: results.flatMap(result => result.status === "fulfilled" ? [result.value] : []),
      nextOffset: (data?.length ?? 0) === 20 ? offset + 20 : null,
      warning: results.some(result => result.status === "rejected") ? "Some drafts could not be read. Retry before assuming they are missing." : null });
  } catch { return json({ error: "Documents are temporarily unavailable. Your existing files were not removed." }, 502); }
}

export async function POST(request: Request) {
  if (!isDocumentRequestOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_DOCUMENT_BYTES) return json({ error: "This document is too large. Shorten it before saving." }, 413);
    let input;
    try { input = JSON.parse(raw); } catch { return json({ error: "Use a valid document request." }, 400); }
    const document = readWorkspaceDocument(input?.document);
    if (!document || (input.id !== undefined && (typeof input.id !== "string" || !DOCUMENT_ID.test(input.id)))) return json({ error: "Check your document fields and formatting." }, 400);
    const id = input.id ?? crypto.randomUUID(), path = documentPath(user.id, document.kind, id), bucket = client.storage.from("resumes");
    if (input.id) {
      const existing = await bucket.download(path);
      if (existing.error) return json({ error: "This draft no longer exists. Save a new copy instead." }, 404);
    }
    const { error } = await bucket.upload(path, new Blob([JSON.stringify(document)], { type: "application/json" }), { contentType: "application/json", upsert: Boolean(input.id) });
    if (error) return json({ error: "Draft was not saved. Keep this page open and retry." }, 502);
    return json({ id, savedAt: new Date().toISOString() }, input.id ? 200 : 201);
  } catch { return json({ error: "Draft could not be saved. Keep this page open and retry." }, 502); }
}
