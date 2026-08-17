/**
 * Workspace assembly: what still needs the user, and nothing else.
 *
 * Pure and deterministic — no Supabase client, no clock, no I/O. Callers hand in
 * the proposals `buildProposals` produced and the Unknown-bucket rows
 * `fetchUnknownBucket` returned, both already read under `user_id`, so this
 * module never sees another user's data.
 *
 * Why its own module rather than `autoImport.ts` or `proposals.ts`:
 *  - `autoImport.ts` owns the decision table and the Supabase runner. This is
 *    presentation selection, a different concern, and keeping it out leaves that
 *    file and its `sync.ts` wiring untouched.
 *  - `proposals.ts` cannot host it: classification needs `decideProposal`, and
 *    `autoImport.ts` already imports `buildProposals`, so importing back would
 *    create a cycle.
 *
 * The invariant this module exists to hold: a proposal the Auto_Importer
 * CREATED or LINKED is a finished result, never a pending decision. Only held
 * proposals and Unknown-bucket entries are pending. This is not an approval
 * queue — nothing here gates automatic organization, it only reports the
 * exceptions automatic organization refused to guess at.
 */

import {
  decideProposal,
  type AutoImportContext,
  type AutoImportReason,
} from "./autoImport.ts";
import { portalNameFromDomain, type EmailCategory } from "./heuristics.ts";
import type { ApplicationProposal } from "./proposals.ts";

/** The two held outcomes of the decision table, as a type. */
export type HeldAction = "hold_ambiguous" | "hold_unknown_employer";

/** A proposal the Auto_Importer declined to act on, with why. */
export interface HeldProposal {
  proposal: ApplicationProposal;
  action: HeldAction;
  /** Fixed reason code from the decision table's vocabulary; never email text. */
  reason: AutoImportReason;
}

/**
 * One Unknown-bucket row, reduced to the compact evidence a bucket entry shows:
 * category, sender domain, portal, date, reason code. No subject, no snippet,
 * no body — this shape makes rendering email text impossible rather than merely
 * discouraged.
 */
export interface UnknownBucketEntry {
  /** The activity id a `resolve_unknown` decision references. */
  activityId: string;
  category: EmailCategory;
  senderDomain: string | null;
  /** Derived from the sender domain, exactly as a proposal's portal is. */
  jobPortal: string | null;
  emailDate: string | null;
  reason: string | null;
}

/** Minimal row shape, so a `GmailActivityRow` can be passed straight in. */
export interface UnknownBucketRowLike {
  id: string;
  application_id: string | null;
  company: string | null;
  category: EmailCategory;
  email_date: string | null;
  sender_domain: string | null;
  evidence_reason?: string | null;
}

/**
 * The workspace's pending work, with the two kinds kept apart because they are
 * answered differently: a held proposal takes import / merge / ignore, a bucket
 * entry takes an employer name.
 */
export interface PendingDecisions {
  /** Held proposals in input order (most recent activity first). */
  heldProposals: HeldProposal[];
  /** Bucket entries in input order (most recent evidence first). */
  unknownEntries: UnknownBucketEntry[];
}

const HELD_ACTIONS: Record<HeldAction, true> = {
  hold_ambiguous: true,
  hold_unknown_employer: true,
};

function isHeldAction(action: string): action is HeldAction {
  return Object.prototype.hasOwnProperty.call(HELD_ACTIONS, action);
}

/**
 * Membership test for a bucket row, duplicated in neither direction: the shared
 * predicate lives in the data layer, and this only guards against a caller
 * passing rows the query would not have returned.
 */
function isBucketEntry(row: UnknownBucketRowLike): boolean {
  return row.application_id === null && row.company === null;
}

/**
 * Select exactly the unresolved work.
 *
 * Held-ness is not re-derived here: each proposal is run back through
 * `decideProposal`, the same function the runner used, so the workspace and the
 * Auto_Importer can never disagree about what was left undone. `create` and
 * `link` decisions are dropped.
 *
 * @param proposals proposals for ONE user, as built for the auto-import run
 * @param bucketRows that user's Unknown-bucket rows
 * @param context the same context the runner used, so ownership refusals
 *                classify identically
 */
export function selectPendingDecisions(
  proposals: readonly ApplicationProposal[],
  bucketRows: readonly UnknownBucketRowLike[],
  context: AutoImportContext = {}
): PendingDecisions {
  const heldProposals: HeldProposal[] = [];

  for (const proposal of proposals) {
    const decision = decideProposal(proposal, context);
    if (!isHeldAction(decision.action)) continue;

    heldProposals.push({
      proposal,
      action: decision.action,
      reason: decision.reason,
    });
  }

  const unknownEntries: UnknownBucketEntry[] = [];

  for (const row of bucketRows) {
    if (!isBucketEntry(row)) continue;

    unknownEntries.push({
      activityId: row.id,
      category: row.category,
      senderDomain: row.sender_domain,
      jobPortal: portalNameFromDomain(row.sender_domain),
      emailDate: row.email_date,
      reason: row.evidence_reason ?? null,
    });
  }

  return { heldProposals, unknownEntries };
}

/** How many decisions the workspace is asking the user to make. */
export function countPendingDecisions(pending: PendingDecisions): number {
  return pending.heldProposals.length + pending.unknownEntries.length;
}
