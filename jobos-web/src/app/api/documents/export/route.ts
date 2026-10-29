import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { MAX_DOCUMENT_BYTES, readWorkspaceDocument, builderDocument, letterDocument } from "@/lib/documents/model";
import { renderResumePdf } from "@/lib/resume/pdf";
import { renderResumeDocx } from "@/lib/resume/docx";
import { formatResumeDocument, resumePlainText } from "@/lib/resume/templates";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const err = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
export async function POST(request: Request) {
  if (!isDocumentRequestOrigin(request)) return err("Invalid request origin.", 403);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return err("Please sign in.", 401);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_DOCUMENT_BYTES) return err("This document is too large to export.", 413);
    let input;
    try { input = JSON.parse(raw); } catch { return err("Use a valid document request.", 400); }
    const document = readWorkspaceDocument(input?.document), format = input?.format;
    if (!document || !["pdf", "docx", "txt"].includes(format)) return err("Choose a valid document and export format.", 400);
    const model = document.kind === "resume" ? builderDocument(document.data) : letterDocument(document.data);
    const text = resumePlainText(formatResumeDocument(model, document.formatting));
    if (!document.data.name.trim() || !model.sections.some(section => section.blocks.length) || text.length > 60000) return err("Add your name and document content before exporting (maximum 60,000 characters).", 400);
    // Standard PDF fonts cannot preserve every script. Never silently drop it.
    if (format === "pdf" && [...text].some(char => char.codePointAt(0)! > 255 && !/[\u2010-\u201f\u2022\u2026\u2000-\u200d\u202f\u2032\u2033\u20ac\ufeff]/.test(char))) return err("Use DOCX or TXT for these characters so your text is preserved. PDF currently supports Latin-script standard fonts.", 422);
    const bytes = format === "txt" ? new TextEncoder().encode(text) : format === "pdf" ? await renderResumePdf(model, document.formatting) : await renderResumeDocx(model, document.formatting);
    const name = document.label.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || document.kind;
    return new NextResponse(Uint8Array.from(bytes).buffer, { headers: { ...headers,
      "Content-Type": format === "pdf" ? "application/pdf" : format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.${format}"`, "X-Content-Type-Options": "nosniff",
    } });
  } catch { return err("Export could not finish. Your edited document is still on this page; retry or use another format.", 500); }
}
