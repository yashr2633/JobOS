import type { GmailReviewMessage } from "./browserScan.ts";

/** Preserve exclusions across partial scans; new positive evidence restores a record. */
export function mergeExcludedMessageIds(previous: string[], incoming: string[], restoredIds: string[]): string[] {
  const excluded = new Set([...previous, ...incoming]);
  for (const id of restoredIds) excluded.delete(id);
  return [...excluded];
}

/** A partial or narrower scan must never erase earlier unresolved evidence. */
export function mergeReviewMessages(previous: GmailReviewMessage[], incoming: GmailReviewMessage[], resolvedIds: string[]): GmailReviewMessage[] {
  const resolved = new Set(resolvedIds);
  const messages = new Map(previous.map(message => [message.gmailMessageId, message]));
  for (const message of incoming) messages.set(message.gmailMessageId, message);
  for (const id of resolved) messages.delete(id);
  return [...messages.values()];
}
