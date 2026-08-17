/**
 * Deterministic extraction from a Gmail message.
 *
 * Pure functions only: no network, no AI, no database. Everything obtainable
 * without a model is obtained here, because every field resolved here is a
 * field we never pay a model to guess.
 *
 * Body text is produced transiently for classification. It is never returned in
 * a shape intended for persistence, and callers must not store it.
 */

import type { GmailMessage, GmailPayloadPart } from "./client.ts";

/** Header lookup is case-insensitive: Gmail does not normalize header casing. */
export function getHeader(
  message: GmailMessage,
  name: string
): string | null {
  const headers = message.payload?.headers ?? [];
  const target = name.toLowerCase();

  for (const header of headers) {
    if (typeof header?.name === "string" && header.name.toLowerCase() === target) {
      return typeof header.value === "string" ? header.value : null;
    }
  }
  return null;
}

/**
 * Extract the bare address from a From header.
 *
 * Handles `Name <a@b.com>`, bare `a@b.com`, and quoted display names that
 * themselves contain angle brackets or commas.
 */
export function parseSender(fromHeader: string | null): {
  sender: string | null;
  senderDomain: string | null;
} {
  if (!fromHeader) return { sender: null, senderDomain: null };

  const angled = fromHeader.match(/<([^<>]+)>/);
  const candidate = (angled ? angled[1] : fromHeader).trim();

  // Validate rather than trust: a malformed From must not yield a bogus domain.
  const match = candidate.match(/^[^\s@]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/);
  if (!match) return { sender: null, senderDomain: null };

  return {
    sender: candidate.toLowerCase(),
    senderDomain: match[1].toLowerCase(),
  };
}

/**
 * Reduce a hostname to its registrable-ish root so subdomains group together.
 *
 * `careers.eu.greenhouse.io` -> `greenhouse.io`. Handles the common two-part
 * public suffixes (`co.uk`, `com.au`) without shipping a full PSL, which would
 * be disproportionate here.
 */
export function rootDomain(domain: string | null): string | null {
  if (!domain) return null;

  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".") || null;

  const twoPartSuffixes = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk",
    "com.au", "net.au", "org.au",
    "co.nz", "co.jp", "co.in", "com.br", "com.sg",
  ]);

  const lastTwo = labels.slice(-2).join(".");
  if (twoPartSuffixes.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * Message timestamp.
 *
 * `internalDate` (epoch ms, set by Gmail) is preferred over the `Date` header,
 * which is supplied by the sender and can be wrong or absent.
 */
export function parseMessageDate(message: GmailMessage): string | null {
  if (message.internalDate) {
    const ms = Number(message.internalDate);
    if (Number.isFinite(ms) && ms > 0) {
      return new Date(ms).toISOString();
    }
  }

  const dateHeader = getHeader(message, "Date");
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  return null;
}

/** Decode Gmail's base64url body payload. Returns "" on anything malformed. */
export function decodeBase64Url(data: string | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/** Strip HTML to readable text without pulling in a parser dependency. */
export function htmlToText(html: string): string {
  return html
    // Remove elements whose content is never human-readable prose.
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    // Decode only the entities that actually matter for readability.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Walk the MIME tree and return readable text, preferring text/plain.
 *
 * Attachments are skipped entirely — a PDF or image cannot contribute to
 * classification and would only inflate payload size.
 */
export function extractBodyText(message: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];

  const visit = (part: GmailPayloadPart | undefined): void => {
    if (!part) return;
    if (part.filename) return; // attachment

    const mime = (part.mimeType ?? "").toLowerCase();

    if (mime === "text/plain") {
      plain.push(decodeBase64Url(part.body?.data));
    } else if (mime === "text/html") {
      html.push(decodeBase64Url(part.body?.data));
    }

    for (const child of part.parts ?? []) visit(child);
  };

  visit(message.payload);

  const plainText = plain.join("\n").trim();
  if (plainText) return plainText;

  const htmlText = html.join("\n").trim();
  return htmlText ? htmlToText(htmlText) : "";
}

/** Absolute http(s) URLs, de-duplicated, order preserved. */
export function extractUrls(text: string): string[] {
  if (!text) return [];

  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const raw of matches) {
    // Trailing punctuation is almost always sentence punctuation, not URL.
    const cleaned = raw.replace(/[.,;:!]+$/, "");
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    urls.push(cleaned);
  }

  return urls;
}

/**
 * Job/application URL, when one is confidently identifiable.
 *
 * Restricted to known ATS URL shapes. A generic marketing link must never be
 * mistaken for a job posting, because job_url is later used as a high-trust
 * matching signal.
 */
export function findJobUrl(urls: string[]): string | null {
  const patterns = [
    /greenhouse\.io\/[^\s]*(jobs?|applications?)/i,
    /boards\.greenhouse\.io\//i,
    /jobs\.lever\.co\//i,
    /myworkdayjobs\.com\//i,
    /ashbyhq\.com\//i,
    /smartrecruiters\.com\/[^\s]*\/?\d*/i,
    /icims\.com\/jobs?\//i,
    /taleo\.net\/[^\s]*requisition/i,
    /workable\.com\/j\//i,
    /jobvite\.com\/[^\s]*\/job\//i,
    /linkedin\.com\/jobs\/view\//i,
    /indeed\.com\/(viewjob|job)/i,
  ];

  for (const url of urls) {
    if (patterns.some((pattern) => pattern.test(url))) return url;
  }
  return null;
}

/**
 * Everything deterministically knowable about a message.
 *
 * `bodyText` is transient: it exists so heuristics and (only if necessary) the
 * classifier can read it. It must never be written to the database.
 */
export interface ParsedEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  sender: string | null;
  senderDomain: string | null;
  senderRootDomain: string | null;
  emailDate: string | null;
  snippet: string;
  rfcMessageId: string | null;
  /** True when the message advertises list-unsubscribe, i.e. bulk mail. */
  hasUnsubscribe: boolean;
  labelIds: string[];
  jobUrl: string | null;
  /** TRANSIENT — never persist. Empty for metadata-only fetches. */
  bodyText: string;
}

/** Normalize a Gmail message into the deterministic shape above. */
export function parseGmailMessage(message: GmailMessage): ParsedEmail {
  const fromHeader = getHeader(message, "From");
  const { sender, senderDomain } = parseSender(fromHeader);

  const subject = (getHeader(message, "Subject") ?? "").trim();
  const snippet = (message.snippet ?? "").trim();
  const bodyText = extractBodyText(message);

  // Prefer body URLs; fall back to the snippet for metadata-only fetches.
  const urls = extractUrls(bodyText || snippet);

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    subject,
    sender,
    senderDomain,
    senderRootDomain: rootDomain(senderDomain),
    emailDate: parseMessageDate(message),
    snippet,
    rfcMessageId: getHeader(message, "Message-ID"),
    hasUnsubscribe: getHeader(message, "List-Unsubscribe") !== null,
    labelIds: message.labelIds ?? [],
    jobUrl: findJobUrl(urls),
    bodyText,
  };
}
