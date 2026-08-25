/**
 * Browser-only Gmail scanning POC.
 *
 * CLIENT ONLY â€” runs entirely in the browser with NO backend calls.
 *
 * This module fetches Gmail messages directly from the browser using a
 * browser-issued access token, classifies them using the existing deterministic
 * logic, and returns scan results WITHOUT persisting anything or transmitting
 * any Gmail data to JobTrackOS servers.
 *
 * CRITICAL SECURITY PROPERTIES:
 * - Access token stays in memory only (no localStorage/sessionStorage/cookies)
 * - Gmail message data never sent to /api routes or Supabase
 * - No AI API calls from browser
 * - Classification is purely deterministic
 */

import {
  listMessages,
  getMessageMetadata,
  getMessageFull,
  type GmailMessageRef,
} from "./client.ts";
import { buildGmailQuery, type ScanWindow } from "./query.ts";
import { parseGmailMessage, type ParsedEmail } from "./parse.ts";
import { evaluateEmailWithEvidence, sanitizeCompanyName, portalNameFromDomain } from "./heuristics.ts";
import type { EmailCategory } from "./heuristics.ts";
import type { EvidenceReason } from "./applicationEvidence.ts";
import { resolveEmployer } from "./employer.ts";
import { inferStatusFromCategory } from "./statusInference.ts";
import type { ApplicationStatus } from "@/app/applications/types";

/** Configuration for the browser scan. */
export interface BrowserScanConfig {
  /** Browser-issued Gmail access token. Never persisted. */
  accessToken: string;
  /** How far back to scan (7d, 30d, 60d, 90d). */
  window: ScanWindow;
  /** Progress callback for live updates. */
  onProgress?: (progress: BrowserScanProgress) => void;
}

/** Live progress during a scan. */
export interface BrowserScanProgress {
  /** Messages listed from Gmail so far. */
  messagesListed: number;
  /** Messages fetched and classified so far. */
  messagesProcessed: number;
  /** Messages classified as candidates so far. */
  candidates: number;
  /** Current status message. */
  status: string;
}

/** Classification result for one message. */
export interface ClassifiedMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  sender: string | null;
  senderDomain: string | null;
  emailDate: string | null;
  category: EmailCategory;
  confidence: number;
  evidenceReason: EvidenceReason;
  /** True when this is a strong lifecycle event. */
  isLifecycle: boolean;
  /** Inferred application status */
  status: ApplicationStatus;
  /** Company name (sanitized) */
  company: string | null;
  /** Job title/role */
  jobTitle: string | null;
  /** Job URL if detected */
  jobUrl: string | null;
  /** Job portal/platform name (LinkedIn, Naukri, etc.) or null for direct employer email */
  jobPortal: string | null;
}

/** Final scan results. */
export interface BrowserScanResult {
  /** Total messages listed from Gmail. */
  messagesListed: number;
  /** Total messages fetched and classified. */
  messagesProcessed: number;
  /** Messages classified as candidates. */
  candidates: number;
  /** Classified candidate messages. */
  candidateMessages: ClassifiedMessage[];
  /** Messages that were ambiguous after body escalation. */
  ambiguousCount: number;
  /** Messages re-fetched with body for escalation. */
  bodyEscalated: number;
  /** Of those, how many were resolved by body content. */
  bodyResolved: number;
  /** Evidence reason counts. */
  evidenceReasonCounts: Record<string, number>;
}

/** Hard limit for POC: stop listing if we reach this many messages. */
const POC_MESSAGE_LIMIT = 2000;

/** Maximum messages to fetch per batch (bounded concurrency). */
const BATCH_SIZE = 10;

/** Maximum ambiguous messages to escalate with full body fetch. */
const BODY_ESCALATION_LIMIT = 40;

/** Bounded concurrency for metadata fetches. */
const METADATA_CONCURRENCY = 5;

