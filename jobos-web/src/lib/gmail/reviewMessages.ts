import type { GmailReviewMessage } from "./browserScan.ts";

/** A partial or narrower scan must never erase earlier unresolved evidence. */
export function mergeReviewMessages(previous: GmailReviewMessage[], incoming: GmailReviewMessage[], resolvedIds: string[]): GmailReviewMessage[] {
  const resolved = new Set(resolvedIds);
  const messages = new Map(previous.map(message => [message.gmailMessageId, message]));
  for (const message of incoming) messages.set(message.gmailMessageId, message);
  for (const id of resolved) messages.delete(id);
  return [...messages.values()];
}
