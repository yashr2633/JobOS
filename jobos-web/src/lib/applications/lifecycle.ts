/**
 * The application status lifecycle — the ONE place the transition rules live.
 *
 * Pure: no React, no Supabase, no network, no clock. The UI reads it to decide
 * which targets to offer, and the data-access layer reads it to refuse a change
 * before it reaches the database. The SQL function
 * `update_application_status` in
 * `supabase-schema-sprint10-application-lifecycle.sql` enforces the SAME table
 * as an atomicity and security backstop, and `lifecycle.test.ts` asserts the two
 * agree pair-for-pair so they cannot drift.
 *
 * No new status is invented here. The vocabulary is exactly the five values the
 * frozen `applications.status` CHECK constraint already allows.
 *
 * Imported by relative path with an explicit `.ts` extension so the module and
 * its test stay runnable under `node --test`, matching the convention in
 * `src/lib/gmail/` and `src/app/dashboard/metrics.ts`.
 */

import type {
  ApplicationStatus,
  ApplicationStatusSource,
} from "../../app/applications/types.ts";

/** The five statuses the `applications.status` CHECK constraint allows. */
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
];

/** The three sources the `application_status_history.source` CHECK allows. */
export const APPLICATION_STATUS_SOURCES: readonly ApplicationStatusSource[] = [
  "manual",
  "gmail",
  "system",
];

/**
 * The canonical forward transition table.
 *
 * Forward means "the search progressed": an application moves out of `Applied`
 * into a stage or an outcome, out of `Interview` into an outcome, and out of
 * `Offer` only into `Rejected` (an offer that fell through). `Rejected` and
 * `Ghosted` are terminal.
 *
 * `Ghosted` is reachable from `Applied` and `Interview` because it is the
 * "silence" outcome of an application that was live. It is not reachable from
 * `Offer`: an offer is a reply, so silence is no longer the story.
 *
 * Anything absent from this table is NOT a forward transition and requires the
 * explicit correction path — see `classifyTransition`.
 */
export const FORWARD_TRANSITIONS: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  Applied: ["Interview", "Offer", "Rejected", "Ghosted"],
  Interview: ["Offer", "Rejected", "Ghosted"],
  Offer: ["Rejected"],
  Rejected: [],
  Ghosted: [],
};

/** Own-property lookup, so a prototype key can never satisfy the guard. */
function hasOwn(table: object, value: unknown): boolean {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(table, value)
  );
}

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return hasOwn(FORWARD_TRANSITIONS, value);
}

export function isApplicationStatusSource(
  value: unknown
): value is ApplicationStatusSource {
  return (
    typeof value === "string" &&
    (APPLICATION_STATUS_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * The statuses a user may move `current` to without a correction.
 *
 * This is what the status control offers. It deliberately does NOT include
 * `current` itself: staying put is not a transition.
 */
export function allowedNextStatuses(
  current: ApplicationStatus
): readonly ApplicationStatus[] {
  return FORWARD_TRANSITIONS[current];
}

export function isForwardTransition(
  from: ApplicationStatus,
  to: ApplicationStatus
): boolean {
  return FORWARD_TRANSITIONS[from].includes(to);
}

/**
 * What a requested change is.
 *
 *   `no_op`                the status is already `to`; nothing to record.
 *   `allowed`              a forward transition.
 *   `requires_correction`  a real change that is not forward, so it may only
 *                          happen through the deliberate correction path.
 */
export type TransitionOutcome = "no_op" | "allowed" | "requires_correction";

export function classifyTransition(
  from: ApplicationStatus,
  to: ApplicationStatus
): TransitionOutcome {
  if (from === to) return "no_op";
  return isForwardTransition(from, to) ? "allowed" : "requires_correction";
}

/**
 * Every forward pair, as `from|to` strings sorted for comparison.
 *
 * Exists so the SQL function's allowed-pair list can be compared against this
 * table exactly, in one assertion, rather than rule by rule.
 */
export function forwardTransitionPairs(): string[] {
  const pairs: string[] = [];

  for (const from of APPLICATION_STATUSES) {
    for (const to of FORWARD_TRANSITIONS[from]) {
      pairs.push(`${from}|${to}`);
    }
  }

  return pairs.sort();
}

/**
 * A note is stored verbatim, so it is bounded before it reaches the column.
 * Long enough for a real explanation, short enough not to become a document
 * store.
 */
export const STATUS_NOTE_MAX_LENGTH = 280;

/** Trim and bound a note. Empty text becomes `null` — one form for "absent". */
export function normalizeStatusNote(
  note: string | null | undefined
): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  return trimmed === "" ? null : trimmed.slice(0, STATUS_NOTE_MAX_LENGTH);
}

/**
 * The note recorded when a user corrects a status that was set wrongly.
 *
 * A fixed constant rather than free text: the point of a correction is that it
 * is identifiable in the history afterwards.
 */
export const STATUS_CORRECTION_NOTE =
  "Manual correction of a previously recorded status.";

/**
 * Message shown when a transition is refused.
 *
 * Written for a person and built only from the status vocabulary, so no SQL
 * text can ever reach the UI through this path.
 */
export function describeRefusedTransition(
  from: ApplicationStatus,
  to: ApplicationStatus
): string {
  const forward = FORWARD_TRANSITIONS[from];

  if (forward.length === 0) {
    return `${from} is a final status, so it can't be changed to ${to}. Correct it explicitly if it was set by mistake.`;
  }

  return `An application that is ${from} can only move to ${forward.join(
    ", "
  )}. Correct it explicitly if ${to} was set by mistake.`;
}
