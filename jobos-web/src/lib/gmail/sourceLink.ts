/**
 * Build the deep link that opens a stored Gmail message in the Gmail web UI.
 *
 * Pure and total: given a message id (and optionally the connected mailbox
 * address) it returns one URL string. It never queries and never guesses an id.
 *
 * Two problems this solves, both observed in manual verification:
 *
 *  1. ACCOUNT TARGETING. The browser may have several Google accounts signed
 *     in. The path segment `u/0` selects the FIRST signed-in account, which is
 *     usually NOT the connected mailbox, so the link opened the wrong account.
 *     The `authuser=<address>` query parameter pins the request to a specific
 *     account by address regardless of which one is the browser default, so the
 *     link lands in the mailbox the message actually belongs to.
 *
 *  2. EXACT MESSAGE. The `#all/<messageId>` fragment opens the specific message
 *     (searching All Mail), rather than the inbox, a generic search, or the
 *     Gmail homepage. The stored `gmail_message_id` is used verbatim.
 *
 * When no connected address is available (a pre-Sprint-9 connection that never
 * captured one, or a disconnected mailbox) the link falls back to the previous
 * `u/0` behavior — still targeting the exact message, just without the explicit
 * account pin. That is strictly no worse than before and never fabricates data.
 */

const GMAIL_BASE = "https://mail.google.com/mail";

/**
 * @param messageId    the stored `gmail_message_id` (Gmail's message id)
 * @param accountEmail the connected mailbox address, when known
 * @returns a Gmail web URL opening that message, or null when messageId is blank
 */
export function buildGmailMessageUrl(
  messageId: string | null | undefined,
  accountEmail?: string | null
): string | null {
  const id = typeof messageId === "string" ? messageId.trim() : "";
  if (id === "") return null;

  const encodedId = encodeURIComponent(id);
  const address = typeof accountEmail === "string" ? accountEmail.trim() : "";

  if (address !== "") {
    // authuser pins the account by address; the #all/<id> fragment opens the
    // exact message. The u/0 path stays as a harmless base — authuser wins.
    return `${GMAIL_BASE}/u/0/?authuser=${encodeURIComponent(
      address
    )}#all/${encodedId}`;
  }

  // No known address: preserve the exact-message behavior without account pin.
  return `${GMAIL_BASE}/u/0/#all/${encodedId}`;
}
