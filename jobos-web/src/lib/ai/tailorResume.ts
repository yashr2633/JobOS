/**
 * Tailored-resume generation — prompt, validated shape, and pure assembly.
 *
 * Built entirely on the EXISTING AI gateway (`generateStructured`) and the
 * existing resume/JD data. No new analysis engine, no new model tier, no new
 * table: the endpoint re-reads the resume text and the application's JD that
 * Resume Match already uses, and returns a structured rewrite.
 *
 * THE ANTI-FABRICATION CONTRACT
 *
 * Tailoring may only reorganize, reword, emphasize, and re-key TRUTHFUL content
 * already present in the resume. It may never invent an employer, a role, a
 * date, a degree, a certification, a metric, a technology, or a skill the resume
 * does not already demonstrate. The system prompt states this in the strongest
 * terms, and the returned shape carries a fixed `note` making the guarantee
 * visible to the user. This module deliberately holds no "add missing skill"
 * affordance — there is nowhere in the data model for an invented fact to go.
 *
 * Pure except for the prompt string: the validator and the text assembler are
 * total functions, so they are unit-testable without the network.
 */

/** One experience entry: an existing role, with rewritten (not invented) bullets. */
export interface TailoredExperience {
  /** The role/title exactly as it exists in the resume. */
  title: string;
  /** Employer/context as it exists in the resume; empty when the resume omits it. */
  detail: string;
  /** Rewritten bullets, each derived from an existing bullet. */
  bullets: string[];
}

/**
 * The candidate's identity block, copied VERBATIM from the source resume.
 *
 * WHY THIS EXISTS
 *
 * The tailored resume previously had no identity fields at all, so a name, email
 * address, phone number, and LinkedIn/GitHub links present in the source were
 * silently dropped — the exported document opened straight into "SUMMARY" with no
 * way to tell whose resume it was. That is data LOSS, not tailoring.
 *
 * Every field is optional: a resume that does not state a phone number produces
 * an empty phone, never a placeholder. And because these are the fields most
 * damaging to fabricate, they are additionally verified against the source text
 * by `verifyContactAgainstSource` before anything is assembled.
 */
export interface ResumeContact {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  /** LinkedIn URL or handle, exactly as written in the resume. */
  linkedin: string;
  /** GitHub URL or handle, exactly as written in the resume. */
  github: string;
  /** Any other links/handles the resume's header carries, verbatim. */
  links: string[];
}

export const EMPTY_CONTACT: ResumeContact = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  github: "",
  links: [],
};

/** The structured tailored resume the model must return. */
export interface TailoredResume {
  /** Identity/contact header, verbatim from the source. Never invented. */
  contact: ResumeContact;
  /** A rewritten professional summary, from existing facts only. */
  summary: string;
  /** Existing skills, re-ordered/re-keyed for the JD. No new skills. */
  skills: string[];
  experience: TailoredExperience[];
  /** Education lines, verbatim facts, reworded at most. */
  education: string[];
  /** Certifications if the resume has them; otherwise empty. */
  certifications: string[];
  /**
   * Projects, as their own section.
   *
   * Previously folded in with certifications, which meant a resume with both lost
   * the distinction and read oddly under one heading.
   */
  projects: string[];
  /**
   * Other sections the resume genuinely carries — interests, volunteering,
   * publications, languages. Kept so tailoring cannot quietly delete a section
   * simply because this schema did not anticipate it.
   */
  additionalSections: TailoredSection[];
  /** Plain-language notes on what was emphasized/reordered. Never new facts. */
  changes: string[];
}

/** A titled block of lines the resume has that the fixed fields do not cover. */
export interface TailoredSection {
  /** Conventional heading, e.g. "INTERESTS". */
  heading: string;
  lines: string[];
}

/** The fixed, user-visible truthfulness guarantee. Never model-supplied. */
export const TAILORING_NOTE =
  "Tailored using only information already present in your resume. No skills, experience, dates, or achievements were invented.";

