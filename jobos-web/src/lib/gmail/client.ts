/**
 * Minimal Gmail REST client.
 *
 * SERVER ONLY. Raw `fetch` against two endpoints — deliberately not the
 * `googleapis` package, which would pull in a large discovery layer for what is
 * two HTTP calls. This mirrors how lib/gmail/oauth.ts already talks to Google's
 * token endpoint directly.
 *
 * Failures are normalized into a small taxonomy so the sync route can decide
 * retry vs. backoff vs. reconnect without parsing vendor error text.
 */

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Bounded retry policy. Kept small: the sync loop itself is resumable. */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

export type GmailFailureKind =
  /** 401 — token rejected. Caller should refresh once and retry once. */
  | "unauthorized"
  /** 403/429 rate or quota limit. Transient; back off. */
  | "rate_limit"
  /** 5xx or network fault. Transient. */
  | "unavailable"
  /** 4xx that will not fix itself. */
  | "invalid_request"
  | "unknown";

export class GmailApiError extends Error {
  readonly kind: GmailFailureKind;
  readonly status: number | null;

  constructor(kind: GmailFailureKind, message: string, status: number | null = null) {
    super(message);
    this.name = "GmailApiError";
    this.kind = kind;
    this.status = status;
  }
}

/** Transient kinds are worth another attempt; the rest are not. */
const RETRYABLE: ReadonlySet<GmailFailureKind> = new Set([
  "rate_limit",
  "unavailable",
]);