/**
 * Run concurrent operations with bounded parallelism.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/**
 * Scan Gmail directly from the browser.
 *
 * This is the POC entry point. It:
 * 1. Builds the Gmail query for the selected window
 * 2. Paginates through Gmail messages
 * 3. Fetches metadata with bounded concurrency
 * 4. Classifies using deterministic logic
 * 5. Escalates ambiguous messages with body fetch
 * 6. Returns results WITHOUT persisting or transmitting to backend
 */
export async function scanGmailInBrowser(
  config: BrowserScanConfig
): Promise<BrowserScanResult> {
  const { accessToken, window: scanWindow, onProgress } = config;

  // Build the Gmail query for the selected window
  const query = buildGmailQuery({ range: scanWindow });

  const allMessageRefs: GmailMessageRef[] = [];
  const candidateMessages: ClassifiedMessage[] = [];
  const evidenceReasonCounts: Record<string, number> = {};
  let candidates = 0;
  let pageToken: string | null = null;
  let bodyEscalated = 0;
  let bodyResolved = 0;
  let ambiguousCount = 0;

  // Phase 1: List all messages matching the query
  onProgress?.({
    messagesListed: 0,
    messagesProcessed: 0,
    candidates: 0,
    status: "Listing messages from Gmail...",
  });

  while (true) {
    if (allMessageRefs.length >= POC_MESSAGE_LIMIT) {
      onProgress?.({
        messagesListed: allMessageRefs.length,
        messagesProcessed: 0,
        candidates: 0,
        status: `POC limit reached (${POC_MESSAGE_LIMIT} messages). Processing...`,
      });
      break;
    }

    const listResult = await listMessages(accessToken, {
      query,
      pageToken: pageToken ?? undefined,
      maxResults: 100,
    });

    allMessageRefs.push(...listResult.messages);

    onProgress?.({
      messagesListed: allMessageRefs.length,
      messagesProcessed: 0,
      candidates: 0,
      status: `Listed ${allMessageRefs.length} messages...`,
    });

    if (!listResult.nextPageToken) break;
    pageToken = listResult.nextPageToken;
  }

  if (allMessageRefs.length === 0) {
    return {
      messagesListed: 0,
      messagesProcessed: 0,
      candidates: 0,
      candidateMessages: [],
      ambiguousCount: 0,
      bodyEscalated: 0,
      bodyResolved: 0,
      evidenceReasonCounts: {},
    };
  }

  // Phase 2: Fetch metadata and classify in batches
  onProgress?.({
    messagesListed: allMessageRefs.length,
    messagesProcessed: 0,
    candidates: 0,
    status: "Fetching and classifying messages...",
  });

  const ambiguousEmails: Array<{ email: ParsedEmail; reason: EvidenceReason }> = [];
  let processed = 0;

  // Process in batches to avoid memory issues
  for (let i = 0; i < allMessageRefs.length; i += BATCH_SIZE) {
    const batch = allMessageRefs.slice(i, i + BATCH_SIZE);

    // Fetch metadata with bounded concurrency
    const metadataResults = await mapWithConcurrency(
      batch,
      METADATA_CONCURRENCY,
      async (ref) => {
        try {
          const gmailMessage = await getMessageMetadata(accessToken, ref.id);
          return parseGmailMessage(gmailMessage);
        } catch {
          // If fetch fails, skip this message
          return null;
        }
      }
    );

    // Classify each message
    for (const email of metadataResults) {
      if (email === null) {
        processed++;
        continue;
      }

      const { evidence, verdict } = evaluateEmailWithEvidence(email);

      // Track evidence reasons
      evidenceReasonCounts[evidence.reason] =
        (evidenceReasonCounts[evidence.reason] ?? 0) + 1;

      if (!verdict.candidate) {
        processed++;
        continue;
      }

      candidates++;

      if (verdict.needsAI) {
        // Ambiguous - will escalate with body later
        ambiguousEmails.push({ email, reason: evidence.reason });
        processed++;
        continue;
      }

      // Deterministic classification succeeded
      const company = sanitizeCompanyName(
        resolveEmployer(email, email.senderRootDomain),
        email.senderRootDomain
      );
      
      const jobPortal = portalNameFromDomain(email.senderRootDomain);
      
      const inferredStatus = inferStatusFromCategory(verdict.category ?? "OTHER_JOB_RELATED");
      
      // Only include if we have a valid status
      if (inferredStatus) {
        candidateMessages.push({
          gmailMessageId: email.gmailMessageId,
          gmailThreadId: email.gmailThreadId,
          subject: email.subject,
          sender: email.sender,
          senderDomain: email.senderRootDomain,
          emailDate: email.emailDate,
          category: verdict.category ?? "OTHER_JOB_RELATED",
          confidence: verdict.confidence,
          evidenceReason: evidence.reason,
          isLifecycle: evidence.isLifecycleEvent,
          status: inferredStatus,
          company,
          jobTitle: null, // Not extracted from metadata
          jobUrl: email.jobUrl,
          jobPortal,
        });
      }

      processed++;
    }

    onProgress?.({
      messagesListed: allMessageRefs.length,
      messagesProcessed: processed,
      candidates,
      status: `Processed ${processed}/${allMessageRefs.length} messages, ${candidates} candidates found...`,
    });
  }

  // Phase 3: Escalate ambiguous messages with full body fetch
  if (ambiguousEmails.length > 0) {
    onProgress?.({
      messagesListed: allMessageRefs.length,
      messagesProcessed: processed,
      candidates,
      status: `Escalating ${Math.min(ambiguousEmails.length, BODY_ESCALATION_LIMIT)} ambiguous messages with body content...`,
    });

    const toEscalate = ambiguousEmails.slice(0, BODY_ESCALATION_LIMIT);
    const deferred = ambiguousEmails.slice(BODY_ESCALATION_LIMIT);

    bodyEscalated = toEscalate.length;

    const escalationResults = await mapWithConcurrency(
      toEscalate,
      METADATA_CONCURRENCY,
      async ({ email, reason }) => {
        try {
          const fullMessage = await getMessageFull(accessToken, email.gmailMessageId);
          const fullEmail = parseGmailMessage(fullMessage);

          const { evidence, verdict } = evaluateEmailWithEvidence(fullEmail);

          if (!verdict.candidate || verdict.needsAI) {
            // Still ambiguous after body fetch
            return { resolved: false, email, reason };
          }

          // Body resolved it!
          const company = sanitizeCompanyName(
            resolveEmployer(fullEmail, fullEmail.senderRootDomain),
            fullEmail.senderRootDomain
          );
          
          const jobPortal = portalNameFromDomain(fullEmail.senderRootDomain);
          
          const inferredStatus = inferStatusFromCategory(verdict.category ?? "OTHER_JOB_RELATED");
          
          // Only return if we have a valid status
          if (!inferredStatus) {
            return { resolved: false, email, reason };
          }
          
          return {
            resolved: true,
            classified: {
              gmailMessageId: fullEmail.gmailMessageId,
              gmailThreadId: fullEmail.gmailThreadId,
              subject: fullEmail.subject,
              sender: fullEmail.sender,
              senderDomain: fullEmail.senderRootDomain,
              emailDate: fullEmail.emailDate,
              category: verdict.category ?? "OTHER_JOB_RELATED",
              confidence: verdict.confidence,
              evidenceReason: evidence.reason,
              isLifecycle: evidence.isLifecycleEvent,
              status: inferredStatus,
              company,
              jobTitle: null,
              jobUrl: fullEmail.jobUrl,
              jobPortal,
            },
          };
        } catch {
          // Fetch failed, stays ambiguous
          return { resolved: false, email, reason };
        }
      }
    );

    for (const result of escalationResults) {
      if (result.resolved && "classified" in result && result.classified) {
        candidateMessages.push(result.classified);
        bodyResolved++;
      } else {
        ambiguousCount++;
      }
    }

    // Deferred messages stay ambiguous
    ambiguousCount += deferred.length;
  }

  return {
    messagesListed: allMessageRefs.length,
    messagesProcessed: processed,
    candidates,
    candidateMessages,
    ambiguousCount,
    bodyEscalated,
    bodyResolved,
    evidenceReasonCounts,
  };
}