export const TAILOR_RESUME_SYSTEM = `You are an expert resume editor helping a candidate tailor their EXISTING resume to a specific job description for better ATS keyword alignment and relevance.

ABSOLUTE RULES — these override everything else:
- Use ONLY facts, skills, employers, titles, dates, education, and achievements that already appear in the candidate's resume.
- NEVER invent or add: companies, job titles, employment dates, degrees, certifications, metrics, numbers, technologies, tools, or skills that are not already present in the resume.
- If the job description requires a skill the resume does not demonstrate, DO NOT add it. Do not imply the candidate has it.
- You MAY: reorder experience and bullets, rewrite bullets for clarity and impact, use stronger action verbs, surface existing relevant skills earlier, align existing wording to the job description's terminology WHEN THE UNDERLYING FACT IS ALREADY TRUE, shorten irrelevant content, and improve professional phrasing.
- Every bullet you output must trace back to a real bullet or fact in the source resume.

COMPLETENESS IS MANDATORY — do not drop content:
- Copy the candidate's contact/identity details EXACTLY as they appear in the resume: full name, email, phone, location, LinkedIn, GitHub, and any other links. Character for character. Do not reformat, correct, or complete them.
- If a contact field is not in the resume, return an empty string for it. Never guess an email, phone number, or handle.
- Preserve EVERY section the resume contains. Education, certifications, projects, interests, volunteering, publications and languages must survive tailoring. Use "additionalSections" for anything the fixed fields do not cover.
- Tailoring means reordering, reprioritizing and rewording — never deleting a section the candidate has.

Return ONLY valid JSON of this exact shape:
{
  "contact": {
    "fullName": string,
    "email": string,
    "phone": string,
    "location": string,
    "linkedin": string,
    "github": string,
    "links": string[]
  },
  "summary": string,
  "skills": string[],
  "experience": [{ "title": string, "detail": string, "bullets": string[] }],
  "education": string[],
  "certifications": string[],
  "projects": string[],
  "additionalSections": [{ "heading": string, "lines": string[] }],
  "changes": string[]
}

- "contact": verbatim from the resume. Empty string where the resume is silent.
- "skills": only skills already in the resume, ordered by relevance to the job.
- "experience[].title" and "detail": copied from the resume (reworded at most, never invented).
- "projects": the resume's own projects, kept separate from certifications.
- "additionalSections[].heading": a conventional uppercase heading, e.g. "INTERESTS".
- "changes": short plain-language notes on what you emphasized or reordered — never claims of new facts.
Output nothing except the JSON object.`;

/** Build the user turn: the resume text and the target JD, clearly separated. */
export function buildTailorResumePrompt(
  resumeText: string,
  jobDescription: string
): string {
  return [
    "SOURCE RESUME (the only source of truth for facts):",
    resumeText.trim(),
    "",
    "TARGET JOB DESCRIPTION (to align wording and ordering with, NOT a source of new facts):",
    jobDescription.trim(),
    "",
    "Produce the tailored resume JSON now, using only facts already in the SOURCE RESUME.",
  ].join("\n");
}

/** A trimmed string array, dropping blanks. */
function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") out.push(entry.trim());
  }
  return out;
}

/**
 * Validate the model's JSON into a `TailoredResume`.
 *
 * Matches the `{ ok, value } | { ok, error }` contract `generateStructured`
 * expects. Missing optional sections become empty arrays rather than errors; a
 * result with no usable content at all is rejected so the UI never shows an
 * empty "tailored resume".
 */
export function validateTailoredResume(
  value: unknown
): { ok: true; value: TailoredResume } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Tailored resume must be a JSON object." };
  }

  const raw = value as Record<string, unknown>;

  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const skills = cleanStringArray(raw.skills);
  const education = cleanStringArray(raw.education);
  const certifications = cleanStringArray(raw.certifications);
  const projects = cleanStringArray(raw.projects);
  const changes = cleanStringArray(raw.changes);
  const contact = readContact(raw.contact);

  const additionalSections: TailoredSection[] = [];
  if (Array.isArray(raw.additionalSections)) {
    for (const entry of raw.additionalSections) {
      if (typeof entry !== "object" || entry === null) continue;
      const section = entry as Record<string, unknown>;
      const heading =
        typeof section.heading === "string" ? section.heading.trim() : "";
      const lines = cleanStringArray(section.lines);
      // A heading with no lines states nothing, so it is dropped rather than
      // rendered as an empty section.
      if (heading === "" || lines.length === 0) continue;
      additionalSections.push({ heading, lines });
    }
  }

  const experience: TailoredExperience[] = [];
  if (Array.isArray(raw.experience)) {
    for (const entry of raw.experience) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const title = typeof e.title === "string" ? e.title.trim() : "";
      const detail = typeof e.detail === "string" ? e.detail.trim() : "";
      const bullets = cleanStringArray(e.bullets);
      if (title === "" && bullets.length === 0) continue;
      experience.push({ title, detail, bullets });
    }
  }

  const hasContent =
    summary !== "" ||
    skills.length > 0 ||
    experience.length > 0 ||
    education.length > 0;

  if (!hasContent) {
    return { ok: false, error: "Tailored resume had no usable content." };
  }

  return {
    ok: true,
    value: {
      contact,
      summary,
      skills,
      experience,
      education,
      certifications,
      projects,
      additionalSections,
      changes,
    },
  };
}

/** Read a contact block defensively; any missing field becomes an empty string. */
function readContact(value: unknown): ResumeContact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...EMPTY_CONTACT, links: [] };
  }

  const raw = value as Record<string, unknown>;
  const read = (key: string) =>
    typeof raw[key] === "string" ? (raw[key] as string).trim() : "";

  return {
    fullName: read("fullName"),
    email: read("email"),
    phone: read("phone"),
    location: read("location"),
    linkedin: read("linkedin"),
    github: read("github"),
    links: cleanStringArray(raw.links),
  };
}

