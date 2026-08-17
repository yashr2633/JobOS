/**
 * Resume document model — the single structured source for every export format.
 *
 * WHY THIS EXISTS
 *
 * The tailoring engine (`lib/ai/tailorResume.ts`) already produces a validated
 * `TailoredResume` and assembles it into plain text with `assembleTailoredText`.
 * That text is what the user PREVIEWS AND EDITS, so it — not the original model
 * response — is the authoritative content at export time. Exporting from the AI
 * response would silently discard the user's edits.
 *
 * So this module parses the edited text back into structure. It is the
 * deterministic inverse of `assembleTailoredText`, and it is the only input the
 * DOCX and PDF renderers accept. Consequences that matter:
 *
 *  - TXT, DOCX and PDF all describe the SAME bytes the user is looking at.
 *  - The export layer cannot fabricate anything. It has no model access, no
 *    network, and no resume/JD data — it can only re-shape text it was handed.
 *    Every string in the output document is a substring of the input.
 *  - A user who types their own name, phone or a new section gets it rendered.
 *    Nothing invents contact details that the resume does not contain.
 *
 * Pure and total: no I/O, no throws on odd input. Unknown shapes degrade to
 * plain lines rather than being dropped.
 */

/** A rendered line of resume content. */
export interface ResumeLine {
  kind: "line";
  text: string;
  /**
   * True when this line labels the bullets beneath it (a role/employer header).
   * Derived purely from position — the next content line is a bullet — never
   * from interpreting the words.
   */
  emphasized: boolean;
}

/** A contiguous run of bullet items. */
export interface ResumeBullets {
  kind: "bullets";
  items: string[];
}

export type ResumeBlock = ResumeLine | ResumeBullets;

export interface ResumeSection {
  /** Conventional ATS heading, e.g. "EXPERIENCE". Rendered as written. */
  heading: string;
  blocks: ResumeBlock[];
}

export interface ResumeDocument {
  /**
   * Lines above the first section heading — typically the candidate's name and
   * contact details, if THEY put them there. Never generated.
   */
  headerLines: string[];
  sections: ResumeSection[];
}

/** Longest plausible section heading. Guards against a shouted sentence. */
const MAX_HEADING_LENGTH = 60;

/** Bullet markers `assembleTailoredText` emits, plus the ones users type. */
const BULLET_PATTERN = /^[\u2022\u00b7*\-\u2013\u2014]\s*/;

/**
 * Is this line a section heading?
 *
 * Structural test only: short, contains a letter, and carries no lowercase
 * letter. That matches every heading `assembleTailoredText` writes ("SUMMARY",
 * "SKILLS", "EXPERIENCE", "EDUCATION", "CERTIFICATIONS & PROJECTS") and any
 * uppercase heading a user adds, without a hardcoded list that would silently
 * demote a user's own section to body text.
 */
export function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (trimmed.length > MAX_HEADING_LENGTH) return false;
  if (BULLET_PATTERN.test(trimmed)) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase();
}

/** Strip a leading bullet marker, or return null when there is none. */
function bulletBody(line: string): string | null {
  const trimmed = line.trim();
  if (!BULLET_PATTERN.test(trimmed)) return null;
  const body = trimmed.replace(BULLET_PATTERN, "").trim();
  return body === "" ? null : body;
}

/** One raw classified line, before blocks are grouped. */
type Classified =
  | { type: "bullet"; text: string }
  | { type: "text"; text: string };

/**
 * Group classified lines into blocks, marking a text line as emphasized when a
 * bullet follows it directly.
 */
function toBlocks(entries: Classified[]): ResumeBlock[] {
  const blocks: ResumeBlock[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    if (entry.type === "bullet") {
      const items: string[] = [];
      while (index < entries.length && entries[index].type === "bullet") {
        items.push(entries[index].text);
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "bullets", items });
      continue;
    }

    const next = entries[index + 1];
    blocks.push({
      kind: "line",
      text: entry.text,
      emphasized: next !== undefined && next.type === "bullet",
    });
  }

  return blocks;
}

/**
 * Parse an edited tailored resume into a `ResumeDocument`.
 *
 * Every retained string is a trimmed substring of `text`. Blank lines are
 * structural separators and are dropped; no content line is ever discarded.
 */
export function parseResumeDocument(text: string): ResumeDocument {
  const rawLines = typeof text === "string" ? text.split(/\r\n|\r|\n/) : [];

  const headerLines: string[] = [];
  const sections: ResumeSection[] = [];

  /** Lines for the section currently being filled. */
  let pending: Classified[] = [];
  let heading: string | null = null;

  const flush = () => {
    if (heading === null) return;
    sections.push({ heading, blocks: toBlocks(pending) });
    pending = [];
  };

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;

    if (isSectionHeading(trimmed)) {
      flush();
      heading = trimmed;
      continue;
    }

    const bullet = bulletBody(trimmed);

    if (heading === null) {
      // Above the first heading: the user's own name/contact block. Bullet
      // markers there are kept as written rather than restructured.
      headerLines.push(bullet ?? trimmed);
      continue;
    }

    pending.push(
      bullet !== null ? { type: "bullet", text: bullet } : { type: "text", text: trimmed }
    );
  }

  flush();

  return { headerLines, sections };
}

/** True when the document has nothing renderable. */
export function isResumeDocumentEmpty(doc: ResumeDocument): boolean {
  return doc.headerLines.length === 0 && doc.sections.length === 0;
}

/**
 * Every text fragment the document carries, for verification.
 *
 * Used by the export tests to assert the renderers introduce no string that was
 * not in the user's edited content.
 */
export function collectDocumentText(doc: ResumeDocument): string[] {
  const out: string[] = [...doc.headerLines];
  for (const section of doc.sections) {
    out.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === "line") out.push(block.text);
      else out.push(...block.items);
    }
  }
  return out;
}

/**
 * Slugify a label into a safe download filename stem.
 *
 * Shared by the client and the export route so a file is named the same however
 * it was produced, and so no user text can steer the filename into a path.
 */
export function resumeFileStem(label: string): string {
  const safe = (typeof label === "string" ? label : "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `tailored-resume-${safe === "" ? "job" : safe}`;
}
