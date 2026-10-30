import { parseResumeDocument, type ResumeDocument } from "../resume/documentModel.ts";
import { validateResumeFormat, type ResumeFormatInput } from "../resume/templates.ts";

export type DocumentKind = "resume" | "letter";
export interface BuilderSection { id: string; title: string; body: string }
export interface BuilderResume { name: string; headline: string; contact: string; sections: BuilderSection[] }
export interface CoverLetter {
  name: string; contact: string; role: string; company: string; recipient: string;
  date: string; mode: "general" | "tailored"; jobDescription: string;
  facts: string; motivation: string; body: string;
}
export type WorkspaceDocument =
  | { version: 1; kind: "resume"; label: string; formatting: ResumeFormatInput; data: BuilderResume }
  | { version: 1; kind: "letter"; label: string; formatting: ResumeFormatInput; data: CoverLetter };
export const MAX_DOCUMENT_BYTES = 120_000;
export const DOCUMENT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const string = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

export function readWorkspaceDocument(value: unknown): WorkspaceDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || !string(input.label, 160) || !input.label.trim()) return null;
  const formatting = validateResumeFormat(input.formatting);
  if (!formatting || !input.data || typeof input.data !== "object" || Array.isArray(input.data)) return null;
  const data = input.data as Record<string, unknown>;
  if (!string(data.name, 200) || !string(data.contact, 1500)) return null;
  if (input.kind === "resume") {
    if (!string(data.headline, 300) || !Array.isArray(data.sections) || data.sections.length > 24) return null;
    const sections: BuilderSection[] = [];
    for (const section of data.sections) {
      if (!section || typeof section !== "object" || !string(section.id, 80) || !section.id || !string(section.title, 60) || !section.title.trim() || !string(section.body, 12000)) return null;
      sections.push({ id: section.id, title: section.title.trim(), body: section.body });
    }
    if (new Set(sections.map(section => section.id)).size !== sections.length) return null;
    return { version: 1, kind: "resume", label: input.label.trim(), formatting, data: { name: data.name, headline: data.headline, contact: data.contact, sections } };
  }
  if (input.kind !== "letter" || typeof data.mode !== "string" || !["general", "tailored"].includes(data.mode)) return null;
  for (const field of ["role", "company", "recipient", "date"] as const) if (!string(data[field], 250)) return null;
  for (const field of ["jobDescription", "facts", "motivation", "body"] as const) if (!string(data[field], field === "jobDescription" ? 20000 : 16000)) return null;
  return { version: 1, kind: "letter", label: input.label.trim(), formatting, data: {
    name: data.name, contact: data.contact, role: data.role as string, company: data.company as string,
    recipient: data.recipient as string, date: data.date as string, mode: data.mode as CoverLetter["mode"],
    jobDescription: data.jobDescription as string, facts: data.facts as string, motivation: data.motivation as string, body: data.body as string,
  } };
}

export function emptyResume(): BuilderResume {
  return { name: "", headline: "", contact: "", sections: [
    { id: "summary", title: "SUMMARY", body: "" }, { id: "experience", title: "EXPERIENCE", body: "" },
    { id: "education", title: "EDUCATION", body: "" }, { id: "skills", title: "SKILLS", body: "" },
    { id: "projects", title: "PROJECTS", body: "" },
  ] };
}
export function emptyLetter(): CoverLetter {
  return { name: "", contact: "", role: "", company: "", recipient: "Hiring Team", date: "", mode: "general", jobDescription: "", facts: "", motivation: "", body: "" };
}

/** Only entered facts enter the document. No placeholders are exported. */
export function builderDocument(data: BuilderResume): ResumeDocument {
  return {
    headerLines: [data.name, data.headline, ...data.contact.split(/\n/)].map(line => line.trim()).filter(Boolean),
    sections: data.sections.filter(section => section.body.trim()).map(section => ({
      heading: section.title.trim(), blocks: parseResumeDocument(`CONTENT\n${section.body}`).sections.flatMap(part => part.heading === "CONTENT" ? part.blocks : [{ kind: "line" as const, text: part.heading, emphasized: true }, ...part.blocks]),
    })),
  };
}