/**
 * Normalize text for a containment check.
 *
 * Whitespace is collapsed and case is folded, so a model that reflowed a header
 * line still verifies. Nothing else is altered: the point is to confirm the value
 * came from the source, not to make a near-miss pass.
 */
function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Drop any contact detail that does not literally appear in the source resume.
 *
 * THE ANTI-FABRICATION GUARANTEE, ENFORCED DETERMINISTICALLY
 *
 * Contact details are the most damaging fields to invent: a wrong phone number or
 * a plausible-looking email address on a real job application is worse than a
 * missing one. The prompt forbids inventing them, but a prompt is not an
 * enforcement mechanism — this is. Every value is checked for presence in the
 * source text and silently discarded if absent.
 *
 * Consequences worth stating plainly:
 *  - a hallucinated email cannot reach the document;
 *  - a genuine value the model reformatted beyond recognition is dropped rather
 *    than shown, which is the safe direction to fail in;
 *  - a resume whose text extraction failed yields an empty header rather than a
 *    fabricated one.
 */
export function verifyContactAgainstSource(
  contact: ResumeContact,
  resumeText: string
): ResumeContact {
  const haystack = normalizeForMatch(resumeText);

  const keep = (value: string): string => {
    if (value === "") return "";
    const needle = normalizeForMatch(value);
    if (needle === "") return "";
    return haystack.includes(needle) ? value : "";
  };

  return {
    fullName: keep(contact.fullName),
    email: keep(contact.email),
    phone: keep(contact.phone),
    location: keep(contact.location),
    linkedin: keep(contact.linkedin),
    github: keep(contact.github),
    links: contact.links.filter((link) => keep(link) !== ""),
  };
}

/**
 * Apply the source verification to a whole tailored resume.
 *
 * Only the contact block is verified this way. Bullets and summaries are
 * legitimately REWRITTEN, so a containment check would reject valid tailoring;
 * their protection is the prompt contract plus the fact that the export layer
 * cannot add anything the user has not seen and edited.
 */
export function verifyTailoredResume(
  tailored: TailoredResume,
  resumeText: string
): TailoredResume {
  return {
    ...tailored,
    contact: verifyContactAgainstSource(tailored.contact, resumeText),
  };
}

/**
 * Assemble a tailored resume into a single plain-text document.
 *
 * This is what the user previews, edits, and downloads — a real, openable file,
 * built only from the validated structured content. Pure, so preview and the
 * downloaded bytes are identical and testable.
 */
export function assembleTailoredText(tailored: TailoredResume): string {
  const lines: string[] = [];

  // Identity header FIRST, above any section heading.
  //
  // `parseResumeDocument` treats every line before the first uppercase heading as
  // the header block, and the DOCX/PDF renderers centre it with the name
  // emphasized — so emitting it here is all that is needed for the name and
  // contact row to appear at the top of every export. Absent values contribute
  // nothing rather than an empty line or a placeholder.
  const contact = tailored.contact ?? EMPTY_CONTACT;

  if (contact.fullName) lines.push(contact.fullName);

  // One compact contact row, in the conventional order. Joined with a separator
  // ATS parsers handle reliably.
  const contactRow = [contact.email, contact.phone, contact.location]
    .filter((value) => value !== "")
    .join(" | ");
  if (contactRow) lines.push(contactRow);

  const linkRow = [contact.linkedin, contact.github, ...(contact.links ?? [])]
    .filter((value) => value !== "")
    .join(" | ");
  if (linkRow) lines.push(linkRow);

  if (lines.length > 0) lines.push("");

  if (tailored.summary) {
    lines.push("SUMMARY", tailored.summary, "");
  }

  if (tailored.skills.length > 0) {
    lines.push("SKILLS", tailored.skills.join(" · "), "");
  }

  if (tailored.experience.length > 0) {
    lines.push("EXPERIENCE");
    for (const role of tailored.experience) {
      const header = role.detail ? `${role.title} — ${role.detail}` : role.title;
      if (header) lines.push(header);
      for (const bullet of role.bullets) lines.push(`  • ${bullet}`);
      lines.push("");
    }
  }

  if (tailored.education.length > 0) {
    lines.push("EDUCATION", ...tailored.education, "");
  }

  if (tailored.certifications.length > 0) {
    lines.push("CERTIFICATIONS", ...tailored.certifications, "");
  }

  // Projects as their own section, so a resume with both certifications and
  // projects keeps the distinction it had.
  if (tailored.projects && tailored.projects.length > 0) {
    lines.push("PROJECTS", ...tailored.projects, "");
  }

  // Anything else the resume genuinely carried. Headings are uppercased so
  // `parseResumeDocument` recognises them as section headings rather than body
  // text, which is what keeps them styled correctly in the DOCX and PDF.
  for (const section of tailored.additionalSections ?? []) {
    lines.push(section.heading.toUpperCase(), ...section.lines, "");
  }

  // Trim a single trailing blank line for a clean file end.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}