function classify(status: number, body: string): GmailFailureKind {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limit";

  if (status === 403) {
    // 403 is overloaded: quota/rate limits are transient, permission problems
    // are not. Google distinguishes them only in the reason string.
    const lowered = body.toLowerCase();
    if (
      lowered.includes("ratelimitexceeded") ||
      lowered.includes("userratelimitexceeded") ||
      lowered.includes("quotaexceeded")
    ) {
      return "rate_limit";
    }
    return "invalid_request";
  }

  if (status >= 500) return "unavailable";
  if (status >= 400) return "invalid_request";
  return "unknown";
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One authenticated Gmail GET with bounded exponential backoff.
 *
 * `unauthorized` is never retried here: only the caller holds the ability to
 * mint a fresh token, so it is surfaced immediately.
 */
async function gmailGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string | string[] | undefined>
): Promise<T> {
  const url = new URL(`${GMAIL_API_BASE}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // Gmail expects repeated keys, e.g. metadataHeaders=From&metadataHeaders=Date
      for (const entry of value) url.searchParams.append(key, entry);
    } else {
      url.searchParams.set(key, value);
    }
  }

  let lastError: GmailApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error: unknown) {
      lastError = new GmailApiError(
        "unavailable",
        error instanceof Error ? error.message : "Gmail network failure"
      );
      continue;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    // Body is read only to classify the failure. It is never logged or
    // returned, because Gmail error payloads can echo query content.
    const body = await response.text().catch(() => "");
    const kind = classify(response.status, body);

    lastError = new GmailApiError(
      kind,
      `Gmail API ${path} failed (HTTP ${response.status}, ${kind})`,
      response.status
    );

    if (!RETRYABLE.has(kind)) throw lastError;
  }

  throw (
    lastError ??
    new GmailApiError("unknown", `Gmail API ${path} failed after retries`)
  );
}

// ---------------------------------------------------------------------------
// messages.list
// ---------------------------------------------------------------------------

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailListResponse {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * List message ids matching a query.
 *
 * Returns ids only — Gmail's list endpoint never includes content, which is
 * exactly what makes the dedup-before-fetch step cheap.
 */
export async function listMessages(
  accessToken: string,
  options: { query: string; pageToken?: string; maxResults?: number }
): Promise<{ messages: GmailMessageRef[]; nextPageToken: string | null }> {
  const data = await gmailGet<GmailListResponse>("/messages", accessToken, {
    q: options.query,
    pageToken: options.pageToken,
    maxResults: String(options.maxResults ?? 100),
  });

  return {
    messages: data.messages ?? [],
    nextPageToken: data.nextPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// messages.get
// ---------------------------------------------------------------------------

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string };
  parts?: GmailPayloadPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
}

/** Headers needed for deterministic extraction. Nothing more is requested. */
export const METADATA_HEADERS = [
  "From",
  "To",
  "Subject",
  "Date",
  "Message-ID",
  "List-Unsubscribe",
] as const;

/**
 * Fetch one message as METADATA.
 *
 * The default and strongly preferred mode: headers plus snippet, no body. Large
 * HTML bodies are the dominant payload cost, and metadata is sufficient for
 * most classification.
 */
export async function getMessageMetadata(
  accessToken: string,
  messageId: string
): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(`/messages/${messageId}`, accessToken, {
    format: "metadata",
    metadataHeaders: [...METADATA_HEADERS],
  });
}

/**
 * Fetch one message in full, including body parts.
 *
 * Reserved for messages that survived heuristics and still could not be
 * classified from metadata alone. The body is used transiently for
 * classification and never persisted.
 */
export async function getMessageFull(
  accessToken: string,
  messageId: string
): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(`/messages/${messageId}`, accessToken, {
    format: "full",
  });
}

// ---------------------------------------------------------------------------
// Incremental synchronisation (getProfile + history.list)
// ---------------------------------------------------------------------------

export interface GmailProfile {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  /** Mailbox-wide sequence number. The anchor for incremental sync. */
  historyId?: string;
}

/**
 * Mailbox profile, used to capture the `historyId` anchor.
 *
 * The anchor must be read BEFORE a full scan begins. Reading it afterwards
 * would silently skip any message that arrived while the scan was running.
 */
export async function getProfile(accessToken: string): Promise<GmailProfile> {
  return gmailGet<GmailProfile>("/profile", accessToken, {});
}

interface GmailHistoryMessageRef {
  message?: { id?: string; threadId?: string };
}

interface GmailHistoryEntry {
  id?: string;
  messagesAdded?: GmailHistoryMessageRef[];
}

interface GmailHistoryResponse {
  history?: GmailHistoryEntry[];
  nextPageToken?: string;
  historyId?: string;
}

/**
 * Raised when Gmail rejects a stored `historyId` as too old.
 *
 * Gmail only retains history for a limited period, and returns HTTP 404 for an
 * out-of-range `startHistoryId`. The documented recovery is a full sync, so
 * this is surfaced as its own type rather than a generic failure.
 */
export class GmailHistoryExpiredError extends Error {
  constructor(message = "Gmail history is no longer available; a full sync is required.") {
    super(message);
    this.name = "GmailHistoryExpiredError";
  }
}

/**
 * List message ids added since `startHistoryId`.
 *
 * Only `messageAdded` is requested: label changes and deletions cannot create
 * a new job application, so processing them would be pure cost. The returned
 * `historyId` becomes the next anchor.
 */
export async function listHistory(
  accessToken: string,
  options: { startHistoryId: string; pageToken?: string; maxResults?: number }
): Promise<{
  messages: GmailMessageRef[];
  nextPageToken: string | null;
  historyId: string | null;
}> {
  let data: GmailHistoryResponse;

  try {
    data = await gmailGet<GmailHistoryResponse>("/history", accessToken, {
      startHistoryId: options.startHistoryId,
      historyTypes: "messageAdded",
      pageToken: options.pageToken,
      maxResults: String(options.maxResults ?? 500),
    });
  } catch (error: unknown) {
    // 404 means the anchor predates Gmail's retention window.
    if (error instanceof GmailApiError && error.status === 404) {
      throw new GmailHistoryExpiredError();
    }
    throw error;
  }

  const messages: GmailMessageRef[] = [];
  const seen = new Set<string>();

  for (const entry of data.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      const id = added.message?.id;
      const threadId = added.message?.threadId;
      if (!id || !threadId) continue;
      // The same message can appear in several history entries.
      if (seen.has(id)) continue;
      seen.add(id);
      messages.push({ id, threadId });
    }
  }

  return {
    messages,
    nextPageToken: data.nextPageToken ?? null,
    historyId: data.historyId ?? null,
  };
}