/** Preserve all imported text, including sections the parser cannot classify. */
export function importResumeText(text: string): BuilderResume {
  let document = parseResumeDocument(text);
  const lines = text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  // An uppercase candidate name is a heading to the export parser. In an
  // imported resume, an immediately following contact block identifies the
  // opening header; retain that exact source text as the candidate name.
  const conventionalHeading = /^(?:(?:professional|personal|career)\s+)?(?:summary|profile|skills|experience|education|contact(?:\s+(?:details|information))?|objective|projects|certifications|resume|curriculum vitae|work history)$/i;
  if (!document.headerLines.length && !conventionalHeading.test(first) && /^[\p{L}][\p{L} .'-]{1,199}$/u.test(first) && first.split(/\s+/).length <= 6 && lines.slice(1, 4).some(line => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(line))) {
    document = parseResumeDocument(lines.slice(1).join("\n"));
    document.headerLines.unshift(first);
  }
  const sections = document.sections.map((section, index) => ({ id: `import-${index}`, title: section.heading, body: section.blocks.flatMap(block => block.kind === "line" ? [block.text] : block.items.map(item => `- ${item}`)).join("\n") }));
  return sections.length ? { name: document.headerLines[0] ?? "", headline: "", contact: document.headerLines.slice(1).join("\n"), sections }
    : { name: "", headline: "", contact: "", sections: [{ id: "imported", title: "IMPORTED CONTENT", body: text.trim() }] };
}

/** Rank existing evidence; never turn JD requirements into candidate facts. */
export function relevantLetterFacts(facts: string, jobDescription: string): string[] {
  const terms = new Set((jobDescription.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? []).filter(term => !["the", "and", "with", "for", "you", "your", "our", "will", "are", "this", "that", "have"].includes(term)));
  return facts.split(/\n/).map(line => line.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean)
    .map((text, index) => ({ text, index, points: [...terms].filter(term => text.toLowerCase().includes(term)).length }))
    .sort((a, b) => b.points - a.points || a.index - b.index).slice(0, 4).map(item => item.text);
}
export function createLetterDraft(data: CoverLetter): string {
  const facts = relevantLetterFacts(data.facts, data.mode === "tailored" ? data.jobDescription : "");
  const role = data.role.trim(), company = data.company.trim();
  const opening = data.mode === "tailored" && role && company
    ? `I am applying for the ${role} position at ${company}.`
    : `I am writing to express my interest in ${role ? `${role} opportunities` : "suitable opportunities"}${company ? ` at ${company}` : " with your team"}.`;
  return [data.date.trim(), `Dear ${data.recipient.trim() || "Hiring Team"},`, opening,
    data.motivation.trim(), facts.length ? `Relevant background I bring includes:\n${facts.map(fact => `- ${fact}`).join("\n")}` : "",
    "I would welcome the opportunity to discuss how my background could support your team. Thank you for considering my application.",
    `Kind regards,${data.name.trim() ? `\n${data.name.trim()}` : ""}`,
  ].filter(Boolean).join("\n\n");
}
export function letterDocument(data: CoverLetter): ResumeDocument {
  return { headerLines: [data.name, ...data.contact.split(/\n/)].map(line => line.trim()).filter(Boolean), sections: [{ heading: "", blocks: data.body.split(/\n/).filter(paragraph => paragraph.trim()).map(paragraph => ({ kind: "line", text: paragraph.trim(), emphasized: false })) }] };
}
export function documentPath(userId: string, kind: DocumentKind, id: string): string {
  if (!DOCUMENT_ID.test(userId) || !DOCUMENT_ID.test(id) || !["resume", "letter"].includes(kind)) throw new Error("Invalid document identity.");
  return `${userId}/documents/${kind}/${id}.json`;
}
